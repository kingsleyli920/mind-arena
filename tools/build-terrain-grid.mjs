// 地形网格构建器 —— 从 AWS terrarium 高程瓦片生成 lib/game/data/terrain-grid.json
//
// 数据来源：https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
//   AWS Open Data «Terrain Tiles»，标准 Web Mercator 瓦片编号。
//   terrarium 编码：elevation = (R * 256 + G + B / 256) - 32768  （米）
//   底层数据混合了 SRTM / ASTER / GMTED / ETOPO1(海底) 等公有领域来源，
//   陆地精度约 30–90m，海底为粗略测深，因此本脚本只把它当作「量级正确」的分类依据。
//
// 输出网格约定（等距圆柱，不做任何再投影）：
//   west=94.0 east=127.0 south=16.0 north=43.0，cellSize=0.1°，cols=330 rows=270
//   index = row * cols + col
//   col = floor((lon - 94.0) / 0.1)   自西向东
//   row = floor((43.0 - lat) / 0.1)   自北向南
//   格心：lon = 94.0 + (col + 0.5) * 0.1 ，lat = 43.0 - (row + 0.5) * 0.1
//   该范围覆盖《后汉书·郡国志》全部 105 郡国（经度 94.66–125.74，纬度 16.75–41.95）。
//
// 不确定性说明：
//   1. 瓦片是 Mercator、目标网格是等距圆柱，二者只能按像素中心重采样。z=7 时每格
//      约 9×10 个源像素，用中位数聚合（比均值抗单点噪声与水体空洞）。
//   2. 「起伏度」定义为该格内所有源像素高程的总体标准差。格边长 0.1°≈11km，
//      本身就是一个局部邻域，故不再外扩到 3×3 —— 外扩会把山脚平原误判成山地。
//   3. terrarium 的海面高程并非严格 0，近岸滩涂/三角洲中位数可能落到 0 附近。
//      本脚本把 elev <= 0 视为水体，再用 flood fill 从地图边缘区分 sea / lake，
//      因此「内陆湖」实际含义是「低于海平面且不连通外海的洼地」，
//      而洞庭、鄱阳这类高于海平面的淡水湖不会出现在这里（需另用 Natural Earth 矢量补）。
//
// 重复运行结果一致：瓦片缓存在 refs/dem/（已被 .gitignore 忽略），无随机成分。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, "refs", "dem");
const OUT_FILE = path.join(ROOT, "lib", "game", "data", "terrain-grid.json");

// ── 网格约定（硬编码，任何改动都会让已有郡国坐标对不上）──────────────────────
const WEST = 94.0;
const EAST = 127.0;
const SOUTH = 16.0;
const NORTH = 43.0;
const CELL = 0.1;
const COLS = 330;
const ROWS = 270;
const N = COLS * ROWS; // 89100

// ── 分类阈值 ────────────────────────────────────────────────────────────────
const SEA_LEVEL = 0; // 高程 <= 0 视为水体
const HIGHLAND_ELEV = 3000; // 青藏高原东缘，游戏中不可通行
const MOUNTAIN_ELEV = 800;
const MOUNTAIN_RELIEF = 200;
const HILL_ELEV = 200;
const HILL_RELIEF = 60;

// ── 下载参数 ────────────────────────────────────────────────────────────────
const ZOOM = Number(process.env.DEM_ZOOM ?? 7); // z=7 → 每格约 9×10 像素
const TILE_SIZE = 256;
const CONCURRENCY = 6;
const RETRIES = 2;
const UA = "MindArena-terrain-builder/1.0 (public-domain DEM; contact via project owner)";
const BASE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

const NODATA = -32768;

// ── Web Mercator 换算（注意 y 与纬度是非线性的）──────────────────────────────
const worldPx = TILE_SIZE * 2 ** ZOOM;
const lonToPx = (lon) => ((lon + 180) / 360) * worldPx;
const latToPx = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * worldPx;
};
const pxToLon = (px) => (px / worldPx) * 360 - 180;
const pxToLat = (py) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / worldPx))) * 180) / Math.PI;

