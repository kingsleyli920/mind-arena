// 汉末水墨战略地图渲染器
//
// 核心思路：不画线，而是「落墨」。地形网格先聚成连通区域，求出内距离场，
// 再沿区域骨架把真实皴法墨迹图章按地势走向盖上去。多枚图章在密度场里叠加，
// 由吸墨饱和曲线统一显影——因此一条山脉呈现为连绵的一体山体，
// 而不是一格一个山包，也没有任何矢量描边的"线条感"。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { InkField, developRGB, paperBase, stamp, fbm, hash, noise2 } from "./ink-canvas.mjs";
import { drawGlyph, ridgePoints } from "./mountain-forms.mjs";

const GRID_PATH = process.env.GRID ?? "lib/game/data/terrain-grid.json";
const OUT = process.env.OUT ?? "map-ink.png";
const PX = Number(process.env.PX ?? 6);              // 每格像素

const grid = JSON.parse(fs.readFileSync(GRID_PATH, "utf8"));
const { west, east, south, north, cellSize, cols, rows } = grid.meta;
// 网格提供原始高程与起伏度，分类阈值由渲染器决定。
// 0.1 度格约 11km，中国东部普遍起伏 >500m，若沿用宽松阈值会把丘陵全判成山地。
const ELEV = grid.elevation, RELIEF = grid.relief;
const T = (() => {
  if (!ELEV || !RELIEF) {                               // 无原始数据则回退到网格自带分类
    const map = {}; for (const [code, name] of Object.entries(grid.legend ?? {})) {
      map[code] = { sea: "~", lake: "o", plain: ".", hill: "h", mountain: "M", highland: "^" }[name] ?? ".";
    }
    return [...grid.terrain].map((ch) => map[ch] ?? ch).join("");
  }
  const out = new Array(cols * rows);
  for (let i = 0; i < cols * rows; i += 1) {
    const e = ELEV[i], rl = RELIEF[i];
    out[i] = e <= 0 ? "~" : e > 3000 ? "^" : (e > 1400 || rl > 900) ? "M" : (e > 350 || rl > 320) ? "h" : ".";
  }
  // 内陆水体：自地图边缘 flood fill 标出真海，其余水面为湖
  const seen = new Uint8Array(cols * rows), st = [];
  for (let c = 0; c < cols; c += 1) { st.push(c); st.push((rows - 1) * cols + c); }
  for (let r = 0; r < rows; r += 1) { st.push(r * cols); st.push(r * cols + cols - 1); }
  while (st.length) {
    const i = st.pop(); if (seen[i] || out[i] !== "~") continue; seen[i] = 1;
    const r = (i / cols) | 0, c = i % cols;
    if (c > 0) st.push(i - 1); if (c < cols - 1) st.push(i + 1);
    if (r > 0) st.push(i - cols); if (r < rows - 1) st.push(i + cols);
  }
  for (let i = 0; i < cols * rows; i += 1) if (out[i] === "~" && !seen[i]) out[i] = "o";
  return out.join("");
})();
{ const c = {}; for (const ch of T) c[ch] = (c[ch] ?? 0) + 1;
  console.log("地形占比:", Object.entries(c).map(([k, v]) => `${k} ${(v / T.length * 100).toFixed(1)}%`).join("  ")); }
const W = cols * PX, H = rows * PX;

const lon2px = (lon) => ((lon - west) / (east - west)) * W;
const lat2py = (lat) => ((north - lat) / (north - south)) * H;

console.log(`网格 ${cols}×${rows}  画布 ${W}×${H}  每格 ${PX}px`);

// ── 载入皴法墨迹图章 ────────────────────────────────────────────────
const inkDir = "public/game/ink";
const manifest = JSON.parse(fs.readFileSync(path.join(inkDir, "manifest.json"), "utf8"));
const stamps = { fupi: [], pima: [], yudian: [], juanyun: [] };
for (const s of manifest.stamps) {
  const { data, info } = await sharp(path.join(inkDir, s.file)).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, size = info.width;
  const gray = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i += 1) gray[i] = data[i * ch];
  // 丢弃几乎空白的图章（斧劈皴那批有几张是素绢）
  let sum = 0; for (const v of gray) sum += v;
  if (sum / gray.length < 18) continue;
  stamps[s.cun]?.push({ data: gray, size });
}
console.log("图章:", Object.entries(stamps).map(([k, v]) => `${k} ${v.length}`).join("  "));

