// 评测套件：把若干对局方放进**同一批 seed、同一批对手**里跑一遍，出排行榜。
//
// 只做编排与汇总，对局循环仍在 eval-run.mjs——套件复制一份迟早与它分家。
// 每个对局方起一个子进程，读它 --json 写出的结果。
//
// 三条是这个文件存在的理由，缺一条排行榜就不成立：
//
// 1. **必须有机器人基线。** 模型拿「均分 200」说明不了任何事，除非知道
//    同席同 seed 下 bot:balanced 拿多少。基线不花钱，永远先跑。
// 2. **必须报降级档位与推理占比。** 落在不同档位的模型受的约束不同
//    （有无解码层强制、有无 temperature），推理档位不同则测试时算力差几十倍。
//    并列在榜上，读者才知道这一列分数是在什么条件下拿的。
// 3. **必须报实测成本，且区分 harness 失败与模型失败。** 出参预算被推理
//    吃光是我们的配置问题，混进「失败」计数就是把自己的 bug 算到模型头上。
//
// 用法：
//   npm run eval:suite -- --agents=bot:balanced,bot:purpose,model:openai/gpt-5-nano
//   npm run eval:suite -- --agents=… --games=6 --reasoning=low --out=/tmp/suite
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { GRADE_CN } from "../lib/game/engine/victory.ts";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const AGENTS = arg("agents", "bot:balanced").split(",").filter(Boolean);
const GAMES = arg("games", "6");
const REASONING = arg("reasoning", "");
const KEYENUM = arg("keyenum", "");
const OUT_DIR = arg("out", "");
const CONCURRENCY = Number(arg("jobs", "3"));
// 基线必须是**指定的**那一个，不能是「碰巧排最高的那个 bot」——
// 后者会让每个对局方都显示成「不如基线」，而基线本身在换人
const BASELINE = arg("baseline", "bot:balanced");

if (OUT_DIR) fs.mkdirSync(OUT_DIR, { recursive: true });
const tmp = OUT_DIR || fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "eval-suite-"));

/** 价目表。取实时价，不硬编码——OpenRouter 的价格会变，硬编码的成本报告是假的 */
async function priceTable() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return new Map();
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models?output_modalities=text",
      { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return new Map();
    const { data } = await r.json();
    return new Map(data.map((m) => [m.id, m.pricing ?? {}]));
  } catch { return new Map(); }
}

function runOne(spec) {
  const [kind, ...rest] = spec.split(":");
  const variant = rest.join(":");
  const jsonOut = path.join(tmp, `${spec.replace(/[/:]/g, "_")}.json`);
  const args = ["--env-file-if-exists=.env.local", "--experimental-strip-types",
    "tools/eval-run.mjs", `--games=${GAMES}`, `--json=${jsonOut}`];
  if (kind === "model") { args.push("--agent=model", `--model=${variant}`); }
  else args.push(`--agent=${spec}`);
  if (REASONING && kind === "model") args.push(`--reasoning=${REASONING}`);
  if (KEYENUM && kind === "model") args.push(`--keyenum=${KEYENUM}`);

  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn("node", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stdout.on("data", () => {});
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => {
      const elapsed = Date.now() - t0;
      if (code !== 0 || !fs.existsSync(jsonOut)) {
        console.log(`  ✗ ${spec}\u3000退出码 ${code}\u3000${err.trim().split("\n").slice(-2).join(" / ")}`);
        return resolve({ spec, failed: true, error: err.trim().slice(-300) });
      }
      console.log(`  ✓ ${spec}\u3000${(elapsed / 1000).toFixed(0)}s`);
      resolve({ spec, elapsed, ...JSON.parse(fs.readFileSync(jsonOut, "utf8")) });
    });
  });
}

