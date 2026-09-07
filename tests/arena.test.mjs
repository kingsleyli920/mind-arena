// 竞技场层：观测 → 模型输出 → 准入 → 引擎。
//
// 这一层的全部测试都不需要 API key。这是刻意的：模型接线之外的整条管道
// 必须先自己跑通，否则等密钥到位再一起调，分不清是模型的问题还是管道的问题。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildGraph, listActions, DEFAULT_RULES, POLICY_CN } from "../lib/game/engine/actions.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { buildGeography } from "../lib/game/engine/victory.ts";
import { observe } from "../lib/game/engine/observe.ts";
import { admit } from "../lib/arena/seat/admit.ts";
import { pick as botPick } from "../lib/game/engine/bot.ts";
import { stubDecide } from "../lib/arena/seat/stub-seat.ts";
import { decisionSchema, parseDecision } from "../lib/arena/seat/parse.ts";
import { GRADE_SCORE, checkScoringAgainstPack } from "../lib/arena/scoring.ts";
import { renderSystem } from "../lib/arena/seat/prompt.ts";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const P = loadParams(pack);
const ROSTER = buildRoster(read("officers.json"), read("officer-availability-194.json"),
  new Map(read("commanderies.json").map((c) => [c.name, c.id])));
const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
/** 势力 id → 中文名。id 是拼音，漏进标签就是「与 lijue 缔盟」 */
const NAMES = new Map(read("scenario-194.json").factions.map((f) => [f.id, f.name]));
const G = buildGraph(read("adjacency.json"));
const DATA = {
  commanderyState: read("commandery-state.json"), scenario: read("scenario-194.json"),
  commanderies: read("commanderies.json"), troopTypes: read("troop-types.json"), resources: read("resources.json"),
};
const fresh = (seed = "arena") => createGame(DATA, { seed, roster: ROSTER, geo: GEO }, P);

test("计分表只有一份来源，且与内容包一致", () => {
  assert.deepEqual(checkScoringAgainstPack(pack), [],
    "内容包里的名额分与 lib/arena/scoring.ts 对不上");
  assert.equal(GRADE_SCORE.ding, 0, "丁档必须是 0 —— 存续本身不得分");
});

test("准入：逐条丢弃非法项，不作废整回合", () => {
  const s = fresh();
  const cs = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER);
  const cheap = cs.filter((c) => c.cost === 0);
  const paid = cs.filter((c) => c.cost > 0);
  assert.ok(cheap.length > 0 && paid.length > 1);

  const picks = [
    paid[0].key,                       // 合法
    "campaign:不存在>也不存在:main",     // 表外
    paid[0].key,                       // 重复
    paid[1].key,                       // 合法
  ];
  const a = admit(s, "yuanshao", picks, cs, G, ROSTER, DEFAULT_RULES);
  assert.equal(a.admitted.length, 2, "合法的两条该被采纳");
  assert.deepEqual(a.dropped.map((d) => d.reason).sort(), ["duplicate", "unknown-key"]);
  assert.ok(a.illegalRate > 0 && a.illegalRate < 1);
});

test("准入：超预算的按提交顺序截断，前面的保住", () => {
  const s = fresh();
  const cs = listActions(s, "caocao", G, P, DEFAULT_RULES, ROSTER);
  const paid = cs.filter((c) => c.cost > 0);
  const budget = s.factions.caocao.ap;
  // 故意提交远超预算的一串
  const a = admit(s, "caocao", paid.map((c) => c.key), cs, G, ROSTER, DEFAULT_RULES);
  assert.ok(a.spent <= budget, `花了 ${a.spent} 令，预算只有 ${budget}`);
  assert.ok(a.dropped.some((d) => d.reason === "over-budget" || d.reason === "rejected"));
  // 采纳的必须是提交顺序的前缀（跳过被拒的），不是随机挑
  const admittedIdx = a.admitted.map((k) => paid.findIndex((c) => c.key === k));
  assert.deepEqual(admittedIdx, [...admittedIdx].sort((x, y) => x - y),
    "采纳顺序不是提交顺序的子序列");
});

