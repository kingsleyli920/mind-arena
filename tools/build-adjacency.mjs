// 构建郡国通行图：105 个郡治之间的边，含地形、跨河、关隘挂载。
//
// 这是引擎的硬前置。没有边就没有行军、没有补给连通判定，
// 61 个关隘港口渡口也全是地图上的装饰。
//
// 做法：
//   1. Delaunay 三角化取候选边（避免"每个点连最近 k 个"造成的长边穿山）
//   2. 沿边采样地形网格，定该边的地形档与通行代价
//   3. 与水系求交，判跨河；跨河无渡口则不可通行
//   4. 把关隘/渡口/港口挂到它所扼守的边上
//   5. 剪除穿海、穿高原、过长的伪邻接
import fs from "node:fs";

const D = "lib/game/data";
const read = (f) => JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8"));
const arr = (o) => (Array.isArray(o) ? o : (o.officers ?? o.nodes ?? o.rivers ?? o));

const commanderies = arr(read("commanderies.json"));
const nodes = read("strategic-nodes.json").nodes ?? [];
const hydro = read("hydrology.json");
const grid = read("terrain-grid.json");
const { west, east, south, north, cellSize, cols, rows } = grid.meta;
const ELEV = grid.elevation, RELIEF = grid.relief;

console.log(`郡国 ${commanderies.length}  关津 ${nodes.length}  水系 ${(hydro.rivers ?? []).length} 条`);

// ── 投影：等距圆柱按纬度做东西向修正，使距离近似真实公里数 ──────────
const MID_LAT = (north + south) / 2;
const KX = 111.32 * Math.cos((MID_LAT * Math.PI) / 180);   // 每经度公里
const KY = 110.57;                                          // 每纬度公里
const px = (lon) => lon * KX;
const py = (lat) => -lat * KY;
const dist = (a, b) => Math.hypot(px(a.longitude) - px(b.longitude), py(a.latitude) - py(b.latitude));

// ── Delaunay（Bowyer–Watson）────────────────────────────────────────
function delaunay(points) {
  const n = points.length;
  const xs = points.map((p) => px(p.longitude));
  const ys = points.map((p) => py(p.latitude));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = maxX - minX, dy = maxY - minY, dmax = Math.max(dx, dy) * 10;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // 三个超级三角形顶点，索引取负值以便最后剔除
  const SX = [cx - dmax, cx, cx + dmax];
  const SY = [cy - dmax, cy + dmax * 2, cy - dmax];
  const X = (i) => (i < 0 ? SX[-i - 1] : xs[i]);
  const Y = (i) => (i < 0 ? SY[-i - 1] : ys[i]);

  const circum = (a, b, c) => {
    const ax = X(a), ay = Y(a), bx = X(b), by = Y(b), cx2 = X(c), cy2 = Y(c);
    const d = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy2) + (bx * bx + by * by) * (cy2 - ay) + (cx2 * cx2 + cy2 * cy2) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx2 - bx) + (bx * bx + by * by) * (ax - cx2) + (cx2 * cx2 + cy2 * cy2) * (bx - ax)) / d;
    return { x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };

  let tris = [{ v: [-1, -2, -3], c: circum(-1, -2, -3) }];
  for (let i = 0; i < n; i += 1) {
    const bad = [], good = [];
    for (const t of tris) {
      if (t.c && (xs[i] - t.c.x) ** 2 + (ys[i] - t.c.y) ** 2 < t.c.r2) bad.push(t); else good.push(t);
    }
    // 坏三角形的边界多边形 = 只出现一次的边
    const count = new Map();
    for (const t of bad) {
      for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]]) {
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    tris = good;
    for (const [k, c] of count) {
      if (c !== 1) continue;
      const [a, b] = k.split(",").map(Number);
      tris.push({ v: [a, b, i], c: circum(a, b, i) });
    }
  }

  const edges = new Set();
  for (const t of tris) {
    if (t.v.some((v) => v < 0)) continue;                  // 剔除含超级顶点的
    const [a, b, c] = t.v;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) edges.add(u < v ? `${u},${v}` : `${v},${u}`);
  }
  return [...edges].map((k) => k.split(",").map(Number));
}

