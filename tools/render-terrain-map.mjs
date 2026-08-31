// 汉末战略地图渲染器（地形晕渲版）
//
// 与前一版的根本差别：前一版是「往白纸上盖符号」——不管符号画得多像山，
// 铺满整片就是重复图案。《三国志 11》那类地图之所以一眼是山，靠的是
// **受光**：山脊迎光、背坡入阴，明暗塑出体积。所以本版以真实高程的
// 晕渲为主体，颜色按高程分带，最后叠一层皴法墨迹把写实压回水墨调子。
//
// 数据：AWS Terrain Tiles（terrarium，公有领域）z=8 高程栅格，
//      由 tools/fetch-dem.mjs 预取到 refs/dem-raster.raw。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fbm, hash, noise2 } from "./ink-canvas.mjs";

// ── 输出参数 ────────────────────────────────────────────────────────
const W_DEG = 94, E_DEG = 127, S_DEG = 16, N_DEG = 43;
const PX_PER_DEG = Number(process.env.PPD ?? 140);       // 每经度像素
const OUT = process.env.OUT ?? "public/game/map/han-terrain.png";
const VE = Number(process.env.VE ?? 5.5);                // 垂直夸张，平地才看得出起伏
const AZIMUTH = 315, ALTITUDE = 42;                      // 制图惯例：西北来光

const W = Math.round((E_DEG - W_DEG) * PX_PER_DEG);
const H = Math.round((N_DEG - S_DEG) * PX_PER_DEG);
console.log(`画布 ${W}×${H}  垂直夸张 ${VE}×  光向 ${AZIMUTH}°/${ALTITUDE}°`);

// ── 载入高程栅格并重采样到等距圆柱 ────────────────────────────────
const demMeta = JSON.parse(fs.readFileSync("refs/dem-raster.json", "utf8"));
const demBuf = fs.readFileSync("refs/dem-raster.raw");
const dem = new Int16Array(demBuf.buffer, demBuf.byteOffset, demBuf.length / 2);
const { width: DW, height: DH } = demMeta;

// 栅格是 Web Mercator，输出是等距圆柱，纬度方向需按墨卡托反算取样
const merc = (lat) => { const r = lat * Math.PI / 180; return Math.log(Math.tan(r) + 1 / Math.cos(r)); };
const mercN = merc(demMeta.north), mercS = merc(demMeta.south);

