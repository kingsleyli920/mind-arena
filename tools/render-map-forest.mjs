// 舆图的第三层：林。
//
// 起因是一句反问：「森林是森林……其他三国游戏呢？」查下来《三国志11》的
// 地形（平原/森林/砂地/水面）是**游戏设计的地形**而非卫星数据，而它的画法
// 恰恰是水墨——所以「水墨」与「山是山、林是林」从来不是二选一。
// 我此前答成了二选一，那是错的。
//
// 数据来自 lib/game/data/vegetation-grid.json（Natural Earth II，公有领域）。
// 这一层只画林与疏林：草原与荒漠不画笔触——空着本身就是「这里没有林」，
// 再画一层点子只会把图弄脏。
//
// 与海波云气同一条管线：离线出一张透明 PNG，运行时多贴一层。
// 反复运行结果一致：无网络、无时间依赖，随机数由固定种子驱动。
import fs from "node:fs";
import sharp from "sharp";
import { rng, strokeInk, WPROF, APROF, LPROF_SIDE } from "./brush.mjs";

const W_DEG = 94, E_DEG = 127, S_DEG = 16, N_DEG = 43;
const PPD = Number(process.env.PPD ?? 110);
const W = Math.round((E_DEG - W_DEG) * PPD);
const H = Math.round((N_DEG - S_DEG) * PPD);
const OUT = process.env.OUT ?? "public/game/map/forest.webp";

const veg = JSON.parse(fs.readFileSync("lib/game/data/vegetation-grid.json", "utf8"));
const grid = Buffer.from(veg.grid, "base64");
const { west, north, cellSize: CELL, cols, rows } = veg.meta;
const classAt = (lon, lat) => {
  const c = Math.floor((lon - west) / CELL), r = Math.floor((north - lat) / CELL);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return 0;
  return grid[r * cols + c];
};
// 山地不画林：那一带底图已经是皴笔，再叠树点就成一团黑。
// 林画在能走人的地方——那也正是它在游戏里的意义（林地利步卒、碍骑兵）
const terrain = JSON.parse(fs.readFileSync("lib/game/data/terrain-grid.json", "utf8"));
const terrAt = (lon, lat) => {
  const c = Math.floor((lon - west) / CELL), r = Math.floor((north - lat) / CELL);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return "s";
  return terrain.terrain[r * cols + c];
};

const D = new Float32Array(W * H);
const rnd = rng(19940815);

/**
 * 一丛树：两三笔向上的短弧，外加一点树冠的横笔。
 *
 * 不画成对称的「树」形——传世舆图上的林是**成片的点厾**，一丛只是几笔浓淡，
 * 远看成林近看是笔。画得太像一棵树，一百万棵就成了壁纸
 */
function clump(cx, cy, s, seed) {
  const n = 2 + Math.floor(rnd() * 2);
  for (let k = 0; k < n; k += 1) {
    const dx = (rnd() - 0.5) * s * 1.1;
    const h = s * (0.85 + rnd() * 0.5);
    const lean = (rnd() - 0.5) * 0.3;
    // 主干：自下而上一笔，起笔重收笔轻
    strokeInk(D, W, H, [
      { x: cx + dx, y: cy },
      { x: cx + dx + lean * h * 0.4, y: cy - h * 0.55 },
      { x: cx + dx + lean * h, y: cy - h },
    ], {
      wMax: Math.max(0.9, s * 0.34), wProf: WPROF.dingtou, aProf: APROF.dry, lProf: LPROF_SIDE,
      A0: 0.42 + rnd() * 0.22, fwTarget: 0.2, kd: 0.24, edgeJit: 0.18,
      grainAmp: 0.36, seed: (seed * 7919 + k * 131) % 100000,
    });
  }
}

console.log(`画布 ${W}×${H}　落笔…`);
let clumps = 0;
// 步长随分辨率缩放。林密、疏林稀——两者用同一支笔，只差密度与浓度
const STEP = Math.max(4, Math.round(PPD / 18));
for (let y = STEP; y < H - STEP; y += STEP) {
  const lat = N_DEG - (y + 0.5) / PPD;
  for (let x = STEP; x < W - STEP; x += STEP) {
    const lon = W_DEG + (x + 0.5) / PPD;
    const cls = classAt(lon, lat);
    if (cls !== 1 && cls !== 2) continue;              // 只画林与疏林
    const t = terrAt(lon, lat);
    if (t === "s" || t === "l") continue;              // 水上不长树
    if (t === "m" || t === "g") continue;              // 山地高原留给皴笔
    // 林 65% 的格子落笔，疏林 22%——密度差本身就是「林」与「疏林」的分别
    const p = cls === 1 ? 0.65 : 0.22;
    if (rnd() > p) continue;
    const jx = (rnd() - 0.5) * STEP * 0.9, jy = (rnd() - 0.5) * STEP * 0.9;
    clump(x + jx, y + jy, STEP * (0.5 + rnd() * 0.3), clumps);
    clumps += 1;
  }
}
console.log(`林 ${clumps} 丛`);

// 墨深转 alpha 与底图、符号、海波同一条曲线，几层的黑才是同一种黑。
// 林压得比海波还淡：它是底纹里最底下那一层，上面还要压城印、道路、疆界
const rgba = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i += 1) {
  const a = Math.min(0.5, 1 - Math.exp(-1.05 * D[i]));
  rgba[i * 4] = 58; rgba[i * 4 + 1] = 72; rgba[i * 4 + 2] = 54;   // 林墨带一点青绿
  rgba[i * 4 + 3] = Math.round(a * 255);
}
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .webp({ quality: 78, alphaQuality: 76 }).toFile(OUT);
console.log(`→ ${OUT}　${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
