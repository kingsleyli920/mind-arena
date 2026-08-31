// 构建水系与海岸线数据层，产出 lib/game/data/hydrology.json。
//
// 数据来源
//   1) Natural Earth 10m（公有领域）ne_10m_coastline / ne_10m_rivers_lake_centerlines
//      经 raw.githubusercontent.com/nvkelso/natural-earth-vector 取得，缓存在 refs/natural-earth/
//      （refs/ 已在 .gitignore 中；删掉缓存重跑会重新下载，结果一致）
//   2) 汉末水系的历史复原点列，见本文件 HISTORICAL 段，逐条注明依据
//
// 不确定性总纲
//   · Natural Earth 是**现代**水系与**现代**海岸线。汉末与今日差异最大的四处：
//     黄河下游（东汉故道 vs 今道）、济水与泗水（今已不存）、淮水下游（黄河夺淮前独流入海）、
//     渤海西南岸与苏北海岸（今岸线多为后世泥沙淤积，汉代岸线在其以西数十公里）。
//   · 复原点列是战略尺度的骨架线，误差量级 10–50 km，不能当考古定位用。
//     插值点仅为绘制平滑，不携带独立史料依据；史料依据落在 controlPoints 的注记上。
//
// 运行：node tools/build-hydrology.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "refs", "natural-earth");
const OUT = path.join(ROOT, "lib", "game", "data", "hydrology.json");

// ── 地图网格约定（等距圆柱投影，与 commanderies.json 同一口径）───────────────
const GRID = {
  projection: "equirectangular",
  west: 94.0, east: 127.0, south: 16.0, north: 43.0,
  cellSize: 0.1, cols: 330, rows: 270,
  index: "index = row * 330 + col",
  col: "col = floor((lon - 94.0) / 0.1)",
  row: "row = floor((43.0 - lat) / 0.1)",
  cellCenter: "lon = 94.0 + (col + 0.5) * 0.1 ; lat = 43.0 - (row + 0.5) * 0.1",
};
const BOX = { west: GRID.west, east: GRID.east, south: GRID.south, north: GRID.north };

const TOL = 0.02;         // Douglas-Peucker 容差（度）≈ 2 km，约 1/5 格
const MIN_EXTENT = 0.03;  // 小于 1/3 格的碎片直接丢弃（渲染上看不见，只增体积）
const CHAIN_EPS = 0.05;   // Natural Earth 分段端点接续容差（度）
const SPLINE_STEP = 0.05; // 复原段样条重采样间距（度）
const PRECISION = 4;      // 输出保留小数位 ≈ 11 m

// ── 几何工具 ─────────────────────────────────────────────────────────────────
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

// 点到线段的垂距。注意：这里在经纬度空间内直接算，1° 经距在 35°N 约为纬距的 0.82 倍，
// 存在各向异性。战略尺度绘制无影响；若日后要按真实距离简化，需先按 cos(lat) 缩放经度。
function perpDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return dist(p, a);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return dist(p, [a[0] + u * dx, a[1] + u * dy]);
}

// Douglas-Peucker（迭代式，避免深递归；保留集与遍历顺序无关，结果确定）
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e - s < 2) continue;
    let idx = -1, max = 0;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(pts[i], pts[s], pts[e]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Liang-Barsky 线段裁剪
function clipSegment(p0, p1, b) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const P = [-dx, dx, -dy, dy];
  const Q = [p0[0] - b.west, b.east - p0[0], p0[1] - b.south, b.north - p0[1]];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return null; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[p0[0] + t0 * dx, p0[1] + t0 * dy], [p0[0] + t1 * dx, p0[1] + t1 * dy]];
}

// 把一条折线裁到框内；出框再入框会断成多段
function clipToBox(pts, b) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = clipSegment(pts[i], pts[i + 1], b);
    if (!seg) { cur = null; continue; }
    if (!cur || !same(cur[cur.length - 1], seg[0])) { cur = [seg[0]]; runs.push(cur); }
    cur.push(seg[1]);
  }
  return runs.filter((r) => r.length >= 2);
}

const extent = (pts) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return Math.max(x1 - x0, y1 - y0);
};