const elev = new Float32Array(W * H);
for (let y = 0; y < H; y += 1) {
  const lat = N_DEG - (y + 0.5) / PX_PER_DEG;
  const fy = ((mercN - merc(lat)) / (mercN - mercS)) * DH;
  const y0 = Math.max(0, Math.min(DH - 2, Math.floor(fy)));
  const wy = fy - y0;
  for (let x = 0; x < W; x += 1) {
    const lon = W_DEG + (x + 0.5) / PX_PER_DEG;
    const fx = ((lon - demMeta.west) / (demMeta.east - demMeta.west)) * DW;
    const x0 = Math.max(0, Math.min(DW - 2, Math.floor(fx)));
    const wx = fx - x0;
    // 双线性，避免重采样出台阶
    const a = dem[y0 * DW + x0], b = dem[y0 * DW + x0 + 1];
    const c = dem[(y0 + 1) * DW + x0], d = dem[(y0 + 1) * DW + x0 + 1];
    elev[y * W + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
  }
}
console.log("高程重采样完成");

// ── 海陆：从图幅边缘 flood fill 区分真海与内陆洼地 ──────────────────
const isWater = new Uint8Array(W * H);
{
  const stack = [];
  const push = (i) => { if (!isWater[i] && elev[i] <= 0) { isWater[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x += 1) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y += 1) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop();
    const y = (i / W) | 0, x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
}

// ── 晕渲 ────────────────────────────────────────────────────────────
// 一像素在地面上的实际跨度随纬度变化；东西向要乘 cos(lat)，否则高纬地形会被拉扁
const azRad = (360 - AZIMUTH + 90) * Math.PI / 180;
const altRad = ALTITUDE * Math.PI / 180;
const shade = new Float32Array(W * H);
const slopeArr = new Float32Array(W * H);
const METER_PER_DEG = 111320;
for (let y = 1; y < H - 1; y += 1) {
  const lat = N_DEG - (y + 0.5) / PX_PER_DEG;
  const mx = (METER_PER_DEG / PX_PER_DEG) * Math.cos(lat * Math.PI / 180);
  const my = METER_PER_DEG / PX_PER_DEG;
  for (let x = 1; x < W - 1; x += 1) {
    const i = y * W + x;
    // Horn 三阶差分，比两点差分抗噪
    const dzdx = ((elev[i - W + 1] + 2 * elev[i + 1] + elev[i + W + 1])
                - (elev[i - W - 1] + 2 * elev[i - 1] + elev[i + W - 1])) / (8 * mx) * VE;
    const dzdy = ((elev[i + W - 1] + 2 * elev[i + W] + elev[i + W + 1])
                - (elev[i - W - 1] + 2 * elev[i - W] + elev[i - W + 1])) / (8 * my) * VE;
    const slope = Math.atan(Math.hypot(dzdx, dzdy));
    const aspect = Math.atan2(dzdy, -dzdx);
    slopeArr[i] = slope;
    shade[i] = Math.max(0, Math.cos(altRad) * Math.cos(slope)
                         + Math.sin(altRad) * Math.sin(slope) * Math.cos(azRad - aspect));
  }
}
console.log("晕渲计算完成");

// ── 高程分带配色：绢本设色的路子，非写实卫星影像 ──────────────────
// [高程, R, G, B]
const LAND_RAMP = [
  [ -10, 206, 206, 158],   // 滨海低地：新绿
  [  80, 197, 201, 145],   // 平原农田
  [ 250, 186, 188, 133],
  [ 600, 182, 172, 124],   // 丘陵：由绿转赭
  [1100, 176, 156, 114],
  [1900, 164, 138, 104],   // 山地：赭石
  [3000, 152, 132, 112],
  [4200, 178, 172, 162],   // 雪线以上转灰白
  [6000, 226, 224, 220],
];
const SEA_RAMP = [
  [    0, 186, 199, 194],  // 近岸：淡青
  [  -40, 170, 189, 189],
  [ -200, 152, 175, 180],
  [-3000, 124, 150, 162],
];
function ramp(table, v) {
  const asc = table[0][0] < table[table.length - 1][0];
  for (let k = 0; k < table.length - 1; k += 1) {
    const [a, ar, ag, ab] = table[k], [b, br, bg, bb] = table[k + 1];
    const within = asc ? (v >= a && v <= b) : (v <= a && v >= b);
    if (within) {
      const t = (v - a) / (b - a || 1);
      return [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t];
    }
  }
  const last = v > table[0][0] === asc ? table[table.length - 1] : table[0];
  return [last[1], last[2], last[3]];
}

const rgb = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    const e = elev[i];
    let r, g, b;
    if (isWater[i]) {
      [r, g, b] = ramp(SEA_RAMP, Math.min(0, e));
      // 水面轻微波光，避免整片死板
      const w = noise2(x / 26, y / 9, 3) * 0.5 + noise2(x / 7, y / 3, 11) * 0.5;
      const k = 0.94 + w * 0.12;
      r *= k; g *= k; b *= k;
    } else {
      [r, g, b] = ramp(LAND_RAMP, e);
      // 晕渲：0.5 为平地基准，暗部压得比亮部深，山体才有分量
      const s = shade[i];
      // 暗部压得比亮部深，山体才有分量；亮部留住不过曝，保持设色而非高光
      const lum = s < 0.5 ? 0.36 + s * 1.30 : 0.71 + (s - 0.5) * 0.56;
      const steep = Math.min(1, slopeArr[i] / 0.85);
      const k = lum * (1 - steep * 0.14);
      r *= k; g *= k; b *= k;
      // 绢黄罩染：把冷灰压掉，整幅统一到绢本调子
      r = r * 0.90 + 232 * 0.10; g = g * 0.90 + 216 * 0.10; b = b * 0.90 + 176 * 0.10;
      const grain = fbm(x / 40, y / 40, 4, 7) * 0.055 + fbm(x / 4, y / 4, 2, 19) * 0.03;
      r *= 1 - grain; g *= 1 - grain; b *= 1 - grain * 0.75;
    }
    const o = i * 3;
    rgb[o] = Math.max(0, Math.min(255, Math.round(r)));
    rgb[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
    rgb[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
}
console.log("配色与晕渲合成完成");

// ── 皴法墨迹：只落在陡坡上，把写实晕渲压回水墨调子 ────────────────
{
  const inkDir = "public/game/ink";
  const manifest = JSON.parse(fs.readFileSync(path.join(inkDir, "manifest.json"), "utf8"));
  const pool = [];
  for (const s of manifest.stamps) {
    const { data, info } = await sharp(path.join(inkDir, s.file)).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels, size = info.width;
    const gray = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i += 1) gray[i] = data[i * ch];
    let sum = 0; for (const v of gray) sum += v;
    if (sum / gray.length < 18) continue;               // 弃掉近乎素绢的图章
    pool.push({ data: gray, size, cun: s.cun });
  }
  const SPAN = Math.round(PX_PER_DEG * 0.42);           // 图章覆盖尺寸
  let placed = 0;
  for (let gy = 0; gy < H; gy += SPAN * 0.62) {
    for (let gx = 0; gx < W; gx += SPAN * 0.62) {
      const cx = Math.round(gx + (hash(gx, gy, 3) - 0.5) * SPAN * 0.5);
      const cy = Math.round(gy + (hash(gx, gy, 5) - 0.5) * SPAN * 0.5);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const i = cy * W + cx;
      if (isWater[i]) continue;
      const steep = Math.min(1, slopeArr[i] / 0.55);
      if (steep < 0.22 || hash(gx, gy, 7) > steep * 0.92) continue;   // 只在陡处施皴
      const tex = pool[Math.floor(hash(gx, gy, 11) * pool.length) % pool.length];
      if (!tex) continue;
      const scale = (SPAN * (0.8 + hash(gx, gy, 13) * 0.6)) / tex.size;
      const angle = Math.atan2(
        elev[Math.min(H - 2, cy + 1) * W + cx] - elev[Math.max(1, cy - 1) * W + cx],
        elev[cy * W + Math.min(W - 2, cx + 1)] - elev[cy * W + Math.max(1, cx - 1)],
      ) + Math.PI / 2;                                   // 顺等高线走笔
      const half = (tex.size * scale) / 2;
      const cos = Math.cos(-angle), sin = Math.sin(-angle);
      const strength = 0.46 * steep * (0.6 + hash(gx, gy, 17) * 0.7);
      for (let y = Math.max(0, cy - half | 0); y <= Math.min(H - 1, cy + half); y += 1) {
        for (let x = Math.max(0, cx - half | 0); x <= Math.min(W - 1, cx + half); x += 1) {
          const dx = x - cx, dy = y - cy;
          const rr = Math.hypot(dx, dy) / half;
          if (rr >= 1) continue;
          const lx = (dx * cos - dy * sin) / scale + tex.size / 2;
          const ly = (dx * sin + dy * cos) / scale + tex.size / 2;
          if (lx < 0 || ly < 0 || lx >= tex.size || ly >= tex.size) continue;
          const v = tex.data[(ly | 0) * tex.size + (lx | 0)] / 255;
          const fade = 0.5 * (1 + Math.cos(Math.PI * rr));
          const localSteep = Math.min(1, slopeArr[y * W + x] / 0.55);
          const a = v * strength * fade * localSteep;
          if (a <= 0.004 || isWater[y * W + x]) continue;
          const o = (y * W + x) * 3;
          rgb[o]     = Math.round(rgb[o]     * (1 - a) + 58 * a);
          rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + 50 * a);
          rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + 40 * a);
        }
      }
      placed += 1;
    }
  }
  console.log(`施皴 ${placed} 处`);
}

