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
import { GRADE_SCORE, boardScore, checkScoringAgainstPack } from "../lib/arena/scoring.ts";
import { OpenRouterClient } from "../lib/arena/llm/client.ts";
import { VERIFIED_MODELS } from "../lib/arena/verified-models.ts";
import { renderSystem, PROMPT_VERSION } from "../lib/arena/seat/prompt.ts";
import { GRADE_CUTS } from "../lib/game/engine/victory.ts";

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
  commanderyState: read("commandery-state-194.json"), scenario: read("scenario-194.json"),
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
  const a = admit(s, "yuanshao", picks, cs, G, ROSTER, DEFAULT_RULES, P);
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
  const a = admit(s, "caocao", paid.map((c) => c.key), cs, G, ROSTER, DEFAULT_RULES, P);
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
      orders.push(...admit(s, f, dec.picks, cs, G, ROSTER, DEFAULT_RULES, P).orders);
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
  assert.deepEqual(off.schema.required, ["picks", "backups", "reason", "plan"]);
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
      orders.push(...admit(s, f, dec.picks, cs, G, ROSTER, DEFAULT_RULES, P).orders);
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
            const probe = admit(s, f, [...keys, c.key], cs, G, ROSTER, DEFAULT_RULES, P);
            if (probe.admitted.includes(c.key)) keys.push(c.key);
          }
          const a = admit(s, f, keys, cs, G, ROSTER, DEFAULT_RULES, P);
          picked += a.admitted.length;
          orders.push(...a.orders);
        } else {
          orders.push(...admit(s, f, stubDecide(s, f, cs, "random-legal").picks, cs,
            G, ROSTER, DEFAULT_RULES, P).orders);
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
                  cands, G, ROSTER, DEFAULT_RULES, P);
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
    const a = admit(s, "yuanshao", p.picks, cands, G, ROSTER, DEFAULT_RULES, P);
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

// ── 降级梯的记忆：一次抖动不该改变「我们在测什么」 ────────────────────
//
// 档位不是实现细节。候选 key 的 enum 一旦失效，实测非法率 0.7% → 8.6%、
// unknown-key 0 → 47（docs/EVAL.md）——测的东西从「会不会玩」变成
// 「能不能一字不差地抄中文郡名」。所以「这个模型只能用低档」这个结论
// 必须来自两次证据，不能来自上游的一次限流。
//
// 真事：qwen3.7-flash 的上游在并发下限流，OpenRouter 把提供方的错误裹成
// 4xx 转出来，于是整个进程都掉到了 text 档。

