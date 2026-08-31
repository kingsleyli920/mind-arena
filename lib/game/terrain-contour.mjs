// 地形区域轮廓提取 —— 「区域轮廓绘制」渲染方案的几何核心
//
// 目的：tilemap 只当数据层。渲染时把同类地形的格子聚成连通区域、提取平滑闭合轮廓，
//       沿轮廓画连绵山体 / 林带 / 水系，而不是一格一贴图。
//
// 纯 ESM、零依赖、无 Node 内置模块引用，Node 22+ 与浏览器均可直接 import。
// 全部函数都是纯函数（不修改入参），同样输入必得同样输出，可重复运行。
//
// ── 坐标系约定（重要，渲染层照此换算像素）────────────────────────────────────
//   网格单元 (col, row) 占据正方形 [col, col+1] × [row, row+1]。
//   于是轮廓顶点落在**整数角点格**上，取值范围 [0..cols] × [0..rows]，
//   贴到地图边缘的区域其轮廓恰好落在 0 / cols / rows 上，绝不越界。
//   格心是 (col+0.5, row+0.5) —— medialAxis 返回的骨架点即为格心，故含 .5；
//   simplify / smooth 之后轮廓点也会变成任意小数。
//   换算到屏幕：screenX = originX + x * tileW ，screenY = originY + y * tileH。
//   （x 对应 col 向东，y 对应 row 向南，与 terrain-grid.json 的 index = row*cols + col 一致。）
//
// ── 环绕方向 ────────────────────────────────────────────────────────────────
//   外轮廓在屏幕坐标（y 向下）里是顺时针，鞋带公式符号为正；
//   洞是逆时针，符号为负。两者方向相反，所以
//   `toPath([outer, ...holes])` 用 SVG 默认的 fill-rule="nonzero" 就能正确挖洞。
//
// ── 4 邻接语义 ──────────────────────────────────────────────────────────────
//   labelRegions 默认 4 邻接（棋盘格会被拆成一堆独立区域）。
//   traceContours 在「对角相触」的鞍点处一律**右转优先**，等价于把对角视为不连通，
//   与 4 邻接保持一致：两块对角相触的格子各自描出一个闭环，而不是连成一个。
//
// ── 数据来源与不确定性 ──────────────────────────────────────────────────────
//   本文件不含任何地理数据，只做几何。上游数据是 lib/game/data/terrain-grid.json
//   （AWS Terrain Tiles / terrarium 高程，公有领域），其分类阈值本身就是近似的，
//   因此轮廓的「真实性」上限由那份网格决定；这里只保证：
//     1. 拓扑正确（连通域、洞、贴边、对角鞍点都不会画错）；
//     2. 简化 / 平滑是纯几何操作，不会改变环的闭合性与环绕方向。
//
// ── 性能 ────────────────────────────────────────────────────────────────────
//   正确性优先。89100 格（330×270）全流程（标记 + 描边 + 简化 + 平滑 + 骨架）
//   在 Node 22 上约百毫秒量级，远低于「数秒」要求。见 tools/test-contour.mjs。

// ────────────────────────────────────────────────────────────────────────────
// 内部小工具
// ────────────────────────────────────────────────────────────────────────────

/** 方向编号：0=右(+x) 1=下(+y) 2=左(-x) 3=上(-y)。右转 = (d+1)&3。 */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** 8 邻接偏移（顺时针，从正右开始）。 */
const NB8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

function copyPoint(p) {
  return [p[0], p[1]];
}

/**
 * 把「格子集合」统一成一张 Uint8Array 掩码。
 *
 * 接受：
 *   - Uint8Array / Uint8ClampedArray 且长度 === cols*rows —— 视为掩码，**直接复用不复制**
 *   - 任何可迭代的格索引集合（Array / Uint32Array / Set），索引 = row*cols + col
 */
function toMask(cells, cols, rows) {
  const n = cols * rows;
  if (
    (cells instanceof Uint8Array || cells instanceof Uint8ClampedArray) &&
    cells.length === n
  ) {
    return cells;
  }
  const mask = new Uint8Array(n);
  if (cells == null) return mask;
  for (const idx of cells) {
    if (idx >= 0 && idx < n) mask[idx] = 1;
  }
  return mask;
}

/** 把 predicate 参数（函数 / 字符 / 值数组 / Set）归一成 (value, index) => boolean。 */
function toPredicate(predicate) {
  if (typeof predicate === "function") return predicate;
  if (predicate instanceof Set) return (v) => predicate.has(v);
  if (Array.isArray(predicate)) {
    const set = new Set(predicate);
    return (v) => set.has(v);
  }
  return (v) => v === predicate;
}

/** 环的鞋带面积（有符号）。屏幕坐标下：外轮廓 > 0，洞 < 0。 */
function signedArea(points) {
  const n = points.length;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return a / 2;
}

/**
 * 射线法判点是否在环内。
 * 只在 traceContours 内部对**未经简化**的轴对齐整数环使用，且测试点取半整数格心，
 * 因此绝不会出现「射线正好穿过顶点 / 与水平边共线」这类退化情形。
 */
function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. 连通域标记
// ────────────────────────────────────────────────────────────────────────────

