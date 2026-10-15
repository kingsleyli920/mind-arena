import test from 'node:test';
import assert from 'node:assert/strict';
import { b, P, g, roster, geo, deps } from '../tools/lib/strategy-context.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { listActions } from '../lib/game/engine/actions.ts';
import { reviewDecision, previousDecision } from '../lib/game/decision-review.ts';
import { summarizeSeason } from '../lib/game/engine/season-outcome.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { save, load } from '../lib/game/save.ts';

const fresh = () => createGame(b, { seed: 'decision-review', roster, geo, graph: g,
  endCondition: 'unification' }, P);
const plan = { objective: '守住济阴', target: '济阴郡', stance: 'defend',
  preparation: '侦察邻敌', abortWhen: '治所失守则迁治', status: 'continue', review: '根据当前局势安排' };
const empty = { admitted: [], dropped: [] };

test('目标归属与状态提示只核对结构化事实，不把守城误判为应完成', () => {
  const game = fresh();
  assert.deepEqual(reviewDecision(game, 'caocao', plan, null, [], empty).checks, []);
  const changed = { ...plan, stance: 'attack' };
  const original = structuredClone(changed);
  const codes = reviewDecision(game, 'caocao', changed, plan, [], empty).checks.map(c => c.code);
  assert.deepEqual(codes, ['target-owned', 'status-stale']);
  assert.deepEqual(changed, original, '提示不可擅自改写 AI 计划');
  assert.ok(!reviewDecision(game, 'caocao', { ...changed, status: 'complete' }, plan, [], empty).checks.length);
  assert.deepEqual(reviewDecision(game, 'caocao', { ...plan, target: '不存在郡' }, null, [], empty)
    .checks.map(c => c.code), ['unknown-target']);
  const ours = reviewDecision(game, 'caocao', { ...plan, target: '陈留郡', stance: 'attack' }, plan, [], empty);
  game.commanderies['陈留郡'].garrison = 999999;
  game.commanderies['陈留郡'].provisions = 0;
  assert.deepEqual(reviewDecision(game, 'caocao', { ...plan, target: '陈留郡', stance: 'attack' }, plan, [], empty), ours);
});

test('防守目标刚失守后仍写继续，会同时标出目标失效和旧阶段未修订', () => {
  const before = fresh(), game = structuredClone(before);
  game.commanderies['济阴郡'].owner = 'lubu';
  game.lastOutcome = summarizeSeason(before, game);
  game.turn++;
  const unchanged = reviewDecision(game, 'caocao', plan, plan, [], empty);
  assert.deepEqual(unchanged.checks.map(c => c.code), ['target-lost', 'status-stale']);
  assert.deepEqual(reviewDecision(game, 'caocao', { ...plan, stance: 'attack', status: 'revise' },
    plan, [], empty).checks, []);
  game.turn++;
  assert.deepEqual(reviewDecision(game, 'caocao', plan, plan, [], empty).checks, [],
    '过期失城账本不能再触发本季提示');
});

test('准入收据保留同 key 的采纳与重复拒绝，不将两者合并', () => {
  const game = fresh();
  const candidate = listActions(game, 'caocao', g, P, undefined, roster, undefined, geo)
    .find(c => c.action.type === 'campaign');
  const review = reviewDecision(game, 'caocao', plan, null, [candidate], {
    admitted: [candidate.key], dropped: [{ key: candidate.key, reason: 'duplicate' }],
  });
  assert.deepEqual(review.commands.map(c => c.status), ['admitted', 'dropped']);
  assert.equal(review.commands[1].reason, '重复命令');
  assert.ok(review.checks.some(c => c.code === 'orders-dropped'));
  assert.equal(previousDecision(game, 'caocao', review), null);
  game.turn++;
  assert.deepEqual(previousDecision(game, 'caocao', review).admitted, [candidate.key]);
  assert.equal(previousDecision(game, 'liubei', review), null);
  game.turn++;
  assert.equal(previousDecision(game, 'caocao', review), null, '不能跨机器人季复用过期收据');
});

test('提示与完整收据经过存档进入下一季请求；旧档无字段可继续，坏记录拒绝', async () => {
  let game = fresh(), session = newSession(null);
  session.modelOf.caocao = 'test/review';
  session.plans.caocao = plan;
  const inputs = [];
  const client = { async chat(req) {
    inputs.push(JSON.parse(req.user));
    return { model: req.model, content: JSON.stringify({ picks: [], plan: { ...plan, stance: 'attack' } }),
      usage: null, structured: true, rung: 'schema', maxTokens: 8000, attempts: 1, elapsedMs: 1 };
  } };
  ({ game, session } = await advanceSeason(game, session, [], { ...deps, client }, () => {}));
  const expected = previousDecision(game, 'caocao', session.records[0].review);
  const original = globalThis.localStorage, store = new Map();
  globalThis.localStorage = { setItem: (k, v) => store.set(k, v), getItem: k => store.get(k) };
  try {
    save({ game, session, seat: 'caocao', picked: [], packStamp: 'review-receipt' });
    const restored = load('review-receipt');
    assert.deepEqual(restored.session.records[0].review, session.records[0].review);
    ({ game, session } = await advanceSeason(restored.game, restored.session, [], { ...deps, client }, () => {}));
    assert.equal(inputs.length, 2, '只提示，不额外付费复核');
    assert.deepEqual(inputs[1].decisionLastSeason, expected);
    assert.ok(expected.checks.some(text => text.includes('状态仍写')));
    const legacy = structuredClone(session);
    for (const record of legacy.records) delete record.review;
    save({ game, session: legacy, seat: 'caocao', picked: [], packStamp: 'review-receipt' });
    assert.ok(load('review-receipt'), '新增可选字段不应使旧存档失效');
    session.records[0].review.commands = 'broken';
    save({ game, session, seat: 'caocao', picked: [], packStamp: 'review-receipt' });
    assert.equal(load('review-receipt'), null);
  } finally { globalThis.localStorage = original; }
});
