import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { GRADE_SCORE } from "../lib/arena/scoring.ts";
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
  troopTypes: read("troop-types.json"),
  resources: read("resources.json"),
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
const SCORE = GRADE_SCORE;   // 唯一来源，不再另存副本

function play(seed, rot) {
  let s = createGame(DATA, { seed, roster: ROSTER, geo: GEO }, P);
  // **全部势力**都轮换画像，不只 SEATS 那六家。
  //
  // 此前非 SEATS 的一律 balanced，于是每局三十一家里只有六家进画像统计——
  // 五分之四的样本白扔。而「均衡流优于进攻流」这条断言的量化步长是
  // 100/(24×1.5)≈2.7 分，真实差距约 15 分，在 n=36 下时不时会翻车：
  // 实测同一份引擎，24 局报 0.0、48 局报 4.1、72 局报 11.2。
  // 改成全势力计分后，同样 24 局、同样耗时，均衡 92.2 对进攻 77.2，
  // 24 局与 48 局逐位相同 —— 样本从 36 涨到 186，信号才站得住。
  const ids = Object.keys(s.factions);
  const prof = (f) => PROFILES[(ids.indexOf(f) + rot) % 4];
  let flips = 0;
  while (!s.finished) {
    const orders = [];
    for (const f of Object.keys(s.factions)) {
      if (s.factions[f].eliminated || s.factions[f].retired) continue;
      // 传 GEO：不传的话候选上没有 gain，与 tools/selfplay.mjs 口径不一致
      orders.push(...decide(s, f, G, prof(f), undefined, ROSTER, P, GEO));
    }
    const r = resolve(s, orders, G, P, ROSTER, GEO);
    flips += r.state.log.slice(s.log.length).filter((e) => e.kind === "siege-win").length;
    s = refreshAp(r.state, P);
  }
  return { s, flips, prof };
}

// 24 局而非 8。8 局对着「出局率 < 50%」这个阈值没有统计功效：
// 曹操的真实出局率约 36%（100 局实测），而 n=8 时「≥4 局出局」的概率
// 接近三分之一——测试会毫无理由地红三分之一的时间。机器人一局约 0.3 秒，
// 24 局仍在秒级
const RUNS = Array.from({ length: 24 }, (_, i) => play(`reg-${i}`, i % 4));

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
  const n = RUNS.length, p = out / n;
  // 判据是「**真实**出局率 < 50%」——挡的是「一郡开局必死」，
  // 不是把某一次抽样钉在某个数上。曹操 194 年本就险些覆灭，四成合理，全灭才是失败。
  //
  // 判的是单侧 95% 下界而不是点估计。这不是把阈值放松，是按样本能支撑的强度来判：
  // n=24 对着 50% 直接比点估计，真实率 45% 时也有四成概率红——
  // 一个四成时间在撒谎的判据，很快就没人看了。同一条教训在评测层付过学费
  //（6 局样本对着 20 分的差距零分辨率，见 docs/EVAL.md）。
  // 现在这条能稳定抓住真实出局率 ≳70% 的坍塌，那正是「席位不可用」的量级
  const lower = p - 1.645 * Math.sqrt(p * (1 - p) / n);
  assert.ok(lower < 0.5,
    `曹操 ${out}/${n} 局出局（下界 ${(lower * 100).toFixed(0)}%），该席位不可用`);
});

// 四个画像之间的排序没有任何测试钉住过——而 bot 的评分逻辑改一次就可能
// 静默反转（曾有一次改动让 aggressive 均分从 158 掉到 92，六项测试全绿）。
// 这两条编码的是设计意图：既不该纯守成，也不该无脑猛攻。
test("画像排序：均衡流优于苟活流与进攻流", () => {
  const by = Object.fromEntries(PROFILES.map((p) => {
    const rows = RUNS.flatMap((r) => Object.keys(r.s.factions)
      .filter((seat) => r.prof(seat) === p)
      .map((seat) => SCORE[r.s.factions[seat].bestGrade]));
    return [p, rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0];
  }));
  assert.equal(by.turtle, 0, `苟活流均分 ${by.turtle}，应恒为 0 —— 存续本身不得分`);
  assert.ok(by.balanced > by.aggressive,
    `均衡流 ${by.balanced.toFixed(0)} 未优于进攻流 ${by.aggressive.toFixed(0)} —— 无脑猛攻不该更划算`);
  assert.ok(by.balanced > by.turtle * 1.3 + 20,
    `均衡流 ${by.balanced.toFixed(0)} 未显著优于苟活流 ${by.turtle.toFixed(0)}`);
});