// ── 连通域标记 ──────────────────────────────────────────────────────
function labelRegions(match) {
  const label = new Int32Array(cols * rows).fill(-1);
  const regions = [];
  for (let i = 0; i < cols * rows; i += 1) {
    if (label[i] >= 0 || !match(T[i])) continue;
    const id = regions.length, cells = [];
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const j = stack.pop(); cells.push(j);
      const r = (j / cols) | 0, c = j % cols;
      const push = (k) => { if (label[k] < 0 && match(T[k])) { label[k] = id; stack.push(k); } };
      if (c > 0) push(j - 1);
      if (c < cols - 1) push(j + 1);
      if (r > 0) push(j - cols);
      if (r < rows - 1) push(j + cols);
    }
    regions.push({ id, cells });
  }
  return { label, regions };
}

// ── 内距离场（两遍 chamfer）：格子到区域边界的距离，用于区分山体中心与边缘 ──
function innerDistance(match) {
  const INF = 1e6;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i += 1) d[i] = match(T[i]) ? INF : 0;
  const D1 = 1, D2 = 1.41421356;
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const i = r * cols + c; if (d[i] === 0) continue;
    let m = d[i];
    if (r > 0)             m = Math.min(m, d[i - cols] + D1);
    if (c > 0)             m = Math.min(m, d[i - 1] + D1);
    if (r > 0 && c > 0)    m = Math.min(m, d[i - cols - 1] + D2);
    if (r > 0 && c < cols-1) m = Math.min(m, d[i - cols + 1] + D2);
    d[i] = m;
  }
  for (let r = rows - 1; r >= 0; r -= 1) for (let c = cols - 1; c >= 0; c -= 1) {
    const i = r * cols + c; if (d[i] === 0) continue;
    let m = d[i];
    if (r < rows-1)          m = Math.min(m, d[i + cols] + D1);
    if (c < cols-1)          m = Math.min(m, d[i + 1] + D1);
    if (r < rows-1 && c < cols-1) m = Math.min(m, d[i + cols + 1] + D2);
    if (r < rows-1 && c > 0) m = Math.min(m, d[i + cols - 1] + D2);
    d[i] = m;
  }
  return d;
}

const isSea = (ch) => ch === "~";
const isLand = (ch) => ch !== "~";

// ── 画布 ────────────────────────────────────────────────────────────
const rgb = paperBase(W, H, 11);
const ink = new InkField(W, H);        // 主墨层
const blue = new InkField(W, H);       // 水系青墨层
const seaField = new InkField(W, H);   // 海面淡墨层

// ── 1. 海面与岸线：先在像素分辨率上做陆地掩膜再模糊，
//      用连续的掩膜值取代逐格填充，从根本上消掉网格阶梯 ─────────────
const landMask = new Float32Array(W * H);
{
  for (let py = 0; py < H; py += 1) {
    const r = (py / PX) | 0;
    for (let px = 0; px < W; px += 1) {
      landMask[py * W + px] = isLand(T[r * cols + ((px / PX) | 0)]) ? 1 : 0;
    }
  }
  // 盒式模糊两遍近似高斯；半径随格尺寸走，恰好抹平一格的阶梯
  const R = Math.max(2, Math.round(PX * 1.1));
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < H; y += 1) {                     // 横向
      let s = 0;
      const at = (x) => landMask[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let k = -R; k <= R; k += 1) s += at(k);
      for (let x = 0; x < W; x += 1) { tmp[y * W + x] = s / (2 * R + 1); s += at(x + R + 1) - at(x - R); }
    }
    for (let x = 0; x < W; x += 1) {                     // 纵向
      let s = 0;
      const at = (y) => tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let k = -R; k <= R; k += 1) s += at(k);
      for (let y = 0; y < H; y += 1) { landMask[y * W + x] = s / (2 * R + 1); s += at(y + R + 1) - at(y - R); }
    }
  }
  // 海面淡青：掩膜越接近 0 越远离陆地，墨色越沉
  const dSea = innerDistance(isSea);
  for (let py = 0; py < H; py += 1) for (let px = 0; px < W; px += 1) {
    const m = landMask[py * W + px];
    if (m > 0.52) continue;
    const gi = ((py / PX) | 0) * cols + ((px / PX) | 0);
    const depth = Math.min(1, (dSea[gi] || 0) / 16);
    seaField.add(px, py, (0.18 + depth * 0.30) * Math.min(1, (0.52 - m) / 0.34));
  }
  // 网巾纹：随纬度起伏的横向水纹，只落在海面上
  for (let py = 0; py < H; py += Math.max(3, Math.round(PX * 1.15))) {
    for (let px = 0; px < W; px += 1) {
      const wob = Math.sin(px / 46 + py / 130) * 2.4 + (fbm(px / 34, py / 34, 3, 21) - 0.5) * 3.4;
      const y = Math.round(py + wob);
      if (y < 0 || y >= H) continue;
      const gi = ((y / PX) | 0) * cols + ((px / PX) | 0);
      if (!isSea(T[gi])) continue;
      const a = 0.30 + fbm(px / 9, py / 9, 2, 33) * 0.55;      // 笔断意连
      blue.addSmooth(px, y, a * 0.5);
      blue.addSmooth(px, y + 1, a * 0.16);
    }
  }
}

