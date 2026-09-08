// 通行代价场：这张图决定「哪儿走得通、走得多难」。
//
// 它取代手画的 233 条边。此前「谁能打谁」查的是一张 Delaunay 三角化
// 加手工补出来的线表——那是「史书记载过的路」，不是「地理上走不走得通」。
// 长江上的港口因此彼此到不了，界桥摆在图上却没有任何作用。
//
// 现在只由两件事决定：**坡**与**水**。
//
// 输出两样：
//   public/game/costfield.bin   逐格通行代价（Uint8，255 = 不可通行）
//   public/game/map/cost.webp   同一份东西画成图——新底图的骨架
import fs from "node:fs";
import sharp from "sharp";

const STEP = Number(process.env.STEP ?? 0.02);
const W_DEG = 94, E_DEG = 127, S_DEG = 16, N_DEG = 43;
const COLS = Math.round((E_DEG - W_DEG) / STEP);
const ROWS = Math.round((N_DEG - S_DEG) / STEP);

// ── 高程：对格子覆盖的那一片取**最高点**，不是点采样 ────────────────
//
// 工作格 0.02° 在 DEM（364 px/度）上覆盖 7.3×7.3 个像素。点采样只看格心，
// 山脊只要不落在格心就整条丢掉——墙于是漏了。实测点采样下剑门关、虎牢关、
// 武关的扼守价值全是 0：不是它们不险，是模型把山抹平了。
//
// 取最大值才是「大军过不过得去」该问的：一道山脊挡在那儿，
// 旁边有个豁口不代表能过。同时留一份平均值算行军代价。
const meta = JSON.parse(fs.readFileSync("refs/dem-raster.json", "utf8"));
const buf = fs.readFileSync("refs/dem-raster.raw");
const dem = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const merc = (l) => { const r = (l * Math.PI) / 180; return Math.log(Math.tan(r) + 1 / Math.cos(r)); };
const mN = merc(meta.north), mS = merc(meta.south);
const demX = (lon) => ((lon - meta.west) / (meta.east - meta.west)) * meta.width;
const demY = (lat) => ((mN - merc(lat)) / (mN - mS)) * meta.height;

console.log(`工作网格 ${COLS}×${ROWS}（${STEP}°/格）　对 DEM 取最高点…`);
const hi = new Int16Array(COLS * ROWS);      // 格内最高
const avg = new Int16Array(COLS * ROWS);     // 格内平均
let t0 = Date.now();
for (let r = 0; r < ROWS; r += 1) {
  const lat0 = N_DEG - r * STEP, lat1 = N_DEG - (r + 1) * STEP;
  const y0 = Math.max(0, Math.floor(demY(lat0))), y1 = Math.min(meta.height - 1, Math.ceil(demY(lat1)));
  for (let c = 0; c < COLS; c += 1) {
    const x0 = Math.max(0, Math.floor(demX(W_DEG + c * STEP)));
    const x1 = Math.min(meta.width - 1, Math.ceil(demX(W_DEG + (c + 1) * STEP)));
    let m = -32768, sum = 0, n = 0;
    for (let y = y0; y <= y1; y += 1) {
      const row = y * meta.width;
      for (let x = x0; x <= x1; x += 1) {
        const v = dem[row + x];
        if (v > m) m = v;
        sum += v; n += 1;
      }
    }
    hi[r * COLS + c] = m;
    avg[r * COLS + c] = n ? Math.round(sum / n) : m;
  }
}
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ── 代价 ────────────────────────────────────────────────────────────
// 幂次、屏障阈值、基准面半径：都是标定出来的，不是拍的。
// 判据是「那批关隘能不能量出该有的扼守价值」＋「邻接别把郡孤立掉」。
// 扫描记录见 docs/EVAL.md。POW 1 → 2.6 时潼关从 27% 涨到 101%
const POW = Number(process.env.POW ?? 2.6);
const BLOCK = 255;
const cost = new Uint8Array(COLS * ROWS);

// 「过不去」与「多难走」是两件事，用两份高程分开算：
//
//   过不去 —— 用**最高点**。一道山脊挡在那儿，旁边有个豁口不代表大军能过
//   多难走 —— 用**平均高程**。行军的辛苦是整片地的起伏，不是那一道脊
//
// 头一版两件事都用最高点，于是南方的破碎丘陵被判成一片难走的褐色——
// 那是脊线噪声，不是真的到处难行。
const slopeOf = (f, i, c, r) => {
  let sl = 0;
  if (c > 0) sl = Math.max(sl, Math.abs(f[i] - f[i - 1]));
  if (c < COLS - 1) sl = Math.max(sl, Math.abs(f[i] - f[i + 1]));
  if (r > 0) sl = Math.max(sl, Math.abs(f[i] - f[i - COLS]));
  if (r < ROWS - 1) sl = Math.max(sl, Math.abs(f[i] - f[i + COLS]));
  return sl;
};

