// 舆图的第二层：海波与云气。
//
// 底图把陆地画得很足（晕渲 + 皴），海却是一片平色——传世舆图不这么画，
// 海上要有波纹，边角要有云气，那是「这是一幅画」而不是「这是一张数据图」的
// 全部分别所在。这一层单出一张透明 PNG，铺在底图与疆域之间。
//
// 为什么离线出而不在浏览器里画：波纹要跟着海岸走、要避开陆地，
// 那要读高程；而高程栅格是 283MB，不可能塞进浏览器。离线出一张 200KB 的图，
// 运行时只是多贴一层。
//
// 数据：AWS Terrain Tiles（terrarium，公有领域）z=9 高程栅格，
//      与 tools/render-terrain-map.mjs 同一份 refs/dem-raster.raw。
// 反复运行结果一致：无网络、无时间依赖，随机数由固定种子驱动。
import fs from "node:fs";
import sharp from "sharp";
import { rng, arcSpine, strokeInk, WPROF, APROF, LPROF_SIDE } from "./brush.mjs";

const W_DEG = 94, E_DEG = 127, S_DEG = 16, N_DEG = 43;
const PPD = Number(process.env.PPD ?? 55);
const W = Math.round((E_DEG - W_DEG) * PPD);
const H = Math.round((N_DEG - S_DEG) * PPD);
const OUT = process.env.OUT ?? "public/game/map/decor.webp";

// ── 高程：只用来判「这里是不是海」 ──────────────────────────────────
const meta = JSON.parse(fs.readFileSync("refs/dem-raster.json", "utf8"));
const buf = fs.readFileSync("refs/dem-raster.raw");
const dem = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const merc = (lat) => { const r = (lat * Math.PI) / 180; return Math.log(Math.tan(r) + 1 / Math.cos(r)); };
const mercN = merc(meta.north), mercS = merc(meta.south);
/** (lon,lat) 处的高程。海是 ≤0 */
function elevAt(lon, lat) {
  const fx = ((lon - meta.west) / (meta.east - meta.west)) * meta.width;
  const fy = ((mercN - merc(lat)) / (mercN - mercS)) * meta.height;
  const x = Math.max(0, Math.min(meta.width - 1, Math.round(fx)));
  const y = Math.max(0, Math.min(meta.height - 1, Math.round(fy)));
  return dem[y * meta.width + x];
}
const px2lon = (x) => W_DEG + (x + 0.5) / PPD;
const px2lat = (y) => N_DEG - (y + 0.5) / PPD;

// ── 海面掩膜：离岸越远波纹越淡，贴着岸的一圈不画（那里已有海岸线） ──
console.log(`画布 ${W}×${H}　判海中…`);
const sea = new Uint8Array(W * H);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) sea[y * W + x] = elevAt(px2lon(x), px2lat(y)) <= 0 ? 1 : 0;
}
/** 到最近陆地的距离（格），两遍扫描的粗略 chamfer */
const dist = new Float32Array(W * H).fill(1e9);
for (let i = 0; i < W * H; i += 1) if (!sea[i]) dist[i] = 0;
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
    if (y > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1);
    if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - W - 1] + 1.41);
  }
}
for (let y = H - 1; y >= 0; y -= 1) {
  for (let x = W - 1; x >= 0; x -= 1) {
    const i = y * W + x;
    if (x < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
    if (y < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1);
    if (x < W - 1 && y < H - 1) dist[i] = Math.min(dist[i], dist[i + W + 1] + 1.41);
  }
}

// ── 落笔 ────────────────────────────────────────────────────────────
const D = new Float32Array(W * H);
const rnd = rng(20260906);

/** 半圆弧的点列。鱼鳞纹要的是「◠」，用带弧垂的直笔画出来是个逗号 */
const capPts = (cx, cy, r, tilt, n = 14) =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = Math.PI + (Math.PI * k) / n;
    const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.62;
    return { x: cx + x * Math.cos(tilt) - y * Math.sin(tilt),
             y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) };
  });

/**
 * 海波：鱼鳞纹。一枚是一道「◠」，成排错开半格铺开，外圈再套一道小的。
 *
 * 第一版用 arcSpine 画短弧——那是「沿某方向带弧垂地走一段」，出来是一片
 * 逗号，远看像海上撒了碎屑。鱼鳞纹的形要靠真圆弧
 */
