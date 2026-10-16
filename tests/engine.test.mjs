import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { buildGraph, listActions, validate, canonicalOrder, orderSites, DEFAULT_RULES }
  from "../lib/game/engine/actions.ts";
import { buildGeography, standingOf, gradeOf, gradeIfTaken, briefFor,
         GRADE_CUTS, ABS_CUTS } from "../lib/game/engine/victory.ts";
import { observedGarrison, observedFormation, visibleLog, PUBLIC_EVENTS }
  from "../lib/game/engine/intel.ts";
import { retinueAt, stationedAt, isFiller, attackRetinue, suadeChance }
  from "../lib/game/engine/officers.ts";
import { fieldOutcome, formationEdge, FORMATION_CN } from "../lib/game/engine/combat.ts";
import { observe } from "../lib/game/engine/observe.ts";
import { PANEL_ORDER, TYPE_CN } from "../app/play/panels.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams, marchSeasons, provisionsCap, provCapOf, siegeEat, siegeHoldSeasons }
  from "../lib/game/engine/params.ts";
import { resolve, supplyReach } from "../lib/game/engine/resolve.ts";
import { buildIndex, captureFrame, attachOutcome, FORM_IDS } from "../lib/game/replay.ts";
import { tierOf } from "../lib/game/engine/intel.ts";
import { governorOf } from "../lib/game/engine/officers.ts";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const DATA = {
  commanderyState: read("commandery-state-194.json"),
  scenario: read("scenario-194.json"),
  commanderies: read("commanderies.json"),
  troopTypes: read("troop-types.json"), resources: read("resources.json"),
};
const adjacency = read("adjacency.json");
const G = buildGraph(adjacency);
// 引擎参数唯一来源是内容包，测试也走同一条路径
const PACK = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const P = loadParams(PACK);
const ROSTER = buildRoster(
  read("officers.json"),
  read("officer-availability-194.json"),
  new Map(read("commanderies.json").map((c) => [c.name, c.id])),
);
const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
// 传 graph：据点表由它建起来。不传则本局没有据点，而对局界面是传的——
// 两边分家，测试就验不到真正跑的那一套
const fresh = (seed = "t-001") =>
  createGame(DATA, { seed, roster: ROSTER, geo: GEO, graph: G }, P);


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
    const n = listActions(s, id, G, P, undefined, ROSTER).length;
    assert.ok(n <= 60, `${id} 候选 ${n} 条，超过上限`);
  }
});

test("候选键不得重复 —— 键是模型选择的地址，重了等于给了两个一样的地址", () => {
  // 界面上报出来的：React 说「两个 children 用了同一个 key
  // campaign:安定郡>上郡:allout」。查下来是征伐候选那条「同一目标最多两条路」——
  // 最省的一条与出兵最多的一条起兵郡不同，而下一步「已有己方围城军则起兵郡
  // 必须改成那支军团的 home」把两条**都**改写成了同一个郡，于是完全重合。
  //
  // 这不只是界面报错：候选键是模型下令的地址（R13），schema 的 enum 里
  // 出现两个一样的地址，等于白占一份枚举，且候选表里两行逐字相同
  const s = fresh();
  const me = "yuanshao";
  // 触发条件有三件：同一目标有两条起兵郡不同的路、两条路的**行军季数不同**
  // （季数相同时引擎本就只列一条）、且己方在该目标城下已有围城军
  let made = null;
  for (const tgt of Object.values(s.commanderies)) {
    const nb = (G.adj.get(tgt.id) ?? []);
    const pair = nb.flatMap((a) => nb.map((b) => [a, b]))
      .find(([a, b]) => a.to !== b.to
        && marchSeasons(a.cost, false, P) !== marchSeasons(b.cost, false, P));
    if (!pair) continue;
    made = { tgt, src1: pair[0].to, src2: pair[1].to };
    break;
  }
  assert.ok(made, "地图上找不到「同一目标两条路、行军季数不同」的目标");
  const { tgt, src1, src2 } = made;
  s.commanderies[src1].owner = me;
  s.commanderies[src2].owner = me;
  s.commanderies[tgt.id].owner = "lubu";
  s.factions[me].ap = 9;
  s.armies.push({
    id: `${me}:0:${src1}>${tgt.id}`, faction: me, commander: null, retinue: [],
    troops: 3000, at: tgt.id, target: tgt.id, posture: "main", gear: "none",
    unit: "infantry", marchLeft: 0, siegeSeasons: 1, idleSeasons: 0,
    supply: P.armySupplyCap, home: src1,
  });

  const keys = listActions(s, me, G, P, DEFAULT_RULES, ROSTER, undefined, GEO).map((c) => c.key);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dup, [], `候选里有重键：${dup.join("、")}`);
});

test("候选列表对同一状态是稳定的", () => {
  const s = fresh();
  const a = listActions(s, "yuanshao", G, P, undefined, ROSTER).map((c) => c.key);
  const b = listActions(fresh(), "yuanshao", G, P, undefined, ROSTER).map((c) => c.key);
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

  const base = resolve(s, orders, G, P, ROSTER, GEO).state;
  // 用确定性洗牌产生若干个不同排列，逐一比对
  for (let k = 1; k <= 6; k += 1) {
    const shuffled = [...orders];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = (i * 7919 + k * 104729) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    assert.notDeepEqual(shuffled.map((o) => o.action.type), orders.map((o) => o.action.type),
      `第 ${k} 个排列与原序相同，未真正打乱`);
    const got = resolve(s, shuffled, G, P, ROSTER, GEO).state;
    assert.deepEqual(got, base, `第 ${k} 个排列结果不同 —— R6 失守`);
  }
});

test("R33 同 seed 同命令必得逐位相同的结果", () => {
  const run = () => {
    let s = fresh("replay-seed");
    for (let t = 0; t < 5; t += 1) {
      s = refreshAp(resolve(s, sampleOrders(s, ["caocao", "yuanshao", "lubu"]), G, P, ROSTER, GEO).state, P);
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
    const cands = listActions(s, f, G, P, undefined, ROSTER);
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
      s = refreshAp(resolve(s, sampleOrders(s, Object.keys(s.factions)), G, P, ROSTER, GEO).state, P);
    }
    return JSON.stringify(s.log.filter((e) => e.kind.startsWith("siege")).map((e) => e.text));
  };
  const a = run("aaa"), b = run("bbb");
  assert.ok(JSON.parse(a).length > 0, "整局没有一次攻城，测不出 seed 影响");
  assert.notEqual(a, b);
});

test("令数被正确扣减且不透支", () => {
  const s = fresh();
  const cands = listActions(s, "yuanshao", G, P);
  const orders = cands.map((c) => ({ faction: "yuanshao", action: c.action }));
  const { state, rejected } = resolve(s, orders, G, P, ROSTER, GEO);
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
  const { state } = resolve(s, [{ faction: f, action: { type: "retire" } }], G, P, ROSTER, GEO);
  const after = Object.values(state.commanderies).filter((c) => c.owner === f).length;
  assert.equal(after, 1, `归隐后应只剩治所，实为 ${after}（原 ${before}）`);
  assert.ok(state.factions[f].retired);
  assert.equal(listActions(state, f, G, P, undefined, ROSTER).length, 0, "归隐后仍有候选");
});

test("一局 16 季后自动结束", () => {
  let s = fresh();
  for (let t = 0; t < P.seasonsPerGame; t += 1) s = refreshAp(resolve(s, [], G, P, ROSTER, GEO).state, P);
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
      s = refreshAp(resolve(s, orders, G, params, ROSTER, GEO).state, params);
    }
    return s;
  };
  const wins = (s) => s.log.filter((e) => e.kind === "siege-win").length;

  const base = play(P);
  assert.ok(wins(base) > 0, "基准局没有任何破城，测不出参数影响");

  // 门槛设成不可能达到 → 缺口恒为 0 → 一次也破不了城
  const impossible = { ...P, breachLadder: P.breachLadder.map(([, n]) => [9999, n]) };
  assert.equal(wins(play(impossible)), 0, "门槛设为不可达后仍有破城 —— 引擎没读 breachLadder");

  // 兵力档与集结抽调比同时归零 → 无兵可派 → 同样破不了城。
  // 两项都要归零：集结出的军团整建制出征，不走兵力档
  const noTroops = { ...P, strengthRatio: { skirmish: 0, main: 0, allout: 0 }, musterTake: 0 };
  assert.equal(wins(play(noTroops)), 0, "兵源归零后仍有破城 —— 引擎没读 strengthRatio/musterTake");

  // 局长由包决定，但在**开局时**定下：它现在是每局的属性（GameState.seasonsPerGame），
  // 因为评测要短而固定（16 季 = 16 次调用，48 局才付得起）而对局要长
  //（十六季刚把内政理顺就结束了），两者共用一个常数必然有一边被将就
  const short = { ...P, seasonsPerGame: 3 };
  let s3 = createGame(DATA, { seed: "param-probe", roster: ROSTER, geo: GEO }, short);
  for (let t = 0; t < 10 && !s3.finished; t += 1) {
    s3 = refreshAp(
      resolve(s3, sampleOrders(s3, Object.keys(s3.factions)), G, short, ROSTER, GEO).state,
      short);
  }
  assert.equal(s3.turn, 3, "开局时的包未决定局长");
  // 且单局可以覆盖包里的默认值——这是对局界面选长局的接口
  const s5 = createGame(DATA, { seed: "t-001", roster: ROSTER, geo: GEO, seasons: 40 }, P);
  assert.equal(s5.seasonsPerGame, 40, "opts.seasons 未覆盖包里的默认局长");

  // 内政效果由包决定。修城的价钱是 goldPerWall × wallGain，改大 wallGain
  // 也就改大了价钱——这条验的是「效果跟随参数」，不是国库，先把钱给足
  const bigWall = { ...P, wallGain: 40 };
  const at = Object.values(fresh().commanderies).find((c) => c.owner === "yuanshao").id;
  const one = (params) => {
    const t = fresh();
    t.factions.yuanshao.gold = 99999;
    return resolve(t, [{ faction: "yuanshao", action: { type: "govern", at, policy: "wall" } }],
      G, params, ROSTER, GEO).state.commanderies[at].defense;
  };
  assert.ok(one(bigWall) > one(P), "改 wallGain 后修城效果未跟随");

  // 金也由包决定：每产出档的金一改，国库收入必须跟随；
  // 而 constants.金.启用 关掉时必须逐位回到「没有金」的行为
  const gold = (params) => resolve(fresh(), [], G, params, ROSTER, GEO)
    .state.factions.yuanshao.gold;
  const rich = { ...P, goldOn: true, goldPerTier: P.goldPerTier * 4 };
  assert.ok(gold(rich) > gold({ ...P, goldOn: true }), "改 金_每产出档 后国库收入未跟随");
  // 关掉时不该**增长**（开局金由 createGame 按包里的 P 给出，与这里的覆盖无关）
  const start = fresh().factions.yuanshao.gold;
  assert.equal(gold({ ...P, goldOn: false }), start, "金关闭时国库不该变动");
});

// ── 武将 ────────────────────────────────────────────────────────────
/**
 * 把某郡的驻将设成恰好这些人（不给则只剩龙套郡守）。
 * 现在武将有驻地且开局按籍贯落位，测试若不先清干净，
 * 量到的是「这个郡本来就驻着谁」而不是想验的那一条
 */
const station = (t, at, ...officerIds) => {
  for (const [oid, where] of Object.entries(t.stations)) {
    if (where === at) delete t.stations[oid];
  }
  for (const oid of officerIds) if (oid) t.stations[oid] = at;
  return t;
};

// 808 人的五维此前完全没进引擎。这几条锁住「数据真的在影响结算」，
// 防止将来重构时武将又退回成装饰性字段。
test("武将：守将统率与守城适性抬高可防守数", () => {
  const s = fresh();
  const tgt = Object.values(s.commanderies).find((c) => c.owner === "lubu");
  // 找一个与该郡邻接、属他方的起兵郡
  const from = [...(G.adj.get(tgt.id) ?? [])]
    .map((e) => s.commanderies[e.to])
    .find((c) => c && c.owner && c.owner !== "lubu");
  assert.ok(from, "找不到可攻打吕布的邻郡");

  const attack = (governor) => {
    const t = fresh();
    station(t, tgt.id, governor);
    station(t, from.id);                       // 攻方也清干净，只留龙套
    t.commanderies[from.id].garrison = 40000;
    const r = resolve(t, [{ faction: from.owner, action: { type: "campaign",
      target: tgt.id, from: from.id, commander: null, strength: "allout", siegeGear: "ram" } }],
      G, P, ROSTER, GEO);
    const ev = r.state.log.find((e) => e.kind.startsWith("siege-"));
    return ev?.attribution?.可防守 ?? 0;
  };
  // 皇甫嵩：统率 85 且带守城适性，加成 floor((85-60)/25)+1 = 2
  assert.ok(ROSTER.byId.get("huangfusong"), "名册里没有皇甫嵩");
  const withHold = attack("huangfusong");
  const noHold = attack(null);
  assert.equal(withHold - noHold, 2,
    `皇甫嵩守城应加 2 档可防守，实得 ${withHold - noHold} —— 守将五维没进结算`);
});

test("武将：主将统率抬高战力，破城后守将被俘", () => {
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  assert.ok(edge, "袁绍无可攻目标");

  const run = (leader, defender) => {
    const t = fresh();
    station(t, from.id, leader);
    t.commanderies[from.id].garrison = 80000;
    station(t, edge.to, defender);
    const r = resolve(t, [{ faction: "yuanshao", action: { type: "campaign",
      target: edge.to, from: from.id, commander: leader, strength: "allout", siegeGear: "ram" } }],
      G, P, ROSTER, GEO);
    return r.state;
  };
  const withLead = run("yuanshao", null);      // 袁绍 统率 88
  const noLead = run(null, null);
  const g1 = withLead.log.find((e) => e.kind.startsWith("siege-"))?.attribution;
  const g0 = noLead.log.find((e) => e.kind.startsWith("siege-"))?.attribution;
  // 「无主将」这一档已不存在：无名将驻守的郡自动有龙套郡守，弱但不为零。
  // 该验的是名将确实强于龙套，而不是龙套等于零
  assert.ok(String(g0.主将).includes("守将") || g0.主将 === "无主将",
    `无名将时应由龙套顶上：${JSON.stringify(g0)}`);
  assert.ok(String(g1.主将).includes("袁绍"), `主将归因缺失：${JSON.stringify(g1)}`);
  assert.ok(Number(g1.缺口) >= Number(g0.缺口), "名将带兵不该弱于龙套郡守");

  // 破城时守将被俘，且此后不可再任命
  const cap = run("yuanshao", "huangfusong");
  if (cap.log.some((e) => e.kind === "siege-win")) {
    assert.ok(cap.capturedOfficers.includes("huangfusong"), "破城未俘获守将");
    assert.equal(cap.stations.huangfusong, undefined, "被俘者仍挂在驻地上");
  }
});

test("武将：在野者须控制其籍贯郡方可征辟，他方之臣不可用", () => {
  const s = fresh();
  const mine = Object.values(s.commanderies).find((c) => c.owner === "caocao");
  // 关羽属刘备，曹操不可任命
  const bad = validate(s, { faction: "caocao",
    action: { type: "appoint", officer: "guanyu", at: mine.id } }, G, undefined, ROSTER);
  assert.match(bad ?? "", /他方/, `本应拒绝，得到：${bad}`);

  // 在野者：籍贯郡的主人可用，别人不可用
  const pool = new Set(s.recruitPool);
  const wild = [...ROSTER.byId.values()]
    .find((o) => !o.faction && o.home && pool.has(o.id)
                 && s.commanderies[o.home]?.owner === "yuanshao");
  assert.ok(wild, "本局名单中没有籍贯属袁绍的在野武将，测不出征辟");
  assert.equal(validate(s, { faction: "yuanshao",
    action: { type: "appoint", officer: wild.id, at: wild.home } }, G, undefined, ROSTER), null);
  assert.ok(validate(s, { faction: "caocao",
    action: { type: "appoint", officer: wild.id, at: mine.id } }, G, undefined, ROSTER),
    "别方不该能征辟不在其治下的在野武将");
});

test("在野名单由 seed 抽定，是开局唯一的随机源", () => {
  const a = fresh("seed-a").recruitPool;
  const b = fresh("seed-b").recruitPool;
  assert.ok(a.length > 0, "在野名单为空");
  assert.notDeepEqual(a, b, "换 seed 名单不变 —— seed 名不副实");
  assert.deepEqual(fresh("seed-a").recruitPool, a, "同 seed 名单不稳定");
  // 名单只含在野者，且比例大致落在包里声明的值附近
  for (const id of a) assert.equal(ROSTER.byId.get(id).faction, null);
  const wild = [...ROSTER.byId.values()].filter((o) => !o.faction && o.home).length;
  const got = a.length / wild;
  assert.ok(Math.abs(got - P.wildRecruitRatio) < 0.12,
    `在野入选比 ${got.toFixed(2)}，包里声明 ${P.wildRecruitRatio}`);
});

test("武将：本年已故或未成年者不入名册", () => {
  for (const id of ["zhangjiao", "dongzhuo", "sunjian", "wangyun"]) {
    assert.ok(!ROSTER.byId.has(id), `${id} 卒于 194 年前，不该在名册里`);
  }
  for (const id of ["zhugeliang", "simayi", "luxun", "jiangwei"]) {
    assert.ok(!ROSTER.byId.has(id), `${id} 194 年未成年，不该在名册里`);
  }
  for (const id of ["caocao", "yuanshao", "guanyu", "zhaoyun", "zhangliao"]) {
    assert.ok(ROSTER.byId.has(id), `${id} 194 年在场，应在名册里`);
  }
});

test("武将：太守政治抬高产出、魅力抬高民心", () => {
  const at = Object.values(fresh().commanderies).find((c) => c.owner === "yuanshao").id;
  const after = (gov) => {
    const t = fresh();
    station(t, at, gov);
    t.commanderies[at].moraleTier = 2;
    const r = resolve(t, [], G, P, ROSTER, GEO).state.commanderies[at];
    return { garrison: r.garrison, morale: r.moraleTier };
  };
  const none = after(null);
  // 荀彧 政治 94 魅力 88，两项都应体现
  const xun = after("xunyu");
  assert.ok(xun.garrison > none.garrison, "太守政治未影响产出");
  assert.ok(xun.morale > none.morale, "太守魅力未影响民心");
});

// ── 围城与野战 ──────────────────────────────────────────────────────
// 首版里军团是空壳：muster 造出来后无人读取，征伐直接用郡守军，
// 行军瞬时、围城无过程。这几条锁住「围城是持续的、可被解的」。
/**
 * 挑一对「打得着」的郡：己方任一郡 → 相邻的他家之郡，取**行军最省**的那条。
 *
 * 原先取第一个郡的第一条邻边。那默默依赖了通行图的排列顺序——
 * 通行图改由代价场求出之后，第一条边变成了一条要走两个月的山道，
 * 军队当季到不了城下，于是十几条验围城机制的测试一起挂掉，
 * 报的却是「首攻应转入围困」——看着像围城坏了，其实是地图换了。
 *
 * 这些测试要验的是围城怎么结算，不是哪条边最近。取最省的那条，
 * 让它们对地图的形状不敏感。
 */
