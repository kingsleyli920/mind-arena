// 代价场的验收报告：邻接长成什么样、每个据点值多少。
//
// 两问：
//   一、辖境相接长出来的邻接，与手画的边表差多少
//   二、把某个据点堵死，路要绕多远——那就是它的**扼守价值**。
//       一个关之所以是关，不是因为史书写过它，是因为绕不过去。
import fs from "node:fs";

const cfMeta = JSON.parse(fs.readFileSync("public/game/costfield.json", "utf8"));
const { cols: COLS, rows: ROWS, step: STEP, west: W_DEG, north: N_DEG, block: BLOCK } = cfMeta;
const cost = new Uint8Array(fs.readFileSync("public/game/costfield.bin"));
const cs = JSON.parse(fs.readFileSync("lib/game/data/commanderies.json", "utf8"));
const nodes = JSON.parse(fs.readFileSync("lib/game/data/strategic-nodes.json", "utf8")).nodes;
const cell = (lon, lat) => [
  Math.max(0, Math.min(COLS - 1, Math.round((lon - W_DEG) / STEP - 0.5))),
  Math.max(0, Math.min(ROWS - 1, Math.round((N_DEG - lat) / STEP - 0.5)))];

// 治所若落在墙里（城建在山口上是常事），就近找一格能走的
const seatCell = new Map();
for (const c of cs) {
  let [x, y] = cell(c.longitude, c.latitude);
  if (cost[y * COLS + x] === BLOCK) {
    let best = null, bd = 1e9;
    for (let dr = -6; dr <= 6; dr += 1) for (let dc = -6; dc <= 6; dc += 1) {
      const cc = x + dc, rr = y + dr;
      if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
      if (cost[rr * COLS + cc] === BLOCK) continue;
      const d = dr * dr + dc * dc;
      if (d < bd) { bd = d; best = [cc, rr]; }
    }
    if (best) [x, y] = best;
  }
  seatCell.set(c.id, [x, y]);
}
const stuck = cs.filter((c) => cost[seatCell.get(c.id)[1] * COLS + seatCell.get(c.id)[0]] === BLOCK);
if (stuck.length) console.log(`⚠ 治所困在墙里的：${stuck.map((c) => c.id).join("、")}`);

// ── 多源 Dijkstra → 辖境 → 邻接 ─────────────────────────────────────
const dist = new Float64Array(COLS * ROWS).fill(Infinity);
const own = new Int16Array(COLS * ROWS).fill(-1);
const BW = 1, NB = 400000;
const bk = Array.from({ length: NB }, () => []);
const push = (k, d) => bk[Math.min(NB - 1, Math.floor(d / BW))].push(k);
cs.forEach((c, i) => {
  const [x, y] = seatCell.get(c.id);
  const k = y * COLS + x;
  dist[k] = 0; own[k] = i; push(k, 0);
});
let t0 = Date.now();
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
      const nk = rr * COLS + cc;
      const w = cost[nk];
      if (w === BLOCK) continue;
      const nd = d + w * ((dc && dr) ? 1.414 : 1);
      if (nd < dist[nk]) { dist[nk] = nd; own[nk] = oi; push(nk, nd); }
    }
  }
}
const reach = own.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
console.log(`多源 Dijkstra ${((Date.now() - t0) / 1000).toFixed(1)}s　辖境覆盖 ${(reach / 1e6).toFixed(2)}M 格`);

const touch = new Map();
const bump = (a, b) => {
  if (a < 0 || b < 0 || a === b) return;
  const k = a < b ? `${a}|${b}` : `${b}|${a}`;
  touch.set(k, (touch.get(k) ?? 0) + 1);
};
for (let r = 0; r < ROWS; r += 1) for (let c = 0; c + 1 < COLS; c += 1) bump(own[r * COLS + c], own[r * COLS + c + 1]);
for (let r = 0; r + 1 < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) bump(own[r * COLS + c], own[(r + 1) * COLS + c]);
const MIN_TOUCH = 12;
const pairs = [...touch].filter(([, n]) => n >= MIN_TOUCH)
  .map(([k, n]) => { const [i, j] = k.split("|").map(Number); return { a: cs[i].id, b: cs[j].id, touch: n }; });
const deg = new Map();
for (const p of pairs) { deg.set(p.a, (deg.get(p.a) ?? 0) + 1); deg.set(p.b, (deg.get(p.b) ?? 0) + 1); }
const ds = [...deg.values()].sort((a, b) => a - b);
console.log(`\n邻接 ${pairs.length} 对　每郡邻居 中位 ${ds[ds.length >> 1]}／最多 ${ds[ds.length - 1]}／无邻居 ${cs.length - deg.size} 个`);
const oldE = JSON.parse(fs.readFileSync("lib/game/data/adjacency.json", "utf8")).edges;
const oldS = new Set(oldE.map((e) => [e.from, e.to].sort().join("|")));
const newS = new Set(pairs.map((p) => [p.a, p.b].sort().join("|")));
const both = [...newS].filter((k) => oldS.has(k)).length;
console.log(`对比手画边表（${oldS.size}）：重合 ${both}　新有旧无 ${newS.size - both}　旧有新无 ${oldS.size - both}`);

