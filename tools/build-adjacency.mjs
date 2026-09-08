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
import { cmp } from "../lib/game/engine/cmp.ts";

const D = "lib/game/data";
const read = (f) => JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8"));
const arr = (o) => (Array.isArray(o) ? o : (o.officers ?? o.nodes ?? o.rivers ?? o));

const commanderies = arr(read("commanderies.json"));
const nodes = read("strategic-nodes.json").nodes ?? [];
const hydro = read("hydrology.json");
const grid = read("terrain-grid.json");
const { west, south, north, cellSize, cols, rows } = grid.meta;
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
    // 半径取「幅员」79 km，不是拍出来的 45。
    //
    // 79 = 相邻郡治间距中位数 158 km 的一半——这个数项目里已经在用了
    // （兵种判定的「幅员」就是它）。45 是拍的，而且拍得正好卡在几个点上：
    // 郿坞与长坂的垂距都是 44.7 km，差 0.3 km 就挂上了。
    // 一个据点归不归某条路管，判据该是「它在不在这条路的幅员之内」。
    if (d < 79) out.push({ id: nd.id, name: nd.name, kind: nd.kind, offset: +d.toFixed(1) });
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
  // baseTerrain =「这条边若没有关，该算哪一档」。存下来是因为下面的挂载去重
  // 会把关摘掉，那时必须退回**当初量出来的**这一档，不能另按一套判据现编
  const baseTerrain = rivers.length ? "river"
    : mtnRatio > 0.35 ? "mountain"
    : hillRatio + mtnRatio > 0.45 ? "hill" : "plain";
  const terrain = gate ? "gate" : baseTerrain;

  const COST = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
  edges.push({
    from: a.id, to: b.id,
    km: Math.round(km),
    terrain, baseTerrain,
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
  let addedByNode = 0, attachedToExisting = 0;
  for (const nd of nodes) {
    if (attached.has(nd.id)) continue;
    if (nd.kind === "battlefield" || nd.kind === "depot") continue;   // 古战场仓城不生成通道
    const near = commanderies
      .map((c) => ({ c, d: Math.hypot(px(c.longitude) - px(nd.longitude), py(c.latitude) - py(nd.latitude)) }))
      .sort((a, b) => a.d - b.d).slice(0, 2);
    if (near.length < 2 || near[1].d > 260) continue;                 // 太远说明这不是它扼守的通道
    const [a, b] = [near[0].c, near[1].c];
    const key = [a.id, b.id].sort().join("|");
    if (have.has(key)) {
      // **这条边已经有了——那就把这个关挂到它上面，不是丢掉。**
      //
      // 上面那句「关津的存在就是此处有路的凭证」，对已经存在的路同样成立；
      // 原先这里 continue，等于把结论扔了：十个关津因此静悄悄成了孤儿
      // （大散关、萧关、褒斜道、陈仓道、巴丘、番禺、合浦、阳关、徐闻…），
      // 图上画着，路上没有，引擎里不存在。实测「因关补出来的边」一条都没有，
      // 全被这一行拦掉了。
      const e = edges.find((x) => [x.from, x.to].sort().join("|") === key);
      if (e && !e.nodes.some((n) => n.id === nd.id)) {
        e.nodes.push({ id: nd.id, name: nd.name, kind: nd.kind, offset: null });
        e.nodes.sort((x, y) => (x.offset ?? 1e9) - (y.offset ?? 1e9));
        attachedToExisting += 1;
      }
      continue;
    }
    const s = sampleEdge(a, b);
    const rivers = crossings(a, b);
    const onEdge = nodesOnEdge(a, b);
    const gate = onEdge.find((n) => n.kind === "gate" || n.kind === "pass");
    const mtn = s.samples ? s.tally.mountain / s.samples : 0;
    const hill = s.samples ? s.tally.hill / s.samples : 0;
    const baseTerrain = rivers.length ? "river"
      : mtn > 0.35 ? "mountain" : hill + mtn > 0.45 ? "hill" : "plain";
    const terrain = gate ? "gate" : baseTerrain;
    const COST = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
    const km = dist(a, b);
    edges.push({
      from: a.id, to: b.id, km: Math.round(km), terrain, baseTerrain,
      cost: +(km / 100 * COST[terrain]).toFixed(2),
      maxElev: Math.round(s.maxElev),
      crossings: rivers.map((r) => r.river),
      nodes: onEdge,
      via: nd.name,                                                   // 记录这条边是因谁而生
    });
    have.add(key); addedByNode += 1;
  }
  console.log(`按关津补边 ${addedByNode} 条，挂到已有边 ${attachedToExisting} 处`);
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
  // 去重后边的地形档可能变化（关隘被摘掉就不该再算 gate）。
  //
  // 退回 **baseTerrain**——当初沿边采样量出来的那一档，不是现编的。
  // 原先这里写的是 `crossings ? river : maxElev > 1400 ? mountain : hill`，
  // 那是另一套判据（按最高点，而采样按沿线各档的占比），两者本来就会给出
  // 不同的答案。半径还是 45 时这条极少触发，看不出来；放宽到 79 之后
  // 一次就冒出四条：代郡–上谷 hill→mountain、河东–上党 hill→mountain、
  // 广阳–渔阳 plain→hill、钜鹿–中山 plain→hill。
  // 那四条**从来没有关**，只是短暂地挂上又被摘掉，就换了一个没量过的地形。
  const COST = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
  for (const e of edges) {
    const hasGate = e.nodes.some((n) => n.kind === "gate" || n.kind === "pass");
    if (e.terrain === "gate" && !hasGate) {
      e.terrain = e.baseTerrain
        ?? (e.crossings.length ? "river" : e.maxElev > 1400 ? "mountain" : "hill");
      e.cost = +(e.km / 100 * COST[e.terrain]).toFixed(2);
    }
  }
  // baseTerrain 是中间量，不进产物
  for (const e of edges) delete e.baseTerrain;
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

const idOf = new Map(commanderies.map((c) => [c.name, c.id]));
const idOf0 = (n) => idOf.get(n) ?? n;

// ── 史实修正表 ──────────────────────────────────────────────────────
//
// 几何判不了汉代的郡界。水系是 0.02° 的简化折线、走的还是今河道，
// Delaunay 在点稀疏处会连出穿两个郡的长边，420km 的一刀切又会砍掉
// 益州、南中、交州那种郡治本就相距很远的真邻接。
//
// 所以这里保留一张**显式的**修正表：每条带史料判据，生成后套用。
// 不把它藏进阈值微调里——调阈值会连带改动别处几十条边，而且改完没人知道
// 为什么是这个数；一张写着判据的表，是可以被逐条推翻的。
//
// 这一批的来由：一次分维审校发现**益州与荆州、交州零连接**——入蜀只能走
// 司隶与凉州，刘表永远打不到刘璋，三峡这条三国最要紧的走廊根本不存在。
// 同时查出三条穿郡的假边、两处河套缺边、四条把长江黄河标成平地的边。
const FIX_DROP = [
  ["五原郡", "代郡", "中隔雁门、定襄两郡，郡治相距五百余公里；Delaunay 在河套一带点稀疏时连出的伪邻接"],
  ["东海郡", "东莱郡", "中隔琅邪国与北海国，且须跨海；两郡治不接壤"],
  ["河南尹", "上党郡", "中隔河内郡；上党出太行入河内，再由河内至河南尹，非直接邻接"],
];
const FIX_ADD = [
  ["巴郡", "南郡", "gate", ["长江"],
   "三峡。巴郡江州东出即鱼复、江关，出峡入南郡秭归、夷陵。汉末入蜀出蜀的主道，" +
   "刘备入蜀、夷陵之战皆由此；郡治相距逾 420km 而被长度阈值砍掉",
   ["jiang-guan", "yiling"]],
  ["朔方郡", "五原郡", "plain", [],
   "河套。朔方临戎与五原九原同在北河南岸，东西相接，不需渡大河；" +
   "简化折线取今河道，误判为跨河无渡"],
  ["五原郡", "云中郡", "plain", [], "河套。九原东接云中，同上"],
  ["越巂郡", "犍为属国", "river", ["金沙江"],
   "越巂邛都北接犍为属国朱提，郡治仅相距 155km，中隔泸水（金沙江）"],
  ["越巂郡", "益州郡", "mountain", ["金沙江"], "南中。越巂南接益州郡滇池，隔泸水相望"],
  ["益州郡", "牂牁郡", "mountain", [], "南中。益州郡东接牂牁，郡治相距 459km 而被长度阈值砍掉"],
  ["东莱郡", "辽东郡", "river", ["渤海"],
   "渤海海路。《三国志·公孙度传》「越海收东莱诸县，置营州刺史」——" +
   "公孙度据辽东而有东莱，走的正是蓬莱至旅顺这条约百公里的海道。" +
   "缺了它，东莱与辽东在图上不连通：实录里公孙度执子的一局，" +
   "东莱十三季断供十二季、整局产出为零，却仍占着郡数。" +
   "生成器按陆路取候选边，海路只能补",
   ["dongl-port"]],
  ["越巂郡", "永昌郡", "mountain", [],
   "南中。永昌八城含云南、邪龙、楪榆，与越巂遂久、姑复接壤；同被长度阈值砍掉"],
];
// 地形订正：这几条穿的是长江与黄河，却因为「河从城边流过不算阻隔」那条
// 35km 护栏被判成平地。护栏本身有道理（汉水绕南郑、长江绕江陵），
// 错在它对「河即郡界、郡治就压在河边」这一类失效。
// 后果不是标注难看：river 是 marchCost 1.8、防御 +0.35，plain 是 1.0、0——
// 标成平地等于把长江黄河的天险清零
const FIX_TERRAIN = [
  ["广陵郡", "吴郡", "river", ["长江"], "长江口。广陵江都南渡即吴郡，京口一线为大江天险"],
  ["广陵郡", "丹阳郡", "river", ["长江"], "长江。广陵南渡至丹阳，即孙吴所恃之江防"],
  ["魏郡", "东郡", "river", ["黄河"], "黄河白马津。邺至濮阳须渡河，官渡之役前争白马即此"],
  ["乐安国", "勃海郡", "river", ["黄河"], "黄河下游。乐安临济与勃海南皮分处河之两岸"],
];

const COST_OF = { plain: 1.0, hill: 1.35, mountain: 2.1, gate: 2.6, river: 1.8 };
const same = (e, a, b) => (e.from === a && e.to === b) || (e.from === b && e.to === a);
const fixes = { dropped: 0, added: 0, retimed: 0, missed: [] };

for (const [an, bn, basis] of FIX_DROP) {
  const a = idOf0(an), b = idOf0(bn);
  const i = edges.findIndex((e) => same(e, a, b));
  if (i < 0) { fixes.missed.push(`删 ${an}–${bn}：本就不存在`); continue; }
  edges.splice(i, 1); fixes.dropped += 1;
  console.log(`  − ${an}–${bn}  ${basis}`);
}
for (const [an, bn, terrain, crossings, basis, hold = []] of FIX_ADD) {
  const a = idOf0(an), b = idOf0(bn);
  if (edges.some((e) => same(e, a, b))) { fixes.missed.push(`补 ${an}–${bn}：已存在`); continue; }
  const A = commanderies.find((c) => c.id === a), B = commanderies.find((c) => c.id === b);
  const km = Math.round(dist(A, B));
  // 关津挂载在这之前就跑完了，新补的边得自己挂——不挂则江关、夷陵永远悬空，
  // 而三峡这条边正是它们唯一的用武之地
  const hung = hold.map((nid) => nodes.find((n) => n.id === nid))
    .filter(Boolean)
    .map((n) => ({ id: n.id, name: n.name, kind: n.kind, offset: 0 }));
  edges.push({ from: a, to: b, km, terrain, cost: +((km / 100) * COST_OF[terrain]).toFixed(2),
               maxElev: 0, crossings, nodes: hung, fix: basis });
  fixes.added += 1;
  console.log(`  + ${an}–${bn} ${km}km ${terrain}  ${basis}`);
}
for (const [an, bn, terrain, crossings, basis] of FIX_TERRAIN) {
  const e = edges.find((x) => same(x, idOf0(an), idOf0(bn)));
  if (!e) { fixes.missed.push(`改 ${an}–${bn}：无此边`); continue; }
  e.terrain = terrain;
  e.cost = +((e.km / 100) * COST_OF[terrain]).toFixed(2);
  e.crossings = crossings;
  e.fix = basis;
  fixes.retimed += 1;
  console.log(`  ~ ${an}–${bn} → ${terrain}  ${basis}`);
}
console.log(`【史实修正】删 ${fixes.dropped} 补 ${fixes.added} 改地形 ${fixes.retimed}`);
// 修正表落空说明生成器的行为变了 —— 那正是要知道的事，不能沉默
if (fixes.missed.length) {
  console.log(`  ⚠ 落空 ${fixes.missed.length} 条：${fixes.missed.join("；")}`);
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
  // 三峡是后补的。首版清单里没有它，于是「益州与荆州零连接」在图里躺了几个月
  // 没人发现——刘表打不到刘璋，刘璋的东面无懈可击。
  // 验收清单漏掉的东西，就是永远不会被发现的东西
  ["江关",     "巴郡",   "南郡"],
];

/**
 * 必须存在的走廊。关津挂没挂上可以将就（△），**边不存在则直接失败**：
 * 这一条断了，整个州就成了孤岛，而孤岛在自对局里不会报错、只会静静地
 * 让某个席位既打不出去也打不进来
 */
const REQUIRED = [
  ["巴郡", "南郡", "益州东出荆州的唯一通道"],
  ["汉中郡", "广汉郡", "益州北面的门户"],
  ["九江郡", "丹阳郡", "江淮之间的渡江要道"],
];
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

let broken = 0;
for (const [fromName, toName, why] of REQUIRED) {
  const f = idOf.get(fromName), t = idOf.get(toName);
  if (!edges.some((x) => (x.from === f && x.to === t) || (x.from === t && x.to === f))) {
    console.log(`  ✗✗ 必需走廊缺失：${fromName}–${toName}（${why}）`);
    broken += 1;
  }
}

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
  edges: edges.sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to)),
};
if (broken) {
  console.error(`\n必需走廊缺失 ${broken} 条 —— 不落盘。修生成器或补进史实修正表。`);
  process.exit(1);
}
fs.writeFileSync(`${D}/adjacency.json`, JSON.stringify(out, null, 1));
console.log(`\n→ ${D}/adjacency.json  ${edges.length} 条边`);
