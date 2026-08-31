// 地形符号系统 —— 依《华夷图》（1136 年石刻，公有领域）的制图语汇重建。
//
// 关键认识：古舆图画山不画轮廓，而是打「符号」——一个个极小的三峰记号
// 沿山脉走向密集排布，实心浓墨、高对比、大量留白。读图者一眼认出"这是山"，
// 靠的是符号的可辨识度，不是明暗层次。水墨渲染若只做浓淡而无符号系统，
// 就会变成一团读不出含义的墨渍。
//
// 本实现保留该符号逻辑，但每一枚记号内部用真实皴法墨迹调制，兼顾可读性与水墨质感。
import { noise2, fbm, hash } from "./ink-canvas.mjs";

/**
 * 山字符号：中峰高、侧峰低的连体三峰（也可为二峰或四峰）。
 * 返回 t∈[-1,1] 处的高度比例 0..1。
 */
export function glyphProfile(t, humps, seed) {
  const a = Math.abs(t);
  if (a >= 1) return 0;
  let h = 0;
  for (let k = 0; k < humps; k += 1) {
    // 峰位在 [-1,1] 上均布；中间的峰更高，两侧递减
    const center = humps === 1 ? 0 : -1 + (2 * k) / (humps - 1) * 0.82;
    const mid = (humps - 1) / 2;
    const rank = 1 - Math.abs(k - mid) / (mid + 0.85);       // 中峰 1，侧峰递减
    const amp = (0.52 + rank * 0.48) * (0.80 + hash(seed, k, 5) * 0.40);
    // 峰宽收到刚好相邻处触底，峰谷才分明；指数 >1 得尖顶，<1 会成圆馒头
    const width = (0.92 / humps) * (0.86 + hash(seed, k, 9) * 0.34);
    const d = Math.abs(t - center) / width;
    if (d < 1) h = Math.max(h, amp * Math.pow(1 - d, 1.05) * (1 - d * d * 0.25));
  }
  return Math.min(1, h);
}

/** 山脊点：距离场局部极大 + 非极大抑制，串起来即山脉走向 */
export function ridgePoints(dist, cols, rows, match, T, minDist, spacing) {
  const cand = [];
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      const i = r * cols + c;
      if (!match(T[i]) || dist[i] < minDist) continue;
      let isMax = true;
      for (let dr = -1; dr <= 1 && isMax; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (!dr && !dc) continue;
          if (dist[(r + dr) * cols + c + dc] > dist[i] + 1e-6) { isMax = false; break; }
        }
      }
      if (isMax) cand.push({ c, r, d: dist[i] });
    }
  }
  cand.sort((a, b) => b.d - a.d);
  const taken = [];
  for (const p of cand) {
    if (taken.every((q) => Math.hypot(q.c - p.c, q.r - p.r) >= spacing)) taken.push(p);
  }
  return taken;
}

/**
 * 画一枚山符号。近符号压住远符号，形成层叠。
 * cx,baseY 为符号底边中点；width 为底边全宽；height 为中峰高。
 */
export function drawGlyph(rgb, W, H, paper, opts) {
  const { cx, baseY, width, height, seed, tex, humps = 3, weight = 1, haze = 0 } = opts;
  const halfW = width / 2;
  const x0 = Math.max(0, Math.floor(cx - halfW) - 1);
  const x1 = Math.min(W - 1, Math.ceil(cx + halfW) + 1);
  if (x1 <= x0 || height < 1.5) return;

  const top = new Float32Array(x1 - x0 + 1);
  for (let x = x0; x <= x1; x += 1) {
    const t = (x - cx) / halfW;
    const wob = 1 + (noise2(x / 3.4, seed * 0.9, 7) - 0.5) * 0.16;   // 边缘不规整，像刻痕
    top[x - x0] = baseY - glyphProfile(t, humps, seed) * height * wob;
  }

  const put = (x, y, r, g, b, a) => {
    if (a <= 0.004 || x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    rgb[o]     = Math.round(rgb[o]     * (1 - a) + r * a);
    rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + g * a);
    rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + b * a);
  };

  // ① 纸色遮挡：让近处符号压住远处符号，产生层叠纵深
  for (let x = x0; x <= x1; x += 1) {
    const ty = top[x - x0];
    if (baseY - ty < 0.5) continue;
    for (let y = Math.floor(ty) - 1; y <= baseY; y += 1) {
      if (y < 0 || y >= H) continue;
      const o = (y * W + x) * 3;
      const a = 0.88;
      rgb[o]     = Math.round(rgb[o]     * (1 - a) + paper[o]     * a);
      rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + paper[o + 1] * a);
      rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + paper[o + 2] * a);
    }
  }

  // ② 符号本体：实心浓墨。这是「一眼可读」的来源，不能靠淡墨层次代替。
  for (let x = x0; x <= x1; x += 1) {
    const t = (x - cx) / halfW;
    const ty = top[x - x0];
    const colH = baseY - ty;
    if (colH < 0.6) continue;
    for (let y = Math.ceil(ty); y <= baseY; y += 1) {
      if (y < 0 || y >= H) continue;
      const v = (y - ty) / colH;                      // 0 顶 1 底
      // 顶部与脊线最浓，底部略敞开（古图山符底边常不封口）
      let a = weight * (1 - Math.pow(v, 3.0) * 0.32);        // 整体更实，接近石刻的高对比
      if (tex) {                                      // 皴法墨迹调制，保住水墨质感
        const u = Math.min(tex.size - 1, Math.max(0, ((t + 1) / 2) * (tex.size - 1)));
        const w = Math.min(tex.size - 1, Math.max(0, v * (tex.size - 1)));
        a *= 0.68 + (tex.data[(w | 0) * tex.size + (u | 0)] / 255) * 0.62;
      }
      a *= 0.86 + fbm(x / 2.6, y / 2.6, 2, seed + 17) * 0.30;
      put(x, y, 26, 22, 17, Math.min(0.97, a) * (1 - haze));
    }
  }

  // ③ 脊线勾勒：沿峰顶压一道更浓的墨，让轮廓咬得住纸
  for (let x = x0; x <= x1; x += 1) {
    const ty = top[x - x0];
    const t = (x - cx) / halfW;
    if (Math.abs(t) > 0.97 || baseY - ty < 1) continue;
    const wid = Math.max(0.55, height * 0.07);
    for (let k = -wid; k <= wid * 0.4; k += 0.4) {
      const fall = 1 - Math.abs(k) / (wid + 0.5);
      put(x, Math.round(ty + k), 18, 15, 11, fall * fall * 0.9 * weight * (1 - haze * 0.7));
    }
  }
}
