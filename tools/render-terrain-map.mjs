// 汉末战略地图渲染器（地形晕渲版）
//
// 与前一版的根本差别：前一版是「往白纸上盖符号」——不管符号画得多像山，
// 铺满整片就是重复图案。《三国志 11》那类地图之所以一眼是山，靠的是
// **受光**：山脊迎光、背坡入阴，明暗塑出体积。所以本版以真实高程的
// 走的是传统舆图的路子：纸色作底，地势用墨（染 + 勾脊 + 皴）表现，
// 颜色只作极淡的罩染，高处留白。不用高程分带配色——把海拔映射成一条
// 从绿到赭到灰白的连续色带，那条色带本身就在说「这是一张地理图」。
//
// 数据：AWS Terrain Tiles（terrarium，公有领域）z=8 高程栅格，
//      由 tools/fetch-dem.mjs 预取到 refs/dem-raster.raw。
import fs from "node:fs";
import sharp from "sharp";
import { fbm, hash } from "./ink-canvas.mjs";
import {
  rng, gauss, arcSpine, strokeInk, WPROF, APROF,
  LPROF_CENTER, LPROF_SIDE, NEXT_CENTER,
} from "./brush.mjs";

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

// ── 地势平滑：抹掉 DEM 微地形，只留山脉大势 ────────────────────────
// 这是整幅图观感的分水岭。照 DEM 逐像素晕渲，出来必然是卫星地形图——
// 微地形的细密纹理正是「地理教科书」观感的来源。传统舆图只画山脉走势。
// 但平滑过头也不行：半径太大则秦岭化为几块脏渍，山没了。
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const win = r * 2 + 1;
  const cl = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let y = 0; y < h; y += 1) {
    let acc = 0;
    for (let x = -r; x <= r; x += 1) acc += src[y * w + cl(x, w - 1)];
    for (let x = 0; x < w; x += 1) {
      tmp[y * w + x] = acc / win;
      acc -= src[y * w + cl(x - r, w - 1)];
      acc += src[y * w + cl(x + r + 1, w - 1)];
    }
  }
  for (let x = 0; x < w; x += 1) {
    let acc = 0;
    for (let y = -r; y <= r; y += 1) acc += tmp[cl(y, h - 1) * w + x];
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = acc / win;
      acc -= tmp[cl(y - r, h - 1) * w + x];
      acc += tmp[cl(y + r + 1, h - 1) * w + x];
    }
  }
  return out;
}
const BLUR_R = Math.max(1, Math.round(PX_PER_DEG * 0.055));
const relief = boxBlur(elev, W, H, BLUR_R);
const coarse = boxBlur(boxBlur(relief, W, H, BLUR_R * 3), W, H, BLUR_R * 3);
console.log(`地势平滑 r=${BLUR_R}px`);

