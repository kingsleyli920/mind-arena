import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createGame } from "../lib/game/engine/setup.ts";
import { buildGraph, listActions } from "../lib/game/engine/actions.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { buildGeography } from "../lib/game/engine/victory.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { advanceSeason, budgetMessage, newSession } from "../lib/game/session.ts";
import { save, load } from "../lib/game/save.ts";
import { OpenRouterClient } from "../lib/arena/llm/client.ts";

const bundle = JSON.parse(fs.readFileSync("public/game/runtime-194.json", "utf8"));
const P = loadParams(bundle.pack);
const g = buildGraph(bundle.adjacency);
const roster = buildRoster(bundle.officers,
  { officers: bundle.officers.map((o) => ({ id: o.id, available: true })) },
  new Map(bundle.commanderies.map((c) => [c.name, c.id])));
const geo = buildGeography(bundle.commanderies, bundle.provinceSeats);
const deps = { P, g, roster, geo, pack: bundle.pack };
const game = () => createGame(bundle, { seed: "session-regression", roster, geo, graph: g }, P);
const neverCall = { chat() { throw new Error("不应调用模型"); } };

test("纯机器人观战会为观察势力下令，且不消耗模型额度", async () => {
  const s = game(); const session = newSession(null);
  session.callLimit = 0;
  const r = await advanceSeason(s, session, [], { ...deps, client: neverCall }, () => {});
  assert.equal(r.game.turn, 1);
  assert.equal(r.session.callsUsed, 0);
  assert.ok(r.game.log.some((e) => e.faction === "caocao"));
  assert.equal(s.turn, 0);
});

test("两模型独立决策和跨季记忆；额度不够时整季不发请求", async () => {
  let s = game(); let session = newSession(null);
  session.modelOf = { caocao: "test/one", yuanshao: "test/two" };
  session.callLimit = 4;
  const calls = [];
  let reservations = 0;
  const client = { async chat(req) {
    assert.ok(reservations >= calls.length + 1, "必须先预留并保存调用额度");
    const observation = JSON.parse(req.user);
    calls.push({ model: req.model, observation });
    assert.equal(req.maxTokensLimit, 8000);
    assert.equal(req.maxAttempts, 2);
    return { content: JSON.stringify({ picks: [], plan: `方略-${req.model}`, reason: "等待" }),
      model: req.model, usage: { prompt: 10, completion: 10, cached: 0, reasoning: 0, cost: .001 },
      rung: "schema", structured: true, maxTokens: 8000, starved: 0,
      finishReason: "stop", attempts: 1, elapsedMs: 1 };
  } };
  for (let i = 0; i < 2; i++) {
    const r = await advanceSeason(s, session, [], { ...deps, client }, (reserved) => {
      reservations = reserved.callsUsed;
    });
    s = r.game; session = r.session;
  }
  assert.equal(session.callsUsed, 4);
  assert.equal(session.records.length, 4);
  for (const call of calls.slice(2)) {
    assert.equal(call.observation.plan, `方略-${call.model}`);
    assert.ok(call.observation.report.mine.length + call.observation.report.world.length > 0,
      "跨季观测必须带上上季战报");
  }
  assert.match(budgetMessage(s, session), /已暂停/);
  await assert.rejects(advanceSeason(s, session, [], { ...deps, client }, () => {}), /已暂停/);
  assert.equal(calls.length, 4);
});

test("玩家命令只用于玩家席位，模型和机器人不能接管玩家", async () => {
  const s = game(); const session = newSession("caocao");
  const scout = listActions(s, "caocao", g, P, undefined, roster, undefined, geo)
    .find((c) => c.action.type === "scout");
  assert.ok(scout);
  const r = await advanceSeason(s, session, [{ faction: "caocao", action: scout.action }],
    { ...deps, client: neverCall }, () => {});
  assert.ok(r.game.log.some((e) => e.faction === "caocao" && e.kind === "scout"));
  assert.equal(r.session.human, "caocao");
});

test("存档恢复控制者、方略、丢令、记录和已预留额度，拒绝旧规则", () => {
  const previous = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null };
  try {
    const s = game(); const session = newSession(null);
    session.modelOf = { caocao: "test/one", yuanshao: "test/two" };
    session.callsUsed = 2;
    session.plans.caocao = "先固守再东进";
    session.drops.caocao = [{ key: "bad", reason: "unknown-key" }];
    const data = { game: s, session, seat: "yuanshao", picked: [], packStamp: "rules-1" };
    assert.equal(save(data), true);
    assert.deepEqual(load("rules-1").session, session);
    assert.equal(load("rules-1").seat, "yuanshao");
    assert.equal(load("rules-2"), null);
    session.callsUsed = 100;
    save(data);
    assert.equal(load("rules-1"), null);
  } finally { globalThis.localStorage = previous; }
});

test("输出硬上限不会被已学习预算或饥饿重试突破", async () => {
  const previous = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    const b = JSON.parse(init.body); sent.push(b.max_tokens);
    return Response.json({ choices: [{ message: { content: "" }, finish_reason: "length" }],
      usage: { completion_tokens: b.max_tokens, cost: .001 } });
  };
  try {
    const client = new OpenRouterClient("test");
    await client.chat({ model: "test/bounded", system: "rules", user: "turn",
      maxTokens: 8000, maxAttempts: 2 });
    assert.deepEqual(sent, [8000, 16000], "先学习较大的预算");
    sent.length = 0;
    const r = await client.chat({ model: "test/bounded", system: "rules", user: "turn",
      maxTokens: 32000, maxTokensLimit: 4000, maxAttempts: 1 });
    assert.deepEqual(sent, [4000]);
    assert.equal(r.attempts, 1);
    assert.equal(r.maxTokens, 4000);
  } finally { globalThis.fetch = previous; }
});

