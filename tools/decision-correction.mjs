// 同一自然后续局面的成对测试。默认免费预检；--live 才付费；--replay 免费重放实测。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { b, P, g, roster, geo, deps, identity } from './lib/strategy-context.mjs';
import { reserveDecision, settleDecision } from './lib/comparison-budget.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { observe } from '../lib/game/engine/observe.ts';
import { previousDecision } from '../lib/game/decision-review.ts';
import { outcomeFor } from '../lib/game/engine/season-outcome.ts';
import { OpenRouterClient } from '../lib/arena/llm/client.ts';

const { values } = parseArgs({ options: {
  live: { type: 'boolean', default: false }, replay: { type: 'string' },
  followup: { type: 'boolean', default: false },
  focus: { type: 'boolean', default: false },
  reset: { type: 'boolean', default: false },
  backups: { type: 'boolean', default: false },
  planState: { type: 'boolean', default: false },
  out: { type: 'string', default: '/tmp/mind-arena-decision-correction' },
} });
assert.ok(!(values.live && values.replay), '--live 和 --replay 不能混用');
assert.ok([values.followup, values.focus, values.reset, values.backups, values.planState]
  .filter(Boolean).length <= 1,
  '一次只选一种固定对照模式');
const sourceFile = 'docs/reports/decision-comparison-2026-09-28/live.json';
const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const replay = values.replay ? JSON.parse(fs.readFileSync(values.replay, 'utf8')) : null;
assert.equal(source.completed, true);
if (replay) assert.ok(replay.completed || replay.runs.some(r => r.record?.failure),
  '只能重放已完成或明确记录失败的实验');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// 与落盘 JSON 使用同一表示；可选字段的 undefined 在文件中不存在。
const jsonValue = value => JSON.parse(JSON.stringify(value));
const baselineFile = values.planState
  ? 'docs/reports/decision-backups-2026-09-29/live.json'
  : values.backups
  ? 'docs/reports/decision-guidance-2026-09-29/phase3-live.json'
  : values.focus || values.reset
  ? 'docs/reports/decision-guidance-2026-09-29/phase1-live.json'
  : 'docs/reports/decision-correction-2026-09-28/live.json';
const baseline = values.followup || values.focus || values.reset || values.backups || values.planState
  ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
if (baseline) assert.equal(baseline.completed, true);
const limits = { decisions: values.reset || values.backups || values.planState ? 1 : baseline ? 3 : 6,
  attempts: 2, maxTokens: 8000, maxInputBytes: 70000,
  usd: values.backups || values.planState ? .03 : .20, timeoutMs: 90000 };
const allCases = [
  { id: 'multifront', model: 'openai/gpt-5-nano', provider: 'OpenAI', maxInput: .05e-6, maxOutput: .4e-6 },
  { id: 'siege', model: 'openai/gpt-5-nano', provider: 'OpenAI', maxInput: .05e-6, maxOutput: .4e-6 },
  { id: 'capital', model: 'google/gemini-2.5-flash-lite', provider: 'Google', maxInput: .1e-6, maxOutput: .4e-6 },
];
const cases = values.reset || values.backups || values.planState ? allCases.slice(0, 1) : allCases;
fs.mkdirSync(values.out, { recursive: true });
const file = path.join(values.out, 'report.json');
fs.writeFileSync(file, '{}\n', { flag: 'wx' });
const report = { ...identity, createdAt: new Date().toISOString(),
  mode: values.live ? 'live' : replay ? 'replay' : 'preflight', sourceFile, sourceSha256: hash(source),
  ...(baseline ? { baselineFile, baselineSha256: hash(baseline) } : {}),
  limits, prices: {}, budget: { calls: 0, attempts: 0, heldUsd: 0, reportedUsd: 0 }, cases: [], runs: [] };
const write = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
write();