// 均匀 Catmull-Rom 重采样：只用于复原段，把手工控制点变成可直接描边的平滑折线
function catmullRom(pts, step) {
  if (pts.length < 3) return pts.slice();
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const n = Math.max(1, Math.round(dist(p1, p2) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (
        (2 * p1[d]) + (-p0[d] + p2[d]) * t +
        (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 +
        (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3
      )));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const round = (pts) => pts.map(([x, y]) => [
  Number(x.toFixed(PRECISION)), Number(y.toFixed(PRECISION)),
]);

// 相邻重复点会让描边算法出现零长度段，去掉
function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  return out;
}

// ── Natural Earth 取数（带本地缓存）──────────────────────────────────────────
const NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

async function loadNE(name) {
  const dest = path.join(CACHE, `${name}.geojson`);
  if (!fs.existsSync(dest)) {
    await fs.promises.mkdir(CACHE, { recursive: true });
    process.stdout.write(`  下载 ${name}.geojson …`);
    const res = await fetch(`${NE_BASE}/${name}.geojson`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    process.stdout.write(" 完成\n");
  }
  const buf = await fs.promises.readFile(dest);
  return {
    name,
    json: JSON.parse(buf.toString("utf8")),
    bytes: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  };
}

// 把 GeoJSON 的 LineString / MultiLineString 摊平成折线数组
function partsOf(feature) {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

// 按 (name, featurecla) 白名单挑段，再用 seedBox 排除同名异地（如首尔的 Han River）
function pickParts(fc, whitelist, seedBox) {
  const keys = new Set(whitelist.map((w) => w.join(" ")));
  const out = [];
  for (const f of fc.features) {
    const p = f.properties;
    const nm = p.name ?? p.name_en;
    if (!keys.has(`${nm} ${p.featurecla}`)) continue;
    for (const part of partsOf(f)) {
      if (part.length < 2) continue;
      const inSeed = part.some(([x, y]) =>
        x >= seedBox[0] && x <= seedBox[2] && y >= seedBox[1] && y <= seedBox[3]);
      if (inSeed) out.push(part);
    }
  }
  return out;
}

// 从 seed 端点出发把分段首尾相接串成一条干流；必要时翻转段方向。
// 候选相同距离时取更长的段，再以下标兜底，保证多次运行结果一致。
function chainParts(parts, seed, eps) {
  if (!parts.length) return [];
  const used = new Array(parts.length).fill(false);
  let bi = -1, bd = Infinity, brev = false;
  parts.forEach((s, i) => {
    const d0 = dist(s[0], seed), d1 = dist(s[s.length - 1], seed);
    if (d0 < bd) { bd = d0; bi = i; brev = false; }
    if (d1 < bd) { bd = d1; bi = i; brev = true; }
  });
  used[bi] = true;
  let chain = brev ? parts[bi].slice().reverse() : parts[bi].slice();
  for (;;) {
    const tail = chain[chain.length - 1];
    let ci = -1, cd = Infinity, crev = false;
    for (let i = 0; i < parts.length; i++) {
      if (used[i]) continue;
      const s = parts[i];
      const cand = [[dist(s[0], tail), false], [dist(s[s.length - 1], tail), true]];
      for (const [d, rev] of cand) {
        if (d > eps) continue;
        const better = d < cd - 1e-12
          || (Math.abs(d - cd) <= 1e-12 && ci >= 0 && s.length > parts[ci].length);
        if (better) { cd = d; ci = i; crev = rev; }
      }
    }
    if (ci < 0) break;
    used[ci] = true;
    const seg = crev ? parts[ci].slice().reverse() : parts[ci].slice();
    chain = chain.concat(seg.slice(1));
  }
  return chain;
}

// ═══════════════════════════════════════════════════════════════════════════
// 【核心】汉末水系的历史复原点列
//
// 每个控制点写明对应的现代地名或史料出处。插值点由 Catmull-Rom 生成，
// 只为绘制平滑，本身没有独立依据。
// ═══════════════════════════════════════════════════════════════════════════

// 黄河「东汉故道」（王景故道）
//
// 依据：
//   《后汉书·王景传》：永平十二年（69）明帝诏王景、王吴「修渠筑堤，自荥阳东至千乘
//   海口千余里」，次年（70）夏成。此后黄河下游长期安流，史称「王景治河，千年无患」。
//   走向（黄河水利委员会 yrcc.gov.cn《王景治河》、维基百科《黄河改道》）：
//     · 「修筑从濮阳城南到渤海千乘的千余里黄河大堤」
//     · 「这条河道于今河南濮阳由西汉旧河道分出，经过今山东省聊城、禹城等县，
//        在山东利津县附近入海」
//     · 概括走向：今濮阳西南—范县北—莘县东—聊城南—禹城西—滨州北—利津附近入海
//   谭其骧《中国历史地图集》第二册东汉图组同此。
//
// 与现代 Natural Earth 数据的差异：
//   今黄河自荥阳以下东流经开封、兰考，再东北经东明、鄄城、东平、济南、东营入海
//   ——这一段其实是 1855 年铜瓦厢改道后夺古济水／大清河河道而成，与东汉河道无涉。
//   东汉故道自荥阳即折东北，走今河南濮阳、山东聊城、禹城—滨州一线，纬度较今道偏北
//   约 1°–1.5°。1128—1855 年间黄河更南下夺淮由苏北入黄海，与两者都不同。
//   本脚本因此在经度 113.40°（荥阳北·敖仓）处截断 Natural Earth 干流，以下改用复原点列。
const HAN_YELLOW_SPLIT_LON = 113.40;

const HUANGHE_HAN_COURSE = [
  [113.42, 34.99, "荥阳北·敖仓——与今河道分流处"],
  [113.60, 35.05, "汜水口东"],
  [113.80, 35.13, "卷县（今河南原阳西）北"],
  [114.00, 35.18, "阳武（今原阳）北"],
  [114.22, 35.28, "酸枣（今延津北）——延津渡口群所在"],
  [114.42, 35.42, "燕县（今延津东北）"],
  [114.58, 35.62, "白马津（南岸·今滑县东北）／黎阳津（北岸·今浚县东）——两津共扼一渡，河在其间"],
  [114.80, 35.66, "顿丘（今清丰南）"],
  [115.00, 35.72, "濮阳南——王景河由西汉故道分出处"],
  [115.30, 35.84, "濮阳东南"],
  [115.55, 35.95, "范县北"],
  [115.72, 36.10, "莘县东南"],
  [115.88, 36.28, "莘县东"],
  [116.02, 36.42, "聊城南"],
  [116.20, 36.62, "茌平西"],
  [116.35, 36.78, "禹城西北"],
  [116.50, 36.90, "禹城西"],
  [116.80, 37.02, "平原东南（据首尾两点内插）"],
  [117.10, 37.14, "临邑北（内插）"],
  [117.38, 37.24, "商河南（内插）"],
  [117.70, 37.36, "惠民南（内插）"],
  [118.00, 37.48, "滨州北"],
  [118.26, 37.58, "利津"],
  [118.50, 37.70, "千乘海口——东汉黄河入海口（汉千乘郡境，今利津以东）"],
];

// 淮水下游。汉代淮水独流东入黄海，沿途无洪泽湖（洪泽湖系 1194 年黄河夺淮后、
// 明代筑高家堰壅水而成），亦无今日的入江水道。
// 《汉书·地理志》临淮郡淮浦县：淮水至淮浦入海。
// Natural Earth 的 Huai 只到今安徽淮南以西，以下全为复原。
const HUAI_HAN_COURSE = [
  [116.52, 32.50, "与 Natural Earth 数据衔接处（今安徽淮南西）"],
  [116.80, 32.66, "寿春（今寿县）北——淮南郡治，肥水入淮"],
  [117.20, 32.86, "当涂·涂山（今怀远）——涡水入淮"],
  [117.39, 32.92, "钟离（今蚌埠东）"],
  [117.89, 33.14, "五河——濠水、沱水入淮"],
  [118.25, 33.20, "临淮（今泗洪南）"],
  [118.52, 33.00, "盱眙——汉代无洪泽湖，淮水径流其地"],
  [118.85, 33.35, "淮阴西"],
  [119.03, 33.60, "泗口／清口（今淮安）——泗水自北来入淮"],
  [119.26, 33.78, "淮浦（今涟水）"],
  [119.55, 33.92, "淮水河口段（今涟水东）"],
  [119.85, 34.02, "汉代淮水入海口（约当今云梯关一线，误差可达数十公里）"],
];

// 济水。四渎之一（江、河、淮、济），今已不存。上游为沇水，出王屋山；至荥阳北出
// 黄河南岸（《禹贡》「溢为荥」，汉人以为济水潜行河下而复出），东经定陶、大野泽，
// 折北经历城，东北至千乘入海（《水经注·济水》：「又东北过甲下邑，济水东北入于海」）。
// 与 Natural Earth 的关系：今黄河东平—济南—利津段走的正是古济水／大清河河道
// （1855 年铜瓦厢改道所夺），所以济水下游与现代黄河下游高度重合，而与东汉黄河无关。
const JISHUI_HAN_COURSE = [
  [112.60, 35.09, "沇水源·王屋山（今河南济源西北）"],
  [112.85, 35.02, "轵县（今济源东南）"],
  [113.08, 34.94, "温县——济水南流注河"],
  [113.30, 34.90, "入河处（汉人谓济水潜行河下）"],
  [113.42, 34.86, "荥阳北·荥泽——济水复出于河南岸"],
  [113.72, 34.90, "原武（今原阳西）南"],
  [114.05, 34.96, "阳武（今原阳）南"],
  [114.42, 35.00, "封丘南"],
  [114.90, 35.06, "济阳（今兰考东北）"],
  [115.35, 35.12, "冤句（今菏泽西南）"],
  [115.57, 35.07, "定陶——济阴郡治"],
  [115.88, 35.22, "乘氏（今巨野西南）"],
  [116.10, 35.45, "大野泽（巨野泽）"],
  [116.32, 35.76, "泽北出口·须昌（今东平西北）"],
  [116.47, 35.98, "须昌北"],
  [116.58, 36.22, "平阴东"],
  [116.78, 36.46, "卢县（今长清南）——济北国治"],
  [117.05, 36.66, "历城（今济南）"],
  [117.35, 36.72, "台县（今章丘西）"],
  [117.74, 36.86, "梁邹（今邹平）"],
  [117.95, 37.10, "临济（今高青）"],
  [118.15, 37.28, "千乘·甲下邑——济水入海（与东汉黄河口相邻而各自入海）"],
];

// 泗水。汉末徐州的命脉水道，串起沛、彭城、下邳、淮阴。源出鲁国卞县陪尾山，
// 西流经鲁、瑕丘折南，循今南四湖一线南下，至淮阴泗口入淮。
// 今已不存：南四湖为明代壅水成湖，下游被 1194 年后黄河夺淮河道及中运河取代，
// Natural Earth 的现代泗河仅存山东境内上游短段，不可直接使用。
const SISHUI_HAN_COURSE = [
  [117.28, 35.68, "陪尾山·泗水源（今山东泗水县东）"],
  [117.10, 35.65, "卞县（今泗水）"],
  [116.99, 35.62, "鲁县（今曲阜）北——洙泗之间"],
  [116.83, 35.55, "瑕丘（今兖州）"],
  [116.75, 35.32, "南平阳东南"],
  [116.68, 35.05, "湖陵（今鱼台北）——今为南四湖水域"],
  [116.85, 34.85, "方与东南"],
  [116.94, 34.73, "沛县——沛国"],
  [117.05, 34.50, "留县"],
  [117.18, 34.26, "彭城（今徐州）——泗水与汳水交会"],
  [117.45, 34.18, "吕县·吕梁洪"],
  [117.95, 34.10, "下邳——沂水自北来会"],
  [118.15, 33.98, "司吾（今新沂南）"],
  [118.30, 33.90, "下相（今宿迁西南）"],
  [118.70, 33.72, "凌县（今泗阳）"],
  [119.03, 33.60, "泗口／清口（今淮安）——泗水入淮"],
];

// ── 河流清单 ─────────────────────────────────────────────────────────────────
// ne: Natural Earth 段白名单 [name, featurecla]；seedBox: [w,s,e,n] 排除同名异地
// seed: 上游起点，用于确定串接方向；historicalTail: 截断经度之后接上的复原点列
const RIVERS = [
  {
    id: "changjiang", name: "长江", aliases: ["江水", "大江"], historical: false,
    ne: [["Tongtian", "River"], ["Jinsha", "River"], ["Chang Jiang", "River"], ["Yangtze", "River"]],
    seedBox: [90, 24, 122, 36], seed: [92.99, 34.10],
    headLabel: { from: "通天河（源头段）", to: "今镇江—扬州一带（119.6°E）" },
    note:
      "取自 Natural Earth 干流中心线（通天河—金沙江—川江—荆江—扬子江）。" +
      "数据止于今镇江—扬州一带（119.6°E）：以下江面过宽，NE 以水域面而非中心线表达；" +
      "汉代长江口本也在今江阴—如皋一线附近，今上海、崇明尚未成陆，故未强行外推。" +
      "另需注意：汉末江汉平原尚有云梦泽，洞庭湖远小于今日，荆江河曲与今不同——" +
      "干流大势可用，湖沼形态不可照搬。",
  },
  {
    id: "huanghe", name: "黄河", aliases: ["河水", "大河"], historical: true,
    ne: [["Huang", "River"], ["Huang", "Lake Centerline"]],
    seedBox: [95, 32, 122, 42], seed: [96.16, 35.13],
    truncateAtLon: HAN_YELLOW_SPLIT_LON,
    historicalTail: HUANGHE_HAN_COURSE,
    headLabel: { from: "河源（约古宗列曲、扎陵湖—鄂陵湖）", to: "荥阳北·敖仓" },
    tailLabel: { from: "荥阳北·敖仓", to: "千乘海口（今利津以东）" },
    note:
      "【历史河道复原·与现代数据差异最大的一条】" +
      "上游至荥阳（113.40°E）用 Natural Earth 干流；荥阳以下改用东汉「王景故道」复原点列。" +
      "依据：《后汉书·王景传》永平十二年（69）诏修「自荥阳东至千乘海口千余里」，十三年（70）夏成；" +
      "走向为今濮阳西南—范县北—莘县东—聊城南—禹城西—滨州北，于今山东利津附近入渤海。" +
      "差异：今黄河自荥阳东流经开封、兰考，再东北经东明、东平、济南、东营入海——" +
      "这一段其实是 1855 年铜瓦厢改道后夺古济水／大清河河道而成，与东汉河道无涉；" +
      "1128—1855 年间黄河更南下夺淮由苏北入黄海。故渲染汉末地图时绝不可直接使用现代黄河线。" +
      "复原线纬度较今道偏北约 1°–1.5°。另：汉代渤海西南岸线在今岸线以西数十公里" +
      "（今黄河三角洲系 1855 年后淤积），故复原的入海口点位落在现代陆地上，属正常，非坐标错误。",
  },
  {
    id: "huaishui", name: "淮水", aliases: ["淮河"], historical: true,
    ne: [["Huai", "River"]],
    seedBox: [112, 30, 120, 35], seed: [113.72, 32.42],
    historicalTail: HUAI_HAN_COURSE,
    headLabel: { from: "桐柏山东（今河南信阳西）", to: "今安徽淮南西" },
    tailLabel: { from: "今安徽淮南西", to: "汉代淮水入海口（今云梯关一线）" },
    note:
      "上游用 Natural Earth；今安徽淮南以下为复原。汉代淮水独流东入黄海，" +
      "沿途无洪泽湖（洪泽湖系 1194 年黄河夺淮后、明代筑高家堰壅水而成），亦无今日的入江水道。" +
      "《汉书·地理志》临淮郡淮浦县：淮水至淮浦入海。" +
      "汉代苏北海岸线在今岸线以西约 20–50 km，今滨海平原多为黄河夺淮期泥沙淤积，" +
      "河口点位误差可达数十公里。",
  },
  {
    id: "hanshui", name: "汉水", aliases: ["沔水", "夏水"], historical: false,
    ne: [["Han", "River"], ["Han", "Lake Centerline"]],
    seedBox: [105, 29, 116, 34], seed: [106.40, 33.07],
    headLabel: { from: "汉中盆地（今陕西汉中西）", to: "夏口入江（今武汉）" },
    note:
      "Natural Earth 干流，自汉中盆地经襄阳至夏口入江，古今大势一致。" +
      "seedBox 用于排除同名的朝鲜半岛汉江（Han River，126.8–127.2°E）。" +
      "中段包含丹江口水库的湖泊中心线——该水库为 1973 年建成的现代工程，" +
      "汉代此处是均县一带的自由河道，绘制时不应画成湖面。",
  },
  {
    id: "weishui", name: "渭水", aliases: ["渭河"], historical: false,
    ne: [["Wei", "River"]],
    seedBox: [103, 33, 112, 36], seed: [104.06, 34.99],
    headLabel: { from: "渭源（今甘肃渭源）", to: "潼关注河（110.3°E）" },
    note: "Natural Earth 干流。关中命脉，自陇西东流经长安北至潼关注河，古今河道稳定。",
  },
  {
    id: "jishui", name: "济水", aliases: ["泲水"], historical: true,
    ne: [], seed: null,
    historicalOnly: JISHUI_HAN_COURSE,
    tailLabel: { from: "王屋山沇水源", to: "千乘·甲下邑入海" },
    note:
      "【全线为历史复原，现代已不存在】四渎之一（江、河、淮、济），Natural Earth 无对应要素。" +
      "汉代自王屋山出，至荥阳北出黄河南岸，东经定陶、大野泽，折北经历城，" +
      "东北至千乘入海（《水经注·济水》：又东北过甲下邑，济水东北入于海）。" +
      "关键提示：今黄河东平—济南—利津段走的正是古济水／大清河河道（1855 年所夺），" +
      "所以现代黄河下游线在视觉上更接近古济水，而不是东汉黄河——两者不可混淆。" +
      "汉末济水沿线是兖州、青州的漕运与郡界基准，误差量级 20–40 km。",
  },
  {
    id: "sishui", name: "泗水", aliases: [], historical: true,
    ne: [], seed: null,
    historicalOnly: SISHUI_HAN_COURSE,
    tailLabel: { from: "陪尾山泗水源（今泗水县东）", to: "泗口入淮（今淮安）" },
    note:
      "【全线为历史复原，下游今已不存】汉末徐州命脉水道，串起沛、彭城、下邳、淮阴。" +
      "源出鲁国卞县陪尾山，西流经鲁、瑕丘折南，循今南四湖一线南下，至淮阴泗口入淮。" +
      "今日南四湖为明代壅水成湖，下游河道被 1194 年后黄河夺淮河道及中运河取代，" +
      "Natural Earth 的现代泗河仅存山东境内上游短段，不可直接使用。",
  },
  {
    id: "xiangshui", name: "湘水", aliases: ["湘江"], historical: false,
    ne: [["Xiang", "River"]],
    seedBox: [109, 24, 114, 30], seed: [110.62, 25.49],
    headLabel: { from: "灵渠—零陵一带", to: "洞庭湖南岸（113.0°E）" },
    note:
      "Natural Earth 干流，自灵渠—零陵北流至洞庭。数据止于洞庭湖南岸，未含湖体及出口（城陵矶）。" +
      "汉末洞庭湖远小于今日，湘水下游多为河网沼泽，绘制时不宜画成今日湖形。",
  },
  {
    id: "ganshui", name: "赣水", aliases: ["赣江"], historical: false,
    ne: [["Gan", "River"], ["Gan", "Lake Centerline"]],
    seedBox: [113, 24, 118, 30], seed: [114.41, 24.71],
    headLabel: { from: "南康一带（今江西赣州）", to: "湖口入江（116.2°E）" },
    note:
      "Natural Earth 干流，自南康北流经豫章（今南昌），再经彭蠡泽（今鄱阳湖）中心线至湖口入江。" +
      "湖段用的是现代鄱阳湖中心线，汉末彭蠡泽范围与今鄱阳湖不同，仅可作走向参考。",
  },
  {
    id: "xijiang", name: "珠江（西江）", aliases: ["郁水", "牂柯江"], historical: false,
    ne: [["Nanpan", "River"], ["Hongshui", "River"], ["Quan", "River"], ["Xun", "River"], ["Xi", "River"]],
    seedBox: [103, 21, 115, 27], seed: [103.92, 25.88],
    headLabel: { from: "南盘江上游（今云南曲靖一带）", to: "珠江三角洲顶点附近（113.2°E）" },
    note:
      "Natural Earth 干流串接：南盘江—红水河—黔江—浔江—西江，止于珠江三角洲顶点附近。" +
      "汉代珠江三角洲大部尚为浅海／河口湾（番禺城当时近海），今三角洲平原为后世淤积，" +
      "河口段仅可作示意。交州苍梧、郁林诸郡的水路骨架以此线为准。",
  },
  {
    id: "liaoshui", name: "辽水", aliases: ["辽河"], historical: false,
    ne: [["Liao", "River"]],
    seedBox: [120, 39, 126, 44], seed: [123.55, 43.48],
    headLabel: { from: "地图北界（43°N）截断处", to: "辽东湾（122.2°E）" },
    note:
      "Natural Earth 干流，自西北向南注辽东湾，是公孙氏辽东与幽州之间的地理分界。" +
      "辽河下游历史上摆动频繁，汉代辽隧、险渎一带河道位置与今有出入；" +
      "北段超出地图范围（north=43.0）已被裁切。",
  },
];

// ── 汉末重要渡口／津 ─────────────────────────────────────────────────────────
// 只给经纬点位，不带任何游戏属性。史料位置多为「今某县东北」一类的方位描述，
// 转成经纬时按县城坐标偏移 0.05–0.15°，误差量级 5–15 km。
const FORDS = [
  {
    id: "mengjin", riverId: "huanghe", name: "孟津（富平津）", river: "黄河", longitude: 112.72, latitude: 34.88,
    note: "今河南洛阳孟津区会盟镇叩马村一带黄河南岸。雒阳正北门户，武王会盟、董卓焚洛皆系于此。此段古今河道基本一致。",
  },
  {
    id: "baimajin", riverId: "huanghe", name: "白马津", river: "黄河", longitude: 114.62, latitude: 35.58,
    note: "南岸渡口，今河南滑县东北，与北岸黎阳津相对。建安五年白马之战（关羽斩颜良）在此。点位落在东汉故道复原线上，不在今黄河上。",
  },
  {
    id: "yanjin", riverId: "huanghe", name: "延津", river: "黄河", longitude: 114.30, latitude: 35.30,
    note: "非单一渡口：今延津县东北至滑县以北的黄河渡口群总称。官渡之战前曹操自白马沿河西撤、袁绍追至延津南。点位落在东汉故道复原线上。",
  },
  {
    id: "guandu", riverId: null, name: "官渡", river: "鸿沟水系·官渡水", longitude: 114.03, latitude: 34.75,
    note: "今河南中牟县东北官渡桥村一带。严格说不在黄河干流上，而在黄河以南约 20 km 的鸿沟／汴渠—官渡水一线，是渡河南下通往许都的隘口。另有原阳说，位置存争议。",
  },
  {
    id: "puban", riverId: "huanghe", name: "蒲坂（蒲津）", river: "黄河", longitude: 110.27, latitude: 34.85,
    note: "今山西永济西蒲州古城西侧蒲津渡遗址，隔河对岸为左冯翊临晋（今陕西大荔）。关中与河东之间的主渡，建安十六年曹操与马超相持于此。峡口段，古今河位稳定。",
  },
  {
    id: "liyangjin", riverId: "huanghe", name: "黎阳津", river: "黄河", longitude: 114.55, latitude: 35.67,
    note: "北岸渡口，今河南浚县东，与南岸白马津共扼一渡。袁绍南下的前进基地。点位落在东汉故道复原线上。",
  },
  {
    id: "xiakou", riverId: "changjiang", name: "夏口", river: "长江", longitude: 114.29, latitude: 30.57,
    note: "汉水（夏水）入长江处，今湖北武汉汉阳—汉口一带。江夏郡门户，孙权后于蛇山筑夏口城。",
  },
  {
    id: "jiangjin", riverId: "changjiang", name: "江津", river: "长江", longitude: 112.24, latitude: 30.30,
    note: "江陵城南的长江渡口，今湖北荆州沙市。《水经注·江水》：江水又东径江陵县南……又东得江津口。荆州水军出江之门。",
  },
  {
    id: "niuzhu", riverId: "changjiang", name: "牛渚", river: "长江", longitude: 118.45, latitude: 31.68,
    note: "今安徽马鞍山采石矶，对岸为九江郡历阳（今和县）。江东最重要的横江渡，孙策东渡时袭据牛渚营。",
  },
  {
    id: "ruxukou", riverId: "changjiang", name: "濡须口", river: "长江·濡须水口", longitude: 117.98, latitude: 31.55,
    note: "巢湖经濡须水（今裕溪河）入江的水口，在濡须山（今含山县林头镇）与七宝山（今无为市石涧镇）之间，约当今含山县东关镇。建安十七年孙权于此筑濡须坞，魏吴三战于是。另有以入江处裕溪口（约 117.87, 31.41）为濡须口者。",
  },
  {
    id: "hukou", riverId: "changjiang", name: "湖口", river: "长江", longitude: 116.22, latitude: 29.74,
    note: "彭蠡泽（今鄱阳湖）入长江处，今江西湖口县。豫章—柴桑一线控扼中下游的节点。汉末彭蠡泽形态与今鄱阳湖差异较大。",
  },
];

// ── 构建 ─────────────────────────────────────────────────────────────────────
console.log("→ 读取 Natural Earth（公有领域）");
const coastSrc = await loadNE("ne_10m_coastline");
const riverSrc = await loadNE("ne_10m_rivers_lake_centerlines");

// 海岸线：裁剪 → 简化 → 丢弃小于 1/3 格的碎片 → 按长度排序（确定性）
console.log("→ 处理海岸线");
let coastClipped = 0;
const coastline = [];
for (const f of coastSrc.json.features) {
  for (const part of partsOf(f)) {
    for (const run of clipToBox(part, BOX)) {
      coastClipped += run.length;
      const s = dedupe(simplify(run, TOL));
      if (s.length >= 2 && extent(s) >= MIN_EXTENT) coastline.push(round(s));
    }
  }
}
coastline.sort((a, b) => b.length - a.length || a[0][0] - b[0][0] || a[0][1] - b[0][1]);

// 河流
console.log("→ 处理河流");
const rivers = [];
for (const spec of RIVERS) {
  const reaches = [];
  let points = [];

  if (spec.historicalOnly) {
    const ctrl = spec.historicalOnly;
    const line = dedupe(catmullRom(ctrl.map((c) => [c[0], c[1]]), SPLINE_STEP));
    const runs = clipToBox(line, BOX);
    points = runs.length ? runs.sort((a, b) => b.length - a.length)[0] : [];
    reaches.push({
      kind: "reconstructed",
      from: spec.tailLabel.from, to: spec.tailLabel.to,
      pointCount: points.length,
      method: "手工控制点 + Catmull-Rom 插值（插值点仅为绘制平滑，无独立史料依据）",
      controlPoints: ctrl,
    });
  } else {
    const parts = pickParts(riverSrc.json, spec.ne, spec.seedBox);
    if (!parts.length) throw new Error(`${spec.name}: Natural Earth 中未匹配到任何河段`);
    let chained = chainParts(parts, spec.seed, CHAIN_EPS);
    if (spec.truncateAtLon != null) {
      const cut = chained.findIndex((p) => p[0] > spec.truncateAtLon);
      if (cut < 0) throw new Error(`${spec.name}: 截断经度 ${spec.truncateAtLon} 未落在干流上`);
      chained = chained.slice(0, cut);
    }
    const runs = clipToBox(chained, BOX);
    // 取框内最长的一段作为干流主体，其余零碎段丢弃
    const head = runs.length
      ? dedupe(simplify(runs.sort((a, b) => b.length - a.length)[0], TOL))
      : [];
    points = head;
    reaches.push({
      kind: "natural-earth",
      from: spec.headLabel.from, to: spec.headLabel.to,
      pointCount: head.length,
      method: `ne_10m_rivers_lake_centerlines 串接 + Douglas-Peucker（容差 ${TOL}°）`,
      neParts: spec.ne.map((w) => w.join(" / ")),
    });

    if (spec.historicalTail) {
      const ctrl = spec.historicalTail;
      const tail = dedupe(catmullRom(ctrl.map((c) => [c[0], c[1]]), SPLINE_STEP));
      const tailRuns = clipToBox(tail, BOX);
      const tailPts = tailRuns.length ? tailRuns.sort((a, b) => b.length - a.length)[0] : [];
      points = dedupe(points.concat(tailPts));
      reaches.push({
        kind: "reconstructed",
        from: spec.tailLabel.from, to: spec.tailLabel.to,
        pointCount: tailPts.length,
        method: "手工控制点 + Catmull-Rom 插值（插值点仅为绘制平滑，无独立史料依据）",
        controlPoints: ctrl,
      });
    }
  }

  const pts = round(points);
  const last = pts[pts.length - 1];
  rivers.push({
    id: spec.id,
    name: spec.name,
    aliases: spec.aliases ?? [],
    historical: spec.historical,
    note: spec.note,
    source: spec.historicalOnly
      ? "历史复原（无现代对应要素）"
      : spec.historicalTail
        ? "Natural Earth ne_10m_rivers_lake_centerlines（上游）+ 历史复原（下游）"
        : "Natural Earth ne_10m_rivers_lake_centerlines",
    reaches,
    downstreamEnd: { longitude: last[0], latitude: last[1] },
    pointCount: pts.length,
    points: pts,
  });
}

// ── 输出 ─────────────────────────────────────────────────────────────────────
const data = {
  meta: {
    id: "hydrology",
    description: "汉末（公元 194 年）水系与海岸线数据层：海岸线、十一条主要河流、十一处渡口／津。",
    grid: GRID,
    bbox: BOX,
    simplification: {
      algorithm: "Douglas-Peucker",
      toleranceDegrees: TOL,
      minFragmentExtentDegrees: MIN_EXTENT,
      splineStepDegrees: SPLINE_STEP,
      coordinatePrecision: PRECISION,
      note: "垂距在经纬度空间内直接计算，未按 cos(lat) 校正经度各向异性；战略尺度绘制无影响。",
    },
    sources: [
      {
        name: "ne_10m_coastline",
        url: `${NE_BASE}/ne_10m_coastline.geojson`,
        license: "Public domain (Natural Earth)",
        bytes: coastSrc.bytes, sha256: coastSrc.sha256,
      },
      {
        name: "ne_10m_rivers_lake_centerlines",
        url: `${NE_BASE}/ne_10m_rivers_lake_centerlines.geojson`,
        license: "Public domain (Natural Earth)",
        bytes: riverSrc.bytes, sha256: riverSrc.sha256,
      },
      {
        name: "东汉黄河故道（王景故道）复原",
        basis:
          "《后汉书·王景传》永平十二年（69）「自荥阳东至千乘海口千余里」，十三年（70）夏成；" +
          "黄河水利委员会 yrcc.gov.cn《王景治河》：「修筑从濮阳城南到渤海千乘的千余里黄河大堤」；" +
          "维基百科《黄河改道》：「这条河道于今河南濮阳由西汉旧河道分出，经过今山东省聊城、禹城等县，" +
          "在山东利津县附近入海」；谭其骧《中国历史地图集》第二册东汉图组。",
        license: "本项目自行整理的复原点列",
      },
      {
        name: "济水、泗水、淮水下游复原",
        basis: "《水经注》济水、泗水、淮水诸篇；《汉书·地理志》临淮郡淮浦县；《后汉书·郡国志》郡治方位。",
        license: "本项目自行整理的复原点列",
      },
    ],
    license: "Natural Earth public domain + 历史河道复原",
    differencesFromNaturalEarth: [
      "黄河：荥阳（113.40°E）以下弃用现代河道，改用东汉故道复原线，纬度较今道偏北约 1°–1.5°；" +
      "今黄河济南—东营段实为 1855 年铜瓦厢改道所夺的古济水／大清河河道。",
      "济水：现代已不存在，Natural Earth 无对应要素，全线为复原。",
      "泗水：下游现代已不存在（南四湖、中运河取代），全线为复原。",
      "淮水：Natural Earth 数据止于今安徽淮南以西；汉代淮水独流入海，无洪泽湖、无入江水道，下游为复原。",
      "海岸线：输出的是现代岸线。汉代渤海西南岸在今岸线以西数十公里（今黄河三角洲系 1855 年后淤积）；" +
      "苏北海岸在今岸线以西约 20–50 km；长江口在今江阴—如皋一线，上海、崇明尚未成陆；" +
      "珠江三角洲大部尚为河口湾。渲染汉末地图时这几处应主动内缩。",
      "湖沼：本数据层不含湖泊面。汉末江汉平原有云梦泽，洞庭湖、鄱阳湖远小于今日，大野泽（巨野泽）尚存，" +
      "需另行处理，不可套用现代湖形。",
    ],
    uncertainty:
      "复原点列为战略尺度骨架线，误差量级 10–50 km，河口点位误差可达数十公里；不可用于考古定位。" +
      "reaches[].controlPoints 是带史料注记的控制点，reaches[].points 之外的插值点无独立依据。",
    generatedBy: "tools/build-hydrology.mjs",
  },
  coastline,
  rivers,
  fords: FORDS,
};

await fs.promises.mkdir(path.dirname(OUT), { recursive: true });
await fs.promises.writeFile(OUT, JSON.stringify(data, null, 2) + "\n");

// ── 自校验 ───────────────────────────────────────────────────────────────────
const span = (pts, i) => {
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i]; }
  return [lo, hi];
};
const f2 = (n) => n.toFixed(2);
const padCn = (s, w) => s + " ".repeat(Math.max(0, w - [...s].length * 2));

console.log("");
console.log(`海岸线：${coastline.length} 条线，${coastline.reduce((s, l) => s + l.length, 0)} 点`
  + `（框内裁剪后简化前 ${coastClipped} 点，压缩到 `
  + `${(100 * coastline.reduce((s, l) => s + l.length, 0) / coastClipped).toFixed(1)}%）`);
console.log("");
console.log("河流            点数    经度跨度            纬度跨度          复原");
console.log("-".repeat(72));
for (const r of rivers) {
  const [x0, x1] = span(r.points, 0);
  const [y0, y1] = span(r.points, 1);
  console.log(
    `${padCn(r.name, 14)}${String(r.pointCount).padStart(5)}   `
    + `${f2(x0)}-${f2(x1)}°E   ${f2(y0)}-${f2(y1)}°N   ${r.historical ? "是" : "否"}`);
}

console.log("");
let ok = true;
const fail = (m) => { ok = false; console.log(`  x ${m}`); };
const pass = (m) => console.log(`  v ${m}`);

// 1) 黄河入海口纬度：应在利津附近 37.5-38.2
const mouth = rivers.find((r) => r.id === "huanghe").downstreamEnd;
if (mouth.latitude >= 37.5 && mouth.latitude <= 38.2) {
  pass(`黄河入海口 ${f2(mouth.longitude)}°E, ${f2(mouth.latitude)}°N -- 落在利津附近 37.5-38.2°N`);
} else {
  fail(`黄河入海口纬度 ${f2(mouth.latitude)}°N 不在 37.5-38.2 之间，东汉故道复原有误`);
}

// 2) 东汉故道应明显北于今道：今黄河在 117°E 处约 36.7°N（济南），故道应 >= 37.0°N
const hh = rivers.find((r) => r.id === "huanghe").points;
const at117 = hh.filter((p) => Math.abs(p[0] - 117.0) < 0.15).map((p) => p[1]);
if (at117.length && Math.min(...at117) >= 37.0) {
  pass(`黄河 117°E 处纬度 ${f2(Math.min(...at117))}°N -- 明显北于今道（济南约 36.7°N），确为东汉故道`);
} else {
  fail(`黄河 117°E 处纬度 ${at117.length ? f2(Math.min(...at117)) : "无采样"}，与今道难以区分`);
}

// 3) 所有点必须落在网格范围内
let outside = 0;
for (const r of rivers) {
  for (const [x, y] of r.points) {
    if (x < BOX.west || x > BOX.east || y < BOX.south || y > BOX.north) outside++;
  }
}
for (const l of coastline) {
  for (const [x, y] of l) {
    if (x < BOX.west || x > BOX.east || y < BOX.south || y > BOX.north) outside++;
  }
}
if (outside === 0) pass("全部河流与海岸线点位落在 94-127°E / 16-43°N 网格范围内");
else fail(`${outside} 个点越出网格范围`);

// 4) 渡口落在网格内
const fordBad = FORDS.filter((f) =>
  f.longitude < BOX.west || f.longitude > BOX.east
  || f.latitude < BOX.south || f.latitude > BOX.north);
if (fordBad.length === 0) pass(`${FORDS.length} 处渡口全部落在网格范围内`);
else fail(`越界渡口：${fordBad.map((f) => f.name).join("、")}`);

// 5) 渡口必须贴在自己那条河上。这一条同时验证东汉故道复原：
//    白马津、延津、黎阳津在史料上都是黄河渡口，若复原正确，它们应紧贴本数据的黄河线，
//    而离现代黄河下游很远（现代河道在其南 40–60 km）。若两个距离接近，说明故道没改对。
const KM_PER_DEG = 111.2;
const modernLowerHuang = [];
for (const f of riverSrc.json.features) {
  const p = f.properties;
  if (p.name === "Huang" && p.featurecla === "River" && p.name_alt === "Yellow") {
    for (const part of partsOf(f)) modernLowerHuang.push(...part);
  }
}
const distToLine = (p, line) => {
  let m = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = perpDistance(p, line[i], line[i + 1]);
    if (d < m) m = d;
  }
  return m;
};

console.log("");
console.log("渡口             所属河      距本数据河道   距现代黄河下游");
console.log("-".repeat(72));
let fordOff = [];
let hanCourseProven = true;
for (const fd of FORDS) {
  const p = [fd.longitude, fd.latitude];
  const line = fd.riverId ? rivers.find((r) => r.id === fd.riverId).points : null;
  const own = line ? distToLine(p, line) * KM_PER_DEG : null;
  const mod = distToLine(p, modernLowerHuang) * KM_PER_DEG;
  console.log(`${padCn(fd.name, 16)}${padCn(fd.river, 12)}`
    + `${(own === null ? "—" : own.toFixed(1) + " km").padStart(11)}`
    + `${(mod.toFixed(0) + " km").padStart(14)}`);
  // 濡须口在濡须水上而非长江干流，官渡在鸿沟水系上，两者按例外处理
  if (own !== null && own > 12 && fd.id !== "ruxukou") fordOff.push(`${fd.name} ${own.toFixed(1)}km`);
  // 东汉故道判据：三处故道专属渡口应离本数据河道比离现代黄河近一个数量级
  if (["baimajin", "yanjin", "liyangjin"].includes(fd.id) && !(own < mod / 4)) {
    hanCourseProven = false;
  }
}
console.log("");
if (fordOff.length === 0) pass("各渡口均贴合其所属河道（濡须口在濡须水上、官渡在鸿沟水系上，已按例外处理）");
else fail(`偏离河道的渡口：${fordOff.join("、")}`);

if (hanCourseProven) {
  pass("白马津／延津／黎阳津紧贴本数据黄河而远离现代黄河 —— 东汉故道复原成立");
} else {
  fail("白马津／延津／黎阳津到本数据黄河与到现代黄河的距离相近 —— 黄河可能仍是现代河道");
}

// 6) 每条河都要有有效点列
const empty = rivers.filter((r) => r.pointCount < 2).map((r) => r.name);
if (empty.length === 0) pass(`${rivers.length} 条河流均有有效点列`);
else fail(`空河流：${empty.join("、")}`);

const bytes = fs.statSync(OUT).size;
console.log("");
console.log(`${ok ? "v" : "x"} 输出 ${path.relative(ROOT, OUT)}  ${(bytes / 1024).toFixed(0)} KB`);
if (!ok) process.exitCode = 1;