test("结构化输出降档也不能超过两次请求", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("unsupported schema", { status: 400 });
  };
  try {
    const client = new OpenRouterClient("test");
    await assert.rejects(client.chat({ model: "test/retry-cap", system: "rules", user: "turn",
      schema: { name: "decision", strict: true, schema: {} }, maxAttempts: 2 }),
      (e) => e.attempts === 2);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = previous; }
});

test("额度无法落盘时，不发出任何模型请求", async () => {
  const session = newSession(null);
  session.modelOf = { caocao: "test/one" };
  let calls = 0;
  await assert.rejects(advanceSeason(game(), session, [], { ...deps,
    client: { chat() { calls++; throw new Error("不应发生"); } } },
  () => { throw new Error("无法保存额度"); }), /无法保存额度/);
  assert.equal(calls, 0);
});

test("统一局跨过评测季数仍可续玩；季数预算只暂停，存档保留结束模式", async () => {
  let s = createGame(bundle, { seed: "unification-clock", roster, geo, graph: g,
    seasons: 3, endCondition: "unification" }, P);
  let session = newSession(null);
  for (let i = 0; i < 4; i++) ({ game: s, session } = await advanceSeason(s, session, [],
    { ...deps, client: neverCall }, () => {}));
  assert.equal(s.turn, 4);
  assert.equal(s.finished, false);
  assert.equal(s.winner, null);
  const saved = new Map();
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem: (k, v) => saved.set(k, v), getItem: (k) => saved.get(k) };
  try {
    assert.equal(save({ packStamp: "unification", seat: "caocao", game: s, session, picked: [] }), true);
    const restored = load("unification");
    assert.equal(restored.game.endCondition, "unification");
    const next = await advanceSeason(restored.game, restored.session, [],
      { ...deps, client: neverCall }, () => {});
    assert.equal(next.game.turn, 5);
    assert.equal(next.game.finished, false);
  } finally { globalThis.localStorage = oldStorage; }
});

test("统一局只在胜利条件达成时结束；评测局仍按指定季数结束", async () => {
  const unified = createGame(bundle, { seed: "single-faction", roster, geo, graph: g,
    endCondition: "unification" }, P);
  for (const c of Object.values(unified.commanderies)) c.owner = "caocao";
  const won = await advanceSeason(unified, newSession("caocao"), [],
    { ...deps, client: neverCall }, () => {});
  assert.equal(won.game.finished, true);
  assert.equal(won.game.winner, "caocao");
  await assert.rejects(() => advanceSeason(won.game, won.session, [],
    { ...deps, client: neverCall }, () => {}), /已经结束/);
  const limited = createGame(bundle, { seed: "finite-eval", roster, geo, graph: g,
    seasons: 1, endCondition: "season-limit" }, P);
  const ended = await advanceSeason(limited, newSession(null), [],
    { ...deps, client: neverCall }, () => {});
  assert.equal(ended.game.finished, true);
  assert.equal(ended.game.turn, 1);
  assert.equal(ended.game.winner, null);
});

test("模型看到真实结束模式和屯田减免后的军费", async () => {
  const { observe } = await import("../lib/game/engine/observe.ts");
  const { upkeepFor } = await import("../lib/game/engine/economy.ts");
  const { renderSystem } = await import("../lib/arena/seat/prompt.ts");
  const s = game(); s.endCondition = "unification";
  const mine = Object.values(s.commanderies).find((c) => c.owner === "caocao");
  for (const c of Object.values(s.commanderies)) if (c.owner === "caocao") c.garrison = 0;
  mine.garrison = 10000; mine.buildings = ["farmstead"];
  const o = observe(s, "caocao", g, P, roster, geo);
  assert.equal(o.clock.endCondition, "unification");
  assert.equal(o.clock.totalTurns, null);
  assert.equal(o.treasury.upkeep, Math.round(10000 * P.farmsteadUpkeepCut * P.goldUpkeepPerTroop));
  assert.equal(upkeepFor(s, "caocao", { ...P, goldOn: false }), 0);
  assert.match(renderSystem(bundle.pack), /无季数终限/);
  assert.doesNotMatch(renderSystem(bundle.pack), /十六季后按战果/);
});

test("统一的两条胜利路径独立成立：控制11州，或最后一个有效势力", async () => {
  const { resolve } = await import("../lib/game/engine/resolve.ts");
  const { standingOf } = await import("../lib/game/engine/victory.ts");
  const s = game(); s.endCondition = "unification";
  const provinces = new Set([...geo.zhouMembers.keys()].slice(0, P.unifyZhou));
  for (const c of Object.values(s.commanderies)) c.owner = provinces.has(geo.zhouOf.get(c.id)) ? "caocao" : "liuzhang";
  for (const id of ["caocao", "liuzhang"]) {
    s.factions[id].capital = Object.values(s.commanderies).find((c) => c.owner === id).id;
  }
  const won = resolve(s, [], g, P, roster, geo).state;
  assert.equal(won.winner, "caocao");
  assert.equal(standingOf(won, geo, "caocao").controlledZhou, P.unifyZhou);
  assert.equal(won.factions.liuzhang.eliminated, false, "胜利不要求灭掉所有对手");
  const last = game(); last.endCondition = "unification";
  for (const f of Object.values(last.factions)) if (f.id !== "caocao") f.retired = true;
  const sole = resolve(last, [], g, P, roster, geo).state;
  assert.equal(sole.winner, "caocao");
  assert.ok(standingOf(sole, geo, "caocao").controlledZhou < P.unifyZhou);
});
