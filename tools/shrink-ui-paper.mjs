// 界面用的纸纹：把 tools/make-paper.mjs 那张中灰的纸压到 [228,255] 这一窄段。
//
// 原图均值 123，界面若直接 background-blend-mode: multiply 会把整幅压暗一半——
// 第一版就是这样，背景成了深灰花斑，字都看不清。压窄之后是一层几乎看不见的
// 颗粒，正是「纸上」与「印刷品」的分别。
//
// 用法：node tools/shrink-ui-paper.mjs <make-paper 出的 png>
import sharp from "sharp";

const SRC = process.argv[2] ?? "public/game/map/paper.png";
const OUT = "public/game/ui-paper.webp";
await sharp(SRC).linear(27 / 255, 228).webp({ quality: 88 }).toFile(OUT);
const st = await sharp(OUT).stats();
console.log(`→ ${OUT}　均值 ${Math.round(st.channels[0].mean)}`
  + `　范围 ${st.channels[0].min}–${st.channels[0].max}`);
