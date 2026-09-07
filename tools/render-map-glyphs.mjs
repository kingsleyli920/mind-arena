// 图上符号的笔墨版：城郭、关津港仓、行营营垒，一律走**画底图那支笔**。
//
// 这件事的起因是一句话：「为啥做的这么粗糙」。查下来不是画得不够多，
// 是一张图上跑着两套工艺——
//
//   底图  tools/render-terrain-map.mjs：真实高程晕渲 + brush.mjs 的笔锋
//         （钉头鼠尾、飞白、墨度沿笔身衰减、笔缘抖动）+ 三十枚自公有领域
//         山水画提取的皴法图章。所以山是画出来的。
//   符号  PlayClient.tsx 里手写的 <path>：平涂 + 硬描边 + 白椭圆衬底。
//         所以城是「画在软件里的图标」。
//
// 两套工艺摆在一起，再怎么调形状也是贴纸压在画上。这个脚本把符号搬到
// 同一支笔下：同样的笔锋剖面、同样的飞白、同样的墨度衰减，离线渲成 PNG，
// 界面只管贴。
//
// 每个符号出两张：
//   <id>-ink.png   墨线，alpha 即墨密度。这一层永远是墨色，不随势力变
//   <id>-wash.png  可上色的面（城墙、帐面）。界面拿它作 mask 刷势力色
// 没有可上色面的符号（关、道、津、港、仓、战）只出 ink 一张。
//
// 反复运行结果一致：无网络、无时间依赖，随机数一律由固定种子驱动。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  rng, arcSpine, strokeInk, WPROF, APROF, LPROF_CENTER, LPROF_SIDE, NEXT_CENTER,
} from "./brush.mjs";

const OUT = "public/game/glyphs";
const S = 256;                       // 渲染边长。界面按需缩放，出图一律 256
const PAD = 18;                      // 四周留白：笔锋会甩出形体之外

/** 一块光学深度场 */
const field = () => new Float32Array(S * S);

/** 直线骨架。brush 的 arcSpine 只给弧，直笔也走它（sag=0） */
const line = (x0, y0, x1, y1, rnd, sag = 0.02, wob = 1.2) => {
  const dx = x1 - x0, dy = y1 - y0;
  return arcSpine(x0, y0, Math.atan2(dy, dx), Math.hypot(dx, dy), sag, wob, rnd);
};

/**
 * 一笔。默认取中锋披麻——铁线型，圆头匀行提尖，最像界画的界笔。
 * 屋檐那类要起翘的用侧锋斧劈，笔势看得出来。
 */
const stroke = (D, spine, o = {}) => strokeInk(D, S, S, spine, {
  wMax: 7, wProf: WPROF.pima, aProf: APROF.wet, lProf: LPROF_CENTER,
  nExt: NEXT_CENTER, A0: 0.78, fwTarget: 0.12, kd: 0.35,
  edgeJit: 0.12, texAmp: 0.14, grainAmp: 0.24, ...o,
});

/** 面：拿几笔并排的阔笔扫出来，比几何填充有墨色层次 */
function wash(D, x0, y0, x1, y1, rnd, o = {}) {
  const h = y1 - y0;
  const n = Math.max(2, Math.round(h / 9));
  for (let i = 0; i < n; i += 1) {
    const y = y0 + (h * (i + 0.5)) / n;
    stroke(D, line(x0, y, x1, y, rnd, 0.006, 0.5), {
      wMax: (h / n) * 1.9, wProf: WPROF.yudian, aProf: APROF.wet,
      // 这一层是**势力色的载体**，不是墨。淡了则三十一家在图上分不开——
      // 配色是花了功夫按「最大化最小色差」排的，被一层 0.3 的淡墨吃掉就白排了
      lProf: LPROF_SIDE, A0: 1.5, fwTarget: 0.12, kd: 0.1,
      edgeJit: 0.16, seed: 700 + i, ...o,
    });
  }
}

/** 圆弧点列。arcSpine 只给「沿某方向带弧垂的一笔」，正圆券得自己采样 */
const arcPts = (cx, cy, r, a0, a1, n = 18) =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });

/** 梯形铺墨：屋面那种上窄下宽的一片 */
function washTrap(D, cx, yTop, halfTop, yBot, halfBot, rnd, o = {}) {
  const n = Math.max(3, Math.round((yBot - yTop) / 7));
  for (let i = 0; i < n; i += 1) {
    const u = (i + 0.5) / n;
    const y = yTop + (yBot - yTop) * u;
    const hw = halfTop + (halfBot - halfTop) * u;
    stroke(D, line(cx - hw, y, cx + hw, y, rnd, 0.004, 0.4), {
      wMax: ((yBot - yTop) / n) * 2.0, wProf: WPROF.yudian, lProf: LPROF_SIDE,
      A0: 0.42, fwTarget: 0.34, kd: 0.18, edgeJit: 0.22, seed: 900 + i, ...o,
    });
  }
}

/**
 * 庑殿顶。两端起翘那一下是汉阙的全部神气所在。
 *
 * 头一版把垂脊画成两条独立的弧，出来是屋脊上支着两根触须——因为
 * arcSpine 是「从一点沿一个方向带弧垂地走一段」，不是「两点之间连一道弧」。
 * 现在：屋面先铺一片淡墨定住形，再压正脊、垂脊，最后一道檐口线——
 * 檐口中低两端翘，那一笔才是汉阙
 */
function roof(D, cx, cy, hw, hh, rnd, seed = 1) {
  // 屋面只铺到檐口之上一点，且墨要淡：铺满会把正脊糊掉，出来是一朵蘑菇
  washTrap(D, cx, cy - hh * 0.86, hw * 0.42, cy - hh * 0.06, hw * 0.9, rnd, { A0: 0.3 });
  // 正脊
  stroke(D, line(cx - hw * 0.36, cy - hh, cx + hw * 0.36, cy - hh, rnd, -0.02, 0.8),
    { wMax: 9, wProf: WPROF.fupi, A0: 0.92, seed });
  // 垂脊：正脊两端斜下到檐角
  stroke(D, line(cx - hw * 0.36, cy - hh, cx - hw, cy - hh * 0.1, rnd, 0.05, 1.2),
    { wMax: 7, A0: 0.86, seed: seed + 1 });
  stroke(D, line(cx + hw * 0.36, cy - hh, cx + hw, cy - hh * 0.1, rnd, -0.05, 1.2),
    { wMax: 7, A0: 0.86, seed: seed + 2 });
  // 檐口：中低两端翘。正的 sagRatio 让中段下垂，两端相对抬起
  stroke(D, arcSpine(cx - hw, cy - hh * 0.1, 0, hw * 2, 0.032, 1.2, rnd),
    { wMax: 8, wProf: WPROF.fupi, aProf: APROF.dry, lProf: LPROF_SIDE,
      A0: 0.9, fwTarget: 0.18, seed: seed + 3 });
}