// 重新生成历史决策前状态，再用历史响应结算一季。新测试的旧计划来自模型本身。
const states = new Map();
let game = createGame(b, { seed: 'strategy-cases-0', roster, geo, graph: g, endCondition: 'unification' }, P);
let session = newSession(null);
session.callLimit = 0;
while (game.turn <= 3) {
  states.set(game.turn, structuredClone(game));
  if (game.turn === 3) break;
  ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
}
const scenarios = [];
for (const entry of cases) {
  const original = source.runs.find(r => r.case === entry.id && r.model === entry.model);
  const scenario = source.cases.find(c => c.id === entry.id);
  const state = structuredClone(states.get(scenario.turn));
  assert.equal(hash(state), scenario.stateSha256, '历史战局已变化，停止比较');
  const play = newSession(null);
  play.callLimit = 2;
  play.since = scenario.since;
  play.modelOf[scenario.seat] = entry.model;
  play.plans[scenario.seat] = structuredClone(scenario.priorPlan);
  const out = await advanceSeason(state, play, [], { ...deps,
    client: { async chat() { return structuredClone(original.response); } } }, () => {});
  const record = out.session.records.at(-1);
  assert.deepEqual(record.admission, original.frames[0].record.admission);
  assert.deepEqual(record.plan, original.frames[0].record.plan);
  assert.deepEqual(outcomeFor(out.game, scenario.seat), original.frames[0].changes);
  assert.deepEqual(out.game.log.slice(state.log.length).filter(e => e.faction === scenario.seat), original.frames[0].events);
  assert.equal(out.rejected.length, 0);
  scenarios.push({ ...entry, seat: scenario.seat, game: out.game, session: out.session });
  if (baseline) assert.equal(hash(out.game), baseline.cases.find(c => c.id === entry.id)?.stateSha256,
    '同一后续局面已变化');
  report.cases.push({ ...entry, seat: scenario.seat, turn: out.game.turn,
    stateSha256: hash(out.game), priorPlan: record.plan, receipt: record.review,
    facts: observe(out.game, scenario.seat, g, P, roster, geo, { since: out.session.since, plan: record.plan }),
    ownArmies: out.game.armies.filter(a => a.faction === scenario.seat) });
}
if (replay) {
  assert.equal(replay.sourceSha256, report.sourceSha256);
  if (baseline) assert.equal(replay.baselineSha256, report.baselineSha256);
  assert.deepEqual(replay.cases, jsonValue(report.cases), '重放前提已变化');
}
write();

let upstream;
if (values.live) {
  assert.ok(process.env.OPENROUTER_API_KEY, '没有密钥，不发付费请求');
  for (const entry of cases) {
    if (report.prices[entry.model]) continue;
    const response = await fetch(`https://openrouter.ai/api/v1/models/${entry.model}/endpoints`,
      { signal: AbortSignal.timeout(15000) });
    assert.ok(response.ok, '无法确认端点价格');
    const endpoints = (await response.json()).data.endpoints.filter(e => e.provider_name === entry.provider);
    assert.ok(endpoints.length && endpoints.every(e => e.supported_parameters.includes('structured_outputs')),
      '固定提供方必须支持结构化输出');
    const price = { input: Math.max(...endpoints.map(e => Number(e.pricing.prompt))),
      output: Math.max(...endpoints.map(e => Number(e.pricing.completion))) };
    assert.ok(price.input > 0 && price.input <= entry.maxInput
      && price.output > 0 && price.output <= entry.maxOutput, '价格超出白名单上限');
    report.prices[entry.model] = { ...price, provider: entry.provider, checkedAt: new Date().toISOString() };
  }
  upstream = new OpenRouterClient(process.env.OPENROUTER_API_KEY, { maxAttempts: limits.attempts });
  write();
}

