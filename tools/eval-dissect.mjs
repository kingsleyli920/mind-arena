// 把一次评测跑的 JSON 拆开看：席位、动作构成、被丢的令。
//
// 这三刀是第一份 48 局排行榜上现挖出来的，当时是三段一次性脚本。做成工具，
// 是因为**榜本身只给一行均分，而结论全在这三刀里**：
//
//   按席位拆   → 「nano 的 11 次灭亡全部落在袁术与曹操，而在袁绍席上它反超机器人」
//                 均分那一列看不出这件事，它把强席与弱席混成了一个数
//   动作构成   → 「mini 每季集结 1.10 次却只出征 0.54 次」——攒兵不打，
//                 而机器人把免费的调任用满（3.4/季，模型只有 1.3）
//   被丢的令   → 「41 条里 26 条是同一件事：本季令数已满」
//
// 用法：
//   node tools/eval-dissect.mjs eval-out/board1/*.json
//   node tools/eval-dissect.mjs eval-out/weak-on.json eval-out/weak-off.json
//
// 纯读，不联网、不花钱。
import fs from "node:fs";

const files = process.argv.slice(2).filter((f) => f.endsWith(".json") && !f.endsWith("summary.json"));
if (!files.length) {
  console.error("用法：node tools/eval-dissect.mjs <eval-run 写出的 .json ...>");
  process.exit(2);
}

// 列头用中文。英文 key 排成一行谁都会看串——我就把「调任 3.31」读成了
// 「改阵 3.31」，还据此在文档里写下一句错的结论
/**
 * 动作分类**从内容包取**，不在这里手抄。
 *
 * 原先是写死的十二项，而引擎有十六种——relocate / passage / retire /
 * seize / transfer 五类从来没进过这张表。于是「每席·季的动作构成」里
 * 取据点与调兵是看不见的：实测两个模型分别做了 25 次与 13 次取据点，
 * 表上一个字都没有。合计那一列数的是全部 picks，列只数认得的那些，
 * 两者的差额要把列加起来才看得出来（实测 8.05 对 8.70）。
 *
 * 加一个动作而忘了加列，是不会报错的——所以干脆别留手抄的那份。
 */
const PACK = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
/**
 * 候选 key 的前缀**不等于** action.id。赴援的 key 是 `relief:…` 而它的
 * action.type 是 campaign——那是征伐的一种写法（打正在围城的敌军），
 * 包里不会有、也不该有一条叫 relief 的动作。
 * 所以分类取「包里的 ∪ 数据里真出现过的」：前者保证加了动作不会漏列，
 * 后者保证这种候选写法不会静默消失。两头都堵上，没有谁能悄悄不见。
 */
const PACK_TYPES = PACK.actions.map((a) => a.id);
const KEY_CN = { relief: "赴援" };   // 不是 action，是候选写法
const TYPE_CN = { ...Object.fromEntries(PACK.actions.map((a) => [a.id, a.name])), ...KEY_CN };
const pad = (s, n) => String(s).padEnd(n - (String(s).match(/[一-鿿（）]/g)?.length ?? 0));
const num = (v, n = 6, d = 2) => v.toFixed(d).padStart(n);

const runs = files.map((f) => {
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  return { tag: (d.agent === "model" ? d.model : `${d.agent}`) ?? f, d };
});

// 「没能作答」的季次必须剔出分母。
//
// 这一条是被自己骗过一次才加的：一份榜里 glm 有 141/754 季因提供方报错
// 一条令都没下，而按全部季平均出来的令数用率是 69.3%——我据此写了
// 「模型少下三成的令却拿到一样的分」，还说它推翻了第 17 条。**全错。**
// 剔掉空季之后是 85.3%，每季 9.55 条令，比机器人的 9.18 还多。
//
// 分母里混着没作答的季，任何按季平均的指标都是错的。
const answered = (d) => (d.records ?? []).filter((r) => !r.failure);
const skipped = (d) => (d.records ?? []).length - answered(d).length;