const attackPair = (s, faction, want) => {
  let best = null;
  for (const c of Object.values(s.commanderies)) {
    if (c.owner !== faction) continue;
    for (const e of G.adj.get(c.id) ?? []) {
      const t = s.commanderies[e.to];
      if (!t?.owner || t.owner === faction) continue;
      // 验战斗公式的测试要一条**平地**边：关道与山地给守方的加成能把缺口压到 0，
      // 那时「换阵型改变缺口」这类断言比的是 0 与 0，看着像公式坏了
      if (want && e.terrain !== want) continue;
      if (!best || e.cost < best.edge.cost
        || (e.cost === best.edge.cost && `${c.id}${e.to}` < `${best.from.id}${best.edge.to}`)) {
        best = { from: c, edge: e };
      }
    }
  }
  return best ?? { from: null, edge: null };
};

test("图上符号：界面的变体表与真渲出来的对得上，且每一幅都在", () => {
  // 贴一幅不存在的图，界面上是一个空洞，控制台一声不吭——SVG 的 <image>
  // 取不到资源不报错。所以这三样必须对账：
  //   渲染器的 VARIANTS（tools/render-map-glyphs.mjs）
  //   → manifest.json（渲出来的实况）
  //   → 界面的 GLYPH_N（贴图时按它取模）
  const manifest = JSON.parse(fs.readFileSync("public/game/glyphs/manifest.json", "utf8"));
  const client = fs.readFileSync("app/play/PlayClient.tsx", "utf8");
  const block = /const GLYPH_N: Record<string, number> = \{([^}]+)\}/.exec(client);
  assert.ok(block, "界面里找不到 GLYPH_N —— 贴图的变体数没有出处");
  const declared = {};
  for (const m of block[1].matchAll(/"?([a-z-]+)"?:\s*(\d+)/g)) declared[m[1]] = Number(m[2]);

  assert.deepEqual(declared, manifest.variants,
    "界面声明的变体数与 manifest 对不上");
  for (const [id, g] of Object.entries(manifest.glyphs)) {
    for (let v = 0; v < g.variants; v += 1) {
      assert.ok(fs.existsSync(`public/game/glyphs/${id}-${v}-ink.png`), `缺 ${id}-${v}-ink.png`);
      if (g.wash) {
        assert.ok(fs.existsSync(`public/game/glyphs/${id}-${v}-wash.png`), `缺 ${id}-${v}-wash.png`);
      }
    }
  }
  // 地平线：图元要**站在**郡治那个点上。界面按 0.82 摆，渲染器也得是这个数
  const base = /const GLYPH_BASE = ([\d.]+)/.exec(client);
  assert.equal(Number(base?.[1]), manifest.base, "地平线位置两边对不上，城会浮在半空");
});

test("界面的候选分组两张表都要覆盖每一类动作", () => {
  // 加阵型时界面上直接显示了 `array` 这个内部 id：候选是新的，
  // 而分组名表还是旧的。
  //
  // 第一版这条测试是从**开局状态**收集分组键的，于是加招降时它又漏了——
  // 俘虏是中局才有的东西，开局枚举不到。判据因此改成「内容包里的每一类动作」：
  // 那份清单与引擎同源，且不依赖某一局恰好走到哪一步
  const ids = PACK.actions.map((a) => a.id);
  // relief / withdraw 不是动作类型，是引擎从征伐派生出来的候选键
  const keys = new Set([...ids, "relief"]);
  assert.ok(keys.size >= 9, `只有 ${keys.size} 类动作，样本不足以判定覆盖`);
  for (const k of keys) {
    assert.ok(TYPE_CN[k], `分组「${k}」没有中文名 —— 界面会直接显示这个内部 id`);
    assert.ok(PANEL_ORDER.includes(k), `分组「${k}」不在面板顺序里 —— 会被排到末尾`);
  }
});

// ── 劝降势力 ──────────────────────────────────────────────────────────
//
// 这一层的立项理由是实测：长局终局是「两强 + 长尾」，四局合计 32 家以整整
// 一个郡活到最后——一郡势力把全部兵力武将与满城防堆在一点（守军上限 60000），
// 而进攻方压得上的中位只有 2894 人，硬打打不动。调了七个数值旋钮
//（令数上限与指数、收入递减、每将统兵、集结郡数与跳数）没有一个能推动统一。

/** 把 who 做成「已控 N 州」的霸主：把够多的郡划给它 */
/**
 * 把某家捏成霸主：占满若干个州，**并记上够数的克城**。
 *
 * 克城数那一条是后加的门槛（见内容包 constants.归降.门槛_为何要克城数）——
 * 名分收得拢人是因为你已经打赢了，不是因为你地大。夹具只发地不发战功，
 * 就捏不出一个够得着劝降的霸主，而那不是机制坏了，是夹具没把霸主捏全。
 */
function overlord(s, who, zhou = 4) {
  const byZhou = new Map();
  for (const c of Object.values(s.commanderies)) {
    const z = GEO.zhouOf.get(c.id);
    if (!byZhou.has(z)) byZhou.set(z, []);
    byZhou.get(z).push(c);
  }
  let done = 0;
  for (const [, list] of [...byZhou].sort()) {
    if (done >= zhou) break;
    for (const c of list) c.owner = who;
    done += 1;
  }
  s.factions[who].capital = Object.values(s.commanderies).find((c) => c.owner === who)?.id ?? null;
  s.factions[who].conquests = Math.max(s.factions[who].conquests, P.submitMinConquests);
  return s;
}

test("劝降：我方未控足够州数时，一条候选都不给", () => {
  const s = fresh();
  const cs = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
    .filter((c) => c.key.startsWith("submit:"));
  assert.equal(cs.length, 0,
    `开局袁绍只控 ${standingOf(s, GEO, "yuanshao").controlledZhou} 州，不该给劝降候选`);
});

// 州数够了而一仗没打，同样不给——这一条挡的是「开局即霸主」的剧本。
// 建安五年的曹操开局即据司隶东部、兖、豫、徐四州，正好站在州数门槛上；
// 没有这一关，实测他第一季就劝降刘备、刘表、孙策，第六季袁绍举二十四郡来降
test("劝降：州数够了但一仗没打，也一条候选都不给", () => {
  const s = overlord(fresh("conq"), "yuanshao", P.submitMinZhou);
  s.factions.yuanshao.conquests = P.submitMinConquests - 1;
  const cs = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
    .filter((c) => c.key.startsWith("submit:"));
  assert.equal(cs.length, 0,
    `控 ${standingOf(s, GEO, "yuanshao").controlledZhou} 州而只克城 `
    + `${s.factions.yuanshao.conquests}（门槛 ${P.submitMinConquests}），不该给劝降候选`);
  s.factions.yuanshao.conquests = P.submitMinConquests;
  assert.ok(listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
    .some((c) => c.key.startsWith("submit:")),
    "克城数一到门槛就该给候选 —— 否则是别的条件在拦，这条测试没测到东西");
});

test("劝降：16 季局里永不触发 —— 评测口径与「无此机制」逐位相同", () => {
  // 门槛用**州数**而非郡数，正是为了这一条：郡数 20 在十六季里就够得着
  //（实测把曹操出局率从 45% 推到 67%），而十六季里没有势力控得到 4 州。
  // 这不是「影响很小」，是**零触发**——实测 100 局 × 6 席，劝降成功 0 次，
  // 曹操出局 43%、ρ 0.15、非苟活极差 48.0 与关掉时完全一致
  let s = fresh("submit-window");
  let fired = 0, maxZhou = 0;
  for (let t = 0; t < P.seasonsPerGame && !s.finished; t += 1) {
    for (const f of Object.keys(s.factions)) {
      if (s.factions[f].eliminated) continue;
      maxZhou = Math.max(maxZhou, standingOf(s, GEO, f).controlledZhou);
      fired += listActions(s, f, G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
        .filter((c) => c.key.startsWith("submit:")).length;
    }
    s = refreshAp(resolve(s, sampleOrders(s, Object.keys(s.factions)), G, P, ROSTER, GEO).state, P);
  }
  assert.equal(fired, 0,
    `16 季内出现了 ${fired} 条劝降候选（全局最高控 ${maxZhou} 州，门槛 ${P.submitMinZhou}）`);
});

test("劝降：成则疆土武将整体过户，败则两季内不再受劝", () => {
  let won = null, lost = null;
  for (let i = 0; i < 14 && (!won || !lost); i += 1) {
    const s = overlord(fresh(`sub-${i}`), "yuanshao", P.submitMinZhou);
    // 找一个弱小的邻方
    const cs = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
      .filter((c) => c.key.startsWith("submit:"));
    if (!cs.length) continue;
    const target = cs[0].action.to;
    const before = Object.values(s.commanderies).filter((c) => c.owner === target).length;
    const r = resolve(s, [{ faction: "yuanshao", action: { type: "submit", to: target } }],
      G, P, ROSTER, GEO);
    const ev = r.state.log.find((e) => e.kind === "submitted" || e.kind === "submit-refuse");
    assert.ok(ev, "下了劝降令却没有结算事件");
    if (ev.kind === "submitted") won ??= { r, target, before };
    else lost ??= { r, target };
  }
  assert.ok(won && lost, "十四个 seed 里凑不出一成一败 —— 成功率可能被写死了");

  const after = Object.values(won.r.state.commanderies)
    .filter((c) => c.owner === won.target).length;
  assert.equal(after, 0, "归降后仍有郡属原主");
  assert.ok(won.r.state.factions[won.target].eliminated, "归降方未退出");
  assert.equal(won.r.state.factions[won.target].submittedTo, "yuanshao",
    "没记下归降于谁 —— 归降与被灭死因不同，报告要分得开");
  assert.ok(won.r.state.factions.yuanshao.conquests >= won.before,
    "归降来的郡没有计入「夺自他方」");
  assert.ok(!won.r.state.armies.some((a) => a.faction === won.target),
    "归降方还留着无主孤军在外");

  // 拒降后进入禁劝期
  const s2 = refreshAp(lost.r.state, P);
  const again = listActions(s2, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
    .filter((c) => c.key === `submit:${lost.target}`);
  assert.equal(again.length, 0, "拒降后仍可逐季重掷 —— 成功率形同虚设");
});

// ── 招降 ──────────────────────────────────────────────────────────────

/** 打一场必破的城，返回破城后的状态与被俘者 */
function sack(seed = "reg-0") {
  const s = fresh(seed);
  const { from, edge } = attackPair(s, "yuanshao");
  s.commanderies[from.id].garrison = 40000;
  s.commanderies[edge.to].garrison = 3000;
  s.commanderies[edge.to].defense = 20;
  const order = { faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "ram" } };
  const r = resolve(s, [order], G, P, ROSTER, GEO);
  return { s: r.state, at: edge.to, from: from.id };
}

test("招降：破城即入窗，逾期自动出列", () => {
  let { s, at } = sack();
  const caught = s.captives.filter((x) => x.at === at);
  assert.ok(caught.length, "破城后无人入招降之窗");
  for (const c of caught) {
    assert.equal(c.by, "yuanshao", "俘虏没记在攻方名下");
    // 在窗期间对任何一方都不可用 —— 招过来之前这人不属于谁
    assert.ok(s.capturedOfficers.includes(c.officer), "在窗俘虏仍可被原主使用");
  }
  // 空转到出窗。剔除只写在结算里一处，这里验的是那一处真的在跑
  const who = caught[0].officer;
  let seasons = 0;
  while (s.captives.some((x) => x.officer === who) && seasons < 8) {
    s = resolve(refreshAp(s, P), [], G, P, ROSTER, GEO).state;
    seasons += 1;
  }
  assert.equal(seasons, P.suadeWindow,
    `俘虏在册 ${seasons} 季，包里写的窗口是 ${P.suadeWindow} 季`);
});

test("招降：成则驻于所俘之郡，败则永久离场", () => {
  // 走遍若干 seed，凑齐一成一败两个样本 —— 掷点是确定性的，不能靠重试
  let won = null, lost = null;
  for (let i = 0; i < 12 && (!won || !lost); i++) {
    const { s: s0, at } = sack(`suade-${i}`);
    const who = s0.captives.find((x) => x.at === at);
    if (!who) continue;
    const s1 = refreshAp(s0, P);
    const r = resolve(s1, [{ faction: "yuanshao",
      action: { type: "suade", officer: who.officer } }], G, P, ROSTER, GEO);
    const ev = r.state.log.find((e) => e.kind === "suade");
    assert.ok(ev, "下了招降令却没有结算事件");
    if (/成，驻/.test(ev.text)) won ??= { r, who };
    else lost ??= { r, who };
  }
  assert.ok(won && lost, "十二个 seed 里凑不出一成一败 —— 成功率可能被写死了");

  assert.equal(won.r.state.stations[won.who.officer], won.who.at,
    "招降成功却没驻进所俘之郡");
  assert.ok(!won.r.state.capturedOfficers.includes(won.who.officer),
    "招降成功却仍在被俘名单里 —— 这人还是不能用");
  assert.ok(lost.r.state.capturedOfficers.includes(lost.who.officer),
    "招降失败却没有永久离场");
  for (const st of [won.r.state, lost.r.state]) {
    assert.ok(!st.captives.some((x) => x.officer === won.who.officer
                                    && x.officer === lost.who.officer),
      "结算后仍留在俘虏名单里 —— 同一个人可以被反复招降");
  }
});

test("招降：控其籍贯郡则成功率更高，名将则基本招不来", () => {
  const pick = (want) => [...ROSTER.byId.values()]
    .filter((o) => o.home)
    .sort((a, b) => want(b) - want(a))[0];
  const star = pick((o) => o.leadership + o.might + o.intellect + o.politics + o.charisma);
  const plain = pick((o) => -(o.leadership + o.might + o.intellect + o.politics + o.charisma));
  assert.ok(suadeChance(star, P, false) < suadeChance(plain, P, false),
    `名将 ${star.name} 不比寻常之将难招`);
  assert.ok(suadeChance(star, P, false) <= 0.1,
    `五维最高的 ${star.name} 成功率 ${suadeChance(star, P, false)} —— 打赢就白捡一个名将`);
  assert.equal(
    Math.round((suadeChance(plain, P, true) - suadeChance(plain, P, false)) * 1000),
    Math.round(P.suadeHomeBonus * 1000),
    "控其籍贯郡没有加成",
  );
});

// ── 阵型 ──────────────────────────────────────────────────────────────
//
// 这一层能立项，靠的是一个实测：2081 次攻城结算里，「缺口 − 可防守」的余量
// 有 43.1% 落在 {0,1}。也就是说 ±1 个缺口能翻转将近一半的攻城。
// 下面三条钉住的分别是：相克真的改变结果、加成不能凭空造缺口、未探则看不见。

test("阵型：相克改变破城与否，且方向正确", () => {
  const base = fresh();
  const { from, edge } = attackPair(base, "yuanshao", "plain");
  const setup = (mine, theirs) => {
    const s = fresh();
    s.commanderies[from.id].garrison = 20000;
    s.commanderies[from.id].formation = mine;
    s.commanderies[edge.to].garrison = 9000;
    s.commanderies[edge.to].defense = 60;
    s.commanderies[edge.to].formation = theirs;
    const order = { faction: "yuanshao", action: { type: "campaign",
      target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "none" } };
    const r = resolve(s, [order], G, P, ROSTER, GEO);
    const ev = r.state.log.find((e) => e.kind.startsWith("siege-"));
    return Number(ev.attribution.缺口);
  };
  // 鱼鳞克鹤翼；方圆克鱼鳞。同一场仗，只换阵型
  const win = setup("scale", "wings");
  const even = setup("scale", "scale");
  const lose = setup("scale", "square");
  assert.equal(win - even, P.formationBreach,
    `克制未加缺口：${even} → ${win}`);
  assert.equal(even - lose, P.formationBreach,
    `被克未减缺口：${even} → ${lose}`);
});

test("阵型：三阵各有所长，且各落在不同的管子上", () => {
  // 相克是「谁对上谁」，这一条钉的是「这个阵本身长于什么」——不取决于对手。
  //
  // 三项分别落在攻（缺口）、速（行军季）、耐（存粮）上，而不是都往缺口上加：
  // 都加缺口的话「哪个阵最强」有唯一解，改阵就不成其为决策
  const s = fresh();

  // 一、鱼鳞攻城 +1 缺口、守城 −1 可防守；鹤翼攻城 −1
  assert.equal(P.formAtk.scale, 1, "鱼鳞不加攻");
  assert.equal(P.formAtk.wings, -1, "鹤翼不减攻");
  assert.equal(P.formDef.scale, -1, "鱼鳞不减守");
  assert.equal(P.formDef.square, 0, "方圆动了可防守 —— 63 个郡是方圆，那是全图调参");

  // 二、鹤翼行军少一季，方圆是默认阵、不动行军
  // 全图最长的路也只要一季（464 条边里 54 条是一季，其余当季即至），
  // 所以鹤翼那一季的意思是「弓弩之郡出兵永不误期」
  const slow = Object.values(s.commanderies)
    .flatMap((c) => (G.adj.get(c.id) ?? []).map((e) => e.cost))
    .find((cost) => marchSeasons(cost, false, P, "square") >= 1);
  assert.ok(slow, "地图上找不到要走一季的路");
  assert.equal(marchSeasons(slow, false, P, "wings"),
    marchSeasons(slow, false, P, "square") - 1, "鹤翼没少走一季");
  assert.equal(marchSeasons(slow, false, P, "square"),
    marchSeasons(slow, false, P), "方圆动了行军 —— 默认阵该是中性的");
  // 最少 0：鹤翼变不出负的季数
  const near = Object.values(s.commanderies)
    .flatMap((c) => (G.adj.get(c.id) ?? []).map((e) => e.cost))
    .find((cost) => marchSeasons(cost, false, P, "square") === 0);
  assert.equal(marchSeasons(near, false, P, "wings"), 0, "鹤翼把行军算成了负季");

  // 三、方圆城中多囤一季粮
  const c0 = Object.values(s.commanderies)[0];
  const base = { yieldTier: c0.yieldTier, buildings: [] };
  assert.equal(provCapOf({ ...base, formation: "square" }, P),
    provCapOf({ ...base, formation: "scale" }, P) + 1, "方圆没多囤一季");

  // 四、这三项与相克是**两回事**：未探明敌阵时相克归零，而阵之长照算
  assert.equal(formationEdge(P, "scale", null), 0, "未探明还在算相克");
  assert.equal(P.formAtk.scale, 1, "未探明就把自己的阵之长也丢了");
});

test("阵型：兵力比够不着门槛时，任何加成都造不出缺口", () => {
  // 相克 +1 若能从 0 起算，「三千人带冲车破两万人的城」就成立了。
  // 缺口只能来自兵力比，器械和阵型都只放大已经撕开的口子
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  s.commanderies[from.id].garrison = 3000;
  s.commanderies[from.id].formation = "scale";
  s.commanderies[edge.to].garrison = 20000;
  s.commanderies[edge.to].formation = "wings";      // 被我方克
  const order = { faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "ram" } };
  const r = resolve(s, [order], G, P, ROSTER, GEO);
  const ev = r.state.log.find((e) => e.kind.startsWith("siege-"));
  assert.equal(Number(ev.attribution.缺口), 0,
    `兵力比不足却撕开了缺口：${JSON.stringify(ev.attribution)}`);
});

