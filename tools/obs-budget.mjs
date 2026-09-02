// 观测的 token 预算实测。
//
// 不是估算：真跑一局，逐季逐席位量观测的大小。
// 预算超了要么砍报告与记忆，**不砍候选**——砍候选等于用观测预算去交换
// 动作空间，那得是显式决策而不是顺手压缩。
import fs from "node:fs";
import { buildGraph } from "../lib/game/engine/actions.ts";
import { decide } from "../lib/game/engine/bot.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { buildGeography } from "../lib/game/engine/victory.ts";
import { observe, estTokens } from "../lib/game/engine/observe.ts";
import { toRulesDigest } from "../lib/game/content/schema.ts";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const P = loadParams(pack);
const ROSTER = buildRoster(read("officers.json"), read("officer-availability-194.json"),
  new Map(read("commanderies.json").map((c) => [c.name, c.id])));
const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
const G = buildGraph(read("adjacency.json"));
const DATA = {
  commanderyState: read("commandery-state.json"),
  scenario: read("scenario-194.json"),
  commanderies: read("commanderies.json"),
  troopTypes: read("troop-types.json"),
};
const nameOf = (id) => read("scenario-194.json").factions.find((f) => f.id === id)?.name ?? id;

const LIMIT = Number(process.env.LIMIT ?? 6000);
const SEATS = ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu"];
const PROFILES = ["turtle", "balanced", "aggressive", "opportunist"];

const digest = toRulesDigest(pack);
console.log(`规则摘要（系统提示词，一局只发一次）：${estTokens(digest)} tok\n`);

let s = createGame(DATA, { seed: process.env.SEED ?? "budget-gate", roster: ROSTER, geo: GEO }, P);
const rows = [];
let since = 0;
while (!s.finished) {
  for (const seat of SEATS) {
    if (s.factions[seat].eliminated) continue;
    const o = observe(s, seat, G, P, ROSTER, GEO, { nameOf, since });
    const json = JSON.stringify(o);
    if (json.includes(`"${s.seed}"`) || /"seed"/.test(json)) {
      console.error(`✗ 第 ${s.turn} 季 ${seat} 的观测里出现了 seed —— 迷雾作废`);
      process.exit(1);
    }
    rows.push({
      turn: s.turn, seat,
      total: estTokens(json),
      cands: o.candidates.length,
      candTok: estTokens(JSON.stringify(o.candidates)),
      reportTok: estTokens(JSON.stringify(o.report)),
    });
  }
  since = s.log.length;
  const orders = [];
  for (const f of Object.keys(s.factions)) {
    if (s.factions[f].eliminated || s.factions[f].retired) continue;
    const i = SEATS.indexOf(f);
    orders.push(...decide(s, f, G, i >= 0 ? PROFILES[i % 4] : "balanced", undefined, ROSTER, P));
  }
  s = refreshAp(resolve(s, orders, G, P, ROSTER, GEO).state, P);
}

const bySeat = {};
for (const r of rows) (bySeat[r.seat] ??= []).push(r);
console.log("席位".padEnd(10), "峰值".padStart(7), "均值".padStart(7),
  "候选峰".padStart(7), "候选 tok".padStart(9), "战报 tok".padStart(9));
for (const [seat, rs] of Object.entries(bySeat)) {
  const max = Math.max(...rs.map((r) => r.total));
  const avg = Math.round(rs.reduce((a, r) => a + r.total, 0) / rs.length);
  console.log(
    nameOf(seat).slice(0, 6).padEnd(10),
    String(max).padStart(7), String(avg).padStart(7),
    String(Math.max(...rs.map((r) => r.cands))).padStart(7),
    String(Math.max(...rs.map((r) => r.candTok))).padStart(9),
    String(Math.max(...rs.map((r) => r.reportTok))).padStart(9),
  );
}
const over = rows.filter((r) => r.total > LIMIT);
const cands = rows.map((r) => r.cands);
console.log(`\n候选条目数 max/min = ${Math.max(...cands)}/${Math.min(...cands)}`
  + ` = ${(Math.max(...cands) / Math.max(1, Math.min(...cands))).toFixed(2)}`);
console.log(over.length
  ? `✗ ${over.length}/${rows.length} 席·季超出 ${LIMIT} tok，最大 ${Math.max(...over.map((r) => r.total))}`
  : `✓ ${rows.length} 席·季全部 ≤ ${LIMIT} tok`);
process.exit(over.length ? 1 : 0);
