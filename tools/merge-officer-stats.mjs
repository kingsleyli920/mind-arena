// 合并武将数据：史实字段 + 九批五维数值 + 补录人员 + 知名度重分级。
//
// 分批推导是为了并行，但并行最大的风险是**跨批不可比**——各批内部自洽，
// 合起来梯队就糊了。所以本脚本除合并外，还做三项体检：
//   1. 锚点断言：calibrationSet 里的人在各批中是否与锚点表完全一致
//   2. 分布形状：五维是否呈长尾，有无"全能超人"
//   3. 跨批分布：描述性输出，构成会混淆均值，标尺以锚点断言为准
import fs from "node:fs";
import { cmp } from "../lib/game/engine/cmp.ts";

const D = "lib/game/data";
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const exists = (f) => fs.existsSync(f);
const arr = (o) => (Array.isArray(o) ? o : (o.officers ?? o.renown ?? []));
const DIMS = ["leadership", "might", "intellect", "politics", "charisma"];

// ── 1. 史实底表 ─────────────────────────────────────────────────────
const base = arr(read(`${D}/officers.json`));
const byId = new Map(base.map((o) => [o.id, { ...o }]));
console.log(`史实底表 ${base.length} 人`);

// ── 2. 补录人员 ─────────────────────────────────────────────────────
let added = 0, idConflict = [];
if (exists(`${D}/officers-supplement.json`)) {
  for (const o of arr(read(`${D}/officers-supplement.json`))) {
    if (byId.has(o.id)) { idConflict.push(o.id); continue; }
    byId.set(o.id, { ...o }); added += 1;
  }
  console.log(`补录 ${added} 人${idConflict.length ? `（id 冲突 ${idConflict.length} 个已跳过：${idConflict.slice(0, 5).join(" ")}）` : ""}`);
}

// ── 3. 九批五维 ─────────────────────────────────────────────────────
const partition = read(`${D}/stats/_partition.json`).batches;
const batchOf = new Map();                      // id → 批次，用于跨批体检
let statted = 0, orphan = [], dupAssign = [];
for (const bid of Object.keys(partition)) {
  const f = `${D}/stats/${bid}.json`;
  if (!exists(f)) { console.warn(`⚠ 缺批次 ${bid}`); continue; }
  for (const s of arr(read(f))) {
    const t = byId.get(s.id);
    if (!t) { orphan.push(`${bid}/${s.id}`); continue; }
    if (batchOf.has(s.id)) { dupAssign.push(s.id); continue; }
    batchOf.set(s.id, bid);
    for (const d of DIMS) if (typeof s[d] === "number") t[d] = s[d];
    if (s.aptitudes) t.aptitudes = s.aptitudes;
    if (s.loyalty) t.loyalty = s.loyalty;
    if (s.loyaltyBasis) t.loyaltyBasis = s.loyaltyBasis;
    if (s.statBasis) t.statBasis = s.statBasis;
    statted += 1;
  }
}
console.log(`五维赋值 ${statted} 人${orphan.length ? `，孤儿 ${orphan.length}` : ""}${dupAssign.length ? `，重复赋值 ${dupAssign.length}` : ""}`);
if (orphan.length) console.log(`  孤儿（stats 里有但底表没有）：${orphan.slice(0, 8).join(" ")}`);
if (dupAssign.length) console.log(`  重复：${dupAssign.slice(0, 8).join(" ")}`);

// ── 4. 知名度重分级 ─────────────────────────────────────────────────
let regraded = 0;
if (exists(`${D}/officer-renown.json`)) {
  for (const r of arr(read(`${D}/officer-renown.json`))) {
    const t = byId.get(r.id);
    if (!t) continue;
    if (r.renown != null) t.renown = r.renown;
    if (r.historicalWeight != null) t.historicalWeight = r.historicalWeight;
    if (r.group) t.group = r.group;
    regraded += 1;
  }
  console.log(`重分级 ${regraded} 人`);
}

const all = [...byId.values()];
const withStats = all.filter((o) => DIMS.every((d) => typeof o[d] === "number"));
console.log(`\n合计 ${all.length} 人，其中 ${withStats.length} 人有完整五维`);
const noStats = all.filter((o) => !DIMS.every((d) => typeof o[d] === "number"));
if (noStats.length) {
  console.log(`缺数值 ${noStats.length} 人（多为补录人员，待后续按锚点法补）：`);
  console.log(`  ${noStats.slice(0, 12).map((o) => o.name).join(" ")}${noStats.length > 12 ? " …" : ""}`);
}

// ── 体检一：锚点断言 ────────────────────────────────────────────────
if (exists(`${D}/officer-anchors.json`)) {
  const anchors = read(`${D}/officer-anchors.json`);
  const cal = anchors.calibrationSet ?? [];
  let ok = 0; const bad = [];
  for (const c of cal) {
    const t = byId.get(c.id);
    if (!t) continue;
    const diff = DIMS.filter((d) => c[d] != null && t[d] !== c[d]);
    if (diff.length) bad.push(`${t.name}(${diff.map((d) => `${d} ${t[d]}≠${c[d]}`).join(",")})`);
    else ok += 1;
  }
  console.log(`\n【锚点断言】${ok}/${cal.length} 一致${bad.length ? `，偏离 ${bad.length}：` : " ✓"}`);
  if (bad.length) bad.slice(0, 10).forEach((b) => console.log(`  ${b}`));
}

