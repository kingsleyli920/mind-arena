// 由通行代价场生成通行图，取代手画的边表。
//
// 旧办法：Delaunay 三角化取候选边 → 沿边采样定地形 → 关津按垂距挂载
//         → 一堆史实修正。那画的是「史书记载过的路」。
// 新办法：从 105 个治所同时做 Dijkstra，辖境相接即为邻；
//         每对邻居走一条真正的最省路径，路径本身回答其余全部问题：
//
//   cost      = 路径的代价总和，换算成「1 = 100km 平原」
//   km        = 路径的真实长度（不是两点直线）
//   nodes     = **路径真的经过**的关津，不是垂距够近的
//   crossings = 路径真的跨过的河
//   terrain   = 路上有关则关道；跨大江则渡河；否则按每公里代价分平原/丘陵/山地
//
// 「关津挂载」这件事因此不再需要任何阈值：走过就是走过。
import fs from "node:fs";

const cfMeta = JSON.parse(fs.readFileSync("public/game/costfield.json", "utf8"));
const { cols: COLS, rows: ROWS, step: STEP, west: W_DEG, north: N_DEG, block: BLOCK } = cfMeta;
const cost = new Uint8Array(fs.readFileSync("public/game/costfield.bin"));
const cs = JSON.parse(fs.readFileSync("lib/game/data/commanderies.json", "utf8"));
const nodes = JSON.parse(fs.readFileSync("lib/game/data/strategic-nodes.json", "utf8")).nodes;
const hyd = JSON.parse(fs.readFileSync("lib/game/data/hydrology.json", "utf8"));

const cell = (lon, lat) => [
  Math.max(0, Math.min(COLS - 1, Math.round((lon - W_DEG) / STEP - 0.5))),
  Math.max(0, Math.min(ROWS - 1, Math.round((N_DEG - lat) / STEP - 0.5)))];
// const lonOf = (c) => W_DEG + (c + 0.5) * STEP;
const latOf = (r) => N_DEG - (r + 0.5) * STEP;
const KM = (r) => ({ x: 111.32 * Math.cos((latOf(r) * Math.PI) / 180) * STEP, y: 110.57 * STEP });

// 治所落在墙里就近找一格能走的（城建在山口上是常事）
const seatCell = new Map();
for (const c of cs) {
  let [x, y] = cell(c.longitude, c.latitude);
  if (cost[y * COLS + x] === BLOCK) {
    let bd = 1e9, best = null;
    for (let dr = -8; dr <= 8; dr += 1) for (let dc = -8; dc <= 8; dc += 1) {
      const cc = x + dc, rr = y + dr;
      if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
      if (cost[rr * COLS + cc] === BLOCK) continue;
      const d = dr * dr + dc * dc;
      if (d < bd) { bd = d; best = [cc, rr]; }
    }
    if (best) { [x, y] = best; console.log(`  · ${c.id} 治所在墙内，就近落到 ${bd ** 0.5 | 0} 格外`); }
  }
  seatCell.set(c.id, [x, y]);
}

// ── 辖境 → 邻接 ─────────────────────────────────────────────────────
const dist = new Float64Array(COLS * ROWS).fill(Infinity);
const own = new Int16Array(COLS * ROWS).fill(-1);
{
  const BW = 1, NB = 400000;
  const bk = Array.from({ length: NB }, () => []);
  const push = (k, d) => bk[Math.min(NB - 1, Math.floor(d / BW))].push(k);
  cs.forEach((c, i) => { const [x, y] = seatCell.get(c.id); const k = y * COLS + x;
    dist[k] = 0; own[k] = i; push(k, 0); });
  for (let h = 0; h < NB; h += 1) {
    const b = bk[h];
    while (b.length) {
      const k = b.pop();
      const d = dist[k];
      if (Math.floor(d / BW) !== h) continue;
      const c = k % COLS, r = (k - c) / COLS, oi = own[k];
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
        const nk = rr * COLS + cc, w = cost[nk];
        if (w === BLOCK) continue;
        const nd = d + w * ((dc && dr) ? 1.414 : 1);
        if (nd < dist[nk]) { dist[nk] = nd; own[nk] = oi; push(nk, nd); }
      }
    }
  }
}
const touch = new Map();
const bump = (a, b) => { if (a < 0 || b < 0 || a === b) return;
  const k = a < b ? `${a}|${b}` : `${b}|${a}`; touch.set(k, (touch.get(k) ?? 0) + 1); };
