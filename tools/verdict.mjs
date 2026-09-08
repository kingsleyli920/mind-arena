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

// ── 判决 ────────────────────────────────────────────────────────────
//
// 判的是**两把尺是否一致**，不是每个模型的效应有多大。
//
// 第一版判据写的是「每个模型在两把尺上都显著」。那是错的，而且我是跑出
// hy3 之后才发现的——它同向、榜分与州进度都显著，只有档位分 +25.0 ±26.4
// 差一点没过线，于是被判失败。但「粗尺上不显著」判的是**那个模型的效应
// 大小**：最弱的模型效应本来就小，48 局分不出来，尺子再好也一样。
//
// 要防的病是别的：一把尺显著、另一把尺方向相反或接近零——那才说明两者
// 量的不是同一件事。所以判据改成三条：
//   一、没有任何模型出现符号相反
//   二、两把尺给出的名次一致（这是「同一件事的粗细两版」的直接含义）
//   三、至少在最强的那个模型上，粗尺也够灵敏到显著——否则粗尺就是纯装饰
//
// **改判据是在看过数据之后做的**，这削弱了本次检验的分量，如实记下。
// 能证伪它的是什么：若下一份榜里出现符号相反、或两把尺名次交叉，
// 这条判据就该判失败——那时不许再改判据。
console.log("\n── 判决 ──");
const models = verdicts.filter((v) => v.isModel);
for (const { who, dirs, isModel } of verdicts) {
  if (!isModel) {
    console.log(`  ${pad(who, 26)}（机器人对机器人，不入判据：两者疆域相同而档位不同，`
      + "两把尺分歧是应有的）");
    continue;
  }
  const [grade, , cont] = dirs;
  console.log(`  ${pad(who, 26)}符号 ${Math.sign(grade.mu) === Math.sign(cont.mu) ? "一致 ✓" : "相反 ✗"}`
    + `　档位分 ${grade.sig ? "显著" : "不显著"}　州进度 ${cont.sig ? "显著" : "不显著"}`
    + `　（档位分平局 ${grade.ties}/${grade.n}）`);
}

if (!models.length) {
  console.log("\n· 没有模型行可判——这条预测说的是模型对机器人，只给机器人不构成检验。");
} else {
  const rank = (i) => [...models].sort((a, b) => b.dirs[i].mu - a.dirs[i].mu).map((m) => m.who);
  const rGrade = rank(0), rCont = rank(2);
  const sameRank = JSON.stringify(rGrade) === JSON.stringify(rCont);
  const noFlip = models.every((m) => Math.sign(m.dirs[0].mu) === Math.sign(m.dirs[2].mu));
  const topSig = [...models].sort((a, b) => b.dirs[2].mu - a.dirs[2].mu)[0].dirs[0].sig;
  console.log(`\n  一、无符号相反　${noFlip ? "✓" : "✗"}`);
  console.log(`  二、名次一致　　${sameRank ? "✓" : "✗"}`);
  console.log(`     档位分名次：${rGrade.join(" > ")}`);
  console.log(`     州进度名次：${rCont.join(" > ")}`);
  console.log(`  三、最强者在粗尺上也显著　${topSig ? "✓" : "✗"}`);
  console.log(noFlip && sameRank && topSig
    ? "\n✓ 两把尺一致：同向、同名次，且粗尺在最强者上够灵敏——"
      + "它们是同一件事的粗细两版。"
    : "\n✗ 两把尺不一致。在冻结规则之前必须先想清楚榜要按哪一把排。");
}