/**
 * 把网格中满足 predicate 的格子聚成连通区域（默认 4 邻接）。
 *
 * @param {string|ArrayLike<any>} terrain 逐格的地形值。
 *        terrain-grid.json 里是一个长 cols*rows 的字符串（每格一个字符），
 *        也接受任意数组 / TypedArray。
 * @param {number} cols
 * @param {number} rows
 * @param {Function|string|Array|Set} predicate
 *        (value, index) => boolean；也可直接传一个值（如 "m"）或值集合（如 ["m","g"]）。
 * @param {object} [options]
 * @param {number} [options.minArea=1]      面积小于此值的区域直接丢弃
 * @param {4|8}    [options.connectivity=4] 邻接方式。默认 4，与 traceContours 的鞍点规则一致；
 *                                          用 8 时对角相触会并成一块，而轮廓仍按 4 邻接描边，
 *                                          于是一个区域可能描出多个外环（都在 components 里）。
 * @returns {{id:number, cells:number[], bbox:{minX:number,minY:number,maxX:number,maxY:number,width:number,height:number}, area:number}[]}
 *          按 area 降序；id 即数组下标（排序后重新编号，保证可重复）。
 *          bbox 用格坐标，maxX/maxY 是**含**端的格索引。
 */
export function labelRegions(terrain, cols, rows, predicate, options = {}) {
  const minArea = options.minArea ?? 1;
  const connectivity = options.connectivity === 8 ? 8 : 4;
  const test = toPredicate(predicate);
  const n = cols * rows;

  // 先做一次 predicate，避免在 BFS 里反复调用（字符串下标访问也不便宜）
  const hit = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (test(terrain[i], i)) hit[i] = 1;
  }

  const visited = new Uint8Array(n);
  const regions = [];
  // 显式栈，避免 89100 格上递归爆栈
  const stack = new Int32Array(n);

  for (let seed = 0; seed < n; seed++) {
    if (!hit[seed] || visited[seed]) continue;

    let top = 0;
    stack[top++] = seed;
    visited[seed] = 1;

    const cells = [];
    let minX = cols, minY = rows, maxX = -1, maxY = -1;

    while (top > 0) {
      const idx = stack[--top];
      cells.push(idx);
      const c = idx % cols;
      const r = (idx - c) / cols;
      if (c < minX) minX = c;
      if (c > maxX) maxX = c;
      if (r < minY) minY = r;
      if (r > maxY) maxY = r;

      // 4 邻接
      if (r > 0) { const k = idx - cols; if (hit[k] && !visited[k]) { visited[k] = 1; stack[top++] = k; } }
      if (r < rows - 1) { const k = idx + cols; if (hit[k] && !visited[k]) { visited[k] = 1; stack[top++] = k; } }
      if (c > 0) { const k = idx - 1; if (hit[k] && !visited[k]) { visited[k] = 1; stack[top++] = k; } }
      if (c < cols - 1) { const k = idx + 1; if (hit[k] && !visited[k]) { visited[k] = 1; stack[top++] = k; } }

      if (connectivity === 8) {
        const up = r > 0, dn = r < rows - 1, lf = c > 0, rt = c < cols - 1;
        if (up && lf) { const k = idx - cols - 1; if (hit[k] && !visited[k]) { visited[k] = 1; stack[top++] = k; } }
        if (up && rt) { const k = idx - cols + 1; if (hit[k] && !visited[k]) { visited[k] = 1; stack[top++] = k; } }
        if (dn && lf) { const k = idx + cols - 1; if (hit[k] && !visited[k]) { visited[k] = 1; stack[top++] = k; } }
        if (dn && rt) { const k = idx + cols + 1; if (hit[k] && !visited[k]) { visited[k] = 1; stack[top++] = k; } }
      }
    }

    if (cells.length < minArea) continue;
    cells.sort((a, b) => a - b); // 保证输出顺序与扫描顺序无关，可重复
    regions.push({
      id: -1,
      cells,
      bbox: {
        minX, minY, maxX, maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
      area: cells.length,
    });
  }

  // 面积降序；面积相同时按最小格索引升序，保证结果稳定可重复
  regions.sort((a, b) => (b.area - a.area) || (a.cells[0] - b.cells[0]));
  for (let i = 0; i < regions.length; i++) regions[i].id = i;
  return regions;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. 轮廓提取（Marching Squares / 有向边追踪）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 提取格子集合的闭合边界。
 *
 * 做法：对每个实心格，凡是「邻居为空 / 出界」的那条边，就生成一条有向边，
 * 方向定为「内部在右手边」。所有有向边首尾相接必然构成若干闭环
 * （每个角点的入度 = 出度，最多为 2）。在入度=出度=2 的鞍点上一律**右转优先**，
 * 于是对角相触的两块各自成环 —— 与 labelRegions 的 4 邻接语义一致。
 * 这与经典 Marching Squares 的 case 5/10 消歧完全等价，只是实现成边追踪，
 * 更容易顺带记录「洞的内部样本点」用于嵌套判定。
 *
 * 输出顶点只在**转向处**保留，所以一整块实心矩形恰好得到 4 个角点。
 * 环用「隐式闭合」表示：不重复首点，toPath 会补 Z。
 *
 * @param {Iterable<number>|Uint8Array} cells 格索引集合，或长 cols*rows 的掩码
 * @param {number} cols
 * @param {number} rows
 * @param {object} [options]
 * @param {number} [options.minHoleArea=0] 面积小于此值的洞直接丢弃（0 = 全保留）。
 *        真实地形里一格大小的洞多到没意义（山地最大区域有 155 个洞，多数是 1 格），
 *        画水墨时通常只留下几十格以上的那些。
 * @returns {{
 *   outer: [number,number][],
 *   holes: [number,number][][],
 *   components: {outer:[number,number][], holes:[number,number][][], area:number, netArea:number}[]
 * }}
 *   outer/holes = **面积最大那个连通块**的外轮廓与它的洞（labelRegions → traceContours
 *   的标准用法下 cells 本就只有一块，此时就是全部）。
 *   传进来若含多个互不相连的块，全部块都在 components 里，按面积降序，洞已正确归属
 *   （包括「湖中岛、岛中又有湖」这种嵌套）。
 */
export function traceContours(cells, cols, rows, options = {}) {
  const minHoleArea = options.minHoleArea ?? 0;
  const mask = toMask(cells, cols, rows);
  const vw = cols + 1; // 角点格宽

  // ── 收集有向边 ────────────────────────────────────────────────────────────
  const eSx = [];      // 起点角 x
  const eSy = [];      // 起点角 y
  const eDir = [];     // 方向 0..3
  const eEmptyC = [];  // 该边外侧那个空格的 col（出界记 -1）
  const eEmptyR = [];
  const outEdge = new Map(); // (vy*vw+vx)*4 + dir -> edge id（同一角点同一方向至多一条边）

  const addEdge = (vx, vy, dir, ec, er) => {
    const id = eSx.length;
    eSx.push(vx); eSy.push(vy); eDir.push(dir);
    eEmptyC.push(ec); eEmptyR.push(er);
    outEdge.set((vy * vw + vx) * 4 + dir, id);
  };

  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    for (let c = 0; c < cols; c++) {
      if (!mask[base + c]) continue;
      // 上：(c,r) -> (c+1,r)，右行
      if (r === 0 || !mask[base - cols + c]) addEdge(c, r, 0, r === 0 ? -1 : c, r === 0 ? -1 : r - 1);
      // 右：(c+1,r) -> (c+1,r+1)，下行
      if (c === cols - 1 || !mask[base + c + 1]) addEdge(c + 1, r, 1, c === cols - 1 ? -1 : c + 1, c === cols - 1 ? -1 : r);
      // 下：(c+1,r+1) -> (c,r+1)，左行
      if (r === rows - 1 || !mask[base + cols + c]) addEdge(c + 1, r + 1, 2, r === rows - 1 ? -1 : c, r === rows - 1 ? -1 : r + 1);
      // 左：(c,r+1) -> (c,r)，上行
      if (c === 0 || !mask[base + c - 1]) addEdge(c, r + 1, 3, c === 0 ? -1 : c - 1, c === 0 ? -1 : r);
    }
  }

  const edgeCount = eSx.length;
  if (edgeCount === 0) return { outer: [], holes: [], components: [] };

  // ── 首尾相接串成闭环 ──────────────────────────────────────────────────────
  const used = new Uint8Array(edgeCount);
  const rings = [];

  for (let e0 = 0; e0 < edgeCount; e0++) {
    if (used[e0]) continue;
    const seq = [];
    let cur = e0;
    for (;;) {
      used[cur] = 1;
      seq.push(cur);
      const d = eDir[cur];
      const ex = eSx[cur] + DX[d];
      const ey = eSy[cur] + DY[d];
      const vbase = (ey * vw + ex) * 4;
      // 右转优先 → 对角相触视作不连通（与 4 邻接一致）
      let next = -1;
      const order0 = (d + 1) & 3, order1 = d, order2 = (d + 3) & 3;
      let id = outEdge.get(vbase + order0);
      if (id !== undefined && !used[id]) next = id;
      if (next === -1) { id = outEdge.get(vbase + order1); if (id !== undefined && !used[id]) next = id; }
      if (next === -1) { id = outEdge.get(vbase + order2); if (id !== undefined && !used[id]) next = id; }
      if (next === -1) break; // 回到了起点边（起点边已被标记 used），环闭合
      cur = next;
    }

    // 只在转向处取点 → 实心矩形正好 4 个角
    const k = seq.length;
    const points = [];
    for (let i = 0; i < k; i++) {
      const d = eDir[seq[i]];
      const dPrev = eDir[seq[(i - 1 + k) % k]];
      if (d !== dPrev) points.push([eSx[seq[i]], eSy[seq[i]]]);
    }
    if (points.length < 3) continue; // 理论上不会发生

    // 取一个「环外侧空格」的格心作为洞的内部样本点（半整数，射线法不退化）
    let sampleX = -1, sampleY = -1;
    for (let i = 0; i < k; i++) {
      if (eEmptyC[seq[i]] >= 0) { sampleX = eEmptyC[seq[i]] + 0.5; sampleY = eEmptyR[seq[i]] + 0.5; break; }
    }

    const area = signedArea(points);
    rings.push({ points, area, hole: area < 0, sampleX, sampleY });
  }

  // ── 洞归属：外环面积为正、洞为负；洞归给「包含它且面积最小」的外环 ────────
  const outers = rings.filter((g) => !g.hole).sort((a, b) => b.area - a.area);
  const holeRings = rings.filter((g) => g.hole && -g.area >= minHoleArea);

  const comps = outers.map((o) => ({ outer: o.points, holes: [], area: o.area, netArea: o.area }));
  const compByRing = new Map();
  outers.forEach((o, i) => compByRing.set(o, comps[i]));

  for (const h of holeRings) {
    let best = null;
    let bestArea = Infinity;
    const px = h.sampleX, py = h.sampleY;
    for (const o of outers) {
      if (o.area >= bestArea) continue;            // outers 已按面积降序，可提前跳过
      if (px < 0 || !pointInRing(px, py, o.points)) continue;
      best = o; bestArea = o.area;
    }
    if (!best) best = outers[0];                    // 兜底：不该发生
    if (!best) continue;
    const comp = compByRing.get(best);
    comp.holes.push(h.points);
    comp.netArea += h.area;                         // h.area 为负，相当于减去
  }

  const first = comps[0];
  return {
    outer: first ? first.outer : [],
    holes: first ? first.holes : [],
    components: comps,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Douglas–Peucker 简化
// ────────────────────────────────────────────────────────────────────────────

function segDist2(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** 对**开**折线做 DP，返回「保留哪些下标」。迭代实现，不递归（防深链爆栈）。 */
function dpKeepMask(pts, tolerance) {
  const n = pts.length;
  const keep = new Uint8Array(n);
  if (n === 0) return keep;
  keep[0] = 1; keep[n - 1] = 1;
  if (n <= 2) return keep;
  const tol2 = tolerance * tolerance;
  const stack = [0, n - 1];
  while (stack.length) {
    const b = stack.pop();
    const a = stack.pop();
    if (b - a < 2) continue;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pts[i], pts[a], pts[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push(a, idx, idx, b);
    }
  }
  return keep;
}

/** 对**开**折线做 DP，保留首尾。 */
function dpOpen(pts, tolerance) {
  const n = pts.length;
  if (n <= 2) return pts.map(copyPoint);
  const keep = dpKeepMask(pts, tolerance);
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(copyPoint(pts[i]));
  return out;
}

/**
 * Douglas–Peucker 简化。
 *
 * 闭环模式（默认）：先找到离首点最远的那个点，把环切成两条开折线分别 DP，再拼回去。
 * 这样不会因为「首点恰好是可删的点」而在起点处留下折角，也天然保持闭合。
 *
 * @param {[number,number][]} points 隐式闭合的环（首点不重复出现在末尾）或开折线
 * @param {number} tolerance 容差，单位 = 格。0 或负数表示不简化
 * @param {object} [options]
 * @param {boolean} [options.closed=true] 是否当作闭环处理
 * @returns {[number,number][]} 新数组（永不修改入参）
 */
export function simplify(points, tolerance = 1, options = {}) {
  const closed = options.closed !== false;
  const n = points.length;
  if (!(tolerance > 0) || n <= 3) return points.map(copyPoint);
  if (!closed) return dpOpen(points, tolerance);

  // 离首点最远的点，作为第二个锚
  let far = 0, farD = -1;
  for (let i = 1; i < n; i++) {
    const dx = points[i][0] - points[0][0];
    const dy = points[i][1] - points[0][1];
    const d = dx * dx + dy * dy;
    if (d > farD) { farD = d; far = i; }
  }
  if (far === 0) return points.map(copyPoint);

  const head = dpOpen(points.slice(0, far + 1), tolerance);     // 0 .. far
  const tailSrc = points.slice(far);                            // far .. n-1
  tailSrc.push(points[0]);                                      // 闭回 0
  const tail = dpOpen(tailSrc, tolerance);

  // head 末 = points[far] = tail 首；tail 末 = points[0] = head 首
  const out = head.concat(tail.slice(1, -1));
  if (out.length < 3) return points.map(copyPoint); // 退化（极细长条）时宁可不简化
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Chaikin 角切割平滑
// ────────────────────────────────────────────────────────────────────────────

/**
 * Chaikin 角切割。每轮把每条边替换成 1/4、3/4 两个点，点数翻倍，
 * 极限形状是均匀二次 B 样条 —— 山脊线因此变得连绵而非折线。
 * 闭环模式下环仍然闭合（依旧是隐式闭合，不重复首点）。
 *
 * 注意：Chaikin 会让形状略微内缩（切掉外凸角），对水墨山体是想要的效果；
 * 若需要严格保面积请自行外扩。轮廓务必**先 simplify 再 smooth**，
 * 否则原始阶梯轮廓上万点翻倍几次会炸掉。
 *
 * @param {[number,number][]} points
 * @param {number} [iterations=1]
 * @param {object} [options]
 * @param {boolean} [options.closed=true] 闭环；false 时固定首尾端点
 * @returns {[number,number][]} 新数组
 */
export function smooth(points, iterations = 1, options = {}) {
  const closed = options.closed !== false;
  let pts = points.map(copyPoint);
  const minLen = closed ? 3 : 2;
  for (let it = 0; it < iterations; it++) {
    const n = pts.length;
    if (n < minLen) break;
    const out = [];
    if (!closed) out.push(copyPoint(pts[0]));
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    if (!closed) out.push(copyPoint(pts[n - 1]));
    pts = out;
  }
  return pts;
}

// ────────────────────────────────────────────────────────────────────────────
// 5. SVG path
// ────────────────────────────────────────────────────────────────────────────

function fmt(v, precision) {
  let s = v.toFixed(precision);
  if (s.indexOf(".") >= 0) {
    s = s.replace(/0+$/, "");
    if (s.endsWith(".")) s = s.slice(0, -1);
  }
  return s === "-0" ? "0" : s;
}

/**
 * 生成 SVG path 的 d 字符串（默认闭合）。
 *
 * @param {[number,number][] | [number,number][][]} input
 *        单个环，或环数组（自动识别）。传 [outer, ...holes] 时，
 *        因为外轮廓顺时针、洞逆时针，直接用默认 fill-rule="nonzero" 就能挖洞。
 * @param {object} [options]
 * @param {number}  [options.precision=2] 小数位
 * @param {boolean} [options.close=true]  是否补 Z（画开放折线时传 false）
 * @returns {string}
 */
export function toPath(input, options = {}) {
  const precision = options.precision ?? 2;
  const close = options.close !== false;
  if (!input || input.length === 0) return "";
  const isMulti = Array.isArray(input[0]) && Array.isArray(input[0][0]);
  const rings = isMulti ? input : [input];

  const parts = [];
  for (const ring of rings) {
    if (!ring || ring.length < 2) continue;
    let d = `M${fmt(ring[0][0], precision)} ${fmt(ring[0][1], precision)}`;
    for (let i = 1; i < ring.length; i++) {
      d += `L${fmt(ring[i][0], precision)} ${fmt(ring[i][1], precision)}`;
    }
    if (close) d += "Z";
    parts.push(d);
  }
  return parts.join("");
}

// ────────────────────────────────────────────────────────────────────────────
// 6. 距离变换 + 骨架（山脊线）
// ────────────────────────────────────────────────────────────────────────────

const EDT_INF = 1e20;

/** Felzenszwalb & Huttenlocher 的一维平方距离下包络变换，O(n)、精确欧氏。 */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -EDT_INF;
  z[1] = EDT_INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = EDT_INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * 精确欧氏距离变换：每个区域内格子到最近「非区域格」的距离（单位 = 格）。
 * 非区域格恒为 0。
 *
 * @param {Iterable<number>|Uint8Array} cells
 * @param {number} cols
 * @param {number} rows
 * @param {object} [options]
 * @param {boolean} [options.borderIsOutside=true]
 *        true：地图外一圈算作「区域外」，贴边的区域会被边界削薄（视觉上形状到地图边就结束了，
 *        绘制时这是想要的）。false：地图外不参与，贴边区域的骨架会一直顶到边缘
 *        （若山脉在地图外仍然延续，用 false）。
 * @param {boolean} [options.squared=false] 返回平方距离（省一次 sqrt）
 * @returns {Float64Array} 长 cols*rows
 */
export function distanceTransform(cells, cols, rows, options = {}) {
  const borderIsOutside = options.borderIsOutside !== false;
  const squared = options.squared === true;
  const mask = toMask(cells, cols, rows);

  const pw = cols + 2, ph = rows + 2;
  const f = new Float64Array(pw * ph);
  for (let r = 0; r < ph; r++) {
    for (let c = 0; c < pw; c++) {
      const inGrid = c >= 1 && c <= cols && r >= 1 && r <= rows;
      let v;
      if (inGrid) v = mask[(r - 1) * cols + (c - 1)] ? EDT_INF : 0;
      else v = borderIsOutside ? 0 : EDT_INF;
      f[r * pw + c] = v;
    }
  }

  const maxDim = Math.max(pw, ph);
  const col = new Float64Array(maxDim);
  const res = new Float64Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float64Array(maxDim + 1);

  // 先按列
  for (let c = 0; c < pw; c++) {
    for (let r = 0; r < ph; r++) col[r] = f[r * pw + c];
    edt1d(col, ph, res, v, z);
    for (let r = 0; r < ph; r++) f[r * pw + c] = res[r];
  }
  // 再按行
  for (let r = 0; r < ph; r++) {
    const base = r * pw;
    for (let c = 0; c < pw; c++) col[c] = f[base + c];
    edt1d(col, pw, res, v, z);
    for (let c = 0; c < pw; c++) f[base + c] = res[c];
  }

  const cap = (cols + rows) * (cols + rows); // borderIsOutside=false 且全图皆区域时的兜底
  const out = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!mask[i]) { out[i] = 0; continue; }
      let d2 = f[(r + 1) * pw + (c + 1)];
      if (d2 > cap) d2 = cap;
      out[i] = squared ? d2 : Math.sqrt(d2);
    }
  }
  return out;
}

/** Zhang–Suen 细化：把区域压成 8 连通、1 格宽、保持拓扑的骨架。 */
function zhangSuen(mask, cols, rows) {
  const img = Uint8Array.from(mask);
  let active = [];
  for (let i = 0; i < img.length; i++) if (img[i]) active.push(i);

  const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : img[r * cols + c]);
  const seq = new Uint8Array(9);

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 4096) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const del = [];
      for (let k = 0; k < active.length; k++) {
        const idx = active[k];
        if (!img[idx]) continue;
        const c = idx % cols;
        const r = (idx - c) / cols;
        const p2 = at(c, r - 1), p3 = at(c + 1, r - 1), p4 = at(c + 1, r), p5 = at(c + 1, r + 1);
        const p6 = at(c, r + 1), p7 = at(c - 1, r + 1), p8 = at(c - 1, r), p9 = at(c - 1, r - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        seq[0] = p2; seq[1] = p3; seq[2] = p4; seq[3] = p5;
        seq[4] = p6; seq[5] = p7; seq[6] = p8; seq[7] = p9; seq[8] = p2;
        let A = 0;
        for (let t = 0; t < 8; t++) if (seq[t] === 0 && seq[t + 1] === 1) A++;
        if (A !== 1) continue;
        if (step === 0) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
        } else {
          if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
        }
        del.push(idx);
      }
      if (del.length) {
        for (let i = 0; i < del.length; i++) img[del[i]] = 0;
        changed = true;
      }
    }
    if (changed) active = active.filter((i) => img[i]);
  }
  return img;
}

