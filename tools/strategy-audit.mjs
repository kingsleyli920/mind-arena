// 零费用战略长局审计。用 --out 指定报告与第64季快照目录。
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createGame } from "../lib/game/engine/setup.ts";
import { advanceSeason, newSession } from "../lib/game/session.ts";
import { b, P, g, roster, geo, deps, profiles, identity, leaders, inspectFaction, count } from "./lib/strategy-context.mjs";

const { values } = parseArgs({ options: {
  out: { type: "string", default: "/tmp/mind-arena-strategy-audit" },
  seeds: { type: "string", default: "6" },
  seasons: { type: "string", default: "64,104" },
} });
const seedCount = Number(values.seeds);
const lengths = values.seasons.split(",").map(Number);
if (!Number.isInteger(seedCount) || seedCount < 1 || seedCount > 30
    || lengths.some((n) => ![16, 32, 64, 104].includes(n))) throw new Error("无效的样本数或局长");
fs.mkdirSync(values.out, { recursive: true });
const report = { ...identity, createdAt: new Date().toISOString(),
  configuration: { seedCount, lengths, profiles, calls: 0 }, runs: [] };
for (const seasons of lengths) for (let i = 0; i < seedCount; i++) {
  const seed = `strategy-session-${i}`;
  let game = createGame(b, { seed, roster, geo, graph: g, seasons, endCondition: "unification" }, P);
  let session = newSession(null); session.callLimit = 0;
  const frames = [], windows = [];
  let changes = 0, contested = 0, idle = 0, maxIdle = 0, eventKinds = [];
  let shortAlliances = 0;
  while (!game.finished && game.turn < seasons) {
    const before = game;
    ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
    const events = game.log.slice(before.log.length);
    const changed = Object.values(game.commanderies).filter((c) => c.owner !== before.commanderies[c.id].owner);
    const contestedThisTurn = changed.filter((c) => c.owner && before.commanderies[c.id].owner).length;
    changes += changed.length; contested += contestedThisTurn;
    idle = changed.length ? 0 : idle + 1; maxIdle = Math.max(maxIdle, idle);
    eventKinds.push(...events.map((e) => e.kind));
    const brokenYoung = before.treaties.filter((t) => t.until > before.turn
      && before.turn - t.from <= 1 && !game.treaties.some((n) => n.a === t.a && n.b === t.b));
    shortAlliances += brokenYoung.length;
    frames.push({ turn: game.turn, changed: changed.length, contested: contestedThisTurn,
      alive: leaders(game).length, armies: game.armies.length,
      ally: events.filter((e) => e.kind === "ally").length,
      breaks: events.filter((e) => e.kind === "ally-break").length });
    if (game.turn % 16 === 0 || game.finished || game.turn === seasons) {
      windows.push({ turn: game.turn, changes, contested, events: count(eventKinds),
        shortAlliances, idle, maxIdle, leaders: leaders(game), armies: game.armies.length });
      changes = 0; contested = 0; shortAlliances = 0; eventKinds = [];
    }
    // 同一基线的后期局面，供后续有明确额度的模型分支复用；无网络调用。
    if (seasons === 104 && i === 1 && game.turn === 64) {
      fs.writeFileSync(path.join(values.out, "checkpoint-64.json"), JSON.stringify({ ...identity, game, session }));
      fs.writeFileSync(path.join(values.out, "checkpoint-analysis.json"), JSON.stringify(
        leaders(game).slice(0, 5).map((f) => inspectFaction(game, f.id)), null, 2));
    }
  }
  const row = { seed, seasons, finished: game.finished,
    stopReason: game.finished ? "unification" : "test-budget-paused", winner: game.winner, turns: game.turn, calls: session.callsUsed,
    lastChange: [...frames].reverse().find((f) => f.changed)?.turn ?? 0, maxIdle,
    windows, frames };
  report.runs.push(row);
  fs.writeFileSync(path.join(values.out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ seed, seasons, winner: row.winner, alive: leaders(game).length,
    leader: leaders(game)[0], lastChange: row.lastChange, maxIdle, calls: row.calls }));
}
