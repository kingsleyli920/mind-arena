// 对局界面的底图：从 7260×5940 的高分辨率图 lanczos 降到 1815×1485。
//
// 不能直接用 PPD=55 渲染。DEM 是 z=9（约 364 px/度），在 55 px/度上被 6.6 倍
// 点采样抽稀，山脊在进 Horn 算子之前就已经混叠掉了；同时一切笔墨落到
// 1–2 像素，变成椒盐噪点。渲大再降，墨才连得成片、皴才看得出是笔。
import fs from "node:fs";
import sharp from "sharp";

const SRC = process.env.SRC ?? "public/game/map/han-terrain-4x.png";

if (!fs.existsSync(SRC)) {
  console.error(`缺少 ${SRC}，先跑 npm run map:base`);
  process.exit(1);
}

// 只出一档。它现在的职责只剩「垫底」——瓦片是逐块到的，没有垫底的话
// 缩放那一瞬会露出空洞；细节由 z1–z4 的瓦片给，@2x 那张 733KB 是白下的
const STEPS = [
  { out: "public/game/map/play-base.webp", w: 1815, h: 1485, q: 88 },
];
for (const s of STEPS) {
  await sharp(SRC, { limitInputPixels: false })
    .resize(s.w, s.h, { kernel: "lanczos3" })
    .webp({ quality: s.q })
    .toFile(s.out);
  console.log(`→ ${s.out} ${s.w}×${s.h} ${(fs.statSync(s.out).size / 1024).toFixed(0)}KB`);
}
