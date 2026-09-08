import assert from "node:assert/strict";
import test from "node:test";
import { roll, rollInt, shuffle, keyString } from "../lib/game/engine/rng.ts";

const base = { seed: "xingping-194", year: 194, season: 1, faction: "caocao", event: "field", seq: 0 };

test("同一坐标必得同一数", () => {
  assert.equal(roll(base), roll({ ...base }));
});

test("任一维变化都改变结果", () => {
  const b = roll(base);
  for (const patch of [{ seed: "x" }, { year: 195 }, { season: 2 },
                       { faction: "yuanshao" }, { event: "siege" }, { seq: 1 }]) {
    assert.notEqual(roll({ ...base, ...patch }), b, `${JSON.stringify(patch)} 未改变结果`);
  }
});

test("值域落在 [0,1)", () => {
  for (let i = 0; i < 20000; i += 1) {
    const v = roll({ ...base, seq: i });
    assert.ok(v >= 0 && v < 1, `第 ${i} 次越界: ${v}`);
  }
});

test("分布大体均匀（十分位偏差 < 8%）", () => {
  const bins = new Array(10).fill(0);
  const N = 100000;
  for (let i = 0; i < N; i += 1) bins[Math.floor(roll({ ...base, seq: i }) * 10)] += 1;
  for (const [i, c] of bins.entries()) {
    const dev = Math.abs(c - N / 10) / (N / 10);
    assert.ok(dev < 0.08, `第 ${i} 桶偏差 ${(dev * 100).toFixed(1)}%`);
  }
});

test("取数与顺序无关——这是 R6 的地基", () => {
  // 正序取一遍，逆序再取一遍，逐位必须相同
  const forward = [], backward = [];
  for (let i = 0; i < 500; i += 1) forward.push(roll({ ...base, seq: i }));
  for (let i = 499; i >= 0; i -= 1) backward.unshift(roll({ ...base, seq: i }));
  assert.deepEqual(forward, backward);
});

test("rollInt 不越界且覆盖全域", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) {
    const v = rollInt({ ...base, seq: i }, 7);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 7);
    seen.add(v);
  }
  assert.equal(seen.size, 7, "未覆盖全部取值");
});

test("洗牌确定且为原集合的排列", () => {
  const src = Array.from({ length: 40 }, (_, i) => i);
  const k = { seed: "s", year: 194, season: 1, faction: "*", event: "recruit" };
  const a = shuffle(src, k), b = shuffle(src, k);
  assert.deepEqual(a, b, "同 key 洗牌结果不一致");
  assert.deepEqual([...a].sort((x, y) => x - y), src, "洗牌后元素集合改变");
  assert.notDeepEqual(a, src, "洗牌未生效");
});

test("keyString 无歧义：分隔符不被内容吞掉", () => {
  // 若用简单拼接，faction="a" event="b|c" 会与 faction="a|b" event="c" 撞车
  assert.notEqual(
    keyString({ ...base, faction: "a", event: "b|c" }),
    keyString({ ...base, faction: "a|b", event: "c" }),
  );
});

// ── 排序也是确定性的一部分 ───────────────────────────────────────────────
//
// R33 说「同种子 + 同命令 → 逐位一致的重放」。掷点这一半由 roll 保证，
// 另一半是**排序**：canonicalOrder 的命令归一、campaigns 的先后、sieges 的 seq、
// 候选表的排位——每一处都是结算的输入。
//
// 引擎原先各处用的是 String.prototype.localeCompare，不传 locale 时它取宿主的
// 默认地区。105 个郡国 id 在 en 下与码点序完全一致，在 zh / zh-CN 下**全部**换位。
// 实测：同种子、同机器人逻辑，只把宿主地区从 en 换成 zh，跑 12 季之后
// 135 个状态字段里 119 个分岔（河内郡守军一边 7378、一边 407）。
// 评测跑在 Node(en-US)，用户的浏览器是 zh-CN，两边根本不是同一局游戏。
//
// 这条测试把 localeCompare 篡改成病态实现（恒等、逆序）。引擎若还有一处在用它，
// 局面就会变——而现在应当一字不变。
test("排序不得依赖宿主地区：篡改 localeCompare 也不改变局面", async () => {
  const fs = await import("node:fs");
  const { buildGraph, DEFAULT_RULES } = await import("../lib/game/engine/actions.ts");
  const { decide } = await import("../lib/game/engine/bot.ts");
  const { buildRoster } = await import("../lib/game/engine/officers.ts");
  const { loadParams } = await import("../lib/game/engine/params.ts");
  const { createGame, refreshAp } = await import("../lib/game/engine/setup.ts");
  const { resolve } = await import("../lib/game/engine/resolve.ts");
  const { buildGeography } = await import("../lib/game/engine/victory.ts");

  const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
  const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
  const DATA = { commanderyState: read("commandery-state.json"), scenario: read("scenario-194.json"),
                 commanderies: read("commanderies.json"), troopTypes: read("troop-types.json"), resources: read("resources.json") };
  const G = buildGraph(read("adjacency.json"));
  const P = loadParams(pack);
  const ROSTER = buildRoster(read("officers.json"), read("officer-availability-194.json"),
    new Map(read("commanderies.json").map((c) => [c.name, c.id])));
  const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
  const BOTS = ["turtle", "balanced", "aggressive", "opportunist"];

  const play = () => {
    let s = createGame(DATA, { seed: "locale", roster: ROSTER, geo: GEO, graph: G, seasons: 8 }, P);
    while (!s.finished) {
      const orders = [];
      for (const [i, f] of Object.keys(s.factions).sort().entries()) {
        if (s.factions[f].eliminated || s.factions[f].retired) continue;
        orders.push(...decide(s, f, G, BOTS[i % 4], DEFAULT_RULES, ROSTER, P, GEO));
      }
      const r = resolve(s, orders, G, P, ROSTER, GEO, DEFAULT_RULES);
      s = r.state.finished ? r.state : refreshAp(r.state, P);
    }
    return JSON.stringify(Object.fromEntries(Object.entries(s.commanderies)
      .map(([id, c]) => [id, [c.owner, c.garrison, c.defense, c.gear, c.formation, c.moraleTier]])));
  };

  const orig = String.prototype.localeCompare;
  const base = play();
  try {
    // 恒等：一切并列，任何还在用它的排序都会退化成数组顺序
    String.prototype.localeCompare = function () { return 0; };
    assert.equal(play(), base, "有排序在用 localeCompare —— 把它换成 lib/game/engine/cmp.ts 的 cmp");
    // 逆序：比恒等更狠，能抓住「并列时恰好不影响」的漏网之鱼
    String.prototype.localeCompare = function (that) {
      const a = String(this), b = String(that);
      return a < b ? 1 : a > b ? -1 : 0;
    };
    assert.equal(play(), base, "有排序在用 localeCompare —— 把它换成 lib/game/engine/cmp.ts 的 cmp");
  } finally {
    String.prototype.localeCompare = orig;
  }
});

test("引擎源码里不得再出现 localeCompare", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
      if (!/\.(ts|tsx|mjs)$/.test(e.name)) continue;
      if (p.endsWith("cmp.ts")) continue;          // 那里只在注释里讲为什么不用它
      const src = fs.readFileSync(p, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
      if (/\.localeCompare\s*\(/.test(src)) bad.push(p);
    }
  };
  for (const d of ["lib", "app", "tools"]) walk(d);
  assert.deepEqual(bad, [], `这些文件在用 localeCompare（结果随宿主地区而变）：\n  ${bad.join("\n  ")}`);
});
