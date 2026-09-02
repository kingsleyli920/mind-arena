// 生成可平铺的宣纸纹理。
//
// 纸纹是水墨观感的地基：没有它，无论怎么设色都像印刷品而不像画在纸上。
// 程序化生成而非找图，是为了可平铺、可控颗粒、且无版权问题。
//
// 三层叠加：
//   纤维——沿一个主方向拉长的噪声，模拟捞纸时的纤维走向
//   颗粒——高频白噪，模拟纸面凹凸
//   云斑——低频起伏，模拟纸的厚薄不匀
import fs from "node:fs";
import sharp from "sharp";

const N = Number(process.env.SIZE ?? 512);
const OUT = process.env.OUT ?? "public/game/map/paper.png";

// 确定性哈希噪声，保证每次生成同一张纸
const hash = (x, y, s) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
};
const smooth = (x, y, s) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  // 对 N 取模，保证左右上下可接
  const h = (a, b) => hash(((a % N) + N) % N, ((b % N) + N) % N, s);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v)
       + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
};
const fbm = (x, y, oct, s) => {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i += 1) {
    sum += smooth(x * f, y * f, s + i) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
};

const buf = Buffer.alloc(N * N);
for (let y = 0; y < N; y += 1) {
  for (let x = 0; x < N; x += 1) {
    // 纤维：两组交叉的拉长噪声。只用一组会拉出通篇横纹，像拉丝金属而非宣纸
    const fiberA = fbm(x / 26, y / 9, 3, 11);
    const fiberB = fbm(x / 9, y / 26, 3, 23);
    const fiber = (fiberA + fiberB) / 2;
    const grain = hash(x, y, 29);
    const cloud = fbm(x / 110, y / 110, 4, 47);
    // 纸筋：捞纸时未打散的纤维束，稀疏而明显，是手工纸的标志
    const fleck = hash(x, y, 61) > 0.9975 ? 0.22 : 0;
    const v = 0.5 + (fiber - 0.5) * 0.20 + (grain - 0.5) * 0.26
            + (cloud - 0.5) * 0.34 + fleck;
    buf[y * N + x] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
}

fs.mkdirSync("public/game/map", { recursive: true });
await sharp(buf, { raw: { width: N, height: N, channels: 1 } }).png().toFile(OUT);
console.log(`→ ${OUT} ${N}x${N} ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
