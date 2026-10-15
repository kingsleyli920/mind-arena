// 默认免费。--live 才调用两种低价模型；固定自然局面，每模型每场景仅两季。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { b, P, g, roster, geo, deps, identity, leaders } from './lib/strategy-context.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { upkeepFor } from '../lib/game/engine/economy.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { OpenRouterClient } from '../lib/arena/llm/client.ts';

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false },
  out: { type: 'string', default: '/tmp/mind-arena-strategy-cases' },
  'resume-from': { type: 'string' } } });
fs.mkdirSync(values.out, { recursive: true });
const file = path.join(values.out, 'report.json');
assert.ok(!fs.existsSync(file), '目录已有报告；禁止覆盖或重复消费');
const limits = { decisions: 14, attempts: 2, maxRequests: 28, maxTokens: 8000,
  maxInputBytes: 70000, reservedUsd: .20, timeoutMs: 90000 };
const report = { ...identity, pack: b.pack.version, live: values.live, limits,
  calls: 0, reservedUsd: 0, reportedUsd: 0, cases: [], runs: [] };
const prior = values['resume-from'] ? JSON.parse(fs.readFileSync(values['resume-from'], 'utf8')) : null;
if (prior) {
  assert.equal(prior.live, values.live);
  assert.equal(prior.sourceSha256, identity.sourceSha256, '引擎已改变，不能复用旧场景');
  assert.equal(prior.runtimeSha256, identity.runtimeSha256);
  report.calls = prior.calls; report.reservedUsd = prior.reservedUsd; report.reportedUsd = prior.reportedUsd;
  report.previousRuns = prior.runs;
}
const write = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
// 只释放已成功且有账单的最后一次请求余量；失败与重试的预留继续保留。
const releasedReserve = () => report.runs.reduce((sum, run) => sum + run.frames.reduce((subtotal, frame) => {
  const record = frame.record;
  const input = run.inputs.find(i => i.turn === record?.turn);
  const price = report.prices?.[run.model];
  if (!input || !price || record.failure || record.usage?.cost == null) return subtotal;
  const perAttempt = (input.bytes + 4096) * price.input + limits.maxTokens * price.output;
  return subtotal + Math.max(0, perAttempt - record.usage.cost);
}, 0), 0);
write();
const cases = new Map();
let game = createGame(b, { seed: 'strategy-cases-0', roster, geo, graph: g, endCondition: 'unification' }, P);
let session = newSession(null); session.callLimit = 0;
for (let i = 0; i < 32 && !game.finished && cases.size < 3; i++) {
  for (const f of Object.values(game.factions)) {
    const lands = Object.values(game.commanderies).filter(c => c.owner === f.id).length;
    if (f.eliminated || f.retired || lands < 3) continue;
    const attacking = game.armies.filter(a => a.faction === f.id && a.target && a.marchLeft === 0).length;
    const defending = game.armies.filter(a => a.faction !== f.id && a.target
      && game.commanderies[a.target]?.owner === f.id && a.marchLeft === 0).length;
    const upkeep = upkeepFor(game, f.id, P);
    for (const [id, met] of Object.entries({ treasury: f.gold < upkeep * 2,
      siege: attacking > 0, multifront: defending >= 2 })) {
      if (!met || cases.has(id)) continue;
      cases.set(id, { game: structuredClone(game), seat: f.id });
      report.cases.push({ id, turn: game.turn, seat: f.id, lands, gold: f.gold, upkeep, attacking, defending,
        stateSha256: crypto.createHash('sha256').update(JSON.stringify(game)).digest('hex') });
    }
  }
  ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
}
assert.equal(cases.size, 3, '自然对局未产生所需局面');

const models = [ { model: 'openai/gpt-5-nano', provider: 'OpenAI' },
  { model: 'google/gemini-2.5-flash-lite', provider: 'Google' } ];
const prices = new Map();
let upstream;
if (values.live) {
  assert.ok(process.env.OPENROUTER_API_KEY, '缺少密钥，不发付费请求');
  for (const entry of models) {
    const response = await fetch(`https://openrouter.ai/api/v1/models/${entry.model}/endpoints`);
    assert.ok(response.ok, '无法确认价格');
    const endpoints = (await response.json()).data.endpoints.filter(e => e.provider_name === entry.provider);
    assert.ok(endpoints.length && endpoints.every(e => e.supported_parameters.includes('structured_outputs')));
    const price = { input: Math.max(...endpoints.map(e => Number(e.pricing.prompt))),
      output: Math.max(...endpoints.map(e => Number(e.pricing.completion))) };
    assert.ok(price.input <= .0000001 && price.output <= .0000004, '价格超限');
    prices.set(entry.model, price);
  }
  report.prices = Object.fromEntries(prices);
  upstream = new OpenRouterClient(process.env.OPENROUTER_API_KEY, { maxAttempts: limits.attempts });
}