// ── 2. 地形符号：依《华夷图》语汇，沿山脊排布山字记号 ────────────────
//     不做纹理填充 —— 填充只能给出明暗，给不出「这是山」的语义。
const glyphQueue = [];
const TERRAIN_SIGNS = [
  //  类别 皴法      间距(格) 宽(格) 高(格) 峰数 浓度  远近淡化
  { ch: "^", cun: "yudian",  gap: 3.6, w: 2.2, h: 1.1, humps: 2, weight: 0.34, minD: 1.0 }, // 高原：疏、淡、矮
  { ch: "h", cun: "pima",    gap: 2.6, w: 2.4, h: 1.3, humps: 2, weight: 0.62, minD: 0.9 }, // 丘陵
  { ch: "M", cun: "fupi",    gap: 2.2, w: 3.0, h: 2.1, humps: 3, weight: 0.95, minD: 0.9 }, // 山地：密、浓、高
];
for (const sign of TERRAIN_SIGNS) {
  const match = (ch) => ch === sign.ch;
  const dist = innerDistance(match);
  const pool = stamps[sign.cun].length ? stamps[sign.cun] : stamps.pima;
  const pts = ridgePoints(dist, cols, rows, match, T, sign.minD, sign.gap);
  for (const pt of pts) {
    const seed = pt.c * 7919 + pt.r * 104729;
    const jx = (hash(pt.c, pt.r, 3) - 0.5) * 0.8;
    const jy = (hash(pt.c, pt.r, 5) - 0.5) * 0.6;
    const grow = 0.72 + Math.min(1, dist[pt.r * cols + pt.c] / 4) * 0.66;   // 山体越厚，峰越大
    glyphQueue.push({
      cx: (pt.c + 0.5 + jx) * PX,
      baseY: (pt.r + 0.85 + jy) * PX,
      width: sign.w * grow * (0.78 + hash(pt.c, pt.r, 11) * 0.5) * PX,
      height: sign.h * grow * (0.75 + hash(pt.c, pt.r, 13) * 0.55) * PX,
      humps: sign.humps + (hash(pt.c, pt.r, 17) > 0.66 ? 1 : 0),
      weight: sign.weight * (0.82 + hash(pt.c, pt.r, 19) * 0.3),
      seed,
      tex: pool.length ? pool[Math.floor(hash(pt.c, pt.r, 23) * pool.length) % pool.length] : null,
      haze: 0,
    });
  }
  console.log(`${sign.ch} 山符 ${pts.length} 枚`);
}

// ── 3. 海岸线：取模糊掩膜的 0.5 等值带，得到平滑且粗细不匀的手绘岸线 ──
for (let py = 0; py < H; py += 1) for (let px = 0; px < W; px += 1) {
  const m = landMask[py * W + px];
  const d = Math.abs(m - 0.5);
  if (d > 0.17) continue;
  const core = 1 - d / 0.17;                                   // 越接近等值线越浓
  const vary = 0.45 + fbm(px / 9, py / 9, 3, 61) * 1.05;       // 运笔提按，粗细不匀
  ink.addSmooth(px, py, core * core * vary * 0.42);
}

