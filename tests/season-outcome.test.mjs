import test from 'node:test';
import assert from 'node:assert/strict';
import { b, P, g, roster, geo, deps } from '../tools/lib/strategy-context.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { observe } from '../lib/game/engine/observe.ts';
import { summarizeSeason, outcomeFor } from '../lib/game/engine/season-outcome.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { save, load } from '../lib/game/save.ts';

const fresh = () => createGame(b, { seed: 'strategy-cases-0', roster, geo,
  graph: g, endCondition: 'unification' }, P);

test('结算摘要取季初季末净变化，包含无主归附和大批劝降，不改原状态', () => {
  const before = fresh(), after = structuredClone(before);
  const own = Object.values(before.commanderies).find(c => c.owner === 'yuanshao');
  const other = Object.values(before.commanderies).find(c => c.owner === 'liubiao');
  const neutral = Object.values(before.commanderies).find(c => c.owner === null);
  after.commanderies[own.id].owner = 'liubiao';
  after.commanderies[other.id].owner = 'yuanshao';
  after.commanderies[neutral.id].owner = 'yuanshao';
  after.factions.yuanshao.gold += 120;
  const outcome = summarizeSeason(before, after);
  assert.deepEqual(new Set(outcome.factions.yuanshao.gained), new Set([other.id, neutral.id]));
  assert.deepEqual(outcome.factions.yuanshao.lost, [own.id]);
  assert.equal(outcome.factions.yuanshao.goldDelta, 120);
  assert.equal(before.commanderies[own.id].owner, 'yuanshao');
  assert.equal(outcomeFor(before, 'yuanshao'), null);
  after.lastOutcome = outcome;
  assert.equal(outcomeFor(after, 'yuanshao'), null, '尚未推进时钟不能将摘要当作上季');
  after.turn++;
  assert.deepEqual(outcomeFor(after, 'yuanshao').lost, [own.id]);
  after.turn++;
  assert.equal(outcomeFor(after, 'yuanshao'), null, '过期摘要不可冒充上季');
});

test('自然对局失去沛国即使被天下战报截断，下一季仍收到完整净得失', async () => {
  let game = fresh(), session = newSession(null);
  session.callLimit = 0;
  let before;
  for (let i = 0; i < 2; i++) {
    before = game;
    ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
  }
  const lost = Object.values(before.commanderies)
    .filter(c => c.owner === 'liubei' && game.commanderies[c.id].owner !== 'liubei').map(c => c.id);
  assert.ok(lost.includes('沛国'));
  const observation = observe(game, 'liubei', g, P, roster, geo, { since: before.log.length, worldCap: 0 });
  assert.deepEqual(new Set(observation.report.changes.lost), new Set(lost));
  assert.equal(observation.seat.capitalHeld, false);
  assert.equal(observation.report.changes.goldDelta,
    Math.round(game.factions.liubei.gold) - Math.round(before.factions.liubei.gold));
  assert.deepEqual(observation.report.world, []);
});

test('摘要只发送本方账本，不把其他势力的国库与全体摘要带入观测', () => {
  const before = fresh(), game = structuredClone(before);
  game.turn++;
  game.lastOutcome = summarizeSeason(before, game);
  const read = () => observe(game, 'caocao', g, P, roster, geo).report.changes;
  const original = structuredClone(read());
  game.lastOutcome.factions.yuanshao.goldDelta = 87654321;
  game.factions.yuanshao.gold = 99999999;
  assert.deepEqual(read(), original);
  assert.ok(!('factions' in original));
});

test('重复复核会提示，真实摘要进入下一次模型调用且存档可恢复', async () => {
  let game = fresh(), session = newSession(null);
  session.modelOf.caocao = 'test/review';
  const plan = { objective: '守住治所', target: '济阴郡', stance: 'defend',
    preparation: '侦察邻郡', abortWhen: '治所失守时迁治', status: 'continue', review: '继续原计划' };
  const inputs = [];
  const client = { async chat(req) {
    inputs.push(JSON.parse(req.user));
    return { model: req.model, content: JSON.stringify({ picks: [], plan }), usage: null,
      structured: true, rung: 'schema', maxTokens: 8000, attempts: 1, elapsedMs: 1 };
  } };
  let priorOutcome;
  for (let i = 0; i < 2; i++) {
    if (i === 1) priorOutcome = outcomeFor(game, 'caocao');
    ({ game, session } = await advanceSeason(game, session, [], { ...deps, client }, () => {}));
  }
  assert.equal(inputs.length, 2, '提示不触发额外付费调用');
  assert.deepEqual(inputs[1].report.changes, priorOutcome);
  assert.equal(session.records[0].planWarning, undefined);
  assert.match(session.records[1].planWarning, /沿用上季/);
  const original = globalThis.localStorage, storage = new Map();
  globalThis.localStorage = { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k) };
  try {
    save({ game, session, seat: 'caocao', picked: [], packStamp: 'review' });
    const restored = load('review');
    assert.deepEqual(restored.game.lastOutcome, game.lastOutcome);
    assert.equal(restored.session.records[1].planWarning, session.records[1].planWarning);
  } finally { globalThis.localStorage = original; }
});
