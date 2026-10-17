// 回执消融的判读：模型被告知「上季哪条令被丢了、为什么」之后，下一季还犯不犯。
//
// 判据写在 docs/reports/dropback-2026-10-16/预登记.md，**先于数据**。
// 这个脚本只按那份判据算，不另挑口径——「换个算法就显著了」是这类实验最常见的
// 自欺，而本仓库 §39 已经吃过一次「先有结果再找对照」的亏。
//
// 用法：node tools/dropback-verdict.mjs <on.json> <off.json>
import { readFileSync } from "node:fs";

const [onPath, offPath] = process.argv.slice(2);
if (!onPath || !offPath) {
  console.error("用法：node tools/dropback-verdict.mjs <on.json> <off.json>");
  process.exit(2);
}

/**
 * 重复率 = Σ|D_n ∩ D_{n+1}| ÷ Σ|D_n|
 *
 * D_n 是第 n 季被准入层丢掉的令的「原因串」集合。分母是**有机会重犯的次数**，
 * 不是总季数——没被丢过令的季本来就没有「重不重犯」可言，算进分母会让
 * 两臂一起被稀释，而稀释的程度取决于各自丢了多少令，于是比较就不干净了。
 */
function repeatRate(run) {
  // 按 (局, 席位) 分轨，轨内按季排序。跨局不连
  const tracks = new Map();
  for (const r of run.records ?? []) {
    if (!r.dropped) continue;
    const k = `${r.game}|${r.seat}`;
    if (!tracks.has(k)) tracks.set(k, []);
    tracks.get(k).push(r);
  }
  let repeats = 0, chances = 0;
  const perTrack = [];
  for (const [k, rs] of tracks) {
    rs.sort((a, b) => a.turn - b.turn);
    let tr = 0, tc = 0;
    for (let i = 0; i + 1 < rs.length; i += 1) {
      const a = new Set(rs[i].dropped), b = new Set(rs[i + 1].dropped);
      if (!a.size) continue;
      tc += a.size;
      for (const x of a) if (b.has(x)) tr += 1;
    }
    repeats += tr; chances += tc;
    if (tc) perTrack.push({ k, rate: tr / tc, repeats: tr, chances: tc });
  }
  return { repeats, chances, rate: chances ? repeats / chances : 0, perTrack };
}

/** 仓库现成的 t 表口径（tools/verdict.mjs）。小样本不许用 1.96 */
const T95 = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 15: 2.131, 20: 2.086, 30: 2.042 };
const t95 = (df) => T95[df] ?? (df <= 0 ? 12.706 : 2.042);

const on = JSON.parse(readFileSync(onPath, "utf8"));
const off = JSON.parse(readFileSync(offPath, "utf8"));
const A = repeatRate(on), B = repeatRate(off);

console.log(`回执组  dropback=on　重复 ${A.repeats}/${A.chances} = ${(A.rate * 100).toFixed(1)}%`);
console.log(`对照组  dropback=off 重复 ${B.repeats}/${B.chances} = ${(B.rate * 100).toFixed(1)}%`);
console.log(`合计实扣 $${((on.spentUsd ?? 0) + (off.spentUsd ?? 0)).toFixed(4)}`
  + `　局数 ${on.played}/${off.played}`);

// 配对：同 (局, 席位) 的轨道两边都有才配得上
const bm = new Map(B.perTrack.map((x) => [x.k, x]));
const pairs = A.perTrack.filter((x) => bm.has(x.k)).map((x) => x.rate - bm.get(x.k).rate);
if (pairs.length < 2) {
  console.log(`\n配得上的轨道只有 ${pairs.length} 条，算不出区间。`);
  process.exit(0);
}
const mu = pairs.reduce((s, x) => s + x, 0) / pairs.length;
const sd = Math.sqrt(pairs.reduce((s, x) => s + (x - mu) ** 2, 0) / (pairs.length - 1));
const ci = t95(pairs.length - 1) * sd / Math.sqrt(pairs.length);

console.log(`\n配对差（on − off）在 ${pairs.length} 条轨道上：`
  + `${(mu * 100).toFixed(1)}pp ±${(ci * 100).toFixed(1)}pp`);

// 按预登记的三条判据判
if (mu < 0 && Math.abs(mu) > ci) {
  console.log("\n判据 1 成立：回执降低了重犯，且区间不盖零。");
  console.log("  → 「模型能被纠正」在这个口径上成立。README 的边界第一条可以改。");
} else if (mu < 0) {
  console.log("\n判据 2：方向对（回执更低），但区间盖过零。");
  console.log("  → 记成**测不出**，不是成立。README 那句「仍然没有定论」保持原样，");
  console.log("     并补上这次的 n 与区间。");
} else {
  console.log("\n判据 3：配对差为正或接近零——回执没有降低重犯。");
  console.log("  → 如实记负面结果，README 改成「测过，没测出来」。");
}