// ── 屏障 = 立在四周之上的那片高地 ──────────────────────────────────
//
// 头一版按「逐格坡度 > 500m」判，出来的是**麻点不是墙**：连通域 269740 片、
// 没有一片够得上屏障。因为最高点场本身是毛的——相邻两格的最高点差得很大，
// 于是崎岖地带处处「陡」，却处处不连。
//
// 大军翻不翻得过一道岭，看的不是某一格陡不陡，是**这片地比周围高出多少**。
// 所以取局部基准面（半径 30km 内的最低处），高出它 600m 以上的算屏障。
// 山口正是脊线上落回基准面的那个豁口——它自然就是通的，不用手工标。
const RAD = Number(process.env.RAD ?? 8);        // 局部基准面的半径（格）
const base1 = new Int16Array(COLS * ROWS);
const baseLo = new Int16Array(COLS * ROWS);
for (let r = 0; r < ROWS; r += 1) {              // 横向最小
  for (let c = 0; c < COLS; c += 1) {
    let m = 32767;
    for (let d = -RAD; d <= RAD; d += 1) {
      const cc = c + d;
      if (cc < 0 || cc >= COLS) continue;
      const v = avg[r * COLS + cc];
      if (v < m) m = v;
    }
    base1[r * COLS + c] = m;
  }
}
for (let c = 0; c < COLS; c += 1) {              // 纵向最小
  for (let r = 0; r < ROWS; r += 1) {
    let m = 32767;
    for (let d = -RAD; d <= RAD; d += 1) {
      const rr = r + d;
      if (rr < 0 || rr >= ROWS) continue;
      const v = base1[rr * COLS + c];
      if (v < m) m = v;
    }
    baseLo[r * COLS + c] = m;
  }
}

const RELIEF = Number(process.env.RELIEF ?? 1600);   // 高出局部基准面多少算屏障
const closed = new Uint8Array(COLS * ROWS);
for (let i = 0; i < closed.length; i += 1) {
  if (avg[i] <= 0) continue;                     // 海另算
  if (hi[i] > 3600 || hi[i] - baseLo[i] > RELIEF) closed[i] = 1;
}
// 丢掉小连通域：一块孤零零的高地是山包不是屏障
const MIN_WALL = Number(process.env.MIN_WALL ?? 40);
{
  const seen = new Uint8Array(COLS * ROWS);
  const stack = new Int32Array(COLS * ROWS);
  let killed = 0, walls = 0, wcells = 0;
  for (let i0 = 0; i0 < closed.length; i0 += 1) {
    if (!closed[i0] || seen[i0]) continue;
    // 栈用后自增／前自减。写成 `stack[sp += 1]` 配 `stack[sp -= 1]`
    // 是错位的：压进下标 1，弹出下标 0——每个连通域都只数出一格，
    // 于是「647886 片太小」，而真正该清掉的格一格没清
    let sp = 0, n = 0;
    const comp = [];
    stack[sp++] = i0; seen[i0] = 1;
    while (sp > 0) {
      const k = stack[--sp];
      comp.push(k); n += 1;
      const c = k % COLS, r = (k - c) / COLS;
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
        const nk = rr * COLS + cc;
        if (closed[nk] && !seen[nk]) { seen[nk] = 1; stack[sp++] = nk; }
      }
    }
    if (n < MIN_WALL) { for (const k of comp) closed[k] = 0; killed += 1; }
    else { walls += 1; wcells += n; }
  }
  console.log(`山墙：${walls} 道连成片（${(wcells / 1e3).toFixed(0)}k 格），`
    + `${killed} 片太小已放行（是山包不是屏障）`);
}

for (let r = 0; r < ROWS; r += 1) {
  for (let c = 0; c < COLS; c += 1) {
    const i = r * COLS + c;
    if (avg[i] <= 0 || closed[i]) { cost[i] = BLOCK; continue; }
    // 难走程度用平均高程与它的坡：整片地的起伏，不是那一道脊。
    //
    // 幂次很要紧。线性代价下崎岖地与谷底只差十倍，大军照样满山跑，
    // 于是「堵住山口」逼不出绕路——实测剑门关、虎牢关的扼守价值都是 1%。
    // 真实的辎重行军是**沿谷底走**的：坡一陡代价就爆涨，
    // 所以取幂次，让谷底与山坡差出两个量级。
    const sl = slopeOf(avg, i, c, r);
    const raw = (1 + sl / 45 + avg[i] / 1200) ** POW;
    cost[i] = Math.max(1, Math.min(240, Math.round(raw * 3)));
  }
}

