// 程序化皴笔：单笔 = 带宽度曲线 + 横向墨度剖面 + 飞白车道 + 笔缘抖动的一条曲线。
// 全部落进 Float32 光学深度场，最后统一 alpha = 1 - exp(-k·D)。
//
// 为什么不用古画裁片做图章：public/game/ink/ 那 31 枚是 extract-cun.mjs 用
// `energy × isotropy³` 选出来的，那一项是无差别的方向性惩罚——它本意是压掉
// 扫描条纹，实际把「方向在整块内一致」的候选全筛掉了，留下的是方向互相抵消
// 的乱纹区（实测全局 coherence 0.02–0.09）。落到图上是圆噪点盘不是笔。
// 实测更糟：带图章的成图 coherence 0.226，反而低于不施皴的 0.259——
// 84–147px 的圆盘径向羽化把底图墨染本来带的方向也糊掉了，是净负贡献。
//
// 换成「把打分改成结构张量相干度、重新提取」也不行：相干度是涨了五倍，
// 但选出来的是《富春山居图》卷后题跋的行书与《万壑松风图》的水波纹，
// 秦岭上能直接认出「授之師」的钩画。这是信息层面的界限，不是阈值没调好。
import { hash } from "./ink-canvas.mjs";

// ── 确定性随机流 ────────────────────────────────────────────────────
export function rng(seed) {
  let s = (seed | 0) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export const gauss = (rnd) => {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// ── 一维值噪声（车道断墨 / 笔缘抖动共用）─────────────────────────────
const smooth = (t) => t * t * (3 - 2 * t);
export function vnoise1(x, seed) {
  const xi = Math.floor(x), u = smooth(x - xi);
  return hash(xi, 0, seed) * (1 - u) + hash(xi + 1, 0, seed) * u;
}
/** 可配置增益的 1D fbm。gain=0.88 → H≈0.18（实测值），gain=0.5 → H=1（旧版，太平滑）*/
export function fbm1(x, seed, oct = 5, gain = 0.88) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < oct; o += 1) {
    sum += vnoise1(x * f, seed + o * 131) * amp;
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}
export function vnoise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  return hash(xi, yi, seed) * (1 - u) * (1 - v) + hash(xi + 1, yi, seed) * u * (1 - v)
       + hash(xi, yi + 1, seed) * (1 - u) * v + hash(xi + 1, yi + 1, seed) * u * v;
}
export function fbm2(x, y, seed, oct = 5, gain = 0.88) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < oct; o += 1) {
    sum += vnoise2(x * f, y * f, seed + o * 131) * amp;
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}

// ── Catmull-Rom 剖面 → 256 格 LUT ───────────────────────────────────
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
export function profileLUT(ctrl, n = 256) {
  const xs = ctrl.map((c) => c[0]), ys = ctrl.map((c) => c[1]);
  const lut = new Float32Array(n + 1);
  for (let k = 0; k <= n; k += 1) {
    const t = k / n;
    let seg = 0;
    while (seg < xs.length - 2 && t > xs[seg + 1]) seg += 1;
    const x1 = xs[seg], x2 = xs[seg + 1];
    const u = x2 > x1 ? (t - x1) / (x2 - x1) : 0;
    const y0 = ys[Math.max(0, seg - 1)], y1 = ys[seg], y2 = ys[seg + 1];
    const y3 = ys[Math.min(ys.length - 1, seg + 2)];
    lut[k] = Math.max(0, catmull(y0, y1, y2, y3, Math.min(1, Math.max(0, u))));
  }
  return lut;
}
export const sampleLUT = (lut, t) => {
  const n = lut.length - 1;
  const f = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(n - 1, f | 0), r = f - i;
  return lut[i] * (1 - r) + lut[i + 1] * r;
};

