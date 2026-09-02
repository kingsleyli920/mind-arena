// 竞技场层：观测 → 模型输出 → 准入 → 引擎。
//
// 这一层的全部测试都不需要 API key。这是刻意的：模型接线之外的整条管道
// 必须先自己跑通，否则等密钥到位再一起调，分不清是模型的问题还是管道的问题。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildGraph, listActions, DEFAULT_RULES } from "../lib/game/engine/actions.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { buildGeography } from "../lib/game/engine/victory.ts";
import { observe } from "../lib/game/engine/observe.ts";
import { admit } from "../lib/arena/seat/admit.ts";
import { stubDecide } from "../lib/arena/seat/stub-seat.ts";
import { decisionSchema, parseDecision } from "../lib/arena/seat/parse.ts";
import { GRADE_SCORE, checkScoringAgainstPack } from "../lib/arena/scoring.ts";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const P = loadParams(pack);
const ROSTER = buildRoster(read("officers.json"), read("officer-availability-194.json"),
  new Map(read("commanderies.json").map((c) => [c.name, c.id])));
const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
const G = buildGraph(read("adjacency.json"));
const DATA = {
  commanderyState: read("commandery-state.json"), scenario: read("scenario-194.json"),
  commanderies: read("commanderies.json"), troopTypes: read("troop-types.json"),
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

test("输出协议：schema 的 enum 把「只能从候选里选」提到解码层", () => {
  const s = fresh();
  const cs = listActions(s, "yuanshao", G, P, DEFAULT_RULES, ROSTER);
  const sch = decisionSchema(cs);
  assert.equal(sch.strict, true);
  assert.deepEqual(sch.schema.properties.picks.items.enum, cs.map((c) => c.key));
  assert.equal(sch.schema.additionalProperties, false);
});

test("输出协议：宽容解析吃得下代码块与散文包裹，解析不出返回 null", () => {
  assert.deepEqual(parseDecision('{"picks":["a","b"],"reason":"x"}'),
    { picks: ["a", "b"], reason: "x" });
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