// ── 海岸线 ──────────────────────────────────────────────────────────
for (let y = 1; y < H - 1; y += 1) {
  for (let x = 1; x < W - 1; x += 1) {
    const i = y * W + x;
    if (isWater[i]) continue;
    if (!(isWater[i - 1] || isWater[i + 1] || isWater[i - W] || isWater[i + W])) continue;
    const a = 0.34 + fbm(x / 8, y / 8, 3, 61) * 0.42;
    for (let k = 0; k <= 1; k += 1) {
      const o = ((y) * W + x) * 3;
      rgb[o]     = Math.round(rgb[o]     * (1 - a) + 62 * a);
      rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + 74 * a);
      rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + 78 * a);
    }
  }
}


// ══ 图上要素：势力疆域、水系、城池、关隘、注记 ══════════════════════
const lon2px = (lon) => ((lon - W_DEG) / (E_DEG - W_DEG)) * W;
const lat2py = (lat) => ((N_DEG - lat) / (N_DEG - S_DEG)) * H;
const readJSON = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);

const commanderies = readJSON("lib/game/data/commanderies.json") ?? [];
const scenario = readJSON("lib/game/data/scenario-194.json");
const hydro = readJSON("lib/game/data/hydrology.json");
const nodes = readJSON("lib/game/data/strategic-nodes.json");

