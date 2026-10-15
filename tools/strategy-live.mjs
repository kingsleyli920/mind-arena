// 两席四季的有界实测。默认仅机器人，显式 --live 才访问模型；已有目录不能续扣费。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { createGame } from '../lib/game/engine/setup.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { OpenRouterClient } from '../lib/arena/llm/client.ts';
import { b, P, g, roster, geo, deps, identity, leaders } from './lib/strategy-context.mjs';

const { values } = parseArgs({ options: {
  live: { type: 'boolean', default: false },
  out: { type: 'string', default: '/tmp/mind-arena-strategy-live' },
  seed: { type: 'string', default: 'strategy-session-2' },
} });
const outputPath = path.join(values.out, 'report.json');
if (fs.existsSync(outputPath)) throw new Error('输出目录已有记录，请保留原记录并使用新目录，防止重复消费');
fs.mkdirSync(values.out, { recursive: true });
const limits = { seasons: 4, calls: 8, attempts: 2, maxRequests: 16, tokens: 8000,
  maxInputBytes: 90000, maxReservedCost: 0.20 };
const report = { ...identity, packVersion: b.pack.version, seed: values.seed, live: values.live,
  limits, calls: 0, reservedCost: 0, reportedCost: 0, unknownCost: 0, frames: [], inputChecks: [] };
const write = () => fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
write();
let game = createGame(b, { seed: values.seed, roster, geo, graph: g, seasons: 64, endCondition: 'unification' }, P);
let session = newSession(null); session.callLimit = 0;
// 先用真实的免费对局推进到中盘，模型接管时不改兵力、金钱或所有权。
while (!game.finished && game.turn < 24) ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
assert.ok(!game.finished, '该种子已结束，不发模型请求');
const seats = leaders(game).slice(0, 2).map(f => f.id);
const modelOf = Object.fromEntries(seats.map((f, i) => [f, ['z-ai/glm-5.3-flash', 'openai/gpt-5-nano'][i]]));
report.fromTurn = game.turn; report.modelOf = values.live ? modelOf : {};
report.before = leaders(game);
fs.writeFileSync(path.join(values.out, 'checkpoint.json'), JSON.stringify({ ...identity, game, session }));

let client = deps.client;
if (values.live) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('缺少 API 密钥，未请求模型');
  const response = await fetch('https://openrouter.ai/api/v1/models');
  assert.ok(response.ok, '无法确认现行价格，未请求模型');
  const catalog = await response.json();
  const prices = Object.fromEntries(Object.values(modelOf).map(id => {
    const pricing = catalog.data.find(m => m.id === id)?.pricing;
    assert.ok(pricing, `模型 ${id} 不可用`);
    for (const [key, value] of Object.entries(pricing)) {
      if (!['prompt', 'completion', 'input_cache_read', 'input_cache_write', 'web_search'].includes(key)) {
        assert.ok(Number(value) === 0, `${id} 存在额外 ${key} 费用，停止实测`);
      }
    }
    assert.ok(Number(pricing.prompt) >= 0 && Number(pricing.prompt) <= 0.0000002);
    assert.ok(Number(pricing.completion) >= 0 && Number(pricing.completion) <= 0.0000006);
    return [id, pricing];
  }));
  report.prices = prices;
  const upstream = new OpenRouterClient(process.env.OPENROUTER_API_KEY, { maxAttempts: limits.attempts });
  client = { async chat(req) {
    assert.ok(prices[req.model], '禁止调用未批准的模型');
    assert.ok(report.calls < limits.calls, '已达请求上限');
    const bytes = Buffer.byteLength(req.system + req.user + JSON.stringify(req.schema ?? {}));
    assert.ok(bytes <= limits.maxInputBytes, '输入过大，停止实测');
    // 用 UTF-8 字节数上界及额外消息开销预留费用，失败/超时不退预留。
    const reserve = limits.attempts * ((bytes + 4096) * Number(prices[req.model].prompt)
      + limits.tokens * Number(prices[req.model].completion));
    assert.ok(report.reservedCost + reserve <= limits.maxReservedCost, '已达费用预留上限');
    const observation = JSON.parse(req.user);
    const seat = Object.keys(modelOf).find(f => modelOf[f] === req.model);
    const oldPlan = session.plans[seat] ?? null;
    report.inputChecks.push({ turn: game.turn, seat,
      priorPlanPresent: oldPlan === null || req.user.includes(JSON.stringify(oldPlan).slice(1,-1)),
      observationKeys: Object.keys(observation), bytes });
    assert.ok(report.inputChecks.at(-1).priorPlanPresent, '上季计划未进入真实模型请求');
    report.calls++; report.reservedCost += reserve; write();
    return upstream.chat({ ...req, maxTokens: limits.tokens, maxTokensLimit: limits.tokens,
      maxAttempts: limits.attempts, timeoutMs: 180000 });
  } };
  session = { ...session, modelOf, callLimit: limits.calls };
}
write();
for (let i = 0; i < limits.seasons && !game.finished; i++) {
  const before = game;
  const result = await advanceSeason(game, session, [], { ...deps, client }, reserved => {
    fs.writeFileSync(path.join(values.out, 'reservation.json'), JSON.stringify({ game, session: reserved }));
  }, (seat, record) => {
    fs.appendFileSync(path.join(values.out, 'decisions.jsonl'), JSON.stringify(record) + '\n');
    report.reportedCost += record.usage?.cost ?? 0;
    if (record.usage?.cost == null) report.unknownCost++;
    write();
    console.log(JSON.stringify({ seat, turn: record.turn, failure: record.failure,
      admitted: record.admission.admitted.length, dropped: record.admission.dropped.length,
      cost: record.usage?.cost, elapsedMs: record.elapsedMs }));
  });
  game = result.game; session = result.session;
  const records = session.records.filter(r => r.turn === before.turn);
  report.frames.push({ turn: game.turn, records, leaders: leaders(game),
    changed: Object.values(game.commanderies).filter(c => c.owner !== before.commanderies[c.id].owner)
      .map(c => ({ at: c.id, from: before.commanderies[c.id].owner, to: c.owner })),
    events: game.log.slice(before.log.length) });
  fs.writeFileSync(path.join(values.out, 'settled.json'), JSON.stringify({ game, session }));
  write();
  if (records.some(r => r.failure)) { report.stop = 'model-failure'; write(); break; }
}
report.stop ??= game.finished ? 'unification' : 'four-seasons-complete';
write();
console.log(JSON.stringify({ stop: report.stop, calls: report.calls, reportedCost: report.reportedCost,
  reservedCost: report.reservedCost, unknownCost: report.unknownCost }));
