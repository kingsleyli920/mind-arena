// 把一份榜的结果压成给网页读的一小份 JSON。
//
// 立这个是因为一个反差：这个项目的立项目的是「用游戏评测大模型」，
// 而跑出来的榜只活在 eval-out/*.json 与 docs/EVAL.md 里——网站首页那排
// 模型名还是写死的占位符。测量不进产品，就等于没测。
//
// 只取展示要用的字段。原始 JSON 一份就有几 MB（含逐季记录），
// 不能直接塞进 public/。
//
// 用法：node --experimental-strip-types tools/build-leaderboard.mjs \
//         eval-out/board4 [--out=public/game/leaderboard.json]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { GRADE_SCORE, boardScore, contScore } from "../lib/arena/scoring.ts";
import { ruleFingerprint } from "../lib/game/content/fingerprint.ts";

/**
 * 一份跑是在哪一代规则下跑的。
 *
 * 优先读 stamp 里盖的指纹；旧的跑没有（指纹是后加的），就**从它记的提交号
 * 回溯**：`git show <commit>:内容包` 算一遍。这样历史才是真的——
 * 否则「跨规则不可比」只能写成一句免责声明，而读者无从判断哪两份能比。
 */
const fpCache = new Map();
function eraOf(run) {
  const stamped = run.stamp?.packFingerprint;
  if (stamped) return stamped;
  const git = run.stamp?.git;
  if (!git) return null;
  if (fpCache.has(git)) return fpCache.get(git);
  let fp = null;
  try {
    const pack = JSON.parse(
      execSync(`git show ${git}:lib/game/content/pack-194.json`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    fp = ruleFingerprint(pack).hash;
  } catch { fp = null; }
  fpCache.set(git, fp);
  return fp;
}

const dir = process.argv[2];
const outArg = process.argv.slice(3).find((a) => a.startsWith("--out="));
const OUT = outArg ? outArg.slice(6) : "public/game/leaderboard.json";
if (!dir || !fs.existsSync(dir)) {
  console.error("用法：node --experimental-strip-types tools/build-leaderboard.mjs <榜目录>");
  process.exit(2);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith("summary.json"));
const runs = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
if (!runs.length) { console.error(`${dir} 里没有结果文件`); process.exit(2); }

// 所有臂必须跑在同一套规则数值上。跨规则的榜不能并排读，而那件事在页面上
// 一个字都看不出来——所以在这里拦，不在页面上标注了事。
//
// 比的是**指纹**不是版本号：版本号是人写的标签，会滞后。这道闸第一次跑就
// 撞上了——五个臂里三个 0.2.0、两个 1.0.0，而那次提交只改了版本号与冻结
// 标记，规则数值一个没动。旧的跑没有指纹（是后来才盖进 stamp 的），
// 那种情况只能靠 --skew 显式放行，且必须写明理由——理由会跟着数据进页面。
const fps = [...new Set(runs.map(eraOf).filter(Boolean))];
const versions = [...new Set(runs.map((r) => r.stamp?.packVersion ?? "?"))];
// **剧本也要对齐。** 指纹只盖规则数值，而两个剧本共用同一套规则——
// 兴平元年与建安五年的指纹逐位相同，于是一份榜可以把两个剧本的对局
// 排进同一张表而无人察觉：曹操在 194 年开局一个郡、在建安五年开局
// 二十四个郡，同一个席位名下是两件完全不同的事。
// 这是「一份榜会以哪几种方式悄悄变成谎话」的第三种，加剧本那天才出现
const eras = [...new Set(runs.map((r) => r.stamp?.packScenario).filter(Boolean))];
const skewArg = process.argv.find((a) => a.startsWith("--skew="));
const skew = skewArg ? skewArg.slice(7) : null;
if (fps.length > 1) {
  console.error(`✗ 这些臂跑在不同的规则数值上（指纹 ${fps.join("、")}）。不可并排读。`);
  process.exit(3);
}
if (eras.length > 1) {
  console.error(`✗ 这些臂跑在不同的剧本上（${eras.join("、")}）。不可并排读——`
    + "同一个席位在两个剧本里是两件事（曹操 194 年开局一郡，建安五年开局二十四郡）。");
  process.exit(3);
}
// 指纹一致时，版本号不一致是无关紧要的——那只说明标签滞后。
// 只有连指纹都算不出来（提交号丢了）才需要人工放行
if (fps.length === 0 && versions.length > 1 && !skew) {
  console.error(`✗ 这些臂的内容包版本不一致（${versions.join("、")}），而指纹也算不出来。`);
  console.error("  核实那几次提交有没有改数值，确认无改动后显式放行：");
  console.error("    --skew=\"核实过：那次提交只改了版本号，数值未动\"");
  process.exit(3);
}
if (fps.length === 1 && versions.length > 1) {
  console.log(`注：版本号 ${versions.join("/")} 不一致，但规则数值的指纹相同`
    + `（${fps[0]}）——可以并排读。版本号只是滞后的标签。`);
}

const name = (r) => (r.agent === "model" ? r.model : r.agent);

// 一份榜里同一个对局方不能出现两次。
//
// 实测撞过：一个工作目录里躺着同一次跑的三份快照（44 局、48 局、原始），
// 工具把它们当成三个对局方，页面上出现三行同名、React 报重复 key。
// 那不是一份榜，是个工作目录——榜目录里应当每个对局方恰好一份结果
{
  const seen = new Map();
  for (let i = 0; i < runs.length; i += 1) {
    const k = name(runs[i]);
    if (seen.has(k)) {
      console.error(`✗ ${dir} 里 ${k} 出现了两次：${files[seen.get(k)]} 与 ${files[i]}`);
      console.error("  一份榜里每个对局方只能有一份结果。这个目录多半是工作目录，不是榜。");
      process.exit(3);
    }
    seen.set(k, i);
  }
}
const key = (x) => `${x.seed}|${x.seat}`;
const METRICS = [
  ["grade", (x) => GRADE_SCORE[x.grade]],
  ["board", boardScore],
  ["cont", contScore],
];

/** 配对差 + 95% 区间。基线是 bot:purpose——它是这套评测里最强的机器人 */
const base = runs.find((r) => name(r) === "bot:purpose");
function vs(r, metric) {
  if (!base || r === base) return null;
  const m = new Map(base.results.map((x) => [key(x), metric(x)]));
  const d = r.results.filter((x) => m.has(key(x))).map((x) => metric(x) - m.get(key(x)));
  const n = d.length;
  if (n < 2) return null;
  const mu = d.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1));
  const ci = 1.96 * sd / Math.sqrt(n);
  return { mu: +mu.toFixed(1), ci: +ci.toFixed(1), sig: Math.abs(mu) > ci, n };
}