// ── 河是墙，渡口与港是墙上的口子 ────────────────────────────────────
const hyd = JSON.parse(fs.readFileSync("lib/game/data/hydrology.json", "utf8"));
const nodes = JSON.parse(fs.readFileSync("lib/game/data/strategic-nodes.json", "utf8")).nodes;
const cell = (lon, lat) => [
  Math.max(0, Math.min(COLS - 1, Math.round((lon - W_DEG) / STEP - 0.5))),
  Math.max(0, Math.min(ROWS - 1, Math.round((N_DEG - lat) / STEP - 0.5)))];
const MAJOR = new Set(["长江", "黄河"]);
const river = new Uint8Array(COLS * ROWS);
for (const rv of hyd.rivers) {
  const big = MAJOR.has(rv.name) ? 2 : 1;
  const pts = rv.points;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [x0, y0] = cell(pts[i][0], pts[i][1]), [x1, y1] = cell(pts[i + 1][0], pts[i + 1][1]);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let t = 0; t <= n; t += 1) {
      const c = Math.round(x0 + ((x1 - x0) * t) / n), r = Math.round(y0 + ((y1 - y0) * t) / n);
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        const cc = c + dc, rr = r + dr;
        if (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS) {
          const k = rr * COLS + cc;
          river[k] = Math.max(river[k], big);
        }
      }
    }
  }
}
const crossings = [
  ...hyd.fords.map((f) => [f.longitude, f.latitude, f.name]),
  ...nodes.filter((n) => n.kind === "ford" || n.kind === "port").map((n) => [n.longitude, n.latitude, n.name]),
];
const gap = new Uint8Array(COLS * ROWS);
for (const [lo, la] of crossings) {
  const [c0, r0] = cell(lo, la);
  for (let dr = -4; dr <= 4; dr += 1) for (let dc = -4; dc <= 4; dc += 1) {
    const c = c0 + dc, r = r0 + dr;
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) gap[r * COLS + c] = 1;
  }
}
// ── 古道也是地形 ────────────────────────────────────────────────────
//
// 一个关之所以在那儿，是因为那儿有一条修了几百年的路——蜀道的栈、
// 太行八陉的道、黄河的津渡。走它比翻生山坡便宜得多，所以最省路径
// 本来就该往那儿走。
//
// 不给这一层，最省路径会绕开所有关口去爬缓坡：实测 61 个据点只有 24 个
// 落在路上，虎牢关、武关、井陉关、蜀道五条全部落空。
// 那不是它们不重要，是模型里没有「路」这个东西。
const ROADY = new Set(["gate", "pass", "ford", "port"]);
let roadCells = 0;
for (const n of nodes) {
  if (!ROADY.has(n.kind)) continue;
  const [c0, r0] = cell(n.longitude, n.latitude);
  for (let dr = -3; dr <= 3; dr += 1) for (let dc = -3; dc <= 3; dc += 1) {
    const c = c0 + dc, r = r0 + dr;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
    const k = r * COLS + c;
    if (cost[k] === BLOCK) continue;
    const cut2 = Math.max(3, Math.round(cost[k] * 0.35));
    if (cut2 < cost[k]) { cost[k] = cut2; roadCells += 1; }
  }
}
console.log(`古道折价：${roadCells} 格（关隘、谷道、渡口、港的近旁）`);

let cut = 0;
for (let i = 0; i < cost.length; i += 1) {
  if (!river[i] || gap[i] || cost[i] === BLOCK) continue;
  if (river[i] === 2) { cost[i] = BLOCK; cut += 1; }
  else cost[i] = Math.min(240, cost[i] * 3);
}
const pass = cost.reduce((n, v) => n + (v !== BLOCK ? 1 : 0), 0);
console.log(`大江断流 ${cut} 格　渡口港口开口 ${crossings.length} 处`);
console.log(`可通行 ${(pass / 1e6).toFixed(2)}M / ${(COLS * ROWS / 1e6).toFixed(2)}M（${(pass / cost.length * 100).toFixed(0)}%）`);

