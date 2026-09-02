// 底图的量化验收。
//
// 美术改动最容易「改了觉得更好，实际更糟」——这一轮的图章层就是典型：
// 看着像在施皴，实测方向相干度反而低于完全不施皴（0.226 vs 0.259）。
// 所以这几项要能机器量，而不是靠眼睛记忆。
//
// 用法：node tools/audit-ink.mjs [图片路径]
import fs from "node:fs";
import sharp from "sharp";

const SRC = process.argv[2] ?? "public/game/map/play-base.webp";
if (!fs.existsSync(SRC)) {
  console.error(`缺少 ${SRC}，先跑 npm run map:base && npm run map:play`);
  process.exit(1);
}

// 「着墨」的门槛取 150/255，不是「比纸色暗一点」。
// 本图的淡彩（汁绿、赭石）本来就把大片陆地压到 128–204，若按「暗 40 级」
// 算着墨，横断山一块会量出 95%，量的是「不是纸色」而不是「有墨」。
// 实测该块灰阶分布：<196 占 95%，<158 占 44%，<140 占 26% —— 中间那一大坨
// 是设色不是墨。焦墨本身是 45/255，纸是 236，淡彩落在 180 上下，取 150 分界。
const INK_T = 150 / 255;
const PAPER = 236 / 255;
const BLANK_T = 24 / 255;                     // 距纸色多近算未着笔

const { data, info } = await sharp(SRC).greyscale().raw()
  .toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const g = new Float32Array(W * H);
for (let i = 0; i < W * H; i += 1) g[i] = data[i] / 255;

// 海陆掩膜取自高程栅格，不从像素颜色猜。
// 按颜色判（蓝多于红）只认得出近岸：远海已经渐入纸色，b 反而小于 r，
// 会被判成陆地——实测那样量出「陆 94% 海 6%」，把整个东海算进了陆地，
// 留白率与着墨率两项都失真。
const grid = JSON.parse(fs.readFileSync("lib/game/data/terrain-grid.json", "utf8"));
const { cols: GC, rows: GR } = grid.meta;
const elev = grid.elevation;
const isSea = new Uint8Array(W * H);
for (let y = 0; y < H; y += 1) {
  const gy = Math.min(GR - 1, ((y / H) * GR) | 0);
  for (let x = 0; x < W; x += 1) {
    const gx = Math.min(GC - 1, ((x / W) * GC) | 0);
    if (elev[gy * GC + gx] <= 0) isSea[y * W + x] = 1;
  }
}

function boxBlur(src, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const cl = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  const win = r * 2 + 1;
  for (let y = 0; y < H; y += 1) {
    let acc = 0;
    for (let x = -r; x <= r; x += 1) acc += src[y * W + cl(x, W - 1)];
    for (let x = 0; x < W; x += 1) {
      tmp[y * W + x] = acc / win;
      acc -= src[y * W + cl(x - r, W - 1)];
      acc += src[y * W + cl(x + r + 1, W - 1)];
    }
  }
  for (let x = 0; x < W; x += 1) {
    let acc = 0;
    for (let y = -r; y <= r; y += 1) acc += tmp[cl(y, H - 1) * W + x];
    for (let y = 0; y < H; y += 1) {
      out[y * W + x] = acc / win;
      acc -= tmp[cl(y - r, H - 1) * W + x];
      acc += tmp[cl(y + r + 1, H - 1) * W + x];
    }
  }
  return out;
}

// ── 结构张量相干度：方向一致性。笔阵高，圆噪点盘低 ─────────────────
function coherence(sigma) {
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      gx[i] = (g[i + 1] - g[i - 1]) / 2;
      gy[i] = (g[i + W] - g[i - W]) / 2;
    }
  }
  const xx = new Float32Array(W * H), yy = new Float32Array(W * H), xy = new Float32Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    xx[i] = gx[i] * gx[i]; yy[i] = gy[i] * gy[i]; xy[i] = gx[i] * gy[i];
  }
  const r = Math.max(1, Math.round(sigma));
  const jxx = boxBlur(xx, r), jyy = boxBlur(yy, r), jxy = boxBlur(xy, r);
  let sum = 0, n = 0;
  for (let i = 0; i < W * H; i += 1) {
    if (isSea[i]) continue;                     // 海面的波纹不参与评笔
    const tr = jxx[i] + jyy[i];
    if (tr < 2e-6) continue;                    // 无梯度处不计
    const d = Math.sqrt((jxx[i] - jyy[i]) ** 2 + 4 * jxy[i] * jxy[i]);
    sum += d / tr; n += 1;
  }
  return n ? sum / n : 0;
}

