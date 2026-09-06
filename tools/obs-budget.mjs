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
  troopTypes: read("troop-types.json"), resources: read("resources.json"),
};
const nameOf = (id) => read("scenario-194.json").factions.find((f) => f.id === id)?.name ?? id;

// 单位是**真实 token**（estTokens 已按三家 tokenizer 标定，取 Claude 系数）。
// 此前是 6000「估算单位」，而估算低估 1.59 倍——那道闸门真正卡的是约 9500 真 token。
// 这里换成同等严格的真实值，闸门的松紧不变，但数字终于表示它字面的意思
const LIMIT = Number(process.env.LIMIT ?? 10_000);
const SEATS = ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu"];
const PROFILES = ["turtle", "balanced", "aggressive", "opportunist"];

const digest = toRulesDigest(pack);
console.log(`规则摘要（系统提示词，一局只发一次）：${estTokens(digest)} tok\n`);

/**
 * 闸门必须按**最坏情形**测，否则它给出的余量是假的。
 *
 * 两处曾经系统性低报：
 *   一、只跑默认 16 季。而对局界面给了 104 季选项，观测里的 mine 段
 *       随疆域线性长（实测 95 tok/郡），长局的大势力才是真正的峰值。
 *       实测 104 季某 seed 下刘表从第 42 季起**连续 50 席·季超顶**。
 *   二、plan 按 null 计 2 tok。而跨季方略实跑中位 173 tok、最长 247，
 *       parse.ts 允许到 600 字。按满额算才是最坏情形。
 * 修之前闸门报「袁绍余量 +86 ✓」，真实是 −87 —— 差了一个符号，
 * 而所有「这个字段加不进来」的取舍都建立在那个数上
 */
// 默认跑 64 季——**四倍于评测口径**（一局 16 季），是刻意的压力测试：
// 长局养出的帝国比任何评测局都大，观测也最贵。
// 但硬闸门判的是评测口径：SEASONS=16 时必须全过，那才是真正要付的钱。
// 长局的超支是余量信息，不是回归——分开报，否则一个红叉会让人以为坏了
const SEASONS = Number(process.env.SEASONS ?? 64);
const EVAL_SEASONS = 16;
/** 按 parse.ts 允许的上限造一段方略，测最坏情形 */
const WORST_PLAN = "先".repeat(300);
let s = createGame(DATA, { seed: process.env.SEED ?? "budget-gate",
  roster: ROSTER, geo: GEO, seasons: SEASONS }, P);
const rows = [];
let since = 0;
while (!s.finished) {
  for (const seat of SEATS) {
    if (s.factions[seat].eliminated) continue;
    const o = observe(s, seat, G, P, ROSTER, GEO, { nameOf, since, plan: WORST_PLAN });
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
      // 军团条数单独盯着。observe 的 armies 段无上限无聚合，而**这个闸门只跑机器人**——
      // 机器人集结完就用掉、不囤，条数峰值只有个位数，于是闸门长期是假绿灯。
      // 模型会囤：实测一局末季袁绍 210 支，armies 段单独 10800 tok，整份观测约 24k，
      // 是闸门的 2.4 倍。闸门测不到的正是模型独有的行为，所以要显式盯条数
      armies: o.armies.length,
      // 超支时要知道钱花在哪一段——只报「峰值 10242」定位不到任何东西
      o,
      sec: Object.fromEntries(Object.entries(o)
        .map(([k, v]) => [k, estTokens(JSON.stringify(v))])),
      armyTok: estTokens(JSON.stringify(o.armies)),
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
const ARMY_CAP = 20;
const fat = rows.filter((r) => r.armies > ARMY_CAP);
console.log(`\n军团条数 峰值 ${Math.max(...rows.map((r) => r.armies))}`
  + `\u3000该段 tok 峰值 ${Math.max(...rows.map((r) => r.armyTok))}`
  + (fat.length ? `\u3000✗ ${fat.length} 席·季超过 ${ARMY_CAP} 条` : `\u3000✓ 均 ≤ ${ARMY_CAP} 条`));
const cands = rows.map((r) => r.cands);
{
  // 超支时要知道钱花在哪一段——只报「峰值 10242」定位不到任何东西
  const over = rows.filter((r) => r.total > LIMIT).sort((a, b) => b.total - a.total)[0];
  if (over) {
    console.log(`\n超支最多的一席·季：${over.seat} 第 ${over.turn} 季　${over.total} tok`);
    for (const [k, v] of Object.entries(over.sec).sort((a, b) => b[1] - a[1]).slice(0, 8))
      console.log(`    ${k.padEnd(14)} ${String(v).padStart(6)} tok`);
    const byType = {};
    for (const c of over.o.candidates) {
      const t = c.key.split(":")[0];
      byType[t] = (byType[t] ?? 0) + estTokens(JSON.stringify(c));
    }
    console.log("    候选按类：",
      Object.entries(byType).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`).join("　"));
    const worst = [...over.o.candidates]
      .sort((a, b) => estTokens(JSON.stringify(b)) - estTokens(JSON.stringify(a)))[0];
    console.log("    最贵的一条", estTokens(JSON.stringify(worst)), "tok：");
    console.log("      " + worst.label);
  }
}
console.log(`\n候选条目数 max/min = ${Math.max(...cands)}/${Math.min(...cands)}`
  + ` = ${(Math.max(...cands) / Math.max(1, Math.min(...cands))).toFixed(2)}`);
// 硬闸门只判**评测口径之内**的那一段：那才是真正要付的钱。
// 长局的超支单独报，它是余量信息——四倍于评测长度养出的帝国比任何评测局都大
const inEval = rows.filter((r) => r.turn <= EVAL_SEASONS);
const overEval = inEval.filter((r) => r.total > LIMIT);
console.log(over.length
  ? `✗ ${over.length}/${rows.length} 席·季超出 ${LIMIT} tok，最大 ${Math.max(...over.map((r) => r.total))}`
    + `（本次跑 ${SEASONS} 季）`
  : `✓ ${rows.length} 席·季全部 ≤ ${LIMIT} tok`);
if (SEASONS > EVAL_SEASONS) {
  console.log(overEval.length
    ? `✗ 评测口径（前 ${EVAL_SEASONS} 季）内也有 ${overEval.length}/${inEval.length} 席·季超出`
    : `✓ 评测口径（前 ${EVAL_SEASONS} 季）${inEval.length} 席·季全部 ≤ ${LIMIT} tok`
      + `　—— 上面那些超支只出现在长局的后段，不是评测要付的钱`);
}
process.exit(overEval.length || fat.length ? 1 : 0);