test("准入：产出的命令 resolve 不会因令数不足而拒", () => {
  let s = fresh();
  for (let t = 0; t < 6; t += 1) {
    const orders = [];
    for (const f of Object.keys(s.factions)) {
      if (s.factions[f].eliminated || s.factions[f].retired) continue;
      const cs = listActions(s, f, G, P, DEFAULT_RULES, ROSTER);
      const dec = stubDecide(s, f, cs, "random-legal");
      orders.push(...admit(s, f, dec.picks, cs, G, ROSTER, DEFAULT_RULES).orders);
    }
    const r = resolve(s, orders, G, P, ROSTER, GEO);
    const apRejects = r.rejected.filter((x) => x.reason.startsWith("令数不足"));
    assert.equal(apRejects.length, 0,
      `resolve 见到 ${apRejects.length} 条「令数不足」—— 预算裁剪是准入层的职责`);
    s = refreshAp(r.state, P);
  }
});

test("输出协议：默认把「只能从候选里选」提到解码层", () => {
  const s = fresh();
  const cs = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER);
  // 它每季都变，会把 Anthropic 的整块 system 缓存打掉（入参贵约 2.8 倍）。
  // 那个代价是知情选择：同规模实测关掉后 haiku 有 47 条令因 key 写错被丢，
  // 占其下令数 8.3%，非法率 0.7%→8.6%
  const sch = decisionSchema(cs);
  assert.equal(sch.strict, true);
  assert.deepEqual(sch.schema.properties.picks.items.enum, cs.map((c) => c.key));
  assert.equal(sch.schema.additionalProperties, false);

  // 关掉 enum 换缓存时，strict / additionalProperties 这些约束一条不能少
  const off = decisionSchema(cs, false);
  assert.equal(off.strict, true);
  assert.equal(off.schema.additionalProperties, false);
  assert.equal(off.schema.properties.picks.items.enum, undefined);
  // plan 也必填：它是模型唯一的跨季记忆（观测里全是「此刻的状态」，
  // 没有一条是「我上季打算干什么」）。设成选填，模型多半就不写了，
  // 而没有它就执行不了跨十几季的战役
  assert.deepEqual(off.schema.required, ["picks", "reason", "plan"]);
  assert.ok(off.schema.properties.plan, "schema 里没有跨季方略字段");
});

test("输出协议：宽容解析吃得下代码块与散文包裹，解析不出返回 null", () => {
  assert.deepEqual(parseDecision('{"picks":["a","b"],"reason":"x"}'),
    { picks: ["a", "b"], reason: "x", plan: undefined });
  // plan 也要读回来。**这条测试原本只钉 picks 与 reason，于是 plan 被丢了整整一版**：
  // schema 里要它、提示词讲了它、观测留了位置、eval-run 与对局界面都在传它，
  // 唯独解析这一步没接——一份 24 季的实录里 0 次记录，核算实录时才发现。
  // 跨季记忆是模型执行多季战役的唯一凭借，断在这里等于整个功能没上线
  assert.deepEqual(
    parseDecision('{"picks":["a"],"reason":"x","plan":"先取幽州三郡"}'),
    { picks: ["a"], reason: "x", plan: "先取幽州三郡" });
  assert.deepEqual(parseDecision('```json\n{"picks":["a"]}\n```').picks, ["a"]);
  assert.deepEqual(parseDecision('我的决定是：\n{"picks":["a"],"reason":"y"}\n以上。').picks, ["a"]);
  // 解析不出必须是 null 而不是空决策——「无回应」与「什么都不做」在评测里含义不同
  assert.equal(parseDecision("我拒绝参与战争。"), null);
  assert.equal(parseDecision(""), null);
});

test("整局：桩席位能打完 16 季，观测不泄 seed，非法输入不打断管道", () => {
  let s = fresh("stub-match");
  let since = 0, turns = 0, peakObs = 0;
  while (!s.finished) {
    const orders = [];
    for (const f of Object.keys(s.factions)) {
      if (s.factions[f].eliminated || s.factions[f].retired) continue;
      const kind = f === "caocao" ? "chaos" : "random-legal";
      const cs = listActions(s, f, G, P, DEFAULT_RULES, ROSTER);
      if (f === "caocao") {
        const json = JSON.stringify(observe(s, f, G, P, ROSTER, GEO, { since }));
        assert.ok(!json.includes(s.seed), "观测里泄了 seed");
        peakObs = Math.max(peakObs, json.length);
      }
      const dec = stubDecide(s, f, cs, kind);
      orders.push(...admit(s, f, dec.picks, cs, G, ROSTER, DEFAULT_RULES).orders);
    }
    since = s.log.length;
    s = refreshAp(resolve(s, orders, G, P, ROSTER, GEO).state, P);
    turns += 1;
    assert.ok(turns <= P.seasonsPerGame + 1, "局长失控");
  }
  assert.equal(s.turn, P.seasonsPerGame);
  assert.ok(peakObs > 0);
  // 每一席都要有档位，评测才有分可报
  for (const f of Object.values(s.factions)) {
    assert.ok(GRADE_SCORE[f.bestGrade] !== undefined, `${f.id} 的档位无法计分`);
  }
});