let blank = 0, inked = 0, land = 0, seaInk = 0, sea = 0;
for (let i = 0; i < W * H; i += 1) {
  if (isSea[i]) { sea += 1; if (g[i] < INK_T) seaInk += 1; continue; }
  land += 1;
  if (Math.abs(g[i] - PAPER) < BLANK_T) blank += 1;
  if (g[i] < INK_T) inked += 1;
}

// 最脏的一块：256 见方里着墨比例的上限。防某个区域被墨糊死
let worst = 0, worstAt = "";
const B = 256;
for (let by = 0; by + B <= H; by += B) {
  for (let bx = 0; bx + B <= W; bx += B) {
    let d = 0, n = 0;
    for (let y = by; y < by + B; y += 2) {
      for (let x = bx; x < bx + B; x += 2) {
        const i = y * W + x;
        if (isSea[i]) continue;
        n += 1;
        if (g[i] < INK_T) d += 1;
      }
    }
    if (n < 2000) continue;                     // 几乎全是海的块不算
    const frac = d / n;
    if (frac > worst) { worst = frac; worstAt = `(${bx},${by})`; }
  }
}

// 墨的重心：东部（对局主战场）该比西部有戏。
// 一百零五个郡国全在东部，若墨都压在横断—青藏，视觉重心与信息重心就反了
const split = Math.round(W * 0.42);
let eInk = 0, eLand = 0, wInk = 0, wLand = 0;
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    if (isSea[i]) continue;
    if (x >= split) { eLand += 1; if (g[i] < INK_T) eInk += 1; }
    else { wLand += 1; if (g[i] < INK_T) wInk += 1; }
  }
}
const eastRate = eLand ? eInk / eLand : 0;
const westRate = wLand ? wInk / wLand : 0;

const rows = [
  ["方向相干度 σ=6", coherence(6), 0.22, "≥", "笔阵一致性。圆噪点盘会把它拉低"],
  ["陆地留白率", blank / land, 0.18, "≥", "全幅铺满即分层设色地形图"],
  ["陆地着墨率", inked / land, 0.14, "≤", `墨压过纸即失掉舆图的透气（<${(INK_T * 255) | 0}）`],
  ["陆地着墨率下限", inked / land, 0.015, "≥", "太少则山没有形"],
  ["最脏块着墨比", worst, 0.55, "≤", `最脏处在 ${worstAt}`],
  ["海面着墨率", seaInk / Math.max(1, sea), 0.02, "≤", "海应留白，波纹只在近岸"],
  ["西部/东部墨比", westRate / Math.max(1e-6, eastRate), 6.0, "≤",
    `东 ${(eastRate * 100).toFixed(1)}% / 西 ${(westRate * 100).toFixed(1)}%。`
    + "郡国全在东部，墨的重心不该压在横断"],
];

console.log(`${SRC}  ${W}×${H}   陆 ${((land / (W * H)) * 100).toFixed(0)}% 海 ${((sea / (W * H)) * 100).toFixed(0)}%\n`);
let bad = 0;
for (const [name, v, lim, dir, note] of rows) {
  const ok = dir === "≥" ? v >= lim : v <= lim;
  if (!ok) bad += 1;
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(16)} ${v.toFixed(3)}  （${dir} ${lim}）  ${note}`);
}
console.log(`\n${bad ? `✗ ${bad} 项未达标` : "✓ 全部达标"}`);
process.exit(bad ? 1 : 0);
