// 对局界面的底图：从 7260×5940 的高分辨率图 lanczos 降到 1815×1485。
//
// 不能直接用 PPD=55 渲染。DEM 是 z=9（约 364 px/度），在 55 px/度上被 6.6 倍
// 点采样抽稀，山脊在进 Horn 算子之前就已经混叠掉了；同时一切笔墨落到
// 1–2 像素，变成椒盐噪点。渲大再降，墨才连得成片、皴才看得出是笔。
import fs from "node:fs";
import sharp from "sharp";

const SRC = process.env.SRC ?? "public/game/map/han-terrain.png";
const OUT = process.env.OUT ?? "public/game/map/play-base.webp";
const W = Number(process.env.W ?? 1815), H = Number(process.env.H ?? 1485);

if (!fs.existsSync(SRC)) {
  console.error(`缺少 ${SRC}，先跑 npm run map:base`);
  process.exit(1);
}
await sharp(SRC, { limitInputPixels: false })
  .resize(W, H, { kernel: "lanczos3" })
  .webp({ quality: 88 })
  .toFile(OUT);
const m = await sharp(OUT).metadata();
console.log(`→ ${OUT} ${m.width}×${m.height} ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