test("提示词：静态前缀逐字节稳定，且不含 seed / 席位 / 年份", () => {
  const a = renderSystem(pack);
  const b = renderSystem(JSON.parse(JSON.stringify(pack)));
  assert.equal(a, b, "同一内容包两次装配不一致 —— 前缀缓存永远不会命中");
  // 剧本名是包的一部分，随包一起变，不影响同一包内的缓存命中；
  // 席位名与 seed 则是每局每席都变的，出现即等于缓存永不命中
  for (const bad of ["曹操", "袁绍", "刘表"]) {
    assert.ok(!a.includes(bad), `静态前缀里出现了席位名「${bad}」，跨席位就失效了`);
  }
  assert.ok(!/"seed"|seed=/.test(a), "静态前缀里出现了 seed");
});

test("提示词：规则摘要不含开发者旁白 —— 那是在教模型怎么想", () => {
  const sys = renderSystem(pack);
  // 旁白的过滤此前只看**键名**（说明/为何/依据…）。实测漏过一条：
  // 「各阵之长」这个键名不含那几个字，于是「否则哪个阵最强有唯一解，
  // 改阵就不成其为决策」「开局 63 个郡是方圆，给它任何代价都等于全图调参」
  // 整段进了提示词——那是在教模型怎么想。
  //
  // 所以改成按**语气**拦：这些词只会出现在设计札记里，不会出现在规则里。
  // 键名改不改都拦得住
  for (const w of ["设计意图", "自对局实测", "首版", "白送", "装饰性",
                   "实测", "试过", "打挂", "调参", "不成其为决策", "消融",
                   "这个仓库", "本仓库", "教训"]) {
    assert.ok(!sys.includes(w), `摘要里残留开发者旁白：「${w}」`);
  }
  // 但真正的规则必须还在
  for (const w of ["缺口", "可防守", "结转", "州治"]) {
    assert.ok(sys.includes(w), `摘要里缺了规则关键词「${w}」`);
  }
});

test("提示词：规则摘要与引擎一致——方针数不能对不上", () => {
  const sys = renderSystem(pack);
  // 读引擎自己的枚举，不再手抄一份。此前这里硬写着 ["farm","levy","wall","soothe","forge"]
  // ——那正是这个仓库反复吃亏的「同一份数据两个副本」，加屯粮时它自己也漏了同步
  const engine = Object.keys(POLICY_CN);
  const govern = pack.actions.find((a) => a.id === "govern");
  const policy = govern.params.find((p) => p.name === "policy");
  assert.deepEqual([...policy.tiers.map((t) => t.id)].sort(), [...engine].sort(),
    `包里 ${policy.tiers.length} 个方针，引擎有 ${engine.length} 个 —— 摘要在向模型漏说一条`);
  assert.ok(sys.includes("治械"), "摘要里没有治械，而器械是攻城缺口的来源之一");
});

