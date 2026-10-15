// 从审计快照作同局面对照。默认机器人；只有显式 --live 才可能花费。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { advanceSeason, newSession } from "../lib/game/session.ts";
import { refreshAp } from "../lib/game/engine/setup.ts";
import { decideForPlay } from "../lib/game/engine/bot.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { OpenRouterClient } from "../lib/arena/llm/client.ts";
import { deps, P, g, roster, geo, identity, leaders, count } from "./lib/strategy-context.mjs";

const { values } = parseArgs({ options: {
  checkpoint: { type: "string", default: "/tmp/mind-arena-strategy-audit/checkpoint-64.json" },
  out: { type: "string", default: "/tmp/mind-arena-strategy-audit/branches" },
  live: { type: "boolean", default: false },
} });
const checkpoint = JSON.parse(fs.readFileSync(values.checkpoint, "utf8"));
assert.equal(checkpoint.runtimeSha256, identity.runtimeSha256, "数据包已经改变，应重新生成快照");
assert.equal(checkpoint.sourceSha256, identity.sourceSha256, "引擎已经改变，应重新生成快照");
fs.mkdirSync(values.out, { recursive: true });
if (fs.existsSync(path.join(values.out, "report.json"))) {
  const previous = JSON.parse(fs.readFileSync(path.join(values.out, "report.json"), "utf8"));
  if (previous.calls > 0) throw new Error("该目录已有付费调用记录；为避免重复消费，请保留记录并显式选择新的输出目录");
}
const modelOf = { yuanshao: "z-ai/glm-5.3-flash", liubiao: "deepseek/deepseek-v4-flash" };
const output = { ...identity, seed: checkpoint.game.seed, fromTurn: checkpoint.game.turn,
  modelOf: values.live ? modelOf : {}, branches: [], calls: 0, reportedCost: 0,
  limit: { decisions: 12, attemptsPerDecision: 1, maxTokens: 8000, reportedCostStop: 0.05 } };
const write = () => fs.writeFileSync(path.join(values.out, "report.json"), JSON.stringify(output, null, 2) + "\n");

// 记录各席位实际命令、事件与局面变化。计划是否落实需要结合这些结果人工核对。
function frame(before, after, records = []) {
  return { turn: after.turn, leaders: leaders(after),
    changed: Object.values(after.commanderies).filter((c) => c.owner !== before.commanderies[c.id].owner)
      .map((c) => ({ at: c.id, from: before.commanderies[c.id].owner, to: c.owner })),
    events: after.log.slice(before.log.length),
    records: records.map((r) => ({ ...r })),
  };
}

// 两个零费用分支：现有机器人；移除它们已选中的主动外交令，空出的令不另花。
// 后者只用于隔离外交损耗，既不改变规则也不是拟发布的机器人策略。
for (const variant of ["bot", "without-voluntary-diplomacy"]) {
  let game = structuredClone(checkpoint.game);
  let session = newSession(null); session.callLimit = 0;
  const row = { variant, frames: [], filteredOrders: 0 };
  output.branches.push(row);
  const stopAt = game.turn + 40;
  while (!game.finished && game.turn < stopAt) {
    const before = game;
    const orders = Object.keys(game.factions).sort().flatMap((id) => {
      if (game.factions[id].eliminated || game.factions[id].retired) return [];
      return decideForPlay(game, id, g, undefined, roster, P, geo);
    });
    const filtered = variant === "bot" ? orders : orders.filter((o) => o.action.type !== "ally");
    row.filteredOrders += orders.length - filtered.length;
    const resolved = resolve(game, filtered, g, P, roster, geo).state;
    game = resolved.finished ? resolved : refreshAp(resolved, P);
    if (variant === "bot") {
      const actual = await advanceSeason(before, session, [], deps, () => {});
      assert.deepEqual(game, actual.game, "对照分支必须与浏览器推进路径逐位一致");
      session = actual.session;
    }
    row.frames.push(frame(before, game));
  }
  row.winner = game.winner;
  row.summary = { events: count(row.frames.flatMap((f) => f.events.map((e) => e.kind))),
    territoryTransfers: row.frames.reduce((n, f) => n + f.changed.length, 0), leaders: leaders(game) };
  write();
  console.log(JSON.stringify({ variant, ...row.summary }));
}

if (values.live) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("未配置 OPENROUTER_API_KEY；未发模型请求");
  // 运行时核对价格，避免模型涨价后脚本继续按旧价花费。
  const catalogResponse = await fetch("https://openrouter.ai/api/v1/models");
  if (!catalogResponse.ok) throw new Error("无法确认模型价格；未发模型请求");
  const catalog = await catalogResponse.json();
  output.prices = Object.values(modelOf).map((id) => {
    const m = catalog.data.find((x) => x.id === id);
    if (!m || !Number.isFinite(Number(m.pricing.prompt)) || !Number.isFinite(Number(m.pricing.completion))
        || Number(m.pricing.prompt) > 0.0000002 || Number(m.pricing.completion) > 0.0000006) {
      throw new Error(`${id} 不符合本次低价测试阈值；未发模型请求`);
    }
    return { id, pricing: m.pricing };
  });
  const upstream = new OpenRouterClient(process.env.OPENROUTER_API_KEY, { maxAttempts: 1 });
  const client = { async chat(req) {
    if (!Object.values(modelOf).includes(req.model) || output.calls >= 12) throw new Error("测试调用上限");
    if (req.system.length + req.user.length > 60000) throw new Error("测试输入过大，拒绝请求");
    output.calls++; write();
    return upstream.chat({ ...req, maxTokens: 8000, maxTokensLimit: 8000, maxAttempts: 1 });
  } };
  let game = structuredClone(checkpoint.game);
  let session = { ...newSession(null), modelOf, callLimit: 12, since: checkpoint.session.since };
  const row = { variant: "two-models", frames: [], stop: "six-seasons-complete" };
  output.branches.push(row); write();
  for (let season = 0; season < 6 && !game.finished; season++) {
    if (output.reportedCost >= 0.05) { row.stop = "reported-cost-threshold"; break; }
    const before = game;
    const result = await advanceSeason(game, session, [], { ...deps, client }, (reserved) => {
      fs.writeFileSync(path.join(values.out, "live-reservation.json"), JSON.stringify({ game, session: reserved }));
    }, (seat, record) => {
      // 每个模型返回即记录，进程中断仍留下已完成调用和费用证据。
      fs.appendFileSync(path.join(values.out, "decisions.jsonl"), JSON.stringify(record) + "\n");
      output.reportedCost += record.usage?.cost ?? 0;
      write();
      console.log(JSON.stringify({ seat, turn: record.turn, failure: record.failure,
        admitted: record.admission.admitted.length, dropped: record.admission.dropped.length,
        attempts: record.attempts, cost: record.usage?.cost, elapsedMs: record.elapsedMs }));
    });
    game = result.game; session = result.session;
    const records = session.records.filter((r) => r.turn === before.turn);
    row.frames.push(frame(before, game, records));
    fs.writeFileSync(path.join(values.out, "live-settled.json"), JSON.stringify({ game, session }));
    if (records.some((r) => r.failure)) { row.stop = "model-failure"; write(); break; }
    write();
  }
  row.summary = { leaders: leaders(game),
    territoryTransfers: row.frames.reduce((n, f) => n + f.changed.length, 0),
    events: count(row.frames.flatMap((f) => f.events.map((e) => e.kind))) };
  write();
}
