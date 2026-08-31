// 水墨地形瓦片程序化生成器
// 两条硬约束：
//   1. 无缝 —— 噪声按瓦片尺寸取周期，笔触坐标取模环绕
//   2. 破重复 —— 每种地形出 4 个变体，渲染时按位置噪声选取
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SIZE = 96;
const VARIANTS = 4;

function hash2(x, y, seed) {
  let h = Math.imul((x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695040, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  return (Math.imul(h, 1274126177) >>> 0) / 4294967295;
}
const smooth = (t) => t * t * (3 - 2 * t);

function periodicNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const m = (n) => ((n % period) + period) % period;
  const x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
  return hash2(x0, y0, seed) * (1 - u) * (1 - v) + hash2(x1, y0, seed) * u * (1 - v)
       + hash2(x0, y1, seed) * (1 - u) * v + hash2(x1, y1, seed) * u * v;
}

function fbm(px, py, baseFreq, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, freq = baseFreq;
  for (let o = 0; o < octaves; o += 1) {
    sum += periodicNoise((px / SIZE) * freq, (py / SIZE) * freq, freq, seed + o * 97) * amp;
    norm += amp; amp *= 0.52; freq *= 2;
  }
  return sum / norm;
}

// 地势梯度 —— 皴法笔触要顺着坡面走，而不是随机撒
function gradient(px, py, freq, oct, seed) {
  const d = 1.5;
  const gx = fbm(px + d, py, freq, oct, seed) - fbm(px - d, py, freq, oct, seed);
  const gy = fbm(px, py + d, freq, oct, seed) - fbm(px, py - d, freq, oct, seed);
  return Math.atan2(gy, gx);
}

function canvas(base) {
  const buf = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i += 1) { buf[i * 3] = base[0]; buf[i * 3 + 1] = base[1]; buf[i * 3 + 2] = base[2]; }
  return buf;
}

function ink(buf, x, y, amount, tint) {
  if (amount <= 0.002) return;
  const px = (((y | 0) % SIZE + SIZE) % SIZE) * SIZE + (((x | 0) % SIZE + SIZE) % SIZE);
  const a = amount > 1 ? 1 : amount;
  for (let c = 0; c < 3; c += 1) {
    const i = px * 3 + c;
    buf[i] = Math.round(buf[i] * (1 - a) + tint[c] * a);
  }
}

// 一笔：起笔重、行笔见飞白、收笔渐淡；宽度随笔压变化
function stroke(buf, x0, y0, angle, len, weight, density, seed, tint, curve = 0) {
  const nx = Math.sin(angle), ny = -Math.cos(angle);
  for (let t = 0; t < len; t += 0.45) {
    const p = t / len;
    const taper = Math.sin(Math.min(1, p * 3.2)) * (1 - p * p * 0.85);   // 起笔入、收笔出
    const flying = 0.42 + 0.58 * fbm(x0 + t * 4.5, y0 + t * 4.5, 14, 2, seed); // 飞白
    const press = density * taper * flying;
    const bend = curve * t * t / len;
    const x = x0 + Math.cos(angle) * t + nx * bend;
    const y = y0 + Math.sin(angle) * t + ny * bend;
    const w = weight * (0.55 + taper * 0.85);
    for (let o = -w; o <= w; o += 0.45) {
      ink(buf, Math.round(x + nx * o), Math.round(y + ny * o), press * (1 - Math.abs(o) / (w + 0.7)) * 0.55, tint);
    }
  }
}

// 宣纸：纤维走向 + 帘纹 + 偶发棉点
function paper(buf, seed) {
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    ink(buf, x, y, fbm(x, y, 22, 3, seed + 500) * 0.10, [128, 112, 82]);
    if (hash2(x, y, seed + 900) > 0.9955) ink(buf, x, y, 0.16, [158, 142, 106]);
  }
  for (let i = 0; i < 3; i += 1) { // 帘纹
    const y0 = hash2(i, 77, seed) * SIZE;
    for (let x = 0; x < SIZE; x += 1) ink(buf, x, Math.round(y0), 0.05, [140, 124, 92]);
  }
}