/** 有限并发。同时起太多会撞 OpenRouter 的速率限制，反而更慢 */
async function runAll(specs) {
  const out = [];
  const queue = [...specs];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) out.push(await runOne(queue.shift()));
  });
  await Promise.all(workers);
  return specs.map((s) => out.find((o) => o.spec === s)).filter(Boolean);
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function summarize(run, px) {
  const rs = run.results ?? [];
  const recs = run.records ?? [];
  const usage = recs.filter((r) => r.usage);
  const sum = (k) => usage.reduce((a, r) => a + (r.usage[k] ?? 0), 0);
  const grades = {};
  for (const r of rs) grades[r.grade] = (grades[r.grade] ?? 0) + 1;
  const rungs = {};
  for (const r of recs) if (r.rung) rungs[r.rung] = (rungs[r.rung] ?? 0) + 1;

  // harness 的锅与模型的锅分开：出参预算被推理吃光是我们没让它说完
  const starved = recs.filter((r) => (r.failure ?? "").startsWith("无内容")).length;
  const modelFail = recs.filter((r) => r.failure && !r.failure.startsWith("无内容")).length;

  let cost = null;
  const p = run.model ? px.get(run.model) : null;
  if (p && usage.length) {
    const M = 1e6;
    const inM = Number(p.prompt) * M, outM = Number(p.completion) * M;
    const readM = p.input_cache_read != null ? Number(p.input_cache_read) * M : inM;
    const fresh = sum("prompt") - sum("cached");
    cost = (fresh * inM + sum("cached") * readM + sum("completion") * outM) / M;
  }
  return {
    spec: run.spec, model: run.model, games: rs.length,
    score: avg(rs.map((r) => r.score)),
    grades,
    elim: rs.filter((r) => r.eliminated).length,
    growth: avg(rs.map((r) => (r.start ? r.commanderies / r.start : 0))),
    illegal: avg(rs.map((r) => r.illegalRate)),
    apUse: avg(rs.map((r) => r.apUse)),
    obsPeak: Math.max(0, ...rs.map((r) => r.obsPeak)),
    calls: usage.length,
    promptTok: sum("prompt"), cachedTok: sum("cached"),
    outTok: sum("completion"), reasonTok: sum("reasoning"),
    rungs, starved, modelFail, cost,
    reasoning: run.reasoning, keyEnum: run.keyEnum,
    elapsed: run.elapsed,
  };
}

// 分辨力下界。用 bot:purpose vs bot:balanced（自对局实测相差约 20 分）
// 做配对功效分析实测出来的：
//     6 局  配对差 +0.0 ± 0.0    —— 每个 seed 上两者得分完全相同，零分辨力
//    12 局        +16.7 ± 32.7   —— 置信区间盖过差值
//    24 局        +20.8 ± 23.5   —— 仍盖过
//    48 局        +29.2 ± 19.3   ✓ 刚好分得开
//    96 局        +20.8 ± 12.6   ✓ 舒服
// 根子在计分表只有四档（甲300/乙200/丙100/丁0），配对差每局只能取 0 或 ±100。
// 试过换连续指标（郡数增量）救场：没用——purpose 拿分更高而占郡更少
// （−0.4 郡），因为它挑的是值钱的郡不是多的郡。郡数不是目标函数。
const MIN_GAMES_FOR_POWER = 48;

console.log(`评测套件\u3000${AGENTS.length} 个对局方 × ${GAMES} 局`
  + `${REASONING ? `\u3000推理档 ${REASONING}` : "\u3000推理档：各用各的默认值"}`);
console.log(`并发 ${CONCURRENCY}\u3000结果目录 ${tmp}`);
if (Number(GAMES) < MIN_GAMES_FOR_POWER) {
  console.log(`⚠ ${GAMES} 局的分辨力不足以区分对局方：实测 20 分左右的真实差距`
    + `需要 ≥${MIN_GAMES_FOR_POWER} 局才超出 95% 置信区间（6 局时配对差恒为 0）。`
    + `\n  这一跑可以用来验管道、抓崩溃、看非法率，但**排名不可当结论**。`);
}
console.log("");