/**
 * 骨架上的邻接：8 邻接，但去掉「冗余对角」。
 * 若 p 与对角 q 之间还夹着一个骨架格（(p.c+dc,p.r) 或 (p.c,p.r+dr)），
 * 那条对角边是多余的 —— 不去掉的话，Zhang–Suen 常见的阶梯形会被误判成三岔口。
 * 该判定对 p、q 对称，所以邻接关系仍然对称。
 */
function skelNeighbors(idx, skel, cols, rows) {
  const c = idx % cols;
  const r = (idx - c) / cols;
  const out = [];
  for (let t = 0; t < 8; t++) {
    const dc = NB8[t][0], dr = NB8[t][1];
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
    const ni = nr * cols + nc;
    if (!skel[ni]) continue;
    if (dc !== 0 && dr !== 0) {
      const a = skel[r * cols + nc];
      const b = skel[nr * cols + c];
      if (a || b) continue;
    }
    out.push(ni);
  }
  return out;
}

/** 把骨架切成「端点/岔口之间的分支」。返回 {branches:number[][], adj:Map} */
function skelBranches(skel, cols, rows) {
  const cells = [];
  for (let i = 0; i < skel.length; i++) if (skel[i]) cells.push(i);
  const adj = new Map();
  for (const i of cells) adj.set(i, skelNeighbors(i, skel, cols, rows));

  const N = skel.length;
  const seen = new Set();
  const key = (a, b) => (a < b ? a * N + b : b * N + a);
  const branches = [];

  // 从非 2 度节点（端点 / 岔口 / 孤点）出发
  for (const n of cells) {
    const deg = adj.get(n).length;
    if (deg === 2) continue;
    if (deg === 0) { branches.push([n]); continue; }
    for (const m of adj.get(n)) {
      const k0 = key(n, m);
      if (seen.has(k0)) continue;
      seen.add(k0);
      const path = [n, m];
      let prev = n, cur = m;
      while (adj.get(cur).length === 2) {
        const nb = adj.get(cur);
        const nxt = nb[0] === prev ? nb[1] : nb[0];
        const k = key(cur, nxt);
        if (seen.has(k)) break;
        seen.add(k);
        path.push(nxt);
        prev = cur; cur = nxt;
      }
      branches.push(path);
    }
  }

  // 纯环（整条链全是 2 度，没有任何端点/岔口）
  for (const n of cells) {
    const nb = adj.get(n);
    if (nb.length !== 2) continue;
    if (seen.has(key(n, nb[0])) && seen.has(key(n, nb[1]))) continue;
    const start = n;
    let prev = n, cur = nb[0];
    seen.add(key(n, nb[0]));
    const path = [n, cur];
    while (cur !== start && adj.get(cur).length === 2) {
      const nn = adj.get(cur);
      const nxt = nn[0] === prev ? nn[1] : nn[0];
      const k = key(cur, nxt);
      if (seen.has(k)) break;
      seen.add(k);
      path.push(nxt);
      prev = cur; cur = nxt;
    }
    branches.push(path);
  }

  return { branches, adj };
}