/** 垛口城墙：一段带凹口的墙头 */
function battlement(D, x0, x1, yTop, yBot, rnd, seed = 1) {
  stroke(D, line(x0, yBot, x1, yBot, rnd, 0.01, 0.6), { wMax: 8, A0: 0.85, seed });
  stroke(D, line(x0, yTop, x1, yTop, rnd, -0.012, 0.8), { wMax: 7, A0: 0.82, seed: seed + 1 });
  stroke(D, line(x0, yTop, x0, yBot, rnd, 0, 0.6), { wMax: 7, A0: 0.8, seed: seed + 2 });
  stroke(D, line(x1, yTop, x1, yBot, rnd, 0, 0.6), { wMax: 7, A0: 0.8, seed: seed + 3 });
  // 垛口：矮而宽，且**坐在墙头上**。第一版画成 0.9 倍步长的高方块，
  // 出来是墙上摆了一排小箱子
  const n = 5;
  const step = (x1 - x0) / (n * 2 - 1);
  const hgt = step * 0.42;
  for (let i = 0; i < n; i += 1) {
    const x = x0 + step * i * 2;
    const xr = Math.min(x1, x + step);
    stroke(D, line(x, yTop, x, yTop - hgt, rnd, 0, 0.5), { wMax: 6, A0: 0.78, seed: seed + 10 + i });
    stroke(D, line(x, yTop - hgt, xr, yTop - hgt, rnd, -0.02, 0.5), { wMax: 6, A0: 0.8, seed: seed + 20 + i });
    stroke(D, line(xr, yTop - hgt, xr, yTop, rnd, 0, 0.5), { wMax: 6, A0: 0.78, seed: seed + 30 + i });
  }
}

