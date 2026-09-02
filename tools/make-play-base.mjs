// 对局界面的底图：从 7260×5940 的高分辨率图 lanczos 降到 1815×1485。
//
// 不能直接用 PPD=55 渲染。DEM 是 z=9（约 364 px/度），在 55 px/度上被 6.6 倍
// 点采样抽稀，山脊在进 Horn 算子之前就已经混叠掉了；同时一切笔墨落到
// 1–2 像素，变成椒盐噪点。渲大再降，墨才连得成片、皴才看得出是笔。
import fs from "node:fs";
import sharp from "sharp";

const SRC = process.env.SRC ?? "public/game/map/han-terrain.png";

if (!fs.existsSync(SRC)) {
  console.error(`缺少 ${SRC}，先跑 npm run map:base`);
  process.exit(1);
}

// 出两档。整幅可见时用 1815；放大后换 3630——否则是把 1815 插值放大六倍，
// 越拉越糊，而底图本来就有 7260 的细节可用
const STEPS = [
  { out: "public/game/map/play-base.webp", w: 1815, h: 1485, q: 88 },
  { out: "public/game/map/play-base@2x.webp", w: 3630, h: 2970, q: 82 },
];
for (const s of STEPS) {
  await sharp(SRC, { limitInputPixels: false })
    .resize(s.w, s.h, { kernel: "lanczos3" })
    .webp({ quality: s.q })
    .toFile(s.out);
  console.log(`→ ${s.out} ${s.w}×${s.h} ${(fs.statSync(s.out).size / 1024).toFixed(0)}KB`);
}
