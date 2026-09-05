// 评测套件：把若干对局方放进**同一批 seed、同一批对手**里跑一遍，出排行榜。
//
// 只做编排与汇总，对局循环仍在 eval-run.mjs——套件复制一份迟早与它分家。
// 每个对局方起一个子进程，读它 --json 写出的结果。
//
// 三条是这个文件存在的理由，缺一条排行榜就不成立：
//
// 1. **必须有机器人基线，且必须是最强的那个机器人。** 模型拿「均分 200」
//    说明不了任何事，除非知道同席同 seed 下机器人拿多少。基线不花钱，永远先跑。
//    基线默认 bot:purpose——它是五个画像里最强的一个，见下面 BASELINE 处的实测。
// 2. **必须报降级档位与推理占比。** 落在不同档位的模型受的约束不同
//    （有无解码层强制、有无 temperature），推理档位不同则测试时算力差几十倍。
//    并列在榜上，读者才知道这一列分数是在什么条件下拿的。
// 3. **必须报实测成本，且区分 harness 失败与模型失败。** 出参预算被推理
//    吃光是我们的配置问题，混进「失败」计数就是把自己的 bug 算到模型头上。
//
// 用法：
//   npm run eval:suite -- --agents=bot:purpose,bot:balanced,model:openai/gpt-5-nano
//   npm run eval:suite -- --agents=… --games=6 --reasoning=low --out=/tmp/suite
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { GRADE_CN } from "../lib/game/engine/victory.ts";
import { GRADE_SCORE } from "../lib/arena/scoring.ts";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const AGENTS = arg("agents", "bot:purpose").split(",").filter(Boolean);
const GAMES = arg("games", "6");
const REASONING = arg("reasoning", "");
/** 每局季数。0 = 用内容包的默认值（16） */
const SEASONS = Number(arg("seasons", "0")) || 0;
const KEYENUM = arg("keyenum", "");
const OUT_DIR = arg("out", "");
const CONCURRENCY = Number(arg("jobs", "3"));
// 基线必须是**指定的**那一个，不能是「碰巧排最高的那个 bot」——
// 后者会让每个对局方都显示成「不如基线」，而基线本身在换人。
//
// 默认取目的流而非均衡流：**基线取弱了，模型的分就是虚的**。
// 五个画像同 seed 48 局：目的流 158.3、均衡流 154.2、投机流 147.9、
// 进攻流 137.5、苟活流 0.0；配对 A/B 里目的流对均衡流是 +11.4±4.2。
// 拿均衡流当基线，等于让每个模型白得四分
const BASELINE = arg("baseline", "bot:purpose");
// 单个对局方的墙钟上限（分钟，0 为不限）。超时只判这一个失败，其余照常收尾——
// 此前一个卡住的提供方会把整跑无限期挂住，跑了半小时的其他模型一个字都拿不到。
// 实测同一批 6 局里，最快的对局方 391s，最慢的两个 29 分钟仍未结束
const DEADLINE_MIN = Number(arg("deadline", "0"));

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

/** 各对局方的实时进度，供心跳行显示 */
const progress = new Map();
/** 一旦有人撞上额度耗尽，剩下的都不必再跑 */
let creditsOut = false;
/** --budget=<美元>：整批的实扣上限，按花钱的对局方均摊后透传给子进程 */
const BUDGET = Number(arg("budget", "0")) || 0;
/** --provider=A,B：钉住提供方，见 eval-run 的同名参数 */
const PROVIDER = arg("provider", "");
const payingCount = Math.max(1, AGENTS.filter((a) => a.startsWith("model:")).length);

