// 把整幅地图切成多级瓦片，供前端按视口按需加载。
// 单张 4620px 宽的纹理会超过部分设备的 WebGL 上限（常见 4096），必须切片。
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SRC = process.env.SRC ?? "public/game/map/han-ink-full.png";
const OUT = process.env.OUT ?? "public/game/map/tiles";
const TILE = 512;
const LEVELS = Number(process.env.LEVELS ?? 3);   // z0 最粗 → z(n-1) 原始分辨率

const meta = await sharp(SRC).metadata();
console.log(`源图 ${meta.width}×${meta.height}`);
await fs.promises.rm(OUT, { recursive: true, force: true });

const manifest = { tileSize: TILE, source: path.basename(SRC), levels: [] };

for (let z = 0; z < LEVELS; z += 1) {
  const scale = 1 / Math.pow(2, LEVELS - 1 - z);
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
  const cols = Math.ceil(w / TILE), rows = Math.ceil(h / TILE);
  const dir = path.join(OUT, `z${z}`);
  await fs.promises.mkdir(dir, { recursive: true });

  // 先缩放到该级尺寸，再切，避免逐瓦片重复缩放造成接缝
  const scaled = await sharp(SRC).resize(w, h, { kernel: "lanczos3" }).toBuffer();
  let n = 0;
  for (let ty = 0; ty < rows; ty += 1) {
    for (let tx = 0; tx < cols; tx += 1) {
      const left = tx * TILE, top = ty * TILE;
      // 地形是连续色调，PNG 会大到离谱；webp 质量 88 在这类图上肉眼无损且小一个量级
      await sharp(scaled)
        .extract({ left, top, width: Math.min(TILE, w - left), height: Math.min(TILE, h - top) })
        .webp({ quality: 88, effort: 5 }).toFile(path.join(dir, `${tx}-${ty}.webp`));
      n += 1;
    }
  }
  manifest.levels.push({ z, width: w, height: h, cols, rows, tiles: n });
  console.log(`z${z}  ${w}×${h}  ${cols}×${rows} = ${n} 瓦片`);
}

// 地理配准：让前端能把经纬度换算成像素坐标
const grid = JSON.parse(fs.readFileSync("lib/game/data/terrain-grid.json", "utf8"));
manifest.format = "webp";
manifest.geo = { west: grid.meta.west, east: grid.meta.east, south: grid.meta.south, north: grid.meta.north };
manifest.baseWidth = meta.width;
manifest.baseHeight = meta.height;
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));

const du = (d) => fs.readdirSync(d, { recursive: true })
  .reduce((a, f) => { const p = path.join(d, f); return a + (fs.statSync(p).isFile() ? fs.statSync(p).size : 0); }, 0);
console.log(`共 ${manifest.levels.reduce((a, l) => a + l.tiles, 0)} 瓦片，${(du(OUT) / 1048576).toFixed(1)}MB`);