// 覆盖 [WEST, EAST] × [SOUTH, NORTH] 所需的瓦片编号区间（末端减 eps，避免多拉一列/一行）
const EPS = 1e-9;
const tileXMin = Math.floor(lonToPx(WEST) / TILE_SIZE);
const tileXMax = Math.floor((lonToPx(EAST) - EPS) / TILE_SIZE);
const tileYMin = Math.floor(latToPx(NORTH) / TILE_SIZE);
const tileYMax = Math.floor((latToPx(SOUTH) - EPS) / TILE_SIZE);

const tilesX = tileXMax - tileXMin + 1;
const tilesY = tileYMax - tileYMin + 1;
const mosaicW = tilesX * TILE_SIZE;
const mosaicH = tilesY * TILE_SIZE;

// ── 1. 下载瓦片（限并发，带 UA 与重试，缓存到 refs/dem/）────────────────────
async function fetchTile(z, x, y) {
  const dest = path.join(CACHE_DIR, String(z), String(x), `${y}.png`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return { buf: await fs.promises.readFile(dest), cached: true };
  }
  const url = `${BASE}/${z}/${x}/${y}.png`;
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 404) return { buf: null, cached: false, missing: true };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error("空响应");
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, buf);
      return { buf, cached: false };
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw new Error(`下载失败 ${url}: ${lastErr?.message ?? lastErr}`);
}

// 解码 terrarium PNG，写入拼接后的高程镶嵌图
async function decodeInto(mosaic, buf, tx, ty) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  if (info.width !== TILE_SIZE || info.height !== TILE_SIZE) {
    throw new Error(`瓦片尺寸异常 ${info.width}×${info.height}`);
  }
  const ox = (tx - tileXMin) * TILE_SIZE;
  const oy = (ty - tileYMin) * TILE_SIZE;
  for (let j = 0; j < TILE_SIZE; j += 1) {
    let src = j * TILE_SIZE * ch;
    let dst = (oy + j) * mosaicW + ox;
    for (let i = 0; i < TILE_SIZE; i += 1) {
      const e = data[src] * 256 + data[src + 1] + data[src + 2] / 256 - 32768;
      // 四舍五入到米；Int16 足以覆盖 -32767..8848
      mosaic[dst] = Math.max(-32767, Math.min(32767, Math.round(e)));
      src += ch;
      dst += 1;
    }
  }
}