const px = await priceTable();
const runs = await runAll(AGENTS);
const rows = runs.filter((r) => !r.failed).map((r) => summarize(r, px));
rows.sort((a, b) => b.score - a.score || b.growth - a.growth);

const bot = rows.find((r) => r.spec === BASELINE);
console.log(`\n${"═".repeat(96)}`);
console.log(`排行榜（同 seed、同对手、席位轮换）`
  + `${Number(GAMES) < MIN_GAMES_FOR_POWER
      ? `\u3000⚠ ${GAMES} 局分辨力不足，名次不可当结论` : ""}\n`);
console.log("对局方".padEnd(40) + "均分".padStart(7) + "对基线".padStart(8)
  + "疆域倍数".padStart(9) + "出局".padStart(6) + "非法率".padStart(7)
  + "令数用率".padStart(9) + "成本".padStart(9));
for (const r of rows) {
  const vs = bot && bot.score > 0 ? `${(r.score / bot.score * 100 - 100).toFixed(0)}%` : "—";
  console.log(
    r.spec.slice(0, 38).padEnd(40)
    + r.score.toFixed(1).padStart(7)
    + (r.spec === bot?.spec ? "基线" : vs).padStart(8)
    + r.growth.toFixed(2).padStart(9)
    + `${r.elim}/${r.games}`.padStart(6)
    + `${(r.illegal * 100).toFixed(1)}%`.padStart(7)
    + `${(r.apUse * 100).toFixed(0)}%`.padStart(9)
    + (r.cost == null ? "—" : `$${r.cost.toFixed(3)}`).padStart(9));
}

console.log(`\n档位分布（模型受的约束不同则分数不完全可比）`);
for (const r of rows.filter((x) => x.calls)) {
  const cache = r.promptTok ? (r.cachedTok / r.promptTok * 100).toFixed(0) : 0;
  const reason = r.outTok ? (r.reasonTok / r.outTok * 100).toFixed(0) : 0;
  console.log(`  ${r.spec.slice(0, 38).padEnd(40)}`
    + `${Object.entries(r.rungs).sort().map(([k, v]) => `${k}×${v}`).join(" ").padEnd(24)}`
    + `缓存 ${String(cache).padStart(3)}%\u3000推理占出参 ${String(reason).padStart(3)}%`
    + `\u3000${r.reasoning ? `档 ${r.reasoning}` : "默认档"}`);
}

const anyIssue = rows.some((r) => r.starved || r.modelFail);
if (anyIssue) {
  console.log(`\n失败拆分（harness 的锅不能算到模型头上）`);
  for (const r of rows.filter((x) => x.starved || x.modelFail)) {
    console.log(`  ${r.spec.slice(0, 38).padEnd(40)}`
      + `harness（出参预算不足）${r.starved} 季\u3000模型（答不上来/解析不出）${r.modelFail} 季`);
  }
}

console.log(`\n档位构成`);
for (const r of rows) {
  console.log(`  ${r.spec.slice(0, 38).padEnd(40)}`
    + Object.entries(r.grades).sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `${GRADE_CN[g] ?? g}${n}`).join(" "));
}

const spend = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
console.log(`\n合计花费 $${spend.toFixed(3)}\u3000`
  + `总调用 ${rows.reduce((a, r) => a + r.calls, 0)} 次\u3000`
  + `耗时 ${(Math.max(0, ...rows.map((r) => r.elapsed ?? 0)) / 1000).toFixed(0)}s（并发 ${CONCURRENCY}）`);
for (const f of runs.filter((r) => r.failed)) console.log(`✗ ${f.spec} 整跑失败：${f.error}`);

if (OUT_DIR) {
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(rows, null, 2));
  console.log(`\n→ ${path.join(OUT_DIR, "summary.json")}`);
}