// ── 第二张场：水路 ──────────────────────────────────────────────────
//
// 「长江流域的那些港口，理论上来说都能到」——江与海本身就是路，
// 而且是比陆路便宜得多的路。只有一张陆路场时，公孙度隔着渤海据东莱
// 就成了「孤悬粮尽」，白送给孔融；而历史上他正是渡海去的。
//
// 水上便宜、岸边可上下、内陆走不通。港与渡口是两张场之间的口子。
const wcost = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r += 1) {
  for (let c = 0; c < COLS; c += 1) {
    const i = r * COLS + c;
    if (avg[i] <= 0) { wcost[i] = 4; continue; }            // 海
    if (river[i]) { wcost[i] = river[i] === 2 ? 5 : 9; continue; }  // 大江 / 小河
    // 陆上：只有很近岸的低地能拖船／换乘，其余走不通
    wcost[i] = avg[i] < 60 ? 90 : BLOCK;
  }
}
// 港与渡口：岸上那一圈打通，船能靠、人能上
for (const n of nodes) {
  if (n.kind !== "port" && n.kind !== "ford") continue;
  const [c0, r0] = cell(n.longitude, n.latitude);
  for (let dr = -5; dr <= 5; dr += 1) for (let dc = -5; dc <= 5; dc += 1) {
    const c = c0 + dc, r = r0 + dr;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
    const k = r * COLS + c;
    if (wcost[k] === BLOCK) wcost[k] = 30;
  }
}
const wpass = wcost.reduce((n, v) => n + (v !== BLOCK ? 1 : 0), 0);
console.log(`水路场：可行 ${(wpass / 1e6).toFixed(2)}M 格（海、江、近岸与港渡）`);

fs.mkdirSync("public/game", { recursive: true });
fs.writeFileSync("public/game/costfield.bin", Buffer.from(cost.buffer));
fs.writeFileSync("public/game/costfield-water.bin", Buffer.from(wcost.buffer));
fs.writeFileSync("public/game/costfield.json", JSON.stringify({
  _note: "逐格通行代价。255 = 不可通行（海、雪线之上、太陡、无渡的大江）。",
  west: W_DEG, north: N_DEG, step: STEP, cols: COLS, rows: ROWS, block: BLOCK,
  generatedFrom: "tools/build-costfield.mjs",
  water: "costfield-water.bin：同样尺寸的水路场。海 4 / 大江 5 / 小河 9 / 近岸 90 / 港渡 30，其余不可行",
}, null, 2));
console.log(`→ public/game/costfield.bin  ${(cost.length / 1024).toFixed(0)}KB`);

// ── 画出来：这张图就是新底图的骨架 ──────────────────────────────────
const cs = JSON.parse(fs.readFileSync("lib/game/data/commanderies.json", "utf8"));
const rgba = Buffer.alloc(COLS * ROWS * 4);
for (let i = 0; i < cost.length; i += 1) {
  const o = i * 4;
  const v = cost[i];
  if (v === BLOCK) {
    // 不可通行分两色：海是青灰，山墙是深墨
    if (avg[i] <= 0) { rgba[o] = 150; rgba[o + 1] = 168; rgba[o + 2] = 176; }
    else { rgba[o] = 52; rgba[o + 1] = 46; rgba[o + 2] = 40; }
  } else {
    // 越好走越浅：纸色 → 赭。**按对数铺色**——代价是幂次的，
    // 线性铺色会让谷底之外全糊成一片同样的褐，看不出层次
    const t = Math.min(1, Math.log(v / 3) / Math.log(240 / 3));
    rgba[o] = Math.round(246 - t * 96);
    rgba[o + 1] = Math.round(240 - t * 110);
    rgba[o + 2] = Math.round(226 - t * 122);
  }
  rgba[o + 3] = 255;
}
// 治所打点
for (const c of cs) {
  const [x, y] = cell(c.longitude, c.latitude);
  for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
    if (dr * dr + dc * dc > 5) continue;
    const cc = x + dc, rr = y + dr;
    if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
    const o = (rr * COLS + cc) * 4;
    rgba[o] = 140; rgba[o + 1] = 59; rgba[o + 2] = 47;
  }
}
// 关渡港打点：墙上的口子
for (const n of nodes) {
  const [x, y] = cell(n.longitude, n.latitude);
  for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
    const cc = x + dc, rr = y + dr;
    if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
    const o = (rr * COLS + cc) * 4;
    rgba[o] = 32; rgba[o + 1] = 92; rgba[o + 2] = 148;
  }
}
fs.mkdirSync("public/game/map", { recursive: true });
await sharp(rgba, { raw: { width: COLS, height: ROWS, channels: 4 } })
  .webp({ quality: 88 }).toFile("public/game/map/cost.webp");
console.log(`→ public/game/map/cost.webp  ${(fs.statSync("public/game/map/cost.webp").size / 1024).toFixed(0)}KB`);