/** 造一个假 fetch：按顺序吐预置的响应，并记下每次请求用的档位 */
function fakeFetch(plan) {
  const seen = [];
  let i = 0;
  const f = async (_url, init) => {
    const body = JSON.parse(init.body);
    // 四档的真实差别：temperature（最上一档独有）与 provider.require_parameters
    seen.push(!body.response_format ? "text"
      : body.temperature !== undefined ? "schema"
      : body.provider?.require_parameters ? "schema-notemp" : "schema-any");
    const step = plan[Math.min(i, plan.length - 1)];
    i += 1;
    if (step === 200) {
      return { ok: true, status: 200, headers: new Headers(),
        json: async () => ({ model: "m", choices: [{ message: { content: '{"picks":[],"reason":"x"}' },
          finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
    }
    return { ok: false, status: step, headers: new Headers(), text: async () => "上游抖了一下" };
  };
  return { f, seen };
}

const REQ = { model: "", system: "s", user: "u", schema: { type: "object" } };

test("同一档只被拒一次：下次调用仍从最高档起步", async () => {
  const { f, seen } = fakeFetch([400, 200, 200]);
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const c = new OpenRouterClient("k");
    const r1 = await c.chat({ ...REQ, model: "试:抖一下" });
    assert.equal(r1.rung, "schema-notemp", "当场要降档——这一季总得答出来");
    await c.chat({ ...REQ, model: "试:抖一下" });
    assert.deepEqual(seen, ["schema", "schema-notemp", "schema"],
      "第二次调用必须回到 schema 档：一次 4xx 不足以断定它不支持结构化输出");
  } finally { globalThis.fetch = real; }
});

test("同一档连拒两次才写进记忆：第三次直接从低档起步", async () => {
  const { f, seen } = fakeFetch([400, 200, 400, 200, 200]);
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const c = new OpenRouterClient("k");
    for (let i = 0; i < 3; i += 1) await c.chat({ ...REQ, model: "试:真不支持" });
    assert.deepEqual(seen,
      ["schema", "schema-notemp", "schema", "schema-notemp", "schema-notemp"],
      "第三次不该再交一遍 schema 档的学费");
  } finally { globalThis.fetch = real; }
});

test("429 是限流不是不支持：一次都不许记进降级梯", async () => {
  const { f, seen } = fakeFetch([429, 200, 200]);
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const c = new OpenRouterClient("k", { maxAttempts: 4 });
    const r = await c.chat({ ...REQ, model: "试:限流" });
    assert.equal(r.rung, "schema", "限流要原档重试，不能降档");
    assert.deepEqual(seen, ["schema", "schema"]);
  } finally { globalThis.fetch = real; }
});

// ── 榜分：档位 + 档内连续进度 ──────────────────────────────────────
//
// 加连续项是为了把「差一两个州却记成打平」的局分开（实测 25/44 局平局）。
// 但它一旦能翻过一整档，档位就不再是头号指标了——那会把「多控一州」
// 这条产品语义变成一个可以用零碎进度换掉的东西。

test("榜分：低一档永远压不过高一档", () => {
  const 甲最差 = boardScore({ grade: "jia", zhouEquiv: 2, startZhouEquiv: 2 });
  const 乙最好 = boardScore({ grade: "yi", zhouEquiv: 99, startZhouEquiv: 0, seats: 99 });
  assert.ok(甲最差 > 乙最好,
    `甲档最差 ${甲最差} 必须高于乙档最好 ${乙最好}——连续项被压在 0–99 就是为这个`);
});

test("榜分：守成不得分——增量为零或为负都不加分", () => {
  assert.equal(boardScore({ grade: "yi", zhouEquiv: 3, startZhouEquiv: 3 }), GRADE_SCORE.yi);
  assert.equal(boardScore({ grade: "yi", zhouEquiv: 1, startZhouEquiv: 3 }), GRADE_SCORE.yi,
    "缩了疆域不该比原地不动更高——负增量夹到 0，不是往下扣");
});

test("榜分：同档内按州进度单调，一个州治约合半个州", () => {
  const a = boardScore({ grade: "jia", zhouEquiv: 3.75, startZhouEquiv: 0 });
  const b = boardScore({ grade: "jia", zhouEquiv: 1.25, startZhouEquiv: 0 });
  assert.ok(a > b, "同为甲档，多拿两州半的那局必须更高——这正是旧尺子记成平局的那种");
  assert.equal(boardScore({ grade: "yi", zhouEquiv: 1, startZhouEquiv: 0 }),
               boardScore({ grade: "yi", zhouEquiv: 0, startZhouEquiv: 0, seats: 2 }),
               "1 州 = 2 个州治：与定档判据同源（多 1 州 = 多 2 州治 = 甲）");
});

test("出参预算也要记住：饿过一次之后，下一次直接从翻倍后的预算起步", async () => {
  const seen = [];
  const real = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (_u, init) => {
    seen.push(JSON.parse(init.body).max_tokens);
    // 第一次：推理把出参吃光（finish=length）→ 翻倍重试；之后正常
    const starve = i === 0;
    i += 1;
    return { ok: true, status: 200, headers: new Headers(),
      json: async () => ({ model: "m",
        choices: [{ message: { content: starve ? "" : '{"picks":[],"reason":"x"}' },
                    finish_reason: starve ? "length" : "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: starve ? 8000 : 5,
                 completion_tokens_details: { reasoning_tokens: starve ? 7900 : 0 } } }) };
  };
  try {
    const c = new OpenRouterClient("k");
    await c.chat({ ...REQ, model: "试:重推理" });
    await c.chat({ ...REQ, model: "试:重推理" });
    assert.deepEqual(seen, [8000, 16000, 16000],
      "第二次调用要直接用 16000——白发一个注定被砍断的 8000 请求，钱照付时间照花");
  } finally { globalThis.fetch = real; }
});

test("没饿过的模型不涨预算：涨了会让提供方按上限预留算力、排队变慢", async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_u, init) => {
    seen.push(JSON.parse(init.body).max_tokens);
    return { ok: true, status: 200, headers: new Headers(),
      json: async () => ({ model: "m", choices: [{ message: { content: '{"picks":[],"reason":"x"}' },
        finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
  try {
    const c = new OpenRouterClient("k");
    await c.chat({ ...REQ, model: "试:不推理" });
    await c.chat({ ...REQ, model: "试:不推理" });
    assert.deepEqual(seen, [8000, 8000]);
  } finally { globalThis.fetch = real; }
});

// 这张表是给玩家看的推荐位，写进去就等于说「这个能玩、大概这个价」。
// 它只许收有实测数据的模型——凭印象填一条，代价是别人照着花钱
test("实测模型表：每条都要有实扣与实测结论，不许凭印象填", () => {
  assert.ok(VERIFIED_MODELS.length > 0, "表不该是空的");
  const ids = new Set();
  for (const m of VERIFIED_MODELS) {
    assert.match(m.id, /^~?[a-z0-9-]+\/[A-Za-z0-9.\-_:]+$/, `${m.id} 不像一个 OpenRouter 模型 id`);
    assert.ok(!ids.has(m.id), `${m.id} 重复`);
    ids.add(m.id);
    assert.ok(m.usdPerGame > 0 && m.usdPerGame < 1,
      `${m.id} 的每局实扣 ${m.usdPerGame} 不合理——实测值在 $0.03–0.06 这个量级`);
    assert.ok(m.note.length >= 10, `${m.id} 缺实测结论`);
    assert.ok(/\d/.test(m.note), `${m.id} 的结论里没有一个数字——那多半是印象不是实测`);
  }
});

// ── 定档门槛的第四方对账：写给模型的那一份 ──────────────────────────
//
// 门槛住在四个地方：内容包（玩家读的规则）、gradeOf（引擎判的）、
// 开局页的说明（玩家读的）、规则摘要（**模型唯一读到的**）。
// 改了前三处而漏掉第四处，模型就在按一套过时的规则决策，而报告上什么都看不出来。
// 这次改门槛时，提示词里那句「多控一州或多据一州治 → 乙；多控两州 → 甲」
// 正是靠通读才发现的——没有闸门就会漏。
test("规则摘要里的定档门槛与引擎一致", () => {
  const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
  const sys = renderSystem(pack);
  for (const [g, cut] of Object.entries(GRADE_CUTS)) {
    assert.ok(sys.includes(`≥${cut}`),
      `规则摘要里找不到 ${g} 的门槛「≥${cut}」——模型读到的定档规则与引擎判的不是同一套`);
  }
  assert.ok(!/多控两州\s*→\s*甲/.test(sys), "摘要里还留着旧门槛的写法");
  assert.match(PROMPT_VERSION, /^\d+\.\d+\.\d+$/);
});

// ── 军团圆点上那个字：三十一家必须互不相同 ──────────────────────────
//
// 撞了就等于图上两支不同势力的兵长得一模一样，而颜色本来就分不清三十一家。
test("势力的一字缩写：全部互不相同", async () => {
  const { factionAbbr } = await import("../app/play/faction-abbr.ts");
  const b = JSON.parse(fs.readFileSync("public/game/runtime-194.json", "utf8"));
  const seen = new Map();
  for (const f of b.scenario.factions) {
    const a = factionAbbr(f.name);
    assert.equal([...a].length, 1, `${f.name} → 「${a}」不是一个字`);
    assert.ok(!seen.has(a), `「${a}」撞了：${seen.get(a)} 与 ${f.name}`);
    seen.set(a, f.name);
  }
  assert.equal(seen.size, b.scenario.factions.length);
  // 几条取字规矩的样本。姓会撞，所以人名取名的末字
  assert.equal(factionAbbr("袁绍"), "绍");
  assert.equal(factionAbbr("袁术"), "术");
  assert.equal(factionAbbr("吕布（张邈、陈宫）"), "布");
  assert.equal(factionAbbr("李傕、郭汜"), "傕");
  assert.equal(factionAbbr("白波军（杨奉、韩暹、李乐、胡才）"), "白");
});
