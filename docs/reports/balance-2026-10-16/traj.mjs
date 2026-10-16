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
const zhou = Object.fromEntries(b.commanderies.map(c => [c.id, c.zhou]));
const out = [];
for (let i = 0; i < Number(process.env.GAMES ?? 3); i++) {
  let game = createGame(b, { seed: `strategy-session-${i}`, roster, geo, graph: g, seasons: 64, endCondition: "unification" }, P);
  let session = newSession(null); session.callLimit = 0;
  const series = [];
  while (!game.finished && game.turn < 64) {
    ({ game, session } = await advanceSeason(game, session, [], { P, g, roster, geo, pack: b.pack, client }, () => {}));
    const lands = Object.values(game.commanderies);
    const cnt = {};
    for (const c of lands) if (c.owner) cnt[c.owner] = (cnt[c.owner] ?? 0) + 1;
    const top = Object.entries(cnt).sort((a, c) => c[1] - a[1]);
    const lead = top[0], second = top[1] ?? ["-", 0];
    const yz = new Set(lands.filter(c => c.owner === lead[0]).map(c => zhou[c.id]));
    series.push({ t: game.turn, alive: top.length, lead: lead[0], n: lead[1],
      second: second[0], n2: second[1],
      gold: Math.round(game.factions[lead[0]]?.gold ?? 0),
      zhou: yz.size,
      armies: game.armies.length });
  }
  out.push({ seed: i, winner: game.winner, turns: game.turn, series });
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
