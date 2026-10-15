// 固定局面单步对照：默认免费；--live 才发 3 模型 × 3 局面的真实请求。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { b, P, g, roster, geo, deps, identity, leaders } from './lib/strategy-context.mjs';
import { reserveDecision, settleDecision } from './lib/comparison-budget.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { observe } from '../lib/game/engine/observe.ts';
import { supplyReach } from '../lib/game/engine/resolve.ts';
import { listActions } from '../lib/game/engine/actions.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { renderSystem, renderUser } from '../lib/arena/seat/prompt.ts';
import { decisionSchema } from '../lib/arena/seat/parse.ts';
import { OpenRouterClient } from '../lib/arena/llm/client.ts';

const { values } = parseArgs({ options: {
  live: { type: 'boolean', default: false },
  out: { type: 'string', default: '/tmp/mind-arena-decision-compare' },
} });
fs.mkdirSync(values.out, { recursive: true });
const file = path.join(values.out, 'report.json');
// 独占创建也挡住两次并行启动，已有中断记录必须保留，不能重新付费覆盖。
fs.writeFileSync(file, '{}\n', { flag: 'wx' });
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const limits = { decisions: 9, attempts: 2, maxTokens: 8000, maxInputBytes: 70000,
  usd: .20, timeoutMs: 90000 };
const models = [
  { model: 'openai/gpt-5-nano', provider: 'OpenAI', maxInput: .05e-6, maxOutput: .4e-6 },
  { model: 'google/gemini-2.5-flash-lite', provider: 'Google', maxInput: .1e-6, maxOutput: .4e-6 },
  { model: 'openai/gpt-5-mini', provider: 'OpenAI', maxInput: .25e-6, maxOutput: 2e-6 },
];
const report = { ...identity, createdAt: new Date().toISOString(), live: values.live, limits,
  memorySource: '人工预设的旧计划，用于检验事实冲突后的更新；不是模型历史成绩',
  budget: { calls: 0, attempts: 0, heldUsd: 0, reportedUsd: 0 }, prices: {}, cases: [], runs: [] };
const write = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
write();

const memories = {
  capital: { objective: '以东海治所为基地，攻取东莱郡', target: '东莱郡', stance: 'attack',
    preparation: '保持东海郡控制与补给，派兵攻取东莱郡', abortWhen: '东海治所失守则先恢复治所和补给',
    status: 'continue', review: '东海治所仍在我方，可继续向东莱进军' },
  siege: { objective: '维持东莱围城直到占领东莱郡', target: '东莱郡', stance: 'attack',
    preparation: '依托东海郡后方补给维持围城', abortWhen: '后方失守或军粮只剩一季时撤围保兵',
    status: 'continue', review: '后方补给稳定，继续围城等待破城' },
  multifront: { objective: '占领辽西郡，巩固幽州', target: '辽西郡', stance: 'attack',
    preparation: '集中兵力夺取辽西郡，达成后重新选择目标', abortWhen: '两处己方城池同时被围则重新安排防守',
    status: 'continue', review: '辽西尚未取得，继续执行攻取辽西的目标' },
};

// 只从自然免费对局抽取状态；不为了给模型制造输赢而修改兵力或归属。
const scenarios = new Map();
let game = createGame(b, { seed: 'strategy-cases-0', roster, geo, graph: g,
  endCondition: 'unification' }, P);
let session = newSession(null);
session.callLimit = 0;
for (let turn = 0; turn < 16 && !game.finished && scenarios.size < 3; turn++) {
  for (const faction of Object.values(game.factions)) {
    if (faction.eliminated || faction.retired) continue;
    const observation = observe(game, faction.id, g, P, roster, geo, { since: session.since });
    if (observation.mine.length < 2) continue;
    const reach = supplyReach(game, g, faction.id);
    const risky = game.armies.filter(a => a.faction === faction.id && a.target
      && a.marchLeft === 0 && a.supply <= 1 && !reach.has(a.home));
    const threatened = [...new Set(game.armies.filter(a => a.target && a.faction !== faction.id
      && a.marchLeft === 0 && game.commanderies[a.target]?.owner === faction.id).map(a => a.target))];
    const matches = {
      capital: faction.id === 'liubei' && !observation.seat.capitalHeld
        && observation.report.changes?.lost.includes(faction.capital),
      siege: faction.id === 'liubei' && risky.some(a => a.target === '东莱郡'),
      multifront: faction.id === 'gongsundu' && threatened.length >= 2
        && observation.report.changes?.gained.includes('辽西郡'),
    };
    for (const [id, matched] of Object.entries(matches)) {
      if (!matched || scenarios.has(id)) continue;
      const state = structuredClone(game);
      const priorPlan = memories[id];
      const cands = listActions(state, faction.id, g, P, undefined, roster, undefined, geo);
      const input = { system: renderSystem(b.pack),
        user: renderUser(observe(state, faction.id, g, P, roster, geo,
          { since: session.since, plan: priorPlan })), schema: decisionSchema(cands) };
      const facts = { seat: observation.seat, changes: observation.report.changes,
        threatened, riskyArmies: risky.map(a => ({ id: a.id, target: a.target, home: a.home,
          supply: a.supply, troops: a.troops })) };
      const scenario = { id, seat: faction.id, turn: state.turn, since: session.since,
        stateSha256: hash(state), inputSha256: hash(input), priorPlan, facts, input,
        candidates: cands.map(c => ({ key: c.key, action: c.action, label: c.label })) };
      scenarios.set(id, { ...scenario, state });
      report.cases.push(scenario);
    }
  }
  if (scenarios.size < 3) ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
}
assert.equal(scenarios.size, 3, '未找到全部固定挑战局面');
write();

