// 验第 28 条那条预测：新门槛下，档位分与州进度是否同向且都显著。
//
// 预测原文（docs/EVAL.md 第 28 条）：旧门槛下两把尺给出相反的判断——
// 模型对最强机器人在州进度上 +67/+61 显著，在档位分上 +21/+17 不显著。
// 若新门槛只是「让分数普遍变高」而没有让两把尺同向，那说明它们量的是
// 两种不同的能力，而不是同一件事的粗细两版。
//
// 用法：node --experimental-strip-types tools/verdict.mjs <基线.json> <对手.json ...>
import fs from "node:fs";
import { GRADE_SCORE, boardScore, contScore } from "../lib/arena/scoring.ts";

const [baseFile, ...rest] = process.argv.slice(2);
if (!baseFile || !rest.length) {
  console.error("用法：node --experimental-strip-types tools/verdict.mjs <基线.json> <对手.json ...>");
  process.exit(2);
}
const load = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const base = load(baseFile);
const key = (r) => `${r.seed}|${r.seat}`;

/** 配对差 + 95% 区间 + 平局数 */
function paired(rows, baseMap, metric) {
  const d = rows.filter((r) => baseMap.has(key(r))).map((r) => metric(r) - baseMap.get(key(r)));
  const n = d.length;
  const mu = d.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, n - 1));
  const ci = 1.96 * sd / Math.sqrt(n);
  return { n, mu, ci, sig: Math.abs(mu) > ci, ties: d.filter((x) => x === 0).length };
}

const METRICS = [
  ["档位分", (r) => GRADE_SCORE[r.grade]],
  ["榜分", boardScore],
  ["州进度", contScore],
];
const pad = (s, n) => String(s).padEnd(n - (String(s).match(/[一-鿿]/g)?.length ?? 0));

console.log(`\n基线：${base.model ?? base.agent}　${base.results.length} 局`);
console.log(`门槛：${JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"))
  .victory.filter((v) => ["yi", "jia", "chao"].includes(v.id))
  .map((v) => `${v.id} ${v.test}`).join("　")}\n`);
console.log(pad("对局方", 26) + METRICS.map(([m]) => pad(m, 22)).join(""));

const verdicts = [];
for (const f of rest) {
  const d = load(f);
  const baseMap = new Map(base.results.map((r) => [key(r), 0]));
  let line = pad(d.model ?? d.agent, 26);
  const dirs = [];
  for (const [, metric] of METRICS) {
    const bm = new Map(base.results.map((r) => [key(r), metric(r)]));
    const p = paired(d.results, bm, metric);
    dirs.push(p);
    line += pad(`${p.mu >= 0 ? "+" : ""}${p.mu.toFixed(1)} ±${p.ci.toFixed(1)}${p.sig ? " ✓" : " ·"}`, 22);
  }
  console.log(line);
  verdicts.push({ who: d.model ?? d.agent, dirs, isModel: d.agent === "model" });
  void baseMap;
}

// 判决：两把尺是否同向，且档位分那把是否也显著。
//
// **只判模型行。** 机器人之间两把尺本来就该分歧：两个机器人的疆域几乎一样，
// 差别全在「挑值钱的郡过线」——那正是档位在量、而连续量看不见的东西
//（docs/EVAL.md 第 26 条）。拿这条判机器人行，是把一个已知的、正确的
// 现象判成失败。第一版工具就是这么判的，当场给了个假的「预测不成立」
console.log("\n── 判决（只判模型行）──");
let allAgree = true;
for (const { who, dirs, isModel } of verdicts) {
  const [grade, , cont] = dirs;
  if (!isModel) {
    console.log(`  ${pad(who, 26)}（机器人对机器人，不入判据：两者疆域相同而档位不同，`
      + "两把尺分歧是应有的）");
    continue;
  }
  const sameSign = Math.sign(grade.mu) === Math.sign(cont.mu);
  const bothSig = grade.sig && cont.sig;
  if (!(sameSign && bothSig)) allAgree = false;
  console.log(`  ${pad(who, 26)}同向 ${sameSign ? "✓" : "✗"}　两把尺都显著 ${bothSig ? "✓" : "✗"}`
    + `　（档位分平局 ${grade.ties}/${grade.n}）`);
}
// 一个模型行都没有时不许报「成立」——空集上的全称命题恒真，
// 而那是最容易骗过自己的一种通过
const judged = verdicts.filter((v) => v.isModel).length;
console.log(!judged
  ? "\n· 没有模型行可判——这条预测说的是模型对机器人，只给机器人不构成检验。"
  : allAgree
  ? "\n✓ 预测成立：新门槛下两把尺同向且都显著——它们量的是同一件事的粗细两版。"
  : "\n✗ 预测不成立。这不是坏消息，是更要紧的发现：两把尺量的可能是两种不同的能力，"
    + "\n  在冻结规则之前必须先想清楚榜要按哪一把排。");