/** 分支某一端「指向分支内部」的单位方向（取最多 lookahead 格求平均，抗一格抖动）。 */
function endDirection(branch, end, cols, lookahead = 4) {
  const n = branch.length;
  const a = end === 0 ? branch[0] : branch[n - 1];
  const k = Math.min(lookahead, n - 1);
  const b = end === 0 ? branch[k] : branch[n - 1 - k];
  const ac = a % cols, ar = (a - ac) / cols;
  const bc = b % cols, br = (b - bc) / cols;
  const dx = bc - ac, dy = br - ar;
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/**
 * 把骨架图的「边」缝成尽量长的山脊线。
 * 在每个岔口按「最平直」贪心配对两条分支（两端方向越接近反向越平直），
 * 拐角超过 maxTurnDeg 的不缝。于是一团带洞的山块不再是上千条碎边，
 * 而是若干条能一笔画完的主脊 —— 正是摆皴法笔触需要的形式。
 */
function stitchBranches(branches, cols, maxTurnDeg) {
  const halves = [];
  const halfIndex = new Int32Array(branches.length * 2).fill(-1);
  const nodeHalves = new Map();
  branches.forEach((b, bi) => {
    if (b.length < 2) return;
    for (let end = 0; end <= 1; end++) {
      const node = end === 0 ? b[0] : b[b.length - 1];
      const hi = halves.length;
      halves.push({ bi, end, node, dir: endDirection(b, end, cols) });
      halfIndex[bi * 2 + end] = hi;
      if (!nodeHalves.has(node)) nodeHalves.set(node, []);
      nodeHalves.get(node).push(hi);
    }
  });

  // dot <= cos(180° - maxTurnDeg) 才算「够平直」
  const dotLimit = Math.cos(((180 - maxTurnDeg) * Math.PI) / 180);
  const partner = new Int32Array(halves.length).fill(-1);
  for (const list of nodeHalves.values()) {
    if (list.length < 2) continue;
    const cands = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = halves[list[i]], b = halves[list[j]];
        if (a.bi === b.bi) continue;                 // 自环不缝
        const dot = a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1];
        if (dot > dotLimit) continue;
        cands.push([dot, list[i], list[j]]);
      }
    }
    cands.sort((x, y) => x[0] - y[0]);               // dot 越接近 -1 越平直
    for (const [, hi, hj] of cands) {
      if (partner[hi] !== -1 || partner[hj] !== -1) continue;
      partner[hi] = hj;
      partner[hj] = hi;
    }
  }

  const visited = new Uint8Array(branches.length);
  const out = [];
  for (let bi = 0; bi < branches.length; bi++) {
    if (visited[bi]) continue;
    if (branches[bi].length < 2) { visited[bi] = 1; out.push(branches[bi].slice()); continue; }
    visited[bi] = 1;
    const chain = [{ bi, rev: false }];

    let cur = bi, rev = false;
    for (;;) {                                       // 向后延伸
      const h = halfIndex[cur * 2 + (rev ? 0 : 1)];
      const p = h < 0 ? -1 : partner[h];
      if (p === -1 || visited[halves[p].bi]) break;
      const nb = halves[p].bi;
      visited[nb] = 1;
      const nrev = halves[p].end === 1;
      chain.push({ bi: nb, rev: nrev });
      cur = nb; rev = nrev;
    }
    cur = bi; rev = false;
    for (;;) {                                       // 向前延伸
      const h = halfIndex[cur * 2 + (rev ? 1 : 0)];
      const p = h < 0 ? -1 : partner[h];
      if (p === -1 || visited[halves[p].bi]) break;
      const nb = halves[p].bi;
      visited[nb] = 1;
      const nrev = halves[p].end === 0;
      chain.unshift({ bi: nb, rev: nrev });
      cur = nb; rev = nrev;
    }

    const cells = [];
    for (const seg of chain) {
      const b = seg.rev ? branches[seg.bi].slice().reverse() : branches[seg.bi];
      for (let i = cells.length === 0 ? 0 : 1; i < b.length; i++) cells.push(b[i]);
    }
    out.push(cells);
  }
  return out;
}

