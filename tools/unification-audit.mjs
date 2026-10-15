// 零费用、外置季数预算：到预算只保存暂停态，不改胜负。
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { decide, PROFILES } from "../lib/game/engine/bot.ts";
import { advanceSeason, newSession } from "../lib/game/session.ts";
import { b, P, g, roster, geo, deps, identity, leaders, count } from "./lib/strategy-context.mjs";

const { values } = parseArgs({ options: {
  out: { type: "string", default: "/tmp/mind-arena-unification/current" },
  controller: { type: "string", default: "play" },
  seeds: { type: "string", default: "6" },
  budget: { type: "string", default: "256" },
} });
const profiles = Object.keys(PROFILES);
const seeds = Number(values.seeds), budget = Number(values.budget);
if (!["legacy", "play"].includes(values.controller) || !Number.isInteger(seeds) || seeds < 1 || seeds > 30
    || !Number.isInteger(budget) || budget < 1 || budget > 1024) throw new Error("无效审计配置");
fs.mkdirSync(values.out, { recursive: true });
const report = { ...identity, configuration: { seeds, budget, controller: values.controller,
  epochPace: 64, endCondition: "unification", calls: 0 }, runs: [] };
for (let i = 0; i < seeds; i++) {
  const seed = `strategy-session-${i}`;
  let game = createGame(b, { seed, roster, geo, graph: g, seasons: 64, endCondition: "unification" }, P);
  let session = newSession(null); session.callLimit = 0;
  const frames = [];
  while (!game.finished && game.turn < budget) {
    const before = game;
    if (values.controller === "legacy") {
      const orders = Object.keys(game.factions).sort().flatMap((id, n) =>
        game.factions[id].eliminated || game.factions[id].retired ? []
          : decide(game, id, g, profiles[n % profiles.length], undefined, roster, P, geo));
      const r = resolve(game, orders, g, P, roster, geo);
      game = r.state.finished ? r.state : refreshAp(r.state, P);
    } else ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
    const events = game.log.slice(before.log.length);
    frames.push({ turn: game.turn,
      changes: Object.values(game.commanderies).filter((c) => c.owner !== before.commanderies[c.id].owner).length,
      active: leaders(game).length, events: count(events.map((e) => e.kind)) });
  }
  const run = { seed, turn: game.turn, finished: game.finished, winner: game.winner,
    stopReason: game.finished ? "unification" : "test-budget-paused", leaders: leaders(game), frames };
  report.runs.push(run);
  fs.writeFileSync(path.join(values.out, "report.json"), JSON.stringify(report));
  // 保留一个真实未结束快照，证明预算停止后仍可续算。
  if (i === 0) fs.writeFileSync(path.join(values.out, "checkpoint.json"), JSON.stringify({ game, session }));
  console.log(JSON.stringify({ seed, turn: game.turn, winner: game.winner, active: run.leaders.length,
    first: run.leaders[0], stopReason: run.stopReason }));
}