// ── 离岸距离场：网巾水的波纹要平行于岸线 ──────────────────────────
// chamfer(3,4) 两遍扫描近似欧氏距离。四邻 BFS 给的是曼哈顿距离，
// 等距线会压出菱形折角，波纹看着像折纸而不像水。
const seaDist = new Float32Array(W * H);
{
  const INF = 1e9;
  for (let i = 0; i < W * H; i += 1) seaDist[i] = isWater[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? INF : seaDist[y * W + x]);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (seaDist[i] === 0) continue;
      seaDist[i] = Math.min(seaDist[i], at(x - 1, y) + 3, at(x, y - 1) + 3,
                            at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = H - 1; y >= 0; y -= 1) {
    for (let x = W - 1; x >= 0; x -= 1) {
      const i = y * W + x;
      if (seaDist[i] === 0) continue;
      seaDist[i] = Math.min(seaDist[i], at(x + 1, y) + 3, at(x, y + 1) + 3,
                            at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < W * H; i += 1) seaDist[i] /= 3;
}

// ── 晕渲 ────────────────────────────────────────────────────────────
// 一像素在地面上的实际跨度随纬度变化；东西向要乘 cos(lat)，否则高纬地形会被拉扁
const azRad = (360 - AZIMUTH + 90) * Math.PI / 180;
const altRad = ALTITUDE * Math.PI / 180;
const shade = new Float32Array(W * H);
const slopeArr = new Float32Array(W * H);
// 坡向与脊谷曲率此前算完就丢。皴笔的方向场与谷底闸都要用，存下来
const aspectArr = new Float32Array(W * H);
const lapArr = new Float32Array(W * H);
const METER_PER_DEG = 111320;
for (let y = 1; y < H - 1; y += 1) {
  const lat = N_DEG - (y + 0.5) / PX_PER_DEG;
  const mx = (METER_PER_DEG / PX_PER_DEG) * Math.cos(lat * Math.PI / 180);
  const my = METER_PER_DEG / PX_PER_DEG;
  for (let x = 1; x < W - 1; x += 1) {
    const i = y * W + x;
    // Horn 三阶差分，比两点差分抗噪
    // 用平滑后的地势，不用原始 DEM：照微地形晕渲出来是卫星图
    const dzdx = ((relief[i - W + 1] + 2 * relief[i + 1] + relief[i + W + 1])
                - (relief[i - W - 1] + 2 * relief[i - 1] + relief[i + W - 1])) / (8 * mx) * VE;
    const dzdy = ((relief[i + W - 1] + 2 * relief[i + W] + relief[i + W + 1])
                - (relief[i - W - 1] + 2 * relief[i - W] + relief[i - W + 1])) / (8 * my) * VE;
    const slope = Math.atan(Math.hypot(dzdx, dzdy));
    const aspect = Math.atan2(dzdy, -dzdx);
    slopeArr[i] = slope;
    aspectArr[i] = aspect;
    shade[i] = Math.max(0, Math.cos(altRad) * Math.cos(slope)
                         + Math.sin(altRad) * Math.sin(slope) * Math.cos(azRad - aspect));
  }
}
console.log("晕渲计算完成");

// ── 到最近郡治的距离场：墨要落在有人的地方 ────────────────────────
// 实测旧版着墨占比：横断—青藏东缘 26.4%，华北平原 2.2%，差十二倍。
// 而一百零五个郡国全在东部——视觉重心与信息重心正好相反，
// 整幅看上去像一张横断山写生。用郡治距离衰减墨量，把西部退成远景。
const seatDist = new Float32Array(W * H);
{
  const cs = JSON.parse(fs.readFileSync("lib/game/data/commanderies.json", "utf8"));
  const INF = 1e9;
  seatDist.fill(INF);
  for (const c of cs) {
    const x = Math.round(((c.longitude - W_DEG) / (E_DEG - W_DEG)) * W);
    const y = Math.round(((N_DEG - c.latitude) / (N_DEG - S_DEG)) * H);
    if (x >= 0 && y >= 0 && x < W && y < H) seatDist[y * W + x] = 0;
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? INF : seatDist[y * W + x]);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    if (seatDist[i] === 0) continue;
    seatDist[i] = Math.min(seatDist[i], at(x - 1, y) + 3, at(x, y - 1) + 3,
                           at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
  }
  for (let y = H - 1; y >= 0; y -= 1) for (let x = W - 1; x >= 0; x -= 1) {
    const i = y * W + x;
    if (seatDist[i] === 0) continue;
    seatDist[i] = Math.min(seatDist[i], at(x + 1, y) + 3, at(x, y + 1) + 3,
                           at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
  }
  for (let i = 0; i < W * H; i += 1) seatDist[i] /= 3;
}

// ── 设色：纸底 + 淡彩 + 墨染 ─────────────────────────────────────────
// 不用高程分带配色。把海拔映射成一条从绿到赭到灰白的连续色带，是地图册的
// 路子——那条色带本身就在说「这是一张地理图」。传统舆图反过来：
// 纸色是底，地势用**墨**表现，颜色只作极淡的罩染，高处大片留白。
const PAPER = [236, 226, 202];        // 宣纸
const INK   = [ 52,  45,  36];        // 焦墨，偏暖
const WASH_GREEN = [176, 186, 138];   // 汁绿：平畴
const WASH_OCHRE = [198, 166, 112];   // 赭石：丘陵与黄土
const SEA_WASH   = [198, 210, 208];   // 淡花青

// 一切笔墨的尺寸都必须相对 PPD。写成像素常量，在 55 px/度上是椒盐噪点、
// 在 220 px/度上直接消失——实测勾脊 35233 点 vs 3830 点，差 9.2 倍。
// 这是「墨是噪声而不是笔」的根因。
const MPP = METER_PER_DEG / PX_PER_DEG;              // 每像素多少米
const P = (k) => PX_PER_DEG * k;                     // 按度换算的像素尺寸

const GREEN_W = Number(process.env.GREEN ?? 0.46);
const OCHRE_W = Number(process.env.OCHRE ?? 0.42);
const WASH_W  = Number(process.env.WASH ?? 0.34);
const INK_W   = Number(process.env.INKW ?? 1.5);

// 坡度以本幅实际值为尺。绝对阈值在不同 PPD 下会失准——
// 平滑半径随 PPD 变，坡度量级也跟着变
let slopeMax = 0;
for (let i = 0; i < W * H; i += 1) if (!isWater[i] && slopeArr[i] > slopeMax) slopeMax = slopeArr[i];
const SLOPE_HI = Math.max(1e-4, slopeMax * 0.55);
console.log(`坡度满档 ${SLOPE_HI.toFixed(3)}（本幅最大 ${slopeMax.toFixed(3)}）`);

const rgb = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    const e = relief[i];
    let r, g, b;
    if (isWater[i]) {
      [r, g, b] = SEA_WASH;
      // 网巾水：波纹平行于岸线，近岸密而实，远海疏而淡，终归于纸色。
      // 照 y 坐标打波纹出来是扫描线，不是水
      const d = seaDist[i];
      // 波纹只画近岸的一带。铺满全海则等距场被原样画了出来——
      // 每块礁石外面套一圈圈同心环，那正是海图等深线，是要甩掉的记号
      if (d < P(0.35)) {
        const jitter = (fbm(x / P(0.3), y / P(0.3), 3, 5) - 0.5) * P(0.045);
        const wave = Math.max(0, Math.sin((d + jitter) / P(0.055))) ** 1.6;
        const a = wave * 0.16 * (1 - d / P(0.35));
        r = r * (1 - a) + INK[0] * a;
        g = g * (1 - a) + INK[1] * a;
        b = b * (1 - a) + INK[2] * a;
      }
      const off = 1 - Math.exp(-d / (PX_PER_DEG * 3.2));
      r = r * (1 - off * 0.45) + PAPER[0] * off * 0.45;
      g = g * (1 - off * 0.45) + PAPER[1] * off * 0.45;
      b = b * (1 - off * 0.45) + PAPER[2] * off * 0.45;
    } else {
      [r, g, b] = PAPER;
      // 淡彩：低处汁绿，中高赭石，雪线以上留白。
      // 不匀要匀到能留出空白：手染的绫绢本就有跳笔，而传统舆图全景图的
      // 留白该占两三成——罩染盖满每一寸陆地、一处纸也不留，出来仍是
      // 「淡了的地形图」。让低频噪声偶尔把彩降到零。
      // 噪声尺度按 PPD 换算，写成 x/46 在 220 px/度上会细成噪点
      const wet = fbm(x / P(0.52), y / P(0.52), 3, 13);
      const green = Math.max(0, 1 - e / 900) * GREEN_W
                  * Math.min(1.15, Math.max(0, (wet - 0.28) / 0.48));
      const ochre = Math.max(0, Math.min(1, (e - 400) / 1300)) * OCHRE_W
                  * Math.max(0, 1 - e / 4200);
      r = r * (1 - green) + WASH_GREEN[0] * green;
      g = g * (1 - green) + WASH_GREEN[1] * green;
      b = b * (1 - green) + WASH_GREEN[2] * green;
      r = r * (1 - ochre) + WASH_OCHRE[0] * ochre;
      g = g * (1 - ochre) + WASH_OCHRE[1] * ochre;
      b = b * (1 - ochre) + WASH_OCHRE[2] * ochre;

      const dark = Math.max(0, 0.5 - shade[i]) * 2;
      const steep = Math.min(1, slopeArr[i] / SLOPE_HI);
      // 高处反而要淡：雪线以上是留白，不是最浓的墨
      const high = Math.min(1, Math.max(0, (e - 300) / 2600)) * Math.max(0.15, 1 - Math.max(0, (e - 2600) / 2200));
      // 墨染（湿笔）：山体的体量。皴（干笔）落在它上面才有分量，
      // 只有皴则通篇干枯如尘
      const wash = (high * 0.62 + steep * 0.30) * WASH_W;
      // 墨量按到最近郡治的距离衰减：塔里木、青藏、南海诸岛自然退为远景
      const near = 0.26 + 0.74 * Math.exp(-seatDist[i] / P(2.2));
      let ink = (dark * steep * 0.66 + high * steep * 0.34) * INK_W * near;
      ink = Math.max(0, Math.min(1, ink)) + wash;
      if (ink > 0) {
        // 墨染是连续的湿笔，不做色阶量化。
        // 「墨分五色」指的是几次落墨的浓淡层次（淡打底、中墨重描、勾脊、
        // 焦墨点），那是**笔**的事；把连续场 posterize 成五档，
        // 在平缓处必然压出硬边色块——先是方格（抖动用了截断坐标），
        // 换平滑噪声后变成迷彩。分档这件事交给皴层的几遍去做。
        const a = Math.min(0.92, ink);
        r = r * (1 - a) + INK[0] * a;
        g = g * (1 - a) + INK[1] * a;
        b = b * (1 - a) + INK[2] * a;
      }
      // 平畴不能真空。传统舆图在平地上落细点短线表示耕垦，
      // 否则大面积纸色像是没画完
      // 平畴不能真空。中原一带正是对局主战场，一片纸色等于没画完。
      // 落细点短线表示耕垦，再加一层缓起伏的墨气，让平地也有呼吸
      const flat = Math.max(0, 1 - steep / 0.42) * Math.max(0, 1 - e / 1400);
      if (flat > 0.05) {
        const till = (fbm(x / P(0.047), y / P(0.047), 2, 71) - 0.5) * 0.26 * flat
                   + (fbm(x / P(0.38), y / P(0.24), 3, 77) - 0.5) * 0.18 * flat
                   + (hash((x / P(0.02)) | 0, (y / P(0.02)) | 0, 73) > 0.982 ? 0.10 * flat : 0);
        r -= till * 130; g -= till * 122; b -= till * 104;
      }
    }
    const o = i * 3;
    rgb[o] = Math.max(0, Math.min(255, Math.round(r)));
    rgb[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
    rgb[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
}
console.log("设色与墨染完成");

// ── 脊谷曲率场：沿梯度方向的二阶差分，正为脊、负为谷 ──────────────
// 勾脊与皴的谷底闸共用。此前只在勾脊的跳步循环里算，是稀疏的，
// 取不了分位数
for (let y = 2; y < H - 2; y += 1) {
  for (let x = 2; x < W - 2; x += 1) {
    const i = y * W + x;
    if (isWater[i]) continue;
    const gx = coarse[i + 1] - coarse[i - 1];
    const gy = coarse[i + W] - coarse[i - W];
    const len = Math.hypot(gx, gy) || 1;
    const ux = Math.round(gx / len), uy = Math.round(gy / len);
    lapArr[i] = 2 * coarse[i] - coarse[i + uy * W + ux] - coarse[i - uy * W - ux];
  }
}

// ── 勾脊：沿分水岭落一道浓墨 ──────────────────────────────────────
// 传统画山都是先勾轮廓再皴，只皴不勾则山没有骨。
// 勾脊要用比皴更平滑的地势，照微地形逐条勾，出来是一头乱毛而不是山骨。
{
  const RIDGE = Number(process.env.RIDGE ?? 0.55);
  let inked = 0;
  const STEP = Math.max(1, Math.round(P(0.018)));
  for (let y = 2; y < H - 2; y += STEP) {
    for (let x = 2; x < W - 2; x += STEP) {
      const i = y * W + x;
      if (isWater[i]) continue;
      const steep = Math.min(1, slopeArr[i] / SLOPE_HI);
      if (steep < 0.42) continue;
      // 雪线以上留白：高原本就是画里最空的地方，勾满脊线会糊成一团黑。
      // 试片上青藏一带曾被勾了二十六万点
      if (relief[i] > 3400) continue;
      const gx = coarse[i + 1] - coarse[i - 1];
      const gy = coarse[i + W] - coarse[i - W];
      const len = Math.hypot(gx, gy) || 1;
      // 沿梯度方向的二阶差分为正 → 该点在脊上而非谷中（lapArr 已稠密算好）
      const lap = lapArr[i];
      if (lap <= 0) continue;
      // lap 是相邻像素的高程二阶差，量纲随 PPD 线性缩小，必须按 MPP 归一
      const a = Math.min(0.34, (lap / (MPP * 0.02)) * steep * steep * RIDGE);
      if (a <= 0.01) continue;
      // 落成沿脊走向的短线，不是单点。1px 的点在 4:1 降采样后必然消失，
      // 这是「山没有骨」的直接原因
      const half = Math.max(0.6, P(0.03));
      const wid = Math.max(0.5, P(0.007));
      const tx = -gy / len, ty = gx / len;                 // 脊的走向 = 梯度的法向
      for (let s = -half; s <= half; s += 0.5) {
        for (let n = -wid; n <= wid; n += 0.5) {
          const px = Math.round(x + tx * s - gx / len * n);
          const py = Math.round(y + ty * s - gy / len * n);
          if (px < 0 || py < 0 || px >= W || py >= H || isWater[py * W + px]) continue;
          const fade = (1 - Math.abs(s) / (half + 0.5)) * (1 - Math.abs(n) / (wid + 0.5));
          const aa = a * fade * 0.55;
          if (aa <= 0.004) continue;
          const o = (py * W + px) * 3;
          rgb[o]     = Math.round(rgb[o]     * (1 - aa) + INK[0] * aa);
          rgb[o + 1] = Math.round(rgb[o + 1] * (1 - aa) + INK[1] * aa);
          rgb[o + 2] = Math.round(rgb[o + 2] * (1 - aa) + INK[2] * aa);
        }
      }
      inked += 1;
    }
  }
  console.log(`勾脊 ${inked} 点`);
}

// ── 皴笔 ────────────────────────────────────────────────────────────
// 程序化笔触，不用古画裁片图章。理由见 tools/brush.mjs 顶部：
// 那批图章是被「方向性惩罚项」筛出来的乱纹区，落图是圆噪点盘不是笔，
// 而且实测是净负贡献（带图章 coherence 0.226 < 不施皴 0.259）。
//
// 组织法照山水画的规矩，不是纹理填充：
//   走向  —— 沿坡降线（自脊向谷），不是顺等高线。顺等高线画出来是缠绕的
//            绳圈，那是解索/牛毛，不是披麻
//   密度  —— 第一定律是「阳面留白皴阴面」，第二定律才是自上而下渐密
//   成簇  —— 笔是成组下的，不是均匀撒开
//   留白  —— 平畴、谷底、山脚一笔不落；山里另挖结构性的空
{
  const WBASE = Math.max(4.1, P(0.0186));      // 笔宽基准。低于 4px 过不了 4:1 降采样
  const BLOCK = P(0.42);                        // 石块单元，笔长以此为尺
  const INK_MAX = Number(process.env.CUN_MAX ?? 25000);
  const INK_MIN = Number(process.env.CUN_MIN ?? 6000);

  // 局部起伏与相对高度：判断「这里是不是山」「在山的哪一段」。
  // 用块级 min/max 近似滑动窗口，够用且便宜
  const blockStat = (radius) => {
    const d = Math.max(2, Math.round(radius));
    const bw = Math.ceil(W / d), bh = Math.ceil(H / d);
    const mn = new Float32Array(bw * bh).fill(Infinity);
    const mx = new Float32Array(bw * bh).fill(-Infinity);
    for (let y = 0; y < H; y += 1) {
      const by = (y / d) | 0;
      for (let x = 0; x < W; x += 1) {
        const v = relief[y * W + x];
        const b = by * bw + ((x / d) | 0);
        if (v < mn[b]) mn[b] = v;
        if (v > mx[b]) mx[b] = v;
      }
    }
    // 3×3 块扩张，避免块边界处出现方格
    const mn2 = new Float32Array(bw * bh), mx2 = new Float32Array(bw * bh);
    for (let b = 0; b < bw * bh; b += 1) {
      const bx = b % bw, by = (b / bw) | 0;
      let lo = Infinity, hi = -Infinity;
      for (let j = -1; j <= 1; j += 1) for (let i2 = -1; i2 <= 1; i2 += 1) {
        const nx2 = bx + i2, ny2 = by + j;
        if (nx2 < 0 || ny2 < 0 || nx2 >= bw || ny2 >= bh) continue;
        const k = ny2 * bw + nx2;
        if (mn[k] < lo) lo = mn[k];
        if (mx[k] > hi) hi = mx[k];
      }
      mn2[b] = lo; mx2[b] = hi;
    }
    return { d, bw, mn: mn2, mx: mx2 };
  };
  const S60 = blockStat(P(0.27));
  const S45 = blockStat(P(0.45));
  const statAt = (S, x, y) => {
    const b = ((y / S.d) | 0) * S.bw + ((x / S.d) | 0);
    return { lo: S.mn[b], hi: S.mx[b] };
  };

  // 谷底闸用曲率的 p88：正曲率大者是脊，负者是谷；谷底不落笔
  const sampleLap = [];
  for (let i = 0; i < W * H; i += 977) if (!isWater[i]) sampleLap.push(lapArr[i]);
  sampleLap.sort((a, b) => a - b);
  const LAP_P88 = sampleLap[Math.floor(sampleLap.length * 0.88)] ?? 0;

  const smoothstep = (a, b, v) => {
    const u = Math.min(1, Math.max(0, (v - a) / (b - a || 1e-6)));
    return u * u * (3 - 2 * u);
  };

  // 结构性留白：在受光的高处挖几块洞。「疏可走马」不是把密度调低，
  // 是真的留出成片不落笔的地方
  const holes = [];
  {
    const step = Math.round(P(1.4));
    for (let y = step; y < H - step; y += step) {
      for (let x = step; x < W - step; x += step) {
        const i = y * W + x;
        if (isWater[i] || shade[i] < 0.66) continue;
        const { lo, hi } = statAt(S60, x, y);
        if (hi - lo < 400) continue;
        if (hash(x, y, 401) > 0.22) continue;
        holes.push({ x, y, r: P(0.09) * (0.6 + hash(x, y, 403) * 0.8) });
      }
    }
  }
  const inHole = (x, y) => holes.some((h) => (x - h.x) ** 2 + (y - h.y) ** 2 < h.r * h.r);

  // ── 候选点：先按密度排序，再全局抽稀。让密度函数自己决定总量会失控 ──
  const cand = [];
  const gstep = Math.max(4, Math.round(P(0.05)));
  for (let y = 2; y < H - 2; y += gstep) {
    for (let x = 2; x < W - 2; x += gstep) {
      const i = y * W + x;
      if (isWater[i]) continue;
      const steep = slopeArr[i] / SLOPE_HI;
      if (steep < 0.20) continue;                            // 缓坡不皴
      const { lo, hi } = statAt(S60, x, y);
      if (hi - lo < 320) continue;                           // 起伏不足，不是山
      if (lapArr[i] > LAP_P88) continue;                     // 谷底不落笔
      const w45 = statAt(S45, x, y);
      const hRel = (relief[i] - w45.lo) / Math.max(1, w45.hi - w45.lo);
      if (hRel < 0.06) continue;                             // 山脚硬截断
      if (inHole(x, y)) continue;

      const kSlope = smoothstep(0.20, 0.50, steep);
      // 阳面留白、阴面皴密——这是第一定律，压过「自上而下渐密」
      const kLight = Math.min(1, Math.max(0.06, 0.06 + 0.94 * (1 - shade[i]) ** 2.2));
      const kVert = 0.45 + 0.55 * (1 - hRel);
      const kNear = 0.26 + 0.74 * Math.exp(-seatDist[i] / P(2.2));
      const density = kSlope * kLight * kVert * kNear;
      if (density < 0.02) continue;
      cand.push({ x, y, i, density, hRel, steep, relief60: hi - lo });
    }
  }
  // 排序键乘噪声：纯按密度排会整条等值线一起入选，出来是等高线不是笔群
  cand.sort((a, b) => b.density * (0.75 + hash(b.x, b.y, 509) * 0.5)
                    - a.density * (0.75 + hash(a.x, a.y, 509) * 0.5));

  const D = new Float32Array(W * H);
  const rnd = rng(20260902);
  let strokes = 0;
  const budget = Math.min(INK_MAX, Math.max(INK_MIN, Math.round(cand.length * 0.55)));

  for (const c of cand) {
    if (strokes >= budget) break;
    const lit = shade[c.i] > 0.62;                           // 阳面：笔少、墨淡、笔细
    // 皴种按山体性质分：起伏大而陡的石山用斧劈，土山用披麻，
    // 密集中山用雨点。同一坡面内不混用
    const kind = c.relief60 > 1400 && c.steep > 0.55 ? "fupi"
      : c.relief60 > 700 ? "pima" : "yudian";
    const nInCluster = Math.max(2, Math.round((3 + rnd() * 6) * (lit ? 0.45 : 1)));

    // 方向：沿坡降线。坡太缓时坡向不可靠，退回图面竖直
    const reliable = c.steep > 0.15;
    const thetaBase = kind === "yudian" ? Math.PI / 2
      : reliable ? aspectArr[c.i] : Math.PI / 2;
    const sigma = kind === "fupi" ? 20 : kind === "pima" ? 14 : 15;
    const thetaCluster = thetaBase + gauss(rnd) * sigma * Math.PI / 180;

    for (let k = 0; k < nInCluster && strokes < budget; k += 1) {
      const wMul = kind === "fupi" ? 2.0 : kind === "pima" ? 1.17 : 1.0;
      const jitterW = kind === "yudian" ? 0.9 + rnd() * 0.2 : 0.78 + rnd() * 0.44;
      const wMax = WBASE * wMul * jitterW * (lit ? 0.8 : 1);
      const L = kind === "fupi" ? BLOCK * (0.13 + rnd() * 0.11)
        : kind === "pima" ? BLOCK * (0.45 + rnd() * 0.45)
        : wMax * (2.0 + rnd() * 1.4);
      // 簇内横向错开，间距明确避开等距
      const gapSet = [0.6, 1.0, 1.45, 1.9];
      const gap = gapSet[(k + ((rnd() * 4) | 0)) % 4] * wMax * 1.7;
      const side = (k - (nInCluster - 1) / 2) * gap;
      const th = thetaCluster + (k - (nInCluster - 1) / 2) * 3.5 * Math.PI / 180
               + gauss(rnd) * 4 * Math.PI / 180;
      const nx2 = -Math.sin(thetaCluster), ny2 = Math.cos(thetaCluster);
      const along = (rnd() - 0.5) * 0.56 * L;
      const sx = c.x + nx2 * side + Math.cos(thetaCluster) * along;
      const sy = c.y + ny2 * side + Math.sin(thetaCluster) * along;
      if (sx < 2 || sy < 2 || sx >= W - 2 || sy >= H - 2) continue;

      const inkTier = c.hRel > 0.75 ? 0.45 : c.hRel > 0.30 ? 0.78 : 1.05;
      const dark = Math.min(1.45, Math.max(0.30, 0.30 + 1.20 * (1 - shade[c.i]) ** 1.3));
      const A0 = 0.62 * inkTier * dark * (lit ? 0.55 : 1);

      const spine = kind === "fupi"
        ? arcSpine(sx, sy, th, L, 0, 6, rnd, 4)
        : arcSpine(sx, sy, th, L, kind === "pima" ? 0.05 + gauss(rnd) * 0.02 : 0, 3, rnd, 10);
      strokeInk(D, W, H, spine, {
        wMax,
        wProf: kind === "fupi" ? WPROF.fupiSmall : kind === "pima" ? WPROF.pima : WPROF.yudian,
        aProf: APROF.wet,
        lProf: kind === "fupi" ? LPROF_SIDE : LPROF_CENTER,
        nExt: kind === "fupi" ? 1.0 : NEXT_CENTER,
        ecc: kind === "fupi" ? 0.18 : 0,
        A0: A0 * 0.42,                                       // 第一遍淡打底
        fwTarget: kind === "yudian" ? 0.08 : 0.20,
        coreFirst: kind === "fupi",
        seed: (strokes * 2654435761) >>> 8,
      });
      // 五成半的笔中墨重描，位置微偏——一遍下去是刷子，两遍才是笔
      if (rnd() < 0.55) {
        strokeInk(D, W, H,
          spine.map((p) => ({ x: p.x + (rnd() - 0.5) * 3, y: p.y + (rnd() - 0.5) * 3 })), {
            wMax: wMax * 0.92,
            wProf: kind === "fupi" ? WPROF.fupiSmall : kind === "pima" ? WPROF.pima : WPROF.yudian,
            aProf: APROF.wet,
            lProf: kind === "fupi" ? LPROF_SIDE : LPROF_CENTER,
            nExt: kind === "fupi" ? 1.0 : NEXT_CENTER,
            A0: A0 * 0.72,
            fwTarget: kind === "yudian" ? 0.10 : 0.24,
            coreFirst: kind === "fupi",
            seed: (strokes * 40503 + 7) >>> 8,
          });
      }
      strokes += 1;
    }
  }

  // 统一光学合成：alpha = 1 - exp(-kD)。逐笔往 RGB 上叠会让重叠处过曝
  let inked = 0;
  for (let i = 0; i < W * H; i += 1) {
    if (D[i] <= 0) continue;
    const a = Math.min(0.92, 1 - Math.exp(-1.15 * D[i]));
    if (a <= 0.003) continue;
    const o = i * 3;
    rgb[o]     = Math.round(rgb[o]     * (1 - a) + INK[0] * a);
    rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + INK[1] * a);
    rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + INK[2] * a);
    inked += 1;
  }
  console.log(`皴 ${strokes} 笔（候选 ${cand.length}，留白洞 ${holes.length}），着墨 ${inked} 像素`);
}

// ── 岸线：陆侧留白一线，水侧淡墨一勾 ──────────────────────────────
// 传统画法的水岸都是这么分的：白线把陆地从水里「提」出来，
// 墨线给水一个边。旧版只在陆侧压一道深墨，岸就糊在水里。
for (let y = 1; y < H - 1; y += 1) {
  for (let x = 1; x < W - 1; x += 1) {
    const i = y * W + x;
    const land = !isWater[i];
    const near = [i - 1, i + 1, i - W, i + W].some((j) => !isWater[j] !== land);
    if (!near) continue;
    const jit = 0.75 + fbm(x / P(0.16), y / P(0.16), 2, 61) * 0.5;
    // 线宽按 PPD：恒定 1px 的岸线在 7260 图降采样到 1815 后基本消失
    const wid = Math.ceil(P(0.012));
    for (let dy = -wid; dy <= wid; dy += 1) {
      for (let dx = -wid; dx <= wid; dx += 1) {
        const px = x + dx, py = y + dy;
        if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) continue;
        const fall = 1 - Math.hypot(dx, dy) / (wid + 0.8);
        if (fall <= 0) continue;
        const oo = (py * W + px) * 3;
        if (land && !isWater[py * W + px]) {
          const a = Math.min(0.85, 0.55 * jit * fall);
          for (let c = 0; c < 3; c += 1) rgb[oo + c] = Math.round(rgb[oo + c] * (1 - a) + 250 * a);
        } else if (!land && isWater[py * W + px]) {
          const a = Math.min(0.5, 0.3 * jit * fall);
          for (let c = 0; c < 3; c += 1) rgb[oo + c] = Math.round(rgb[oo + c] * (1 - a) + INK[c] * a);
        }
      }
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
  // 济水在汉末舆图上是要素不是细节，与辽水、珠江一并从默认 0.34 提上来
  const WEIGHT = { 黄河: 1.0, 长江: 1.0, 淮水: 0.62, 汉水: 0.62, 渭水: 0.55,
                   济水: 0.5, "珠江（西江）": 0.62, 辽水: 0.42,
                   湘水: 0.45, 赣水: 0.45, 泗水: 0.42 };
  // 河用淡墨偏青，不用亮蓝——亮蓝是现代地图的记号。
  // 大河作双线：只在两岸落墨、河心留纸并提亮。这既是明代舆图的画法，
  // 也正是水彩的边缘湿染，比一条实色带像十倍
  const RIVER_INK = [108, 124, 120];
  const paint = (x, y, a) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
    const o = (yi * W + xi) * 3;
    for (let c = 0; c < 3; c += 1) {
      rgb[o + c] = Math.round(rgb[o + c] * (1 - a) + RIVER_INK[c] * a);
    }
  };
  // 河心不是留白而是淡水色：提到近白会读成道路而不是水
  const RIVER_FILL = [206, 218, 214];
  const lighten = (x, y, a) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
    const o = (yi * W + xi) * 3;
    for (let c = 0; c < 3; c += 1) {
      rgb[o + c] = Math.round(rgb[o + c] * (1 - a) + RIVER_FILL[c] * a);
    }
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
      // 加宽一档并让提按更明显：细蓝线是矢量图的记号，墨笔才有粗细
      // 下游按水力几何加宽：w ∝ Q^0.5，入海口要显著阔于源头
      const half = w0 * PX_PER_DEG * 0.030 * (0.35 + (i / pts.length) ** 0.8 * 1.6);
      const twoLine = half >= P(0.02);                   // 大河才作双线
      const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
      for (let t = 0; t <= len; t += 0.5) {
        const u = t / (len || 1);
        const x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
        const press = 0.6 + fbm(x / P(0.11), y / P(0.11), 3, 83) * 0.85;
        for (let o2 = -half; o2 <= half; o2 += 0.4) {
          const u2 = Math.abs(o2) / (half + 0.5);
          if (twoLine) {
            if (u2 > 0.5) paint(x + nx * o2, y + ny * o2, (1 - (u2 - 0.5) * 2) * press * 0.62);
            else lighten(x + nx * o2, y + ny * o2, (1 - u2 * 2) * 0.42);
          } else {
            paint(x + nx * o2, y + ny * o2, (1 - u2) * press * 0.45);
          }
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
// ── 纸纹罩染：整幅压一层宣纸 ────────────────────────────────────────
// 没有这一层，无论怎么设色都像印刷品而不像画在纸上。
{
  const paperPath = "public/game/map/paper.png";
  if (fs.existsSync(paperPath)) {
    const tile = await sharp(paperPath).raw().toBuffer({ resolveWithObject: true });
    const ts = tile.info.width, tch = tile.info.channels;
    const amt = Number(process.env.PAPER ?? 0.14);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        // 采样坐标随 PPD 归一：否则 PPD=220 时同一张 512 纹理重复十四遍，
        // 云斑（纸纹里最重的一项）肉眼可见地重复
        const sx = Math.round(x * 55 / PX_PER_DEG) % ts;
        const sy = Math.round(y * 55 / PX_PER_DEG) % ts;
        const v = tile.data[(((sy + ts) % ts) * ts + ((sx + ts) % ts)) * tch] / 255;
        const k = 1 - (v - 0.5) * amt;
        const o = (y * W + x) * 3;
        for (let c = 0; c < 3; c += 1) {
          rgb[o + c] = Math.max(0, Math.min(255, Math.round(rgb[o + c] * k)));
        }
      }
    }
    console.log("纸纹罩染完成");
  } else {
    console.log("未找到 paper.png，跳过纸纹（先跑 node tools/make-paper.mjs）");
  }
}

await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
  .png({ compressionLevel: 9 }).toFile(OUT);

if (process.env.LABELS !== "0") {
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

