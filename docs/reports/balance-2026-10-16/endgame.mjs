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
const out = [];
for (let i = 0; i < Number(process.env.GAMES ?? 6); i++) {
  let game = createGame(b, { seed: `strategy-session-${i}`, roster, geo, graph: g, seasons: 64, endCondition: "unification" }, P);
  let session = newSession(null); session.callLimit = 0;
  const perTurn = [];
  let seen = 0;
  while (!game.finished && game.turn < 64) {
    ({ game, session } = await advanceSeason(game, session, [], { P, g, roster, geo, pack: b.pack, client }, () => {}));
    const fresh = game.log.slice(seen); seen = game.log.length;
    const k = {};
    for (const e of fresh) if (e.kind === "siege-win" || e.kind === "siege-starve" || e.kind === "isolated-submit")
      k[e.kind] = (k[e.kind] ?? 0) + 1;
    perTurn.push({ t: game.turn, ...k });
  }
  out.push({ seed: i, winner: game.winner, turns: game.turn, perTurn });
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