// ── 4. 水系：沿点列走笔，笔画自上游向下游渐宽，带手绘抖动 ─────────────
const HYDRO = process.env.HYDRO ?? "lib/game/data/hydrology.json";
if (fs.existsSync(HYDRO)) {
  const hyd = JSON.parse(fs.readFileSync(HYDRO, "utf8"));
  // 主干加粗，支流从细。黄河、长江是战略主轴，必须一眼可辨。
  const WEIGHT = { 黄河: 1.7, 长江: 1.7, 淮水: 1.05, 汉水: 1.05, 渭水: 0.9, 湘水: 0.78, 赣水: 0.78, 泗水: 0.7, 沂水: 0.6 };
  let drawn = 0;
  for (const river of hyd.rivers ?? []) {
    const w0 = WEIGHT[river.name] ?? 0.34;
    const pts = river.points;
    for (let i = 1; i < pts.length; i += 1) {
      const [ax, ay] = [lon2px(pts[i-1][0]), lat2py(pts[i-1][1])];
      const [bx, by] = [lon2px(pts[i][0]), lat2py(pts[i][1])];
      const len = Math.hypot(bx - ax, by - ay);
      if (!Number.isFinite(len) || len > W * 0.4) continue;      // 跳过跨图断点
      const prog = i / pts.length;                                // 下游渐宽
      const half = w0 * PX * (0.30 + prog * 0.42);
      const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
      for (let t = 0; t <= len; t += 0.5) {
        const u = t / (len || 1);
        const x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
        const wob = (fbm(x / 17, y / 17, 3, 71) - 0.5) * PX * 0.35;   // 手绘抖动
        const press = 0.72 + fbm(x / 6, y / 6, 2, 83) * 0.62;         // 提按
        for (let o = -half; o <= half; o += 0.4) {
          const fall = 1 - Math.abs(o) / (half + 0.5);
          blue.addSmooth(x + nx * (o + wob), y + ny * (o + wob), fall * press * 0.42);
        }
      }
      drawn += 1;
    }
  }
  console.log(`水系 ${hyd.rivers.length} 条，${drawn} 段`);
}

// ── 显影 ────────────────────────────────────────────────────────────
seaField.blur(Math.max(1, PX * 0.5));
developRGB(rgb, seaField, W, H, [122, 148, 150], 0.85, 0.42);   // 海面淡青
blue.blur(0.6);
developRGB(rgb, blue, W, H, [44, 78, 88], 1.0, 0.60);           // 水纹
ink.blur(Math.max(0.4, PX * 0.07));                             // 墨在纸上洇散
developRGB(rgb, ink, W, H, [34, 29, 23], 0.95, 0.88);           // 主墨

// 地形符号最后落笔，按纬度自北向南排序 —— 近处山符压住远处，形成层叠纵深
const paperRef = paperBase(W, H, 11);
glyphQueue.sort((a, b) => a.baseY - b.baseY);
for (const g of glyphQueue) drawGlyph(rgb, W, H, paperRef, g);
console.log(`落山符 ${glyphQueue.length} 枚`);