// ── 势力疆域：按郡治做最近邻划分，只染陆地，且限定影响半径 ────────────
if (scenario && process.env.FACTIONS !== "0") {
  const hex = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h ?? "");
    if (!m) return [140, 130, 110];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const colorOf = new Map(scenario.factions.map((f) => [f.id, hex(f.color)]));
  const seats = commanderies
    .map((c) => {
      const own = scenario.ownership[c.name];
      if (!own) return null;
      return { x: lon2px(c.longitude), y: lat2py(c.latitude), faction: own.factionId,
               col: colorOf.get(own.factionId) ?? [140, 130, 110], control: own.control };
    })
    .filter(Boolean);

  // 势力疆域用「地形加权的最短路」而非直线最近邻：
  // 纯欧氏 Voronoi 的边界是垂直平分线，割出来一块块像现代行政区划；
  // 而真实疆界沿山川走。这里给每像素一个通行代价——坡越陡代价越高、
  // 水面近乎不可通行——再做带标签传播的多遍 chamfer，
  // 边界便自然落在山脊与大河上。
  const cost = new Float32Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    if (isWater[i]) { cost[i] = 6.0; continue; }            // 水面难越，但不完全封死
    const st = Math.min(1, slopeArr[i] / 0.7);
    cost[i] = 1 + st * st * 5.5;                            // 陡坡代价陡增
  }
  const INF = 1e9;
  const dist = new Float32Array(W * H).fill(INF);
  const owner = new Int32Array(W * H).fill(-1);
  for (let k = 0; k < seats.length; k += 1) {
    const x = Math.round(seats[k].x), y = Math.round(seats[k].y);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    dist[y * W + x] = 0; owner[y * W + x] = k;
  }
  const D2 = 1.4142136;
  const relax = (i, j, w) => {
    const d = dist[j] + w * cost[i];
    if (d < dist[i] - 1e-6) { dist[i] = d; owner[i] = owner[j]; return true; }
    return false;
  };
  // 代价随位置变化时单次两遍不收敛，来回扫到稳定为止
  for (let pass = 0; pass < 5; pass += 1) {
    let changed = 0;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (x > 0 && relax(i, i - 1, 1)) changed += 1;
      if (y > 0 && relax(i, i - W, 1)) changed += 1;
      if (x > 0 && y > 0 && relax(i, i - W - 1, D2)) changed += 1;
      if (x < W - 1 && y > 0 && relax(i, i - W + 1, D2)) changed += 1;
    }
    for (let y = H - 1; y >= 0; y -= 1) for (let x = W - 1; x >= 0; x -= 1) {
      const i = y * W + x;
      if (x < W - 1 && relax(i, i + 1, 1)) changed += 1;
      if (y < H - 1 && relax(i, i + W, 1)) changed += 1;
      if (x < W - 1 && y < H - 1 && relax(i, i + W + 1, D2)) changed += 1;
      if (x > 0 && y < H - 1 && relax(i, i + W - 1, D2)) changed += 1;
    }
    if (changed === 0) { console.log(`  疆域传播第 ${pass + 1} 遍收敛`); break; }
  }
  const REACH = PX_PER_DEG * 4.2;             // 代价距离上限：超出即视为化外
  let tinted = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (isWater[i]) continue;
      const k = owner[i];
      if (k < 0 || dist[i] > REACH) continue;
      const seat = seats[k];
      // 名义控制染得更淡；边缘随距离渐隐，不出硬边
      const base = seat.control === "firm" ? 0.22 : seat.control === "contested" ? 0.16 : 0.10;
      const fade = Math.min(1, (REACH - dist[i]) / (REACH * 0.40));
      const a = base * fade * (0.82 + fbm(x / 55, y / 55, 3, 91) * 0.36);
      const o = i * 3;
      rgb[o]     = Math.round(rgb[o]     * (1 - a) + seat.col[0] * a);
      rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + seat.col[1] * a);
      rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + seat.col[2] * a);
      tinted += 1;
    }
  }
  // 势力交界：只在归属于不同「势力」（而非不同郡）处描线，同势力内部不画
  const factionOf = seats.map((s) => s.faction);
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      if (isWater[i] || owner[i] < 0 || dist[i] > REACH) continue;
      const f = factionOf[owner[i]];
      const r1 = owner[i + 1], r2 = owner[i + W];
      const diff = (r1 >= 0 && factionOf[r1] !== f) || (r2 >= 0 && factionOf[r2] !== f);
      if (!diff) continue;
      const a = 0.42 * (0.6 + fbm(x / 9, y / 9, 2, 47) * 0.8);
      const c = seats[owner[i]].col;
      const o = i * 3;
      rgb[o]     = Math.round(rgb[o]     * (1 - a) + c[0] * 0.45 * a);
      rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + c[1] * 0.45 * a);
      rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + c[2] * 0.45 * a);
    }
  }
  console.log(`势力染色 ${seats.length} 郡治，覆盖 ${(tinted / (W * H) * 100).toFixed(0)}% 画面`);
}