// ── 一、按席位 ──────────────────────────────────────────────────────
// 强席与弱席混在一个均分里，正是「模型是不是普遍地差」这个问题被答错的地方
console.log("\n══ 按席位：灭亡与郡数增量 ══");
const seats = [...new Set(runs.flatMap((r) => r.d.results.map((x) => x.seatName)))];
console.log(pad("席位", 14) + runs.map((r) => pad(r.tag, 26)).join(""));
for (const s of seats) {
  let line = pad(s, 14);
  for (const { d } of runs) {
    const rs = d.results.filter((x) => x.seatName === s);
    if (!rs.length) { line += pad("—", 26); continue; }
    const dead = rs.filter((x) => x.eliminated).length;
    const gain = rs.reduce((a, x) => a + x.commanderies - x.start, 0) / rs.length;
    line += pad(`灭 ${dead}/${rs.length}　增 ${gain >= 0 ? "+" : ""}${gain.toFixed(1)}`, 26);
  }
  console.log(line);
}

// ── 二、动作构成 ────────────────────────────────────────────────────
// 每席·季下了几条各类令。免费的（刺探、调任）也算进来——
// 机器人正是靠把免费的用满，把每季的令数拉到 9.2
console.log("\n══ 每席·季的动作构成（已剔除没能作答的季）══");
for (const { tag, d } of runs) {
  const n = skipped(d);
  if (n) console.log(`  ⚠ ${tag}：${n}/${(d.records ?? []).length} 季因提供方报错一条令都没下，`
    + "已剔出下面所有按季平均的分母");
}
const SEEN = new Set(runs.flatMap(({ d }) => (d.records ?? [])
  .flatMap((r) => (r.picks ?? []).map((k) => k.split(":")[0]))));
const TYPES = [...new Set([...PACK_TYPES, ...SEEN])];
const shown = TYPES.filter((t) => runs.some(({ d }) =>
  (d.records ?? []).some((r) => (r.picks ?? []).some((p) => p.startsWith(`${t}:`)))));
console.log(pad("对局方", 22) + "  合计" + shown.map((t) => pad(TYPE_CN[t] ?? t, 7).padStart(7)).join(""));
for (const { tag, d } of runs) {
  const recs = answered(d);
  if (!recs.length) { console.log(pad(tag, 22) + "  （无逐季记录）"); continue; }
  const n = recs.length;
  const c = Object.fromEntries(shown.map((t) => [t, 0]));
  let tot = 0;
  for (const r of recs) {
    for (const p of r.picks ?? []) {
      const k = p.split(":")[0];
      if (k in c) c[k] += 1;
      tot += 1;
    }
  }
  console.log(pad(tag, 22) + num(tot / n) + shown.map((t) => num(c[t] / n, 7)).join(""));
}

// ── 三、被丢的令 ────────────────────────────────────────────────────
// 「单看每条都合法、合起来不合法」那一类。数字里的具体值抹掉便于归类
console.log("\n══ 被丢的令（按原因）══");
for (const { tag, d } of runs) {
  const recs = d.records ?? [];
  const picks = recs.reduce((a, r) => a + (r.pickCount ?? 0), 0);
  const by = new Map();
  for (const r of recs) {
    for (const x of r.dropped ?? []) {
      const k = String(x).replace(/\d+/g, "N");
      by.set(k, (by.get(k) ?? 0) + 1);
    }
  }
  const drops = [...by.values()].reduce((a, b) => a + b, 0);
  if (!picks) { console.log(`${pad(tag, 22)}（无逐季记录）`); continue; }
  console.log(`${pad(tag, 22)}下令 ${picks}　被丢 ${drops}（${(drops / picks * 100).toFixed(1)}%）`);
  for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
  // 只存了 reason 而没存 detail 的旧记录，在这里会看不出「rejected」的具体规则。
  // eval-run 从 2026-09-07 起连 detail 一起存——旧记录与新记录不能比这一维
}

// ── 四、令数用率 ────────────────────────────────────────────────────
console.log("\n══ 令数用率（spent / ap，按席·季）══");
for (const { tag, d } of runs) {
  const recs = answered(d);
  if (!recs.length) { console.log(`${pad(tag, 22)}（无逐季记录）`); continue; }
  const ap = recs.map((r) => r.spent / Math.max(1, r.ap)).sort((a, b) => a - b);
  const q = (p) => ap[Math.floor((ap.length - 1) * p)];
  const mean = ap.reduce((a, b) => a + b, 0) / ap.length;
  console.log(`${pad(tag, 22)}均 ${(mean * 100).toFixed(1)}%　`
    + `四分位 ${(q(0.25) * 100).toFixed(0)}/${(q(0.5) * 100).toFixed(0)}/${(q(0.75) * 100).toFixed(0)}%`);
}
console.log();