// 湿墨晕：一团墨落纸上向外洇开
function wash(buf, cx, cy, radius, strength, seed, tint) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    const edge = 1 - Math.sqrt(d2) / radius;
    const ragged = 0.55 + 0.45 * fbm(cx + dx * 2, cy + dy * 2, 10, 3, seed);
    ink(buf, cx + dx, cy + dy, strength * edge * edge * ragged, tint);
  }
}

const T = {
  plain: (s) => { // 平原：淡赭洇底 + 阡陌（弯曲、断续，不是直线）
    const b = canvas([228, 217, 187]); paper(b, s);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1)
      ink(b, x, y, fbm(x, y, 3, 4, s) * 0.17, [156, 144, 100]);
    for (let i = 0; i < 7; i += 1) {
      const y0 = hash2(i, 7, s) * SIZE, a = 0.02 + (hash2(i, 8, s) - 0.5) * 0.20;
      let x = -6;
      while (x < SIZE + 6) {                       // 断续走笔
        const seg = 10 + hash2(x | 0, i, s) * 22;
        stroke(b, x, y0 + Math.sin(x / 19 + i) * 3.5, a, seg, 0.45, 0.26, s + i * 13 + (x | 0), [116, 100, 66], 1.2);
        x += seg + 3 + hash2(x | 0, i + 5, s) * 9;
      }
    }
    return b;
  },
  hill: (s) => { // 丘陵：披麻皴，短线顺坡
    const b = canvas([220, 208, 178]); paper(b, s);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1)
      ink(b, x, y, Math.max(0, fbm(x, y, 3, 4, s) - 0.40) * 0.80, [98, 90, 66]);
    for (let i = 0; i < 4; i += 1)
      wash(b, hash2(i, 61, s) * SIZE, hash2(i, 62, s) * SIZE, 15, 0.13, s + i, [104, 96, 70]);
    for (let i = 0; i < 46; i += 1) {
      const x = hash2(i, 1, s) * SIZE, y = hash2(i, 2, s) * SIZE;
      const h = fbm(x, y, 3, 4, s);
      if (h < 0.43) continue;
      stroke(b, x, y, gradient(x, y, 3, 4, s) + 1.57, 5 + h * 9, 0.42, 0.34 + h * 0.3, s + i, [62, 56, 42], 0.5);
    }
    return b;
  },
  mountain: (s) => { // 山地：浓墨山骨 + 斧劈皴，笔触顺山脊
    const b = canvas([215, 203, 173]); paper(b, s);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      const h = fbm(x, y, 2, 5, s);
      ink(b, x, y, Math.max(0, h - 0.33) * 1.35, [58, 54, 46]);
      if (h > 0.70) ink(b, x, y, (h - 0.70) * 1.6, [34, 32, 28]);   // 山头积墨
    }
    for (let i = 0; i < 96; i += 1) {
      const x = hash2(i, 11, s) * SIZE, y = hash2(i, 12, s) * SIZE;
      const h = fbm(x, y, 2, 5, s);
      if (h < 0.38) continue;
      stroke(b, x, y, gradient(x, y, 2, 5, s) + 1.57, 4 + h * 11, 0.5, 0.42 + h * 0.55, s + i, [28, 26, 23], 0.9);
    }
    return b;
  },
  forest: (s) => { // 林地：介字点叶，成簇不成阵
    const b = canvas([218, 210, 178]); paper(b, s);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1)
      ink(b, x, y, fbm(x, y, 4, 3, s) * 0.20, [82, 98, 70]);
    for (let i = 0; i < 6; i += 1)
      wash(b, hash2(i, 41, s) * SIZE, hash2(i, 42, s) * SIZE, 14, 0.17, s + i, [74, 92, 66]);
    for (let c = 0; c < 22; c += 1) {              // 先定树丛中心
      const cx = hash2(c, 21, s) * SIZE, cy = hash2(c, 22, s) * SIZE;
      if (fbm(cx, cy, 4, 3, s) < 0.44) continue;
      const n = 3 + Math.floor(hash2(c, 23, s) * 5);
      for (let j = 0; j < n; j += 1) {             // 丛内散点
        const x = cx + (hash2(c * 9 + j, 24, s) - 0.5) * 15;
        const y = cy + (hash2(c * 9 + j, 25, s) - 0.5) * 15;
        for (let k = 0; k < 3; k += 1)             // 介字：三笔攒
          stroke(b, x, y, -2.05 + k * 0.72, 3.4, 0.4, 0.66, s + c * 31 + j * 3 + k, [40, 58, 40], 0.4);
      }
    }
    return b;
  },
  water: (s) => { // 水面：网巾纹，波幅与走向随机
    const b = canvas([205, 213, 205]); paper(b, s);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1)
      ink(b, x, y, 0.13 + fbm(x, y, 3, 3, s) * 0.14, [108, 138, 136]);
    for (let row = 0; row < 11; row += 1) {
      const y0 = (row + 0.5) * (SIZE / 11);
      const amp = 1.1 + hash2(row, 3, s) * 2.4;
      const ph = hash2(row, 4, s) * 6.283;
      const k = 2 + Math.floor(hash2(row, 5, s) * 3);        // 整周期，保证左右接得上
      for (let x = 0; x < SIZE; x += 0.5) {
        const y = y0 + Math.sin((x / SIZE) * Math.PI * 2 * k + ph) * amp
                     + (fbm(x, y0, 7, 2, s + row) - 0.5) * 2.2;
        const a = 0.16 + fbm(x, y0 * 2, 9, 2, s + row) * 0.36;   // 笔断意连
        ink(b, Math.round(x), Math.round(y), a, [48, 78, 86]);
        ink(b, Math.round(x), Math.round(y) + 1, a * 0.35, [48, 78, 86]);
      }
    }
    return b;
  },
  marsh: (s) => { // 沼泽：湿墨洇团 + 芦苇
    const b = canvas([211, 209, 179]); paper(b, s);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      const w = fbm(x, y, 3, 4, s);
      ink(b, x, y, Math.max(0, w - 0.36) * 0.62, [92, 108, 90]);
      if (w > 0.58) ink(b, x, y, (w - 0.58) * 0.85, [98, 124, 120]);
    }
    for (let i = 0; i < 7; i += 1)
      wash(b, hash2(i, 51, s) * SIZE, hash2(i, 52, s) * SIZE, 13, 0.15, s + i, [96, 118, 112]);
    for (let i = 0; i < 54; i += 1) {
      const x = hash2(i, 31, s) * SIZE, y = hash2(i, 32, s) * SIZE;
      if (fbm(x, y, 3, 4, s) > 0.56) continue;                 // 苇长在浅处
      stroke(b, x, y, -1.50 + (hash2(i, 33, s) - 0.5) * 0.55, 5 + hash2(i, 34, s) * 5, 0.32, 0.52, s + i, [74, 88, 58], 1.4);
    }
    return b;
  },
};