// ── 体检二：分布形状 ────────────────────────────────────────────────
console.log("\n【分布】");
for (const d of DIMS) {
  const v = withStats.map((o) => o[d]).sort((a, b) => a - b);
  const q = (p) => v[Math.floor(v.length * p)];
  const ge = (n) => v.filter((x) => x >= n).length;
  console.log(`  ${d.padEnd(11)} 中位 ${q(0.5)}  90%位 ${q(0.9)}  最高 ${v.at(-1)}  |  ≥90: ${ge(90)}  ≥80: ${ge(80)}  ≥70: ${ge(70)}`);
}
const sums = withStats.map((o) => ({ n: o.name, s: DIMS.reduce((a, d) => a + o[d], 0) })).sort((a, b) => b.s - a.s);
console.log(`  五维之和 中位 ${sums[Math.floor(sums.length / 2)].s}，最高 10 人：`);
console.log(`    ${sums.slice(0, 10).map((x) => `${x.n}(${x.s})`).join("  ")}`);

// ── 体检三：跨批分布（描述性，不作判据）────────────────────────────
// 两个坑，都实测踩过：
//   1. 按 renown 分档比五维之和是错的。renown 衡量名气不是能力——潘凤出名
//      是因为「上将潘凤可斩华雄」这个笑话，大桥小桥是后妃全无军政职能，
//      他们与皇甫嵩同属 renown 2，五维之和差 200 分完全正确。
//   2. 即使按职能分层，组均值仍被**人员构成**主导而非标尺。实测 free2-a 与
//      free2-c 同为「在野·武·renown 3」却差 126 分——因为前者是傅燮、牵招、
//      王昶、全琮这类后来位至公卿都督的人，后者是伍孚、王匡、王植这类
//      短命偏将与虚构人物。这个差是对的。
// 结论：**跨批标尺是否一致，只能靠锚点断言（体检一）判定**，那是同一个人
// 在不同批次里的值，无构成混淆。本节仅作描述性输出，供人工翻看，不发警报。
const roleClass = (o) => {
  const r = (o.roles ?? []).join("");
  if (/后妃|宗室女|女/.test(r) || /夫人|皇后|太后|妃$/.test(o.name)) return "后妃";
  if (/君主/.test(r)) return "君主";
  if (/军事|猛将|武将/.test(r)) return "武";
  if (/谋略|谋士/.test(r)) return "谋";
  if (/内政|文臣|名士|学者/.test(r)) return "文";
  return "其他";
};
console.log("\n【跨批可比】按「职能 × renown」分层，层内各批均值（五维之和）");
let suspect = 0;
for (const cls of ["武", "谋", "文", "君主"]) {
  for (const rk of [1, 2, 3]) {
    const grp = withStats.filter((o) => roleClass(o) === cls && o.renown === rk && batchOf.has(o.id));
    if (grp.length < 10) continue;                       // 样本太小不做判断
    const byBatch = {};
    for (const o of grp) (byBatch[batchOf.get(o.id)] ??= []).push(DIMS.reduce((a, d) => a + o[d], 0));
    const rows = Object.entries(byBatch)
      .filter(([, v]) => v.length >= 3)                  // 每批至少 3 人才计入
      .map(([b, v]) => ({ b, n: v.length, m: v.reduce((a, c) => a + c, 0) / v.length }))
      .sort((a, b) => b.m - a.m);
    if (rows.length < 2) continue;
    const spread = rows[0].m - rows.at(-1).m;
    if (spread > 60) suspect += 1;              // 只记录，供人工翻看
    console.log(`  ${cls} · renown ${rk}（${grp.length} 人）极差 ${spread.toFixed(0)}`);
    console.log(`    ${rows.map((r) => `${r.b}:${r.m.toFixed(0)}(${r.n})`).join("  ")}`);
  }
}
console.log(`  ${suspect} 层极差 >60，建议人工翻看该层名单确认是构成差异而非标尺差异`);
console.log("  （标尺一致性以体检一的锚点断言为准）");

// ── 常识校验 ────────────────────────────────────────────────────────
const odd = [];
for (const o of withStats) {
  const roles = (o.roles ?? []).join("");
  if (/文臣|谋士|名士|学者/.test(roles) && o.might >= 70) odd.push(`${o.name} 文职却武力 ${o.might}`);
  if (/猛将|武将/.test(roles) && o.intellect >= 88) odd.push(`${o.name} 武职却智力 ${o.intellect}`);
}
console.log(`\n【常识校验】可疑 ${odd.length} 条${odd.length ? "：" : " ✓"}`);
odd.slice(0, 8).forEach((x) => console.log(`  ${x}`));

// ── 落盘 ────────────────────────────────────────────────────────────
all.sort((a, b) => (a.renown ?? 9) - (b.renown ?? 9) || cmp(a.id, b.id));
fs.writeFileSync(`${D}/officers.json`, JSON.stringify(all, null, 1));
console.log(`\n→ ${D}/officers.json  ${all.length} 人`);
