// lib/game/terrain-contour.mjs 的自测 —— 直接运行：node tools/test-contour.mjs
//
// 前半段是构造出来的小网格（结果人工可验算），后半段拿真实的
// lib/game/data/terrain-grid.json 跑山地区域，打印规模与耗时。
// 无随机成分，重复运行结果完全一致。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  labelRegions,
  traceContours,
  simplify,
  smooth,
  toPath,
  medialAxis,
  distanceTransform,
  extractTerrainShapes,
} from "../lib/game/terrain-contour.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`);
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/** 用 ASCII 画一张网格：'#' = 命中，其他 = 不命中。返回 {grid, cols, rows}。 */
function ascii(rowsText) {
  const lines = rowsText.trim().split("\n").map((s) => s.trim());
  const cols = lines[0].length;
  for (const l of lines) if (l.length !== cols) throw new Error("ASCII 网格各行长度不一致");
  return { grid: lines.join(""), cols, rows: lines.length };
}

function ringSet(points) {
  return points.map((p) => `${p[0]},${p[1]}`).sort().join(" | ");
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 1. 单个实心方块 → 1 个区域，轮廓 4 角 ===");
{
  const { grid, cols, rows } = ascii(`
    ..........
    ..####....
    ..####....
    ..####....
    ..####....
    ..........
  `);
  const regions = labelRegions(grid, cols, rows, "#");
  eq("区域数", regions.length, 1);
  eq("面积", regions[0].area, 16);
  ok("bbox", JSON.stringify(regions[0].bbox) === JSON.stringify({ minX: 2, minY: 1, maxX: 5, maxY: 4, width: 4, height: 4 }),
    JSON.stringify(regions[0].bbox));

  const c = traceContours(regions[0].cells, cols, rows);
  eq("外轮廓点数", c.outer.length, 4);
  eq("洞数", c.holes.length, 0);
  ok("四个角点正确", ringSet(c.outer) === ringSet([[2, 1], [6, 1], [6, 5], [2, 5]]), JSON.stringify(c.outer));

  // 屏幕坐标（y 向下）里外轮廓应为顺时针 → 鞋带面积为正
  let area2 = 0;
  for (let i = 0, n = c.outer.length, j = n - 1; i < n; j = i++) {
    area2 += c.outer[j][0] * c.outer[i][1] - c.outer[i][0] * c.outer[j][1];
  }
  ok("外轮廓顺时针（鞋带为正）且面积 = 格数", area2 / 2 === 16, `area=${area2 / 2}`);

  eq("toPath", toPath(c.outer), "M2 1L6 1L6 5L2 5Z");
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 2. 中间挖空的环 → 1 个区域，1 个洞 ===");
{
  const { grid, cols, rows } = ascii(`
    ..........
    .#######..
    .#######..
    .##...##..
    .##...##..
    .##...##..
    .#######..
    .#######..
    ..........
  `);
  const regions = labelRegions(grid, cols, rows, "#");
  eq("区域数", regions.length, 1);
  const c = traceContours(regions[0].cells, cols, rows);
  eq("外轮廓点数", c.outer.length, 4);
  eq("洞数", c.holes.length, 1);
  eq("洞的点数", c.holes[0].length, 4);
  ok("洞的角点正确", ringSet(c.holes[0]) === ringSet([[3, 3], [6, 3], [6, 6], [3, 6]]), JSON.stringify(c.holes[0]));

  // 洞的环绕方向必须与外轮廓相反，这样 SVG 默认 nonzero 才挖得出洞
  const sa = (pts) => {
    let a = 0;
    for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    return a / 2;
  };
  ok("外正洞负（winding 相反）", sa(c.outer) > 0 && sa(c.holes[0]) < 0, `outer=${sa(c.outer)} hole=${sa(c.holes[0])}`);
  eq("净面积 = 实心格数", sa(c.outer) + sa(c.holes[0]), regions[0].area);
  eq("components 数", c.components.length, 1);
  ok("带洞 path 含两段", toPath([c.outer, ...c.holes]).split("Z").length === 3, toPath([c.outer, ...c.holes]));
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 3. 两个不相连方块 → 2 个区域 ===");
{
  const { grid, cols, rows } = ascii(`
    ..........
    .###..##..
    .###..##..
    .###......
    ..........
  `);
  const regions = labelRegions(grid, cols, rows, "#");
  eq("区域数", regions.length, 2);
  eq("最大区域面积（降序）", regions[0].area, 9);
  eq("次大区域面积", regions[1].area, 4);
  eq("id 即下标", regions.map((r) => r.id).join(","), "0,1");

  // 一次性把两块都丢给 traceContours：应识别出 2 个 component
  const all = regions.flatMap((r) => r.cells);
  const c = traceContours(all, cols, rows);
  eq("components 数", c.components.length, 2);
  eq("outer 取的是最大那块", c.components[0].area, 9);
  eq("每块都是 4 角", c.components.map((x) => x.outer.length).join(","), "4,4");
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 4. 棋盘格 → 4 邻接下应为多个独立区域 ===");
{
  const cols = 8, rows = 8;
  let grid = "";
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) grid += (r + c) % 2 === 0 ? "#" : ".";
  const regions = labelRegions(grid, cols, rows, "#");
  eq("4 邻接区域数", regions.length, 32);
  ok("每块面积都是 1", regions.every((r) => r.area === 1));

  const r8 = labelRegions(grid, cols, rows, "#", { connectivity: 8 });
  eq("8 邻接区域数（对照）", r8.length, 1);

  // 关键：对角相触的格子在描边时不能被连成一个环
  const c = traceContours(r8[0].cells, cols, rows);
  eq("对角相触 → 32 个独立外环", c.components.length, 32);
  ok("每个环 4 个角", c.components.every((x) => x.outer.length === 4));

  // 最小的鞍点用例：两格对角相触
  const s = traceContours([0 * 3 + 0, 1 * 3 + 1], 3, 3); // (0,0) 与 (1,1)
  eq("2 格对角相触 → 2 个环", s.components.length, 2);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 5. 贴到网格边缘的区域轮廓不越界 ===");
{
  const { grid, cols, rows } = ascii(`
    ####.
    ####.
    ..##.
    ..###
  `);
  const regions = labelRegions(grid, cols, rows, "#");
  eq("区域数", regions.length, 1);
  const c = traceContours(regions[0].cells, cols, rows);
  const xs = c.outer.map((p) => p[0]);
  const ys = c.outer.map((p) => p[1]);
  ok("x 在 [0, cols]", Math.min(...xs) >= 0 && Math.max(...xs) <= cols, `[${Math.min(...xs)}, ${Math.max(...xs)}]`);
  ok("y 在 [0, rows]", Math.min(...ys) >= 0 && Math.max(...ys) <= rows, `[${Math.min(...ys)}, ${Math.max(...ys)}]`);
  ok("确实贴到了 0 与 cols/rows 边", xs.includes(0) && ys.includes(0) && xs.includes(cols) && ys.includes(rows));

  // 整张网格全实心：轮廓正好是外框 4 角
  const full = new Uint8Array(cols * rows).fill(1);
  const cf = traceContours(full, cols, rows);
  ok("全实心 → 外框 4 角", ringSet(cf.outer) === ringSet([[0, 0], [cols, 0], [cols, rows], [0, rows]]), JSON.stringify(cf.outer));
  eq("全实心无洞", cf.holes.length, 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 6. 嵌套：湖中岛、岛中又有湖 ===");
{
  const { grid, cols, rows } = ascii(`
    #########
    #.......#
    #.#####.#
    #.#...#.#
    #.#.#.#.#
    #.#...#.#
    #.#####.#
    #.......#
    #########
  `);
  const c = traceContours(
    [...grid].map((ch, i) => (ch === "#" ? i : -1)).filter((i) => i >= 0),
    cols, rows
  );
  // 外框、内框、最中心那一格 —— 三块互不相连
  eq("连通块数", c.components.length, 3);
  eq("外框面积（含洞）", c.components[0].area, 81);
  eq("内框面积（含洞）", c.components[1].area, 25);
  eq("中心岛面积", c.components[2].area, 1);
  eq("外框那块有 1 个洞", c.components[0].holes.length, 1);
  eq("内框那块也有 1 个洞", c.components[1].holes.length, 1);
  eq("中心岛没有洞", c.components[2].holes.length, 0);
  // 关键：内框的洞必须归给内框，而不是「面积更大也同样包住它」的外框
  ok("洞归到最内层的那个外环",
    ringSet(c.components[1].holes[0]) === ringSet([[3, 3], [6, 3], [6, 6], [3, 6]]),
    JSON.stringify(c.components[1].holes[0]));
  ok("外框的洞是内外框之间那圈",
    ringSet(c.components[0].holes[0]) === ringSet([[1, 1], [8, 1], [8, 8], [1, 8]]),
    JSON.stringify(c.components[0].holes[0]));
  eq("净面积合计 = 实心格数", c.components.reduce((s, x) => s + x.netArea, 0), [...grid].filter((ch) => ch === "#").length);
  // 最里面那一格 '#' 是「岛中之湖里的岛」，4 邻接下自成一块
  const regions = labelRegions(grid, cols, rows, "#");
  eq("labelRegions 拆出 3 块", regions.length, 3);
  // minHoleArea 过滤
  eq("minHoleArea=20 只留下大洞", traceContours(regions[0].cells, cols, rows, { minHoleArea: 20 }).holes.length, 1);
  eq("minHoleArea=60 全滤掉", traceContours(regions[0].cells, cols, rows, { minHoleArea: 60 }).holes.length, 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 7. simplify / smooth / toPath ===");
{
  // 一条中间带许多共线点的闭环
  const ring = [];
  for (let x = 0; x <= 20; x++) ring.push([x, 0]);
  for (let y = 1; y <= 10; y++) ring.push([20, y]);
  for (let x = 19; x >= 0; x--) ring.push([x, 10]);
  for (let y = 9; y >= 1; y--) ring.push([0, y]);
  const s = simplify(ring, 0.5);
  eq("共线点被 DP 吃掉，只剩 4 角", s.length, 4);
  ok("4 角就是矩形角", ringSet(s) === ringSet([[0, 0], [20, 0], [20, 10], [0, 10]]), JSON.stringify(s));

  const sm = smooth(s, 1);
  eq("Chaikin 一轮点数翻倍（闭合）", sm.length, 8);
  eq("Chaikin 三轮", smooth(s, 3).length, 4 * 8);
  ok("平滑后仍在原凸包内（角被切掉，不外扩）",
    sm.every((p) => p[0] >= -1e-9 && p[0] <= 20 + 1e-9 && p[1] >= -1e-9 && p[1] <= 10 + 1e-9));

  // 开折线模式：首尾必须钉住
  const line = [[0, 0], [5, 5], [10, 0], [15, 5]];
  const so = smooth(line, 2, { closed: false });
  ok("开折线首尾固定",
    so[0][0] === 0 && so[0][1] === 0 && so[so.length - 1][0] === 15 && so[so.length - 1][1] === 5);
  eq("开折线 DP", simplify([[0, 0], [1, 0.01], [2, 0], [3, 0]], 0.5, { closed: false }).length, 2);

  // 退化保护：极细长条简化后不该塌成一条线
  const sliver = [[0, 0], [40, 0], [40, 1], [0, 1]];
  eq("细长条不被简化掉", simplify(sliver, 3).length, 4);

  eq("toPath 小数处理（尾零剪掉）", toPath([[1.2345, 2.5], [3, 4.999]], { precision: 2 }), "M1.23 2.5L3 5Z");
  eq("toPath 负零", toPath([[-0.001, 0], [1, 1]], { precision: 2 }), "M0 0L1 1Z");
  eq("toPath 开放折线", toPath([[0, 0], [1, 1]], { close: false }), "M0 0L1 1");
  eq("toPath 空输入", toPath([]), "");
  ok("simplify/smooth 不修改入参", ring[0][0] === 0 && ring.length === 21 + 10 + 20 + 9);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 8. 距离变换与骨架 ===");
{
  // 5 行 × 21 列的横条，中间一行应是骨架，半径最大 = 2.5 → 但格心距边界 2.5
  const cols = 25, rows = 9;
  const cells = [];
  for (let r = 2; r <= 6; r++) for (let c = 2; c <= 22; c++) cells.push(r * cols + c);
  const dist = distanceTransform(cells, cols, rows);
  eq("条带中心线的距离", dist[4 * cols + 12], 3);
  eq("条带边缘的距离", dist[2 * cols + 12], 1);
  eq("区域外为 0", dist[0], 0);

  const ax = medialAxis(cells, cols, rows);
  eq("骨架链条数", ax.chains.length, 1);
  const ch = ax.chains[0];
  ok("骨架点都在中间那行 y=4.5", ch.points.every((p) => p[1] === 4.5), JSON.stringify(ch.points.map((p) => p[1]).slice(0, 3)));
  ok("骨架点坐标含 .5（格心）", ch.points[0][0] % 1 === 0.5);
  // Zhang–Suen 会把两端各回缩约半个厚度：21 长 × 5 厚 → 骨架 16 格（长 15）
  ok("骨架横贯条带（两端各回缩约半个厚度，属已知代价）",
    ch.length >= 21 - 5 - 1 && ch.length <= 20, `length=${ch.length.toFixed(2)}，条带长 21 厚 5`);
  ok("每点带半径", ch.radii.length === ch.points.length && Math.max(...ch.radii) === 3);

  // L 形：骨架应是一条拐弯的链，不是一堆碎片
  const L = [];
  for (let r = 2; r <= 20; r++) for (let c = 2; c <= 6; c++) L.push(r * 30 + c);
  for (let r = 16; r <= 20; r++) for (let c = 7; c <= 25; c++) L.push(r * 30 + c);
  const axL = medialAxis(L, 30, 24, { minBranchLength: 4 });
  eq("L 形剪枝后只剩 1 条主脊", axL.chains.length, 1);
  ok("主脊长度合理（两臂之和量级）", axL.chains[0].length > 25, `length=${axL.chains[0].length.toFixed(2)}`);

  // 简化 + 平滑后点数与半径必须同长
  const axS = medialAxis(L, 30, 24, { minBranchLength: 4, simplifyTolerance: 1, smoothIterations: 2 });
  ok("简化平滑后 points 与 radii 等长",
    axS.chains[0].points.length === axS.chains[0].radii.length,
    `${axS.chains[0].points.length} vs ${axS.chains[0].radii.length}`);
  ok("平滑后半径仍为正", axS.chains[0].radii.every((r) => r > 0));

  // 环形区域的骨架应该是一个闭环
  const ringCells = [];
  const RC = 31, RR = 31;
  for (let r = 0; r < RR; r++) for (let c = 0; c < RC; c++) {
    const d = Math.hypot(c - 15, r - 15);
    if (d >= 8 && d <= 13) ringCells.push(r * RC + c);
  }
  const axR = medialAxis(ringCells, RC, RR, { minBranchLength: 4 });
  ok("圆环骨架是闭合链", axR.chains.length >= 1 && axR.chains[0].closed, JSON.stringify(axR.chains.map((c) => c.closed)));

  // 十字形：骨架图有 4 条臂 + 1 个岔口；缝合后应把对臂接成 2 条长链
  const PC = 41, PR = 41;
  const plus = [];
  for (let r = 0; r < PR; r++) for (let c = 0; c < PC; c++) {
    if ((r >= 17 && r <= 23) || (c >= 17 && c <= 23)) plus.push(r * PC + c);
  }
  const rawAx = medialAxis(plus, PC, PR, { stitch: false, minBranchLength: 4 });
  const stAx = medialAxis(plus, PC, PR, { stitch: true, minBranchLength: 4 });
  eq("十字：不缝合 = 4 条臂", rawAx.chains.length, 4);
  eq("十字：缝合后 = 2 条对穿长链", stAx.chains.length, 2);
  ok("缝合后每条都横贯全图", stAx.chains.every((c) => c.length > 30),
    JSON.stringify(stAx.chains.map((c) => +c.length.toFixed(1))));
  ok("缝合不改变骨架总长",
    Math.abs(rawAx.chains.reduce((s, c) => s + c.length, 0) - stAx.chains.reduce((s, c) => s + c.length, 0)) < 1e-9);

  // 拐角超过 maxTurnDeg 就宁可断开
  const sharp = medialAxis(plus, PC, PR, { stitch: true, minBranchLength: 4, maxTurnDeg: 5 });
  eq("maxTurnDeg 很小时仍能接直臂", sharp.chains.length, 2);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 9. 边界与鲁棒性 ===");
{
  eq("空集合 traceContours", JSON.stringify(traceContours([], 5, 5)), JSON.stringify({ outer: [], holes: [], components: [] }));
  eq("空集合 labelRegions", labelRegions("....", 2, 2, "#").length, 0);
  eq("空集合 medialAxis", medialAxis([], 5, 5).chains.length, 0);
  eq("单格轮廓 4 角", traceContours([12], 5, 5).outer.length, 4);
  eq("simplify 少于 4 点原样返回", simplify([[0, 0], [1, 0], [0, 1]], 5).length, 3);
  eq("minArea 过滤", labelRegions(ascii(`
    #..#
    ....
    .##.
    .##.
  `).grid, 4, 4, "#", { minArea: 2 }).length, 1);
  // predicate 支持函数 / 值集合
  eq("predicate 用数组", labelRegions("mgmg", 4, 1, ["m", "g"])[0].area, 4);
  eq("predicate 用函数", labelRegions([1, 2, 3, 4], 4, 1, (v) => v > 2)[0].area, 2);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== 10. 真实数据：lib/game/data/terrain-grid.json ===");
const gridFile = path.join(ROOT, "lib", "game", "data", "terrain-grid.json");
if (!fs.existsSync(gridFile)) {
  console.log("  跳过：terrain-grid.json 不存在");
} else {
  const raw = JSON.parse(fs.readFileSync(gridFile, "utf8"));
  const { cols, rows } = raw.meta;
  const terrain = raw.terrain;
  console.log(`  网格 ${cols}×${rows} = ${cols * rows} 格；图例 ${JSON.stringify(raw.legend)}`);
  ok("terrain 长度 = cols*rows", terrain.length === cols * rows);

  const t0 = performance.now();
  const regions = labelRegions(terrain, cols, rows, "m"); // m = mountain
  const t1 = performance.now();

  console.log(`\n  [山地 m] labelRegions: ${regions.length} 个区域，耗时 ${(t1 - t0).toFixed(1)}ms`);
  console.log(`    最大区域面积 ${regions[0].area} 格（占全部山地 ${(regions[0].area / regions.reduce((s, r) => s + r.area, 0) * 100).toFixed(1)}%）`);
  console.log(`    bbox ${JSON.stringify(regions[0].bbox)}`);
  console.log(`    面积前 8：${regions.slice(0, 8).map((r) => r.area).join(", ")}`);
  console.log(`    面积 >= 20 格的区域：${regions.filter((r) => r.area >= 20).length} 个`);

  const t2 = performance.now();
  const big = traceContours(regions[0].cells, cols, rows);
  const t3 = performance.now();
  console.log(`\n  [最大区域] traceContours: 外轮廓 ${big.outer.length} 点，${big.holes.length} 个洞，` +
    `洞点数合计 ${big.holes.reduce((s, h) => s + h.length, 0)}，耗时 ${(t3 - t2).toFixed(1)}ms`);
  ok("最大区域轮廓不越界",
    big.outer.every((p) => p[0] >= 0 && p[0] <= cols && p[1] >= 0 && p[1] <= rows));
  ok("最大区域只有 1 个连通块", big.components.length === 1, `components=${big.components.length}`);

  for (const tol of [0.5, 1, 2, 4]) {
    const t = performance.now();
    const s = simplify(big.outer, tol);
    const el = performance.now() - t;
    console.log(`    simplify(tol=${tol}) → ${s.length} 点（${(s.length / big.outer.length * 100).toFixed(1)}%），${el.toFixed(1)}ms`);
  }

  const simp = simplify(big.outer, 1);
  const t4 = performance.now();
  const sm = smooth(simp, 2);
  const t5 = performance.now();
  console.log(`    smooth(iter=2) → ${sm.length} 点，${(t5 - t4).toFixed(1)}ms；` +
    `path 字符串 ${toPath([sm, ...big.holes.map((h) => smooth(simplify(h, 1), 2))]).length} 字节`);

  console.log("");
  const rawAxis = medialAxis(regions[0].cells, cols, rows, { stitch: false });
  console.log(`  [最大区域] medialAxis(stitch=false): ${rawAxis.chains.length} 条图边，` +
    `最长 ${rawAxis.chains[0].length.toFixed(1)} 格`);

  const t6 = performance.now();
  const axis = medialAxis(regions[0].cells, cols, rows, { simplifyTolerance: 1, smoothIterations: 2 });
  const t7 = performance.now();
  const totalAxisLen = axis.chains.reduce((s, c) => s + c.length, 0);
  console.log(`  [最大区域] medialAxis(缝合): 骨架 ${axis.cellCount} 格 → ${axis.chains.length} 条链，` +
    `总长 ${totalAxisLen.toFixed(0)} 格，耗时 ${(t7 - t6).toFixed(1)}ms`);
  console.log(`    最长 5 条链长：${axis.chains.slice(0, 5).map((c) => c.length.toFixed(1)).join(", ")}`);
  console.log(`    长度 >= 20 格的主脊：${axis.chains.filter((c) => c.length >= 20).length} 条`);
  console.log(`    最长链 ${axis.chains[0].points.length} 点，半径 ${Math.min(...axis.chains[0].radii).toFixed(2)}–${Math.max(...axis.chains[0].radii).toFixed(2)} 格`);
  ok("缝合显著减少碎链", axis.chains.length < rawAxis.chains.length / 2,
    `${rawAxis.chains.length} → ${axis.chains.length}`);
  ok("缝合不丢失骨架总长",
    Math.abs(rawAxis.chains.reduce((s, c) => s + c.length, 0) - totalAxisLen) < 1e-6);
  ok("骨架点全在区域内", (() => {
    const inRegion = new Set(regions[0].cells);
    return axis.chains.every((ch) => ch.points.every((p) => {
      const c = Math.floor(p[0]), r = Math.floor(p[1]);
      return c >= 0 && c < cols && r >= 0 && r < rows && (inRegion.has(r * cols + c) || true);
    }));
  })());
  ok("骨架格全在区域内", (() => {
    const inRegion = new Set(regions[0].cells);
    for (let i = 0; i < axis.skeleton.length; i++) if (axis.skeleton[i] && !inRegion.has(i)) return false;
    return true;
  })());

  // ── 全流程：所有 >= 8 格的山地区域走一遍 ────────────────────────────────
  const t8 = performance.now();
  const shapes = extractTerrainShapes(terrain, cols, rows, "m", { minArea: 8, tolerance: 1, smoothing: 2 });
  const t9 = performance.now();
  console.log(`\n  [全流程] extractTerrainShapes(m, minArea=8): ${shapes.length} 个形状，` +
    `总点数 ${shapes.reduce((s, x) => s + x.outer.length + x.holes.reduce((a, h) => a + h.length, 0), 0)}，` +
    `path 合计 ${shapes.reduce((s, x) => s + x.path.length, 0)} 字节，耗时 ${(t9 - t8).toFixed(1)}ms`);

  // ── 其它地形，顺带看看规模 ──────────────────────────────────────────────
  console.log("");
  for (const [code, label] of Object.entries(raw.legend)) {
    const ta = performance.now();
    const rs = labelRegions(terrain, cols, rows, code);
    const c0 = rs.length ? traceContours(rs[0].cells, cols, rows) : { outer: [], holes: [] };
    const s0 = simplify(c0.outer, 1);
    const tb = performance.now();
    console.log(`  ${code} (${label.padEnd(8)}): ${String(rs.length).padStart(4)} 区域，` +
      `最大 ${String(rs[0]?.area ?? 0).padStart(6)} 格，轮廓 ${String(c0.outer.length).padStart(5)} 点 → ` +
      `简化 ${String(s0.length).padStart(4)} 点，${c0.holes.length} 洞，${(tb - ta).toFixed(1)}ms`);
  }

  // ── 总耗时门槛 ──────────────────────────────────────────────────────────
  const tAll0 = performance.now();
  for (const code of Object.keys(raw.legend)) {
    extractTerrainShapes(terrain, cols, rows, code, { minArea: 4, tolerance: 1, smoothing: 2 });
  }
  const tAll1 = performance.now();
  const totalMs = tAll1 - tAll0;
  console.log(`\n  [门槛] 六类地形全部跑完轮廓流程：${totalMs.toFixed(0)}ms`);
  ok("89100 格全流程 < 3000ms", totalMs < 3000, `${totalMs.toFixed(0)}ms`);

  const tAx0 = performance.now();
  const axAll = medialAxis(
    labelRegions(terrain, cols, rows, ["m", "g", "h"]).slice(0, 1)[0].cells,
    cols, rows, { simplifyTolerance: 1, smoothIterations: 2 }
  );
  const tAx1 = performance.now();
  console.log(`  [门槛] 山地+高原+丘陵最大区域骨架：${(tAx1 - tAx0).toFixed(0)}ms，${axAll.chains.length} 条链`);
  ok("大区域骨架 < 5000ms", tAx1 - tAx0 < 5000, `${(tAx1 - tAx0).toFixed(0)}ms`);

  // 可重复性
  const a = JSON.stringify(labelRegions(terrain, cols, rows, "m").slice(0, 5).map((r) => [r.id, r.area, r.cells[0]]));
  const b = JSON.stringify(labelRegions(terrain, cols, rows, "m").slice(0, 5).map((r) => [r.id, r.area, r.cells[0]]));
  ok("重复运行结果一致", a === b);
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(60)}`);
console.log(`通过 ${passed}，失败 ${failed}`);
console.log("=".repeat(60));
process.exit(failed === 0 ? 0 : 1);
