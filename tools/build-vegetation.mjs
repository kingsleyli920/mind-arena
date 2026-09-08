// 植被网格：每格是林、是草、还是荒。
//
// 起因是一句反问：「森林是森林……其他三国游戏呢？你可以去看看」。查下来
// 《三国志11》的地形（平原/森林/砂地/水面）是**游戏设计的地形**，不是卫星
// 数据；而它的画法恰恰是水墨——所以「水墨」与「山是山、林是林」从来不是
// 二选一，是同一件事：用画的方式把每种地形画出自己的样子。
//
// 我们缺的只有林地这一层。数据取 Natural Earth II（公有领域）——它画的是
// **理想化的自然植被，几乎不含人类影响**，对公元 194 年比现代土地覆盖更合适：
// 汉末的林地远多于今天。
//
// 判据是「绿减红」：NE2 的配色里植被越盛绿越压过红。烤进去的晕渲会整体压暗，
// 但那是乘性的，对差值取比值即可抵消——故用 (G−R)/(R+G+B)。
//
// 反复运行结果一致：纯读取 + 阈值，无随机、无网络。
import fs from "node:fs";
import sharp from "sharp";

const TIF = "refs/natural-earth/NE2_50M_SR/NE2_50M_SR.tif";
const OUT = process.env.OUT ?? "lib/game/data/vegetation-grid.json";
// 与 terrain-grid 同一套网格，两者才对得上格
const W_DEG = 94, E_DEG = 127, S_DEG = 16, N_DEG = 43, CELL = 0.1;
const COLS = Math.round((E_DEG - W_DEG) / CELL), ROWS = Math.round((N_DEG - S_DEG) / CELL);

if (!fs.existsSync(TIF)) {
  console.error(`✗ 缺 ${TIF}`);
  console.error("  从 https://naciscdn.org/naturalearth/50m/raster/NE2_50M_SR.zip 取（公有领域）");
  process.exit(2);
}
const tfw = fs.readFileSync(TIF.replace(/\.tif$/, ".tfw"), "utf8").trim().split(/\s+/).map(Number);
const [px, , , py, ox, oy] = tfw;   // 像素宽、旋转两项、像素高（负）、左上角经纬
const { data, info } = await sharp(TIF).raw().toBuffer({ resolveWithObject: true });
console.log(`底图 ${info.width}×${info.height}　像素 ${px.toFixed(4)}°　网格 ${COLS}×${ROWS}`);

const terrain = JSON.parse(fs.readFileSync("lib/game/data/terrain-grid.json", "utf8"));
const legend = { 0: "none", 1: "forest", 2: "scrub", 3: "steppe", 4: "barren" };
const grid = new Uint8Array(COLS * ROWS);
const tally = {};
for (let r = 0; r < ROWS; r += 1) {
  const lat = N_DEG - (r + 0.5) * CELL;
  for (let c = 0; c < COLS; c += 1) {
    const lon = W_DEG + (c + 0.5) * CELL;
    const i = r * COLS + c;
    // 海与湖不判植被
    if (terrain.terrain[i] === "s" || terrain.terrain[i] === "l") { tally.none = (tally.none ?? 0) + 1; continue; }
    const x = Math.round((lon - ox) / px), y = Math.round((lat - oy) / py);
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
    const k = (y * info.width + x) * info.channels;
    const R = data[k], G = data[k + 1], B = data[k + 2];
    const sum = R + G + B || 1;
    const v = (G - R) / sum;
    // 阈值由已知地点标定：秦岭 +0.030、成都 +0.053、南中 +0.045、
    // 蒙古草原 −0.031、塔里木 −0.031
    const cls = v > 0.040 ? 1 : v > 0.018 ? 2 : v > -0.005 ? 3 : 4;
    grid[i] = cls;
    tally[legend[cls]] = (tally[legend[cls]] ?? 0) + 1;
  }
}
fs.writeFileSync(OUT, `${JSON.stringify({
  _note: "植被网格。0 无（海湖）/1 林/2 疏林灌丛/3 草原/4 荒漠。"
       + "取自 Natural Earth II（公有领域，理想化自然植被，几乎不含人类影响——"
       + "对公元 194 年比现代土地覆盖更合适）。由 tools/build-vegetation.mjs 生成。",
  source: "Natural Earth II 1:50m (NE2_50M_SR), public domain",
  meta: { west: W_DEG, north: N_DEG, cellSize: CELL, cols: COLS, rows: ROWS },
  legend,
  grid: Buffer.from(grid).toString("base64"),
})}\n`);
console.log(`→ ${OUT}　${JSON.stringify(tally)}　${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
