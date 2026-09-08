// 把 232 条边算成**真的走地形的路**，离线烤成折线。
//
// 起因是一句很准的批评：「你现在汉中到蜀这块，中间这几个关卡放在这起不到
// 任何作用——关卡本身是起防护作用的，但你的线条是必经之路，而这三个关卡
// 又不在必经之路上。」
//
// 第一步已经把路改成从挂在这条边上的关穿过去（PlayClient 的 roadGeom）。
// 但没有关的边仍是城心直连的直线，横穿山脊、互相交叉——那才是「乱」的主因。
// 这里做第二步：在高程栅格上跑最小代价路径，让路自己去找河谷。
//
// 代价函数（每格）：
//   基础 1
// + 坡度罚：相邻两格的高差。翻山比绕行贵，路自然贴着等高线走
// + 高程罚：海拔本身。同样平坦，走海拔低的那条
// + 水罚：陆路不下水（水路例外，见下）
//
// 水路（terrain=river）反过来：贴着水走便宜，上岸贵——它要顺着江。
//
// 关是**必经点**：把 A→B 拆成 A→关1→关2→B 逐段跑。这样图上的路与引擎
// 说的「扼于阳平关、白水关」是同一件事，而不是各说各的。
//
// 反复运行结果一致：无网络、无随机、无时间依赖。
import fs from "node:fs";

const OUT = process.env.OUT ?? "public/game/roads.json";
// 工作分辨率。原始 DEM 是 12288×11520（0.0027°/格），整幅跑 A* 太重，
// 而路只需要「绕开山脊」这个量级的精度——0.02° ≈ 2km 足够
const STEP = Number(process.env.STEP ?? 0.02);

const meta = JSON.parse(fs.readFileSync("refs/dem-raster.json", "utf8"));
const buf = fs.readFileSync("refs/dem-raster.raw");
const dem = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const merc = (lat) => { const r = (lat * Math.PI) / 180; return Math.log(Math.tan(r) + 1 / Math.cos(r)); };
const mercN = merc(meta.north), mercS = merc(meta.south);
/** 原始 DEM 取值。DEM 是墨卡托纵轴，这里的工作网格是等距圆柱，故要换算 */
function demAt(lon, lat) {
  const fx = ((lon - meta.west) / (meta.east - meta.west)) * meta.width;
  const fy = ((mercN - merc(lat)) / (mercN - mercS)) * meta.height;
  const x = Math.max(0, Math.min(meta.width - 1, Math.round(fx)));
  const y = Math.max(0, Math.min(meta.height - 1, Math.round(fy)));
  return dem[y * meta.width + x];
}

// ── 工作网格 ────────────────────────────────────────────────────────
const W_DEG = 94, E_DEG = 127, S_DEG = 16, N_DEG = 43;
const COLS = Math.round((E_DEG - W_DEG) / STEP);
const ROWS = Math.round((N_DEG - S_DEG) / STEP);
const lonOf = (c) => W_DEG + (c + 0.5) * STEP;
const latOf = (r) => N_DEG - (r + 0.5) * STEP;
console.log(`工作网格 ${COLS}×${ROWS}（${STEP}°/格）　采样高程…`);
const elev = new Int16Array(COLS * ROWS);
for (let r = 0; r < ROWS; r += 1) {
  for (let c = 0; c < COLS; c += 1) elev[r * COLS + c] = demAt(lonOf(c), latOf(r));
}

const commanderies = JSON.parse(fs.readFileSync("lib/game/data/commanderies.json", "utf8"));
const bundle = JSON.parse(fs.readFileSync("public/game/runtime-194.json", "utf8"));
const nodeById = new Map((bundle.nodes ?? []).map((n) => [n.id, n]));
const seatOf = new Map(commanderies.map((c) => [c.id, c]));

const cellOf = (lon, lat) => [
  Math.max(0, Math.min(COLS - 1, Math.round((lon - W_DEG) / STEP - 0.5))),
  Math.max(0, Math.min(ROWS - 1, Math.round((N_DEG - lat) / STEP - 0.5))),
];

/**
 * A*。限定在两端点的外扩包围盒内——整幅跑一次要几百万格，
 * 而一条边的路不会绕到半个天下之外
 */
