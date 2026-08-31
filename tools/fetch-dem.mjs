// 拉取汉末战区的高分辨率高程栅格，供地形晕渲使用。
// 来源：AWS Terrain Tiles（terrarium 编码，公有领域/开放数据）。
// 0.1 度的战略网格只够做玩法判定，做不了晕渲——晕渲要在渲染像素级别有真实起伏。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const W = 94, E = 127, S = 16, N = 43;
const Z = Number(process.env.Z ?? 8);
const CACHE = process.env.DEM_DIR ?? "refs/dem";
const OUT = process.env.OUT ?? "refs/dem-raster.raw";

const n = 1 << Z;
const lon2tx = (lon) => Math.floor((lon + 180) / 360 * n);
const lat2ty = (lat) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
const tx0 = lon2tx(W), tx1 = lon2tx(E), ty0 = lat2ty(N), ty1 = lat2ty(S);
const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
console.log(`z=${Z}  瓦片 x ${tx0}..${tx1} (${cols})  y ${ty0}..${ty1} (${rows})  共 ${cols * rows} 张`);

await fs.promises.mkdir(CACHE, { recursive: true });
const jobs = [];
for (let x = tx0; x <= tx1; x += 1) for (let y = ty0; y <= ty1; y += 1) jobs.push([x, y]);

let fetched = 0, cached = 0, failed = 0;
const CONC = 8;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (jobs.length) {
    const [x, y] = jobs.shift();
    const p = path.join(CACHE, `${Z}-${x}-${y}.png`);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) { cached += 1; continue; }
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
      try {
        const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`,
          { headers: { "User-Agent": "MindArena-terrain/1.0" } });
        if (!r.ok) throw new Error(String(r.status));
        await fs.promises.writeFile(p, Buffer.from(await r.arrayBuffer()));
        ok = true; fetched += 1;
      } catch { /* 重试 */ }
    }
    if (!ok) failed += 1;
    if ((fetched + cached) % 100 === 0) process.stdout.write(`\r  ${fetched + cached}/${cols * rows}`);
  }
}));
console.log(`\r下载 ${fetched} 张，缓存命中 ${cached} 张，失败 ${failed} 张`);

// 拼成一整块 Int16 高程栅格
const TS = 256;
const RW = cols * TS, RH = rows * TS;
console.log(`拼接栅格 ${RW}×${RH}（${(RW * RH * 2 / 1048576).toFixed(0)}MB）`);
const raster = new Int16Array(RW * RH);
for (let tx = tx0; tx <= tx1; tx += 1) {
  for (let ty = ty0; ty <= ty1; ty += 1) {
    const p = path.join(CACHE, `${Z}-${tx}-${ty}.png`);
    if (!fs.existsSync(p)) continue;
    const { data } = await sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ox = (tx - tx0) * TS, oy = (ty - ty0) * TS;
    for (let j = 0; j < TS; j += 1) {
      for (let i = 0; i < TS; i += 1) {
        const o = (j * TS + i) * 3;
        raster[(oy + j) * RW + ox + i] = Math.round(data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768);
      }
    }
  }
}

// 栅格的地理范围按瓦片边界算（比请求范围略大），渲染时再按经纬取样
const tile2lon = (t) => t / n * 360 - 180;
const tile2lat = (t) => { const m = Math.PI * (1 - 2 * t / n); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(m) - Math.exp(-m))); };
const meta = {
  zoom: Z, width: RW, height: RH,
  west: tile2lon(tx0), east: tile2lon(tx1 + 1),
  north: tile2lat(ty0), south: tile2lat(ty1 + 1),
  projection: "web-mercator",
  source: "AWS Terrain Tiles terrarium",
  license: "公有领域/开放数据（SRTM、ASTER GDEM、GMTED2010、ETOPO1 等汇编）",
};
await fs.promises.writeFile(OUT, Buffer.from(raster.buffer));
await fs.promises.writeFile(OUT.replace(/\.raw$/, ".json"), JSON.stringify(meta, null, 1));
let mn = 1e9, mx = -1e9;
for (const v of raster) { if (v > -20000) { if (v < mn) mn = v; if (v > mx) mx = v; } }
console.log(`高程范围 ${mn} .. ${mx} m   →  ${OUT}`);