let waves = 0;
const STEP = Math.max(9, Math.round(PPD / 5.4));   // 波纹间距，随分辨率缩放
for (let y = 8; y < H - 8; y += STEP) {
  // 每行错开半格，成排而不成行——齐整了就是壁纸
  const off = (Math.floor(y / STEP) % 2) * (STEP * 0.52);
  for (let x = 8; x < W - 8; x += STEP * 1.05) {
    const cx = x + off + (rnd() - 0.5) * STEP * 0.18;
    const cy = y + (rnd() - 0.5) * STEP * 0.18;
    const i = Math.round(cy) * W + Math.round(cx);
    if (i < 0 || i >= W * H || !sea[i]) continue;
    // 近岸不画：那儿已有海岸线，再压波纹就糊了。远海渐次加密
    const d = dist[i];
    if (d < STEP * 0.45) continue;
    const near = Math.min(1, (d - STEP * 0.45) / (STEP * 2.2));
    if (rnd() > 0.55 + near * 0.4) continue;
    const r = STEP * (0.4 + rnd() * 0.12);
    const tilt = (rnd() - 0.5) * 0.24;
    strokeInk(D, W, H, capPts(cx, cy, r, tilt), {
      wMax: Math.max(1.5, STEP * 0.13), wProf: WPROF.yudian, aProf: APROF.dry, lProf: LPROF_SIDE,
      A0: 0.5 + near * 0.28, fwTarget: 0.22, kd: 0.22, edgeJit: 0.16,
      grainAmp: 0.34, seed: (waves * 7919) % 100000,
    });
    // 套一道小的：鱼鳞纹的层次全在这一笔上
    if (rnd() < 0.7) {
      strokeInk(D, W, H, capPts(cx, cy + r * 0.16, r * 0.55, tilt), {
        wMax: Math.max(1.3, STEP * 0.11), wProf: WPROF.yudian, aProf: APROF.dry, lProf: LPROF_SIDE,
        A0: 0.38 + near * 0.22, fwTarget: 0.28, kd: 0.22, edgeJit: 0.16,
        grainAmp: 0.34, seed: (waves * 104729) % 100000,
      });
    }
    waves += 1;
  }
}
console.log(`海波 ${waves} 组`);

/**
 * 云气：只在四角与图外的高处出。它不是装饰性的留白填充——
 * 舆图的云气是用来「收边」的，让画心与装裱之间有个过渡
 */
let clouds = 0;
for (let k = 0; k < 220; k += 1) {
  const cx = rnd() * W, cy = rnd() * H;
  // 只在边缘一带：离画心越近越不出云
  const ex = Math.min(cx, W - cx) / W, ey = Math.min(cy, H - cy) / H;
  const edge = Math.min(ex, ey);
  if (edge > 0.13 || rnd() > 0.5) continue;
  const i = Math.round(cy) * W + Math.round(cx);
  if (i < 0 || i >= W * H) continue;
  // 云出在海上或极高处（雪线之上），不压在耕地与郡治上
  const e = elevAt(px2lon(cx), px2lat(cy));
  if (!(e <= 0 || e > 3600)) continue;
  const len = (PPD / 55) * (26 + rnd() * 40);
  for (let j = 0; j < 3; j += 1) {
    strokeInk(D, W, H, arcSpine(cx, cy + j * 5.5 * (PPD / 55), (rnd() - 0.5) * 0.1, len * (1 - j * 0.18),
      0.14 * (j % 2 ? -1 : 1), 4, rnd), {
      wMax: 2.1 * (PPD / 55), wProf: WPROF.pima, aProf: APROF.dry, lProf: LPROF_SIDE,
      A0: 0.15, fwTarget: 0.55, kd: 0.4, edgeJit: 0.3, grainAmp: 0.45,
      seed: (k * 31 + j) % 100000,
    });
  }
  clouds += 1;
}
console.log(`云气 ${clouds} 处`);

// ── 出图 ────────────────────────────────────────────────────────────
// 墨深转 alpha 与底图、符号同一条曲线，三层的黑才是同一种黑
const rgba = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i += 1) {
  const a = Math.min(0.62, 1 - Math.exp(-1.15 * D[i]));    // 封顶：它是底纹不是主角
  rgba[i * 4] = 62; rgba[i * 4 + 1] = 74; rgba[i * 4 + 2] = 86;   // 海墨带一点青
  rgba[i * 4 + 3] = Math.round(a * 255);
}
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .webp({ quality: 76, alphaQuality: 74 }).toFile(OUT);
console.log(`→ ${OUT}　${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
