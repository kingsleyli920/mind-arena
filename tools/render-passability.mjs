// 把「过不去」画出来。
//
// 通行图改由代价场求出之后，规则变成了「山是墙、江是墙、关是墙上的口子」——
// 可图上看不出来。底图把山画得很好看，却答不了「大军能不能从这儿过」。
// 这一层专答那一个问题。
//
// 画法：不可通行的地界罩一层淡墨，边缘勾一道崖线。不涂实——底图的皴笔
// 是这张图的画，压掉它就成了数据图；只要让「墙」这件事读得出来。
import fs from "node:fs";
import sharp from "sharp";

const meta = JSON.parse(fs.readFileSync("public/game/costfield.json", "utf8"));
const { cols: COLS, rows: ROWS, block: BLOCK } = meta;
const cost = new Uint8Array(fs.readFileSync("public/game/costfield.bin"));
const OUT = "public/game/map/wall.webp";

// 海不画：底图自己就是蓝的，再罩一层只会把海岸线糊掉。
// 判海：不可通行且四邻大多也不可通行、且成片极大的那一块——
// 更省事的办法是直接读高程，但这一层不该再依赖 283MB 的原始 DEM。
// 用水路场：海在那张场上是最便宜的一档（4）
const wcost = new Uint8Array(fs.readFileSync("public/game/costfield-water.bin"));
const W = COLS, H = ROWS;
const rgba = Buffer.alloc(W * H * 4);

// **画的是代价的深浅，不是二值的墙。**
//
// 头一版只画「过不去」，结果太行、秦岭一片空白——它们在这套判据下
// 并不是墙（RELIEF=1600，而山里的局部基准面本身就高），只是**贵**。
// 那也没错：汉军确实翻得过太行，走的是八陉。
//
// 但「贵」才是这张图要答的问题：路为什么绕这儿走、关为什么设在那儿。
// 所以按代价铺深浅——太行成为一条深带，壶关、天井关、滏口陉是深带上的
// 浅豁口。那正是「关是墙上的口子」在图上的样子。
const PLAIN = 3;                                  // 一格平地的代价
let walls = 0, river = 0;
for (let i = 0; i < cost.length; i += 1) {
  const o = i * 4;
  const v = cost[i];
  if (v === BLOCK) {
    if (wcost[i] === 4) continue;                 // 海：底图自己是蓝的，罩上去只会糊掉海岸
    if (wcost[i] <= 6) {                          // 大江：不可陆行而水路便宜
      rgba[o] = 58; rgba[o + 1] = 92; rgba[o + 2] = 116; rgba[o + 3] = 168;
      river += 1; continue;
    }
    rgba[o] = 58; rgba[o + 1] = 50; rgba[o + 2] = 42; rgba[o + 3] = 210;   // 真过不去
    walls += 1; continue;
  }
  // 平地不着墨；越贵越深。取对数——代价是幂次的，线性铺色会让谷底之外
  // 全糊成一片同样的深，看不出层次，也就看不出哪儿是豁口
  const t = Math.log(Math.max(1, v / PLAIN)) / Math.log(240 / PLAIN);
  if (t <= 0.06) continue;
  rgba[o] = 62; rgba[o + 1] = 54; rgba[o + 2] = 45;
  rgba[o + 3] = Math.round(Math.min(0.55, (t - 0.06) * 0.95) * 255);
}
console.log(`不可通行 ${(walls / 1e3).toFixed(0)}k 格　大江 ${(river / 1e3).toFixed(0)}k 格`);

await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .resize(1815, 1485, { kernel: "lanczos3" })
  .webp({ quality: 82, alphaQuality: 80 }).toFile(OUT);
console.log(`→ ${OUT}  ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
