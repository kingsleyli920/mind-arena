// 自对局验证：规则 AI 自己打 N 局，检验玩法是否健康。
//
// 这是接模型之前的关键闸门。对抗审查曾用真实数据算出首版方案会
// 「六家谁都攻不下谁的城」——这类病必须在这里暴露，
// 不能等花钱调模型时才发现。
//
// 四条验收（全部不通过就不该往下走）：
//   A 不地图冻结：每局郡国易主次数够多
//   B 苟活不是最优：turtle 画像的成绩显著低于进攻画像
//   C 局长稳定
//   D 胜负分布不等于开局国力排序
import fs from "node:fs";
import { GRADE_SCORE } from "../lib/arena/scoring.ts";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { buildGraph } from "../lib/game/engine/actions.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { buildGeography } from "../lib/game/engine/victory.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { decide, PROFILES } from "../lib/game/engine/bot.ts";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const DATA = {
  commanderyState: read("commandery-state.json"),
  scenario: read("scenario-194.json"),
  commanderies: read("commanderies.json"),
  troopTypes: read("troop-types.json"), resources: read("resources.json"),
};
const G = buildGraph(read("adjacency.json"));
const P = loadParams(JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8")));
const ROSTER = buildRoster(
  read("officers.json"),
  read("officer-availability-194.json"),
  new Map(read("commanderies.json").map((c) => [c.name, c.id])),
);
const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
const NAME = Object.fromEntries(DATA.scenario.factions.map((f) => [f.id, f.name]));

const GAMES = Number(process.env.GAMES ?? 100);
/** 席位轮换：每局给六大势力换一遍画像，避免"画像与开局绑定"混淆结论 */
const SEATS = ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu"];
// 默认四画像，与历次验收同口径。PROFILES=5 时把目的流一并放进轮换，
// 用来看「看不看目的」这一条本身值多少分——均衡流与目的流权重表同底，
// 差别只在读不读 gain，所以两者同场的分差可直接归因
const PROFILE_LIST = process.env.PROFILES === "5"
  ? ["turtle", "balanced", "aggressive", "opportunist", "purpose"]
  : ["turtle", "balanced", "aggressive", "opportunist"];

// 计分表唯一来源在 lib/arena/scoring.ts。此处曾各存一份副本，迟早分家

function playOne(seed, rotation) {
  let s = createGame(DATA, { seed, roster: ROSTER, geo: GEO, graph: G }, P);
  // 非六大席位的其余势力一律 balanced
  const profileOf = (f) => {
    const i = SEATS.indexOf(f);
    return i >= 0 ? PROFILE_LIST[(i + rotation) % PROFILE_LIST.length] : "balanced";
  };
  const flips = [];
  while (!s.finished) {
    const orders = [];
    for (const f of Object.keys(s.factions)) {
      if (s.factions[f].eliminated || s.factions[f].retired) continue;
      orders.push(...decide(s, f, G, profileOf(f), undefined, ROSTER, P, GEO));
    }
    const r = resolve(s, orders, G, P, ROSTER, GEO);
    for (const e of r.state.log.slice(s.log.length)) {
      if (e.kind === "siege-win") flips.push({ turn: e.turn, faction: e.faction });
    }
    s = refreshAp(r.state, P);
  }
  const own = {};
  for (const c of Object.values(s.commanderies)) if (c.owner) own[c.owner] = (own[c.owner] ?? 0) + 1;
  return {
    seed, turns: s.turn, flips,
    factions: Object.fromEntries(Object.entries(s.factions).map(([id, f]) => [id, {
      profile: profileOf(id), start: f.startCommanderies, end: own[id] ?? 0,
      grade: f.bestGrade, score: GRADE_SCORE[f.bestGrade],
      eliminated: f.eliminated, retired: f.retired,
    }])),
  };
}

console.log(`自对局 ${GAMES} 局（席位轮换 ${PROFILE_LIST.length} 种画像）\n`);
for (const [k, v] of Object.entries(PROFILES)) console.log(`  ${k.padEnd(12)} ${v}`);
console.log();

const results = [];
for (let i = 0; i < GAMES; i += 1) {
  results.push(playOne(`sp-${i}`, i % PROFILE_LIST.length));
}

// ── A 地图冻结 ──────────────────────────────────────────────────────
const flipCounts = results.map((r) => r.flips.length).sort((a, b) => a - b);
const median = flipCounts[flipCounts.length >> 1];
const zeroFlip = flipCounts.filter((n) => n === 0).length;
console.log("【A 地图冻结】每局郡国易主次数");
console.log(`  中位 ${median}  最少 ${flipCounts[0]}  最多 ${flipCounts.at(-1)}  零易主局数 ${zeroFlip}`);
const passA = median >= 8 && zeroFlip === 0;
console.log(`  ${passA ? "✓" : "✗"} 判据：中位 ≥8 且无零易主局\n`);

// ── B 苟活是否最优 ──────────────────────────────────────────────────
const byProfile = {};
for (const r of results) {
  for (const f of Object.values(r.factions)) {
    if (!SEATS.includes(Object.keys(r.factions).find((k) => r.factions[k] === f))) continue;
    (byProfile[f.profile] ??= []).push(f);
  }
}
// 上面的 find 在对象里做引用比较不可靠，改为直接遍历席位
const stats = {};
for (const r of results) {
  for (const seat of SEATS) {
    const f = r.factions[seat];
    if (!f) continue;
    (stats[f.profile] ??= []).push({ ...f, seat, growth: f.start ? f.end / f.start : 0 });
  }
}
console.log("【B 苟活是否最优】各画像成绩（仅六大席位，已轮换）");
const avg = (a, k) => a.reduce((x, y) => x + y[k], 0) / a.length;
const rows = Object.entries(stats).map(([p, a]) => ({
  p, n: a.length, score: avg(a, "score"), growth: avg(a, "growth"),
  elim: a.filter((x) => x.eliminated).length / a.length,
})).sort((x, y) => y.score - x.score);
for (const r of rows) {
  console.log(`  ${r.p.padEnd(12)} 均分 ${r.score.toFixed(1).padStart(6)}  ` +
    `疆域倍数 ${r.growth.toFixed(2)}  出局率 ${(r.elim * 100).toFixed(0)}%  样本 ${r.n}`);
}
const turtle = rows.find((r) => r.p === "turtle");
const best = rows[0];
const passB = turtle && best.p !== "turtle" && best.score > turtle.score * 1.3;
console.log(`  ${passB ? "✓" : "✗"} 判据：苟活流不是最高分，且最高分 > 苟活流 ×1.3`);
// 这条判据本身是退化的：苟活流恒为 0 分（存续不得分是设计），于是
// 「最高分 − 最低分」永远等于最高分本身，任何裁剪型改动结构上只能把它压低。
// 并列打印「非苟活极差」——那才是「会玩与不会玩差多少」的可用刻度，
// 它有余量、也刷不高：把所有画像都调强会同时抬高两端
const nonTurtle = rows.filter((r) => r.p !== "turtle");
if (nonTurtle.length >= 2) {
  const gap = nonTurtle[0].score - nonTurtle[nonTurtle.length - 1].score;
  console.log(`  · 非苟活极差 ${gap.toFixed(1)}（${nonTurtle[0].p} − ${nonTurtle[nonTurtle.length - 1].p}）`);
}
console.log("");

// ── C 局长 ──────────────────────────────────────────────────────────
const turns = new Set(results.map((r) => r.turns));
console.log(`【C 局长】${[...turns].join(" ")} 季`);
const passC = turns.size === 1 && turns.has(16);
console.log(`  ${passC ? "✓" : "✗"} 判据：恒为 16 季\n`);

// ── D 胜负是否等于开局国力 ──────────────────────────────────────────
console.log("【D 胜负分布】六大席位的结局");
for (const seat of SEATS) {
  const a = results.map((r) => r.factions[seat]).filter(Boolean);
  const g = {};
  for (const f of a) g[f.grade] = (g[f.grade] ?? 0) + 1;
  const elim = a.filter((f) => f.eliminated).length;
  console.log(`  ${(NAME[seat] ?? seat).padEnd(14)} 开局 ${String(a[0].start).padStart(2)} 郡  ` +
    `均终 ${avg(a, "end").toFixed(1).padStart(5)} 郡  出局 ${String(elim).padStart(3)}/${a.length}  ` +
    `档位 ${Object.entries(g).sort().map(([k, v]) => `${k}${v}`).join(" ")}`);
}
// 用「开局郡数」与「实际得分」求 Spearman。
// 注意不能用终局郡数——评分是相对开局的增量，十三郡涨到二十七郡只有 2.1 倍，
// 七郡涨到二十四郡是 3.4 倍，后者得分更高。拿绝对郡数比会得出相反结论。
const spearman = (rankA, rankB) => {
  let d2 = 0;
  for (const s of SEATS) d2 += (rankA.indexOf(s) - rankB.indexOf(s)) ** 2;
  return 1 - (6 * d2) / (SEATS.length * (SEATS.length ** 2 - 1));
};
const startRank = [...SEATS].sort((a, b) =>
  results[0].factions[b].start - results[0].factions[a].start);
const scoreAvg = Object.fromEntries(SEATS.map((s) =>
  [s, avg(results.map((r) => r.factions[s]), "score")]));
const endAvg = Object.fromEntries(SEATS.map((s) =>
  [s, avg(results.map((r) => r.factions[s]), "end")]));
const rhoSize = spearman(startRank, [...SEATS].sort((a, b) => endAvg[b] - endAvg[a]));
const rhoScore = spearman(startRank, [...SEATS].sort((a, b) => scoreAvg[b] - scoreAvg[a]));
console.log(`  开局郡数 ↔ 终局郡数   ρ = ${rhoSize.toFixed(2)}（滚雪球程度，仅供参考）`);
console.log(`  开局郡数 ↔ 实际得分   ρ = ${rhoScore.toFixed(2)}  ← 这才是评测的区分度`);
console.log(`  各席位均分：${SEATS.map((s) => `${(NAME[s] ?? s).slice(0, 3)}${scoreAvg[s].toFixed(0)}`).join("  ")}`);
const passD = rhoScore < 0.9;
console.log(`  ${passD ? "✓" : "✗"} 判据：得分 ρ < 0.9（得分完全由开局决定则测不出模型强弱）\n`);

// ── 曹操专项：1 郡开局是否必然出局 ──────────────────────────────────
const cc = results.map((r) => r.factions.caocao);
console.log(`【曹操专项】1 郡 6576 兵开局`);
console.log(`  出局 ${cc.filter((f) => f.eliminated).length}/${cc.length}   ` +
  `均终 ${avg(cc, "end").toFixed(2)} 郡   最好 ${Math.max(...cc.map((f) => f.end))} 郡`);

const pass = [passA, passB, passC, passD].filter(Boolean).length;
console.log(`\n═══ ${pass}/4 项验收通过 ═══`);
process.exit(pass === 4 ? 0 : 1);