// ── 注记层：郡国、州名、图廓、题名。用 SVG 叠加，字形交给系统中文衬线体 ──
let annotated = Buffer.from(rgb);
let annotatedChannels = 3;
if (process.env.LABELS !== "0" && fs.existsSync("lib/game/data/commanderies.json")) {
  const C = JSON.parse(fs.readFileSync("lib/game/data/commanderies.json", "utf8"));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const FONT = "Songti SC, STSong, Source Han Serif SC, serif";
  const inRange = (c) => c.longitude >= west && c.longitude <= east && c.latitude >= south && c.latitude <= north;

  // 州名：大字淡墨，压在底层，像旧图的分区题记
  const zhouPos = {};
  for (const c of C.filter(inRange)) {
    (zhouPos[c.zhou] ??= []).push([lon2px(c.longitude), lat2py(c.latitude)]);
  }
  const zhouText = Object.entries(zhouPos).map(([z, pts]) => {
    const x = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${PX * 7}" fill="#3a3228" fill-opacity="0.17"
      font-family="${FONT}" text-anchor="middle" letter-spacing="${PX * 1.6}">${esc(z)}</text>`;
  }).join("");

  // 标注避让：大郡优先占位，后来者依次尝试右／左／上／下四个方位，
  // 仍冲突则向下逐格推开。古图讲究注记不压注记。
  const boxes = [];
  const place = (x, y, w, h) => {
    const cand = [[x, y], [-x - w, y], [x, y - h * 1.15], [x, y + h * 1.15]];
    for (const [ox, oy] of cand) {
      const bx = ox < 0 ? -ox - w : ox;
      if (!boxes.some((b) => bx < b.x + b.w && bx + w > b.x && oy < b.y + b.h && oy + h > b.y)) {
        boxes.push({ x: bx, y: oy, w, h }); return [bx, oy, ox < 0];
      }
    }
    let oy = y;
    for (let k = 1; k <= 14; k += 1) {
      oy = y + (k % 2 ? k : -k) * h * 0.85;
      if (!boxes.some((b) => x < b.x + b.w && x + w > b.x && oy < b.y + b.h && oy + h > b.y)) break;
    }
    boxes.push({ x, y: oy, w, h }); return [x, oy, false];
  };

  // 郡国标记：大郡用双方城，其余单方城 —— 沿用古图「城郭」符号
  const ordered = C.filter(inRange).sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  const marks = ordered.map((c) => {
    const x = lon2px(c.longitude), y = lat2py(c.latitude);
    const isSeat = ["河南尹", "京兆尹"].includes(c.name) || c.name.endsWith("尹");
    const big = (c.population ?? 0) > 900000 || isSeat;
    const s = big ? PX * 1.5 : PX * 1.05;
    const sym = big
      ? `<rect x="${(x-s).toFixed(1)}" y="${(y-s).toFixed(1)}" width="${(s*2).toFixed(1)}" height="${(s*2).toFixed(1)}" fill="none" stroke="#241f18" stroke-width="${(PX*0.30).toFixed(2)}"/>
         <rect x="${(x-s*0.45).toFixed(1)}" y="${(y-s*0.45).toFixed(1)}" width="${(s*0.9).toFixed(1)}" height="${(s*0.9).toFixed(1)}" fill="#241f18"/>`
      : `<rect x="${(x-s).toFixed(1)}" y="${(y-s).toFixed(1)}" width="${(s*2).toFixed(1)}" height="${(s*2).toFixed(1)}" fill="none" stroke="#2b251c" stroke-width="${(PX*0.24).toFixed(2)}"/>
         <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(s*0.34).toFixed(2)}" fill="#2b251c"/>`;
    const fs_ = big ? PX * 2.5 : PX * 2.0;
    const text = c.name.replace(/[郡国]$/, "");
    const [lx, ly] = place(x + s * 1.9, y - fs_ * 0.55, text.length * fs_ * 1.06, fs_ * 1.15);
    // 描白边保证压在墨色山体上仍可读；引线连回城郭符号
    const far = Math.hypot(lx - x, ly - y) > s * 4;
    const leader = far ? `<line x1="${(x + (lx > x ? s : -s)).toFixed(1)}" y1="${y.toFixed(1)}"
      x2="${(lx + (lx > x ? 0 : text.length * fs_ * 1.06)).toFixed(1)}" y2="${(ly + fs_ * 0.6).toFixed(1)}"
      stroke="#4a4034" stroke-width="${(PX*0.10).toFixed(2)}" stroke-opacity="0.55"/>` : "";
    const label = `${leader}<text x="${lx.toFixed(1)}" y="${(ly + fs_ * 0.9).toFixed(1)}" font-size="${fs_.toFixed(1)}"
      font-family="${FONT}" paint-order="stroke" stroke="#efe8d2" stroke-width="${(PX*0.62).toFixed(2)}"
      stroke-linejoin="round" fill="#1d1913">${esc(text)}</text>`;
    return sym + label;
  }).join("");

  // 渡口津：小圆点加细注，只标水陆要冲
  let fordText = "";
  if (fs.existsSync(HYDRO)) {
    const hyd = JSON.parse(fs.readFileSync(HYDRO, "utf8"));
    fordText = (hyd.fords ?? []).filter(inRange).map((f) => {
      const x = lon2px(f.longitude), y = lat2py(f.latitude);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(PX*0.5).toFixed(2)}" fill="none" stroke="#2c4a52" stroke-width="${(PX*0.22).toFixed(2)}"/>
        <text x="${(x + PX * 1.1).toFixed(1)}" y="${(y + PX * 0.62).toFixed(1)}" font-size="${(PX*1.62).toFixed(1)}"
        font-family="${FONT}" paint-order="stroke" stroke="#efe8d2" stroke-width="${(PX*0.5).toFixed(2)}"
        stroke-linejoin="round" fill="#284249">${esc(f.name)}</text>`;
    }).join("");
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${zhouText}${marks}${fordText}</svg>`;
  // 合成带 alpha 的 SVG 后输出会变成 4 通道，必须按实际通道数接收
  const composed = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .raw().toBuffer({ resolveWithObject: true });
  annotated = composed.data;
  annotatedChannels = composed.info.channels;
  console.log(`注记 ${C.filter(inRange).length} 郡国 / ${Object.keys(zhouPos).length} 州`);
}

const img = sharp(annotated, { raw: { width: W, height: H, channels: annotatedChannels } }).removeAlpha();
if (process.env.CROP) {
  const [cw, ce, cs, cn] = process.env.CROP.split(",").map(Number);
  const left = Math.round(lon2px(cw)), top = Math.round(lat2py(cn));
  img.extract({ left, top, width: Math.round(lon2px(ce)) - left, height: Math.round(lat2py(cs)) - top });
  console.log(`裁切 ${cw}–${ce}°E ${cs}–${cn}°N`);
}
await img.png({ compressionLevel: 9 }).toFile(OUT);
console.log(`→ ${OUT}`);