for (let r = 0; r < ROWS; r += 1) for (let c = 0; c + 1 < COLS; c += 1) bump(own[r * COLS + c], own[r * COLS + c + 1]);
for (let r = 0; r + 1 < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) bump(own[r * COLS + c], own[(r + 1) * COLS + c]);
// 共同边界要有多长（格）才算邻接。**这是全套里最要紧的一个数**，
// 标定判据是 ρ（开局郡数 ↔ 得分），不是好不好看：
//
//    8 格　247 条边　ρ 0.60　袁术敌面 7→14，出局 13%→30%；刘表 12.1→14.4 郡
//   28 格　213 条边　ρ 0.43
//   35 格　203 条边　ρ **0.37**　与基线逐位相同，曹操出局 29%（基线 31%）
//   42 格　189 条边　ρ 0.37 但曹操出局掉到 12%——那个席位本该是险局
//
// 门槛低时江淮一带连成一片，小势力被围殴、大势力吃得更饱，
// ρ 就是这么上去的——而 ρ 一高，评测就分不出模型强弱。
// 35 格 ≈ 70km 的共同边界：碰一下不算邻接，得有一段真正能展开的正面。
// **相对判据**：共同边界要占到较小那一方全部边界的多少。
//
// 一开始用绝对格数，那是错的：它惩罚密集区。兖冀一带每个郡的辖境本来就小，
// 共同边界自然短——35 格的门槛把泰山郡–济北国（52km）、东平国–鲁国（63km）、
// 弘农郡–河东郡（77km）这种一眼就是真的邻接全砍了，却留下江淮一带
// 184–296km 的长边。ρ 因此凑巧回到 0.37，可那是砍掉了六大席位的正面换来的，
// 不是标定对了。
//
// 「一段真正能展开的正面」是相对于自己的边界说的：某一家占了我五分之一的
// 周长，那是个方向；占了百分之二，那是个角。
// 6% 是标定出来的，判据是 ρ（开局郡数 ↔ 得分，基线 0.37）：
//    6%　233 条边　ρ **0.37**　只丢 5 条 <120km 的边，泰山郡–济北国 保住
//   10%　212 条边　丢 10 条短边（泰山郡–济北国、东平国–泰山郡…）
//   14%　192 条边　丢 15 条
// 另有一版用绝对格数（35 格）也凑到 ρ 0.37，但那是靠砍掉兖冀密集区
// 六大席位的正面换来的——短边全丢、长边全留，是碰巧不是标定。
const MIN_SHARE = Number(process.env.MIN_SHARE ?? 0.06);
const MIN_TOUCH = Number(process.env.MIN_TOUCH ?? 8);   // 再加一个绝对下限，挡住碰角
// 每家辖境的总边界长度（格）：所有与别人相接的段之和
const perim = new Map();
for (const [k, n] of touch) {
  const [i, j] = k.split("|").map(Number);
  perim.set(i, (perim.get(i) ?? 0) + n);
  perim.set(j, (perim.get(j) ?? 0) + n);
}
const pairs = [...touch].filter(([k, n]) => {
  if (n < MIN_TOUCH) return false;
  const [i, j] = k.split("|").map(Number);
  const small = Math.min(perim.get(i) ?? 1, perim.get(j) ?? 1);
  return n / small >= MIN_SHARE;
}).map(([k]) => { const [i, j] = k.split("|").map(Number); return [cs[i], cs[j]]; });
console.log(`辖境相接 ${pairs.length} 对（占较小一方边界 ≥${(MIN_SHARE * 100).toFixed(0)}% 且 ≥${MIN_TOUCH} 格）`);

