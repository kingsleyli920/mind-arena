import fs from "node:fs";
import { createGame } from "../../../lib/game/engine/setup.ts";
import { buildGraph } from "../../../lib/game/engine/actions.ts";
import { buildRoster } from "../../../lib/game/engine/officers.ts";
import { buildGeography } from "../../../lib/game/engine/victory.ts";
import { loadParams } from "../../../lib/game/engine/params.ts";
import { decideForPlay } from "../../../lib/game/engine/bot.ts";
import { advanceSeason, newSession } from "../../../lib/game/session.ts";
const R = new URL("../../../", import.meta.url).pathname;
const b = JSON.parse(fs.readFileSync(R + "public/game/runtime-194.json", "utf8"));
const P = loadParams(b.pack), g = buildGraph(b.adjacency);
const roster = buildRoster(b.officers, { officers: b.officers.map(o => ({ id: o.id, available: true })) },
  new Map(b.commanderies.map(c => [c.name, c.id])));
const geo = buildGeography(b.commanderies, b.provinceSeats);
const client = { chat() { throw new Error("no model"); } };
const WATCH = ["yuanshao", "liuzhang", "liubiao", "caocao", "lubu"];
const acc = {};
for (const w of WATCH) acc[w] = { seasons: 0, ap: 0, used: 0, byAct: {}, lands: 0, gold: 0, fronts: 0 };
for (let i = 0; i < Number(process.env.GAMES ?? 3); i++) {
  let game = createGame(b, { seed: `strategy-session-${i}`, roster, geo, graph: g, seasons: 64, endCondition: "unification" }, P);
  let session = newSession(null); session.callLimit = 0;
  while (!game.finished && game.turn < 64) {
    for (const w of WATCH) {
      const f = game.factions[w];
      if (!f || f.eliminated) continue;
      const mine = Object.values(game.commanderies).filter(c => c.owner === w);
      if (!mine.length) continue;
      const orders = decideForPlay(game, w, g, undefined, roster, P, geo);
      const a = acc[w];
      a.seasons += 1; a.ap += f.ap ?? 0; a.used += orders.length;
      a.lands += mine.length; a.gold += f.gold ?? 0;
      const hostile = new Set();
      for (const c of mine) for (const e of (g.adj.get(c.id) ?? [])) {
        const o = game.commanderies[e.to]?.owner; if (o && o !== w) hostile.add(o);
      }
      a.fronts += hostile.size;
      for (const o of orders) a.byAct[o.action] = (a.byAct[o.action] ?? 0) + 1;
    }
    ({ game, session } = await advanceSeason(game, session, [], { P, g, roster, geo, pack: b.pack, client }, () => {}));
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify(acc, null, 2));