// ── 沿边采样地形 ────────────────────────────────────────────────────
const cellAt = (lon, lat) => {
  const c = Math.floor((lon - west) / cellSize);
  const r = Math.floor((north - lat) / cellSize);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
  return r * cols + c;
};
/** 分类与渲染器保持一致：0.1 度格约 11km，宽阈值会把丘陵全判成山 */
const classify = (e, rl) =>
  e <= 0 ? "sea" : e > 3000 ? "highland" : (e > 1400 || rl > 900) ? "mountain"
  : (e > 350 || rl > 320) ? "hill" : "plain";

function sampleEdge(a, b) {
  const steps = Math.max(8, Math.ceil(dist(a, b) / 8));    // 约每 8km 采一个点
  const tally = { plain: 0, hill: 0, mountain: 0, highland: 0, sea: 0 };
  let maxElev = -9999, sumRelief = 0, n = 0;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const lon = a.longitude + (b.longitude - a.longitude) * t;
    const lat = a.latitude + (b.latitude - a.latitude) * t;
    const idx = cellAt(lon, lat);
    if (idx == null) continue;
    const e = ELEV[idx], rl = RELIEF[idx];
    tally[classify(e, rl)] += 1;
    if (e > maxElev) maxElev = e;
    sumRelief += rl; n += 1;
  }
  return { tally, maxElev, avgRelief: n ? sumRelief / n : 0, samples: n };
}

// ── 与水系求交 ──────────────────────────────────────────────────────
const MAIN_RIVERS = new Set(["黄河", "长江", "淮水", "汉水", "渭水"]);
function seg(p1, p2, p3, p4) {                              // 线段相交
  const d = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(d) < 1e-12) return false;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / d;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / d;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}
function segPoint(p1, p2, p3, p4) {                          // 返回交点，无交返回 null
  const d = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(d) < 1e-12) return null;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / d;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y) };
}
/**
 * 求边与主干河的交点。
 * 关键：交点若落在端点 35km 以内，说明河是从城边流过（如汉水绕南郑、
 * 长江绕江陵），不构成阻隔。只有横亘在路途中段的才算真正要渡河。
 */
const ENDPOINT_KM = 35;
function crossings(a, b) {
  const p1 = { x: a.longitude, y: a.latitude }, p2 = { x: b.longitude, y: b.latitude };
  const hit = [];
  for (const r of hydro.rivers ?? []) {
    if (!MAIN_RIVERS.has(r.name)) continue;
    const pts = r.points ?? [];
    for (let i = 1; i < pts.length; i += 1) {
      const X = segPoint(p1, p2, { x: pts[i-1][0], y: pts[i-1][1] }, { x: pts[i][0], y: pts[i][1] });
      if (!X) continue;
      const dA = Math.hypot((X.x - a.longitude) * KX, (X.y - a.latitude) * KY);
      const dB = Math.hypot((X.x - b.longitude) * KX, (X.y - b.latitude) * KY);
      if (dA < ENDPOINT_KM || dB < ENDPOINT_KM) continue;   // 河从城边过，不算阻隔
      hit.push({ river: r.name, at: [+X.x.toFixed(3), +X.y.toFixed(3)] });
      break;
    }
  }
  return hit;
}

