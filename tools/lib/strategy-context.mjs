import { cmp } from "../../lib/game/engine/cmp.ts";
// 战略验证共用的数据、规则与度量；导入本模块不会发模型请求。
import fs from "node:fs";
import crypto from "node:crypto";
import { buildGraph, listActions } from "../../lib/game/engine/actions.ts";
import { decideForPlay } from "../../lib/game/engine/bot.ts";
import { buildRoster } from "../../lib/game/engine/officers.ts";
import { buildGeography, standingOf } from "../../lib/game/engine/victory.ts";
import { loadParams } from "../../lib/game/engine/params.ts";
import { supplyReach } from "../../lib/game/engine/resolve.ts";

// 剧本由 SCENARIO 选（默认 194）。自对局与长局都要能指向另一份数据包，
// 否则新剧本只能靠读文件猜，验不了。
const SCENARIO = process.env.SCENARIO ?? "194";
const raw = fs.readFileSync(`public/game/runtime-${SCENARIO}.json`, "utf8");
const b = JSON.parse(raw), P = loadParams(b.pack), g = buildGraph(b.adjacency);
const roster = buildRoster(b.officers,
  { officers: b.officers.map((o) => ({ id: o.id, available: true })) },
  new Map(b.commanderies.map((c) => [c.name, c.id])));
const geo = buildGeography(b.commanderies, b.provinceSeats);
const client = { chat() { throw new Error("零费用审计禁止模型调用"); } };
const deps = { P, g, roster, geo, pack: b.pack, client };
const profiles = ["play-unification"];
const count = (xs) => xs.reduce((out, key) => { out[key] = (out[key] ?? 0) + 1; return out; }, {});
const total = (xs) => xs.reduce((a, n) => a + n, 0);
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const sourceFiles = ["lib/game/session.ts", ...fs.readdirSync("lib/game/engine")
  .filter((f) => f.endsWith(".ts")).sort().map((f) => `lib/game/engine/${f}`)];
const identity = { runtimeSha256: hash(raw), sourceSha256: hash(sourceFiles
  .map((f) => `${f}\n${fs.readFileSync(f, "utf8")}`).join("\n")) };

function leaders(game) {
  const counts = count(Object.values(game.commanderies).map((c) => c.owner ?? "neutral"));
  return Object.values(game.factions).filter((f) => !f.eliminated && !f.retired)
    .map((f) => ({ id: f.id, lands: counts[f.id] ?? 0,
      zhou: standingOf(game, geo, f.id).controlledZhou, gold: Math.round(f.gold) }))
    .sort((a, b) => b.lands - a.lands || cmp(a.id, b.id));
}

function inspectFaction(game, id) {
  const own = Object.values(game.commanderies).filter((c) => c.owner === id);
  const reachable = supplyReach(game, g, id);
  const profile = "play-unification";
  const candidates = listActions(game, id, g, P, undefined, roster, undefined, geo);
  const orders = decideForPlay(game, id, g, undefined, roster, P, geo);
  const campaigns = candidates.filter((c) => c.action.type === "campaign");
  return { id, profile, ap: game.factions[id].ap, gold: Math.round(game.factions[id].gold),
    lands: own.length, supplied: own.filter((c) => reachable.has(c.id)).length,
    garrison: total(own.map((c) => c.garrison)), armies: game.armies.filter((a) => a.faction === id).length,
    candidates: count(candidates.map((c) => c.action.type)), orders: orders.map((o) => o.action),
    campaigns: campaigns.map((c) => ({ key: c.key, from: c.action.from, target: c.action.target,
      targetOwner: game.commanderies[c.action.target]?.owner,
      forecast: c.forecast, field: c.field, gain: c.gain })),
  };
}

export { b, P, g, roster, geo, deps, profiles, identity, leaders, inspectFaction, count };