function route(fromLL, toLL, wet) {
  const [c0, r0] = cellOf(fromLL[0], fromLL[1]);
  const [c1, r1] = cellOf(toLL[0], toLL[1]);
  const pad = Math.max(14, Math.round(Math.hypot(c1 - c0, r1 - r0) * 0.55));
  const lo = { c: Math.max(0, Math.min(c0, c1) - pad), r: Math.max(0, Math.min(r0, r1) - pad) };
  const hi = { c: Math.min(COLS - 1, Math.max(c0, c1) + pad), r: Math.min(ROWS - 1, Math.max(r0, r1) + pad) };
  const w = hi.c - lo.c + 1, h = hi.r - lo.r + 1;
  const idx = (c, r) => (r - lo.r) * w + (c - lo.c);
  const g = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const done = new Uint8Array(w * h);
  const H = (c, r) => Math.hypot(c - c1, r - r1);
  // 简易二叉堆
  const heap = [];
  const push = (k, f) => { heap.push([f, k]); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0;
      for (;;) { const l = i * 2 + 1, r2 = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r2 < heap.length && heap[r2][0] < heap[m][0]) m = r2;
        if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top; };
  g[idx(c0, r0)] = 0; push(idx(c0, r0), H(c0, r0));
  const goal = idx(c1, r1);
  while (heap.length) {
    const [, k] = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) break;
    const cc = lo.c + (k % w), rr = lo.r + Math.floor(k / w);
    const e0 = elev[rr * COLS + cc];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const nc = cc + dc, nr = rr + dr;
        if (nc < lo.c || nc > hi.c || nr < lo.r || nr > hi.r) continue;
        const nk = idx(nc, nr);
        if (done[nk]) continue;
        const e1 = elev[nr * COLS + nc];
        const step = (dc && dr) ? 1.414 : 1;
        let cost;
        if (wet) {
          // 水路：在水里走便宜，上岸贵。它要顺着江与海岸
          cost = step * (e1 <= 0 ? 1 : 1 + e1 / 40);
        } else {
          if (e1 <= 0) { cost = step * 60; }               // 陆路可跨小水面，但很贵
          else {
            const slope = Math.abs(e1 - e0);
            cost = step * (1 + slope / 55 + Math.max(0, e1) / 900);
          }
        }
        const ng = g[k] + cost;
        if (ng < g[nk]) { g[nk] = ng; prev[nk] = k; push(nk, ng + H(nc, nr) * 0.9); }
      }
    }
  }
  if (!Number.isFinite(g[goal])) return null;
  const pts = [];
  for (let k = goal; k !== -1; k = prev[k]) {
    pts.push([lonOf(lo.c + (k % w)), latOf(lo.r + Math.floor(k / w))]);
    if (k === idx(c0, r0)) break;
  }
  return pts.reverse();
}

/** 道格拉斯–普克化简。折线原样有几百个点，图上只要看得出走向 */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, fd = tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = pts[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ── 逐边路由 ────────────────────────────────────────────────────────
const edges = bundle.adjacency.edges;
const out = [];
let t0 = Date.now(), failed = 0;
for (let i = 0; i < edges.length; i += 1) {
  const e = edges[i];
  const a = seatOf.get(e.from), b = seatOf.get(e.to);
  if (!a || !b) { failed += 1; continue; }
  const A = [a.longitude, a.latitude], B = [b.longitude, b.latitude];
  // 关是必经点，按在 A→B 上的投影排序（与界面那一版同一套口径）
  const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy || 1;
  const via = (e.nodes ?? [])
    .map((n) => nodeById.get(n.id)).filter(Boolean)
    .map((n) => ({ ll: [n.longitude, n.latitude], name: n.name,
                   t: ((n.longitude - A[0]) * dx + (n.latitude - A[1]) * dy) / l2 }))
    .filter((v) => v.t > 0.04 && v.t < 0.96)
    .sort((u, v) => u.t - v.t);
  const wet = e.terrain === "river";
  const legs = [A, ...via.map((v) => v.ll), B];
  let path = [];
  let ok = true;
  for (let k = 0; k + 1 < legs.length; k += 1) {
    const seg = route(legs[k], legs[k + 1], wet);
    if (!seg) { ok = false; break; }
    path = path.length ? path.concat(seg.slice(1)) : seg;
  }
  if (!ok || path.length < 2) {
    // 走不通就退回直线：**必须留下这条记录**，不然图上少一条路而没人知道
    out.push({ from: e.from, to: e.to, terrain: e.terrain, straight: true,
               pts: [A, ...via.map((v) => v.ll), B] });
    failed += 1;
    continue;
  }
  out.push({ from: e.from, to: e.to, terrain: e.terrain,
             via: via.map((v) => v.name),
             pts: simplify(path, STEP * 0.9).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]) });
  if ((i + 1) % 40 === 0) {
    console.log(`  ${i + 1}/${edges.length}　${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

fs.writeFileSync(OUT, `${JSON.stringify({
  _note: "边的实走路径：在高程栅格上按最小代价算出，经过挂在该边上的关。"
       + "由 tools/route-roads.mjs 生成，反复运行结果一致。",
  step: STEP, roads: out,
})}\n`);
const avg = out.reduce((s, r) => s + r.pts.length, 0) / out.length;
console.log(`→ ${OUT}　${out.length} 条　平均 ${avg.toFixed(1)} 个点　`
  + `退回直线 ${failed} 条　${(fs.statSync(OUT).size / 1024).toFixed(0)}KB　`
  + `${((Date.now() - t0) / 1000).toFixed(0)}s`);