test("界面的准入判据与引擎一致：按它贪心勾选，引擎不应拒绝任何一条", () => {
  // 对局界面此前只判「令数够不够」，不认免费动作的次数上限（探 3 / 任命 5），
  // 也不认「同一郡每季至多 2 令」。实测按那套判据勾选，649 条里有 106 条
  // （16%）被引擎静默丢弃，屏幕上零提示。现在界面走 admit，此测钉住这条。
  let picked = 0, rejected = 0;
  for (const seat of ["caocao", "yuanshao", "lubu"]) {
    let s = fresh(`ui-${seat}`);
    while (!s.finished) {
      const orders = [];
      for (const f of Object.keys(s.factions)) {
        if (s.factions[f].eliminated || s.factions[f].retired) continue;
        const cs = listActions(s, f, G, P, DEFAULT_RULES, ROSTER);
        if (f === seat) {
          // 照界面的做法：逐条问 admit 还能不能加，能就加
          const keys = [];
          for (const c of cs) {
            const probe = admit(s, f, [...keys, c.key], cs, G, ROSTER, DEFAULT_RULES);
            if (probe.admitted.includes(c.key)) keys.push(c.key);
          }
          const a = admit(s, f, keys, cs, G, ROSTER, DEFAULT_RULES);
          picked += a.admitted.length;
          orders.push(...a.orders);
        } else {
          orders.push(...admit(s, f, stubDecide(s, f, cs, "random-legal").picks, cs,
            G, ROSTER, DEFAULT_RULES).orders);
        }
      }
      const r = resolve(s, orders, G, P, ROSTER, GEO);
      rejected += r.rejected.filter((x) => x.order.faction === seat).length;
      s = refreshAp(r.state, P);
    }
  }
  assert.ok(picked > 100, `样本太少（${picked} 条），测不出`);
  assert.equal(rejected, 0, `按界面判据勾选的 ${picked} 条里，引擎拒绝了 ${rejected} 条`);
});

test("候选标签不留英文 id：地形、势力、兵种都该是中文", () => {
  const s = fresh();
  for (const seat of ["caocao", "yuanshao", "liubiao"]) {
    const labels = listActions(s, seat, G, P, DEFAULT_RULES, ROSTER,
      (id) => ({ caocao: "曹操", lubu: "吕布" })[id] ?? id).map((c) => c.label).join(" ");
    // 引擎内部的英文枚举不该出现在给人和模型看的标签里
    for (const leak of ["plain", "gate", "mountain", "river", "hill",
                        "infantry", "cavalry", "archer", "navy", "none", "ram", "mound"]) {
      assert.ok(!labels.includes(leak), `${seat} 的候选标签里漏出了「${leak}」`);
    }
  }
});

test("schema：默认随候选变（解码层强制），keyEnum=off 才逐字节恒定", () => {
  const s = fresh();
  const a = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO);
  const b = listActions(s, "liubiao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO);
  assert.notDeepEqual(a.map((c) => c.key), b.map((c) => c.key), "两席候选相同，测不出");

  // 默认带 enum，因此必然随候选变。代价是 Anthropic 的前缀缓存整块失效：
  // OpenRouter 把 json_schema 译成 tool，而 Anthropic 的缓存前缀顺序是
  // tools → system → messages。实测同一 system 连发两次，schema 恒定则
  // cached 4534，schema 变则 cached 0 且重写整块，system 占入参 38–52%。
  // 这条钉住那个代价是真实的，不是臆测——换回缓存要显式 keyEnum=false
  assert.notEqual(
    JSON.stringify(decisionSchema(a)), JSON.stringify(decisionSchema(b)),
    "默认没带 enum —— 解码层不再强制「只能从候选里选」，实测 haiku 会有 8.3% 的令被丢掉",
  );
  assert.deepEqual(decisionSchema(a).schema.properties.picks.items.enum,
    a.map((c) => c.key), "enum 与本季候选表不一致");
  // 关掉才逐字节恒定。这是拿 8.3% 的令换 2.8 倍入参，不是免费午餐
  assert.equal(
    JSON.stringify(decisionSchema(a, false)), JSON.stringify(decisionSchema(b, false)),
    "keyEnum=false 却仍随候选变，那就连缓存也换不回来",
  );
});

test("即便关掉 enum，编造的 key 仍被 admit 逐条丢弃", () => {
  const s = fresh();
  const cands = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO);
  const real = cands[0].key;
  // 解码层不再强制「只能从候选里选」，那条约束退回 admit()。
  // 它必须只丢非法的那条，不能作废整回合——一条错不该让整季空过
  const a = admit(s, "yuanshao", ["campaign:不存在的郡>也不存在:main", real],
                  cands, G, ROSTER, DEFAULT_RULES);
  assert.deepEqual(a.dropped.map((d) => d.reason), ["unknown-key"]);
  assert.equal(a.admitted.length, 1, "合法的那条也被牵连丢掉了");
  assert.ok(a.illegalRate > 0, "illegalRate 没记上 —— 关掉 enum 后全靠它兜底");
});