async function buildMosaic() {
  const jobs = [];
  for (let ty = tileYMin; ty <= tileYMax; ty += 1) {
    for (let tx = tileXMin; tx <= tileXMax; tx += 1) jobs.push({ tx, ty });
  }
  const mosaic = new Int16Array(mosaicW * mosaicH).fill(NODATA);

  let done = 0;
  let fromCache = 0;
  let missing = 0;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= jobs.length) return;
      const { tx, ty } = jobs[idx];
      const r = await fetchTile(ZOOM, tx, ty);
      if (r.missing) {
        missing += 1;
        console.warn(`! 瓦片缺失 ${ZOOM}/${tx}/${ty}，该区域记为无数据`);
      } else {
        if (r.cached) fromCache += 1;
        await decodeInto(mosaic, r.buf, tx, ty);
      }
      done += 1;
      if (done % 20 === 0 || done === jobs.length) {
        process.stdout.write(`\r  瓦片 ${done}/${jobs.length}（缓存命中 ${fromCache}）`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
  return { mosaic, tileCount: jobs.length, fromCache, missing };
}

// ── 2. 像素 → 网格聚合 ──────────────────────────────────────────────────────
// x→lon、y→lat 可分离，先按行列预算好归属，再两趟扫描（先计数再填充），
// 这样每格能拿到完整样本列表以求中位数，而不必为每格分配一个数组。
function aggregate(mosaic) {
  const colOf = new Int16Array(mosaicW).fill(-1);
  for (let i = 0; i < mosaicW; i += 1) {
    const lon = pxToLon(tileXMin * TILE_SIZE + i + 0.5);
    const c = Math.floor((lon - WEST) / CELL);
    if (c >= 0 && c < COLS) colOf[i] = c;
  }
  const rowOf = new Int16Array(mosaicH).fill(-1);
  for (let j = 0; j < mosaicH; j += 1) {
    const lat = pxToLat(tileYMin * TILE_SIZE + j + 0.5);
    const r = Math.floor((NORTH - lat) / CELL);
    if (r >= 0 && r < ROWS) rowOf[j] = r;
  }

  const counts = new Int32Array(N);
  for (let j = 0; j < mosaicH; j += 1) {
    const r = rowOf[j];
    if (r < 0) continue;
    const base = r * COLS;
    const rowOff = j * mosaicW;
    for (let i = 0; i < mosaicW; i += 1) {
      const c = colOf[i];
      if (c < 0) continue;
      if (mosaic[rowOff + i] === NODATA) continue;
      counts[base + c] += 1;
    }
  }

  const offsets = new Int32Array(N + 1);
  for (let k = 0; k < N; k += 1) offsets[k + 1] = offsets[k] + counts[k];
  const total = offsets[N];
  const samples = new Int16Array(total);
  const cursor = Int32Array.from(offsets.subarray(0, N));
  for (let j = 0; j < mosaicH; j += 1) {
    const r = rowOf[j];
    if (r < 0) continue;
    const base = r * COLS;
    const rowOff = j * mosaicW;
    for (let i = 0; i < mosaicW; i += 1) {
      const c = colOf[i];
      if (c < 0) continue;
      const v = mosaic[rowOff + i];
      if (v === NODATA) continue;
      const k = base + c;
      samples[cursor[k]] = v;
      cursor[k] += 1;
    }
  }

  const elevation = new Int16Array(N);
  const relief = new Int16Array(N);
  let empty = 0;
  for (let k = 0; k < N; k += 1) {
    const n = counts[k];
    if (n === 0) {
      empty += 1;
      continue;
    }
    const slice = samples.subarray(offsets[k], offsets[k] + n);
    // 标准差与顺序无关，先算再排序更省事
    let sum = 0;
    for (let t = 0; t < n; t += 1) sum += slice[t];
    const mean = sum / n;
    let sq = 0;
    for (let t = 0; t < n; t += 1) {
      const d = slice[t] - mean;
      sq += d * d;
    }
    relief[k] = Math.round(Math.sqrt(sq / n));
    slice.sort(); // TypedArray.sort 默认按数值排序
    elevation[k] =
      n % 2 === 1 ? slice[(n - 1) >> 1] : Math.round((slice[n / 2 - 1] + slice[n / 2]) / 2);
  }
  return { elevation, relief, counts, total, empty };
}

// ── 3. 海陆连通性：从地图边缘的水格 flood fill（4 邻接）────────────────────
function markSea(elevation) {
  const isWater = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) if (elevation[k] <= SEA_LEVEL) isWater[k] = 1;

  const sea = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (k) => {
    if (isWater[k] && !sea[k]) {
      sea[k] = 1;
      stack[sp] = k;
      sp += 1;
    }
  };
  for (let c = 0; c < COLS; c += 1) {
    push(c);
    push((ROWS - 1) * COLS + c);
  }
  for (let r = 0; r < ROWS; r += 1) {
    push(r * COLS);
    push(r * COLS + COLS - 1);
  }
  while (sp > 0) {
    sp -= 1;
    const k = stack[sp];
    const c = k % COLS;
    const r = (k - c) / COLS;
    if (c > 0) push(k - 1);
    if (c < COLS - 1) push(k + 1);
    if (r > 0) push(k - COLS);
    if (r < ROWS - 1) push(k + COLS);
  }
  return { isWater, sea };
}

// ── 4. 分类 ─────────────────────────────────────────────────────────────────
// 顺序即优先级：水体 → 高原 → 山地 → 丘陵 → 平原
const LEGEND = { s: "sea", l: "lake", p: "plain", h: "hill", m: "mountain", g: "highland" };

function classify(elevation, relief, isWater, sea) {
  const out = new Array(N);
  for (let k = 0; k < N; k += 1) {
    const e = elevation[k];
    const v = relief[k];
    let code;
    if (isWater[k]) code = sea[k] ? "s" : "l";
    else if (e > HIGHLAND_ELEV) code = "g";
    else if (e > MOUNTAIN_ELEV || v > MOUNTAIN_RELIEF) code = "m";
    else if (e >= HILL_ELEV || v >= HILL_RELIEF) code = "h";
    else code = "p";
    out[k] = code;
  }
  return out.join("");
}

