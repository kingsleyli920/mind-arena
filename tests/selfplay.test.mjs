import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { buildGraph } from "../lib/game/engine/actions.ts";
import { buildGeography } from "../lib/game/engine/victory.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { decide } from "../lib/game/engine/bot.ts";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const DATA = {
  commanderyState: read("commandery-state.json"),
  scenario: read("scenario-194.json"),
  commanderies: read("commanderies.json"),
};
const G = buildGraph(read("adjacency.json"));
// 引擎参数唯一来源是内容包，测试也走同一条路径
const P = loadParams(JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8")));
const ROSTER = buildRoster(
  read("officers.json"),
  read("officer-availability-194.json"),
  new Map(read("commanderies.json").map((c) => [c.name, c.id])),
);
const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
const SEATS = ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu"];
const PROFILES = ["turtle", "balanced", "aggressive", "opportunist"];
const SCORE = { jia: 300, yi: 200, bing: 100, ding: 0 };

function play(seed, rot) {
  let s = createGame(DATA, { seed, roster: ROSTER, geo: GEO }, P);
  const prof = (f) => { const i = SEATS.indexOf(f); return i >= 0 ? PROFILES[(i + rot) % 4] : "balanced"; };
  let flips = 0;
  while (!s.finished) {
    const orders = [];
    for (const f of Object.keys(s.factions)) {
      if (s.factions[f].eliminated || s.factions[f].retired) continue;
      orders.push(...decide(s, f, G, prof(f)));
    }
    const r = resolve(s, orders, G, P, ROSTER, GEO);
    flips += r.state.log.slice(s.log.length).filter((e) => e.kind === "siege-win").length;
    s = refreshAp(r.state, P);
  }
  return { s, flips, prof };
}

const RUNS = Array.from({ length: 8 }, (_, i) => play(`reg-${i}`, i % 4));

test("自对局可复现", () => {
  assert.deepEqual(play("reg-0", 0).s, RUNS[0].s);
});

test("A 不地图冻结：每局都有郡国易主", () => {
  for (const [i, r] of RUNS.entries()) assert.ok(r.flips >= 8, `第 ${i} 局仅 ${r.flips} 次易主`);
});

test("B 苟活不是最优：turtle 均分显著低于最优画像", () => {
  const byProf = {};
  for (const r of RUNS) {
    for (const seat of SEATS) {
      const f = r.s.factions[seat];
      (byProf[r.prof(seat)] ??= []).push(SCORE[f.bestGrade]);
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rows = Object.entries(byProf).map(([p, a]) => ({ p, m: avg(a) })).sort((a, b) => b.m - a.m);
  assert.notEqual(rows[0].p, "turtle", "苟活流成了最高分");
  const t = rows.find((r) => r.p === "turtle");
  assert.ok(rows[0].m > t.m * 1.3, `最优 ${rows[0].m.toFixed(0)} 未显著高于苟活 ${t.m.toFixed(0)}`);
});

test("C 局长恒为 16 季", () => {
  for (const r of RUNS) assert.equal(r.s.turn, P.seasonsPerGame);
});

test("D 得分不由开局国力决定", () => {
  const start = Object.fromEntries(SEATS.map((s) => [s, RUNS[0].s.factions[s].startCommanderies]));
  const score = Object.fromEntries(SEATS.map((s) =>
    [s, RUNS.reduce((a, r) => a + SCORE[r.s.factions[s].bestGrade], 0) / RUNS.length]));
  const ra = [...SEATS].sort((a, b) => start[b] - start[a]);
  const rb = [...SEATS].sort((a, b) => score[b] - score[a]);
  let d2 = 0;
  for (const s of SEATS) d2 += (ra.indexOf(s) - rb.indexOf(s)) ** 2;
  const rho = 1 - (6 * d2) / (SEATS.length * (SEATS.length ** 2 - 1));
  assert.ok(rho < 0.9, `Spearman ρ = ${rho.toFixed(2)}，得分几乎完全由开局决定`);
});

test("曹操一郡开局不必然出局", () => {
  const out = RUNS.filter((r) => r.s.factions.caocao.eliminated).length;
  assert.ok(out < RUNS.length * 0.5, `曹操 ${out}/${RUNS.length} 局出局，该席位不可用`);
});
