// 免费回放历史模型响应：验证新校验与跨季反馈，不测模型收到新提示后的表现。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { b, P, g, roster, geo, deps, leaders, identity } from './lib/strategy-context.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { previousDecision } from '../lib/game/decision-review.ts';
import { outcomeFor } from '../lib/game/engine/season-outcome.ts';
import { estTokens } from '../lib/game/engine/observe.ts';
import { packStamp } from '../lib/game/save.ts';

const { values } = parseArgs({ options: { out: { type: 'string', default: '/tmp/mind-arena-decision-review' } } });
fs.mkdirSync(values.out, { recursive: true });
const file = path.join(values.out, 'report.json');
fs.writeFileSync(file, '{}\n', { flag: 'wx' });
const source = JSON.parse(fs.readFileSync('docs/reports/decision-comparison-2026-09-28/live.json', 'utf8'));
assert.equal(source.completed, true);
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const states = new Map();
let game = createGame(b, { seed: 'strategy-cases-0', roster, geo, graph: g, endCondition: 'unification' }, P);
let session = newSession(null);
session.callLimit = 0;
while (game.turn <= 3) {
  states.set(game.turn, structuredClone(game));
  if (game.turn === 3) break;
  ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
}
const report = { ...identity, paidRequests: 0, mode: 'archived-response-replay', cases: [] };
const fixtures = [];
for (const run of source.runs.filter(r => r.response)) {
  const scenario = source.cases.find(c => c.id === run.case);
  let state = structuredClone(states.get(scenario.turn)), play = newSession(null);
  assert.equal(hash(state), scenario.stateSha256, '游戏规则或初始状态已变，不能直接比较');
  play.callLimit = 2;
  play.since = scenario.since;
  play.modelOf[scenario.seat] = run.model;
  play.plans[scenario.seat] = scenario.priorPlan;
  const inputs = [];
  const client = { async chat(req) { inputs.push(JSON.parse(req.user)); return structuredClone(run.response); } };
  let out = await advanceSeason(state, play, [], { ...deps, client }, () => {});
  const record = out.session.records.at(-1);
  assert.equal(out.rejected.length, 0);
  assert.deepEqual(record.admission, run.frames[0].record.admission);
  assert.deepEqual(record.plan, run.frames[0].record.plan, '校验不能修改 AI 原文');
  assert.deepEqual(leaders(out.game).find(f => f.id === scenario.seat), run.frames[0].after);
  assert.deepEqual(outcomeFor(out.game, scenario.seat), run.frames[0].changes);
  assert.deepEqual(out.game.log.slice(state.log.length).filter(e => e.faction === scenario.seat), run.frames[0].events);
  if (run.model === 'openai/gpt-5-nano') fixtures.push({ id: scenario.id,
    game: out.game, session: { ...out.session, callLimit: 1 }, seat: scenario.seat, picked: [],
    packStamp: packStamp(P.seasonsPerGame, b.commanderies.length, P.epochCount, b.pack.constants) });
  state = out.game; play = out.session;
  const expected = previousDecision(state, scenario.seat, record.review);
  out = await advanceSeason(state, play, [], { ...deps, client }, () => {});
  assert.equal(inputs.length, 2, '新提示不能自动多调用模型');
  assert.deepEqual(inputs[1].decisionLastSeason, expected);
  assert.equal(inputs[1].droppedLastSeason, undefined, '避免重复传同一份丢令');
  assert.equal(out.rejected.length, 0);
  assert.equal(record.review.commands.length, record.admission.admitted.length + record.admission.dropped.length);
  const tokens = inputs.map(o => estTokens(JSON.stringify(o)));
  assert.ok(tokens.every(n => n <= 10000), '新反馈导致实际样本观测超预算');
  report.cases.push({ case: run.case, model: run.model, checks: record.review.checks,
    commands: record.review.commands, nextFeedback: inputs[1].decisionLastSeason, observationTokens: tokens });
}
assert.equal(report.cases.length, 9);
report.completed = true;
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(values.out, 'ui-fixtures.json'), JSON.stringify(fixtures));
console.log(JSON.stringify({ completed: true, cases: report.cases.length,
  replayedResponses: 18, paidRequests: 0, peakObservationTokens: Math.max(...report.cases.flatMap(c => c.observationTokens)),
  checks: report.cases.map(c => ({ case: c.case, model: c.model, codes: c.checks.map(x => x.code) })) }));