// ── 水系：主干粗、支流细，下游渐宽 ────────────────────────────────────
if (hydro && process.env.RIVERS !== "0") {
  const WEIGHT = { 黄河: 1.0, 长江: 1.0, 淮水: 0.62, 汉水: 0.62, 渭水: 0.55, 湘水: 0.45, 赣水: 0.45, 泗水: 0.42 };
  const paint = (x, y, a) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
    const o = (yi * W + xi) * 3;
    rgb[o]     = Math.round(rgb[o]     * (1 - a) + 104 * a);
    rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + 136 * a);
    rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + 148 * a);
  };
  let segs = 0;
  for (const river of hydro.rivers ?? []) {
    const w0 = WEIGHT[river.name] ?? 0.34;
    const pts = river.points ?? [];
    for (let i = 1; i < pts.length; i += 1) {
      const ax = lon2px(pts[i - 1][0]), ay = lat2py(pts[i - 1][1]);
      const bx = lon2px(pts[i][0]), by = lat2py(pts[i][1]);
      const len = Math.hypot(bx - ax, by - ay);
      if (!Number.isFinite(len) || len > W * 0.35) continue;
      const half = w0 * PX_PER_DEG * 0.020 * (0.55 + (i / pts.length) * 0.75);
      const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
      for (let t = 0; t <= len; t += 0.5) {
        const u = t / (len || 1);
        const x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
        const press = 0.72 + fbm(x / 8, y / 8, 2, 83) * 0.5;
        for (let o2 = -half; o2 <= half; o2 += 0.4) {
          paint(x + nx * o2, y + ny * o2, (1 - Math.abs(o2) / (half + 0.5)) * press * 0.5);
        }
      }
      segs += 1;
    }
  }
  console.log(`水系 ${hydro.rivers.length} 条 / ${segs} 段`);
}