// ── A*（可堵格）────────────────────────────────────────────────────
function route(A, B, blocked) {
  const [c0, r0] = seatCell.get(A), [c1, r1] = seatCell.get(B);
  const pad = Math.max(40, Math.round(Math.hypot(c1 - c0, r1 - r0) * 1.1));
  const lo = { c: Math.max(0, Math.min(c0, c1) - pad), r: Math.max(0, Math.min(r0, r1) - pad) };
  const hi2 = { c: Math.min(COLS - 1, Math.max(c0, c1) + pad), r: Math.min(ROWS - 1, Math.max(r0, r1) + pad) };
  const w = hi2.c - lo.c + 1, h = hi2.r - lo.r + 1;
  const ix = (c, r) => (r - lo.r) * w + (c - lo.c);
  const g = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const done = new Uint8Array(w * h);
  const heap = [];
  const hpush = (k, f) => { heap.push([f, k]); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const hpop = () => { const t = heap[0], l = heap.pop();
    if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = i * 2 + 1, b = a + 1; let m = i;
      if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
      if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
      if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
  const s = ix(c0, r0), t = ix(c1, r1);
  g[s] = 0; hpush(s, 0);
  while (heap.length) {
    const [, k] = hpop();
    if (done[k]) continue; done[k] = 1;
    if (k === t) break;
    const cc = lo.c + (k % w), rr = lo.r + Math.floor(k / w);
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      if (!dr && !dc) continue;
      const nc = cc + dc, nr = rr + dr;
      if (nc < lo.c || nc > hi2.c || nr < lo.r || nr > hi2.r) continue;
      const gk = nr * COLS + nc;
      if (cost[gk] === BLOCK) continue;
      if (blocked && blocked.has(gk)) continue;
      const nk = ix(nc, nr);
      if (done[nk]) continue;
      const nd = g[k] + cost[gk] * ((dc && dr) ? 1.414 : 1);
      if (nd < g[nk]) { g[nk] = nd; prev[nk] = k; hpush(nk, nd + Math.hypot(nc - c1, nr - r1) * 4); }
    }
  }
  if (!isFinite(g[t])) return { cost: Infinity, path: [] };
  const path = []; let k = t;
  while (k !== -1) { path.push(lo.r + Math.floor(k / w), lo.c + (k % w)); k = prev[k]; }
  return { cost: g[t], path };
}

t0 = Date.now();
const routes = pairs.map((p) => ({ p, r: route(p.a, p.b) })).filter((x) => isFinite(x.r.cost));
console.log(`逐对求最省路径 ${((Date.now() - t0) / 1000).toFixed(1)}s　通 ${routes.length}/${pairs.length}\n`);

const R = 3;
const out = [];
for (const nd of nodes) {
  const [nc, nr] = cell(nd.longitude, nd.latitude);
  const on = routes.filter(({ r }) => {
    for (let i = 0; i < r.path.length; i += 2) if (Math.abs(r.path[i] - nr) <= R && Math.abs(r.path[i + 1] - nc) <= R) return true;
    return false;
  });
  if (!on.length) { out.push({ nd, on: 0, worst: 0, pair: null }); continue; }
  const blocked = new Set();
  for (let dr = -R; dr <= R; dr += 1) for (let dc = -R; dc <= R; dc += 1) {
    const c = nc + dc, r = nr + dr;
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) blocked.add(r * COLS + c);
  }
  let worst = 0, pair = null;
  for (const { p, r } of on) {
    const alt = route(p.a, p.b, blocked);
    const inc = (alt.cost - r.cost) / r.cost;
    if (inc > worst) { worst = inc; pair = `${p.a}–${p.b}`; }
  }
  out.push({ nd, on: on.length, worst, pair });
}
out.sort((a, b) => b.worst - a.worst);
const CN = { gate: "关隘", pass: "谷道", port: "港", ford: "渡口", depot: "仓", battlefield: "古战场" };
console.log("据点的扼守价值 = 堵死它之后绕路要多花的代价\n");
console.log("  绕路涨幅  在几条路上  类     名");
for (const o of out) {
  const v = o.on === 0 ? " 不在路上" : (o.worst === Infinity ? "     断" : `${(o.worst * 100).toFixed(0)}%`.padStart(8));
  console.log(`  ${v} ${String(o.on).padStart(7)}     ${CN[o.nd.kind]}  ${o.nd.name}${o.pair ? `　（${o.pair}）` : ""}`);
}
const live = out.filter((o) => o.worst > 0.05).length;
console.log(`\n扼守价值 >5% 的：${live}/${nodes.length}`);
if (process.env.BRIEF) {
  const g = (n) => { const o = out.find((x) => x.nd.name === n);
    return o ? (o.on === 0 ? "无路" : o.worst === Infinity ? "断" : `${(o.worst * 100).toFixed(0)}%`) : "?"; };
  console.log(`BRIEF pairs=${pairs.length} iso=${cs.length - deg.size} both=${both} `
    + `潼关=${g("潼关")} 剑门关=${g("剑门关")} 虎牢关=${g("虎牢关")} 武关=${g("武关")} `
    + `白马津=${g("白马津")} 阳平关=${g("阳平关")} 井陉关=${g("井陉关")} live=${live}`);
}
fs.writeFileSync("public/game/adjacency-derived.json", JSON.stringify({
  _note: "由通行代价场长出来的邻接：辖境相接即为邻。取代手画的边表。",
  minTouch: MIN_TOUCH, pairs,
}, null, 1));