await mkdir("public/game/tiles", { recursive: true });
const names = Object.keys(T);
const all = {};
for (const name of names) {
  all[name] = [];
  for (let v = 0; v < VARIANTS; v += 1) {
    const buf = T[name](name.length * 1337 + v * 7919 + 42);
    all[name].push(buf);
    await sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 3 } })
      .png({ compressionLevel: 9 }).toFile(`public/game/tiles/${name}-${v}.png`);
  }
}

// 对照图：每种地形 4×4 平铺，变体按位置噪声选取 —— 同时验证无缝与破重复
const N = 4;
const blocks = await Promise.all(names.map(async (name, ti) => {
  const pngs = await Promise.all(all[name].map((raw) =>
    sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer()));
  return sharp({ create: { width: SIZE * N, height: SIZE * N, channels: 3, background: "#fff" } })
    .composite(Array.from({ length: N * N }, (_, i) => {
      const gx = i % N, gy = Math.floor(i / N);
      return { input: pngs[Math.floor(hash2(gx, gy, ti * 31 + 5) * VARIANTS) % VARIANTS], left: gx * SIZE, top: gy * SIZE };
    })).png().toBuffer();
}));

await sharp({ create: { width: SIZE * N * 3, height: SIZE * N * 2, channels: 3, background: "#fff" } })
  .composite(blocks.map((input, i) => ({ input, left: (i % 3) * SIZE * N, top: Math.floor(i / 3) * SIZE * N })))
  .png().toFile("public/game/tiles/_preview.png");

console.log(`${names.length} 种地形 × ${VARIANTS} 变体 = ${names.length * VARIANTS} 张 ${SIZE}×${SIZE} 瓦片`);
console.log("上排：平原 / 丘陵 / 山地    下排：林地 / 水面 / 沼泽");