// ── 底图到此为止：不烤任何文字与符号 ─────────────────────────────────
// 标注一旦烤进栅格，就在所有缩放级别固定大小、固定密度——洛阳周边八个关津
// 挤在 1.5 经度内必然重叠，且放大也不会变松。《三国志》系列同样把地名放在
// UI 层。这里只导出标注数据，由前端按视口实时排布与避让。
await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
  .png({ compressionLevel: 9 }).toFile(OUT);

{
  const labels = [];
  for (const c of commanderies) {
    const own = scenario?.ownership?.[c.name];
    const pop = c.population ?? 0;
    labels.push({
      id: c.name, kind: "commandery", name: c.name.replace(/[郡国]$/, ""), fullName: c.name,
      lon: c.longitude, lat: c.latitude, zhou: c.zhou, seat: c.seat,
      modernReference: c.modernReference, counties: c.counties, population: c.population,
      // rank 决定在哪一级缩放开始显示：0 最先出现
      rank: pop > 1_500_000 ? 0 : pop > 800_000 ? 1 : pop > 300_000 ? 2 : 3,
      factionId: own?.factionId ?? null, factionName: own?.factionName ?? null,
      control: own?.control ?? null, basis: own?.basis ?? null,
    });
  }
  for (const n of nodes?.nodes ?? []) {
    labels.push({
      id: n.id, kind: n.kind, name: n.name, fullName: n.name,
      lon: n.longitude, lat: n.latitude,
      modernReference: n.modernReference, note: n.historicalNote,
      nearestCommandery: n.nearestCommandery, certainty: n.certainty,
      // 关隘比渡口重要，先显示
      rank: n.kind === "gate" ? 2 : n.kind === "pass" ? 3 : n.kind === "depot" ? 3 : 4,
    });
  }
  const zhouPts = {};
  for (const c of commanderies) (zhouPts[c.zhou] ??= []).push([c.longitude, c.latitude]);
  const zhou = Object.entries(zhouPts).map(([name, pts]) => ({
    name,
    lon: pts.reduce((a, p) => a + p[0], 0) / pts.length,
    lat: pts.reduce((a, p) => a + p[1], 0) / pts.length,
  }));

  const out = {
    geo: { west: W_DEG, east: E_DEG, south: S_DEG, north: N_DEG },
    baseWidth: W, baseHeight: H,
    factions: (scenario?.factions ?? []).map((f) => ({ id: f.id, name: f.name, color: f.color, seat: f.seat, situation: f.situation })),
    zhou, labels,
  };
  fs.writeFileSync("public/game/data/map-labels.json", JSON.stringify(out));
  const byRank = {};
  for (const l of labels) byRank[l.rank] = (byRank[l.rank] ?? 0) + 1;
  console.log(`标注数据 ${labels.length} 条（分级 ${Object.entries(byRank).map(([k, v]) => `${k}:${v}`).join(" ")}）+ ${zhou.length} 州 → public/game/data/map-labels.json`);
}
console.log(`→ ${OUT}`);

