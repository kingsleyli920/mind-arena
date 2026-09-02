import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { buildGraph, listActions, validate, canonicalOrder } from "../lib/game/engine/actions.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { resolve, supplyReach } from "../lib/game/engine/resolve.ts";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const DATA = {
  commanderyState: read("commandery-state.json"),
  scenario: read("scenario-194.json"),
  commanderies: read("commanderies.json"),
};
const G = buildGraph(read("adjacency.json"));
// 引擎参数唯一来源是内容包，测试也走同一条路径
const P = loadParams(JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8")));
const fresh = (seed = "t-001") => createGame(DATA, { seed }, P);


test("开局状态自洽", () => {
  const s = fresh();
  assert.equal(Object.keys(s.commanderies).length, 105);
  assert.ok(Object.keys(s.factions).length > 20);
  for (const f of Object.values(s.factions)) {
    assert.ok(f.ap >= 5 && f.ap <= 14, `${f.id} 令数 ${f.ap} 越界`);
    if (!f.eliminated) assert.ok(f.capital, `${f.id} 无治所`);
  }
});

test("候选可枚举：任一势力都落在 O(10)–O(10²)", () => {
  const s = fresh();
  for (const id of Object.keys(s.factions)) {
    const n = listActions(s, id, G).length;
    assert.ok(n <= 60, `${id} 候选 ${n} 条，超过上限`);
  }
});

test("候选列表对同一状态是稳定的", () => {
  const s = fresh();
  const a = listActions(s, "yuanshao", G).map((c) => c.key);
  const b = listActions(fresh(), "yuanshao", G).map((c) => c.key);
  assert.deepEqual(a, b);
});

test("非法命令被拒：越界、非邻接、非己方", () => {
  const s = fresh();
  const cases = [
    [{ faction: "caocao", action: { type: "campaign", from: "魏郡", target: "东郡",
        commander: null, strength: "main", siegeGear: "none" } }, "起点非己方"],
    [{ faction: "caocao", action: { type: "campaign", from: "济阴郡", target: "蜀郡",
        commander: null, strength: "main", siegeGear: "none" } }, "非邻接"],
    [{ faction: "caocao", action: { type: "govern", at: "蜀郡", policy: "farm" } }, "非己方郡"],
    [{ faction: "caocao", action: { type: "ally", to: "caocao", act: "form", term: 8 } }, "与自己缔盟"],
  ];
  for (const [order, why] of cases) {
    assert.ok(validate(s, order, G), `应拒绝：${why}`);
  }
});

test("canonicalOrder 把任意顺序归一到同一序列", () => {
  const mk = (f, type) => ({ faction: f, action: { type, at: "x", policy: "farm" } });
  const src = [mk("b", "campaign"), mk("a", "scout"), mk("b", "govern"), mk("a", "campaign")];
  const a = canonicalOrder(src);
  const b = canonicalOrder([...src].reverse());
  assert.deepEqual(a, b, "同一集合的不同排列未归一到同一序列");
  // 阶段序：观测 → 内政 → 征伐
  assert.equal(a[0].action.type, "scout");
  assert.equal(a.at(-1).action.type, "campaign");
});

test("R6 裁决顺序不影响结果 —— 命令列表打乱后逐位相同", () => {
  const s = fresh();
  const orders = sampleOrders(s, ["caocao", "yuanshao", "liubiao", "lubu", "liuzhang"]);
  assert.ok(orders.length >= 12, "样本太少，测不出顺序无关性");
  assert.ok(orders.some((o) => o.action.type === "campaign"), "命令集中无征伐，测不到冲突裁决");

  const base = resolve(s, orders, G, P).state;
  // 用确定性洗牌产生若干个不同排列，逐一比对
  for (let k = 1; k <= 6; k += 1) {
    const shuffled = [...orders];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = (i * 7919 + k * 104729) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    assert.notDeepEqual(shuffled.map((o) => o.action.type), orders.map((o) => o.action.type),
      `第 ${k} 个排列与原序相同，未真正打乱`);
    const got = resolve(s, shuffled, G, P).state;
    assert.deepEqual(got, base, `第 ${k} 个排列结果不同 —— R6 失守`);
  }
});

test("R33 同 seed 同命令必得逐位相同的结果", () => {
  const run = () => {
    let s = fresh("replay-seed");
    for (let t = 0; t < 5; t += 1) {
      s = refreshAp(resolve(s, sampleOrders(s, ["caocao", "yuanshao", "lubu"]), G, P).state, P);
    }
    return s;
  };
  assert.deepEqual(run(), run());
});

// 候选按 key 字母序排，"ally:" 恒在 "campaign:" 之前。
// 若测试 AI 只取前 N 条，它就永远只缔盟不打仗，seed 影响不到轨迹。
// 这里改为每类动作各取一条，确保征伐一定进入命令集。
function sampleOrders(s, factions) {
  const orders = [];
  for (const f of factions) {
    const cands = listActions(s, f, G);
    const byType = new Map();
    for (const c of cands) if (!byType.has(c.action.type)) byType.set(c.action.type, c);
    for (const c of byType.values()) orders.push({ faction: f, action: c.action });
  }
  return orders;
}

test("不同 seed 产生不同轨迹", () => {
  const run = (seed) => {
    let s = fresh(seed);
    for (let t = 0; t < 8; t += 1) {
      s = refreshAp(resolve(s, sampleOrders(s, Object.keys(s.factions)), G, P).state, P);
    }
    return JSON.stringify(s.log.filter((e) => e.kind.startsWith("siege")).map((e) => e.text));
  };
  const a = run("aaa"), b = run("bbb");
  assert.ok(JSON.parse(a).length > 0, "整局没有一次攻城，测不出 seed 影响");
  assert.notEqual(a, b);
});

test("令数被正确扣减且不透支", () => {
  const s = fresh();
  const cands = listActions(s, "yuanshao", G);
  const orders = cands.map((c) => ({ faction: "yuanshao", action: c.action }));
  const { state, rejected } = resolve(s, orders, G, P);
  assert.ok(state.factions.yuanshao.ap >= 0, "令数透支");
  assert.ok(rejected.length > 0, "全部候选都被接受，说明令数上限没起作用");
  assert.ok(rejected.some((r) => r.reason.includes("令数不足")), "拒绝理由中没有令数不足");
});

test("补给连通：治所失守则全境断供", () => {
  const s = fresh();
  const before = supplyReach(s, G, "yuanshao");
  assert.ok(before.size > 1, "袁绍开局应有连通疆域");
  const cap = s.factions.yuanshao.capital;
  s.commanderies[cap].owner = "caocao";
  assert.equal(supplyReach(s, G, "yuanshao").size, 0, "治所易主后应全境断供");
});

test("归隐：弃治所外全部郡国且不可再动", () => {
  const s = fresh();
  const f = "yuanshao";
  const before = Object.values(s.commanderies).filter((c) => c.owner === f).length;
  const { state } = resolve(s, [{ faction: f, action: { type: "retire" } }], G, P);
  const after = Object.values(state.commanderies).filter((c) => c.owner === f).length;
  assert.equal(after, 1, `归隐后应只剩治所，实为 ${after}（原 ${before}）`);
  assert.ok(state.factions[f].retired);
  assert.equal(listActions(state, f, G).length, 0, "归隐后仍有候选");
});

test("一局 16 季后自动结束", () => {
  let s = fresh();
  for (let t = 0; t < P.seasonsPerGame; t += 1) s = refreshAp(resolve(s, [], G, P).state, P);
  assert.ok(s.finished, "16 季后未结束");
  assert.equal(s.turn, P.seasonsPerGame);
});

// 「规则即数据」若只是口号，引擎就会在包和硬编码之间漂移，
// 模型按包里的公式算、引擎按另一套结算，评测立刻失效。
// 这条测试用极端参数逼出行为差异，防止将来有人把常数写回引擎。
test("规则即数据：改内容包必须改变引擎行为", () => {
  const play = (params, turns = 4) => {
    let s = fresh("param-probe");
    for (let t = 0; t < turns && !s.finished; t += 1) {
      const orders = sampleOrders(s, Object.keys(s.factions));
      s = refreshAp(resolve(s, orders, G, params).state, params);
    }
    return s;
  };
  const wins = (s) => s.log.filter((e) => e.kind === "siege-win").length;

  const base = play(P);
  assert.ok(wins(base) > 0, "基准局没有任何破城，测不出参数影响");

  // 门槛设成不可能达到 → 缺口恒为 0 → 一次也破不了城
  const impossible = { ...P, breachLadder: P.breachLadder.map(([, n]) => [9999, n]) };
  assert.equal(wins(play(impossible)), 0, "门槛设为不可达后仍有破城 —— 引擎没读 breachLadder");

  // 兵力档归零 → 无兵可派 → 同样破不了城
  const noTroops = { ...P, strengthRatio: { skirmish: 0, main: 0, allout: 0 } };
  assert.equal(wins(play(noTroops)), 0, "兵力档归零后仍有破城 —— 引擎没读 strengthRatio");

  // 局长由包决定
  const short = { ...P, seasonsPerGame: 3 };
  assert.equal(play(short, 10).turn, 3, "改 seasonsPerGame 后局长未跟随");

  // 内政效果由包决定
  const bigWall = { ...P, wallGain: 40 };
  const at = Object.values(fresh().commanderies).find((c) => c.owner === "yuanshao").id;
  const one = (params) => resolve(fresh(), [{ faction: "yuanshao",
    action: { type: "govern", at, policy: "wall" } }], G, params).state.commanderies[at].defense;
  assert.ok(one(bigWall) > one(P), "改 wallGain 后修城效果未跟随");
});
