// 从公有领域中国山水画中提取皴法纹理块，转成带 alpha 的墨迹图章。
//
// 素材来源（均为公有领域 / CC0，Wikimedia Commons）：
//   李唐《万壑松风图》   斧劈皴 → 山地
//   黄公望《富春山居图》 披麻皴 → 丘陵
//   范宽《谿山行旅图》   雨点皴 → 岩体
//   郭熙《早春图》       卷云皴 → 山峦
//
// 提取逻辑：网格扫描 → 按「细节丰富度 × 墨量适中度」打分 → 取高分块 →
// 去掉绢本底色得到纯墨密度 → 输出灰度 alpha 图章。
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const REF = process.env.REF_DIR ?? "refs";
const OUT = "public/game/ink";
const PATCH = 256;      // 提取块边长
const TOP = 8;          // 每幅取几块

const SOURCES = [
  { file: "litang-wanhesongfeng.png",   id: "fupi",   name: "斧劈皴", work: "李唐《万壑松风图》",   license: "CC0" },
  { file: "huanggongwang-fuchun.jpg",   id: "pima",   name: "披麻皴", work: "黄公望《富春山居图》", license: "Public domain" },
  { file: "fankuan-xishanxinglv.jpg",   id: "yudian", name: "雨点皴", work: "范宽《谿山行旅图》",   license: "Public domain" },
  { file: "guoxi-zaochun.jpg",          id: "juanyun", name: "卷云皴", work: "郭熙《早春图》",      license: "Public domain" },
];

// 去扫描行噪：横向条纹的本质是每一行整体亮度的周期性偏移。
// 求每行均值，再与其垂直邻域的平滑均值相比，把差值从整行减掉。
// 真实笔触在行内有横向变化、不会整行同步偏移，因此几乎不受影响。
function destripe(gray, w, h) {
  const rowMean = new Float32Array(h);
  for (let y = 0; y < h; y += 1) {
    let s = 0;
    for (let x = 0; x < w; x += 1) s += gray[y * w + x];
    rowMean[y] = s / w;
  }
  const R = 12;                              // 平滑半径，需大于条纹周期
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < h; y += 1) {
    let s = 0, n = 0;
    for (let k = -R; k <= R; k += 1) {
      const yy = y + k;
      if (yy >= 0 && yy < h) { s += rowMean[yy]; n += 1; }
    }
    const bias = rowMean[y] - s / n;         // 该行相对邻域的偏移量
    for (let x = 0; x < w; x += 1) {
      const v = gray[y * w + x] - bias;
      out[y * w + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

// 打分三要素：
//   energy    —— 笔触密度，横竖梯度总量
//   isotropy  —— 各向同性度。真皴法在横竖两向都有能量；扫描裱边和摩尔纹只有单向，
//                这一项把它们压到接近 0，是甩掉扫描伪影的关键
//   tone      —— 墨量适中度，纯空白绢本与整块浓墨都惩罚
function score(gray, w, h) {
  let gx = 0, gy = 0, sum = 0, n = 0;
  for (let y = 1; y < h; y += 1) {
    for (let x = 1; x < w; x += 1) {
      const i = y * w + x;
      gx += Math.abs(gray[i] - gray[i-1]);
      gy += Math.abs(gray[i] - gray[i-w]);
      sum += gray[i]; n += 1;
    }
  }
  gx /= n; gy /= n;
  const energy = (gx + gy) / 2;
  const isotropy = Math.min(gx, gy) / Math.max(gx, gy, 1e-6);
  const mean = sum / n;
  const tone = Math.exp(-Math.pow((mean - 158) / 48, 2));
  // isotropy 取三次方：单向条纹（isotropy≈0.3）被压到 0.027，真皴法（≈0.85）仍保留 0.61
  return energy * Math.pow(isotropy, 3) * tone;
}

await fs.promises.mkdir(OUT, { recursive: true });
const manifest = [];

for (const src of SOURCES) {
  const file = path.join(REF, src.file);
  if (!fs.existsSync(file)) { console.warn(`跳过（缺文件）: ${file}`); continue; }
  const img = sharp(file).removeAlpha();
  const { width, height } = await img.metadata();
  const { data: rawGray } = await img.clone().greyscale().raw().toBuffer({ resolveWithObject: true });
  const gray = destripe(rawGray, width, height);

  // 网格扫描评分
  const step = Math.floor(PATCH * 0.75);
  const cands = [];
  // 跳过裱边与题跋区：长卷按短边比例内缩，立轴上下各让出更多
  const mx = Math.round(Math.min(width, height) * 0.06);
  const my = Math.round(Math.min(width, height) * 0.06);
  for (let y = my; y + PATCH <= height - my; y += step) {
    for (let x = mx; x + PATCH <= width - mx; x += step) {
      const patch = new Uint8Array(PATCH * PATCH);
      for (let j = 0; j < PATCH; j += 1)
        for (let i = 0; i < PATCH; i += 1) patch[j*PATCH+i] = gray[(y+j)*width + (x+i)];
      cands.push({ x, y, s: score(patch, PATCH, PATCH) });
    }
  }
  cands.sort((a, b) => b.s - a.s);

  // 去重：高分块之间保持距离，避免全挤在同一处山体
  const picked = [];
  const best = cands[0]?.s ?? 0;
  for (const c of cands) {
    if (c.s < best * 0.35) break;            // 分数掉太多的不要，宁缺毋滥
    if (picked.every((p) => Math.hypot(p.x-c.x, p.y-c.y) > PATCH * 1.3)) picked.push(c);
    if (picked.length >= TOP) break;
  }

  for (const [i, p] of picked.entries()) {
    const region = Buffer.alloc(PATCH * PATCH);
    for (let j = 0; j < PATCH; j += 1)
      for (let i = 0; i < PATCH; i += 1) region[j * PATCH + i] = gray[(p.y + j) * width + (p.x + i)];

    // 去绢本底色：以 75 分位为纸白、5 分位为最浓墨，把两者之间线性拉满，
    // 避免整体偏白（雨点皴）或整体糊死（浓墨块）
    const sorted = Uint8Array.from(region).slice().sort();
    const paperTone = sorted[Math.floor(sorted.length * 0.75)];
    const darkTone = sorted[Math.floor(sorted.length * 0.05)];
    const span = Math.max(12, paperTone - darkTone);
    const alpha = Buffer.alloc(PATCH * PATCH);
    for (let k = 0; k < region.length; k += 1) {
      const v = (paperTone - region[k]) / span;
      alpha[k] = Math.max(0, Math.min(255, Math.round(v * 235)));
    }
    const name = `${src.id}-${i}.png`;
    await sharp(alpha, { raw: { width: PATCH, height: PATCH, channels: 1 } })
      .extractChannel(0)                          // 落盘为单通道灰度，避免 PNG 被扩成 RGB
      .png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
    manifest.push({ file: name, cun: src.id, cunName: src.name, source: src.work, license: src.license, from: { x: p.x, y: p.y, size: PATCH } });
  }
  console.log(`${src.name.padEnd(4)} ${src.work.padEnd(20)} ${width}×${height} → 取 ${picked.length} 块`);
}

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  note: "皴法墨迹图章，自公有领域中国山水画提取。灰度值即墨密度，用作 alpha 通道。",
  stamps: manifest,
}, null, 1));
console.log(`\n共 ${manifest.length} 枚墨迹图章 → ${OUT}/`);
