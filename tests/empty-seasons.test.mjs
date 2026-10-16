// 「下得保守」与「一条没下」必须分开报。
//
// 挑便宜模型时我按摘要里的「令数用率 38%」把 qwen3.5-9b 读成打得保守，开了三局
// 64 季的跑。实际是四季里两季把 32k 出参预算全烧在推理上、一条令都没下，另两季
// 正常下了九条十一条——38% 是这两件事的平均数，而平均数把病症抹平了。
//
// 代价是三十一分钟的机时，以及一个差点写进 docs/EVAL.md 第 39 条的「复现」。
import test from "node:test";
import assert from "node:assert/strict";
import { isEmpty, emptySeasons, EMPTY_WARN } from "../tools/lib/empty-seasons.mjs";

/** qwen/qwen3.5-9b 执曹操四季探针的真实逐季数据（2026-10-16） */
const QWEN = [
  { turn: 1, candidates: 60, picks: 9, admitted: 9, spent: 5, ap: 9, completion: 1262 },
  { turn: 2, candidates: 60, picks: 11, admitted: 9, spent: 11, ap: 11, completion: 925 },
  { turn: 3, candidates: 60, picks: 0, admitted: 0, spent: 0, ap: 10, completion: 32000 },
  { turn: 4, candidates: 60, picks: 0, admitted: 0, spent: 0, ap: 12, completion: 32000 },
];

test("空手季：qwen 那两季要被逮出来，而令数用率逮不到", () => {
  const { list, share, warn } = emptySeasons(QWEN);
  assert.deepEqual(list.map((m) => m.turn), [3, 4]);
  assert.equal(share, 0.5);
  assert.ok(warn, "半数季节没下令还不报警，这条闸等于没加");

  // 同一份数据按旧口径（令数用率）读出来是 38%——一个看着像「保守」的数
  const rate = QWEN.reduce((a, m) => a + m.spent, 0) / QWEN.reduce((a, m) => a + m.ap, 0);
  assert.ok(rate > 0.3 && rate < 0.45, `令数用率 ${(rate * 100).toFixed(0)}%`);
});

test("空手季：真·保守不算空手", () => {
  // 每季都挑了令，只是没把额度用满——这是打法，不是故障
  const 保守 = [
    { turn: 1, candidates: 60, picks: 2, spent: 2, ap: 9 },
    { turn: 2, candidates: 60, picks: 1, spent: 1, ap: 11 },
  ];
  const { list, warn } = emptySeasons(保守);
  assert.equal(list.length, 0);
  assert.equal(warn, false);
  // 而它的令数用率（15%）比 qwen 的 38% 还低——两把尺量的本就不是一回事
  const rate = 保守.reduce((a, m) => a + m.spent, 0) / 保守.reduce((a, m) => a + m.ap, 0);
  assert.ok(rate < 0.2);
});

test("空手季：两个调用点的字段形状都要认", () => {
  // match-log 的逐季记录里 picks 是条数
  assert.equal(isEmpty({ candidates: 60, picks: 0 }), true);
  assert.equal(isEmpty({ candidates: 60, picks: 3 }), false);
  // eval-run 的 picks 是**原文数组**（事后要能复查挑了哪几条），另有 pickCount。
  // 按 `picks ?? 0` 判的话，空数组不等于 0，整条闸在排行榜那边就是哑的
  assert.equal(isEmpty({ candidates: 60, picks: [], pickCount: 0 }), true);
  assert.equal(isEmpty({ candidates: 60, picks: ["a", "b"], pickCount: 2 }), false);
  // 只有 pickCount 也认
  assert.equal(isEmpty({ candidates: 60, pickCount: 0 }), true);
});

test("空手季：候选数未知时不判，宁可漏不可冤", () => {
  // candidates 缺失发生在调用失败的季——那一季已经按失败分类记过账了，
  // 再记一次空手就是同一件事记两遍，会把失败模型的空手率顶到 100%
  assert.equal(isEmpty({ turn: 1, picks: 0 }), false);
  assert.equal(isEmpty({ turn: 1, candidates: 0, picks: 0 }), false);
  assert.equal(isEmpty({ turn: 1, candidates: 60, picks: 0 }), true);
});

test("空手季：报警线是四分之一，边界含等号", () => {
  const 四之一 = [
    { turn: 1, candidates: 60, picks: 0 },
    { turn: 2, candidates: 60, picks: 5 },
    { turn: 3, candidates: 60, picks: 5 },
    { turn: 4, candidates: 60, picks: 5 },
  ];
  assert.equal(EMPTY_WARN, 0.25);
  assert.equal(emptySeasons(四之一).share, 0.25);
  assert.ok(emptySeasons(四之一).warn, "恰好四分之一要报警");
  assert.equal(emptySeasons(四之一.slice(1)).warn, false, "一季不空就不该报");
  // 空表不报警，也不除零
  assert.equal(emptySeasons([]).share, 0);
  assert.equal(emptySeasons(undefined).warn, false);
});