let upstream;
if (values.live) {
  assert.ok(process.env.OPENROUTER_API_KEY, '没有密钥，不发付费请求');
  for (const entry of models) {
    const response = await fetch(`https://openrouter.ai/api/v1/models/${entry.model}/endpoints`,
      { signal: AbortSignal.timeout(15000) });
    assert.ok(response.ok, '无法确认端点价格');
    const endpoints = (await response.json()).data.endpoints.filter(e => e.provider_name === entry.provider);
    assert.ok(endpoints.length && endpoints.every(e => e.supported_parameters.includes('structured_outputs')),
      '固定提供方必须支持结构化输出');
    const price = { input: Math.max(...endpoints.map(e => Number(e.pricing.prompt))),
      output: Math.max(...endpoints.map(e => Number(e.pricing.completion))) };
    assert.ok(price.input > 0 && price.input <= entry.maxInput
      && price.output > 0 && price.output <= entry.maxOutput, '模型价格超出白名单上限');
    report.prices[entry.model] = { ...price, provider: entry.provider, checkedAt: new Date().toISOString() };
  }
  upstream = new OpenRouterClient(process.env.OPENROUTER_API_KEY, { maxAttempts: limits.attempts });
  write();
}

for (const scenario of scenarios.values()) {
  for (const entry of [{ model: 'bot' }, { model: 'hold' }, ...(values.live ? models : [])]) {
    let state = structuredClone(scenario.state);
    let play = newSession(entry.model === 'hold' ? scenario.seat : null);
    play.since = scenario.since;
    play.callLimit = entry.provider ? 1 : 0;
    play.plans[scenario.seat] = structuredClone(scenario.priorPlan);
    if (entry.provider) play.modelOf[scenario.seat] = entry.model;
    const run = { case: scenario.id, model: entry.model, provider: entry.provider ?? null,
      stateSha256: hash(state), before: leaders(state).find(f => f.id === scenario.seat), frames: [] };
    report.runs.push(run);
    write();
    const client = { async chat(req) {
      assert.ok(upstream);
      const input = { system: req.system, user: req.user, schema: req.schema };
      run.inputSha256 = hash(input);
      assert.equal(run.inputSha256, scenario.inputSha256, '同一局面输入不一致，停止比较');
      const bytes = Buffer.byteLength(input.system + input.user + JSON.stringify(input.schema));
      const ticket = reserveDecision(report.budget, bytes, report.prices[req.model], limits);
      run.reservation = { ...ticket, bytes };
      write();
      try {
        const response = await upstream.chat({ ...req,
          provider: { order: [entry.provider], allow_fallbacks: false },
          maxTokens: limits.maxTokens, maxTokensLimit: limits.maxTokens,
          maxAttempts: limits.attempts, timeoutMs: limits.timeoutMs });
        run.response = response;
        settleDecision(report.budget, ticket, response, limits);
        return response;
      } catch (error) {
        run.requestError = error.message;
        // 无返回时保留整笔预留，包括超时后可能仍在上游计费的请求。
        throw error;
      } finally { write(); }
    } };
    // 首季为待测决策，随后两季统一换回免费机器人，只观察短期后果。
    for (let offset = 0; offset < 3 && !state.finished; offset++) {
      const since = state.log.length;
      const out = await advanceSeason(state, play, [], { ...deps, client }, reserved => {
        run.callsReserved = reserved.callsUsed;
        write();
      });
      const record = offset === 0 && entry.provider ? out.session.records.at(-1) : null;
      const after = observe(out.game, scenario.seat, g, P, roster, geo);
      run.frames.push({ turn: out.game.turn, controller: offset === 0 ? entry.model : 'bot', record,
        after: leaders(out.game).find(f => f.id === scenario.seat) ?? null,
        capital: after.seat, changes: after.report.changes,
        orders: record ? scenario.candidates.filter(c => record.admission.admitted.includes(c.key)) : null,
        rejected: out.rejected,
        events: out.game.log.slice(since).filter(e => e.faction === scenario.seat) });
      write();
      assert.equal(out.rejected.length, 0, '准入后结算仍拒绝命令');
      state = out.game;
      play = { ...out.session, human: null, modelOf: {} };
      if (record?.failure || run.requestError) break;
    }
    console.log(JSON.stringify({ case: scenario.id, model: entry.model,
      admitted: run.frames[0].record?.admission.admitted.length,
      failure: run.frames[0].record?.failure, cost: run.response?.usage?.cost,
      budget: report.budget }));
    // 一旦有真实调用失败就停止整批，保留原始证据；不会静默改用机器人冒充模型结果。
    assert.ok(!run.frames[0].record?.failure && !run.requestError, '调用失败，停止后续付费');
  }
}
report.completed = true;
write();