// ── 关津挂载：节点到边的垂距足够小即视为扼守该边 ────────────────────
function nodesOnEdge(a, b) {
  const ax = px(a.longitude), ay = py(a.latitude);
  const bx = px(b.longitude), by = py(b.latitude);
  const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const out = [];
  for (const nd of nodes) {
    const nx = px(nd.longitude), ny = py(nd.latitude);
    const t = L2 ? Math.max(0, Math.min(1, ((nx - ax) * (bx - ax) + (ny - ay) * (by - ay)) / L2)) : 0;
    // 渡口港口本就设在城侧，允许贴近端点；关隘则要求在路途中段
    const isCrossing = nd.kind === "ford" || nd.kind === "port";
    if (!isCrossing && (t <= 0.08 || t >= 0.92)) continue;
    if (isCrossing && (t <= 0.02 || t >= 0.98)) continue;
    const d = Math.hypot(nx - (ax + (bx - ax) * t), ny - (ay + (by - ay) * t));
    if (d < 45) out.push({ id: nd.id, name: nd.name, kind: nd.kind, offset: +d.toFixed(1) });
  }
  return out.sort((x, y) => x.offset - y.offset);
}

// ── 主流程 ──────────────────────────────────────────────────────────
const raw = delaunay(commanderies);
console.log(`Delaunay 候选边 ${raw.length} 条`);

const edges = [];
const pruned = { tooLong: 0, sea: 0, highland: 0, river: 0 };
const MAX_KM = 420;                                         // 超过此长度视为伪邻接

for (const [i, j] of raw) {
  const a = commanderies[i], b = commanderies[j];
  const km = dist(a, b);
  if (km > MAX_KM) { pruned.tooLong += 1; continue; }

  const s = sampleEdge(a, b);
  const seaRatio = s.samples ? s.tally.sea / s.samples : 0;
  const hlRatio = s.samples ? s.tally.highland / s.samples : 0;
  if (seaRatio > 0.35) { pruned.sea += 1; continue; }       // 大段走海面
  if (hlRatio > 0.5) { pruned.highland += 1; continue; }    // 穿青藏高原

  const rivers = crossings(a, b);
  const onEdge = nodesOnEdge(a, b);
  const hasFord = onEdge.some((n) => n.kind === "ford" || n.kind === "port");
  // 跨主干大河且沿线无渡口港口 → 不可通行
  if (rivers.length && !hasFord) { pruned.river += 1; continue; }

  // 边的地形档取沿线最险的一档；关隘另计
  const gate = onEdge.find((n) => n.kind === "gate" || n.kind === "pass");
  const mtnRatio = s.samples ? s.tally.mountain / s.samples : 0;
  const hillRatio = s.samples ? s.tally.hill / s.samples : 0;
  const terrain = gate ? "gate"
    : rivers.length ? "river"
    : mtnRatio > 0.35 ? "mountain"
    : hillRatio + mtnRatio > 0.45 ? "hill" : "plain";

  const COST = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
  edges.push({
    from: a.id, to: b.id,
    km: Math.round(km),
    terrain,
    cost: +(km / 100 * COST[terrain]).toFixed(2),          // 以 100km 平原为 1 个单位
    maxElev: Math.round(s.maxElev),
    crossings: rivers.map((r) => r.river),
    nodes: onEdge,
  });
}