function runOne(spec) {
  const [kind, ...rest] = spec.split(":");
  const variant = rest.join(":");
  const jsonOut = path.join(tmp, `${spec.replace(/[/:]/g, "_")}.json`);
  const args = ["--env-file-if-exists=.env.local", "--experimental-strip-types",
    "tools/eval-run.mjs", `--games=${GAMES}`, `--json=${jsonOut}`];
  // 局长必须透传。此前这里不转发 --seasons，于是
  // `npm run eval:suite -- --seasons=64` 会**静默按 16 季跑**，
  // 而报告上一个字都看不出来——一次 720 局的长局梯度实验因此只能绕开套件、
  // 自己拼汇总。子进程参数是这个文件与 eval-run 之间唯一的接口，
  // 加一个参数就要在这里加一行，漏了就是静默失效
  if (SEASONS) args.push(`--seasons=${SEASONS}`);
  if (kind === "model") { args.push("--agent=model", `--model=${variant}`); }
  else args.push(`--agent=${spec}`);
  if (REASONING && kind === "model") args.push(`--reasoning=${REASONING}`);
  if (KEYENUM && kind === "model") args.push(`--keyenum=${KEYENUM}`);
  if (PROVIDER && kind === "model") args.push(`--provider=${PROVIDER}`);
  // 预算按**花钱的对局方**均摊。bot 与 stub 不发请求，把额度分给它们
  // 等于白扔——此前这个闸门根本没被透传，加了等于没加
  if (BUDGET && kind === "model") args.push(`--budget=${(BUDGET / payingCount).toFixed(4)}`);

  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn("node", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    progress.set(spec, { done: 0, total: Number(GAMES), t0 });
    p.stdout.on("data", () => {});
    p.stderr.on("data", (d) => {
      const t = String(d);
      // eval-run 的每局进度走 stderr
      for (const m of t.matchAll(/\[progress\] (\d+)\/(\d+)/g)) {
        progress.set(spec, { done: Number(m[1]), total: Number(m[2]), t0 });
      }
      err += t.replace(/\[progress\][^\n]*\n/g, "");
    });
    let killer = null;
    if (DEADLINE_MIN > 0) {
      killer = setTimeout(() => {
        p.kill("SIGTERM");
        err += `\n墙钟超过 ${DEADLINE_MIN} 分钟，已终止`;
      }, DEADLINE_MIN * 60_000);
    }
    p.on("close", (code) => {
      if (killer) clearTimeout(killer);
      const elapsed = Date.now() - t0;
      progress.delete(spec);
      if (code === 3) {
        // 额度耗尽：整跑作废，不必再让别的模型去撞同一堵墙
        console.log(`  ✗ ${spec}\u3000账户额度耗尽，整跑中止`);
        creditsOut = true;
        return resolve({ spec, failed: true, credits: true,
                         error: err.trim().slice(-300) });
      }
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
    while (queue.length) {
      if (creditsOut) { queue.length = 0; break; }
      out.push(await runOne(queue.shift()));
    }
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
  // 只统计真发生过的档位：失败记录的 rung 是 null，混进来会虚构出
  // 「kimi text×54」这种从未发生的分布
  for (const r of recs) if (r.rung && !r.failure) rungs[r.rung] = (rungs[r.rung] ?? 0) + 1;

  // 失败三分栏。混成一个计数就会出现「kimi 55 季答不上来」这种结论，
  // 而实测其中 54 季是 180s 超时——那是按提供方的快慢排名，与策略能力无关
  const fk = (r) => r.failureKind ?? "model";
  const creditsFail = recs.filter((r) => r.failure && fk(r) === "credits").length;
  const infraFail = recs.filter((r) => r.failure && fk(r) === "infra").length;
  const starved = recs.filter((r) => r.failure && fk(r) === "budget").length;
  const modelFail = recs.filter((r) => r.failure && fk(r) === "model").length;
  const authFail = recs.filter((r) => r.failure && fk(r) === "auth").length;
  // 转码坏掉又复原的条数。非零说明提供方的编码有问题——
  // 修之前它会以 unknown-key 的形式记进非法率，把基础设施的问题算成模型的分
  const mojibake = recs.reduce((a, r) => a + (r.mojibake ?? 0), 0);
  const harnessFail = recs.filter((r) => r.failure && fk(r) === "harness").length;

  // 成本以**提供方回报的实际扣费**为准，价目表重算只作兜底。
  //
  // 实测同一局：价目表算出 $0.0081，提供方自报 $0.0162——**价目表少算一半**。
  // 一是 /models 报的是最低价而非实际路由到的提供方价，
  // 二是有的提供方 completion_tokens 不含 reasoning 而计费按两者之和。
  // 余额有限时少算就是跑到一半没钱，而那正是这套管线出过的最坏事故。
  const priced = usage.filter((r) => typeof r.usage.cost === "number");
  let cost = null, costSource = null;
  if (priced.length) {
    cost = priced.reduce((a, r) => a + r.usage.cost, 0);
    costSource = priced.length === usage.length ? "实扣" : `实扣${priced.length}/${usage.length}`;
  }
  const p = run.model ? px.get(run.model) : null;
  if (cost == null && p && usage.length) {
    const M = 1e6;
    const inM = Number(p.prompt) * M, outM = Number(p.completion) * M;
    const readM = p.input_cache_read != null ? Number(p.input_cache_read) * M : inM;
    const fresh = sum("prompt") - sum("cached");
    // 出参按 completion + reasoning 算：两者分开上报的提供方，计费是按和
    cost = (fresh * inM + sum("cached") * readM
            + (sum("completion") + sum("reasoning")) * outM) / M;
    costSource = "估算";
  }
  return {
    spec: run.spec, model: run.model, games: rs.length,
    score: avg(rs.map((r) => r.score)),
    // **终局分**：局终实际站在哪一档，与历史最高档（score）并列报。
    // 两者背离得越大，说明「中途辉煌、终局崩掉」的局越多——
    // 64 季自对局里目的流 44% 的局最终被灭却仍按历史最高档记分。
    // 「越到后期越强」这个问题，只有这一列答得了
    finalScore: avg(rs.map((r) => GRADE_SCORE[r.finalGrade ?? r.grade])),
    grades,
    elim: rs.filter((r) => r.eliminated).length,
    growth: avg(rs.map((r) => (r.start ? r.commanderies / r.start : 0))),
    // 这两列**按令数汇总**，不是逐局求平均。逐局平均把打了 2 季就被灭的局
    // 与打满 16 季的局等权，而短局的决策量只有满局的八分之一——
    // 实测同一批数据两种口径差 22%（qwen3-235b：逐局平均 8.6%，汇总 11.0%），
    // 且偏差方向固定：越惨的局越把非法率往下拽，正好美化了最该被看见的那些局
    illegal: recs.reduce((a, r) => a + (r.dropped?.length ?? 0), 0)
             / Math.max(1, recs.reduce((a, r) => a + (r.pickCount ?? 0), 0)),
    apUse: recs.reduce((a, r) => a + (r.spent ?? 0), 0)
           / Math.max(1, recs.reduce((a, r) => a + (r.ap ?? 0), 0)),
    obsPeak: Math.max(0, ...rs.map((r) => r.obsPeak)),
    calls: usage.length,
    promptTok: sum("prompt"), cachedTok: sum("cached"),
    outTok: sum("completion"), reasonTok: sum("reasoning"),
    rungs, creditsFail, authFail, infraFail, starved, harnessFail, modelFail, mojibake,
    cost, costSource,
    // 预算停手时实际跑了几局。与请求的局数不同就必须看得见
    played: run.played ?? rs.length, halted: run.halted ?? null,
    // 逐局分数按局号存下来，配对检验要用。各对局方跑的是同一批
    //(seed, 席位)，所以同局号可直接相减
    byGame: Object.fromEntries(rs.map((x) => [x.game, x.score])),
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

// 跑前预估花费。此前唯一的跑前检查是局数警告，钱一分不报——
// 于是「跑一批要花多少」只能在跑完看账单，而余额有限时那已经晚了。
// 实测口径：一局 16 次调用，入参约 96k tok（缓存命中约 5%）、出参约 8k tok
//（含推理）；提供方自报的实扣约为 /models 价目表的 2 倍，故乘 2 留余量
{
  const PER_GAME_IN = 96_000, PER_GAME_OUT = 8_000, MARKUP = 2;
  const est = [];
  for (const a of AGENTS) {
    if (!a.startsWith("model:")) continue;
    const id = a.slice(6);
    const p = px.get(id);
    if (!p) { est.push([id, null]); continue; }
    const per = (PER_GAME_IN * Number(p.prompt) + PER_GAME_OUT * Number(p.completion)) * MARKUP;
    est.push([id, per * Number(GAMES)]);
  }
  if (est.length) {
    const known = est.filter(([, v]) => v != null);
    const total = known.reduce((a, [, v]) => a + v, 0);
    console.log("跑前预估（按价目表 ×2，实扣以提供方自报为准）：");
    for (const [id, v] of est) {
      console.log(`  ${id.padEnd(42)}${v == null ? "价目表里没有这个 id —— 花费无从预估"
        : `$${v.toFixed(2)}`}`);
    }
    console.log(`  合计约 $${total.toFixed(2)}`
      + `${BUDGET ? `\u3000预算上限 $${BUDGET.toFixed(2)}`
                  + `（每个花钱的对局方 $${(BUDGET / payingCount).toFixed(2)}）`
                : "\u3000⚠ 未设 --budget，跑砸了没有闸门"}`);
    if (BUDGET && total > BUDGET) {
      console.log(`  ⚠ 预估已超预算，部分对局方会在跑满 ${GAMES} 局前停手`);
    }
    console.log("");
  }
}
// 心跳：每 60 秒报一次各对局方跑到哪。没有它，一个慢的提供方在外面看
// 与「挂死了」没有区别，而这两种情况的处置完全不同
const beat = setInterval(() => {
  if (!progress.size) return;
  const rows = [...progress].sort()
    .map(([k, v]) => `${k.split(":").pop().split("/").pop()} ${v.done}/${v.total}`
      + `（${((Date.now() - v.t0) / 60_000).toFixed(0)}分）`);
  console.log(`  … 仍在跑：${rows.join("\u3000")}`);
}, 60_000);
beat.unref?.();
const runs = await runAll(AGENTS);
clearInterval(beat);
const rows = runs.filter((r) => !r.failed).map((r) => summarize(r, px));
rows.sort((a, b) => b.score - a.score || b.growth - a.growth);

/**
 * 与基线的**配对差**及 95% 区间。
 *
 * 此前这一列印的是 `r.score / bot.score - 1` 的百分比。两个毛病：
 *   一、四档计分（甲300/乙200/丙100/丁0）的零点是任意的，比值的大小随整体
 *       平移而变——全体加 100 分，「领先 12%」就变成「领先 7%」，
 *       而两者描述的是同一件事；
 *   二、只有点估计。实测榜首那个「领先 12%」对应配对差 +16.7 ± 19.6，
 *       区间盖过 0——名次看着有序，其实分不开。一张没有区间的排行榜，
 *       读者必然把噪声当成差距。
 *
 * 各对局方跑的是同一批 (seed, 席位)，所以按局号相减就是配对差，
 * 比独立两样本的区间窄得多。判别局数（配对差非 0 的局数）也一并报：
 * 48 局里若有 33 局打平，那个区间是靠 15 局撑起来的，读者该知道。
 */
function pairedVs(r, base) {
  if (!base || r.spec === base.spec) return r.spec === base?.spec ? "基线" : "—";
  const games = Object.keys(r.byGame ?? {}).filter((g) => g in (base.byGame ?? {}));
  if (games.length < 2) return "—";
  const d = games.map((g) => r.byGame[g] - base.byGame[g]);
  const n = d.length;
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const ci = 1.96 * sd / Math.sqrt(n);
  const sig = Math.abs(mean) > ci ? "" : "?";
  return `${mean >= 0 ? "+" : ""}${mean.toFixed(0)}±${ci.toFixed(0)}${sig}`;
}

const bot = rows.find((r) => r.spec === BASELINE);
// 鉴权失败只废这一行，不废整批。403 常是「这个模型不对本 key 开放」，
// 按额度耗尽中止全部，是拿一个假归因换掉另一个假归因
const unusable = new Set(rows.filter((r) =>
  (r.authFail ?? 0) + (r.creditsFail ?? 0) > (r.calls + (r.authFail ?? 0)) * 0.5)
  .map((r) => r.spec));
if (unusable.size) {
  console.log(`\n⚠ 以下对局方过半席·季败在模型能力之外（鉴权/额度），`
    + `其行标 ✗，不参与名次：\n  ${[...unusable].join("、")}`);
}
if (creditsOut) {
  console.log(`\n${"═".repeat(96)}`);
  console.log("✗ 账户额度耗尽，整跑中止。**下面的名次不可用**——");
  console.log("  失败的席·季根本没发出请求，那不是模型答不上来。充值后重跑。\n");
}
console.log(`\n${"═".repeat(96)}`);
console.log(`排行榜（同 seed、同对手、席位轮换、每局 ${SEASONS || "16（包默认）"} 季）`
  + `${Number(GAMES) < MIN_GAMES_FOR_POWER
      ? `\u3000⚠ ${GAMES} 局分辨力不足，名次不可当结论` : ""}\n`);
// 均分（历史最高档）与终局分并列。两者背离得越大，
// 「中途辉煌、终局崩掉」的局越多——而长局里这正是要看的东西
console.log("对局方".padEnd(40) + "均分".padStart(7) + "终局分".padStart(8)
  + "对基线±95%".padStart(12)
  + "疆域倍数".padStart(9) + "出局".padStart(6) + "非法率".padStart(7)
  + "令数用率".padStart(9) + "成本".padStart(9));
for (const r of rows) {
  const vs = pairedVs(r, bot);
  console.log(
    r.spec.slice(0, 38).padEnd(40)
    + r.score.toFixed(1).padStart(7)
    + (r.finalScore == null ? "—" : r.finalScore.toFixed(1)).padStart(8)
    + (r.spec === bot?.spec ? "基线" : vs).padStart(12)
    + r.growth.toFixed(2).padStart(9)
    + `${r.elim}/${r.played ?? r.games}`.padStart(6)
    + `${(r.illegal * 100).toFixed(1)}%`.padStart(7)
    + `${(r.apUse * 100).toFixed(0)}%`.padStart(9)
    + (r.cost == null ? "—" : `$${r.cost.toFixed(3)}${r.costSource === "估算" ? "≈" : ""}`).padStart(10));
}

console.log(`\n档位分布（模型受的约束不同则分数不完全可比）`);
for (const r of rows.filter((x) => x.calls)) {
  const cache = r.promptTok ? (r.cachedTok / r.promptTok * 100).toFixed(0) : 0;
  // 分母取 completion + reasoning。只除 completion 会出现 108% 这种无意义的数——
  // 有的提供方 completion_tokens 不含 reasoning
  const outAll = r.outTok + r.reasonTok;
  const reason = outAll ? (r.reasonTok / outAll * 100).toFixed(0) : 0;
  console.log(`  ${r.spec.slice(0, 38).padEnd(40)}`
    + `${Object.entries(r.rungs).sort().map(([k, v]) => `${k}×${v}`).join(" ").padEnd(24)}`
    + `缓存 ${String(cache).padStart(3)}%\u3000推理占出参 ${String(reason).padStart(3)}%`
    + `\u3000${r.reasoning ? `档 ${r.reasoning}` : "默认档"}`);
}

const anyIssue = rows.some((r) => r.creditsFail || r.authFail || r.infraFail
  || r.starved || r.harnessFail || r.modelFail);
if (anyIssue) {
  console.log(`\n失败拆分（只有最后一栏算模型的分）`);
  for (const r of rows.filter((x) => x.infraFail || x.starved || x.modelFail
    || x.authFail || x.harnessFail || x.creditsFail)) {
    console.log(`  ${r.spec.slice(0, 38).padEnd(40)}`
      + `额度${String(r.creditsFail).padStart(4)}`
      + `\u3000鉴权${String(r.authFail).padStart(4)}`
      + `\u3000基础设施${String(r.infraFail).padStart(4)}`
      + `\u3000harness${String(r.starved + r.harnessFail).padStart(4)}`
      + `\u3000模型${String(r.modelFail).padStart(4)} 季`);
  }
  for (const r of rows.filter((x) => x.creditsFail > 0)) {
    console.log(`  ✗ ${r.spec} 有 ${r.creditsFail} 季因账户额度耗尽而未发出请求，此行不可用`);
  }
  const worst = rows.filter((r) => r.calls && r.infraFail / (r.calls + r.infraFail) > 0.2);
  for (const r of worst) {
    console.log(`  ⚠ ${r.spec} 的基础设施失败占 `
      + `${(r.infraFail / (r.calls + r.infraFail) * 100).toFixed(0)}%，`
      + `这一行的名次不可信——降并发或加大超时再跑`);
  }
}

console.log(`\n档位构成`);
for (const r of rows) {
  console.log(`  ${r.spec.slice(0, 38).padEnd(40)}`
    + Object.entries(r.grades).sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `${GRADE_CN[g] ?? g}${n}`).join(" "));
}

const spend = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
for (const r of rows.filter((x) => x.mojibake > 0)) {
  console.log(`⚠ ${r.spec}\u3000${r.mojibake} 条 key 被提供方的编码搞坏（已复原）`
    + `\u3000——这是路由层的问题，不计模型的非法率`);
}
console.log(`\n合计花费 $${spend.toFixed(3)}\u3000`
  + `总调用 ${rows.reduce((a, r) => a + r.calls, 0)} 次\u3000`
  + `耗时 ${(Math.max(0, ...rows.map((r) => r.elapsed ?? 0)) / 1000).toFixed(0)}s（并发 ${CONCURRENCY}）`);
for (const f of runs.filter((r) => r.failed)) console.log(`✗ ${f.spec} 整跑失败：${f.error}`);

if (OUT_DIR) {
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(rows, null, 2));
  console.log(`\n→ ${path.join(OUT_DIR, "summary.json")}`);
}
