import fs from "node:fs";
import { createGame } from "../../../lib/game/engine/setup.ts";
import { buildGraph } from "../../../lib/game/engine/actions.ts";
import { buildRoster } from "../../../lib/game/engine/officers.ts";
import { buildGeography } from "../../../lib/game/engine/victory.ts";
import { loadParams } from "../../../lib/game/engine/params.ts";
import { advanceSeason, newSession } from "../../../lib/game/session.ts";
const R = new URL("../../../", import.meta.url).pathname;
const b = JSON.parse(fs.readFileSync(R + "public/game/runtime-194.json", "utf8"));
const P = loadParams(b.pack), g = buildGraph(b.adjacency);
const roster = buildRoster(b.officers, { officers: b.officers.map(o => ({ id: o.id, available: true })) },
  new Map(b.commanderies.map(c => [c.name, c.id])));
const geo = buildGeography(b.commanderies, b.provinceSeats);
const client = { chat() { throw new Error("no model"); } };

// 开局结构指标（与对局无关，只算一次）
const base = createGame(b, { seed: "probe", roster, geo, graph: g, seasons: 64, endCondition: "unification" }, P);
const traits = {};
for (const fid of Object.keys(base.factions)) {
  const mine = Object.values(base.commanderies).filter(c => c.owner === fid);
  if (!mine.length) continue;
  const set = new Set(mine.map(c => c.id));
  const ext = new Map();
  for (const c of mine) for (const e of (g.adj.get(c.id) ?? [])) {
    if (!set.has(e.to)) ext.set(e.to, Math.min(ext.get(e.to) ?? Infinity, e.cost));
  }
  const costs = [...ext.values()];
  traits[fid] = {
    lands: mine.length,
    garrison: mine.reduce((n, c) => n + c.garrison, 0),
    nbr: ext.size,
    meanCost: costs.length ? costs.reduce((a, c) => a + c, 0) / costs.length : 99,
    minCost: costs.length ? Math.min(...costs) : 99,
    cheap: costs.filter(c => c <= 5).length,   // 便宜方向数
  };
}
// 对局：记每家第 16 季的郡数增量
const GAMES = Number(process.env.GAMES ?? 12);
const delta = {}; for (const f of Object.keys(traits)) delta[f] = [];
for (let i = 0; i < GAMES; i++) {
  let game = createGame(b, { seed: `terrain-${i}`, roster, geo, graph: g, seasons: 64, endCondition: "season-limit" }, P);
  let session = newSession(null); session.callLimit = 0;
  while (!game.finished && game.turn < 16) {
    ({ game, session } = await advanceSeason(game, session, [], { P, g, roster, geo, pack: b.pack, client }, () => {}));
  }
  for (const f of Object.keys(traits)) {
    const n = Object.values(game.commanderies).filter(c => c.owner === f).length;
    delta[f].push(n - traits[f].lands);
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify({ traits, delta }, null, 2));
