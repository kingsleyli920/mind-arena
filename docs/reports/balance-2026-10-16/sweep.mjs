import fs from "node:fs";
import { createGame } from "../../../lib/game/engine/setup.ts";
import { buildGraph } from "../../../lib/game/engine/actions.ts";
import { buildRoster } from "../../../lib/game/engine/officers.ts";
import { buildGeography } from "../../../lib/game/engine/victory.ts";
import { loadParams } from "../../../lib/game/engine/params.ts";
import { advanceSeason, newSession } from "../../../lib/game/session.ts";
const R = new URL("../../../", import.meta.url).pathname;
const raw = fs.readFileSync(R + "public/game/runtime-194.json", "utf8");
const GAMES = Number(process.env.GAMES ?? 12);
const CFG = JSON.parse(process.env.CFG);   // [[指数, 上限, 基数], …]
const out = [];
for (const [exp, cap, base] of CFG) {
  const b = JSON.parse(raw);
  b.pack.constants["令数"]["版图指数"] = exp;
  b.pack.constants["令数"]["上限"] = cap;
  b.pack.constants["令数"]["基数"] = base;
  const P = loadParams(b.pack), g = buildGraph(b.adjacency);
  const roster = buildRoster(b.officers, { officers: b.officers.map(o => ({ id: o.id, available: true })) },
    new Map(b.commanderies.map(c => [c.name, c.id])));
  const geo = buildGeography(b.commanderies, b.provinceSeats);
  const client = { chat() { throw new Error("no model"); } };
  const res = [];
  for (let i = 0; i < GAMES; i++) {
    let game = createGame(b, { seed: `strategy-session-${i}`, roster, geo, graph: g, seasons: 64, endCondition: "unification" }, P);
    let session = newSession(null); session.callLimit = 0;
    while (!game.finished && game.turn < 64) {
      ({ game, session } = await advanceSeason(game, session, [], { P, g, roster, geo, pack: b.pack, client }, () => {}));
    }
    const lands = Object.values(game.commanderies);
    const cnt = {}; for (const c of lands) if (c.owner) cnt[c.owner] = (cnt[c.owner] ?? 0) + 1;
    const top = Object.entries(cnt).sort((a, c) => c[1] - a[1]);
    res.push({ finished: game.finished, winner: game.winner, turns: game.turn,
               lead: top[0]?.[0], n: top[0]?.[1], alive: top.length });
  }
  out.push({ cfg: { exp, cap, base }, res });
  console.error(`done ${exp}/${cap}/${base}`);
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