// ── 宽度曲线（第 6 条）───────────────────────────────────────────────
export const WPROF = {
  // 披麻：铁线型「圆头—匀行—提尖」
  pima:   profileLUT([[0,0.55],[0.06,1.00],[0.35,0.97],[0.60,0.95],[0.85,0.62],[1,0.12]]),
  // 斧劈：钉头鼠尾
  fupi:   profileLUT([[0,0.82],[0.05,1.00],[0.25,0.88],[0.55,0.62],[0.80,0.36],[1,0.10]]),
  // 雨点：顿—提。考察给的收笔值 0.25 与同一条里「宽度几乎不变、σ/μ=0.10」自相矛盾，
  // 照 0.25 画出来是一地小匕首；这里按「宽度几乎不变」把收笔钝到 0.55。
  yudian: profileLUT([[0,0.80],[0.15,1.00],[0.50,0.97],[0.75,0.88],[1,0.55]]),
  // 小斧劈：钉头鼠尾但鼠尾不拖成针（实测团块长宽比中位仅 2.0–2.1）
  fupiSmall: profileLUT([[0,0.85],[0.06,1.00],[0.30,0.92],[0.60,0.74],[0.85,0.50],[1,0.24]]),
  // 折带横段
  zhedaiH: profileLUT([[0,0.70],[0.10,1.00],[0.85,0.92],[1,0.55]]),
  zhedaiV: profileLUT([[0,0.70],[1,0.20]]),
};
// ── 纵向墨度（第 8 条）──────────────────────────────────────────────
export const APROF = {
  wet: profileLUT([[0,1.00],[0.08,1.05],[0.30,0.90],[0.60,0.74],[0.85,0.58],[1,0.42]]),
  dry: profileLUT([[0,1.00],[0.30,0.72],[0.60,0.50],[1,0.30]]),
};
// ── 横向墨度剖面：n∈[-1,1]，LUT 以 u=(n+1)/2 索引 ────────────────────
// 中锋：对称，大平台 + 快速肩部（不是高斯）。
// 剖面定义在 n∈[-1.15,1.15]（1.15 处才归零），故 LUT 索引 u=(n/1.15+1)/2。
// |n|=0→1.00  0.55→0.86  0.80→0.60  1.00→0.18  1.15→0.00
export const NEXT_CENTER = 1.15;
export const LPROF_CENTER = profileLUT([
  [0.000,0.00],[0.065,0.18],[0.152,0.60],[0.261,0.86],[0.500,1.00],
  [0.739,0.86],[0.848,0.60],[0.935,0.18],[1.000,0.00],
]);
// 侧锋：n=-1 为笔尖硬边（几乎不过渡），n=+1 为笔肚软边
export const LPROF_SIDE = profileLUT([
  [0.000,0.95],[0.060,1.00],[0.350,0.72],[0.650,0.50],[0.900,0.25],[1.000,0.00],
]);

/**
 * 把一笔画进光学深度场。
 * spine: [{x,y}...]（已按需要弯好的骨架，等距无所谓，内部按弧长重采样）
 */
