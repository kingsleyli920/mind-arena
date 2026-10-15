// 离线复验：只重放已保存的真实响应；任何新增模型请求都会失败。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { b, P, g, roster, geo, deps, identity, leaders } from './lib/strategy-context.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { observe } from '../lib/game/engine/observe.ts';
import { reserveDecision, settleDecision } from './lib/comparison-budget.mjs';

const { values } = parseArgs({ options: { report: { type: 'string' } } });
assert.ok(values.report, '需要 --report 报告路径');
const report = JSON.parse(fs.readFileSync(values.report, 'utf8'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
assert.equal(report.completed, true);
assert.equal(report.live, true);
assert.equal(report.sourceSha256, identity.sourceSha256, '引擎已改变');
assert.equal(report.runtimeSha256, identity.runtimeSha256, '剧本已改变');
assert.equal(report.cases.length, 3);
assert.equal(report.runs.length, 15);
const states = new Map();
let game = createGame(b, { seed: 'strategy-cases-0', roster, geo, graph: g,
  endCondition: 'unification' }, P);
let play = newSession(null);
play.callLimit = 0;
const maxTurn = Math.max(...report.cases.map(c => c.turn));
while (game.turn <= maxTurn) {
  states.set(game.turn, structuredClone(game));
  if (game.turn === maxTurn) break;
  ({ game, session: play } = await advanceSeason(game, play, [], deps, () => {}));
}

const budget = { calls: 0, attempts: 0, heldUsd: 0, reportedUsd: 0 };
let replayed = 0, frames = 0;
for (const scenario of report.cases) {
  assert.equal(hash(states.get(scenario.turn)), scenario.stateSha256);
  assert.equal(hash(scenario.input), scenario.inputSha256);
  assert.deepEqual(report.runs.filter(r => r.case === scenario.id).map(r => r.model),
    ['bot', 'hold', 'openai/gpt-5-nano', 'google/gemini-2.5-flash-lite', 'openai/gpt-5-mini']);
}
for (const run of report.runs) {
  const scenario = report.cases.find(c => c.id === run.case);
  let state = structuredClone(states.get(scenario.turn));
  let session = newSession(run.model === 'hold' ? scenario.seat : null);
  session.since = scenario.since;
  session.plans[scenario.seat] = structuredClone(scenario.priorPlan);
  session.callLimit = run.provider ? 1 : 0;
  if (run.provider) session.modelOf[scenario.seat] = run.model;
  assert.equal(hash(state), run.stateSha256);
  if (run.provider) {
    assert.equal(run.inputSha256, scenario.inputSha256);
    assert.equal(run.response.provider, run.provider);
    assert.ok(run.response.structured && run.response.finishReason !== 'length');
    const bytes = Buffer.byteLength(scenario.input.system + scenario.input.user
      + JSON.stringify(scenario.input.schema));
    assert.equal(bytes, run.reservation.bytes);
    const ticket = reserveDecision(budget, bytes, report.prices[run.model], report.limits);
    assert.equal(ticket.reserved, run.reservation.reserved);
    settleDecision(budget, ticket, run.response, report.limits);
  }
  const client = { async chat(req) {
    assert.ok(run.response, '免费分支不应请求模型');
    assert.equal(hash({ system: req.system, user: req.user, schema: req.schema }), run.inputSha256);
    replayed++;
    return structuredClone(run.response);
  } };
  assert.equal(run.frames.length, 3);
  for (const [index, frame] of run.frames.entries()) {
    const since = state.log.length;
    const out = await advanceSeason(state, session, [], { ...deps, client }, () => {});
    const observation = observe(out.game, scenario.seat, g, P, roster, geo);
    assert.equal(out.game.turn, frame.turn);
    assert.deepEqual(out.rejected, frame.rejected);
    assert.equal(out.rejected.length, 0);
    assert.deepEqual(leaders(out.game).find(f => f.id === scenario.seat) ?? null, frame.after);
    assert.deepEqual(observation.seat, frame.capital);
    assert.deepEqual(observation.report.changes, frame.changes);
    assert.deepEqual(out.game.log.slice(since).filter(e => e.faction === scenario.seat), frame.events);
    if (index === 0 && run.provider) {
      assert.deepEqual(out.session.records.at(-1), frame.record);
      assert.ok(!frame.record.failure);
      assert.deepEqual(scenario.candidates.filter(c => frame.record.admission.admitted.includes(c.key)), frame.orders);
    }
    state = out.game;
    session = { ...out.session, human: null, modelOf: {} };
    frames++;
  }
}
assert.equal(replayed, 9);
assert.deepEqual(budget, report.budget);
console.log(JSON.stringify({ verified: true, realResponsesReplayed: replayed,
  settlementFrames: frames, newPaidCalls: 0, budget }));