// ── 各符号的笔顺 ────────────────────────────────────────────────────
//
// 每个符号出**若干变体**：同一类城在图上出现几十次，一幅画反复贴就是重复图案，
// 那正是「元素堆砌」的观感来源。变体不是换个随机种子那么简单——那只换飞白的
// 位置，轮廓一模一样；这里连比例一起动：墙高矮、垛口数、门楼偏左偏右、
// 峰的高低、舟的胖瘦。界面按郡名的哈希取一幅，同一个郡永远是同一幅。
//
// 每个返回 { ink, wash }，两块深度场
const GLYPHS = {
  /** 寻常郡城：一段城墙 + 城门。三幅：墙高、墙矮、偏窄一段 */
  "city-small": (v = 0) => {
    const rnd = rng(11 + v * 37), ink = field(), wa = field();
    const inset = [26, 20, 34][v % 3];
    const x0 = PAD + inset, x1 = S - PAD - inset;
    const yT = [118, 128, 122][v % 3], yB = 200;
    wash(wa, x0 + 6, yT + 6, x1 - 6, yB - 4, rng(12 + v * 37));
    battlement(ink, x0, x1, yT, yB, rnd, 1 + v * 400);
    // 城门：一道圆券，券内留暗。两条各自弯的弧接不成券，
    // 第一版画出来是个叉
    const cx = S / 2 + [0, -10, 8][v % 3];
    const gr = [20, 18, 21][v % 3];
    stroke(ink, arcPts(cx, yB - 6, gr, Math.PI, 2 * Math.PI), { wMax: 7, A0: 0.9, seed: 61 + v });
    stroke(ink, line(cx - gr, yB - 6, cx - gr, yB, rnd, 0, 0.4), { wMax: 7, A0: 0.88, seed: 62 + v });
    stroke(ink, line(cx + gr, yB - 6, cx + gr, yB, rnd, 0, 0.4), { wMax: 7, A0: 0.88, seed: 63 + v });
    washTrap(ink, cx, yB - gr - 2, gr * 0.8, yB, gr * 0.9, rnd, { A0: 0.5 });
    return { ink, wash: wa };
  },
  /** 大郡：城墙 + 门楼。三幅：门楼居中、偏左、偏右且矮一档 */
  "city-large": (v = 0) => {
    const rnd = rng(21 + v * 53), ink = field(), wa = field();
    const x0 = PAD + 20, x1 = S - PAD - 20, yT = [128, 124, 132][v % 3], yB = 208;
    const tx = S / 2 + [0, -26, 24][v % 3];          // 门楼横向偏心
    const ty = [84, 80, 92][v % 3];                  // 门楼高低
    wash(wa, x0 + 6, yT + 6, x1 - 6, yB - 4, rng(22 + v * 53));
    wash(wa, tx - 34, ty, tx + 34, yT - 2, rng(23 + v * 53));
    battlement(ink, x0, x1, yT, yB, rnd, 100 + v * 400);
    // 门楼屋身
    stroke(ink, line(tx - 36, ty, tx - 36, yT, rnd, 0, 0.6), { wMax: 7, A0: 0.85, seed: 131 + v });
    stroke(ink, line(tx + 36, ty, tx + 36, yT, rnd, 0, 0.6), { wMax: 7, A0: 0.85, seed: 132 + v });
    roof(ink, tx, ty, [52, 48, 55][v % 3], 22, rnd, 140 + v * 7);
    const cx = tx;
    stroke(ink, arcPts(cx, yB - 6, 18, Math.PI, 2 * Math.PI), { wMax: 7, A0: 0.9, seed: 161 + v });
    washTrap(ink, cx, yB - 20, 15, yB, 16, rnd, { A0: 0.5 });
    return { ink, wash: wa };
  },
  /** 州治：重檐两层 + 角楼。两幅：角楼在墙内 / 角楼探出墙外一档 */
  "city-seat": (v = 0) => {
    const rnd = rng(31 + v * 71), ink = field(), wa = field();
    const x0 = PAD + 8, x1 = S - PAD - 8, yT = 150, yB = 222;
    wash(wa, x0 + 6, yT + 6, x1 - 6, yB - 4, rng(32));
    wash(wa, S / 2 - 30, 104, S / 2 + 30, yT - 2, rng(33));
    wash(wa, S / 2 - 20, 56, S / 2 + 20, 96, rng(34));
    battlement(ink, x0, x1, yT, yB, rnd, 200 + v * 400);
    // 两侧角楼
    for (const s of [-1, 1]) {
      const cx = S / 2 + s * [84, 92][v % 2];
      stroke(ink, line(cx - 15, yT - 26, cx - 15, yT, rnd, 0, 0.6), { wMax: 6, A0: 0.8, seed: 210 + s });
      stroke(ink, line(cx + 15, yT - 26, cx + 15, yT, rnd, 0, 0.6), { wMax: 6, A0: 0.8, seed: 214 + s });
      roof(ink, cx, yT - 26, 22, 12, rnd, 220 + s * 3);
    }
    // 门楼两层
    stroke(ink, line(S / 2 - 32, 104, S / 2 - 32, yT, rnd, 0, 0.6), { wMax: 7, A0: 0.86, seed: 231 });
    stroke(ink, line(S / 2 + 32, 104, S / 2 + 32, yT, rnd, 0, 0.6), { wMax: 7, A0: 0.86, seed: 232 });
    roof(ink, S / 2, 104, 48, 19, rnd, 240);
    stroke(ink, line(S / 2 - 21, 56, S / 2 - 21, 96, rnd, 0, 0.6), { wMax: 6, A0: 0.84, seed: 251 });
    stroke(ink, line(S / 2 + 21, 56, S / 2 + 21, 96, rnd, 0, 0.6), { wMax: 6, A0: 0.84, seed: 252 });
    roof(ink, S / 2, 56, 34, 16, rnd, 260);
    const cx = S / 2;
    stroke(ink, arcPts(cx, yB - 6, 17, Math.PI, 2 * Math.PI), { wMax: 7, A0: 0.9, seed: 271 });
    washTrap(ink, cx, yB - 20, 14, yB, 15, rnd, { A0: 0.5 });
    return { ink, wash: wa };
  },
  /** 关隘：两墩夹门洞，上覆飞檐，两翼接城垣。三幅：关楼高、平、两翼长 */
  gate: (v = 0) => {
    const rnd = rng(41 + v * 91), ink = field();
    const yB = 206, yT = [120, 128, 116][v % 3];
    for (const s of [-1, 1]) {
      const cx = S / 2 + s * 62;
      stroke(ink, line(cx - 24, yT, cx - 24, yB, rnd, 0, 0.6), { wMax: 8, A0: 0.88, seed: 411 + s });
      stroke(ink, line(cx + 24, yT, cx + 24, yB, rnd, 0, 0.6), { wMax: 8, A0: 0.88, seed: 415 + s });
      stroke(ink, line(cx - 24, yT, cx + 24, yT, rnd, -0.02, 0.8), { wMax: 7, A0: 0.85, seed: 419 + s });
      stroke(ink, line(cx - 24, yB, cx + 24, yB, rnd, 0.01, 0.6), { wMax: 8, A0: 0.9, seed: 423 + s });
    }
    // 门洞：拱券 + 里面的暗
    stroke(ink, arcPts(S / 2, yB - 22, 30, Math.PI, 2 * Math.PI), { wMax: 8, A0: 0.92, seed: 431 });
    stroke(ink, line(S / 2 - 30, yB - 22, S / 2 - 30, yB, rnd, 0, 0.4), { wMax: 8, A0: 0.9, seed: 433 });
    stroke(ink, line(S / 2 + 30, yB - 22, S / 2 + 30, yB, rnd, 0, 0.4), { wMax: 8, A0: 0.9, seed: 434 });
    washTrap(ink, S / 2, yB - 46, 22, yB, 27, rnd, { A0: 0.66, fwTarget: 0.22 });
    // 门上飞檐：这一笔决定它像不像关
    roof(ink, S / 2, yT - 6, [78, 72, 84][v % 3], [26, 22, 30][v % 3], rnd, 450 + v * 9);
    // 两翼城垣没入画外
    for (const s of [-1, 1]) {
      stroke(ink, line(S / 2 + s * 86, yB - 26, S / 2 + s * [124, 112, 136][v % 3], yB - 14, rnd, 0.06, 2),
        { wMax: 7, aProf: APROF.dry, A0: 0.7, fwTarget: 0.3, seed: 461 + s + v });
    }
    return { ink };
  },
  /** 谷道：两峰夹一线栈道 */
  pass: (v = 0) => {
    const rnd = rng(51 + v * 101), ink = field();
    const yB = 208;
    const peak = (cx, top, hw, seed) => {
      stroke(ink, line(cx - hw, yB, cx, top, rnd, 0.06, 2.4),
        { wMax: 9, wProf: WPROF.fupi, aProf: APROF.dry, lProf: LPROF_SIDE,
          A0: 0.85, fwTarget: 0.26, seed });
      stroke(ink, line(cx, top, cx + hw, yB, rnd, -0.06, 2.4),
        { wMax: 9, wProf: WPROF.fupi, aProf: APROF.dry, lProf: LPROF_SIDE,
          A0: 0.85, fwTarget: 0.26, seed: seed + 1 });
      // 一道皴
      stroke(ink, line(cx + hw * 0.18, top + 26, cx + hw * 0.5, yB - 16, rnd, 0.1, 3),
        { wMax: 5, wProf: WPROF.fupiSmall, aProf: APROF.dry, A0: 0.6,
          fwTarget: 0.36, seed: seed + 2 });
    };
    peak(S / 2 - 46, [76, 88][v % 2], [52, 46][v % 2], 511 + v * 3);
    peak(S / 2 + [52, 46][v % 2], [100, 82][v % 2], [46, 54][v % 2], 521 + v * 3);
    // 栈道：一条淡线从两峰之间穿过
    stroke(ink, arcSpine(S / 2 - 96, yB - 8, -0.12, 190, 0.16, 2, rnd),
      { wMax: 6, aProf: APROF.dry, A0: 0.55, fwTarget: 0.4, seed: 531 });
    return { ink };
  },
  /** 渡口：一叶舟系于岸，下有水波 */
  ford: (v = 0) => {
    const rnd = rng(61 + v * 113), ink = field();
    const yW = 176;
    for (let i = 0; i < 3; i += 1) {
      stroke(ink, arcSpine(PAD + 10, yW + 22 + i * 16, 0.03, S - PAD * 2 - 20, 0.1 * (i % 2 ? -1 : 1), 3, rnd),
        { wMax: 5, aProf: APROF.dry, A0: 0.5 - i * 0.08, fwTarget: 0.42, seed: 611 + i });
    }
    // 舟身
    stroke(ink, arcSpine(S / 2 - 74, yW - 6, 0.02, 148, 0.42, 1.2, rnd),
      { wMax: 9, wProf: WPROF.yudian, A0: 0.9, seed: 621 });
    stroke(ink, line(S / 2 - 66, yW - 22, S / 2 + 66, yW - 22, rnd, -0.02, 1),
      { wMax: 6, A0: 0.78, seed: 622 });
    // 篙
    stroke(ink, line(S / 2 + [10, -14][v % 2], yW - 24, S / 2 + [34, -28][v % 2], [86, 96][v % 2],
      rnd, 0.03, 1.5), { wMax: 5, A0: 0.8, seed: 623 + v });
    return { ink };
  },
  /** 港口：舟张帆，帆上有篷骨 */
  port: (v = 0) => {
    const rnd = rng(71 + v * 127), ink = field();
    const yW = 186;
    for (let i = 0; i < 3; i += 1) {
      stroke(ink, arcSpine(PAD + 10, yW + 18 + i * 15, -0.03, S - PAD * 2 - 20, 0.1 * (i % 2 ? 1 : -1), 3, rnd),
        { wMax: 5, aProf: APROF.dry, A0: 0.5 - i * 0.08, fwTarget: 0.42, seed: 711 + i });
    }
    stroke(ink, arcSpine(S / 2 - 76, yW - 8, 0.02, 152, 0.42, 1.2, rnd),
      { wMax: 9, wProf: WPROF.yudian, A0: 0.9, seed: 721 });
    // 桅与帆
    stroke(ink, line(S / 2 - 14, yW - 20, S / 2 - 14, 58, rnd, 0, 0.8), { wMax: 6, A0: 0.86, seed: 722 });
    // 帆：桅上一片，前缘直、后缘鼓
    stroke(ink, line(S / 2 - 12, 62, S / 2 + 52, 84, rnd, -0.04, 1), { wMax: 6, A0: 0.82, seed: 723 });
    stroke(ink, arcSpine(S / 2 + 52, 84, 1.32, yW - 118, -0.28, 1.5, rnd), { wMax: 6, A0: 0.8, seed: 724 });
    stroke(ink, line(S / 2 - 12, yW - 26, S / 2 + 40, yW - 34, rnd, 0.03, 1), { wMax: 6, A0: 0.8, seed: 725 });
    washTrap(ink, S / 2 + 18, 74, 30, yW - 32, 26, rnd, { A0: 0.3 });
    for (let i = 1; i <= 3; i += 1) {
      const y = 62 + (yW - 88) * (i / 4);
      stroke(ink, line(S / 2 - 12, y, S / 2 + 46 - i * 5, y + 6, rnd, 0.02, 1),
        { wMax: 4, aProf: APROF.dry, A0: 0.55, fwTarget: 0.4, seed: 730 + i });
    }
    return { ink };
  },
  /** 粮仓：圆囷两座，笠顶 */
  depot: (v = 0) => {
    const rnd = rng(81 + v * 131), ink = field();
    const yB = 206;
    const bin = (cx, top, hw, seed) => {
      // 笠顶：半圆券压出来的斗笠，两侧出檐
      stroke(ink, arcPts(cx, top + 18, hw * 1.05, Math.PI + 0.25, 2 * Math.PI - 0.25),
        { wMax: 8, A0: 0.88, seed });
      washTrap(ink, cx, top + 2, hw * 0.2, top + 18, hw * 1.0, rnd, { A0: 0.4 });
      stroke(ink, line(cx - hw * 0.82, top + 18, cx - hw * 0.82, yB, rnd, -0.03, 0.8),
        { wMax: 7, A0: 0.85, seed: seed + 1 });
      stroke(ink, line(cx + hw * 0.82, top + 18, cx + hw * 0.82, yB, rnd, 0.03, 0.8),
        { wMax: 7, A0: 0.85, seed: seed + 2 });
      stroke(ink, arcSpine(cx - hw * 0.82, yB, 0, hw * 1.64, 0.22, 1, rnd),
        { wMax: 7, A0: 0.86, seed: seed + 3 });
      stroke(ink, arcSpine(cx - hw * 0.7, yB - 34, 0.02, hw * 1.4, 0.12, 1.2, rnd),
        { wMax: 5, aProf: APROF.dry, A0: 0.55, fwTarget: 0.35, seed: seed + 4 });
    };
    bin(S / 2 - 40, [96, 104][v % 2], [40, 34][v % 2], 811 + v * 3);
    bin(S / 2 + [46, 40][v % 2], [116, 98][v % 2], [32, 38][v % 2], 821 + v * 3);
    return { ink };
  },
  /** 古战场：折戟交叉，一支的锋已断 */
  battlefield: (v = 0) => {
    const rnd = rng(91 + v * 137), ink = field();
    stroke(ink, line(PAD + 34, S - PAD - 34, S - PAD - 40, PAD + 46, rnd, 0.03, 1.6),
      { wMax: 9, wProf: WPROF.fupi, A0: 0.9, seed: 911 });
    stroke(ink, line(S - PAD - 34, S - PAD - 34, PAD + 52, PAD + 54, rnd, -0.03, 1.6),
      { wMax: 8, wProf: WPROF.fupi, aProf: APROF.dry, A0: 0.78, fwTarget: 0.3, seed: 912 });
    // 月牙刃
    stroke(ink, arcSpine(S - PAD - 44, PAD + 50, 2.2, 62, 0.8, 2, rnd),
      { wMax: 7, A0: 0.85, seed: 913 });
    // 断口
    stroke(ink, line(PAD + 52, PAD + 54, PAD + 74, PAD + 44, rnd, 0, 1),
      { wMax: 6, A0: 0.7, seed: 914 });
    return { ink };
  },
  /** 官府：双阙夹门，上覆一道檐。城中之城 */
  "b-office": () => {
    const rnd = rng(1201), ink = field();
    const yB = 200, yT = 116, cx = S / 2;
    for (const sgn of [-1, 1]) {
      const x = cx + sgn * 52;
      stroke(ink, line(x - 20, yT, x - 20, yB, rnd, 0, 0.6), { wMax: 8, A0: 0.88, seed: 1210 + sgn });
      stroke(ink, line(x + 20, yT, x + 20, yB, rnd, 0, 0.6), { wMax: 8, A0: 0.88, seed: 1214 + sgn });
      stroke(ink, line(x - 20, yB, x + 20, yB, rnd, 0.01, 0.5), { wMax: 8, A0: 0.9, seed: 1218 + sgn });
    }
    stroke(ink, arcPts(cx, yB - 20, 26, Math.PI, 2 * Math.PI), { wMax: 8, A0: 0.9, seed: 1222 });
    washTrap(ink, cx, yB - 42, 20, yB, 24, rnd, { A0: 0.6 });
    roof(ink, cx, yT - 8, 84, 28, rnd, 1230);
    return { ink };
  },
  /** 仓廪：一座圆囷，笠顶。与粮仓同形而小一号——它是城里的，不是路上的 */
  "b-granary": () => {
    const rnd = rng(1301), ink = field();
    const yB = 202, top = 96, hw = 52, cx = S / 2;
    stroke(ink, arcPts(cx, top + 20, hw * 1.05, Math.PI + 0.22, 2 * Math.PI - 0.22),
      { wMax: 9, A0: 0.9, seed: 1310 });
    washTrap(ink, cx, top + 4, hw * 0.2, top + 20, hw, rnd, { A0: 0.42 });
    stroke(ink, line(cx - hw * 0.8, top + 22, cx - hw * 0.8, yB, rnd, -0.03, 0.8), { wMax: 8, A0: 0.88, seed: 1311 });
    stroke(ink, line(cx + hw * 0.8, top + 22, cx + hw * 0.8, yB, rnd, 0.03, 0.8), { wMax: 8, A0: 0.88, seed: 1312 });
    stroke(ink, arcPts(cx, yB - 6, hw * 0.8, 0.15, Math.PI - 0.15), { wMax: 8, A0: 0.88, seed: 1313 });
    stroke(ink, arcPts(cx, yB - 52, hw * 0.72, 0.2, Math.PI - 0.2),
      { wMax: 5, aProf: APROF.dry, A0: 0.55, fwTarget: 0.36, seed: 1314 });
    return { ink };
  },
  /** 市：market。一杆幡旗，下有摊案 */
  "b-market": () => {
    const rnd = rng(1401), ink = field();
    const yB = 198, cx = S / 2;
    stroke(ink, line(cx - 14, yB, cx - 14, PAD + 8, rnd, 0, 0.6), { wMax: 8, A0: 0.9, seed: 1410 });
    // 幡：竖长一幅，下端开衩
    stroke(ink, line(cx - 12, PAD + 14, cx + 54, PAD + 26, rnd, -0.03, 1), { wMax: 7, A0: 0.85, seed: 1411 });
    stroke(ink, arcSpine(cx + 54, PAD + 26, 1.42, 92, -0.22, 2, rnd), { wMax: 6, A0: 0.8, seed: 1412 });
    stroke(ink, line(cx - 12, PAD + 110, cx + 44, PAD + 120, rnd, 0.04, 1.5), { wMax: 6, A0: 0.8, seed: 1413 });
    washTrap(ink, cx + 20, PAD + 24, 34, PAD + 116, 28, rnd, { A0: 0.3 });
    // 摊案
    stroke(ink, line(cx - 74, yB - 34, cx + 74, yB - 34, rnd, -0.015, 0.6), { wMax: 9, A0: 0.9, seed: 1414 });
    stroke(ink, line(cx - 62, yB - 34, cx - 62, yB, rnd, 0, 0.5), { wMax: 7, A0: 0.85, seed: 1415 });
    stroke(ink, line(cx + 62, yB - 34, cx + 62, yB, rnd, 0, 0.5), { wMax: 7, A0: 0.85, seed: 1416 });
    return { ink };
  },
  /** 校场：箭靶与两支箭 */
  "b-drill": () => {
    const rnd = rng(1501), ink = field();
    const cx = S / 2, cy = 150;
    for (const r of [66, 44, 22]) {
      stroke(ink, arcPts(cx, cy, r, 0, Math.PI * 2, 26),
        { wMax: r > 50 ? 8 : 6, A0: 0.86, seed: 1510 + r });
    }
    // 靶架
    stroke(ink, line(cx - 40, cy + 66, cx - 58, 214, rnd, 0.03, 1), { wMax: 7, A0: 0.82, seed: 1520 });
    stroke(ink, line(cx + 40, cy + 66, cx + 58, 214, rnd, -0.03, 1), { wMax: 7, A0: 0.82, seed: 1521 });
    // 一支箭插在靶上
    stroke(ink, line(cx + 96, cy - 62, cx + 8, cy - 6, rnd, 0.02, 1), { wMax: 6, A0: 0.9, seed: 1522 });
    stroke(ink, line(cx + 96, cy - 62, cx + 76, cy - 68, rnd, 0, 0.6), { wMax: 5, A0: 0.8, seed: 1523 });
    stroke(ink, line(cx + 96, cy - 62, cx + 90, cy - 42, rnd, 0, 0.6), { wMax: 5, A0: 0.8, seed: 1524 });
    return { ink };
  },
  /** 铁官：炉，炉口见火，上出烟 */
  "b-ironworks": () => {
    const rnd = rng(1601), ink = field();
    const yB = 206, cx = S / 2;
    stroke(ink, line(cx - 56, yB, cx - 44, 108, rnd, -0.03, 0.8), { wMax: 9, A0: 0.9, seed: 1610 });
    stroke(ink, line(cx + 56, yB, cx + 44, 108, rnd, 0.03, 0.8), { wMax: 9, A0: 0.9, seed: 1611 });
    stroke(ink, line(cx - 44, 108, cx + 44, 108, rnd, -0.02, 0.6), { wMax: 8, A0: 0.88, seed: 1612 });
    stroke(ink, line(cx - 56, yB, cx + 56, yB, rnd, 0.01, 0.5), { wMax: 9, A0: 0.9, seed: 1613 });
    // 炉口
    stroke(ink, arcPts(cx, yB - 18, 24, Math.PI, 2 * Math.PI), { wMax: 7, A0: 0.9, seed: 1614 });
    washTrap(ink, cx, yB - 40, 18, yB, 22, rnd, { A0: 0.72 });
    // 烟
    for (let i = 0; i < 3; i += 1) {
      stroke(ink, arcSpine(cx - 10 + i * 4, 100 - i * 8, -1.5, 64 - i * 10,
        0.3 * (i % 2 ? 1 : -1), 4, rnd),
        { wMax: 5, aProf: APROF.dry, A0: 0.4, fwTarget: 0.5, seed: 1620 + i });
    }
    return { ink };
  },
  /** 盐场：盐畦。方格畦田，畦上留白如盐 */
  "b-saltern": () => {
    const rnd = rng(1701), ink = field();
    const x0 = PAD + 16, x1 = S - PAD - 16, y0 = 118, y1 = 208;
    for (let i = 0; i <= 3; i += 1) {
      const y = y0 + ((y1 - y0) * i) / 3;
      stroke(ink, line(x0 + i * 6, y, x1 - i * 6, y, rnd, -0.01, 0.6), { wMax: 7, A0: 0.85, seed: 1710 + i });
    }
    for (let i = 0; i <= 3; i += 1) {
      const t = i / 3;
      stroke(ink, line(x0 + (x1 - x0) * t, y0, x0 + 6 + (x1 - x0 - 12) * t, y1, rnd, 0, 0.6),
        { wMax: 6, A0: 0.8, seed: 1720 + i });
    }
    // 畦上几点盐，用极干的笔
    for (let i = 0; i < 5; i += 1) {
      const x = x0 + 20 + i * 38, y = y0 + 14 + (i % 2) * 30;
      stroke(ink, line(x, y, x + 12, y + 2, rnd, 0, 1),
        { wMax: 4, aProf: APROF.dry, A0: 0.4, fwTarget: 0.5, seed: 1730 + i });
    }
    return { ink };
  },
  /** 马苑：一圈栅栏，栏后一个马首 */
  "b-stud": () => {
    const rnd = rng(1801), ink = field();
    const yB = 200, yT = 150, x0 = PAD + 14, x1 = S - PAD - 14;
    stroke(ink, line(x0, yT, x1, yT, rnd, -0.015, 0.8), { wMax: 8, A0: 0.86, seed: 1810 });
    stroke(ink, line(x0, yT + 26, x1, yT + 26, rnd, 0.015, 0.8), { wMax: 7, A0: 0.82, seed: 1811 });
    for (let i = 0; i <= 6; i += 1) {
      const x = x0 + ((x1 - x0) * i) / 6;
      stroke(ink, line(x, yT - 14, x, yB, rnd, 0, 0.5), { wMax: 6, A0: 0.84, seed: 1820 + i });
    }
    // 马首：颈、鬃、口
    stroke(ink, arcSpine(S / 2 - 34, yT - 10, -1.15, 84, 0.28, 2, rnd), { wMax: 10, A0: 0.9, seed: 1830 });
    stroke(ink, arcSpine(S / 2 - 6, 78, -0.35, 46, 0.35, 2, rnd), { wMax: 8, A0: 0.88, seed: 1831 });
    stroke(ink, arcSpine(S / 2 - 40, 92, 0.6, 52, -0.4, 3, rnd),
      { wMax: 6, aProf: APROF.dry, A0: 0.6, fwTarget: 0.4, seed: 1832 });
    return { ink };
  },
  /** 屯田：田字畦，畦上出禾 */
  "b-farmstead": () => {
    const rnd = rng(1901), ink = field();
    const x0 = PAD + 18, x1 = S - PAD - 18, y0 = 128, y1 = 206;
    stroke(ink, line(x0, y0, x1, y0, rnd, -0.015, 0.6), { wMax: 8, A0: 0.86, seed: 1910 });
    stroke(ink, line(x0, y1, x1, y1, rnd, 0.015, 0.6), { wMax: 8, A0: 0.86, seed: 1911 });
    stroke(ink, line(x0, y0, x0, y1, rnd, 0, 0.6), { wMax: 7, A0: 0.84, seed: 1912 });
    stroke(ink, line(x1, y0, x1, y1, rnd, 0, 0.6), { wMax: 7, A0: 0.84, seed: 1913 });
    stroke(ink, line(S / 2, y0, S / 2, y1, rnd, 0, 0.6), { wMax: 6, A0: 0.8, seed: 1914 });
    stroke(ink, line(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, rnd, 0, 0.6), { wMax: 6, A0: 0.8, seed: 1915 });
    // 禾：四丛
    for (let i = 0; i < 4; i += 1) {
      const x = x0 + 34 + i * 46;
      for (const d of [-1, 0, 1]) {
        stroke(ink, arcSpine(x, y0 - 6, -Math.PI / 2 + d * 0.4, 38 - Math.abs(d) * 10, 0.2 * d, 3, rnd),
          { wMax: 5, wProf: WPROF.fupiSmall, aProf: APROF.dry, A0: 0.62, fwTarget: 0.36,
            seed: 1920 + i * 3 + d });
      }
    }
    return { ink };
  },
  /** 步卒：戟与盾 */
  "u-infantry": () => {
    const rnd = rng(2101), ink = field();
    const cx = S / 2;
    // 长戟
    stroke(ink, line(cx + 34, 214, cx + 20, PAD + 10, rnd, 0.02, 1), { wMax: 10, A0: 0.92, seed: 2110 });
    stroke(ink, arcSpine(cx + 20, PAD + 22, -0.5, 56, 0.7, 2, rnd), { wMax: 8, A0: 0.88, seed: 2111 });
    // 盾：上圆下尖
    stroke(ink, arcPts(cx - 44, 130, 46, Math.PI + 0.15, 2 * Math.PI - 0.15), { wMax: 9, A0: 0.9, seed: 2112 });
    stroke(ink, line(cx - 88, 132, cx - 44, 210, rnd, 0.03, 1), { wMax: 9, A0: 0.9, seed: 2113 });
    stroke(ink, line(cx, 132, cx - 44, 210, rnd, -0.03, 1), { wMax: 9, A0: 0.9, seed: 2114 });
    washTrap(ink, cx - 44, 110, 30, 196, 22, rnd, { A0: 0.32 });
    return { ink };
  },
  /** 骑兵：一个马首，鬃尾飞扬 */
  "u-cavalry": () => {
    const rnd = rng(2201), ink = field();
    const cx = S / 2 + 10;
    stroke(ink, arcSpine(cx - 40, 214, -1.2, 116, 0.3, 2, rnd), { wMax: 13, A0: 0.92, seed: 2210 });
    stroke(ink, arcSpine(cx + 6, 96, -0.32, 62, 0.4, 2, rnd), { wMax: 11, A0: 0.9, seed: 2211 });
    // 鬃
    for (let i = 0; i < 4; i += 1) {
      stroke(ink, arcSpine(cx - 22 + i * 12, 104 + i * 12, 2.4, 54 - i * 6, -0.35, 4, rnd),
        { wMax: 7, wProf: WPROF.fupiSmall, aProf: APROF.dry, A0: 0.7, fwTarget: 0.36, seed: 2220 + i });
    }
    // 口鼻
    stroke(ink, line(cx + 58, 118, cx + 76, 128, rnd, 0, 1), { wMax: 6, A0: 0.8, seed: 2230 });
    return { ink };
  },
  /** 弓弩：一张开满的弓 */
  "u-archer": () => {
    const rnd = rng(2301), ink = field();
    const cx = S / 2 - 12;
    stroke(ink, arcPts(cx, 150, 82, -Math.PI / 2 - 1.15, -Math.PI / 2 + 1.15, 22),
      { wMax: 11, A0: 0.92, seed: 2310 });
    // 弦
    stroke(ink, line(cx + 32, 76, cx + 32, 224, rnd, 0, 0.4), { wMax: 5, A0: 0.8, seed: 2311 });
    // 箭
    stroke(ink, line(cx + 30, 150, cx - 76, 150, rnd, 0, 0.6), { wMax: 7, A0: 0.9, seed: 2312 });
    stroke(ink, line(cx - 76, 150, cx - 56, 140, rnd, 0, 0.5), { wMax: 5, A0: 0.85, seed: 2313 });
    stroke(ink, line(cx - 76, 150, cx - 56, 160, rnd, 0, 0.5), { wMax: 5, A0: 0.85, seed: 2314 });
    return { ink };
  },
  /** 水军：一叶楼船，舷上张帆 */
  "u-navy": () => {
    const rnd = rng(2401), ink = field();
    const yW = 190, cx = S / 2;
    for (let i = 0; i < 2; i += 1) {
      stroke(ink, arcSpine(PAD + 8, yW + 20 + i * 16, -0.02, S - PAD * 2 - 16, 0.1 * (i % 2 ? 1 : -1), 3, rnd),
        { wMax: 5, aProf: APROF.dry, A0: 0.48, fwTarget: 0.42, seed: 2410 + i });
    }
    stroke(ink, arcSpine(cx - 84, yW - 10, 0.02, 168, 0.4, 1.2, rnd),
      { wMax: 11, wProf: WPROF.yudian, A0: 0.92, seed: 2420 });
    // 舱楼
    stroke(ink, line(cx - 34, yW - 26, cx - 34, 108, rnd, 0, 0.6), { wMax: 8, A0: 0.88, seed: 2421 });
    stroke(ink, line(cx + 34, yW - 26, cx + 34, 108, rnd, 0, 0.6), { wMax: 8, A0: 0.88, seed: 2422 });
    roof(ink, cx, 108, 52, 22, rnd, 2430);
    return { ink };
  },
  /** 冲车：带轮的撞木，前端包铁 */
  "g-ram": () => {
    const rnd = rng(2501), ink = field();
    const cy = 150;
    stroke(ink, line(PAD + 10, cy, S - PAD - 40, cy, rnd, -0.015, 0.6), { wMax: 16, A0: 0.9, seed: 2510 });
    washTrap(ink, S - PAD - 46, cy - 22, 16, cy + 22, 16, rnd, { A0: 0.66 });
    stroke(ink, line(S - PAD - 62, cy - 24, S - PAD - 62, cy + 24, rnd, 0, 0.4), { wMax: 8, A0: 0.9, seed: 2511 });
    for (const x of [PAD + 44, S / 2 + 6]) {
      stroke(ink, arcPts(x, cy + 54, 30, 0, Math.PI * 2, 20), { wMax: 8, A0: 0.88, seed: 2520 + x });
      stroke(ink, line(x, cy + 24, x, cy + 54, rnd, 0, 0.4), { wMax: 6, A0: 0.82, seed: 2530 + x });
    }
    return { ink };
  },
  /** 土山：垒土成坡，坡上有人往上运土 */
  "g-mound": () => {
    const rnd = rng(2601), ink = field();
    const yB = 208;
    stroke(ink, arcSpine(PAD + 6, yB, -0.42, 200, -0.2, 2, rnd),
      { wMax: 12, wProf: WPROF.fupi, aProf: APROF.dry, lProf: LPROF_SIDE,
        A0: 0.9, fwTarget: 0.22, seed: 2610 });
    stroke(ink, line(PAD + 6, yB, S - PAD - 6, yB, rnd, 0.01, 0.5), { wMax: 9, A0: 0.88, seed: 2611 });
    stroke(ink, line(S - PAD - 40, yB, S - PAD - 40, 96, rnd, 0, 0.6), { wMax: 8, A0: 0.86, seed: 2612 });
    washTrap(ink, S / 2 - 6, 108, 24, yB, 96, rnd, { A0: 0.3 });
    // 两筐土
    for (const [x, y] of [[110, 148], [150, 122]]) {
      stroke(ink, arcPts(x, y, 16, 0, Math.PI, 12), { wMax: 6, A0: 0.8, seed: 2620 + x });
    }
    return { ink };
  },
  /** 行营：一顶尖帐，帐顶出旗 */
  tent: (v = 0) => {
    const rnd = rng(101 + v * 139), ink = field(), wa = field();
    const yB = 198, apex = [96, 88][v % 2];
    wash(wa, S / 2 - 58, apex + 26, S / 2 + 58, yB - 6, rng(102));
    stroke(ink, line(S / 2 - 72, yB, S / 2, apex, rnd, 0.04, 1.4), { wMax: 9, A0: 0.9, seed: 1011 });
    stroke(ink, line(S / 2 + 72, yB, S / 2, apex, rnd, -0.04, 1.4), { wMax: 9, A0: 0.9, seed: 1012 });
    stroke(ink, arcSpine(S / 2 - 74, yB, 0.02, 148, 0.18, 1, rnd), { wMax: 8, A0: 0.88, seed: 1013 });
    // 帐门
    stroke(ink, line(S / 2 - 14, yB, S / 2 - 6, apex + 44, rnd, 0.04, 1), { wMax: 6, A0: 0.7, seed: 1014 });
    stroke(ink, line(S / 2 + 14, yB, S / 2 + 6, apex + 44, rnd, -0.04, 1), { wMax: 6, A0: 0.7, seed: 1015 });
    // 旗杆与旗
    stroke(ink, line(S / 2, apex, S / 2, PAD + 4, rnd, 0, 0.6), { wMax: 6, A0: 0.88, seed: 1016 });
    stroke(ink, arcSpine(S / 2, PAD + 8, 0.15, 56, 0.5, 2, rnd), { wMax: 7, A0: 0.8, seed: 1017 });
    stroke(ink, arcSpine(S / 2, PAD + 34, -0.12, 50, -0.4, 2, rnd), { wMax: 6, A0: 0.75, seed: 1018 });
    return { ink, wash: wa };
  },
  /** 营垒：一段栅栏，后有帐脊 */
  camp: (v = 0) => {
    const rnd = rng(111 + v * 149), ink = field(), wa = field();
    const yB = 196, yT = [128, 136][v % 2];
    wash(wa, PAD + 22, yT + 8, S - PAD - 22, yB - 6, rng(112));
    stroke(ink, line(PAD + 18, yB, S - PAD - 18, yB, rnd, 0.01, 0.8), { wMax: 8, A0: 0.9, seed: 1111 });
    stroke(ink, line(PAD + 18, yT, S - PAD - 18, yT, rnd, -0.015, 1), { wMax: 7, A0: 0.85, seed: 1112 });
    for (let i = 0; i <= 5; i += 1) {
      const x = PAD + 18 + ((S - PAD * 2 - 36) * i) / 5;
      stroke(ink, line(x, yT - 22, x, yB, rnd, 0, 0.8), { wMax: 6, A0: 0.82, seed: 1120 + i });
    }
    // 栅后两顶帐脊，露出来一点
    for (const s of [-1, 1]) {
      stroke(ink, line(S / 2 + s * 46 - 26, yT - 6, S / 2 + s * 46, yT - 40, rnd, 0.04, 1.4),
        { wMax: 6, A0: 0.7, seed: 1131 + s });
      stroke(ink, line(S / 2 + s * 46 + 26, yT - 6, S / 2 + s * 46, yT - 40, rnd, -0.04, 1.4),
        { wMax: 6, A0: 0.7, seed: 1135 + s });
    }
    return { ink, wash: wa };
  },
};

