// 评测跑：让若干席位由指定的对局方驱动，打完整局，出记录与报告。
//
// 现在支持三类对局方：bot（确定性规则 AI）、stub（无密钥的桩）、
// model（接 OpenRouter，需 OPENROUTER_API_KEY）。
// 设计成先能用桩跑通整条管道——观测装配、准入、记录、报告——
// 否则这些代码在密钥到位前一行都没跑过，真接上模型时分不清是谁的问题。
//
// 用法：
//   node --experimental-strip-types tools/eval-run.mjs --agent=stub --games=6
//   node --experimental-strip-types tools/eval-run.mjs --agent=stub:chaos --games=2
import fs from "node:fs";
import { buildGraph, listActions, DEFAULT_RULES } from "../lib/game/engine/actions.ts";
import { decide } from "../lib/game/engine/bot.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { buildGeography } from "../lib/game/engine/victory.ts";
import { observe, estTokens } from "../lib/game/engine/observe.ts";
import { admit } from "../lib/arena/seat/admit.ts";
import { stubDecide } from "../lib/arena/seat/stub-seat.ts";
import { GRADE_SCORE } from "../lib/arena/scoring.ts";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const AGENT = arg("agent", "stub");
const GAMES = Number(arg("games", 6));
const OUT = arg("out", "");
const SEATS = (arg("seats", "caocao,yuanshao,liubiao,liuzhang,yuanshu,lubu")).split(",");

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const P = loadParams(pack);
const ROSTER = buildRoster(read("officers.json"), read("officer-availability-194.json"),
  new Map(read("commanderies.json").map((c) => [c.name, c.id])));
const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
const G = buildGraph(read("adjacency.json"));
const scenario = read("scenario-194.json");
const nameOf = (id) => scenario.factions.find((f) => f.id === id)?.name ?? id;
const DATA = {
  commanderyState: read("commandery-state.json"), scenario,
  commanderies: read("commanderies.json"), troopTypes: read("troop-types.json"),
};

const BOT_PROFILES = ["turtle", "balanced", "aggressive", "opportunist"];
const [agentKind, agentVariant = "random-legal"] = AGENT.split(":");
if (agentKind === "model") {
  console.error("model 对局方尚未接线（需 OPENROUTER_API_KEY）。先用 --agent=stub 跑通管道。");
  process.exit(2);
}

const records = [];
const results = [];

for (let gi = 0; gi < GAMES; gi += 1) {
  const seed = `eval-${gi}`;
  // 席位轮换：同一 seed 下每个被测席位都轮过一遍位置，消掉席位固有优劣
  const rot = gi % SEATS.length;
  const under = SEATS[(0 + rot) % SEATS.length];       // 本局由 agent 驾驶的席位
  let s = createGame(DATA, { seed, roster: ROSTER, geo: GEO }, P);
  let since = 0;
  const turns = [];

  while (!s.finished) {
    const orders = [];
    let mine = null;
    for (const f of Object.keys(s.factions)) {
      if (s.factions[f].eliminated || s.factions[f].retired) continue;
      if (f === under) {
        const o = observe(s, f, G, P, ROSTER, GEO, { nameOf, since });
        const cands = listActions(s, f, G, P, DEFAULT_RULES, ROSTER);
        const dec = stubDecide(s, f, cands, agentVariant);
        const a = admit(s, f, dec.picks, cands, G, ROSTER, DEFAULT_RULES);
        orders.push(...a.orders);
        mine = {
          turn: s.turn, seat: f, obsTokens: estTokens(JSON.stringify(o)),
          candidates: cands.length, picks: dec.picks.length,
          admitted: a.admitted.length, spent: a.spent, ap: s.factions[f].ap,
          illegalRate: a.illegalRate,
          dropped: a.dropped.map((d) => d.reason),
        };
      } else {
        const i = SEATS.indexOf(f);
        orders.push(...decide(s, f, G, i >= 0 ? BOT_PROFILES[(i + rot) % 4] : "balanced",
          undefined, ROSTER, P));
      }
    }
    if (mine) turns.push(mine);
    since = s.log.length;
    const r = resolve(s, orders, G, P, ROSTER, GEO);
    if (r.rejected.some((x) => x.reason.startsWith("令数不足"))) {
      console.error(`✗ 第 ${s.turn} 季 resolve 见到「令数不足」—— 准入层有 bug`);
      process.exit(1);
    }
    s = refreshAp(r.state, P);
  }

  const f = s.factions[under];
  results.push({
    game: gi, seed, seat: under, seatName: nameOf(under),
    grade: f.bestGrade, score: GRADE_SCORE[f.bestGrade],
    commanderies: Object.values(s.commanderies).filter((c) => c.owner === under).length,
    start: f.startCommanderies, eliminated: f.eliminated,
    illegalRate: turns.reduce((a, t) => a + t.illegalRate, 0) / Math.max(1, turns.length),
    obsPeak: Math.max(...turns.map((t) => t.obsTokens)),
    apUse: turns.reduce((a, t) => a + t.spent, 0) / Math.max(1, turns.reduce((a, t) => a + t.ap, 0)),
  });
  records.push(...turns.map((t) => ({ game: gi, seed, ...t })));
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
console.log(`对局方 ${AGENT}\u3000${GAMES} 局\u3000席位轮换 ${SEATS.length} 席\n`);
console.log("局".padStart(3), "席位".padEnd(10), "档".padStart(3), "分".padStart(4),
  "终郡".padStart(5), "非法率".padStart(7), "观测峰".padStart(7), "令数用率".padStart(9));
for (const r of results) {
  console.log(
    String(r.game).padStart(3), r.seatName.slice(0, 6).padEnd(10),
    r.grade.padStart(3), String(r.score).padStart(4),
    `${r.commanderies}/${r.start}`.padStart(5),
    `${(r.illegalRate * 100).toFixed(0)}%`.padStart(7),
    String(r.obsPeak).padStart(7),
    `${(r.apUse * 100).toFixed(0)}%`.padStart(9),
  );
}
console.log(`\n均分 ${avg(results.map((r) => r.score)).toFixed(1)}`
  + `\u3000非法率 ${(avg(results.map((r) => r.illegalRate)) * 100).toFixed(1)}%`
  + `\u3000观测峰值 ${Math.max(...results.map((r) => r.obsPeak))} tok`
  + `\u3000令数用率 ${(avg(results.map((r) => r.apUse)) * 100).toFixed(0)}%`);

if (OUT) {
  fs.writeFileSync(OUT, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\n→ ${OUT}\u3000${records.length} 条席·季记录`);
}