function pathLength(path, cols) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const ac = a % cols, ar = (a - ac) / cols;
    const bc = b % cols, br = (b - bc) / cols;
    len += Math.hypot(bc - ac, br - ar);
  }
  return len;
}

/**
 * 区域的骨架 / 山脊线 —— 沿山脉走向摆放皴法笔触用。
 *
 * ── 算法与取舍 ──────────────────────────────────────────────────────────────
 * 三种常见做法：
 *   (a) 距离变换的局部极大值：一步到位、快，但结果是**断裂的点云**，
 *       山脊会一段一段接不上，没法当「走向」用；
 *   (b) Voronoi / 中轴变换（精确 medial axis）：数学上最正确，但对栅格边界的
 *       阶梯噪声极敏感，会长出海量毛刺，且实现复杂、要处理大量退化情形；
 *   (c) 形态学细化（Zhang–Suen）：保持拓扑、结果天然是 1 格宽的**连通曲线**，
 *       实现短、可验证；代价见下。
 *
 * 这里选 (c)，再补三件事把 (c) 的短板补上：
 *   1. 用精确欧氏距离变换（Felzenszwalb & Huttenlocher，O(n)）给每个骨架点
 *      配一个「到边界的半径」，渲染时可据此缩放笔触大小 —— 这恰好是 (a) 的信息，
 *      但不用它来定位；
 *   2. 按「叶枝长度 < 岔口处的半径」剪枝，把边界阶梯噪声长出来的毛刺剪掉。
 *      剪枝只动「一端是端点、另一端是岔口」的叶枝，所以孤立的一整条链永远不会被剪没；
 *   3. 把剩下的骨架图按「最平直」在岔口处缝成尽量长的链（stitch）。
 *      不缝的话，一块带上百个洞的大山地会得到上千条几格长的图边，没法当「走向」用；
 *      缝完通常只剩几十条主脊。
 *
 * ── 已知代价（渲染层要心里有数）────────────────────────────────────────────
 *   · 骨架位置比真中轴有半格量级偏移 —— 对摆笔触无所谓。
 *   · Zhang–Suen 会把细长条的**两端各回缩约半个厚度**：21×5 的横条骨架只有 16 格长，
 *     不到条带两端。要让笔触画到山脉尖端，请把首尾各沿切线外推 ≈ radii[0] 格。
 *   · 缝合是贪心的，不保证全局最优；拐角阈值 maxTurnDeg 决定「宁可断也不硬拐」。
 *   · 区域有洞时骨架必然包含环（拓扑保持），此时链的 closed 为 true。
 *
 * @param {Iterable<number>|Uint8Array} cells 格索引集合或掩码
 * @param {number} cols
 * @param {number} rows
 * @param {object} [options]
 * @param {boolean} [options.borderIsOutside=true] 见 distanceTransform
 * @param {number}  [options.minBranchLength=3]  叶枝短于此长度（格）一律剪掉
 * @param {number}  [options.pruneRatio=1]       叶枝短于 pruneRatio × 岔口半径也剪掉
 * @param {number}  [options.pruneRounds=3]      剪枝轮数（剪完可能露出新的短叶枝）
 * @param {boolean} [options.stitch=true]        是否在岔口缝成长链；false 返回原始图边
 * @param {number}  [options.maxTurnDeg=60]      缝合允许的最大拐角（度）
 * @param {number}  [options.simplifyTolerance=0] >0 时对每条链做 DP 简化（开折线）
 * @param {number}  [options.smoothIterations=0]  >0 时对每条链做 Chaikin 平滑（开折线）
 * @returns {{
 *   chains: {points:[number,number][], radii:number[], length:number, closed:boolean}[],
 *   dist: Float64Array,
 *   skeleton: Uint8Array,
 *   cellCount: number
 * }}
 *   chains 按 length 降序。points 用**格心**坐标 (col+0.5, row+0.5)，与轮廓同一坐标系。
 *   radii[i] 是该点到区域边界的欧氏距离（格），可直接当笔触半径的比例因子，
 *   简化 / 平滑后 radii 与 points 严格等长同序。
 *   推荐配方：{ simplifyTolerance: 1, smoothIterations: 2 }，再按 length 取前 N 条画笔触。
 */