test("机器人基线走的是与模型同一条路：picks → admit → orders", () => {
  const s = fresh();
  // 评测拿机器人当基线，前提是它和模型受同一套准入。若它绕过 admit，
  // illegalRate 与令数用率两列对基线是空的，而那正是判「模型有没有乱下令」的参照。
  // 更早之前 `--agent=bot:balanced` 会静默落进 stubDecide 跑成随机基线
  for (const profile of ["balanced", "purpose", "aggressive"]) {
    const cands = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO);
    const p = botPick(s, "yuanshao", G, profile, DEFAULT_RULES, ROSTER, P, GEO);
    const known = new Set(cands.map((c) => c.key));
    for (const k of p.picks) assert.ok(known.has(k), `${profile} 选了候选表外的 ${k}`);
    assert.equal(p.picks.length, p.orders.length, `${profile} 的 picks 与 orders 数量不符`);
    // 走一遍准入必须一条不掉：机器人自己已经模拟过令数与郡国配额
    const a = admit(s, "yuanshao", p.picks, cands, G, ROSTER, DEFAULT_RULES);
    assert.equal(a.dropped.length, 0,
      `${profile} 被准入层丢了 ${a.dropped.map((d) => d.reason).join()} —— 基线不该有非法令`);
    assert.equal(a.orders.length, p.orders.length);
  }
});

test("桩席位遇到不认识的变体必须炸，不能悄悄跑成随机基线", () => {
  const s = fresh();
  const cands = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, undefined, GEO);
  // 排行榜上一个悄悄跑错的基线比没有基线更坏
  assert.throws(() => stubDecide(s, "yuanshao", cands, "balanced"), /未知的桩变体/);
  assert.doesNotThrow(() => stubDecide(s, "yuanshao", cands, "random-legal"));
  assert.doesNotThrow(() => stubDecide(s, "yuanshao", cands, "idle"));
});

test("候选标签一律不露内部 id：势力名、武将名、方针名都要是人话", () => {
  const s = fresh();
  const nameOf = (id) => NAMES.get(id) ?? id;
  const cs = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER, nameOf, GEO);
  assert.ok(cs.length > 0);
  // 势力 id 是拼音（lijue / lukang / shixie…），漏进标签就是「与 lijue 缔盟」
  const ids = [...NAMES.keys()];
  for (const c of cs) {
    for (const id of ids) {
      assert.ok(!c.label.includes(id),
        `标签里出现了势力 id「${id}」：${c.label}`);
    }
  }
  // 武将 id 同理：「任 weiyan 守 桂阳郡」
  for (const c of cs.filter((x) => x.action.type === "appoint")) {
    assert.ok(!c.label.includes(c.action.officer),
      `标签里出现了武将 id：${c.label}`);
    assert.ok(c.label.includes(ROSTER.byId.get(c.action.officer).name),
      `标签里没有武将的名字：${c.label}`);
  }
});

test("准入：被提供方转码搞坏的 key 要复原，但幻觉不许洗白", () => {
  // 症状：中文按 UTF-8 编码后又被按 Latin-1 解了一遍，
  // 「济阴郡」变成「æµ\u008eé\u0098´é\u0083¡」。一份 48 局的排行榜里
  // qwen3-30b 有 2806 次 unknown-key 全是这个，非法率被记成 50.9%——
  // 而它其实每一条都选对了。基础设施的失败算成模型的分，这个仓库栽过三次
  const s = fresh();
  const cs = listActions(s, "caocao", G, P, DEFAULT_RULES, ROSTER);
  const good = cs.find((c) => /[\u4e00-\u9fff]/.test(c.key));
  assert.ok(good, "候选里没有带中文的 key，这条测试测不到东西");
  const mangle = (t) => Buffer.from(t, "utf8").toString("latin1");

  const a = admit(s, "caocao", [mangle(good.key), mangle("campaign:虚构郡>某郡:main")],
    cs, G, ROSTER);
  assert.deepEqual(a.admitted, [good.key], "转码坏掉的 key 没有被复原");
  assert.equal(a.mojibake, 1, "复原计数不对 —— 报告要靠它把编码问题与模型的过分开");
  // 复原只在「复原后恰好命中候选」时才认，所以编造的 key 复原之后仍然不在表里
  assert.equal(a.dropped.length, 1);
  assert.equal(a.dropped[0].reason, "unknown-key", "幻觉被复原逻辑洗白了");
});