// ── 补边一：关津即通道凭证 ──────────────────────────────────────────
// Delaunay 是平面三角化，会因对角线选择而漏掉史实上确实存在的直连
// （实测洛阳–陈留、汉中–蜀郡、庐江–丹阳都被漏掉）。
// 但关隘、渡口、栈道的存在本身就是"此处有路"的凭证——剑门在那里，
// 就说明汉中与蜀郡之间通行。因此为每个尚未挂载的关津补一条边：
// 连接距它最近的两个郡国。
{
  const have = new Set(edges.map((e) => [e.from, e.to].sort().join("|")));
  const attached = new Set(edges.flatMap((e) => e.nodes.map((n) => n.id)));
  let addedByNode = 0;
  for (const nd of nodes) {
    if (attached.has(nd.id)) continue;
    if (nd.kind === "battlefield" || nd.kind === "depot") continue;   // 古战场仓城不生成通道
    const near = commanderies
      .map((c) => ({ c, d: Math.hypot(px(c.longitude) - px(nd.longitude), py(c.latitude) - py(nd.latitude)) }))
      .sort((a, b) => a.d - b.d).slice(0, 2);
    if (near.length < 2 || near[1].d > 260) continue;                 // 太远说明这不是它扼守的通道
    const [a, b] = [near[0].c, near[1].c];
    const key = [a.id, b.id].sort().join("|");
    if (have.has(key)) continue;
    const s = sampleEdge(a, b);
    const rivers = crossings(a, b);
    const onEdge = nodesOnEdge(a, b);
    const gate = onEdge.find((n) => n.kind === "gate" || n.kind === "pass");
    const mtn = s.samples ? s.tally.mountain / s.samples : 0;
    const hill = s.samples ? s.tally.hill / s.samples : 0;
    const terrain = gate ? "gate" : rivers.length ? "river"
      : mtn > 0.35 ? "mountain" : hill + mtn > 0.45 ? "hill" : "plain";
    const COST = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
    const km = dist(a, b);
    edges.push({
      from: a.id, to: b.id, km: Math.round(km), terrain,
      cost: +(km / 100 * COST[terrain]).toFixed(2),
      maxElev: Math.round(s.maxElev),
      crossings: rivers.map((r) => r.river),
      nodes: onEdge,
      via: nd.name,                                                   // 记录这条边是因谁而生
    });
    have.add(key); addedByNode += 1;
  }
  console.log(`按关津补边 ${addedByNode} 条`);
}