// ── 5. 序列化（meta/legend 可读，三个大数组各压成一行）──────────────────────
function serialize(meta, terrain, elevation, relief) {
  const arr = (a) => `[${Array.prototype.join.call(a, ",")}]`;
  return [
    "{",
    `"meta":${JSON.stringify(meta, null, 2)},`,
    `"legend":${JSON.stringify(LEGEND)},`,
    `"terrain":${JSON.stringify(terrain)},`,
    `"elevation":${arr(elevation)},`,
    `"relief":${arr(relief)}`,
    "}",
    "",
  ].join("\n");
}

// ── 校验工具 ────────────────────────────────────────────────────────────────
const colOfLon = (lon) => Math.floor((lon - WEST) / CELL);
const rowOfLat = (lat) => Math.floor((NORTH - lat) / CELL);

async function main() {
  console.log(`地形网格构建：z=${ZOOM}，瓦片 x[${tileXMin}..${tileXMax}] y[${tileYMin}..${tileYMax}]`);
  console.log(`  镶嵌图 ${mosaicW}×${mosaicH} 像素，目标网格 ${COLS}×${ROWS} = ${N} 格`);

  const t0 = Date.now();
  const { mosaic, tileCount, fromCache, missing } = await buildMosaic();
  console.log(`  ${tileCount} 张瓦片就绪（缓存 ${fromCache}，缺失 ${missing}），耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const { elevation, relief, counts, total, empty } = aggregate(mosaic);
  let minN = Infinity;
  let maxN = 0;
  for (let k = 0; k < N; k += 1) {
    if (counts[k] < minN) minN = counts[k];
    if (counts[k] > maxN) maxN = counts[k];
  }
  console.log(`  聚合完成：样本 ${total}，每格 ${minN}–${maxN} 像素，空格 ${empty}`);

  const { isWater, sea } = markSea(elevation);
  const terrain = classify(elevation, relief, isWater, sea);

  const meta = {
    west: WEST,
    east: EAST,
    south: SOUTH,
    north: NORTH,
    cellSize: CELL,
    cols: COLS,
    rows: ROWS,
    projection: "equirectangular",
    indexing: "index = row * cols + col; col = floor((lon - west) / cellSize); row = floor((north - lat) / cellSize)",
    cellCenter: "lon = west + (col + 0.5) * cellSize; lat = north - (row + 0.5) * cellSize",
    units: { elevation: "m", relief: "m" },
    source: `AWS Terrain Tiles (terrarium), zoom ${ZOOM}: ${BASE}/{z}/{x}/{y}.png`,
    license: "Public domain / open data (SRTM, ASTER GDEM, GMTED2010, ETOPO1 等公有领域来源汇编；AWS Open Data 无使用限制)",
    generatedFrom: "tools/build-terrain-grid.mjs",
    method: "每格取覆盖像素的高程中位数；relief 为该格覆盖像素高程的总体标准差；sea/lake 由地图边缘 4 邻接 flood fill 区分",
    thresholds: {
      seaLevel: SEA_LEVEL,
      highlandElev: HIGHLAND_ELEV,
      mountainElev: MOUNTAIN_ELEV,
      mountainRelief: MOUNTAIN_RELIEF,
      hillElev: HILL_ELEV,
      hillRelief: HILL_RELIEF,
    },
  };

  await fs.promises.mkdir(path.dirname(OUT_FILE), { recursive: true });
  const json = serialize(meta, terrain, elevation, relief);
  await fs.promises.writeFile(OUT_FILE, json);
  console.log(`  写出 ${path.relative(ROOT, OUT_FILE)}  ${(json.length / 1048576).toFixed(2)}MB`);

  // ── 关键校验 ────────────────────────────────────────────────────────────
  console.log("\n地形占比：");
  const tally = {};
  for (const code of Object.keys(LEGEND)) tally[code] = 0;
  for (let k = 0; k < N; k += 1) tally[terrain[k]] += 1;
  for (const [code, name] of Object.entries(LEGEND)) {
    const n = tally[code];
    console.log(`  ${code} ${name.padEnd(9)} ${String(n).padStart(6)}  ${((n / N) * 100).toFixed(2)}%`);
  }

  const at = (lon, lat) => {
    const c = colOfLon(lon);
    const r = rowOfLat(lat);
    const k = r * COLS + c;
    return { c, r, k, code: terrain[k], name: LEGEND[terrain[k]], elev: elevation[k], rel: relief[k] };
  };
  const CHECKS = [
    { label: "黄海 (122.0, 35.0)", lon: 122.0, lat: 35.0, want: ["sea"] },
    { label: "渤海 (119.5, 38.5)", lon: 119.5, lat: 38.5, want: ["sea"] },
    { label: "东海 (124.0, 29.0)", lon: 124.0, lat: 29.0, want: ["sea"] },
    { label: "南海 (112.0, 18.0)", lon: 112.0, lat: 18.0, want: ["sea"] },
    { label: "四川盆地 (104.5, 30.5)", lon: 104.5, lat: 30.5, want: ["plain", "hill"] },
    { label: "秦岭 (107.5, 33.8)", lon: 107.5, lat: 33.8, want: ["mountain"] },
    { label: "华北平原 (115.0, 36.0)", lon: 115.0, lat: 36.0, want: ["plain"] },
    { label: "青藏高原东缘 (95.0, 32.0)", lon: 95.0, lat: 32.0, want: ["highland"] },
  ];
  console.log("\n关键校验：");
  let bad = 0;
  for (const chk of CHECKS) {
    const g = at(chk.lon, chk.lat);
    const ok = chk.want.includes(g.name);
    if (!ok) bad += 1;
    console.log(
      `  ${ok ? "✓" : "✗"} ${chk.label.padEnd(26)} col=${String(g.c).padStart(3)} row=${String(g.r).padStart(3)}  ` +
        `${g.name.padEnd(8)} elev=${String(g.elev).padStart(5)}m relief=${String(g.rel).padStart(4)}m  期望 ${chk.want.join("/")}`,
    );
  }

  // (120, 36) 正落在青岛黄岛一带的陆地上（该格中心 120.05,35.95），按要求校验「附近为海」：
  // 从该格向外找最近的 sea 格，距离应在 2 格（约 20km）以内。
  {
    const c0 = colOfLon(120.0);
    const r0 = rowOfLat(36.0);
    let best = Infinity;
    let bestAt = null;
    for (let dr = -4; dr <= 4; dr += 1) {
      for (let dc = -4; dc <= 4; dc += 1) {
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
        if (terrain[r * COLS + c] !== "s") continue;
        const d = Math.max(Math.abs(dr), Math.abs(dc));
        if (d < best) {
          best = d;
          bestAt = [WEST + (c + 0.5) * CELL, NORTH - (r + 0.5) * CELL];
        }
      }
    }
    const ok = best <= 2;
    if (!ok) bad += 1;
    const self = at(120.0, 36.0);
    console.log(
      `  ${ok ? "✓" : "✗"} ${"(120.0,36.0) 附近为海".padEnd(26)} 本格 ${self.name}(elev=${self.elev}m，青岛黄岛陆地)，` +
        `最近海格距 ${best} 格 @ (${bestAt ? bestAt.map((v) => v.toFixed(2)).join(", ") : "无"})`,
    );
  }

  // 105 郡国落点抽查：郡治不该落在海里
  const cmdPath = path.join(ROOT, "lib", "game", "data", "commanderies.json");
  if (fs.existsSync(cmdPath)) {
    const raw = JSON.parse(await fs.promises.readFile(cmdPath, "utf8"));
    const list = Array.isArray(raw) ? raw : (raw.commanderies ?? Object.values(raw));
    const inSea = [];
    let outside = 0;
    for (const cm of list) {
      const c = colOfLon(cm.longitude);
      const r = rowOfLat(cm.latitude);
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) {
        outside += 1;
        continue;
      }
      const code = terrain[r * COLS + c];
      if (code === "s" || code === "l") inSea.push(`${cm.name}(${cm.longitude},${cm.latitude})`);
    }
    console.log(`\n郡国落点：${list.length} 个，越界 ${outside}，落在水格 ${inSea.length}`);
    if (inSea.length) console.log(`  ${inSea.join("  ")}`);
    if (outside) bad += 1;
  }

  console.log(`\n${bad === 0 ? "全部校验通过" : `${bad} 项校验未通过`}`);
if (bad !== 0) process.exitCode = 1;
}

await main();