export function medialAxis(cells, cols, rows, options = {}) {
  const minBranchLength = options.minBranchLength ?? 3;
  const pruneRatio = options.pruneRatio ?? 1;
  const pruneRounds = options.pruneRounds ?? 3;
  const simplifyTolerance = options.simplifyTolerance ?? 0;
  const smoothIterations = options.smoothIterations ?? 0;
  const stitch = options.stitch !== false;
  const maxTurnDeg = options.maxTurnDeg ?? 60;

  const mask = toMask(cells, cols, rows);
  const dist = distanceTransform(mask, cols, rows, {
    borderIsOutside: options.borderIsOutside !== false,
  });

  const skel = zhangSuen(mask, cols, rows);

  // ── 剪枝 ─────────────────────────────────────────────────────────────────
  for (let round = 0; round < pruneRounds; round++) {
    const { branches, adj } = skelBranches(skel, cols, rows);
    if (branches.length <= 1) break;
    const doomed = [];
    for (const b of branches) {
      if (b.length < 2) continue;
      const a = b[0], z = b[b.length - 1];
      if (a === z) continue;                       // 环，不剪
      const degA = adj.get(a).length;
      const degZ = adj.get(z).length;
      let junction = -1;
      if (degA === 1 && degZ >= 3) junction = z;
      else if (degZ === 1 && degA >= 3) junction = a;
      else continue;                               // 两端都是端点 = 独立的一整条链，保留
      const len = pathLength(b, cols);
      const limit = Math.max(minBranchLength, pruneRatio * dist[junction]);
      if (len >= limit) continue;
      // 删掉除岔口以外的全部格
      for (let i = 0; i < b.length; i++) {
        if (b[i] === junction) continue;
        doomed.push(b[i]);
      }
    }
    if (doomed.length === 0) break;
    for (const i of doomed) skel[i] = 0;
  }

  // ── 出链 ─────────────────────────────────────────────────────────────────
  const raw = skelBranches(skel, cols, rows).branches;
  const branches = stitch ? stitchBranches(raw, cols, maxTurnDeg) : raw;
  const chains = [];
  for (const b of branches) {
    const closed = b.length > 2 && b[0] === b[b.length - 1];
    let points = b.map((idx) => {
      const c = idx % cols;
      const r = (idx - c) / cols;
      return [c + 0.5, r + 0.5];
    });
    let radii = b.map((idx) => dist[idx]);
    const length = pathLength(b, cols);

    // 简化 / 平滑时半径必须与点严格同步：简化用「保留下标」筛，
    // 平滑把半径当第三维走同一套 Chaikin 权重 —— 不做最近邻猜测。
    if (simplifyTolerance > 0 && points.length > 2) {
      const keep = dpKeepMask(points, simplifyTolerance);
      const p2 = [], r2 = [];
      for (let i = 0; i < points.length; i++) {
        if (keep[i]) { p2.push(points[i]); r2.push(radii[i]); }
      }
      points = p2; radii = r2;
    }
    if (smoothIterations > 0 && points.length > 2) {
      for (let it = 0; it < smoothIterations; it++) {
        const n = points.length;
        if (n < 2) break;
        const p2 = [points[0]], r2 = [radii[0]];
        for (let i = 0; i < n - 1; i++) {
          const a = points[i], b = points[i + 1];
          const ra = radii[i], rb = radii[i + 1];
          p2.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
          r2.push(ra * 0.75 + rb * 0.25);
          p2.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
          r2.push(ra * 0.25 + rb * 0.75);
        }
        p2.push(points[n - 1]); r2.push(radii[n - 1]);
        points = p2; radii = r2;
      }
    }

    chains.push({ points, radii, length, closed });
  }

  chains.sort((a, b) => (b.length - a.length) || (a.points.length - b.points.length));

  let cellCount = 0;
  for (let i = 0; i < skel.length; i++) if (skel[i]) cellCount++;

  return { chains, dist, skeleton: skel, cellCount };
}