// ── 河的栅格：用来判路径跨了哪条河 ──────────────────────────────────
const riverAt = new Map();                        // 格 → 河名
for (const rv of hyd.rivers) {
  const pts = rv.points;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [x0, y0] = cell(pts[i][0], pts[i][1]), [x1, y1] = cell(pts[i + 1][0], pts[i + 1][1]);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let t = 0; t <= n; t += 1) {
      const c = Math.round(x0 + ((x1 - x0) * t) / n), r = Math.round(y0 + ((y1 - y0) * t) / n);
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
        const cc = c + dc, rr = r + dr;
        if (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS) riverAt.set(rr * COLS + cc, rv.name);
      }
    }
  }
}
// 节点的格：路径经过它附近即算「走过」
const NEAR = 3;
const nodeAt = new Map();
for (const nd of nodes) {
  const [c0, r0] = cell(nd.longitude, nd.latitude);
  for (let dr = -NEAR; dr <= NEAR; dr += 1) for (let dc = -NEAR; dc <= NEAR; dc += 1) {
    const c = c0 + dc, r = r0 + dr;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
    const k = r * COLS + c;
    if (!nodeAt.has(k)) nodeAt.set(k, []);
    nodeAt.get(k).push(nd);
  }
}

// ── A* ──────────────────────────────────────────────────────────────
function route(A, B) {
  const [c0, r0] = seatCell.get(A.id), [c1, r1] = seatCell.get(B.id);
  const pad = Math.max(40, Math.round(Math.hypot(c1 - c0, r1 - r0) * 1.1));
  const lo = { c: Math.max(0, Math.min(c0, c1) - pad), r: Math.max(0, Math.min(r0, r1) - pad) };
  const hi = { c: Math.min(COLS - 1, Math.max(c0, c1) + pad), r: Math.min(ROWS - 1, Math.max(r0, r1) + pad) };
  const w = hi.c - lo.c + 1, h = hi.r - lo.r + 1;
  const ix = (c, r) => (r - lo.r) * w + (c - lo.c);
  const g = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const done = new Uint8Array(w * h);
  const heap = [];
  const hp = (k, f) => { heap.push([f, k]); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const hq = () => { const t = heap[0], l = heap.pop();
    if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = i * 2 + 1, b = a + 1; let m = i;
      if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
      if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
      if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
  const s = ix(c0, r0), t = ix(c1, r1);
  g[s] = 0; hp(s, 0);
  while (heap.length) {
    const [, k] = hq();
    if (done[k]) continue; done[k] = 1;
    if (k === t) break;
    const cc = lo.c + (k % w), rr = lo.r + Math.floor(k / w);
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      if (!dr && !dc) continue;
      const nc = cc + dc, nr = rr + dr;
      if (nc < lo.c || nc > hi.c || nr < lo.r || nr > hi.r) continue;
      const gk = nr * COLS + nc;
      if (cost[gk] === BLOCK) continue;
      const nk = ix(nc, nr);
      if (done[nk]) continue;
      const nd = g[k] + cost[gk] * ((dc && dr) ? 1.414 : 1);
      if (nd < g[nk]) { g[nk] = nd; prev[nk] = k; hp(nk, nd + Math.hypot(nc - c1, nr - r1) * 3); }
    }
  }
  if (!isFinite(g[t])) return null;
  const cells = [];
  let k = t;
  while (k !== -1) { cells.push([lo.c + (k % w), lo.r + Math.floor(k / w)]); k = prev[k]; }
  cells.reverse();
  return { cost: g[t], cells };
}

let t0 = Date.now();
const routed = pairs.map(([a, b]) => ({ a, b, r: route(a, b) })).filter((x) => x.r);
console.log(`逐对求最省路径 ${((Date.now() - t0) / 1000).toFixed(1)}s　通 ${routed.length}/${pairs.length}`);

// ── 标定：一格平地的代价 → 「1 = 100km 平原」 ───────────────────────
// 取路径上「代价最低的那一成格子」的中位数当平地基准，
// 再乘上 100km 需要多少格。这样 cost 的单位与旧表一致，
// 行军换算（日 = cost × 8）与摘要里写的「1 = 100km 平原」都不必改
const allCell = [];
for (const { r } of routed) for (const [c, rr] of r.cells) allCell.push(cost[rr * COLS + c]);
allCell.sort((x, y) => x - y);
const plainCell = allCell[Math.floor(allCell.length * 0.10)];
const kmPerStep = (KM(ROWS / 2).x + KM(ROWS / 2).y) / 2;
const UNIT = plainCell * (100 / kmPerStep);
console.log(`标定：一格平地代价 ${plainCell}，一格 ${kmPerStep.toFixed(2)}km → 「1 单位」= ${UNIT.toFixed(0)} 格代价`);

const MAJOR = new Set(["长江", "黄河"]);
const edges = routed.map(({ a, b, r }) => {
  let km = 0;
  const onNodes = new Map(), rivers = new Set();
  for (let i = 0; i < r.cells.length; i += 1) {
    const [c, rr] = r.cells[i];
    const k = rr * COLS + c;
    if (i) {
      const [pc, pr] = r.cells[i - 1];
      const s = KM(rr);
      km += Math.hypot((c - pc) * s.x, (rr - pr) * s.y);
    }
    for (const nd of nodeAt.get(k) ?? []) onNodes.set(nd.id, nd);
    const rv = riverAt.get(k);
    if (rv) rivers.add(rv);
  }
  const list = [...onNodes.values()];
  const gate = list.find((n) => n.kind === "gate" || n.kind === "pass");
  const bigRiver = [...rivers].some((n) => MAJOR.has(n));
  const perKm = r.cost / Math.max(1, km);
  const plainPerKm = plainCell / kmPerStep;
  const rough = perKm / plainPerKm;                 // 1 = 一路平地
  const terrain = gate ? "gate" : bigRiver ? "river"
    : rough > 2.6 ? "mountain" : rough > 1.5 ? "hill" : "plain";
  // cost 仍按引擎的老口径算：`km/100 × 地形系数`。
  //
  // 不直接用路径代价除以一个标定值——代价场里平地与险地差着八十倍，
  // 而引擎的地形系数只差 2.6 倍（平原 1.0 到关道 2.6）。直接换算出来
  // 行军日中位 53 天、最长 1599 天，整个围城的时钟就没了。
  //
  // 代价场负责回答的是**路有多长、经过哪里、有多难走**这三件事；
  // 「难走折算成几天」是游戏的设计，仍归地形系数管。
  const TC = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
  return {
    from: a.id, to: b.id,
    km: Math.round(km),
    terrain,
    cost: +((km / 100) * TC[terrain]).toFixed(2),
    crossings: [...rivers],
    // host = 这个据点算在哪个郡的境内。**据点有主**，开局归它所在之郡的主人；
    // 取哪一端不能靠遍历先后，按到两端治所的距离判
    nodes: list.map((n) => {
      const s3 = KM(ROWS / 2);
      const dA = Math.hypot((n.longitude - a.longitude) * s3.x / STEP, (n.latitude - a.latitude) * s3.y / STEP);
      const dB = Math.hypot((n.longitude - b.longitude) * s3.x / STEP, (n.latitude - b.latitude) * s3.y / STEP);
      return { id: n.id, name: n.name, kind: n.kind, host: dA <= dB ? a.id : b.id };
    }),
    rough: +rough.toFixed(2),
  };
});

// ── 太长的不算邻接 ──────────────────────────────────────────────────
//
// 辖境相接只说明两家的势力范围碰上了，不说明军队打得着。戈壁、青藏、
// 南岭以南那些稀疏地带，两个治所的辖境能隔着两千公里相接——实测最长
// 一条 2514km，走完要四百多天，一局才十六季。旧表也有同样的上限（420km）。
// 900km：辖境相接只说明势力范围碰上了，不说明军队打得着。
// 但也不能剪太狠——520 时把辽西–辽东（604km，公孙度的命脉）与
// 京兆尹–南阳（722km，武关道）都剪掉了，公孙度的补给当场断掉，
// 那些郡「孤悬粮尽，举郡归附」，一令未下也换主
const MAX_KM = Number(process.env.MAX_KM ?? 900);
const tooLong = edges.filter((e) => e.km > MAX_KM);
const kept = edges.filter((e) => e.km <= MAX_KM);
console.log(`\n剪掉过长的 ${tooLong.length} 条（>${MAX_KM}km）：`
  + tooLong.slice(0, 6).map((e) => `${e.from}–${e.to} ${e.km}km`).join("　")
  + (tooLong.length > 6 ? " …" : ""));
// 剪完必须全图连通：孤岛意味着那一片永远打不到也守不住。
// 只补孤立的**单点**是不够的——实测剪出的是成片的区域（辽东四郡、
// 乐浪玄菟），全图连通度掉到 101/105。用并查集逐条补回最短的跨片边。
{
  const idx = new Map(cs.map((c, i) => [c.id, i]));
  const par = cs.map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra === rb) return false; par[ra] = rb; return true; };
  for (const e of kept) uni(idx.get(e.from), idx.get(e.to));
  const comps = () => new Set(cs.map((_, i) => find(i))).size;
  const before = comps();
  const spare = [...tooLong].sort((a, b) => a.km - b.km);
  const added = [];
  for (const e of spare) {
    if (comps() === 1) break;
    if (uni(idx.get(e.from), idx.get(e.to))) { kept.push(e); added.push(e); }
  }
  console.log(`  连通性：剪后 ${before} 片 → 补回 ${added.length} 条最短的跨片边 → ${comps()} 片`);
  for (const e of added) console.log(`      + ${e.from}–${e.to} ${e.km}km（${e.terrain}）`);
}
edges.length = 0;
edges.push(...kept);