// ── 补边一点五：同州连通 ────────────────────────────────────────────
// 州是有驿道相连的行政区。若某郡与本州其余郡国全不相连，说明剪枝过头了
// （实测广陵郡属徐州却只连南边的丹阳九江吴郡，与下邳东海之间因淮水被剪，
// 刘备的地盘被切成两半）。为这类郡补一条通向本州最近郡的边，
// 跨河者按「有津渡」处理——同州之内必有官渡。
{
  const have = new Set(edges.map((e) => [e.from, e.to].sort().join("|")));
  const byZhou = new Map();
  for (const c of commanderies) {
    if (!byZhou.has(c.zhou)) byZhou.set(c.zhou, []);
    byZhou.get(c.zhou).push(c);
  }
  let addedByZhou = 0;
  for (const [zhou, members] of byZhou) {
    if (members.length < 2) continue;
    const ids = new Set(members.map((c) => c.id));
    for (const c of members) {
      const linked = edges.some((e) =>
        (e.from === c.id && ids.has(e.to)) || (e.to === c.id && ids.has(e.from)));
      if (linked) continue;
      const near = members
        .filter((o) => o.id !== c.id)
        .map((o) => ({ o, d: dist(c, o) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!near || near.d > MAX_KM) continue;
      const key = [c.id, near.o.id].sort().join("|");
      if (have.has(key)) continue;
      const s = sampleEdge(c, near.o);
      const rivers = crossings(c, near.o);
      const mtn = s.samples ? s.tally.mountain / s.samples : 0;
      const hill = s.samples ? s.tally.hill / s.samples : 0;
      const terrain = rivers.length ? "river" : mtn > 0.35 ? "mountain"
        : hill + mtn > 0.45 ? "hill" : "plain";
      const COST = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
      edges.push({
        from: c.id, to: near.o.id, km: Math.round(near.d), terrain,
        cost: +(near.d / 100 * COST[terrain]).toFixed(2),
        maxElev: Math.round(s.maxElev),
        crossings: rivers.map((r) => r.river),
        nodes: nodesOnEdge(c, near.o),
        via: `同州连通（${zhou}）`,
      });
      have.add(key); addedByZhou += 1;
    }
  }
  if (addedByZhou) console.log(`同州连通补边 ${addedByZhou} 条`);
}

// ── 补边二：孤立分量兜底 ────────────────────────────────────────────
// 河西走廊、南中这类地方史实上确实偏远，但完全不连通意味着永远打不到
// 也守不住，玩法上等于不存在。给每个孤立分量补一条通向主体的最短边。
{
  const linkAll = () => {
    const adj = new Map(commanderies.map((c) => [c.id, []]));
    for (const e of edges) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); }
    const seen = new Set(); const comps = [];
    for (const c of commanderies) {
      if (seen.has(c.id)) continue;
      const st = [c.id], comp = []; seen.add(c.id);
      while (st.length) { const u = st.pop(); comp.push(u);
        for (const v of adj.get(u) ?? []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
      comps.push(comp);
    }
    return comps.sort((a, b) => b.length - a.length);
  };
  let added = 0;
  for (let guard = 0; guard < 12; guard += 1) {
    const comps = linkAll();
    if (comps.length <= 1) break;
    const main = new Set(comps[0]);
    const byId = new Map(commanderies.map((c) => [c.id, c]));
    let best = null;
    for (const id of comps[1]) {
      for (const m of main) {
        const d = dist(byId.get(id), byId.get(m));
        if (!best || d < best.d) best = { a: byId.get(id), b: byId.get(m), d };
      }
    }
    if (!best) break;
    const s = sampleEdge(best.a, best.b);
    const mtn = s.samples ? s.tally.mountain / s.samples : 0;
    const hill = s.samples ? s.tally.hill / s.samples : 0;
    const terrain = mtn > 0.35 ? "mountain" : hill + mtn > 0.45 ? "hill" : "plain";
    const COST = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
    edges.push({
      from: best.a.id, to: best.b.id, km: Math.round(best.d), terrain,
      cost: +(best.d / 100 * COST[terrain]).toFixed(2),
      maxElev: Math.round(s.maxElev),
      crossings: crossings(best.a, best.b).map((r) => r.river),
      nodes: nodesOnEdge(best.a, best.b),
      via: "兜底连通",
    });
    added += 1;
  }
  if (added) console.log(`孤立分量兜底补边 ${added} 条`);
}

console.log(`剪除：过长 ${pruned.tooLong}  穿海 ${pruned.sea}  穿高原 ${pruned.highland}  跨河无渡 ${pruned.river}`);
console.log(`保留 ${edges.length} 条边，平均度 ${(edges.length * 2 / commanderies.length).toFixed(2)}`);

// ── 挂载去重：一个关津只归属于离它最近的边 ──────────────────────────
// 45km 半径会让一个关挂到不相干的边上（实测虎牢关同时挂在河南尹–上党，
// 而洛阳去上党是翻太行走天井关，不经虎牢）。改为择优：每个关津按垂距
// 排序，只保留最近的 2 条边；渡口港口保留 3 条（一个渡口常服务多条路线）。
{
  const byNode = new Map();                        // nodeId → [{edgeIdx, offset}]
  edges.forEach((e, i) => {
    for (const n of e.nodes) {
      (byNode.get(n.id) ?? byNode.set(n.id, []).get(n.id)).push({ i, offset: n.offset });
    }
  });
  let dropped = 0;
  for (const [nodeId, lst] of byNode) {
    const kind = nodes.find((n) => n.id === nodeId)?.kind;
    const keep = (kind === "ford" || kind === "port") ? 3 : 2;
    if (lst.length <= keep) continue;
    lst.sort((a, b) => a.offset - b.offset);
    for (const { i } of lst.slice(keep)) {
      edges[i].nodes = edges[i].nodes.filter((n) => n.id !== nodeId);
      dropped += 1;
    }
  }
  console.log(`挂载去重：剔除 ${dropped} 处过远挂载`);
  // 去重后边的地形档可能变化（关隘被摘掉就不该再算 gate）
  const COST = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
  for (const e of edges) {
    const hasGate = e.nodes.some((n) => n.kind === "gate" || n.kind === "pass");
    if (e.terrain === "gate" && !hasGate) {
      e.terrain = e.crossings.length ? "river" : e.maxElev > 1400 ? "mountain" : "hill";
      e.cost = +(e.km / 100 * COST[e.terrain]).toFixed(2);
    }
  }
}

// ── 连通性检查：孤岛意味着该郡永远打不到也守不住 ────────────────────
{
  const adj = new Map(commanderies.map((c) => [c.id, []]));
  for (const e of edges) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); }
  const seen = new Set(); const comps = [];
  for (const c of commanderies) {
    if (seen.has(c.id)) continue;
    const stack = [c.id], comp = [];
    seen.add(c.id);
    while (stack.length) {
      const u = stack.pop(); comp.push(u);
      for (const v of adj.get(u) ?? []) if (!seen.has(v)) { seen.add(v); stack.push(v); }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  const nameOf = new Map(commanderies.map((c) => [c.id, c.name]));
  console.log(`\n【连通分量】${comps.length} 个，最大 ${comps[0].length} 个郡`);
  for (const c of comps.slice(1)) console.log(`  孤立：${c.map((id) => nameOf.get(id)).join(" ")}`);
  const isolated = commanderies.filter((c) => (adj.get(c.id) ?? []).length === 0);
  if (isolated.length) console.log(`  零度郡：${isolated.map((c) => c.name).join(" ")}`);
}

// ── 史实要道验收 ────────────────────────────────────────────────────
console.log("\n【史实要道验收】");
// 配对按史实校正过：剑门在广汉郡北而非蜀郡门口，濡须口在九江与丹阳之间
// 而非庐江，官渡在中牟属陈留以西。首版按印象写的清单有一半是错的。
const CHECKS = [
  ["汉函谷关", "河南尹", "弘农郡"],
  ["剑门关",   "汉中郡", "广汉郡"],
  ["阳平关",   "汉中郡", "武都郡"],
  ["武关",     "京兆尹", "南阳郡"],
  ["濡须口",   "九江郡", "丹阳郡"],
  ["夏口",     "江夏郡", "南郡"],
  ["白马津",   "东郡",   "魏郡"],
  ["官渡",     "陈留郡", "颍川郡"],
  ["壶关",     "上党郡", "魏郡"],
  ["湖口",     "庐江郡", "豫章郡"],
];
const idOf = new Map(commanderies.map((c) => [c.name, c.id]));
let pass = 0;
for (const [gateName, fromName, toName] of CHECKS) {
  const f = idOf.get(fromName), t = idOf.get(toName);
  const e = edges.find((x) => (x.from === f && x.to === t) || (x.from === t && x.to === f));
  if (!e) { console.log(`  ✗ ${fromName}–${toName} 无边（${gateName} 无处挂载）`); continue; }
  const has = e.nodes.some((n) => n.name === gateName || n.name.includes(gateName.slice(0, 2)));
  console.log(`  ${has ? "✓" : "△"} ${fromName}–${toName} ${e.km}km ${e.terrain}` +
              `  挂载：${e.nodes.map((n) => n.name).join("、") || "无"}`);
  if (has) pass += 1;
}
console.log(`  ${pass}/${CHECKS.length} 条要道的关津正确挂载`);

// 未被任何边挂载的关津 —— 它们在玩法上没有意义
const attached = new Set(edges.flatMap((e) => e.nodes.map((n) => n.id)));
const orphanNodes = nodes.filter((n) => !attached.has(n.id));
console.log(`\n【关津挂载】${nodes.length - orphanNodes.length}/${nodes.length} 已挂到边上`);
if (orphanNodes.length) {
  console.log(`  未挂载（玩法上暂无作用）：${orphanNodes.map((n) => `${n.name}(${n.kind})`).join(" ")}`);
}

// ── 落盘 ────────────────────────────────────────────────────────────
const out = {
  meta: {
    note: "郡国通行图。Delaunay 取候选边，沿边采样地形网格定档，与水系求交判跨河，关津按垂距挂载。",
    generatedFrom: "tools/build-adjacency.mjs",
    commanderies: commanderies.length,
    edges: edges.length,
    maxEdgeKm: MAX_KM,
    costUnit: "1 = 100km 平原",
    terrainCost: { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 },
  },
  edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
};
fs.writeFileSync(`${D}/adjacency.json`, JSON.stringify(out, null, 1));
console.log(`\n→ ${D}/adjacency.json  ${edges.length} 条边`);