/** medialAxis 的别名。 */
export { medialAxis as skeleton };

// ────────────────────────────────────────────────────────────────────────────
// 便捷组合：一步跑完 标记 → 描边 → 简化 → 平滑
// ────────────────────────────────────────────────────────────────────────────

/**
 * 渲染层的标准入口：把某类地形整理成一批可直接绘制的形状。
 *
 * @param {string|ArrayLike<any>} terrain
 * @param {number} cols
 * @param {number} rows
 * @param {Function|string|Array|Set} predicate
 * @param {object} [options]
 * @param {number} [options.minArea=1]
 * @param {number} [options.minHoleArea=0] 传给 traceContours
 * @param {number} [options.tolerance=1]   传给 simplify
 * @param {number} [options.smoothing=2]   传给 smooth 的迭代次数
 * @param {boolean}[options.withAxis=false] 是否同时算骨架（贵一点）
 * @param {object} [options.axisOptions]   透传给 medialAxis
 * @returns {{id:number, area:number, bbox:object, outer:[number,number][],
 *            holes:[number,number][][], path:string, axis?:object[]}[]}
 */
export function extractTerrainShapes(terrain, cols, rows, predicate, options = {}) {
  const tolerance = options.tolerance ?? 1;
  const smoothing = options.smoothing ?? 2;
  const regions = labelRegions(terrain, cols, rows, predicate, { minArea: options.minArea ?? 1 });
  return regions.map((region) => {
    const contour = traceContours(region.cells, cols, rows, { minHoleArea: options.minHoleArea ?? 0 });
    const outer = smooth(simplify(contour.outer, tolerance), smoothing);
    const holes = contour.holes.map((h) => smooth(simplify(h, tolerance), smoothing));
    const shape = {
      id: region.id,
      area: region.area,
      bbox: region.bbox,
      outer,
      holes,
      path: toPath([outer, ...holes]),
    };
    if (options.withAxis) {
      shape.axis = medialAxis(region.cells, cols, rows, {
        simplifyTolerance: 1,
        smoothIterations: 2,
        ...(options.axisOptions ?? {}),
      }).chains;
    }
    return shape;
  });
}
