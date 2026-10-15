// 与浏览器同一条推进路径。默认三场 64 季，全机器人、零模型调用。
import fs from "node:fs";
import { createGame } from "../lib/game/engine/setup.ts";
import { buildGraph } from "../lib/game/engine/actions.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { buildGeography } from "../lib/game/engine/victory.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { advanceSeason, newSession } from "../lib/game/session.ts";

const b = JSON.parse(fs.readFileSync("public/game/runtime-194.json", "utf8"));
const P = loadParams(b.pack), g = buildGraph(b.adjacency);
const roster = buildRoster(b.officers,
  { officers: b.officers.map((o) => ({ id: o.id, available: true })) },
  new Map(b.commanderies.map((c) => [c.name, c.id])));
const geo = buildGeography(b.commanderies, b.provinceSeats);
const client = { chat() { throw new Error("机器人长局不得调用模型"); } };
const reports = [];
for (let i = 0; i < 3; i++) {
  const seed = `strategy-session-${i}`;
  let game = createGame(b, { seed, roster, geo, graph: g, seasons: 64, endCondition: "unification" }, P);
  let session = newSession(null); session.callLimit = 0;
  const quarters = [];
  while (!game.finished && game.turn < 64) {
    ({ game, session } = await advanceSeason(game, session, [], { P, g, roster, geo, pack: b.pack, client }, () => {}));
    if (game.turn % 16 === 0 || game.finished) {
      const lands = Object.values(game.commanderies);
      const counts = Object.keys(game.factions).map((id) => ({ id,
        lands: lands.filter((c) => c.owner === id).length }));
      quarters.push({ turn: game.turn, alive: counts.filter((f) => f.lands).length,
        largest: counts.sort((a, b) => b.lands - a.lands).slice(0, 3), armies: game.armies.length });
    }
  }
  const events = {};
  for (const e of game.log) events[e.kind] = (events[e.kind] ?? 0) + 1;
  const report = { seed, finished: game.finished,
    stopReason: game.finished ? "unification" : "test-budget-paused", turns: game.turn, winner: game.winner, calls: session.callsUsed, events, quarters };
  reports.push(report);
  console.log(JSON.stringify(report));
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(reports, null, 2) + "\n");
