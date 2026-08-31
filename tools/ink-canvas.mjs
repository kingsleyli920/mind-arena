// 水墨画布：像素级墨迹合成引擎。
//
// 不用 SVG 描边（那正是旧版"线条感"的来源），而是模拟宣纸吸墨：
// 每次落笔往墨密度场里累加，最后一次性把密度场映射成颜色。
// 这样多笔叠加会自然产生浓淡层次，而不是一条条独立的线。

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 墨密度场。值域 0..∞，渲染时再压缩到 0..1，因此叠加不会硬性截断 */
export class InkField {
  constructor(width, height) {
    this.w = width; this.h = height;
    this.d = new Float32Array(width * height);
  }
  add(x, y, amount) {
    if (amount <= 0) return;
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    this.d[yi * this.w + xi] += amount;
  }
  /** 双线性落墨，避免整数取整造成的锯齿 */
  addSmooth(x, y, amount) {
    if (amount <= 0) return;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    for (let j = 0; j <= 1; j += 1) {
      for (let i = 0; i <= 1; i += 1) {
        const xx = x0 + i, yy = y0 + j;
        if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
        const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
        this.d[yy * this.w + xx] += amount * wgt;
      }
    }
  }
  get(x, y) {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return 0;
    return this.d[yi * this.w + xi];
  }
  /** 高斯近似模糊，用于模拟墨在纸上的洇散 */
  blur(radius) {
    if (radius < 0.5) return this;
    const pass = (src, dst, w, h, r, horizontal) => {
      const inv = 1 / (2 * r + 1);
      for (let a = 0; a < (horizontal ? h : w); a += 1) {
        let sum = 0;
        const at = (b) => horizontal ? src[a * w + Math.min(w - 1, Math.max(0, b))]
                                     : src[Math.min(h - 1, Math.max(0, b)) * w + a];
        for (let k = -r; k <= r; k += 1) sum += at(k);
        const len = horizontal ? w : h;
        for (let b = 0; b < len; b += 1) {
          if (horizontal) dst[a * w + b] = sum * inv; else dst[b * w + a] = sum * inv;
          sum += at(b + r + 1) - at(b - r);
        }
      }
    };
    const r = Math.round(radius);
    const tmp = new Float32Array(this.d.length);
    pass(this.d, tmp, this.w, this.h, r, true);
    pass(tmp, this.d, this.w, this.h, r, false);
    return this;
  }
}

/** 确定性哈希噪声，保证每次渲染结果一致 */
export function hash(x, y, seed = 0) {
  let h = Math.imul((x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695040, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  return (Math.imul(h, 1274126177) >>> 0) / 4294967295;
}
const smooth = (t) => t * t * (3 - 2 * t);
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  return hash(xi, yi, seed) * (1 - u) * (1 - v) + hash(xi + 1, yi, seed) * u * (1 - v)
       + hash(xi, yi + 1, seed) * (1 - u) * v + hash(xi + 1, yi + 1, seed) * u * v;
}
export function fbm(x, y, octaves = 4, seed = 0) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += noise2(x * f, y * f, seed + o * 131) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

/**
 * 把一枚墨迹图章按给定位置、旋转、缩放盖到密度场上。
 * 图章是单通道灰度（0..255 即墨密度），双线性采样，边缘做羽化避免出现方块接缝。
 */
export function stamp(field, tex, cx, cy, scale, angle, strength, feather = 0.22) {
  const half = (tex.size * scale) / 2;
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const x0 = Math.max(0, Math.floor(cx - half * 1.45));
  const x1 = Math.min(field.w - 1, Math.ceil(cx + half * 1.45));
  const y0 = Math.max(0, Math.floor(cy - half * 1.45));
  const y1 = Math.min(field.h - 1, Math.ceil(cy + half * 1.45));
  const inv = 1 / scale;

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx, dy = y - cy;
      // 旋转回图章局部坐标
      const lx = (dx * cos - dy * sin) * inv + tex.size / 2;
      const ly = (dx * sin + dy * cos) * inv + tex.size / 2;
      if (lx < 0 || ly < 0 || lx >= tex.size - 1 || ly >= tex.size - 1) continue;

      // 边界处理：纯径向羽化会留下可见的圆斑，因此用噪声扰动有效半径，
      // 再以余弦曲线平滑渐隐——边界既不规则也无硬边，多枚叠加自然融成一片。
      const rawR = Math.hypot(dx, dy) / half;
      const wobble = 0.78 + noise2(lx / 26 + 11, ly / 26 + 7, 3) * 0.44;
      const r = rawR / wobble;
      if (r >= 1) continue;
      const falloff = clamp01((r - feather) / (1 - feather));
      const fade = 0.5 * (1 + Math.cos(Math.PI * falloff));

      const ix = lx | 0, iy = ly | 0;
      const fx = lx - ix, fy = ly - iy;
      const t = tex.data;
      const s = tex.size;
      const v = t[iy * s + ix] * (1 - fx) * (1 - fy) + t[iy * s + ix + 1] * fx * (1 - fy)
              + t[(iy + 1) * s + ix] * (1 - fx) * fy + t[(iy + 1) * s + ix + 1] * fx * fy;
      field.d[y * field.w + x] += (v / 255) * strength * fade;
    }
  }
}

/**
 * 把墨密度场渲染成 RGB。
 * 密度 → 不透明度用 1-exp(-k·d)，模拟纸张吸墨饱和：墨越多越黑但永不纯黑，
 * 这是水墨与纯色填充最直观的区别。
 */
export function developRGB(rgb, field, w, h, tint, k = 1.0, maxAlpha = 0.94) {
  for (let i = 0; i < w * h; i += 1) {
    const a = (1 - Math.exp(-k * field.d[i])) * maxAlpha;
    if (a <= 0.002) continue;
    const o = i * 3;
    rgb[o]     = Math.round(rgb[o]     * (1 - a) + tint[0] * a);
    rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + tint[1] * a);
    rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + tint[2] * a);
  }
}

/** 宣纸底：暖色基底 + 纤维走向 + 帘纹 + 偶发棉点与斑渍 */
export function paperBase(w, h, seed = 7) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const grain = fbm(x / 26, y / 26, 4, seed) * 0.55 + fbm(x / 3.5, y / 3.5, 2, seed + 40) * 0.45;
      const fibre = noise2(x / 1.6, y / 44, seed + 90) * 0.4;   // 纵向纤维
      const stain = Math.max(0, fbm(x / 150, y / 150, 3, seed + 300) - 0.56) * 1.9; // 陈年斑渍
      const t = grain * 0.10 + fibre * 0.05 + stain * 0.14;
      const o = (y * w + x) * 3;
      rgb[o]     = Math.round(238 - t * 52);
      rgb[o + 1] = Math.round(230 - t * 56);
      rgb[o + 2] = Math.round(206 - t * 60);
      if (hash(x, y, seed + 700) > 0.9975) {                    // 棉点
        rgb[o] = Math.min(255, rgb[o] + 12); rgb[o+1] = Math.min(255, rgb[o+1] + 11); rgb[o+2] = Math.min(255, rgb[o+2] + 9);
      }
    }
  }
  return rgb;
}