const rows = runs.map((r) => {
  const R = r.results, n = R.length;
  const avg = (f) => R.reduce((s, x) => s + f(x), 0) / n;
  const grades = {};
  for (const x of R) grades[x.grade] = (grades[x.grade] ?? 0) + 1;
  const rec = r.records ?? [];
  const picks = rec.reduce((s, x) => s + (x.pickCount ?? 0), 0);
  const dropped = rec.reduce((s, x) => s + ((x.pickCount ?? 0) - (x.admitted ?? 0)), 0);
  // 逐席位：强席与弱席混在一个均分里，正是「模型是不是普遍地差」被答错的地方
  const bySeat = {};
  for (const x of R) {
    const b = (bySeat[x.seatName] ??= { n: 0, dead: 0, gain: 0 });
    b.n += 1; b.dead += x.eliminated ? 1 : 0; b.gain += x.commanderies - x.start;
  }
  for (const b of Object.values(bySeat)) b.gain = +(b.gain / b.n).toFixed(1);
  return {
    id: name(r), kind: r.agent === "model" ? "model" : "bot",
    games: n,
    grade: +avg((x) => GRADE_SCORE[x.grade]).toFixed(1),
    board: +avg(boardScore).toFixed(1),
    cont: +avg(contScore).toFixed(0),
    growth: +avg((x) => x.commanderies / Math.max(1, x.start)).toFixed(2),
    elim: R.filter((x) => x.eliminated).length,
    illegal: picks ? +(dropped / picks * 100).toFixed(1) : 0,
    usd: r.spentUsd != null ? +r.spentUsd.toFixed(2) : null,
    grades, bySeat,
    vs: Object.fromEntries(METRICS.map(([k, f]) => [k, vs(r, f)])),
    // 跑的时候是什么条件。缺了这些，两个月后没人说得清这份榜是怎么来的
    reasoning: r.reasoning ?? null, halted: r.halted ?? null,
    rungs: r.records?.length
      ? [...new Set(r.records.map((x) => x.rung).filter(Boolean))].join("/") : null,
  };
});
rows.sort((a, b) => b.board - a.board);