test("阵型：未刺探则看不见敌阵，改阵候选也不给", () => {
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  const foe = s.commanderies[edge.to];
  // 敌郡摆成正克我方的阵。未探时既看不见，也不该因此列出改阵候选
  s.commanderies[from.id].formation = "wings";
  foe.formation = "scale";
  assert.equal(observedFormation(s, "yuanshao", edge.to), null, "未探却看得见敌阵");
  const before = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER)
    .filter((c) => c.key.startsWith("array:"));
  assert.equal(before.length, 0, `未探却给出了改阵候选：${before.map((c) => c.key)}`);

  // 刺探之后：看得见，且候选指向能反克对方的那一阵
  s.intel.yuanshao = { ...(s.intel.yuanshao ?? {}), [edge.to]: s.turn + 4 };
  assert.equal(observedFormation(s, "yuanshao", edge.to), "scale");
  const after = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER)
    .filter((c) => c.action.type === "array" && c.action.at === from.id);
  assert.equal(after.length, 1, `刺探后未给出改阵候选`);
  assert.ok(formationEdge(P, after[0].action.to, "scale") > 0,
    `改阵候选给的阵反克不了对方：${after[0].action.to}`);
});

test("围城：首攻未克则留在城下，缺口逐季累加", () => {
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  // 兵力刚好不足以首攻破城
  s.commanderies[from.id].garrison = 9000;
  s.commanderies[edge.to].garrison = 9000;
  s.commanderies[edge.to].defense = 90;

  const order = { faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "ram" } };
  const r1 = resolve(s, [order], G, P, ROSTER, GEO);
  const held = r1.state.log.find((e) => e.kind === "siege-hold");
  assert.ok(held, `首攻应转入围困，实得：${r1.state.log.map((e) => e.kind).join(",")}`);
  const army = r1.state.armies.find((a) => a.target === edge.to);
  assert.ok(army, "围城军未留在城下 —— 军团仍是空壳");
  assert.equal(army.siegeSeasons, 1);

  // 下季不再下令，围城仍自动结算，且**进度必须推得动**。
  //
  // 此前这里断言的是「缺口比首季多」。那个量单看会卡在阶梯边界上：
  // 缺口来自战力比查表，攻方换个主将、战力比跨到相邻一档，
  // 累加的 +1 就恰被基数的 −1 抵掉，看起来像机制坏了，其实没有。
  // 该验的是包里写的那条设计意图：「损耗不对称，否则围困永远推不动进度」——
  // 也就是「缺口 − 可防守」这个余量必须逐季变好。
  const before = r1.state.log.length;
  const r2 = resolve(refreshAp(r1.state, P), [], G, P, ROSTER, GEO);
  const ev = r2.state.log.slice(before).find((e) => e.kind.startsWith("siege-"));
  assert.ok(ev, "第二季围城未自动结算");
  const margin = (x) => Number(x.attribution.缺口) - Number(x.attribution.可防守);
  assert.ok(margin(ev) > margin(held),
    `围城第二季未推进：缺口−可防守 ${margin(held)} → ${margin(ev)}`
    + `（${held.attribution.缺口}对${held.attribution.可防守} → ${ev.attribution.缺口}对${ev.attribution.可防守}）`);
});