// ── 出图 ────────────────────────────────────────────────────────────
// 墨深转 alpha 用与底图同一条曲线（render-terrain-map.mjs 的
// 1 - exp(-1.15·D)），两边的墨色才是同一种黑
const toAlpha = (d) => Math.min(0.96, 1 - Math.exp(-1.15 * d));

async function writePng(D, file, rgb) {
  const buf = Buffer.alloc(S * S * 4);
  for (let i = 0; i < S * S; i += 1) {
    const a = toAlpha(D[i]);
    buf[i * 4] = rgb[0]; buf[i * 4 + 1] = rgb[1]; buf[i * 4 + 2] = rgb[2];
    buf[i * 4 + 3] = Math.round(a * 255);
  }
  await sharp(buf, { raw: { width: S, height: S, channels: 4 } }).png().toFile(file);
}

/** 各出几幅。城最多——图上出现得最多的就是它 */
const VARIANTS = {
  "city-small": 3, "city-large": 3, "city-seat": 2,
  gate: 3, pass: 2, ford: 2, port: 2, depot: 2, battlefield: 2, tent: 2, camp: 2,
  // 建筑各出一幅：它们在图上只有指甲盖大，多出变体也分不出来
  "b-office": 1, "b-granary": 1, "b-market": 1, "b-drill": 1,
  "b-ironworks": 1, "b-saltern": 1, "b-stud": 1, "b-farmstead": 1,
  // 兵种与器械：军团上的小标
  "u-infantry": 1, "u-cavalry": 1, "u-archer": 1, "u-navy": 1,
  "g-ram": 1, "g-mound": 1,
};

fs.mkdirSync(OUT, { recursive: true });
const manifest = {
  note: "图上符号，由 tools/render-map-glyphs.mjs 用 brush.mjs 渲出，勿手改。",
  size: S, base: 0.82, variants: VARIANTS, glyphs: {},
};
for (const [id, make] of Object.entries(GLYPHS)) {
  const n = VARIANTS[id] ?? 1;
  let kb = 0;
  for (let v = 0; v < n; v += 1) {
    const { ink, wash: wa } = make(v);
    await writePng(ink, path.join(OUT, `${id}-${v}-ink.png`), [43, 37, 30]);
    if (wa) await writePng(wa, path.join(OUT, `${id}-${v}-wash.png`), [255, 255, 255]);
    kb += fs.statSync(path.join(OUT, `${id}-${v}-ink.png`)).size / 1024;
  }
  manifest.glyphs[id] = { variants: n, wash: !!make(0).wash };
  console.log(`→ ${id}　${n} 幅　${kb.toFixed(0)}KB`);
}
fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
const total = Object.values(VARIANTS).reduce((a, b) => a + b, 0);
console.log(`\n共 ${Object.keys(GLYPHS).length} 类 ${total} 幅 → ${OUT}`);