const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const out = {
  packVersion: versions.join("/"),
  packFingerprint: fps[0] ?? null,
  // 版本号不一致却仍出榜时，理由跟着数据走，页面上必须显示
  versionSkewNote: versions.length > 1 ? skew : null,
  frozen: pack._frozen ?? null,
  seasons: runs[0].results[0]?.seasons ?? null,
  seats: runs[0].seats ?? null,
  baseline: base ? name(base) : null,
  totalUsd: +rows.reduce((s, r) => s + (r.usd ?? 0), 0).toFixed(2),
  git: (() => { try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); }
                catch { return null; } })(),
  rows,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

// ── 历史：按「规则代」分组 ──────────────────────────────────────────
//
// 历史不是一条线，是分代的。规则数值一改，前后两份榜就不可比——
// 把它们画在同一条折线上，是在制造一个不存在的趋势。
// 所以按指纹分组，代与代之间在页面上要有明确的断口。
// 历史**不跟着 --out 走**。--out 是「这一份榜写到哪」，历史是站点唯一的一份
// 累积记录；跟着 --out 走的话，`--out=/tmp/x.json` 会把历史也写进 /tmp，
// 于是「记下来了」其实什么都没记。实测踩过一次
const histArg = process.argv.find((a) => a.startsWith("--history="));
const HIST = histArg ? histArg.slice(10) : "public/game/history.json";
const idArg = process.argv.find((a) => a.startsWith("--id="));
const boardId = idArg ? idArg.slice(5) : path.basename(dir.replace(/\/$/, ""));
// 产出时间取结果文件里最新的那个 mtime——「这份榜是什么时候跑出来的」
const when = new Date(Math.max(...files.map((f) => fs.statSync(path.join(dir, f)).mtimeMs)))
  .toISOString().slice(0, 10);
const hist = fs.existsSync(HIST) ? JSON.parse(fs.readFileSync(HIST, "utf8")) : { eras: [] };
// 代的键要把剧本带上：指纹相同而剧本不同的两份榜，仍然不是同一代
const eraKey = (fps.length === 1 ? fps[0] : "mixed")
  + (eras.length === 1 ? `@${eras[0]}` : "");
const entry = {
  id: boardId, date: when, git: out.git, packVersion: out.packVersion,
  scenario: eras.length === 1 ? eras[0] : null,
  // 各臂跑在不同规则上的榜要标出来，它内部就不可比，更不能与别人比
  mixed: fps.length > 1 ? fps : null,
  rows: rows.map((r) => ({ id: r.id, kind: r.kind, games: r.games, board: r.board, cont: r.cont })),
};
let era = hist.eras.find((e) => e.fingerprint === eraKey);
if (!era) { era = { fingerprint: eraKey, boards: [] }; hist.eras.push(era); }
era.boards = era.boards.filter((b) => b.id !== boardId).concat(entry)
  .sort((a, b) => (a.date < b.date ? -1 : 1));
// 代按各自最早的一份榜排序，最新的代放最后
hist.eras.sort((a, b) => (a.boards[0]?.date ?? "") < (b.boards[0]?.date ?? "") ? -1 : 1);
hist.current = eraKey;
fs.writeFileSync(HIST, `${JSON.stringify(hist, null, 2)}\n`);
console.log(`→ ${HIST}　${hist.eras.length} 代规则，共 `
  + `${hist.eras.reduce((n, e) => n + e.boards.length, 0)} 份榜`);
if (out.versionSkewNote) console.log(`⚠ 版本号不一致，已按理由放行：${out.versionSkewNote}`);
console.log(`→ ${OUT}　${rows.length} 个对局方　包 ${out.packVersion}　`
  + `${(fs.statSync(OUT).size / 1024).toFixed(1)}KB`);
for (const r of rows) {
  console.log(`  ${r.id.padEnd(28)}榜分 ${String(r.board).padStart(6)}`
    + `${r.vs.board ? `　对基线 ${r.vs.board.mu >= 0 ? "+" : ""}${r.vs.board.mu} ±${r.vs.board.ci}`
        + `${r.vs.board.sig ? " ✓" : " ·"}` : "　基线"}`);
}