test("围城：两只钟，先响的那只决定围城怎么结束", () => {
  // 从前只有攻方一只钟（满 N 季自动撤围），于是「围困」永远只是「强攻失败的
  // 慢速版」。现在守方也有一只：城中存粮每季 −1，归零则不战自下。
  //
  // 两只钟比的是「强攻打不打得破」与「城里还有没有粮」，**不是**「攻方的上限季数」——
  // 守军每季掉 25%、攻方缺口每季 +1，所以多数局面是强攻先赢。这条只钉两件事：
  // 围得住时存粮真的在走；围城最终由三条路之一结束，不会永远悬着
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  s.commanderies[from.id].garrison = 60000;
  s.commanderies[edge.to].garrison = 12000;
  s.commanderies[edge.to].defense = 100;
  const prov0 = s.commanderies[edge.to].provisions;
  assert.ok(prov0 >= 2 && prov0 <= P.provCap + 2, `存粮初值 ${prov0} 不合理`);

  let cur = s;
  cur = resolve(cur, [{ faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO).state;
  assert.ok(cur.armies.some((a) => a.target === edge.to), "首攻就破了城，测不出围困");
  // 扣多少由 siegeEat 定：城中戍兵超过开局戍兵的倍数越大，耗得越快。
  // 这里塞了 12000 兵，多半已超编——写死 −1 会在改耗粮规则时静默失效
  assert.equal(cur.commanderies[edge.to].provisions,
    prov0 - siegeEat(s.commanderies[edge.to], P), "围得住却没扣粮");

  for (let i = 0; i < P.siegeMaxSeasons + 1; i += 1) {
    cur = resolve(refreshAp(cur, P), [], G, P, ROSTER, GEO).state;
    if (!cur.armies.some((a) => a.target === edge.to)) break;
  }
  assert.equal(cur.armies.filter((a) => a.target === edge.to).length, 0,
    "围了满上限还悬着 —— 两只钟一只都没响");
  assert.ok(cur.log.some((e) => ["siege-win", "siege-starve", "siege-abort"].includes(e.kind)),
    "围城结束了却没有任何一条了结的记载");
});

test("围城：粮先尽则不战自下，且开城不是城破", () => {
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  s.commanderies[from.id].garrison = 60000;
  s.commanderies[edge.to].garrison = 12000;
  s.commanderies[edge.to].defense = 100;
  s.commanderies[edge.to].provisions = 1;      // 这一季就该见底
  const morale0 = s.commanderies[edge.to].moraleTier;
  const cur = resolve(s, [{ faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO).state;
  assert.ok(cur.log.some((e) => e.kind === "siege-starve"), "粮尽却没开城");
  assert.equal(cur.commanderies[edge.to].owner, "yuanshao", "开城了却没易主");
  // 开城不是城破：省掉的是破城那一下的巷战之毁，不是这一季的掘壕。
  // 围了一季照样削 siegeDefenseErosion 点，但不再另扣破城的 15 点
  assert.equal(cur.commanderies[edge.to].defense, 100 - P.siegeDefenseErosion,
    "开城后的城防不对：该只掉掘壕那一份，不该再吃破城的巷战之毁");
  assert.ok(!cur.log.some((e) => e.kind === "officer-captured"), "开城不该俘将");
  assert.equal(cur.commanderies[edge.to].moraleTier, Math.max(1, morale0 - 1), "民心该降一档");
});

test("围城：兵力不够就围不住——城照常吃饭，产出也不停", () => {
  // 「被围」此前的判据是「有没有敌军指着这座城」，不问兵力：一支六百人的军团
  // 就能把两万守军的大郡产出锁死，代价只有一次首攻折损。顿兵封锁因此比攻城
  // 划算得多，而那正是这套规则最不想鼓励的打法
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  s.commanderies[from.id].garrison = 3000;      // 派得出的兵远少于守军
  s.commanderies[edge.to].garrison = 30000;
  s.commanderies[edge.to].defense = 100;
  // 存粮先填满：没满的城本季会自然回补一格，那时「不该扣粮」验的是等式就不成立
  //（实测 4 → 5，报的是「围不住却扣了粮」，其实是围不住所以照常回补——
  //  两件事都对，只是断言写窄了）
  s.commanderies[edge.to].provisions = provCapOf(s.commanderies[edge.to], P);
  const prov0 = s.commanderies[edge.to].provisions;
  const cur = resolve(s, [{ faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO).state;
  assert.ok(cur.armies.some((a) => a.target === edge.to), "军团没站到城下，样本不对");
  assert.equal(cur.commanderies[edge.to].provisions, prov0,
    `围不住却扣了粮：${prov0} → ${cur.commanderies[edge.to].provisions}`);
  assert.ok(!cur.log.some((e) => e.kind === "besieged" && (e.text ?? "").includes(edge.to)),
    "围不住却报了「被围，本季无产出」——顿兵封锁又白赚了");
});

test("围城：撤围令可主动收兵，保住的残兵多于续围", () => {
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  s.commanderies[from.id].garrison = 9000;
  s.commanderies[edge.to].garrison = 12000;
  s.commanderies[edge.to].defense = 100;
  const r1 = resolve(s, [{ faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO);
  const army = r1.state.armies.find((a) => a.target === edge.to);
  assert.ok(army, "未形成围城");

  const next = refreshAp(r1.state, P);
  const pulled = resolve(next, [{ faction: "yuanshao",
    action: { type: "withdraw", army: army.id } }], G, P, ROSTER, GEO).state;
  const stayed = resolve(next, [], G, P, ROSTER, GEO).state;
  assert.ok(pulled.log.some((e) => e.kind === "siege-lift"), "撤围令未生效");
  assert.ok(pulled.commanderies[from.id].garrison > stayed.commanderies[from.id].garrison,
    "撤围后本郡兵力未增 —— 残兵没退回来");
});

test("野战：被围之郡可出城迎战，胜则解围", () => {
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  const victim = s.commanderies[edge.to];
  const foe = victim.owner;
  // 制造一支弱小的围城军：袁绍以少量兵力围城
  s.commanderies[from.id].garrison = 3000;
  victim.garrison = 30000;
  victim.defense = 100;
  const r1 = resolve(s, [{ faction: "yuanshao", action: { type: "campaign",
    target: victim.id, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO);
  const army = r1.state.armies.find((a) => a.target === victim.id);
  assert.ok(army, "未形成围城，无法测出城迎战");

  const next = refreshAp(r1.state, P);
  // 出城迎战：起点即被围之郡，不需要邻接边
  const sortie = { faction: foe, action: { type: "campaign",
    target: victim.id, from: victim.id, commander: null, strength: "allout", siegeGear: "none" } };
  assert.equal(validate(next, sortie, G, undefined, ROSTER), null, "出城迎战被判非法");
  const out = resolve(next, [sortie], G, P, ROSTER, GEO).state;
  assert.ok(out.log.some((e) => e.kind === "field-win"), 
    `出城迎战应胜，实得：${out.log.map((e) => e.kind).join(",")}`);
  assert.equal(out.armies.filter((a) => a.target === victim.id).length, 0, "胜后围城军仍在");
});

test("军团：后路断绝则粮尽溃散", () => {
  const s = fresh();
  // 起兵郡必须**不是治所**。此前这里取的是第一个己方郡，恰好是治所，
  // 抽掉它等于治所失守——全境不可达，军团当然溃散，但那验的不是「绕后断粮」。
  // 旧引擎把两种成因记在同一条日志里，于是这条测试一直以错误的理由通过
  const cap = s.factions.yuanshao.capital;
  const from = Object.values(s.commanderies)
    .find((c) => c.owner === "yuanshao" && c.id !== cap
      && [...(G.adj.get(c.id) ?? [])].some((e) =>
        s.commanderies[e.to]?.owner && s.commanderies[e.to].owner !== "yuanshao"));
  assert.ok(from, "袁绍没有非治所的临敌郡，样本选错了");
  const edge = [...(G.adj.get(from.id) ?? [])]
    .find((e) => s.commanderies[e.to]?.owner && s.commanderies[e.to].owner !== "yuanshao");
  s.commanderies[from.id].garrison = 9000;
  s.commanderies[edge.to].garrison = 20000;
  s.commanderies[edge.to].defense = 100;
  const r1 = resolve(s, [{ faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO);
  assert.ok(r1.state.armies.some((a) => a.target === edge.to), "未形成围城");

  // 抽掉起兵郡：围城军的后方走廊断了
  const cut = refreshAp(r1.state, P);
  cut.commanderies[from.id].owner = "lubu";
  // 把守方那只钟按住：这条测的是「绕后断粮」，不是「谁先粮尽」。
  // 不按住的话城会先开门、围城结束，攻方的存粮根本走不完
  cut.commanderies[edge.to].provisions = 99;
  assert.equal(cut.commanderies[cap].owner, "yuanshao", "治所应仍在手，否则测的是别的东西");
  // 断粮不再是「下季即蒸发」的悬崖，是存粮倒计时：先报存粮告急，粮尽方溃散。
  // 这个余地是给**迁治**留的——治所一失全境军团同季全灭，而迁治的生效
  // 排在溃散循环之后，当季根本无解
  let after = resolve(cut, [], G, P, ROSTER, GEO).state;
  assert.ok(after.log.some((e) => e.kind === "supply-cut-low"),
    "后路断绝首季未报存粮告急");
  assert.ok(after.armies.some((a) => a.target === edge.to),
    "断粮首季就蒸发了 —— 倒计时没生效");
  for (let i = 0; i < P.armySupplyCap; i += 1) {
    if (!after.armies.some((a) => a.target === edge.to)) break;
    after = resolve(refreshAp(after, P), [], G, P, ROSTER, GEO).state;
  }
  assert.ok(after.log.some((e) => e.kind === "supply-cut-scatter"),
    "存粮耗尽仍未溃散 —— 「绕后断粮」仍是空话");
  // 起兵郡易主而治所尚在，这是真·走廊被切，不该记成治所失守
  assert.ok(!after.log.some((e) => e.kind === "capital-lost-scatter"),
    "治所尚在却报成治所失守 —— 两种成因又混回一条了");
});

test("集结：待命军团可整建制出征，兵力大于按档抽调", () => {
  const s = fresh();
  const mine = Object.values(s.commanderies).filter((c) => c.owner === "yuanshao");
  const hub = mine.find((c) => (G.adj.get(c.id) ?? [])
    .filter((e) => s.commanderies[e.to]?.owner === "yuanshao").length >= 2);
  assert.ok(hub, "袁绍无可集结的枢纽郡");
  const srcs = [hub.id, ...(G.adj.get(hub.id) ?? [])
    .filter((e) => s.commanderies[e.to]?.owner === "yuanshao").map((e) => e.to)].slice(0, 3);
  const before = hub.garrison;

  const r = resolve(s, [{ faction: "yuanshao", action: { type: "muster",
    at: hub.id, from: srcs, commander: null, deadline: 1 } }], G, P, ROSTER, GEO);
  const army = r.state.armies.find((a) => a.at === hub.id && !a.target);
  assert.ok(army, "集结未产出待命军团 —— muster 仍是死数据");
  assert.ok(army.troops > 0);
  // 集结地本身也可出兵，因此集结的兵力应超过就地倾国而出
  const byTier = Math.floor(before * P.strengthRatio.allout);
  assert.ok(army.troops > byTier,
    `集结 ${army.troops} 人未多于就地倾国 ${byTier} 人，集结失去意义`);

  // 后续征伐整建制调用该军团，而非再按兵力档抽调
  // 取**行军最省**的那条，不是第一条：第一条可能是要走两个月的山道，
  // 军队当季到不了城下，报出来的却是「征伐未整建制调用待命军团」
  const tgt = [...(G.adj.get(hub.id) ?? [])]
    .filter((e) => r.state.commanderies[e.to]?.owner !== "yuanshao")
    .sort((a, b) => a.cost - b.cost || (a.to < b.to ? -1 : 1))[0];
  if (tgt) {
    const r2 = resolve(refreshAp(r.state, P), [{ faction: "yuanshao", action: { type: "campaign",
      target: tgt.to, from: hub.id, commander: null, strength: "skirmish", siegeGear: "none" } }],
      G, P, ROSTER, GEO);
    const ev = r2.state.log.find((e) => e.kind.startsWith("siege-"));
    assert.ok(ev && Number(ev.attribution.投入 ?? army.troops) >= army.troops * 0.9,
      "征伐未整建制调用待命军团");
  }
});

// ── 胜负判据 ────────────────────────────────────────────────────────
// 引擎首版用「郡数相对开局的倍数」代替包里的州级判据，后果有二：
// 丙档第一季自动成立（与「存续本身不得分」冲突），且占十个散郡与占一整州同分。
test("胜负：丙档必须真的从他方夺过郡国，不是活着就有", () => {
  const s = fresh();
  // 静坐一整局
  let idle = s;
  for (let t = 0; t < P.seasonsPerGame; t += 1) {
    idle = refreshAp(resolve(idle, [], G, P, ROSTER, GEO).state, P);
  }
  for (const f of Object.values(idle.factions)) {
    if (f.eliminated) continue;
    assert.equal(f.bestGrade, "ding",
      `${f.id} 一令未下却得 ${f.bestGrade} —— 存续本身不该得分`);
  }
});

test("胜负：只捡无主之地不算进攻", () => {
  const s = fresh();
  const from = Object.values(s.commanderies).find((c) => c.owner === "yuanshao");
  const empty = [...(G.adj.get(from.id) ?? [])].find((e) => s.commanderies[e.to]?.owner === null);
  if (!empty) return;                                    // 该郡无邻接无主地，跳过
  s.commanderies[from.id].garrison = 60000;
  const r = resolve(s, [{ faction: "yuanshao", action: { type: "campaign",
    target: empty.to, from: from.id, commander: null, strength: "allout", siegeGear: "ram" } }],
    G, P, ROSTER, GEO).state;
  if (r.commanderies[empty.to].owner !== "yuanshao") return;
  assert.equal(r.factions.yuanshao.conquests, 0, "取无主之地不该计入 conquests");
});

test("目的：反事实定档与真实定档同源，不是另写一套启发式", () => {
  const s = fresh();
  let checked = 0;
  for (const f of ["yuanshao", "liubiao", "lubu", "liuzhang"]) {
    const fs_ = s.factions[f];
    const start = { commanderies: fs_.startCommanderies, controlledZhou: fs_.startZhou,
                    zhouSeats: fs_.startSeats };
    for (const c of listActions(s, f, G, P, undefined, ROSTER, undefined, GEO)) {
      if (c.action.type !== "campaign" || !c.gain) continue;
      const tid = c.action.target;
      // 真取一次：直接改归属，再走引擎自己的 standingOf + gradeOf
      const truth = structuredClone(s);
      const hadOwner = !!truth.commanderies[tid].owner;
      truth.commanderies[tid].owner = f;
      if (hadOwner) truth.factions[f].conquests += 1;
      const real = gradeOf(standingOf(truth, GEO, f), start);
      const cf = gradeIfTaken(s, GEO, f, tid);
      assert.equal(cf.grade, real,
        `${f} 取 ${tid}：反事实算出 ${cf.grade}，真取一次是 ${real} —— 两套判据已分家`);
      // upgrade 只在高于**已到手的最高档**时给出：已经拿到的档再拿一次值 0 分
      const now = fs_.bestGrade;
      const RANK = { ding: 0, bing: 1, yi: 2, jia: 3 };
      assert.equal(c.gain.upgrade, RANK[real] > RANK[now] ? real : null,
        `${f} 取 ${tid} 的 upgrade 标注与实算不符`);
      checked += 1;
    }
  }
  assert.ok(checked > 30, `只核了 ${checked} 条，样本太少测不出分家`);
});

test("目的：gain 只走 label，不进观测——同一件事不花两份 token", () => {
  const s = fresh();
  const o = observe(s, "yuanshao", G, P, ROSTER, GEO);
  const camp = o.candidates.filter((c) => c.key.startsWith("campaign:"));
  assert.ok(camp.length > 0, "袁绍无征伐候选，测不出");
  for (const c of camp) {
    assert.equal(c.gain, undefined,
      "观测里出现了结构化 gain —— 实测它占 719 tok 而 label 那份只占 169，"
      + "袁绍峰值本就只剩 172 tok 余量");
  }
  // 但信息本身必须在：所属州总是写，值钱的目标要标出来
  assert.ok(camp.every((c) => /｜[\u4e00-\u9fa5]+州|｜司隶/.test(c.label)),
    "征伐候选没写目标属于哪个州 —— 郡→州 的映射模型别处拿不到");
  assert.ok(camp.some((c) => /取下即升[甲乙]档/.test(c.label)),
    "一条升州级档的候选都没有，「打赢了值什么」等于没说");
});

test("胜负：判的是相对开局的增量，不是绝对位置", () => {
  const s = fresh();
  // 吕布开局即据兖州过半与州治。若按绝对数判，他一动不动也是乙档
  const lb = s.factions.lubu;
  assert.ok(lb.startZhou >= 1 || lb.startSeats >= 1,
    "吕布开局应已控制兖州或据其州治，否则这条测不出问题");
  const st = standingOf(s, GEO, "lubu");
  assert.equal(
    gradeOf(st, { commanderies: lb.startCommanderies, controlledZhou: lb.startZhou, zhouSeats: lb.startSeats }),
    "ding", "开局态势本身不该产生任何档位");
  // 多控一整州即升甲（州治入乙、整州入甲——见下面那条门槛测试）。
  // 这条要的是「判增量不判绝对位置」：同一个 st，只因为比开局多了一州就升档
  assert.equal(
    gradeOf({ ...st, controlledZhou: st.controlledZhou + 1 },
      { commanderies: lb.startCommanderies, controlledZhou: lb.startZhou, zhouSeats: lb.startSeats }),
    "jia");
});

test("胜负：控制一州以过半郡国为准，州治齐备且唯一", () => {
  const seats = JSON.parse(fs.readFileSync("lib/game/data/province-seats-194.json", "utf8")).seats;
  const zhou = new Set(read("commanderies.json").map((c) => c.zhou));
  assert.equal(seats.length, zhou.size, `州治 ${seats.length} 条，州 ${zhou.size} 个`);
  for (const x of seats) {
    assert.equal(GEO.zhouOf.get(x.commandery), x.zhou, `${x.city} 不在 ${x.zhou}`);
    assert.ok(x.basis && x.basis.length > 10, `${x.zhou} 州治缺史料判据`);
  }
  // 过半才算控制：拿到一州半数郡国不算，过半才算
  const yz = GEO.zhouMembers.get("兖州");
  const probe = fresh();
  for (const id of Object.keys(probe.commanderies)) probe.commanderies[id].owner = null;
  for (const id of yz.slice(0, Math.floor(yz.length / 2))) probe.commanderies[id].owner = "lubu";
  assert.equal(standingOf(probe, GEO, "lubu").controlledZhou, 0, "恰好半数不该算控制");
  probe.commanderies[yz[Math.floor(yz.length / 2)]].owner = "lubu";
  assert.equal(standingOf(probe, GEO, "lubu").controlledZhou, 1, "过半应算控制");
});

// ── 兵种与器械 ──────────────────────────────────────────────────────
// 内容包定义了四个兵种和三级器械，引擎首版零引用——两者都是纯装饰。
test("兵种：骑兵在山地关隘减半，水军在江河见长", () => {
  const P2 = { ...P };
  const at = (unit, terrain) => P2.units[unit].terrain[terrain];
  assert.ok(at("cavalry", "plain") > at("cavalry", "mountain") * 2, "骑兵未因山地折损");
  assert.ok(at("cavalry", "gate") <= 0.6, "骑兵在关隘不该占便宜");
  assert.ok(at("navy", "river") > at("infantry", "river"), "水军在江河不占优");
  assert.ok(at("archer", "mountain") >= at("infantry", "mountain"), "弓弩据险不占优");
  // 每郡都有兵种，且都在包里定义过
  for (const c of Object.values(fresh().commanderies)) {
    assert.ok(P.units[c.unit], `${c.id} 的兵种 ${c.unit} 不在内容包里`);
  }
});

test("兵种：换兵种会改变同一场攻城的结果", () => {
  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao", "plain");
  const run = (unit, garrison) => {
    const t = fresh();
    t.commanderies[from.id].unit = unit;
    t.commanderies[from.id].garrison = garrison;
    const r = resolve(t, [{ faction: "yuanshao", action: { type: "campaign",
      target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
      G, P, ROSTER, GEO);
    return r.state.log.find((e) => e.kind.startsWith("siege-"))?.attribution;
  };
  assert.notEqual(String(run("cavalry", 20000).我军), String(run("navy", 20000).我军),
    "换兵种归因未变");

  // 缺口梯只有四档，单一兵力下两个兵种常落在同一档；扫一遍才测得出真影响
  const differs = [8000, 12000, 16000, 20000, 26000, 34000, 45000]
    .some((n) => run("cavalry", n).缺口 !== run("navy", n).缺口);
  assert.ok(differs, `骑兵与水军在 ${edge.terrain} 上任何兵力下都打出同样的缺口`);
});

test("器械：须由内政「治械」逐级打造，出征即耗", () => {
  const s = fresh();
  const at = Object.values(s.commanderies).find((c) => c.owner === "yuanshao");
  assert.equal(s.commanderies[at.id].gear, "none", "开局不该自带器械");
  // 治械要花金（冲车 900 / 土山 1800），开局金不够打两级——这条验的是
  // 「逐级不可越级」，不是国库，所以先把钱给足
  s.factions.yuanshao.gold = 99999;

  const one = resolve(s, [{ faction: "yuanshao",
    action: { type: "govern", at: at.id, policy: "forge" } }], G, P, ROSTER, GEO).state;
  assert.equal(one.commanderies[at.id].gear, "ram", "治械一次应得冲车");
  const two = resolve(refreshAp(one, P), [{ faction: "yuanshao",
    action: { type: "govern", at: at.id, policy: "forge" } }], G, P, ROSTER, GEO).state;
  assert.equal(two.commanderies[at.id].gear, "mound", "治械两次应得土山，且不可越级");

  // 出征带走，本郡回到无械
  const edge = [...(G.adj.get(at.id) ?? [])]
    .find((e) => two.commanderies[e.to]?.owner !== "yuanshao");
  const out = resolve(refreshAp(two, P), [{ faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: at.id, commander: null, strength: "main", siegeGear: "mound" } }],
    G, P, ROSTER, GEO).state;
  assert.equal(out.commanderies[at.id].gear, "none", "器械未随军出征");
  const army = out.armies.find((a) => a.home === at.id);
  if (army) assert.equal(army.gear, "mound", "军团未带上器械");
});

test("态势简报：把州级进度摆给模型看，且只列够得着的州", () => {
  const s = fresh();
  const brief = briefFor(s, GEO, "lubu", G.adj);
  assert.match(brief, /控制 1 州（开局 1）/);
  assert.match(brief, /豫州.*再取 \d+ 郡即控制/, "未给出「往哪打才算数」");
  assert.ok(!brief.includes("交州"), "列出了够不着的交州，等于用无关信息稀释选择");

  // 整州都在他方手里的**邻州**也要列——那正是最值钱的扩张方向。
  // 此前一条「我 0 郡且无空地就不列」把它们全滤掉了：徐州开局五郡全归刘备，
  // 吕布在简报里一个字都看不到，而「再取 N 郡即控制」是唯一说明「要打多少」的地方
  const xu = brief.split("\n").find((l) => l.trim().startsWith("徐州："));
  assert.ok(xu, "邻接的徐州整州归他方，简报里没有这一行");
  assert.match(xu, /我 0/);
  assert.match(xu, /再取 \d+ 郡即控制/);

  // 升档条件那三句逐季不变，规则摘要的「怎么算赢」一节已逐字写过。
  // 每季再发一遍，16 季白花八百多 tok，而观测峰值只剩三百 tok 余量
  assert.match(brief, /【档位】现为.档$/m);
  assert.ok(!brief.includes("多控 2 州 → 甲"), "简报里又抄了一遍升档条件");
});

// ── 纪元 ────────────────────────────────────────────────────────────
// 首版里 epoch 只是按季号算出来的数字，不改变任何规则。
test("纪元：双触发推进，且无主郡国随之筑壁渐坚", () => {
  // 逾时触发：谁也不动，本纪元满时限即推进
  let idle = fresh();
  for (let t = 0; t < P.epochLimit; t += 1) {
    idle = refreshAp(resolve(idle, [], G, P, ROSTER, GEO).state, P);
  }
  assert.equal(idle.epoch, 2, `静坐 ${P.epochLimit} 季后未入二纪元`);
  assert.ok(idle.log.some((e) => e.kind === "epoch" && e.text.includes("逾时")));

  // 达标触发：有势力升到乙档就提前推进。
  // 目标档不能取丙——三十一个席位里总有人第一季就拿下一郡，纪元会当季就跳
  const s = fresh();
  s.factions.yuanshao.bestGrade = "yi";
  assert.equal(resolve(s, [], G, P, ROSTER, GEO).state.epoch, 1,
    "第一季就达乙档不该触发纪元推进 —— 达标触发有最短季数下限");
  s.turn = P.epochMin;                                    // 已满最短季数
  const early = resolve(s, [], G, P, ROSTER, GEO).state;
  assert.equal(early.epoch, 2, "满最短季数且已有势力达乙档，却未提前推进纪元");
  assert.ok(early.log.some((e) => e.kind === "epoch" && e.text.includes("乙")));

  const bing = fresh();
  bing.turn = P.epochMin;
  bing.factions.yuanshao.bestGrade = "bing";
  assert.equal(resolve(bing, [], G, P, ROSTER, GEO).state.epoch, 1, "丙档不该触发纪元推进");

  // 无主郡国在一纪元不筑壁，二纪元起筑，三纪元更快
  const wallAfter = (epoch) => {
    const t = fresh(); t.epoch = epoch;
    const n = Object.values(t.commanderies).find((c) => !c.owner && c.defense < P.neutralWallCap);
    const before = n.defense;
    return resolve(t, [], G, P, ROSTER, GEO).state.commanderies[n.id].defense - before;
  };
  assert.equal(wallAfter(1), 0, "一纪元无主郡不该筑壁");
  assert.ok(wallAfter(2) > 0, "二纪元无主郡未筑壁");
  assert.ok(wallAfter(3) > wallAfter(2), "三纪元筑壁未快于二纪元");
  // 守军不涨，反而渐散——城墙是本地豪强维持的，而戍卒没人发饷会走
  const t3 = fresh(); t3.epoch = 3;
  const n3 = Object.values(t3.commanderies).find((c) => !c.owner);
  const g3 = resolve(t3, [], G, P, ROSTER, GEO).state.commanderies[n3.id].garrison;
  assert.ok(g3 <= n3.garrison, `无主郡的守军涨了：${n3.garrison} → ${g3}`);
});

// ── 迷雾 ────────────────────────────────────────────────────────────
// 此前候选标签直接写真实守军，intel 只用来挑刺探目标——迷雾是装饰性的：
// 刺探什么也买不到，模型也将在完全信息下被评测。
test("迷雾：未探只报档位区间，已探转点估计，盟友只降到已探级", () => {
  const s = fresh();
  const mine = Object.values(s.commanderies).find((c) => c.owner === "caocao");
  const foe = Object.values(s.commanderies).find((c) => c.owner === "lubu");

  // 己方看真值
  const own = observedGarrison(s, "caocao", mine.id, P);
  assert.equal(own.value, mine.garrison);
  assert.ok(own.scouted);

  // 敌方未探：报区间，且区间必须真的包含真值
  const dark = observedGarrison(s, "caocao", foe.id, P);
  assert.equal(dark.scouted, false);
  assert.match(dark.text, /（未探·第 \d+\/\d+ 档）/);
  const [lo, hi] = dark.text.match(/(\d+)–(\d+)/).slice(1, 3).map(Number);
  assert.ok(foe.garrison >= lo && foe.garrison <= hi,
    `真值 ${foe.garrison} 落在报出的区间 ${lo}–${hi} 之外`);

  // 已探：点估计，误差在包里声明的范围内
  const seen = { ...s, intel: { ...s.intel, caocao: { [foe.id]: s.turn + 4 } } };
  const est = observedGarrison(seen, "caocao", foe.id, P);
  assert.ok(est.scouted);
  const err = Math.abs(est.value - foe.garrison) / foe.garrison;
  assert.ok(err <= P.intelErrorRatio + 1e-6,
    `已探误差 ${(err * 100).toFixed(1)}% 超出声明的 ±${P.intelErrorRatio * 100}%`);

  // 盟友只降到「已探级」，不给真值。
  // 缔盟不需对方同意，若盟友给真值，1 令缔盟就能买断邻境全部实数
  const allied = { ...s, treaties: [{ a: "caocao", b: "lubu", kind: "alliance",
                                      from: 0, until: s.turn + 8 }] };
  const ally = observedGarrison(allied, "caocao", foe.id, P);
  assert.ok(ally.scouted, "盟友军情该是已探级");
  assert.notEqual(ally.value, foe.garrison, "盟友不该看到真值 —— 那比刺探还便宜");
  assert.ok(Math.abs(ally.value - foe.garrison) / foe.garrison <= P.intelErrorRatio + 1e-6);

  // 未生效的盟约不共享军情：盟约延迟一季生效
  const pending = { ...s, treaties: [{ a: "caocao", b: "lubu", kind: "alliance",
                                       from: s.turn + 1, until: s.turn + 8 }] };
  assert.equal(observedGarrison(pending, "caocao", foe.id, P).scouted, false,
    "未生效的盟约不该已经共享军情");
});

test("迷雾：刺探真的收窄不确定度，档宽由破城梯定", () => {
  const s = fresh();
  const foe = Object.values(s.commanderies).find((c) => c.owner === "lubu");
  const dark = observedGarrison(s, "caocao", foe.id, P);
  const [lo, hi] = dark.text.match(/(\d+)–(\d+)/).slice(1, 3).map(Number);
  const darkBand = (hi - lo) / ((hi + lo) / 2);          // 相对中值的全宽

  // 破城梯的级间比：不确定度要能跨一级，刺探才买得到东西
  const rungs = P.breachLadder.map(([t]) => t).sort((a, b) => a - b);
  const minGap = Math.min(...rungs.slice(1).map((v, i) => v / rungs[i]));
  assert.ok(darkBand / 2 >= (minGap - 1) * 0.8,
    `未探档宽 ±${(darkBand / 2 * 100).toFixed(0)}% 跨不过破城梯的一级（级间比 ${minGap.toFixed(2)}）`);
  assert.ok(P.intelErrorRatio < minGap - 1,
    `已探误差 ±${P.intelErrorRatio * 100}% 未落在一级之内，刺探等于白探`);
});

test("迷雾：观测确定，且不改变结算——真值只在结算里用", () => {
  const s = fresh();
  const foe = Object.values(s.commanderies).find((c) => c.owner === "lubu");
  const seen = { ...s, intel: { ...s.intel, caocao: { [foe.id]: s.turn + 4 } } };
  // 同一季反复读必得同一数，否则候选会自己抖动，R33 的逐位重放也不成立
  const a = observedGarrison(seen, "caocao", foe.id, P).value;
  const b = observedGarrison(seen, "caocao", foe.id, P).value;
  assert.equal(a, b);

  // 结算用真值：同一场攻城，观测方有没有情报都打出同样的结果
  const from = Object.values(s.commanderies).find((c) => c.owner === "caocao");
  const edge = [...(G.adj.get(from.id) ?? [])].find((e) => s.commanderies[e.to]?.owner === "lubu");
  if (!edge) return;
  const order = { faction: "caocao", action: { type: "campaign", target: edge.to,
    from: from.id, commander: null, strength: "allout", siegeGear: "none" } };
  const r1 = resolve(s, [order], G, P, ROSTER, GEO).state;
  const r2 = resolve(seen, [order], G, P, ROSTER, GEO).state;
  assert.equal(r1.commanderies[edge.to].garrison, r2.commanderies[edge.to].garrison,
    "有无情报改变了结算 —— 迷雾只该影响观测");
});

test("迷雾：战报的可见性由引擎定义，他方内情不外泄", () => {
  let s = fresh();
  // 跑几季攒出各类事件
  for (let t = 0; t < 3; t += 1) {
    s = refreshAp(resolve(s, sampleOrders(s, Object.keys(s.factions)), G, P, ROSTER, GEO).state, P);
  }
  assert.ok(s.log.length > 20, "样本太少，测不出可见性");

  const seen = visibleLog(s, "caocao");
  for (const e of seen) {
    assert.ok(e.faction === "caocao" || !e.faction || PUBLIC_EVENTS.has(e.kind),
      `不该看见他方的 ${e.kind}：${e.text}`);
  }
  // 他方的补给断绝、围城进度这类内情必须被挡掉
  const leaked = s.log.filter((e) => e.faction && e.faction !== "caocao"
    && ["supply-cut", "capital-lost", "besieged", "muster", "siege-hold",
        "supply-cut-scatter", "capital-lost-scatter"].includes(e.kind));
  assert.ok(leaked.length > 0, "样本里没有他方内情，测不出过滤");
  for (const e of leaked) {
    assert.ok(!seen.includes(e), `他方内情外泄：${e.kind} ${e.text}`);
  }
  // 城池易主这类天下大事必须看得见
  const publicNews = s.log.filter((e) => e.kind === "siege-win" && e.faction !== "caocao");
  for (const e of publicNews) assert.ok(seen.includes(e), "城池易主该是天下皆知");
});

// ── 观测层 ──────────────────────────────────────────────────────────
// 这是模型与引擎之间唯一的信息通道。漏一个字段，整个评测的迷雾维度就作废。
test("观测：绝不含 seed —— 有 seed 就能反算情报偏差还原真值", () => {
  const s = fresh("leak-probe");
  for (const seat of ["caocao", "yuanshao", "lubu"]) {
    const json = JSON.stringify(observe(s, seat, G, P, ROSTER, GEO));
    assert.ok(!json.includes(s.seed), `观测里出现了 seed 值「${s.seed}」`);
    assert.ok(!/"seed"/.test(json), "观测里出现了 seed 字段");
  }
});

test("观测：只含白名单，他方真值一律不出现", () => {
  const s = fresh();
  const o = observe(s, "caocao", G, P, ROSTER, GEO);
  const json = JSON.stringify(o);

  // 己方郡是自家账本，可以有真值
  const mineIds = new Set(o.mine.map((m) => m.id));
  assert.ok(mineIds.size > 0);

  // 他方郡的真实守军不得整数出现在观测里
  let leaks = 0;
  for (const c of Object.values(s.commanderies)) {
    if (mineIds.has(c.id) || c.garrison < 1000) continue;
    // 守军是四位数以上，直接搜字面量足够灵敏
    if (json.includes(`:${c.garrison},`) || json.includes(` ${c.garrison} `)) leaks += 1;
  }
  assert.equal(leaks, 0, `${leaks} 个他方郡的真实守军出现在观测里`);

  // 结构完整性
  assert.ok(o.candidates.length > 0, "观测里没有候选，模型无从下令");
  assert.ok(o.brief.includes("【态势】"), "缺态势简报");
  assert.equal(o.clock.totalTurns, P.seasonsPerGame);
});

test("观测：候选与 listActions 逐条对应，按 key 引用", () => {
  const s = fresh();
  const o = observe(s, "yuanshao", G, P, ROSTER, GEO);
  const cs = listActions(s, "yuanshao", G, P, undefined, ROSTER);
  assert.deepEqual(o.candidates.map((c) => c.key), cs.map((c) => c.key));
  // 征伐候选必须带结构化预告，否则模型只能从文字里抠数
  const camp = o.candidates.filter((c) => c.key.startsWith("campaign:"));
  assert.ok(camp.length > 0);
  for (const c of camp) {
    assert.ok(c.forecast, `${c.key} 缺预告`);
    assert.ok(["破城", "不破", "未知"].includes(c.forecast.verdict));
    assert.ok(c.forecast.breachLo <= c.forecast.breachHi);
    assert.ok(c.forecast.holdLo <= c.forecast.holdHi);
  }
});

test("观测：刺探后预告确实收窄——这是情报的价值所在", () => {
  const s = fresh();
  const before = observe(s, "caocao", G, P, ROSTER, GEO)
    .candidates.filter((c) => c.forecast).map((c) => [c.key, c.forecast]);
  assert.ok(before.length > 0);

  // 把全部目标探明
  const scouted = { ...s, intel: { ...s.intel, caocao: Object.fromEntries(
    Object.keys(s.commanderies).map((id) => [id, s.turn + 4])) } };
  const after = new Map(observe(scouted, "caocao", G, P, ROSTER, GEO)
    .candidates.filter((c) => c.forecast).map((c) => [c.key, c.forecast]));

  const width = (f) => (f.breachHi - f.breachLo) + (f.holdHi - f.holdLo);
  let narrowed = 0, same = 0;
  for (const [key, f0] of before) {
    const f1 = after.get(key);
    if (!f1) continue;
    if (width(f1) < width(f0)) narrowed += 1; else same += 1;
  }
  assert.ok(narrowed > same,
    `刺探后只有 ${narrowed}/${narrowed + same} 条候选的预告收窄了 —— 情报买不到东西`);
});

test("编制：出征只带 retinueCap 人，其余留守；兵力上限由随军人数定", () => {
  const s = fresh();
  const from = Object.values(s.commanderies).find((c) => c.owner === "yuanshao");
  const edge = [...(G.adj.get(from.id) ?? [])]
    .find((e) => s.commanderies[e.to]?.owner && s.commanderies[e.to].owner !== "yuanshao");
  assert.ok(edge, "袁绍无可攻目标");

  // 把袁绍全部武将塞进起兵郡，看出征会不会把人全带走
  const t = fresh();
  const all = (ROSTER.byFaction.get("yuanshao") ?? []).map((o) => o.id);
  assert.ok(all.length > P.retinueCap + 3, "袁绍武将不足，测不出截断");
  for (const oid of all) t.stations[oid] = from.id;
  t.commanderies[from.id].garrison = 60000;
  // 目标调硬，让围城持续一季以上——一击破城的话军团当场解散，验不到 retinue
  t.commanderies[edge.to].garrison = 30000;
  t.commanderies[edge.to].defense = 100;

  const r = resolve(t, [{ faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO);
  const army = r.state.armies.find((a) => a.target === edge.to);
  assert.ok(army, "未形成围城");
  // 首版没截断：一支偏师能带走全部二十余将，治所当场空城
  assert.ok(army.retinue.length <= P.retinueCap,
    `随军 ${army.retinue.length} 人，超过上限 ${P.retinueCap}`);
  assert.equal(stationedAt(r.state, ROSTER, from.id).length, all.length - army.retinue.length,
    "留守人数对不上——随军者应当且仅当离开驻地");

  // 兵力上限：结算里也要卡，不能只写在候选标签上
  assert.ok(army.troops <= P.retinueCap * P.troopsPerOfficer,
    `出兵 ${army.troops} 超过 ${P.retinueCap} 将的统兵上限`);
});

test("编制：无名将之郡由龙套顶上，弱但不为零", () => {
  const t = fresh();
  const at = Object.values(t.commanderies).find((c) => c.owner === "yuanshao").id;
  for (const [oid, where] of Object.entries(t.stations)) {
    if (where === at) delete t.stations[oid];
  }
  const corps = retinueAt(t, ROSTER, at, P);
  assert.equal(corps.length, 1, "无名将之郡应恰有一名龙套");
  assert.ok(isFiller(corps[0]), "顶上的不是龙套");
  assert.ok(corps[0].leadership > 0 && corps[0].leadership < 60,
    "龙套五维应弱于基准值，但不为零");
  // 龙套不进 stations，也就不会被调走、被俘、或被算成「已有驻将」
  assert.equal(t.stations[corps[0].id], undefined, "龙套混进了驻地表");
});

test("内政不给空操作：已至上限的方针不该出现在候选里", () => {
  const t = fresh();
  const at = Object.values(t.commanderies).find((c) => c.owner === "yuanshao").id;
  // 顶满：产出 10、民心 5、城防 100、器械最高、存粮满仓。
  // 存粮是后加的一维：产出档一提，粮仓上限跟着涨（存粮上限由产出档定），
  // 于是只顶前四项的话「屯粮」会冒出来——那不是 bug，是这条测试少顶了一维
  // 存粮要顶到**真**上限（provCapOf：含仓廪 +2、方圆 +1），
  // 顶到 provisionsCap 那个基础值的话「屯粮」照样冒出来——
  // 而那不是候选的 bug，是这行少算了建筑与阵型
  Object.assign(t.commanderies[at], { yieldTier: 10, moraleTier: 5, defense: 100,
    gear: P.gearLadder[P.gearLadder.length - 1], garrison: 50000 });
  t.commanderies[at].provisions = provCapOf(t.commanderies[at], P);
  const cs = listActions(t, "yuanshao", G, P, undefined, ROSTER, undefined, GEO);
  const noop = cs.filter((c) => c.action.type === "govern" && c.action.at === at);
  // 「南郡 劝农（已至上限）」曾经每季都出现，白耗一条令
  assert.equal(noop.length, 0,
    `顶满的郡仍有 ${noop.length} 条内政候选：${noop.map((c) => c.key).join()}`);
});

test("调任：首次就任免费，调动已在任者收 1 令", () => {
  const t = fresh();
  const mineIds = Object.values(t.commanderies).filter((c) => c.owner === "yuanshao").map((c) => c.id);
  const cs = listActions(t, "yuanshao", G, P, undefined, ROSTER, undefined, GEO)
    .filter((c) => c.action.type === "appoint");
  assert.ok(cs.length > 0, "无调任候选");
  for (const c of cs) {
    const posted = !!t.stations[c.action.officer];
    assert.equal(c.cost, posted ? DEFAULT_RULES.normalAp : 0,
      `${c.key} 计费错了：已在任=${posted} 却收 ${c.cost} 令`);
  }
  // 免费无摩擦的调任会无限空转——实测同五人来回搬了十一季
  const moves = cs.filter((c) => t.stations[c.action.officer]);
  assert.ok(moves.length > 0, "没有一条是调动已在任者，测不到收费那一档");

  // 且只许由人多处调往人少处，否则 A→B 与 B→A 会同时是候选
  for (const c of moves) {
    const from = t.stations[c.action.officer];
    assert.ok(stationedAt(t, ROSTER, from).length > stationedAt(t, ROSTER, c.action.at).length,
      `${c.key} 是把人从少处调往多处，这会与反向那条构成来回搬`);
    assert.ok(mineIds.includes(c.action.at));
  }
});

test("外交：攻打盟友即背盟，全境民心 −1 且数季不得再缔盟", () => {
  const t = fresh();
  const from = Object.values(t.commanderies).find((c) => c.owner === "yuanshao");
  const edge = [...(G.adj.get(from.id) ?? [])]
    .find((e) => t.commanderies[e.to]?.owner && t.commanderies[e.to].owner !== "yuanshao");
  assert.ok(edge, "袁绍无可攻目标");
  const victim = t.commanderies[edge.to].owner;

  // 结成生效中的盟约
  const key = ["yuanshao", victim].sort();
  t.treaties.push({ a: key[0], b: key[1], kind: "alliance", from: 0, until: t.turn + 8 });
  const before = Object.values(t.commanderies)
    .filter((c) => c.owner === "yuanshao").map((c) => c.moraleTier);
  t.commanderies[from.id].garrison = 30000;

  const r = resolve(t, [{ faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "main", siegeGear: "none" } }],
    G, P, ROSTER, GEO).state;

  // 此前这里什么都不做：可以一边保着盟友给的情报、一边打他，零成本
  assert.ok(!r.treaties.some((x) => x.a === key[0] && x.b === key[1]), "盟约未作废");
  assert.ok(r.log.some((e) => e.kind === "ally-break" && e.text.includes("背盟")),
    `未记背盟：${r.log.map((e) => e.kind).join(",")}`);
  const after = Object.values(r.commanderies)
    .filter((c) => c.owner === "yuanshao").map((c) => c.moraleTier);
  assert.ok(after.some((m, i) => m < before[i]), "全境民心未受罚");
  assert.ok(r.factions.yuanshao.allyBanUntil > r.turn, "未禁缔盟");
});

test("外交：盟约到期后解约不算背盟，不收代价", () => {
  const t = fresh();
  const key = ["yuanshao", "caocao"].sort();
  // until 已过：这是自然到期，不是撕毁
  t.treaties.push({ a: key[0], b: key[1], kind: "alliance", from: 0, until: t.turn });
  const r = resolve(t, [{ faction: "yuanshao",
    action: { type: "ally", to: "caocao", act: "break", term: 4 } }],
    G, P, ROSTER, GEO).state;
  assert.equal(r.factions.yuanshao.allyBanUntil, 0, "到期解约不该禁缔盟");
  assert.ok(r.log.some((e) => e.kind === "ally-break" && !e.text.includes("背盟")),
    "到期解约被记成了背盟");
});

test("野战：城下已有敌围城军时，候选给的是野战预告而非攻城预告", () => {
  const t = fresh();
  // 在引擎**确实给出**的征伐目标上布置，而不是自己挑一个郡去假定它会被列出。
  // 候选表是有限预算（totalCap 60，各类型轮转填充），加一个动作类型就会挤掉
  // 别的类型的名额——写死某个目标的测试会在下次加动作时无端红掉
  const first = listActions(t, "yuanshao", G, P, undefined, ROSTER, undefined, GEO)
    .find((c) => c.key.startsWith("campaign:") && c.action.from !== c.action.target);
  assert.ok(first, "袁绍无可攻目标");
  const from = t.commanderies[first.action.from];
  const edge = { to: first.action.target };

  // 让第三方在目标城下驻一支围城军
  t.armies.push({ id: "x:0:foe", faction: "lubu", commander: null, retinue: [],
    troops: 30000, at: edge.to, target: edge.to, posture: "allout", gear: "none",
    unit: "infantry", siegeSeasons: 1, home: from.id });
  t.commanderies[from.id].garrison = 6000;

  const cs = listActions(t, "yuanshao", G, P, undefined, ROSTER, undefined, GEO)
    .filter((c) => c.key.startsWith(`campaign:${from.id}>${edge.to}`));
  assert.ok(cs.length > 0, "无该目标的征伐候选");
  for (const c of cs) {
    // 标签里写着「本令先野战」而结构化字段仍是攻城预告——机器人按攻城的
    // 缺口数打分，实际打的是野战。实测因此 57% 的野战在战力比 <0.8 时发起
    assert.ok(c.field, `${c.key} 缺野战预告`);
    assert.ok(c.field.ratioLo <= c.field.ratioHi);
    assert.ok(["可解围", "解不了", "未知"].includes(c.field.verdict));
    // 六千打三万，无论浮动怎么走都赢不了
    assert.equal(c.field.verdict, "解不了", `${c.key} 判词 ${c.field.text}`);
  }
});

test("野战：预告的判词与结算的判词同源", () => {
  // 阶梯若在 forecast 与 resolve 各写一份，两边算出的结果会对不上且不报错
  const ladder = [
    [P.fieldRout + 0.01, "溃退"], [P.fieldPush + 0.01, "后撤"],
    [P.fieldStall + 0.01, "相持"], [P.fieldStall - 0.01, "大败"],
  ];
  for (const [r, want] of ladder) {
    assert.equal(fieldOutcome(P, r).outcome, want, `战力比 ${r} 应判 ${want}`);
  }
  assert.equal(fieldOutcome(P, P.fieldRout).atkWins, true);
  assert.equal(fieldOutcome(P, P.fieldStall).atkWins, false, "相持不算攻方胜");
});

test("标签：候选报的主将与人数，必须是真出征的那几个", () => {
  const t = fresh();
  // 从**确实列得出征伐候选**的郡取样本。候选总额只有 totalCap 条，
  // 十三个郡分不到人人有份，硬取「第一个己方郡」测的就成了候选覆盖率
  const probe = listActions(t, "yuanshao", G, P, undefined, ROSTER, undefined, GEO)
    .find((c) => c.action.type === "campaign");
  assert.ok(probe, "袁绍一条征伐候选都没有，样本选不出来");
  const from = t.commanderies[probe.action.from];
  // 把远多于上限的武将堆进起兵郡
  const all = (ROSTER.byFaction.get("yuanshao") ?? []).map((o) => o.id);
  for (const oid of all) t.stations[oid] = from.id;
  t.commanderies[from.id].garrison = 40000;

  const cs = listActions(t, "yuanshao", G, P, undefined, ROSTER, undefined, GEO)
    .filter((c) => c.action.type === "campaign" && c.action.from === from.id
                   && c.key.startsWith("campaign:"));
  assert.ok(cs.length > 0, "无征伐候选");
  // 主将那一段夹在最后一个「，」与「领」之间，且不跨越分隔符
  const m = /[，,]([^，,；｜（]+?)(?:等 (\d+) 将)?领/.exec(cs[0].label.split("｜")[0]);
  assert.ok(m, `标签里没有主将：${cs[0].label}`);
  // 随军上限是 3，标签报「等 6 将领」就是在多报不出征的人
  if (m[2]) {
    assert.ok(Number(m[2]) <= P.retinueCap,
      `标签报了 ${m[2]} 将随军，上限是 ${P.retinueCap}：${cs[0].label}`);
  }
  // 主将必须是攻势排位第一，而不是按 id 排序的第一个
  const terrain = (G.adj.get(from.id) ?? []).find((e) => e.to === cs[0].action.target)?.terrain
    ?? "plain";
  const want = attackRetinue(retinueAt(t, ROSTER, from.id, P), P, terrain).members[0];
  assert.equal(m[1], want.name,
    `标签写着 ${m[1]} 领，实际出战的是 ${want.name}——两者必须一致`);
});

test("赴援：围在落地前被解掉，兵马必须退回而不是凭空消失", () => {
  const t = fresh();
  const from = Object.values(t.commanderies).find((c) => c.owner === "liubiao");
  const mine2 = Object.values(t.commanderies)
    .find((c) => c.owner === "liubiao" && c.id !== from.id
      && (G.adj.get(from.id) ?? []).some((e) => e.to === c.id));
  assert.ok(mine2, "刘表没有两个相邻的己方郡，测不了");

  // 己方郡被围 → 赴援候选成立；但结算时围城军已不在（本季撤围）
  // 围城方必须是剧本里真存在的势力，否则它的撤围令会被判「未知势力」
  t.armies.push({ id: "foe:0", faction: "yuanshu", commander: null, retinue: [],
    troops: 5000, at: mine2.id, target: mine2.id, posture: "allout", gear: "none",
    unit: "infantry", siegeSeasons: 1, home: from.id });
  // 对照必须是「同一季只有对方撤围」，不能拿季初的数比——
  // resolve 会跑完整一季，产出本来就会让守军增长
  const lift = { faction: "yuanshu", action: { type: "withdraw", army: "foe:0" } };
  const idle = resolve(structuredClone(t), [lift], G, P, ROSTER, GEO).state
    .commanderies[from.id].garrison;

  // 真实路径：围城方**同一季撤围**（撤围在征伐之前的阶段结算），
  // 而我的赴援令是在围还在时通过校验的。于是它落地时城下已无敌军
  const r = resolve(structuredClone(t), [lift, { faction: "liubiao",
    action: { type: "campaign", target: mine2.id, from: from.id,
              commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO).state;

  // 此前：扣了兵、直接 continue，一万多人凭空消失且战报一字不提
  assert.equal(r.commanderies[from.id].garrison, idle, "出征的兵没有退回");
  assert.ok(r.log.some((e) => e.kind === "campaign-void"),
    `未记「未及出战」：${r.log.map((e) => e.kind).join(",")}`);
});

test("目的：观测里的纪元要能据以决策 —— 序号本身不含信息", () => {
  const s = fresh();
  const o = observe(s, "yuanshao", G, P, ROSTER, GEO);
  const c = o.clock;
  assert.equal(c.epoch, 1);
  assert.equal(c.epochOf, P.epochCount, "不知道一共几个纪元，序号 1 说明不了进度");
  assert.equal(c.neutralWall, 0, "纪元一无主郡国不筑壁");
  assert.ok(c.nextNeutralWall > 0,
    "看不见下一纪元的筑壁速度，「换纪元之前把无主地捡了」就无从判断");
  assert.ok(c.epochEndsBy > 0 && c.epochEndsBy <= P.epochLimit,
    `本纪元剩余季数 ${c.epochEndsBy} 不在合理范围`);

  // 观测报的增速必须是**结算真正会用的**那一个，不是抄来的常数。
  // 把无主郡国的守军跑一季，看涨幅对不对得上
  const neutral = Object.values(s.commanderies).find((x) => !x.owner && x.garrison > 100);
  assert.ok(neutral, "剧本里没有无主郡国，测不出");
  const s2 = structuredClone(s);
  s2.epoch = 2;
  const o2 = observe(s2, "yuanshao", G, P, ROSTER, GEO);
  assert.equal(o2.clock.neutralWall, P.neutralWall[2] ?? 0,
    "纪元二报的筑壁速度与 params 里的不是同一个数");
  assert.equal(o2.clock.epochOf, P.epochCount);

  // 末纪元不发 nextNeutralGrowth：那是默认值不发的同一条口径
  const s3 = structuredClone(s);
  s3.epoch = P.epochCount;
  assert.equal(observe(s3, "yuanshao", G, P, ROSTER, GEO).clock.nextNeutralWall, undefined,
    "末纪元还在发「下一纪元筑壁速度」，白花 token");
});

test("调任候选要写明会不会换掉太守 —— 收入按太守政治打系数", () => {
  const s = fresh();
  const cands = listActions(s, "liubiao", G, P, undefined, ROSTER, undefined, GEO)
    .filter((c) => c.key.startsWith("appoint:"));
  assert.ok(cands.length > 0, "刘表无调任候选，测不出");

  for (const c of cands) {
    const gp = c.post?.govPolitics ?? null;
    const better = gp !== null && c.post.politics > gp;
    assert.equal(/｜太守政 \d+→\d+/.test(c.label), better,
      `「会不会换太守」与标签不一致：${c.label}`);
    // 换太守的那一段必须报**现任**的政治，不是随手一个数
    if (better) {
      const m = /｜太守政 (\d+)→(\d+)/.exec(c.label);
      assert.equal(Number(m[1]), gp, "标签里的现任太守政治与 governorOf 算的不是一个数");
      assert.equal(Number(m[2]), c.post.politics);
    }
  }
  // 不换太守时不发这一段——那是最常见的情形，逐条写一遍纯属浪费
  assert.ok(cands.some((c) => !/太守政/.test(c.label)), "每条都发了，等于没有条件");
});

test("存粮上限：候选与结算必须用同一个数，否则有仓廪的城永远填不满", () => {
  // 候选那边算上限用的是 provisionsCap（只按产出档），结算用 provCapOf（含仓廪 +2、
  // 方圆 +1）。差的后果是候选以为满了就不再列屯粮，而围城那只钟正是按存粮走的
  const s = fresh();
  const me = "yuanshao";
  const c = Object.values(s.commanderies).find((x) => x.owner === me);
  // 内政每郡只给一条候选（按优先级取第一条命中的），所以别的先顶满
  Object.assign(c, { yieldTier: 10, moraleTier: 5, defense: 100,
    gear: P.gearLadder[P.gearLadder.length - 1], garrison: 50000 });
  c.buildings = ["granary"];
  c.formation = "square";
  c.provisions = provisionsCap(c.yieldTier, P);      // 只按基础上限算「满」
  s.factions[me].gold = 9999;
  assert.ok(provCapOf(c, P) > c.provisions, "加了仓廪与方圆却没抬高上限");
  // 本测试检验存粮上限公式；放宽总候选预算，避免把全局轮转截断误当作公式错误。
  const keys = listActions(s, me, G, P, { ...DEFAULT_RULES, totalCap: 256 }, ROSTER, undefined, GEO)
    .filter((x) => x.key === `govern:${c.id}:stock`);
  assert.equal(keys.length, 1,
    `${c.id} 存粮 ${c.provisions}/${provCapOf(c, P)}，候选里却没有屯粮`);
});

test("定价不许两份：DEFAULT_RULES 与内容包必须逐项相同", () => {
  // 「规则即数据」的反例：令数的定价同时写在 pack 的 constants.定价 与
  // actions.ts 的 DEFAULT_RULES 里。眼下两份恰好一致，但没有任何东西拦着它们分家，
  // 而分家之后模型按包算、引擎按 TS 算，谁也不会报错
  const 定价 = PACK.constants["定价"];
  assert.equal(DEFAULT_RULES.normalAp, 定价["一般"], "一般令的定价两份对不上");
  assert.equal(DEFAULT_RULES.campaignAp, 定价["征伐"], "征伐令的定价两份对不上");
  assert.equal(DEFAULT_RULES.perCommanderyOrders, 定价["同郡每季上限"],
    "同郡每季上限两份对不上");
});

test("包里的数值常数不许没人读 —— 写了不读就是在对模型说谎", () => {
  // 实测抓到过一条真的：包里写「铁官让本郡器械常备」，引擎实际只降一级，
  // 而那个布尔量根本没人读。这条把「包里有、params 不读」的常数列出来，
  // 只放行确实由别处实现且已在此登记的几个
  const 允许 = new Set([
    "时钟.季每年",            // 季名表在界面里，引擎只按季序推进
    "定价.一般", "定价.征伐", "定价.同郡每季上限",  // 走 DEFAULT_RULES，上一条已对账
    "名器.授官_令",           // 走 rules.normalAp
    "名器.改授即撤前任", "名器.朝廷易主不作废",     // 行为由 resolve 实现，无参数可调
    "建筑.铁官_器械降级",      // 开关恒真，降几级由 铁官_降几级 驱动
  ]);
  const 旁白 = /说明|依据|理由|为何|意图|意义|教训|代价|出处|注$|接法|口径|记法|门槛/;
  const src = fs.readFileSync("lib/game/engine/params.ts", "utf8");
  const 漏读 = [];
  for (const [sec, body] of Object.entries(PACK.constants)) {
    if (!body || typeof body !== "object") continue;
    for (const [k, v] of Object.entries(body)) {
      if (typeof v !== "number" && typeof v !== "boolean") continue;
      if (旁白.test(k) || 允许.has(`${sec}.${k}`)) continue;
      if (!src.includes(`"${k}"`)) 漏读.push(`${sec}.${k}`);
    }
  }
  assert.deepEqual(漏读, [], `这些常数包里写了、params.ts 不读：${漏读.join("、")}`);
});

test("每条令占用哪个郡，从 key 里就看得出来", () => {
  // 想给候选补一个 sites 字段，结果实测**一条都发不出来**：占用的郡名全在 key 里，
  // 连集结也是（muster:中山国:中山国+安平国+河闲国 三个来源郡都在）。
  // 也就是说「同一郡每季至多 2 令」这件事模型本来就算得出来，
  // 它只是没去数——所以修法是提示词教它数，不是再塞一份数据。
  // 这条钉住那个前提：哪天有候选的令位不在 key 里，就得把 sites 加回来
  const s = fresh();
  for (const f of ["yuanshao", "caocao", "liubiao"]) {
    for (const c of listActions(s, f, G, P, DEFAULT_RULES, ROSTER, undefined, GEO)) {
      for (const id of orderSites(c.action)) {
        assert.ok(c.key.includes(id),
          `${c.key} 占用 ${id}，而 key 里看不出来 —— 模型无从数令位`);
      }
    }
  }
});

test("被丢的令要回授：不告诉模型，它就每季重犯同一个错", () => {
  // 第一份 48 局排行榜挖出来的：两个模型的非法率 7.6% / 9.4%，而 mojibake 与
  // unknown-key 都是 0——被丢的全是「单看每条都合法、合起来不合法」。
  // 规则在提示词里写着，模型照样每季重犯，因为我们把令丢掉却从不告诉它
  const s = fresh();
  const me = "yuanshao";
  const drops = [
    { key: "govern:魏郡:soothe", reason: "rejected", detail: "本郡本季已下满 2 令" },
    { key: "scout:河内郡", reason: "duplicate" },
    { key: "campaign:魏郡>河内郡:allout", reason: "over-budget", detail: "余 0 令，需 2" },
  ];
  const o = observe(s, me, G, P, ROSTER, GEO, { dropped: drops });
  assert.equal(o.droppedLastSeason?.length, 3, "被丢的令没进观测");
  assert.ok(o.droppedLastSeason.some((d) => d.why.includes("两遍")), "重复没说清");
  assert.ok(o.droppedLastSeason.some((d) => d.why.includes("令数不够")), "超预算没说清");
  // 干净的那些季不该多这一段：绝大多数季没有被丢的令，逐季声明纯属浪费
  assert.equal(observe(s, me, G, P, ROSTER, GEO, {}).droppedLastSeason, undefined,
    "没有被丢的令时也发了这一段");
});

test("界面的郡国表要与观测的 mine 段对得上 —— 人和模型不能看两场战争", () => {
  // 四方对账里最容易漏的一处：模型的观测里有存粮、器械、兵种、建筑，
  // 而界面那张「我的郡国」表只有兵产心防阵将——人少看四样，
  // 其中「粮」还是围城那只钟（被围每季 −1，归零则不战自下）。
  const obs = fs.readFileSync("lib/game/engine/observe.ts", "utf8");
  const client = fs.readFileSync("app/play/PlayClient.tsx", "utf8");
  const i = client.indexOf('className="lands"');
  const head = client.slice(i, client.indexOf("</thead>", i));
  for (const [field, col] of [["provisions", "粮"], ["gear", "械"],
                              ["built", "建"], ["unit", "种"]]) {
    assert.ok(obs.includes(`${field}`), `观测里没有 ${field}，这条对账的前提变了`);
    assert.ok(head.includes(`<th>${col}</th>`),
      `郡国表缺「${col}」列 —— 模型看得见 ${field}，人看不见`);
  }
});

test("候选标签里的 markdown 不许漏到界面上", () => {
  // 标签同时给模型与界面看：** 是给模型的强调（如「**天下共讨之**」），
  // 界面直出就是一对星号。界面那边剥掉，这条钉住「剥的规则还在」
  const client = fs.readFileSync("app/play/PlayClient.tsx", "utf8");
  assert.ok(/c\.label\.replace\(/.test(client),
    "界面渲染候选标签时没有剥掉 markdown 强调");
  // 图例是纯 JSX 文本，那儿写 ** 会原样显示
  const i = client.indexOf('className="legend"');
  const legend = client.slice(i, client.indexOf("</details>", i))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.ok(!legend.includes("**"), "图例里有 markdown 星号 —— JSX 不吃这个");
});

test("候选标签不重抄观测里已有的郡情 —— 一季十条内政等于抄十遍", () => {
  const s = fresh();
  const o = observe(s, "liubiao", G, P, ROSTER, GEO);
  const gov = o.candidates.filter((c) => c.key.startsWith("govern:"));
  assert.ok(gov.length >= 3, "内政候选太少，测不出");
  const mine = new Map(o.mine.map((m) => [m.id, m]));
  for (const c of gov) {
    const id = c.key.split(":")[1];
    const m = mine.get(id);
    assert.ok(m, `内政候选指向 ${id}，而它不在 mine[] 里`);
    // 这五项 mine[] 里逐郡都有，标签里再写一遍就是同一份信息付两次钱
    assert.ok(!/产\d/.test(c.label) && !/心\d/.test(c.label) && !/防\d/.test(c.label),
      `内政候选又抄了一遍郡情：${c.label}`);
    // 但引擎的优先级判断必须留着——那是别处推不出来的
    assert.match(c.label, /（[^）]*）$/, `内政候选没写「为什么是这一项」：${c.label}`);
  }
});

test("作废的令数要回传 —— 模型每季从零问答，不知道上季扔了几条", () => {
  let s = fresh();
  // 一条命令都不下：整季的令全剩下，超出结转上限的部分作废
  const before = s.factions.yuanshao.ap;
  assert.ok(before > P.carryCap, "袁绍开局令数不足以测出作废");
  const settled = resolve(s, [], G, P, ROSTER, GEO).state;
  assert.equal(settled.factions.yuanshao.carried, P.carryCap, "结转应顶到上限");
  assert.equal(settled.factions.yuanshao.wasted, before - P.carryCap,
    "作废量应是「余令 − 结转上限」");
  // refreshAp 把结转折进下季的 ap 并清零，但 wasted 要活到模型看见为止
  s = refreshAp(settled, P);
  assert.equal(s.factions.yuanshao.wasted, before - P.carryCap,
    "refreshAp 把作废量抹掉了 —— 那模型永远看不到它");
  const o = observe(s, "yuanshao", G, P, ROSTER, GEO);
  assert.equal(o.budget.wastedLastSeason, before - P.carryCap);

  // 为零时不发：那是默认值，逐季写一遍纯属浪费
  const spent = structuredClone(s);
  spent.factions.yuanshao.wasted = 0;
  assert.equal(observe(spent, "yuanshao", G, P, ROSTER, GEO).budget.wastedLastSeason, undefined,
    "没作废还发这一项，白花 token");
});

// ── 录像 ────────────────────────────────────────────────────────────
// 播放器跑不了引擎，所以帧里但凡有一个派生量算错，页面上就是**静默画错**。
// 这几条钉的都是「画错了看不出来」的那些字段。
const REPLAY_IDX = buildIndex(
  read("commanderies.json"),
  DATA.scenario.factions.map((f) => ({ id: f.id, name: f.name, color: f.color })),
  ["scale", "crane", "square"],
);

test("录像：郡序必须与 territory-grid 的 order 逐位相同", () => {
  // 这是唯一一处「疆域整体错位而且看不出来」的入口。播放器按下标查格子，
  // 一旦两边的顺序分家，画出来仍是一张像模像样的地图，只是每个郡都属于别人
  const grid = JSON.parse(fs.readFileSync("public/game/territory-grid.json", "utf8"));
  assert.deepEqual(REPLAY_IDX.dict.com, grid.order,
    "commanderies.json 的 id 序与 territory-grid 的 order 分家了");
  assert.equal(REPLAY_IDX.dict.xy.length, grid.order.length);
});

test("录像：采帧是纯读的 —— 它若改了状态，R33 逐位重放就废了", () => {
  const s = fresh();
  const before = JSON.stringify(s);
  captureFrame(s, REPLAY_IDX, G, P, ROSTER, GEO, []);
  assert.equal(JSON.stringify(s), before, "captureFrame 改了 GameState");
});

test("录像：派生量与引擎算的是同一个数，不是另抄一份", () => {
  const s = fresh();
  const f = captureFrame(s, REPLAY_IDX, G, P, ROSTER, GEO, []);
  const ci = REPLAY_IDX.ci, fi = REPLAY_IDX.fi;

  // 守军存**档位**，且必须是 tierOf 算的那一档 —— 与模型看到的迷雾同一把尺。
  // 自己另写一个分档公式（比如照抄 types.ts 里那句失效的「13 档 1.4」注释），
  // 播放器上显示的兵力档就与模型当时看到的对不上
  let checked = 0;
  for (const c of Object.values(s.commanderies)) {
    const i = ci.get(c.id);
    if (i === undefined) continue;
    assert.equal(f.gt[i], tierOf(c.garrison, P), `${c.id} 的守军档与 tierOf 不一致`);
    assert.equal(f.own[i], c.owner ? fi.get(c.owner) : -1, `${c.id} 的归属不对`);
    assert.equal(f.gov[i], governorOf(s, ROSTER, c.id, P)?.politics ?? 0);
    checked += 1;
  }
  assert.equal(checked, 105, `只核了 ${checked} 个郡`);

  // 断供：逐势力用 supplyReach 独立重算一遍，两边必须逐郡吻合
  const cut = new Set(f.cut);
  for (const [id] of Object.entries(s.factions)) {
    const reach = supplyReach(s, G, id);
    for (const c of Object.values(s.commanderies)) {
      if (c.owner !== id) continue;
      const i = ci.get(c.id);
      if (i === undefined) continue;
      assert.equal(cut.has(i), !reach.has(c.id), `${c.id} 的断供与 supplyReach 不符`);
    }
  }

  // 无主用 −1 而不是 null：播放器按 `f < 0` 判空，null 在数组里还多三个字节
  const nobody = Object.values(s.commanderies).find((c) => !c.owner);
  assert.ok(nobody, "剧本里没有无主郡，测不出");
  assert.equal(f.own[ci.get(nobody.id)], -1);
});

test("录像：多个模型席位的决策各录一份 —— 只录一席读不出对抗", () => {
  const s = fresh();
  const one = captureFrame(s, REPLAY_IDX, G, P, ROSTER, GEO, [],
    { seats: [{ faction: "caocao", picks: ["scout:东郡"], reason: "探路", plan: "取兖州" }] });
  assert.equal(one.seats.length, 1);
  assert.equal(one.seats[0].faction, REPLAY_IDX.fi.get("caocao"));
  assert.equal(one.seats[0].reason, "探路");

  const two = captureFrame(s, REPLAY_IDX, G, P, ROSTER, GEO, [], {
    seats: [{ faction: "caocao", reason: "求和" }, { faction: "liubiao", reason: "围城" }],
  });
  assert.equal(two.seats.length, 2, "第二席被丢了 —— 两家对打就只剩一边的说法");
  assert.deepEqual(two.seats.map((x) => x.reason), ["求和", "围城"]);
  // 没有模型席位（纯机器人局）就不发这一项
  assert.equal(captureFrame(s, REPLAY_IDX, G, P, ROSTER, GEO, []).seats, undefined);
});

test("录像：驻地只记变化，且第一帧要给全量 —— 否则播放器开局无将可显", () => {
  const s = fresh();
  const first = captureFrame(s, REPLAY_IDX, G, P, ROSTER, GEO, []);
  assert.equal(first.moves.length, Object.keys(s.stations).length,
    "第一帧（无 prevStations）应给出全部驻地");

  // 同一状态、把上一帧的驻地传回去，就该一条都不记
  const same = captureFrame(s, REPLAY_IDX, G, P, ROSTER, GEO, [],
    { prevStations: { ...s.stations } });
  assert.equal(same.moves.length, 0, "驻地没变却记了变化，等于把人名逐帧抄一遍");

  // 动一个人，只该记这一条
  const [oid, at] = Object.entries(s.stations)[0];
  const moved = structuredClone(s);
  const other = Object.values(s.commanderies).find((c) => c.id !== at);
  moved.stations[oid] = other.id;
  const one = captureFrame(moved, REPLAY_IDX, G, P, ROSTER, GEO, [],
    { prevStations: { ...s.stations } });
  assert.deepEqual(one.moves, [[oid, REPLAY_IDX.ci.get(other.id)]]);
});

test("录像：日志折掉流水账，但不许折掉破城", () => {
  const frame = { ev: [] };
  attachOutcome(frame, [
    { kind: "treasury", faction: "caocao", text: "国库" },
    { kind: "govern", faction: "caocao", text: "内政" },
    { kind: "scout", faction: "caocao", text: "刺探" },
    { kind: "siege-win", faction: "caocao", text: "破城" },
    { kind: "capital-lost", faction: "lubu", text: "治所失守" },
    { kind: "supply-cut", faction: "lubu", text: "断供" },
  ], REPLAY_IDX.fi);
  const kinds = frame.ev.map((e) => e[0]);
  assert.ok(!kinds.includes("treasury") && !kinds.includes("govern") && !kinds.includes("scout"),
    "流水账没折掉 —— 48 季实测这几类占了大半，铺出来会盖掉真正重要的那一两条");
  assert.ok(kinds.includes("siege-win") && kinds.includes("capital-lost"),
    "把破城或治所失守折掉了 —— 那是这局唯一要看的东西");
  assert.ok(kinds.includes("supply-cut"), "断供是决定性的，不能折");
  assert.equal(frame.ev[0][1], REPLAY_IDX.fi.get("caocao"), "势力下标不对");

  // 外交与集结折成一行计数：三十家每季互相缔盟绝盟，逐条铺会把破城埋掉
  const f2 = { ev: [] };
  attachOutcome(f2, [
    { kind: "ally", faction: "caocao", text: "缔盟" },
    { kind: "ally", faction: "lubu", text: "缔盟" },
    { kind: "ally-break", faction: "lubu", text: "绝盟" },
    { kind: "muster", faction: "caocao", text: "集结" },
    { kind: "siege-win", faction: "caocao", text: "破城" },
  ], REPLAY_IDX.fi);
  assert.equal(f2.ev.length, 2, `外交没折成一行：${JSON.stringify(f2.ev)}`);
  assert.equal(f2.ev[0][0], "siege-win", "破城应当留在最前，不被折进计数");
  assert.equal(f2.ev[1][0], "fold");
  assert.match(f2.ev[1][2], /2 起结盟/);
  assert.match(f2.ev[1][2], /1 起绝盟/);
  assert.match(f2.ev[1][2], /1 处集结/);

  // 一条都没有时不发那一行
  const f3 = { ev: [] };
  attachOutcome(f3, [{ kind: "siege-win", faction: "caocao", text: "破城" }], REPLAY_IDX.fi);
  assert.equal(f3.ev.length, 1, "没有外交却发了计数行");
});

test("待命军团会归队 —— 否则它是状态里的一处泄漏", () => {
  let s = fresh();
  const home = Object.values(s.commanderies).find((c) => c.owner === "yuanshao" && c.garrison > 2000);
  assert.ok(home, "找不到袁绍的驻兵郡");
  const before = home.garrison;

  // 手造一支待命军团（无进攻目标），兵力足、刚集结
  s.armies.push({ id: "t:idle", faction: "yuanshao", commander: null, retinue: [],
    troops: 3000, at: home.id, target: null, posture: "main", gear: "none",
    unit: home.unit, siegeSeasons: 0, idleSeasons: 0, home: home.id });
  s.commanderies[home.id].garrison -= 3000;

  // 站满 armyIdleLimit 季就归队。之前每一季都不该动它
  for (let i = 0; i < P.armyIdleLimit - 1; i += 1) {
    s = refreshAp(resolve(s, [], G, P, ROSTER, GEO).state, P);
    assert.ok(s.armies.some((a) => a.id === "t:idle"),
      `第 ${i + 1} 季就把待命军团收了 —— 门槛是 ${P.armyIdleLimit} 季`);
  }
  s = refreshAp(resolve(s, [], G, P, ROSTER, GEO).state, P);
  assert.ok(!s.armies.some((a) => a.id === "t:idle"), "站满季数仍没归队");
  assert.ok(s.log.some((e) => e.kind === "muster-return"), "归队没有记进战报——那就是静默扣兵");
  // 兵要退回去，不是蒸发
  assert.ok(s.commanderies[home.id].garrison >= before - 200,
    `兵没退回去：${before} → ${s.commanderies[home.id].garrison}`);

  // 兵力跌破下限的当季就该收——它什么也打不动了
  let t = fresh();
  const h2 = Object.values(t.commanderies).find((c) => c.owner === "liubiao");
  t.armies.push({ id: "t:thin", faction: "liubiao", commander: null, retinue: [],
    troops: P.armyMinTroops - 1, at: h2.id, target: null, posture: "main", gear: "none",
    unit: h2.unit, siegeSeasons: 0, idleSeasons: 0, home: h2.id });
  t = resolve(t, [], G, P, ROSTER, GEO).state;
  assert.ok(!t.armies.some((a) => a.id === "t:thin"),
    `兵力 ${P.armyMinTroops - 1} < 下限 ${P.armyMinTroops}，本季就该归队`);

  // **围城军不算待命**：它在敌境，归队会把围城凭空解掉
  let u = fresh();
  const foe = Object.values(u.commanderies).find((c) => c.owner && c.owner !== "yuanshao");
  u.armies.push({ id: "t:siege", faction: "yuanshao", commander: null, retinue: [],
    troops: 100, at: foe.id, target: foe.id, posture: "main", gear: "none",
    unit: "infantry", siegeSeasons: 0, idleSeasons: 0, home: home.id });
  u = resolve(u, [], G, P, ROSTER, GEO).state;
  const still = u.armies.find((a) => a.id === "t:siege");
  assert.ok(!still || still.target, "围城军被当成待命军团收走了");
});

test("录像的阵型下标必须与引擎同源 —— 手抄一次就静默错一半", () => {
  // 此前 replay.ts 里手写的是 ["scale","crane","square"]，而引擎是 "wings"。
  // indexOf 返回 −1、被 Math.max(0,…) 兜成 0，于是每一个鹤翼郡都显示成鱼鳞，
  // 不报错、不崩、只是一直错
  assert.deepEqual(FORM_IDS, Object.keys(FORMATION_CN));
  const s = fresh();
  const f = captureFrame(s, REPLAY_IDX, G, P, ROSTER, GEO, []);
  let checked = 0;
  for (const c of Object.values(s.commanderies)) {
    const i = REPLAY_IDX.ci.get(c.id);
    if (i === undefined) continue;
    assert.equal(FORM_IDS[f.fm[i]], c.formation, `${c.id} 的阵型对不上`);
    checked += 1;
  }
  assert.equal(checked, 105);
  // 三种阵型都要出现过，否则这条测试可能只是碰巧全对
  assert.equal(new Set(Object.values(s.commanderies).map((c) => c.formation)).size, 3);
});

test("同郡至多一支待命军团，且出征取兵力最多的那支", () => {
  let s = fresh();
  const me = "yuanshao";
  const at = Object.values(s.commanderies).find((c) => c.owner === me && c.garrison > 4000);
  assert.ok(at, "找不到袁绍的驻兵郡");

  // 连下两条集结令到同一个郡：应当并成一支，不是两支
  const src = (G.adj.get(at.id) ?? []).map((e) => e.to)
    .filter((id) => s.commanderies[id]?.owner === me).slice(0, 1);
  assert.ok(src.length, "这个郡没有己方邻郡，测不出集结");
  const order = { faction: me, action: { type: "muster", at: at.id, from: [at.id, ...src],
                                         commander: null, deadline: 1 } };
  s = resolve(s, [order], G, P, ROSTER, GEO).state;
  const after1 = s.armies.filter((a) => a.faction === me && a.at === at.id && !a.target);
  assert.equal(after1.length, 1, "第一条集结没生成军团");
  const t1 = after1[0].troops;
  s = refreshAp(s, P);
  s = resolve(s, [order], G, P, ROSTER, GEO).state;
  const after2 = s.armies.filter((a) => a.faction === me && a.at === at.id && !a.target);
  assert.equal(after2.length, 1,
    `同郡叠出 ${after2.length} 支待命军团 —— 此前一局末季上党郡叠到 39 支`);
  assert.ok(after2[0].troops > t1, "第二条集结的兵没并进去");

  // **一支残军不许劫持整个郡的出征兵力**
  let u = fresh();
  // 从**确实列得出征伐候选**的郡里取样本。候选总额只有 totalCap 条，
  // 十三个郡分不到人人有份，硬取「第一个守军 >8000 的郡」测的就成了候选覆盖率，
  // 而这条要验的是「一支残军不许劫持整郡的出征兵力」
  const base = listActions(u, me, G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
    .filter((c) => c.action.type === "campaign"
                   && u.commanderies[c.action.from].garrison > 8000);
  assert.ok(base.length, "袁绍一条从大郡出发的征伐候选都没有，样本选不出来");
  const from = u.commanderies[base[0].action.from];
  const foe = base[0].action.target;
  // 手塞一支大的和一支小的（模拟合并前的历史数据）
  for (const [n, t] of [["big", 9000], ["tiny", 7]]) {
    u.armies.push({ id: `x:${n}`, faction: me, commander: null, retinue: [], troops: t,
      at: from.id, target: null, posture: "main", gear: "none", unit: from.unit,
      siegeSeasons: 0, idleSeasons: 0, supply: P.armySupplyCap, home: from.id });
  }
  const cands = listActions(u, me, G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
    .filter((c) => c.key.startsWith(`campaign:${from.id}>${foe}`));
  assert.ok(cands.length, "没有从这个郡打过去的候选");
  assert.match(cands[0].label, /9,?000|8,?\d{3}/,
    `候选标签取到了小的那支：${cands[0].label}`);
});

test("出征超编的兵要退回起兵郡 —— 不能凭空蒸发", () => {
  // 对照法：同一局面跑两次，军团一次正好等于出征上限、一次超编 8000。
  // 起兵郡守军的差应当正好是 8000——一季就破城时军团会消失，
  // 直接找「在外军团」是找不到的
  const me = "yuanshao";
  const run = (extra) => {
    const s = fresh();
    const from = Object.values(s.commanderies).find((c) => c.owner === me);
    const foe = (G.adj.get(from.id) ?? []).map((e) => e.to)
      .find((id) => s.commanderies[id]?.owner && s.commanderies[id].owner !== me);
    assert.ok(foe, "找不到临敌郡");
    const cap = P.retinueCap * P.troopsPerOfficer;
    s.armies.push({ id: "x:a", faction: me, commander: null, retinue: [], troops: cap + extra,
      at: from.id, target: null, posture: "main", gear: "none", unit: from.unit,
      siegeSeasons: 0, idleSeasons: 0, home: from.id });
    const r = resolve(s, [{ faction: me, action: { type: "campaign", from: from.id,
      target: foe, strength: "allout", commander: null, siegeGear: "none" } }], G, P, ROSTER, GEO);
    return r.state.commanderies[from.id].garrison;
  };
  const base = run(0), over = run(8000);
  assert.equal(over - base, 8000,
    `超编的兵没退回去：正好够上限时守军 ${base}，超编 8000 时 ${over}，差 ${over - base}`);
});

test("治所失守之后要有活路 —— 迁治", () => {
  let s = fresh();
  const me = "yuanshao";
  const cap = s.factions[me].capital;
  assert.ok(cap, "袁绍没有治所");
  const mine = Object.values(s.commanderies).filter((c) => c.owner === me && c.id !== cap);
  assert.ok(mine.length, "袁绍只有一个郡，测不出");

  // 治所还在时不该出现迁治候选——那时候迁治几乎总是坏主意，列出来只是噪声
  assert.ok(!listActions(s, me, G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
    .some((c) => c.key.startsWith("relocate:")), "治所没事却列出了迁治");

  // 把治所判给别人
  s.commanderies[cap].owner = "caocao";
  const cands = listActions(s, me, G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
    .filter((c) => c.key.startsWith("relocate:"));
  assert.ok(cands.length, "治所已失却没有迁治候选 —— 那就是没有活路");
  assert.match(cands[0].label, /治所已失/);

  // 下季生效：当季仍按旧治所算，所以「全境政令不通」照旧
  const to = cands[0].key.split(":")[1];
  const r1 = resolve(s, [{ faction: me, action: { type: "relocate", to } }], G, P, ROSTER, GEO);
  assert.ok(r1.state.log.some((e) => e.kind === "capital-lost" && e.faction === me),
    "迁治当季就免了断供 —— 那治所失守这一击就不痛了");
  assert.equal(r1.state.factions[me].capital, to, "结算末尾应当已经生效");

  // 生效之后不再断供
  const r2 = resolve(refreshAp(r1.state, P), [], G, P, ROSTER, GEO);
  assert.ok(!r2.state.log.slice(r1.state.log.length)
    .some((e) => e.kind === "capital-lost" && e.faction === me),
    "迁治生效了却还在报治所已失");

  // 迁到别人的郡不合法
  const foe = Object.values(s.commanderies).find((c) => c.owner && c.owner !== me);
  assert.ok(validate(s, { faction: me, action: { type: "relocate", to: foe.id } },
    G, P, DEFAULT_RULES), "迁治到他方郡国居然合法");

  // 下令当季新治所又丢了 → 迁治作废，不能凭空得到一个别人的治所
  let t = fresh();
  t.commanderies[t.factions[me].capital].owner = "caocao";
  const t2 = Object.values(t.commanderies).find((c) => c.owner === me);
  t.factions[me].pendingCapital = t2.id;
  t.commanderies[t2.id].owner = "caocao";
  const r3 = resolve(t, [], G, P, ROSTER, GEO).state;
  assert.notEqual(r3.factions[me].capital, t2.id, "迁到一个已经不属于自己的郡");
});

test("无主郡只筑壁不征兵 —— 没人占的地方没有兵役", () => {
  let s = fresh();
  s.epoch = P.epochCount;
  assert.ok((P.neutralWall[s.epoch] ?? 0) > 0, "末纪元不筑壁，测不出");
  const n0 = Object.values(s.commanderies).find((c) => !c.owner && c.defense < P.neutralWallCap);
  assert.ok(n0, "没有可测的无主郡");
  const g0 = n0.garrison, d0 = n0.defense;

  for (let i = 0; i < 40; i += 1) s = refreshAp(resolve(s, [], G, P, ROSTER, GEO).state, P);
  const now = s.commanderies[n0.id];
  assert.ok(!now.owner, "这个郡被拿走了，测不出");

  // **守军不涨，反而渐散**。此前是每季 +15% 复利，84 季 14 万倍，
  // 于是 13 个无主郡有 10 个长到满档、从第 20 季起一个都没易过手。
  // 改成不增之后又发现另一半没做：守军原地不动，于是**开局的守军数就决定了
  // 这个郡这一局会不会被人碰**——实测活到终局的无主郡清一色是开局守军就大的。
  // 城墙是本地豪强维持的（坞壁），职业戍卒没人发饷会走，所以逐季散
  assert.ok(now.garrison < g0, `守军没散：${g0} → ${now.garrison}`);
  assert.ok(now.garrison >= Math.round(g0 * P.neutralDecayFloor) - 1,
    `散过头了：${g0} → ${now.garrison}，下限该是开局的 ${P.neutralDecayFloor}`);
  // 城防要涨，但封顶
  assert.ok(now.defense > d0, "城防一点没涨，那「早取有时间价值」就没了");
  assert.ok(now.defense <= P.neutralWallCap, `城防 ${now.defense} 超过上限 ${P.neutralWallCap}`);
  assert.equal(now.defense, P.neutralWallCap, "四十季之后该顶到上限");
});

test("行军：远路之师在途，不算在城下", () => {
  // 出征此前是瞬移：军团一造出来就站在敌城下、当季就打。行军耗时只有在围城
  // 成了时钟之后才有意义——守方存粮给了援军一个窗口，行军决定援军赶不赶得到。
  //
  // 在途最容易出的错是「还在路上的军队就把敌郡产出冻住了」。这条把
  // 每一处「城下有没有兵」的判据一起钉住
  const s = fresh();
  // 找一条**慢路**：行军季数 > 0。不能钉死席位——袁绍在中原，一条慢路都没有；
  // 实测三十家里十八家如此，而南中夷 100%、刘璋 71%
  let pick = null;
  for (const c of Object.values(s.commanderies)) {
    if (!c.owner) continue;
    for (const e of G.adj.get(c.id) ?? []) {
      const t = s.commanderies[e.to];
      if (!t || t.owner === c.owner) continue;
      // 算行军要带**起兵郡的阵型**，与引擎同一个调用：鹤翼少走一季，
      // 不带的话这里挑出来的「慢路」在引擎里可能是当季即至（实测就这么漏过一次）
      if (marchSeasons(e.cost, false, P, c.formation) > 0) { pick = { from: c, to: t }; break; }
    }
    if (pick) break;
  }
  assert.ok(pick, "全图没有一条慢路，样本选不出来 —— 调 constants.行军");
  const me = pick.from.owner;

  s.commanderies[pick.from.id].garrison = 40000;
  const prov0 = pick.to.provisions;
  const r = resolve(s, [{ faction: me, action: { type: "campaign",
    target: pick.to.id, from: pick.from.id, commander: null,
    strength: "allout", siegeGear: "none" } }], G, P, ROSTER, GEO).state;

  const army = r.armies.find((a) => a.target === pick.to.id && a.faction === me);
  assert.ok(army, "军团没造出来");
  assert.equal(army.siegeSeasons, 0, "在途不该记已围季数");
  // 出征那一季它在路上：城照常过日子——存粮不减、产出不停
  assert.equal(r.commanderies[pick.to.id].provisions, prov0, "还在路上就把守方的粮扣了");
  assert.ok(!r.log.some((e) => e.kind === "besieged" && (e.text ?? "").includes(pick.to.id)),
    "还在路上就把敌郡的产出冻住了");
  assert.ok(r.log.some((e) => e.kind === "march-out"), "出发那一季没有交代兵已经动了");
  assert.equal(r.commanderies[pick.to.id].owner, pick.to.owner, "还在路上就把城打下来了");

  // 下一季才动手
  const mark = r.log.length;
  const r2 = resolve(refreshAp(r, P), [], G, P, ROSTER, GEO).state;
  assert.ok(r2.log.slice(mark).some((e) => e.kind === "march-arrive" || e.kind === "march"),
    "下一季没有行军推进的记载");
  const fought = r2.log.slice(mark).some((e) =>
    ["siege-win", "siege-hold", "siege-starve", "siege-abort"].includes(e.kind));
  assert.ok(fought, "抵达之后一季仍不动手 —— 行军没走完还是压根没接上？");
});

test("行军：带器械行迟，可能错过本季这一击", () => {
  // 「带械攻城更易，却可能错过本季这一击」——这是行军耗时给每一家都造出的取舍，
  // 而慢路那一条只有一半的席位摊得上（实测三十家里十八家一条慢路都没有）
  const a = adjacency.edges.filter((e) => marchSeasons(e.cost, false, P) === 0
                                       && marchSeasons(e.cost, true, P) > 0);
  assert.ok(a.length > 0, "没有一条边会因带械而变慢 —— 带械行迟这条等于没有");
  const all = adjacency.edges.length;
  const slowLight = adjacency.edges.filter((e) => marchSeasons(e.cost, false, P) > 0).length;
  const slowGear = adjacency.edges.filter((e) => marchSeasons(e.cost, true, P) > 0).length;
  assert.ok(slowGear > slowLight, "带械没让任何一条边变慢");
  // 两头都要留：全慢则无人敢出兵，全快则这条规则不存在
  assert.ok(slowLight / all < 0.5, `轻兵就有 ${(slowLight / all * 100).toFixed(0)}% 的边是慢路，太多`);
  assert.ok(slowGear / all < 0.6, `带械有 ${(slowGear / all * 100).toFixed(0)}% 的边是慢路，太多`);
});

test("围城：被围之城不得募兵——一条令就能把围城时钟按停", () => {
  // 这条规则包里**早就写着**（「围城期间城中不得补兵，否则守军逐季回血，
  // 缺口累加被抵消，围困永远推不动进度」），但一直只实现在产出那一路。
  // 算术很要命：攻守比每季 ×(1−攻方损耗)/(1−守方损耗)=1.1733，
  // 而一条募兵令是 ×1.18 —— ρ_eff = 0.9944 ≤ 1，时钟当场停摆
  const rho = (1 - P.siegeAttackerLoss) / (1 - P.siegeDefenderLoss);
  assert.ok(P.levyMultiplier >= rho,
    `募兵倍率 ${P.levyMultiplier} 已低于攻守比乘数 ${rho.toFixed(4)}，这条禁令的由头没了`);

  const s = fresh();
  const { from, edge } = attackPair(s, "yuanshao");
  s.commanderies[from.id].garrison = 60000;
  s.commanderies[edge.to].garrison = 12000;
  s.commanderies[edge.to].defense = 100;
  const cur = resolve(s, [{ faction: "yuanshao", action: { type: "campaign",
    target: edge.to, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO).state;
  assert.ok(cur.armies.some((a) => a.target === edge.to), "没围上，测不出");

  const defender = cur.commanderies[edge.to].owner;
  const levy = { faction: defender, action: { type: "govern", at: edge.to, policy: "levy" } };
  assert.ok(validate(cur, levy, G, undefined, ROSTER, P), "被围之城仍可募兵");
  const stock = { faction: defender, action: { type: "govern", at: edge.to, policy: "stock" } };
  assert.equal(validate(cur, stock, G, undefined, ROSTER, P), null,
    "被围之城连屯粮都不许，那守方就没有反制了");
  // 候选里也不能出现——否则「按界面贪心勾选，引擎不应拒绝任何一条」当场破
  const cs = listActions(cur, defender, G, P, undefined, ROSTER, undefined, GEO);
  assert.ok(!cs.some((c) => c.key === `govern:${edge.to}:levy`),
    "候选里还列着被围之城的募兵");
});

test("围城：合围——四面都是我的地，不必再问带了多少人", () => {
  // 只看兵力比是错的，而且错得很具体：首攻失手折 35%，于是一支本来与守军相当的
  // 部队打完就掉到 0.65 倍，围不住了，守方一兵不损、存粮不减，僵在那儿。
  // 实测进入新一季的围城军里 33% 卡在这一条，是所有去向里最大的一项。
  // 史实上封锁靠的是控制道路而不是跟守军拼人数
  const s = fresh();
  const me = "yuanshao";
  // 找一个郡：它的邻郡半数以上已属袁绍
  let tid = null;
  for (const c of Object.values(s.commanderies)) {
    if (c.owner === me) continue;
    const nbs = (G.adj.get(c.id) ?? []).map((e) => s.commanderies[e.to]).filter(Boolean);
    if (nbs.length >= 2 && nbs.filter((n) => n.owner === me).length * 2 > nbs.length) {
      tid = c.id; break;
    }
  }
  if (!tid) {
    // 开局没有现成的合围样本就手造一个：把某郡的邻郡都划给袁绍
    const c = Object.values(s.commanderies).find((x) => x.owner && x.owner !== me
      && (G.adj.get(x.id) ?? []).length >= 2);
    for (const e of G.adj.get(c.id) ?? []) s.commanderies[e.to].owner = me;
    tid = c.id;
  }
  const from = (G.adj.get(tid) ?? []).map((e) => s.commanderies[e.to])
    .find((n) => n.owner === me);
  // 兵力**远不足**守军的一半：只靠合围
  s.commanderies[tid].garrison = 40000;
  s.commanderies[tid].defense = 100;
  from.garrison = 3000;
  const prov0 = s.commanderies[tid].provisions;

  const cur = resolve(s, [{ faction: me, action: { type: "campaign",
    target: tid, from: from.id, commander: null, strength: "allout", siegeGear: "none" } }],
    G, P, ROSTER, GEO).state;
  const army = cur.armies.find((a) => a.target === tid);
  assert.ok(army, "军团没站到城下");
  assert.ok(army.troops < cur.commanderies[tid].garrison * P.siegeGripRatio,
    `兵力 ${army.troops} 已达守军的 ${P.siegeGripRatio} 倍，测的就不是合围了`);
  assert.equal(cur.commanderies[tid].provisions, prov0 - siegeEat(cur.commanderies[tid], P),
    "四面都是我的地，却没断得了它的粮 —— 合围没生效");
});

test("孤悬：四邻皆属一家，不必出兵，粮尽即归附", () => {
  // 一郡的四邻全属同一家而它不属那一家，就已经是海中孤岛：出不去、进不来、援不至。
  // 此前只有「派兵去围」一条路，而围城要 2 令、要够兵力围得住、还要熬过守方的存粮
  // ——于是机器人宁可去打别处，孤岛一直挂在图上：实测 6 局 40 季里这样的郡·季 66 个
  const s = fresh();
  const me = "yuanshao";
  const victim = Object.values(s.commanderies)
    .find((c) => c.owner && c.owner !== me && (G.adj.get(c.id) ?? []).length >= 2);
  for (const e of G.adj.get(victim.id) ?? []) s.commanderies[e.to].owner = me;
  const prov0 = s.commanderies[victim.id].provisions;
  const loser = victim.owner;

  let cur = s;
  for (let i = 0; i < prov0 + 1; i += 1) {
    cur = resolve(refreshAp(cur, P), [], G, P, ROSTER, GEO).state;
    if (cur.commanderies[victim.id].owner === me) break;
  }
  assert.equal(cur.commanderies[victim.id].owner, me,
    `四邻皆属 ${me}，围了 ${prov0 + 1} 季仍不归附`);
  assert.ok(cur.log.some((e) => e.kind === "isolated-submit"), "没有举郡归附的记载");
  assert.notEqual(loser, me, "样本选错了");

  // **不是立刻归附**：立刻等于奖励「围而不打」，把四邻占全就白得一个郡
  const t = fresh();
  for (const e of G.adj.get(victim.id) ?? []) t.commanderies[e.to].owner = me;
  const one = resolve(t, [], G, P, ROSTER, GEO).state;
  assert.notEqual(one.commanderies[victim.id].owner, me, "第一季就白送了");
  assert.equal(one.commanderies[victim.id].provisions,
    prov0 - siegeEat(one.commanderies[victim.id], P), "孤悬却没扣粮");
});

test("归附：无主郡周围只有一家势力，久之举郡归附；两家以上则是四战之地", () => {
  const s = fresh();
  const me = "yuanshao";
  const n0 = Object.values(s.commanderies).find((c) => !c.owner
    && (G.adj.get(c.id) ?? []).length >= 2);
  assert.ok(n0, "没有无主郡，测不出");
  // 只让袁绍一家接壤：其余邻郡设为无主
  for (const e of G.adj.get(n0.id) ?? []) s.commanderies[e.to].owner = null;
  const first = (G.adj.get(n0.id) ?? [])[0].to;
  s.commanderies[first].owner = me;

  let cur = s;
  for (let i = 0; i < P.swaySeasons + 1; i += 1) {
    cur = resolve(refreshAp(cur, P), [], G, P, ROSTER, GEO).state;
    if (cur.commanderies[n0.id].owner) break;
  }
  assert.equal(cur.commanderies[n0.id].owner, me,
    `四境唯袁绍一家，${P.swaySeasons + 1} 季仍不归附`);
  assert.ok(cur.log.some((e) => e.kind === "sway-submit"), "没有举郡归附的记载");

  // 两家以上接壤则归零 —— 四战之地谁也别想白拿。
  // 实测终局幸存的四个无主郡（颍川、豫章、苍梧、郁林）**全是**这一种：
  // 颍川邻郡分属五家，郁林与苍梧各有士燮与刘表两家
  const t = fresh();
  const n1 = Object.values(t.commanderies).find((c) => !c.owner
    && (G.adj.get(c.id) ?? []).length >= 2);
  const nbs = (G.adj.get(n1.id) ?? []).map((e) => e.to);
  t.commanderies[nbs[0]].owner = me;
  t.commanderies[nbs[1]].owner = "lubu";
  let two = t;
  for (let i = 0; i < P.swaySeasons + 2; i += 1) {
    two = resolve(refreshAp(two, P), [], G, P, ROSTER, GEO).state;
  }
  assert.equal(two.commanderies[n1.id].sway, 0, "两家接壤却在累积归附意向");
  assert.ok(!two.commanderies[n1.id].owner, "四战之地被白送了");
});

test("名器：授官须持朝廷，一州一牧，持号者可在四战之地传檄而定", () => {
  // 借自《宏图策：三国》「挟天子以令诸侯」那一路。它值得做的理由与联军相同：
  // 不往战力上乘系数，而是改变一个州里的郡**怎么归属**——档位判的正是郡数与
  // 控州的增量。实测终局幸存的十个无主郡里，颍川、梁国、鲁国（豫州三郡）
  // 与河南尹（司隶）全是四战之地：邻郡分属四五家，四境唯一那条永远不成立，
  // 于是它们在四十季里一动不动。名分是唯一一条不必先打赢就能收它们的路
  const s = fresh();
  const court = P.courtSeat;
  const holder = s.commanderies[court].owner;
  assert.ok(holder, "朝廷所在之郡无主，测不出");

  // 找一个四战之地：无主、且邻郡分属两家以上
  const lordsOf = (t, id) => new Set((G.adj.get(id) ?? [])
    .map((e) => t.commanderies[e.to]?.owner).filter(Boolean));
  const spot = Object.values(s.commanderies)
    .find((c) => !c.owner && lordsOf(s, c.id).size >= 2);
  assert.ok(spot, "没有四战之地，测不出");
  const zhou = GEO.zhouOf.get(spot.id);
  const claimant = [...lordsOf(s, spot.id)][0];

  // 一、不持朝廷者授不得官
  const notCourt = Object.keys(s.factions).find((f) => f !== holder
    && !s.factions[f].eliminated);
  assert.ok(validate(s, { faction: notCourt, action: { type: "invest", zhou, to: notCourt } },
    G, DEFAULT_RULES, ROSTER, P), "不持朝廷的也授得了官");
  assert.equal(validate(s, { faction: holder, action: { type: "invest", zhou, to: claimant } },
    G, DEFAULT_RULES, ROSTER, P), null, "持朝廷者反而授不了");

  // 二、授出之后，持号者在该州的无主郡上照样累积意向——即使有多家接壤
  let cur = resolve(refreshAp(s, P),
    [{ faction: holder, action: { type: "invest", zhou, to: claimant } }],
    G, P, ROSTER, GEO).state;
  assert.deepEqual(cur.factions[claimant].governorships.includes(zhou), true, "号没授出去");
  for (let i = 0; i < P.swaySeasons + 1; i += 1) {
    cur = resolve(refreshAp(cur, P), [], G, P, ROSTER, GEO).state;
    if (cur.commanderies[spot.id].owner) break;
  }
  assert.equal(cur.commanderies[spot.id].owner, claimant,
    `${claimant} 持${zhou}牧之号，${P.swaySeasons + 1} 季仍收不到 ${spot.id}`);
  assert.ok(cur.log.some((e) => e.kind === "sway-submit" && e.text.includes("传檄而定")),
    "收是收了，却不是凭名分收的");

  // 三、同一局面下没有名分则收不到 —— 这是对照组，不是重复
  let bare = refreshAp(fresh(), P);
  for (let i = 0; i < P.swaySeasons + 2; i += 1) {
    bare = resolve(refreshAp(bare, P), [], G, P, ROSTER, GEO).state;
  }
  assert.ok(!bare.commanderies[spot.id].owner, "没名分也白收了一个四战之地");

  // 四、一州一牧：改授即撤前任
  const other = [...lordsOf(s, spot.id)][1] ?? notCourt;
  const after = resolve(refreshAp(cur, P),
    [{ faction: holder, action: { type: "invest", zhou, to: other } }],
    G, P, ROSTER, GEO).state;
  assert.equal(after.factions[claimant].governorships.includes(zhou), false, "前任的号没撤");
  assert.equal(after.factions[other].governorships.includes(zhou), true, "新任没拿到号");

  // 五、开局的两个号出自剧本，且只记朝廷明授的那两个
  const titled = Object.values(s.factions)
    .flatMap((f) => f.governorships.map((z) => `${f.id}:${z}`)).sort();
  assert.deepEqual(titled, ["liubiao:荆州", "liuzhang:益州"],
    "开局州牧号对不上剧本 —— 自领自立者不该记");
});

test("联军：一家独据两成郡国，天下共讨之", () => {
  // 借自《宏图策：三国》——它有「联军」而我们没有。对评测来说它比科技树、贸易
  // 那些都值钱：它不往战力上乘系数，而是改变「记分函数奖励什么」的形状。
  // 于是「要不要现在就冲上去」成了真取舍：冲得早独食红利但提前招围攻，
  // 冲得晚稳但可能被人先冲
  const s = fresh();
  const me = "yuanshao";
  const ids = Object.keys(s.commanderies);
  const need = Math.ceil(ids.length * P.coalitionShare) + 2;
  let n = 0;
  for (const id of ids) { if (n >= need) break; s.commanderies[id].owner = me; n += 1; }
  // 先给他一个盟约，看会不会被废
  const friend = Object.values(s.commanderies).find((c) => c.owner && c.owner !== me).owner;
  s.treaties.push({ a: me, b: friend, kind: "alliance", from: 0, until: s.turn + 20 });

  const cur = resolve(s, [], G, P, ROSTER, GEO).state;
  assert.ok(cur.log.some((e) => e.kind === "coalition"), "独据两成郡国却无人来讨");
  assert.equal(cur.treaties.filter((t) => t.a === me || t.b === me).length, 0,
    "旧盟没废 —— 称霸即绝盟这条没生效");
  assert.ok(cur.factions[me].allyBanUntil > cur.turn, "没有禁缔盟");
  assert.ok(cur.treaties.length > 0, "接壤诸家没有结成联军");

  // **一局只发一次**：否则霸者每季被绝一次盟，那不是取舍是酷刑
  const again = resolve(refreshAp(cur, P), [], G, P, ROSTER, GEO).state;
  assert.equal(again.log.slice(cur.log.length).filter((e) => e.kind === "coalition").length, 0,
    "联军每季重复触发");
});

// ── 定档门槛：包与代码逐字对账 ────────────────────────────────────────
//
// 门槛是玩家读得到的规则（包里的 victory[].test 会渲进规则速览），
// 也是引擎判的东西。两处各改各的，人读到的和引擎判的就是两回事了。
test("定档门槛：内容包里的判据与 gradeOf 的常数一致", () => {
  const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
  const want = {
    wang: `controlledZhou >= ${ABS_CUTS.wang}`,
    ba: `controlledZhou >= ${ABS_CUTS.ba}`,
    chao: `zhouScore >= ${GRADE_CUTS.chao}`,
    jia: `zhouScore >= ${GRADE_CUTS.jia}`,
    yi: `zhouScore >= ${GRADE_CUTS.yi}`,
  };
  for (const v of pack.victory) {
    if (!(v.id in want)) continue;
    assert.equal(v.test, want[v.id], `${v.id} 的判据：包里「${v.test}」，代码里「${want[v.id]}」`);
  }
});

test("定档：一个州治算半个州，门槛落在 16 季够得着的区间", () => {
  const st = (z, s) => ({ controlledZhou: z, zhouSeats: s, commanderies: 9, conquests: 1 });
  const start = { controlledZhou: 0, zhouSeats: 0, commanderies: 9 };
  // 州分 = 州增量 + 0.5×州治增量
  assert.equal(gradeOf(st(0, 1), start), "yi", "多 1 个州治 = 州分 0.5 → 乙（立足）");
  // 旧规则把这两件事判成同一档。据一处州治与控住整个州不是一回事，
  // 而 45% 的局都堆在乙——分开之后最大桶降到 33%
  assert.equal(gradeOf(st(1, 0), start), "jia", "多 1 整州 = 州分 1.0 → 甲（成势）");
  assert.equal(gradeOf(st(0, 2), start), "jia", "多 2 个州治 = 1.0 → 甲");
  assert.equal(gradeOf(st(2, 0), start), "chao", "多 2 整州 = 2.0 → 超");
  // 绝对疆域两档不看开局
  assert.equal(gradeOf(st(7, 0), { controlledZhou: 6, zhouSeats: 0, commanderies: 9 }), "ba");
  assert.equal(gradeOf(st(11, 0), { controlledZhou: 10, zhouSeats: 0, commanderies: 9 }), "wang");
  // 守成仍然不得分
  assert.equal(gradeOf(st(0, 0), { ...start, commanderies: 9 }), "ding",
    "郡数没涨、州分为 0 —— 守成不得分这条不能因为换轴而松掉");
});

// ── 界面上「还差多少」必须跟着门槛走 ────────────────────────────────
//
// 这件事曾在状态栏与终局各硬编码一遍，改门槛之后三处同时说错话，
// 而全部测试是绿的——因为没有一条测试读过它们。现在有了。
test("界面的『离下一档还差多少』从 GRADE_CUTS 算，不写死", async () => {
  const { nextGrade } = await import("../app/play/grade-gap.ts");
  // 州分 0：先够丙/乙的门槛
  const a = nextGrade(0, 0);
  assert.equal(a.grade, "yi");
  assert.equal(a.needSeat, 1, "差 0.5 → 一个州治就够");
  // 多据一个州治 = 0.5 = 乙，下一档是甲（≥1）
  const b = nextGrade(0, 1);
  assert.equal(b.grade, "jia");
  assert.equal(b.needZhou, 1);
  assert.equal(b.needSeat, 1, "还差 0.5，一个州治即可——不是两个");
  // 多控一整州 = 1.0 = 甲，下一档是超（≥2）
  const c = nextGrade(1, 0);
  assert.equal(c.grade, "chao");
  assert.equal(c.needZhou, 1);
  assert.equal(c.needSeat, 2);
  // 到了超档就没有「下一档」了——上面是霸与王，判绝对疆域
  assert.equal(nextGrade(2, 0).grade, null,
    "超档之上不该再报增量门槛：霸与王判的是绝对疆域，与开局无关");
  // 门槛一改，这几条必须跟着变——它是从 GRADE_CUTS 算的，不是抄的
  assert.equal(nextGrade(0, 3).score, 1.5);
});

// ── 围城耗粮随城中人马变 ────────────────────────────────────────────
//
// 此前存粮每季恒 −1，与城里有多少人无关：三万三千戍兵的豫章郡与三百兵的
// 上谷郡撑一样久，而存粮上限只有 2–5（105 郡里 63 个是 4）——于是每一次
// 围城都是同一段时间。
test("围城耗粮：屯重兵于孤城，粮尽更快", () => {
  const base = { startGarrison: 4000, provisions: 4 };
  assert.equal(siegeEat({ ...base, garrison: 4000 }, P), 1, "本级戍兵每季耗 1");
  assert.equal(siegeEat({ ...base, garrison: 5000 }, P), 1, "略高于本级仍是 1");
  assert.equal(siegeEat({ ...base, garrison: 6000 }, P), 2, "超 1.5 倍耗 2");
  assert.equal(siegeEat({ ...base, garrison: 12000 }, P), 3, "超 3 倍耗 3");
  assert.equal(siegeEat({ ...base, garrison: 60000 }, P), P.siegeEatMax, "耗粮有上限");
  // 撑得住几季 = 存粮 ÷ 每季耗，向上取整
  assert.equal(siegeHoldSeasons({ ...base, garrison: 4000 }, P), 4);
  assert.equal(siegeHoldSeasons({ ...base, garrison: 12000 }, P), 2,
    "同样四石粮，塞三倍兵只撑得住两季");
  // **不是非黑即白**：富城存粮上限本来就厚，屯得起兵又耐围
  assert.ok(siegeHoldSeasons({ startGarrison: 4000, garrison: 12000, provisions: 9 }, P)
    > siegeHoldSeasons({ startGarrison: 4000, garrison: 4000, provisions: 2 }, P),
    "存粮九石的大城塞满兵，也该比存粮两石的小城耐围");
});


// ── 据点 ────────────────────────────────────────────────────────────
// 「港口、渡口这些都是可以利用起来当据点的」。此前六十一个据点里三十七个
// 在引擎里什么都不做——图上画着，玩家碰不到。这三条钉住那套新规则。
test("据点：开局有主，归它所在之郡的主人", () => {
  const s = fresh();
  const n = Object.keys(s.holds).length;
  assert.ok(n >= 20, `据点只有 ${n} 个 —— 通行图没把它们挂上来`);
  for (const [id, h] of Object.entries(s.holds)) {
    const site = G.sites.get(id);
    assert.ok(site, `${id} 不在通行图里`);
    assert.equal(h.owner, s.commanderies[site.host]?.owner ?? null,
      `${site.name} 的主人应与它所在之郡 ${site.host} 一致`);
    assert.ok(h.garrison > 0, "据点得有守军，否则不成其为据点");
  }
  // 据点不是郡：它不该计入任何一家的郡数
  const jun = Object.values(s.commanderies).length;
  assert.equal(jun, 105, "据点混进郡里了");
});

test("据点：取得下才列；取下即换主，守军来自攻方", () => {
  const s = fresh();
  const cands = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO)
    .filter((c) => c.key.startsWith("seize:"));
  assert.ok(cands.length > 0, "袁绍一条取据点的候选都没有");
  for (const c of cands) {
    // 只列取得下的：取据点的胜负是确定的，列必败项是纯噪声
    const [, node, from] = c.key.split(":");
    const send = Math.floor(s.commanderies[from].garrison * P.strengthRatio.main);
    assert.ok(send >= Math.ceil(s.holds[node].garrison * P.holdSeizeRatio),
      `${c.label} 取不下却被列了出来`);
  }
  const pick = cands[0];
  const [, node, from] = pick.key.split(":");
  const before = s.holds[node].owner;
  const r = resolve(s, [{ faction: "yuanshao", action: pick.action }], G, P, ROSTER, GEO).state;
  assert.equal(r.holds[node].owner, "yuanshao", "取下了却没换主");
  assert.notEqual(r.holds[node].owner, before);
  assert.ok(r.commanderies[from].garrison < s.commanderies[from].garrison, "攻方该有折损");
  assert.ok(r.log.some((e) => e.kind === "seize-win"));
});

test("据点：关在攻方手里，守方就失去关隘之利", () => {
  // 找一条关道边，两侧都要有郡
  const base = fresh();
  const pair = (() => {
    for (const c of Object.values(base.commanderies)) {
      if (c.owner !== "yuanshao") continue;
      for (const e of G.adj.get(c.id) ?? []) {
        const t = base.commanderies[e.to];
        if (!t?.owner || t.owner === "yuanshao") continue;
        if (e.terrain !== "gate") continue;
        return { from: c.id, to: e.to };
      }
    }
    return null;
  })();
  if (!pair) return;                                   // 本图上袁绍无关道边，跳过
  const run = (holdIt) => {
    const t = fresh();
    t.commanderies[pair.from].garrison = 60000;
    t.commanderies[pair.to].garrison = 9000;
    t.commanderies[pair.to].defense = 60;
    for (const site of G.sites.values()) {
      if (!site.on.some(([a, b]) => (a === pair.from && b === pair.to) || (a === pair.to && b === pair.from))) continue;
      if (!["gate", "pass", "ford", "port"].includes(site.kind)) continue;
      t.holds[site.id] = { owner: holdIt ? "yuanshao" : null, garrison: P.holdGarrison };
    }
    const r = resolve(t, [{ faction: "yuanshao", action: { type: "campaign",
      target: pair.to, from: pair.from, commander: null, strength: "allout", siegeGear: "ram" } }],
      G, P, ROSTER, GEO);
    return r.state.log.find((e) => e.kind.startsWith("siege-"))?.attribution;
  };
  const withGate = run(true), without = run(false);
  if (!withGate || !without) return;
  assert.ok(Number(withGate.缺口) >= Number(without.缺口),
    `据关反而更难打：${JSON.stringify(without)} → ${JSON.stringify(withGate)}`);
});