export function strokeInk(D, W, H, spine, opt) {
  const {
    wMax = 4,               // 最大笔宽（全宽，px）
    wProf = WPROF.pima,
    aProf = APROF.wet,
    lProf = LPROF_CENTER,
    A0 = 0.6,               // 基础墨度
    ecc = 0,                // 横向偏心系数（斧劈用；0.18 表示肚侧外凸 0.18*W*t）
    fwTarget = 0.20,        // 飞白面积占比目标
    kd = 0.45,              // 干燥度沿笔身增长
    laneFrac = 0.22,        // 单条车道宽 / 笔宽
    coreFirst = false,      // 中虚外实（笔心先断），侧锋大笔与极枯用
    edgeJit = 0.14,         // 笔缘横向抖动幅度 / 半宽
    seed = 1,
    texAmp = 0.16,          // 笔内墨度调制（笔身尺度）
    grainAmp = 0.30,        // 笔缘/笔内像素尺度近白噪
    mask = null,            // 可选：Float32 遮罩（0..1），按位置乘
    nExt = 1.0,             // 横向剖面的半宽外延（中锋 1.15，剖面在 n=1 处仍有 0.18 的墨）
  } = opt;

  // 弧长参数化
  const cum = [0];
  for (let i = 1; i < spine.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y));
  }
  const L = cum[cum.length - 1];
  if (L < 1) return 0;
  const at = (s) => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k += 1;
    const u = (s - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
    const p0 = spine[k - 1], p1 = spine[k];
    const tx = (p1.x - p0.x) / Math.max(1e-6, cum[k] - cum[k - 1]);
    const ty = (p1.y - p0.y) / Math.max(1e-6, cum[k] - cum[k - 1]);
    return { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u, tx, ty };
  };

  const nLane = Math.max(2, Math.round(1 / laneFrac));
  const lam = (0.8 + (seed % 17) / 17 * 1.7) * wMax;      // 车道噪声特征波长 0.8–2.5 W
  const lamEdge = (0.6 + (seed % 13) / 13 * 0.6) * wMax;
  const dry0 = fwTarget - kd / 2;                          // 噪声近似均匀 → 期望断墨率 = dry0 + kd/2
  const ds = 0.5;
  let deposit = 0;

  for (let s = 0; s <= L; s += ds) {
    const t = s / L;
    const p = at(s);
    const nx = -p.ty, ny = p.tx;                           // 法向
    const half = 0.5 * wMax * sampleLUT(wProf, t);
    if (half < 0.15) continue;
    let aLong = sampleLUT(aProf, t);
    if (t < 0.08) aLong *= 1.15;                            // 起笔顿
    const jit = edgeJit * half * (fbm1(s / lamEdge + 3.3, seed + 909, 4, 0.88) * 2 - 1);
    const off = ecc * wMax * t;
    const dry = dry0 + kd * t;
    const dn = Math.min(0.5, half / 3) / half;              // 横向步长（归一化）
    for (let n = -nExt; n <= nExt + 1e-9; n += dn) {
      const lat = sampleLUT(lProf, (n / nExt + 1) / 2);
      if (lat <= 0.002) continue;
      // 飞白车道：沿笔迹方向的细长「车道」，不是二维噪声打洞
      const k = Math.min(nLane - 1, Math.max(0, Math.floor((n / nExt + 1) / 2 * nLane)));
      const nv = fbm1(s / lam + k * 37.7, seed + k * 71 + 5, 3, 0.7);
      // 中实外虚：边缘车道更易断；中虚外实：笔心先断
      const bias = coreFirst ? (1 - Math.abs(n / nExt)) * 0.22 : Math.abs(n / nExt) * 0.22;
      const f = Math.min(1, Math.max(0, (nv - (dry + bias)) / 0.10));
      if (f <= 0.002) continue;
      const px = p.x + nx * (n * half + jit + off);
      const py = p.y + ny * (n * half + jit + off);
      if (px < 0 || py < 0 || px >= W - 1 || py >= H - 1) continue;
      // 「毛」拆两层：笔身尺度的墨度起伏 + 像素尺度的近白噪笔缘层。
      // 实测原作墨密度场谱斜率只有 0.08–0.20，旧 fbm 的 amp*=0.5（H=1.0）平滑了一个数量级。
      const tex = 1
        + texAmp * (fbm2(px / (wMax * 0.6), py / (wMax * 0.6), seed + 17, 5, 0.88) - 0.5) * 2
        + grainAmp * (fbm2(px * 0.78, py * 0.78, seed + 313, 3, 0.95) - 0.5) * 2;
      let amt = A0 * aLong * lat * f * Math.max(0, tex) * ds * (dn * half);
      if (amt <= 0) continue;
      if (mask) {
        const m = mask[(py | 0) * W + (px | 0)];
        if (m <= 0.01) continue;
        amt *= m;
      }
      // 双线性落墨
      const x0 = px | 0, y0 = py | 0, fx = px - x0, fy = py - y0;
      D[y0 * W + x0] += amt * (1 - fx) * (1 - fy);
      D[y0 * W + x0 + 1] += amt * fx * (1 - fy);
      D[(y0 + 1) * W + x0] += amt * (1 - fx) * fy;
      D[(y0 + 1) * W + x0 + 1] += amt * fx * fy;
      deposit += amt;
    }
  }
  return deposit;
}

/** 单向浅弓骨架：起点 + 方向 + 长度 + 矢高比 + 中途方向抖动 */
export function arcSpine(x0, y0, theta, L, sagRatio, wobbleDeg, rnd, segs = 12) {
  const pts = [];
  // 先在局部坐标（沿 theta 为 x 轴）生成，再旋转
  const sag = sagRatio * L;
  const wob = [];
  for (let k = 0; k < 3; k += 1) wob.push((rnd() - 0.5) * 2 * wobbleDeg * Math.PI / 180);
  for (let k = 0; k <= segs; k += 1) {
    const u = k / segs;
    // 圆弧近似：横向位移 = 4*sag*u*(1-u)
    const lx = u * L;
    const ly = 4 * sag * u * (1 - u);
    // 叠一点分段方向抖动（低频，非 S 形）
    const w = wob[0] * Math.sin(Math.PI * u) + wob[1] * Math.sin(2 * Math.PI * u) * 0.4;
    const wx = lx, wy = ly + w * L * 0.06;
    pts.push({ lx: wx, ly: wy });
  }
  const c = Math.cos(theta), s = Math.sin(theta);
  return pts.map((p) => ({ x: x0 + p.lx * c - p.ly * s, y: y0 + p.lx * s + p.ly * c }));
}

/** 折带骨架：横段 + 向下折段 */
export function bandSpine(x0, y0, theta, Lh, Lv, angDeg) {
  const pts = [];
  const c = Math.cos(theta), s = Math.sin(theta);
  const N = 8;
  for (let k = 0; k <= N; k += 1) pts.push({ x: x0 + (Lh * k / N) * c, y: y0 + (Lh * k / N) * s });
  const ex = pts[pts.length - 1].x, ey = pts[pts.length - 1].y;
  const th2 = theta + angDeg * Math.PI / 180;
  for (let k = 1; k <= 5; k += 1) pts.push({ x: ex + (Lv * k / 5) * Math.cos(th2), y: ey + (Lv * k / 5) * Math.sin(th2) });
  return pts;
}