// ── 水路：江海本身就是路 ────────────────────────────────────────────
//
// 只有陆路场时，公孙度隔着渤海据东莱就成了「孤悬粮尽」，一令未下白送
// 给孔融——而历史上他正是渡海去的。长江上的港口同理：它们理应彼此可达，
// 不是「史书写过哪两个港之间有船」才算通。
//
// 办法与陆路同：在水路场上从各郡治**最近的一处水口**同时做 Dijkstra，
// 水域辖境相接即为水路邻接。这条边的地形记 river（引擎已有的一档），
// 并标 water:true——将来水军上场时它就是水军的路。
{
  const wcost = new Uint8Array(fs.readFileSync("public/game/costfield-water.bin"));
  // 每郡的水口：治所附近能下水的最近一格
  const wSeat = new Map();
  for (const c of cs) {
    const [x0, y0] = seatCell.get(c.id);
    let best = null, bd = 1e9;
    for (let dr = -40; dr <= 40; dr += 1) for (let dc = -40; dc <= 40; dc += 1) {
      const x = x0 + dc, y = y0 + dr;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
      const w = wcost[y * COLS + x];
      if (w === BLOCK || w > 30) continue;                  // 得是真能行船的
      const d = dr * dr + dc * dc;
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best && bd <= 40 * 40) wSeat.set(c.id, best);
  }
  console.log(`\n水路：${wSeat.size}/${cs.length} 个郡够得着水`);

  const wd = new Float64Array(COLS * ROWS).fill(Infinity);
  const wo = new Int16Array(COLS * ROWS).fill(-1);
  const NB = 400000, bk = Array.from({ length: NB }, () => []);
  const push = (k, d) => bk[Math.min(NB - 1, Math.floor(d))].push(k);
  cs.forEach((c, i) => {
    const p = wSeat.get(c.id);
    if (!p) return;
    const k = p[1] * COLS + p[0];
    wd[k] = 0; wo[k] = i; push(k, 0);
  });
  for (let h = 0; h < NB; h += 1) {
    const b = bk[h];
    while (b.length) {
      const k = b.pop();
      const d = wd[k];
      if (Math.floor(d) !== h) continue;
      const c = k % COLS, r = (k - c) / COLS, oi = wo[k];
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
        const nk = rr * COLS + cc, w = wcost[nk];
        if (w === BLOCK) continue;
        const nd = d + w * ((dc && dr) ? 1.414 : 1);
        if (nd < wd[nk]) { wd[nk] = nd; wo[nk] = oi; push(nk, nd); }
      }
    }
  }
  const wt = new Map();
  const wb = (a, b) => { if (a < 0 || b < 0 || a === b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`; wt.set(k, (wt.get(k) ?? 0) + 1); };
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c + 1 < COLS; c += 1) wb(wo[r * COLS + c], wo[r * COLS + c + 1]);
  for (let r = 0; r + 1 < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) wb(wo[r * COLS + c], wo[(r + 1) * COLS + c]);
  const have = new Set(edges.map((e) => [e.from, e.to].sort().join("|")));
  let added = 0;
  const notes = [];
  for (const [k, n] of wt) {
    if (n < 40) continue;                                   // 水域相接得有一段像样的共同水面
    const [i, j] = k.split("|").map(Number);
    const key = [cs[i].id, cs[j].id].sort().join("|");
    if (have.has(key)) continue;                            // 陆路已通就不另开水路
    // 走一条真正的水路量长度
    const A = wSeat.get(cs[i].id), B = wSeat.get(cs[j].id);
    if (!A || !B) continue;
    const s2 = KM(ROWS / 2);
    const km2 = Math.hypot((A[0] - B[0]) * s2.x, (A[1] - B[1]) * s2.y) * 1.25;   // 水路绕岸，约多两成半
    if (km2 > MAX_KM) continue;
    edges.push({
      from: cs[i].id, to: cs[j].id, km: Math.round(km2), terrain: "river",
      cost: +((km2 / 100) * 1.8).toFixed(2), crossings: [], nodes: [], water: true,
    });
    have.add(key); added += 1;
    if (notes.length < 8) notes.push(`${cs[i].id}–${cs[j].id} ${Math.round(km2)}km`);
  }
  console.log(`水路补边 ${added} 条：${notes.join("　")}${added > 8 ? " …" : ""}`);
}

const hist = {};
for (const e of edges) hist[e.terrain] = (hist[e.terrain] ?? 0) + 1;
const costs = edges.map((e) => e.cost).sort((x, y) => x - y);
console.log(`\n地形分布 ${JSON.stringify(hist)}`);
console.log(`cost：中位 ${costs[costs.length >> 1]}　最大 ${costs[costs.length - 1]}`
  + `　→ 行军日 中位 ${Math.round(costs[costs.length >> 1] * 8)}　最长 ${Math.round(costs[costs.length - 1] * 8)}`);
const attached = new Set(edges.flatMap((e) => e.nodes.map((n) => n.id)));
console.log(`关津：${attached.size}/${nodes.length} 真的落在某条最省路径上`);
const miss = nodes.filter((n) => !attached.has(n.id)).map((n) => `${n.name}(${n.kind})`);
console.log(`  没落在任何路径上的 ${miss.length}：${miss.join("、")}`);

fs.writeFileSync("lib/game/data/adjacency.json", `${JSON.stringify({
  meta: {
    note: "郡国通行图。**由通行代价场求出**，不是画出来的：辖境相接即为邻，"
      + "每对邻居走一条真正的最省路径；cost/km/terrain/nodes/crossings 全部读自那条路径。",
    generatedFrom: "tools/adjacency-from-costfield.mjs",
    costfield: "public/game/costfield.bin（tools/build-costfield.mjs）",
    commanderies: cs.length,
    edges: edges.length,
    costUnit: "1 = 100km 平原",
    terrainCost: { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 },
    minTouchCells: MIN_TOUCH,
  },
  edges,
}, null, 1)}\n`);
// 势力内部的补给连通：断了就会「孤悬粮尽，举郡归附」——一令未下也换主。
// 旧图有 6 家内部不连通（那是常态，补给可借道），新图不该比它更差
{
  const own = Object.fromEntries(Object.entries(
    JSON.parse(fs.readFileSync("lib/game/data/scenario-194.json", "utf8")).ownership)
    .map(([k, v]) => [k, v.factionId]));
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from).push(e.to); adj.get(e.to).push(e.from);
  }
  const inv = new Map();
  for (const [k, v] of Object.entries(own)) { if (!inv.has(v)) inv.set(v, []); inv.get(v).push(k); }
  let split = 0;
  for (const [, list] of inv) {
    if (list.length < 2) continue;
    const S = new Set(list), seen = new Set([list[0]]), q = [list[0]];
    while (q.length) for (const y of adj.get(q.pop()) ?? []) if (S.has(y) && !seen.has(y)) { seen.add(y); q.push(y); }
    if (seen.size < list.length) split += 1;
  }
  console.log(`势力内部补给不连通的：${split} 家（手画图是 6 家）`);
}
console.log(`\n→ lib/game/data/adjacency.json  ${edges.length} 条边`);