outer: for (const [index, scenario] of scenarios.entries()) {
  let baseInput;
  // 交替顺序只减少固定先后顺序的影响；一次成对样本不用于统计推断。
  const conditions = baseline ? ['receipt']
    : index % 2 ? ['receipt', 'legacy'] : ['legacy', 'receipt'];
  for (const condition of conditions) {
    const state = structuredClone(scenario.game), play = structuredClone(scenario.session);
    if (condition === 'legacy') for (const record of play.records) delete record.review;
    const run = { case: scenario.id, model: scenario.model, condition, stateSha256: hash(state) };
    report.runs.push(run);
    const expected = replay?.runs.find(r => r.case === run.case && r.model === run.model && r.condition === condition);
    let calls = 0;
    const client = { async chat(req) {
      calls++;
      assert.equal(calls, 1, '每个分支仅允许一次逻辑决策');
      run.input = { system: req.system, user: req.user, schema: req.schema, reasoning: req.reasoning };
      run.inputSha256 = hash(run.input);
      if (baseline) {
        const before = baseline.runs.find(r => r.case === scenario.id && r.condition === 'receipt');
        assert.deepEqual(req.reasoning, before.input.reasoning);
        if (values.planState) {
          assert.deepEqual(req.schema, before.input.schema);
          assert.notEqual(req.system, before.input.system, '计划状态说明应已变化');
          const current = JSON.parse(req.user), old = JSON.parse(before.input.user);
          assert.equal(current.version, '1.7.0');
          assert.equal(old.version, '1.6.0');
          delete current.version;
          delete old.version;
          const currentReceipt = current.decisionLastSeason;
          const oldReceipt = old.decisionLastSeason;
          assert.ok(currentReceipt && oldReceipt);
          assert.deepEqual(currentReceipt.admitted, oldReceipt.admitted);
          assert.deepEqual(currentReceipt.dropped, oldReceipt.dropped);
          assert.deepEqual(currentReceipt.checks.filter(x => !x.includes('旧阶段的客观条件已改变')),
            oldReceipt.checks);
          assert.equal(currentReceipt.checks.length, oldReceipt.checks.length + 1,
            '只增加一条旧阶段已失效的状态提示');
          delete current.decisionLastSeason;
          delete old.decisionLastSeason;
          assert.deepEqual(current, old, '除版本与状态提示外观测不得变化');
        } else if (values.backups) {
          assert.equal(req.user, before.input.user, '观测必须与原局面完全相同');
          assert.notEqual(req.system, before.input.system);
          const schema = structuredClone(req.schema);
          delete schema.schema.properties.backups;
          schema.schema.required = schema.schema.required.filter(k => k !== 'backups');
          assert.deepEqual(schema, before.input.schema, 'schema 除备选字段外必须相同');
        } else if (values.focus || values.reset) {
          assert.deepEqual(req.schema, before.input.schema);
          if (values.focus) assert.equal(req.system, before.input.system, '只有观测末段可以变化');
          else assert.notEqual(req.system, before.input.system, '重定目标提示应已变化');
          const current = JSON.parse(req.user), old = JSON.parse(before.input.user);
          assert.equal(current.version, '1.6.0');
          assert.equal(old.version, '1.5.0');
          delete current.version;
          if (values.focus) {
            assert.ok(current.decisionFocus);
            delete current.decisionFocus;
          } else {
            assert.equal(current.plan, null);
            assert.equal(current.planReset.target, scenario.session.plans[scenario.seat].target);
            delete current.planReset;
            delete current.plan;
            delete old.plan;
          }
          delete old.version;
          assert.deepEqual(current, old, '除预期字段与版本外观测不得变化');
        } else {
          assert.deepEqual(req.schema, before.input.schema);
          assert.equal(req.user, before.input.user, '观测不一致，不能只比较提示词变化');
          assert.notEqual(req.system, before.input.system, '系统提示词没有变化');
        }
        run.baselineInputSha256 = before.inputSha256;
      }
      const observation = JSON.parse(req.user);
      if (condition === 'receipt') {
        assert.deepEqual(observation.decisionLastSeason,
          previousDecision(state, scenario.seat, scenario.session.records.at(-1).review));
        assert.equal(observation.droppedLastSeason, undefined);
      } else assert.equal(observation.decisionLastSeason, undefined);
      delete observation.decisionLastSeason;
      delete observation.droppedLastSeason;
      const normalized = { ...run.input, user: JSON.stringify(observation) };
      if (baseInput) assert.deepEqual(normalized, baseInput, '除收据字段外输入必须完全相同');
      else baseInput = normalized;
      run.baseInputSha256 = hash(normalized);
      const bytes = Buffer.byteLength(req.system + req.user + JSON.stringify(req.schema));
      assert.ok(bytes <= limits.maxInputBytes);
      if (replay) {
        assert.ok(expected?.response);
        assert.deepEqual(run.input, expected.input, '当前实际请求与已记录请求不符');
        return structuredClone(expected.response);
      }
      if (!values.live) {
        // 预检只验证路径、输入与结算，无模型质量含义。
        const historical = source.runs.find(r => r.case === scenario.id && r.model === scenario.model);
        return structuredClone(historical.response);
      }
      const ticket = reserveDecision(report.budget, bytes, report.prices[req.model], limits);
      run.reservation = { ...ticket, bytes };
      write();
      try {
        run.response = await upstream.chat({ ...req,
          provider: { order: [scenario.provider], allow_fallbacks: false },
          maxTokens: limits.maxTokens, maxTokensLimit: limits.maxTokens,
          maxAttempts: limits.attempts, timeoutMs: limits.timeoutMs });
        settleDecision(report.budget, ticket, run.response, limits);
        return run.response;
      } catch (error) {
        run.requestError = error.message;
        throw error; // 没返回时保留全部预留；整批停止。
      } finally { write(); }
    } };
    const out = await advanceSeason(state, play, [], { ...deps, client }, () => {});
    run.record = out.session.records.at(-1);
    run.afterStateSha256 = hash(out.game);
    run.changes = outcomeFor(out.game, scenario.seat);
    run.events = out.game.log.slice(state.log.length).filter(e => e.faction === scenario.seat);
    run.rejected = out.rejected;
    write();
    assert.equal(calls, 1);
    if (expected) {
      for (const key of ['record', 'afterStateSha256', 'changes', 'events', 'rejected'])
        assert.deepEqual(jsonValue(run[key]), expected[key], `重放不一致：${key}`);
    }
    if (run.record.failure || run.requestError) {
      if (!expected) throw new Error('调用失败，停止整批');
      report.stoppedAt = { case: run.case, kind: run.record.failureKind };
      write();
      break outer;
    }
    assert.equal(out.rejected.length, 0, '准入后结算拒绝');
    console.log(JSON.stringify({ case: run.case, model: run.model, condition, mode: report.mode,
      admitted: run.record.admission.admitted.length, dropped: run.record.admission.dropped.length,
      checks: run.record.review.checks.map(c => c.code), budget: report.budget }));
  }
}
assert.equal(report.runs.length, limits.decisions);
if (!report.stoppedAt) report.completed = true;
write();
