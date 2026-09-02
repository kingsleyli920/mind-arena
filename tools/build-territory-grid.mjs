// 疆域查找网格：每个网格属哪个郡国。
//
// 底图把 194 年的势力疆域烤进了栅格，可对局中疆域是会变的——
// 烤进去的疆域一开打就不对了。这里把「像素属哪个郡」单独抽出来，
// 客户端按当前局势的归属实时着色，与底图分离。
//
// 划分方式与底图一致：按郡治做最近邻（Voronoi），只算陆地，
// 且限定影响半径，免得一个郡治把半个西域也染上。
import fs from "node:fs";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const grid = read("terrain-grid.json");
const commanderies = read("commanderies.json");

const { west, north, cellSize, cols, rows } = grid.meta;
const elev = grid.elevation;
// 影响半径：相邻郡治间距中位数 158km ≈ 1.5 经度，取其略多以免留白
const REACH_DEG = 2.6;
const NONE = 255;

const seats = commanderies.map((c) => ({ lon: c.longitude, lat: c.latitude }));
if (seats.length > 254) throw new Error("郡国超过 254 个，单字节索引不够用");

const out = new Uint8Array(cols * rows).fill(NONE);
let land = 0, assigned = 0;
for (let r = 0; r < rows; r += 1) {
  const lat = north - (r + 0.5) * cellSize;
  const kx = Math.cos((lat * Math.PI) / 180);           // 经度在该纬度的实际长度比
  for (let c = 0; c < cols; c += 1) {
    const i = r * cols + c;
    if (elev[i] <= 0) continue;                          // 海与湖不染
    land += 1;
    const lon = west + (c + 0.5) * cellSize;
    let best = -1, bestD = Infinity;
    for (let k = 0; k < seats.length; k += 1) {
      const dx = (seats[k].lon - lon) * kx;
      const dy = seats[k].lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (Math.sqrt(bestD) > REACH_DEG) continue;          // 超出影响半径留白
    out[i] = best;
    assigned += 1;
  }
}

fs.mkdirSync("public/game", { recursive: true });
fs.writeFileSync("public/game/territory-grid.json", JSON.stringify({
  _note: "每格属哪个郡国的查找表，供客户端按实时归属着色。由 tools/build-territory-grid.mjs 生成。",
  meta: { west, north, cellSize, cols, rows, reachDeg: REACH_DEG, none: NONE },
  order: commanderies.map((c) => c.id),
  grid: Buffer.from(out).toString("base64"),
}));
const kb = (fs.statSync("public/game/territory-grid.json").size / 1024).toFixed(0);
console.log(`→ public/game/territory-grid.json ${cols}x${rows} ${kb}KB`);
console.log(`  陆地格 ${land}，其中已归属 ${assigned}（${((assigned / land) * 100).toFixed(1)}%）`);