for (const [id, scenario] of cases) {
  for (const entry of [{ model: 'bot' }, ...(values.live ? models : [])]) {
    const reusable = prior?.runs.find(r => r.case === id && r.model === entry.model
      && r.frames.length === 2 && r.frames.every(f => !f.record?.failure));
    if (reusable) { report.runs.push({ ...reusable, reused: true }); write(); continue; }
    let s = structuredClone(scenario.game), play = newSession(null);
    play.callLimit = entry.model === 'bot' ? 0 : 2;
    if (entry.model !== 'bot') play.modelOf[scenario.seat] = entry.model;
    const run = { case: id, model: entry.model, provider: entry.provider ?? null,
      before: leaders(s).find(f => f.id === scenario.seat), frames: [], inputs: [] };
    report.runs.push(run); write();
    const partial = prior?.runs.find(r => r.case === id && r.model === entry.model);
    // 从原局面重放已成功决策，核对结算后再续跑；不重复付费，也不使用失败季状态。
    for (const frame of partial?.frames ?? []) {
      const record = frame.record;
      if (!record || record.failure) break;
      const replayClient = { async chat() { return { ...record,
        content: JSON.stringify({ picks: record.picks, reason: record.reason, plan: record.plan }) }; } };
      const since = s.log.length;
      const replay = await advanceSeason(s, play, [], { ...deps, client: replayClient }, () => {});
      assert.deepEqual(leaders(replay.game).find(f => f.id === scenario.seat) ?? null, frame.after);
      assert.deepEqual(replay.game.log.slice(since).filter(e => e.faction === scenario.seat), frame.events);
      assert.deepEqual(replay.session.records.at(-1).admission.admitted, record.admission.admitted);
      s = replay.game; play = replay.session;
      run.frames.push(frame);
      run.inputs.push(partial.inputs.find(i => i.turn === record.turn));
    }
    if (run.frames.length) { run.replayedSeasons = run.frames.length; write(); }
    const client = { async chat(req) {
      assert.ok(upstream && prices.has(req.model));
      const bytes = Buffer.byteLength(req.system + req.user + JSON.stringify(req.schema));
      assert.ok(bytes <= limits.maxInputBytes && report.calls < limits.decisions);
      const price = prices.get(req.model);
      const reserve = limits.attempts * ((bytes + 4096) * price.input + limits.maxTokens * price.output);
      report.releasedUsd = releasedReserve();
      assert.ok(report.reservedUsd - report.releasedUsd + reserve <= limits.reservedUsd, '预留费用触顶，停止');
      const observation = JSON.parse(req.user);
      assert.deepEqual(observation.plan, play.plans[scenario.seat] ?? null);
      run.inputs.push({ turn: s.turn, bytes, priorPlan: observation.plan,
        seat: observation.seat, changes: observation.report.changes ?? null,
        feedback: observation.planFeedback ?? null, dropped: observation.droppedLastSeason ?? [] });
      report.calls++; report.reservedUsd += reserve; write();
      return upstream.chat({ ...req, provider: { order: [entry.provider], allow_fallbacks: false },
        maxTokens: limits.maxTokens, maxTokensLimit: limits.maxTokens,
        timeoutMs: limits.timeoutMs, maxAttempts: limits.attempts });
    } };
    for (let turn = run.frames.length; turn < 2 && !s.finished; turn++) {
      const since = s.log.length;
      const out = await advanceSeason(s, play, [], { ...deps, client }, reserved => {
        fs.writeFileSync(path.join(values.out, 'reserved.json'), JSON.stringify({ case: id, model: entry.model,
          turn: s.turn, callsUsed: reserved.callsUsed, reservedUsd: report.reservedUsd }));
      }, (_seat, record) => {
        fs.appendFileSync(path.join(values.out, 'decisions.jsonl'), JSON.stringify({ case: id, ...record }) + '\n');
        report.reportedUsd += record.usage?.cost ?? 0; write();
      });
      s = out.game; play = out.session;
      const record = play.records.at(-1);
      const rejected = out.rejected.filter(r => r.order.faction === scenario.seat);
      run.frames.push({ turn: s.turn, record, rejected,
        after: leaders(s).find(f => f.id === scenario.seat) ?? null,
        events: s.log.slice(since).filter(e => e.faction === scenario.seat) });
      write();
      assert.equal(rejected.length, 0, '准入与结算不一致');
      if (entry.model !== 'bot') {
        assert.ok(record && !record.failure, record?.failure);
        assert.ok(record.plan && typeof record.plan === 'object', '未返回结构化计划');
      }
      console.log(JSON.stringify({ case: id, model: entry.model, turn: s.turn,
        admitted: record?.admission.admitted.length, dropped: record?.admission.dropped.length,
        cost: record?.usage?.cost }));
    }
  }
}
report.completed = true; report.releasedUsd = releasedReserve();
report.heldUsd = report.reservedUsd - report.releasedUsd; write();
console.log(JSON.stringify({ completed: true, calls: report.calls, reportedUsd: report.reportedUsd,
  reservedUsd: report.reservedUsd, releasedUsd: report.releasedUsd, heldUsd: report.heldUsd }));
