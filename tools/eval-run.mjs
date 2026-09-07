// 评测跑：让若干席位由指定的对局方驱动，打完整局，出记录与报告。
//
// 现在支持三类对局方：bot（确定性规则 AI）、stub（无密钥的桩）、
// model（接 OpenRouter，需 OPENROUTER_API_KEY）。
// 设计成先能用桩跑通整条管道——观测装配、准入、记录、报告——
// 否则这些代码在密钥到位前一行都没跑过，真接上模型时分不清是谁的问题。
//
// 用法：
//   npm run eval -- --agent=bot:balanced --games=6      ← 基线，不花钱
//   npm run eval -- --agent=stub:chaos --games=2
//   npm run eval -- --agent=model --model=<id> --games=6
//
// **bot 基线是所有模型分数的参照物**：没有它，「均分 200」说明不了任何事。
// 它走的是与模型完全相同的那条路（picks → admit → orders），
// 同 seed 同对手，因此可直接比。
import fs from "node:fs";
import { execSync } from "node:child_process";
import { buildGraph, listActions, DEFAULT_RULES } from "../lib/game/engine/actions.ts";
import { decide, pick as botPick, PROFILES } from "../lib/game/engine/bot.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { buildGeography, standingOf, gradeOf, zhouEquiv }
  from "../lib/game/engine/victory.ts";
import { observe, estTokens } from "../lib/game/engine/observe.ts";
import { admit } from "../lib/arena/seat/admit.ts";
import { stubDecide } from "../lib/arena/seat/stub-seat.ts";
import { modelDecide } from "../lib/arena/seat/model-seat.ts";
import { OpenRouterClient } from "../lib/arena/llm/client.ts";
import { GRADE_SCORE } from "../lib/arena/scoring.ts";
import { PROMPT_VERSION } from "../lib/arena/seat/prompt.ts";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const AGENT = arg("agent", "stub");
const GAMES = Number(arg("games", 6));
const OUT = arg("out", "");
// --json=<file>：把整跑的结构化结果写出来，供 eval-suite 汇总。
// 套件不复制这里的对局循环，只做编排与汇总——复制一份迟早与这里分家
const JSON_OUT = arg("json", "");
const SEATS = (arg("seats", "caocao,yuanshao,liubiao,liuzhang,yuanshu,lubu")).split(",");
/** --seasons=<季数>：本局多长。不给则用内容包的 16（评测口径） */
const SEASONS = Number(arg("seasons", "0")) || 0;
/**
 * --memory=off：不把上季的跨季方略回传给模型。
 *
 * 这是「记忆值多少分」的对照臂。默认开——每次决策本来是无状态的，
 * 观测里全是「此刻的状态」，没有一条是「我上季打算干什么」
 */
const MEMORY = arg("memory", "on") !== "off";
/**
 * --provider=A,B：钉住提供方。
 *
 * 不钉的话同一个模型 id 会在提供方之间跳——一份 24 季实录里跳了 7 家，
 * 单次用时中位 11.2s 而最慢 723.9s（差 45 倍），前缀缓存也几乎不命中（2%）。
 * 上一份排行榜正是被这个拖垮的：两个模型跑到墙钟上限只完成 38/48 与 26/48。
 * 量化精度与上下文实现各家不同，「同一个模型」其实不是同一个东西
 */
const PROVIDER = arg("provider", "");

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const P = loadParams(pack);
const ROSTER = buildRoster(read("officers.json"), read("officer-availability-194.json"),
  new Map(read("commanderies.json").map((c) => [c.name, c.id])));
const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
const G = buildGraph(read("adjacency.json"));
const scenario = read("scenario-194.json");
const nameOf = (id) => scenario.factions.find((f) => f.id === id)?.name ?? id;
const DATA = {
  commanderyState: read("commandery-state.json"), scenario,
  commanderies: read("commanderies.json"), troopTypes: read("troop-types.json"), resources: read("resources.json"),
};

const BOT_PROFILES = ["turtle", "balanced", "aggressive", "opportunist"];
const [agentKind, agentVariantRaw] = AGENT.split(":");
if (!["bot", "stub", "model"].includes(agentKind)) {
  console.error(`未知的对局方 ${agentKind}（只有 bot / stub / model）`);
  process.exit(2);
}
// bot 与 stub 的默认变体不同，且都必须校验——`--agent=bot:balanced` 此前会
// 落进 stubDecide 静默跑成 random-legal，而报告照样标着 bot:balanced
const agentVariant = agentVariantRaw ?? (agentKind === "bot" ? "balanced" : "random-legal");
if (agentKind === "bot" && !(agentVariant in PROFILES)) {
  console.error(`未知的机器人画像 ${agentVariant}（有 ${Object.keys(PROFILES).join(" / ")}）`);
  process.exit(2);
}
const MODEL = arg("model", "");
let client = null;
if (agentKind === "model") {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    // 这个脚本是 plain node，本身不加载任何 env 文件——npm script 里靠
    // --env-file-if-exists=.env.local 把它读进来。直接 `node tools/eval-run.mjs`
    // 是读不到的，必须走 npm run eval
    console.error("缺少 OPENROUTER_API_KEY。在项目根目录把 key 写进 .env.local（该文件已在 .gitignore）：");
    console.error("  printf 'OPENROUTER_API_KEY=%s\\n' 'sk-or-v1-…' >> .env.local");
    console.error("然后：npm run eval -- --agent=model --model=<模型 id> --games=1");
    console.error("注意要走 npm run eval——直接 node 跑本脚本不会加载 .env.local。");
    console.error("\n先用 --agent=stub 可以在没有 key 的情况下跑通整条管道。");
    process.exit(2);
  }
  if (!MODEL) { console.error("--agent=model 需要同时给 --model=<模型 id>"); process.exit(2); }
  client = new OpenRouterClient(key, { referer: "http://localhost:3000", title: "Mind Arena" });
}
// --keyenum=off 换回 Anthropic 的前缀缓存（入参便宜约 2.8 倍），代价是实测
// haiku 有 8.3% 的令因 key 写错被丢掉、非法率 0.7%→8.6%、均分 233.3→216.7。
// 默认开：逐字复现长中文 key 是转写能力不是策略能力，不该计进分数
const KEY_ENUM = arg("keyenum", "on") !== "off";
// --reasoning=low|medium|high 统一各模型的推理档位。不给则各用各的默认值——
// 实测 gpt-5-nano 每次烧 6739 出参 tok（97.7% 是 reasoning），haiku 只烧 103，
// 差 65 倍。不控这一项，跨模型比的就不是策略能力，而是各家默认给多少算力
const REASONING = arg("reasoning", "") ? { effort: arg("reasoning", "") } : undefined;
const MODEL_DEPS = client
  ? { client, model: MODEL, pack, g: G, P, roster: ROSTER, geo: GEO,
      ...(PROVIDER ? { provider: { order: PROVIDER.split(","), allow_fallbacks: false } } : {}),
      rules: DEFAULT_RULES, nameOf, keyEnum: KEY_ENUM, reasoning: REASONING }
  : null;

// 每局同时跑几局。局与局之间**完全独立**——各自的 seed、各自的 GameState，
// RNG 是 H(seed,…) 的纯函数，不存在跨局串扰——所以并行不改结果，只省墙钟。
// 实测各模型每次调用的耗时：mistral 4s、haiku 12s、deepseek 40s；
// 48 局是 768 次调用，串行跑 deepseek 要 8.5 小时。瓶颈是墙钟不是钱。
// 429 由客户端的退避兜住。--gamejobs=1 恢复串行。
const GAME_JOBS = Math.max(1, Number(arg("gamejobs", agentKind === "model" ? "4" : "1")));

const records = [];
const results = [];

/**
 * --budget=<美元>：累计实扣超过它就停手，不再开新局。
 *
 * 余额有限时这道闸是必需的。这套管线出过的最坏事故就是**跑到一半没钱**：
 * 一份「国产模型全线 4–35 分、机器人 148 分」的排行榜，真相是每个模型
 * 768 季里有 688–765 季根本没发出请求，而报告照常排了名。
 * 停手比跑完一份假榜好——停手至少还知道自己停了。
 *
 * 判的是**提供方回报的实扣**，不是价目表重算：实测重算少算 74%
 *（有的提供方 completion_tokens 不含 reasoning），拿它当闸门等于没有闸门。
 */
const BUDGET = Number(arg("budget", "0")) || 0;
let spent = 0;
let halted = null;

async function playGame(gi) {
  const seed = `eval-${gi}`;
  // 席位轮换：同一 seed 下每个被测席位都轮过一遍位置，消掉席位固有优劣
  const rot = gi % SEATS.length;
  const under = SEATS[(0 + rot) % SEATS.length];       // 本局由 agent 驾驶的席位
  let s = createGame(DATA, { seed, roster: ROSTER, geo: GEO,
                             ...(SEASONS ? { seasons: SEASONS } : {}) }, P);
  let since = 0;
  // 被测席位跨季的方略。模型自己写，下季原样回传——这是它唯一的记忆
  let plan = null;
  /** 上季被丢掉的令，回授给下一季 */
  let dropped = [];
  const turns = [];

  while (!s.finished) {
    const orders = [];
    let mine = null;
    for (const f of Object.keys(s.factions)) {
      if (s.factions[f].eliminated || s.factions[f].retired) continue;
      if (f === under && MODEL_DEPS) {
        const { orders: os, record } = await modelDecide(s, f, since, MODEL_DEPS,
          MEMORY ? plan : null, MEMORY ? dropped : []);
        // 只在模型给出新方略时更新。答不上来的那一季不该把记忆抹掉
        if (record.plan) plan = record.plan;
        // 被丢的令回授给下一季：不回授的话模型每季重犯同一个错而收不到信号
        dropped = record.admission?.dropped ?? [];
        orders.push(...os);
        // 实扣逐次累加，供预算闸门判断。取不到就不加——宁可闸门失灵报得少，
        // 也不要拿一个估算值去冒充实扣
        if (typeof record.usage?.cost === "number") spent += record.usage.cost;
        mine = {
          turn: s.turn, seat: f, obsTokens: record.obsTokens,
          candidates: record.candidates,
          // 落 picks **原文**而不只是条数。只记条数则事后无从复查
          // 「模型当时到底选了什么」——一份不能被复查的排行榜，
          // 两周后连自己都没法确认它是不是真的
          picks: record.picks, pickCount: record.picks.length,
          admitted: record.admission.admitted.length, spent: record.admission.spent,
          ap: s.factions[f].ap, illegalRate: record.admission.illegalRate,
          mojibake: record.admission.mojibake ?? 0,
          dropped: record.admission.dropped.map((d) => d.reason),
          usage: record.usage, failure: record.failure, reason: record.reason,
          plan: record.plan,
          structured: record.structured, rung: record.rung,
          failureKind: record.failureKind,
          maxTokens: record.maxTokens, finishReason: record.finishReason,
          elapsedMs: record.elapsedMs, attempts: record.attempts,
          // OpenRouter 会静默改路由：同一个 model id 换到别的提供方，
          // 量化精度与上下文都可能不同，而 model 字段照旧。留这两项才回查得了
          servedModel: record.model, provider: record.provider,
          generationId: record.generationId,
        };
      } else if (f === under) {
        const o = observe(s, f, G, P, ROSTER, GEO, { nameOf, since });
        const cands = listActions(s, f, G, P, DEFAULT_RULES, ROSTER, undefined, GEO);
        // 机器人也走 picks → admit：绕过准入层的话，illegalRate 与令数用率
        // 两列对基线是空的，而那正是判「模型有没有在乱下令」的参照
        const dec = agentKind === "bot"
          ? botPick(s, f, G, agentVariant, DEFAULT_RULES, ROSTER, P, GEO)
          : stubDecide(s, f, cands, agentVariant);
        const a = admit(s, f, dec.picks, cands, G, ROSTER, DEFAULT_RULES);
        orders.push(...a.orders);
        mine = {
          turn: s.turn, seat: f, obsTokens: estTokens(JSON.stringify(o)),
          candidates: cands.length, picks: dec.picks, pickCount: dec.picks.length,
          admitted: a.admitted.length, spent: a.spent, ap: s.factions[f].ap,
          illegalRate: a.illegalRate,
          dropped: a.dropped.map((d) => d.reason),
        };
      } else {
        const i = SEATS.indexOf(f);
        orders.push(...decide(s, f, G, i >= 0 ? BOT_PROFILES[(i + rot) % 4] : "balanced",
          undefined, ROSTER, P, GEO));
      }
    }
    // 额度耗尽就地停跑。继续跑只会用七百条「请求都没发出去」的记录
    // 堆出一份看起来煞有介事的假榜——实测正是如此：一份「国产模型全线
    // 4–35 分、机器人 148 分」的排行榜，真相是账户没钱了
    if (mine?.failureKind === "credits") {
      console.error(`\n✗ 账户额度耗尽，第 ${gi + 1} 局第 ${s.turn + 1} 季停跑。`);
      console.error(`  ${mine.failure}`);
      console.error("  这与模型能力无关。充值后重跑，本次结果不可用。");
      process.exit(3);
    }
    if (mine) turns.push(mine);
    since = s.log.length;
    const r = resolve(s, orders, G, P, ROSTER, GEO);
    if (r.rejected.some((x) => x.reason.startsWith("令数不足"))) {
      console.error(`✗ 第 ${s.turn} 季 resolve 见到「令数不足」—— 准入层有 bug`);
      process.exit(1);
    }
    s = refreshAp(r.state, P);
  }

  const f = s.factions[under];
  return {
    result: {
      game: gi, seed, seat: under, seatName: nameOf(under),
      grade: f.bestGrade, score: GRADE_SCORE[f.bestGrade],
      // **终局档**：局终这一刻实际站在哪一档，与 bestGrade 分开报。
      //
      // bestGrade 是**历史最高档的棘轮**（resolve.ts 只往上不往下）。
      // 16 季评测里那是对的——问的是「四年里你做到了什么」。
      // 但它测不出「后期」：64 季的自对局里目的流有 44% 的局最终被灭，
      // 却照样按中途摸到过的最高档记分，于是均分随局长一路上涨
      //（158.3 → 164.6 → 172.9）而疆域倍数一路下跌（1.37 → 1.29，
      // 进攻流 0.92 → 0.41）。涨的不是本事，是掷骰次数。
      //
      // 「模型是不是越到后期越强」这个问题，只有终局档答得了
      finalGrade: gradeOf(standingOf(s, GEO, under), {
        commanderies: f.startCommanderies, controlledZhou: f.startZhou,
        zhouSeats: f.startSeats,
      }),
      // 长局看的是疆域与统一，不是档位——档位是给 16 季评测用的量尺
      zhou: standingOf(s, GEO, under).controlledZhou,
      // 细分名次要用：档位太粗，同档的两个结局会被记成平手
      seats: standingOf(s, GEO, under).zhouSeats,
      startZhou: f.startZhou, startSeats: f.startSeats,
      // 连续州进度：定档那道台阶的斜坡版，配对比较用。见 lib/arena/scoring.ts
      zhouEquiv: +zhouEquiv(s, GEO, under).toFixed(4),
      startZhouEquiv: +(f.startZhouEquiv ?? 0).toFixed(4),
      unified: s.winner === under, winner: s.winner ?? null,
      seasons: s.seasonsPerGame,
      commanderies: Object.values(s.commanderies).filter((c) => c.owner === under).length,
      start: f.startCommanderies, eliminated: f.eliminated,
      // **按令数汇总，不是逐季求平均。** 逐季平均把「提 2 条丢 1 条」的短季
      // 与「提 15 条丢 1 条」的满季等权，而短季恰恰是被打残、快出局的那些季——
      // 于是越惨的局越把非法率往下拽。同一批数据两种口径实测差 22%
      //（qwen3-235b：逐季平均 8.6%，按令数汇总 11.0%）。
      // 这一列是用来判「模型有没有在乱下令」的，分母只能是它下的令
      illegalRate: turns.reduce((a, t) => a + t.dropped.length, 0)
                   / Math.max(1, turns.reduce((a, t) => a + t.pickCount, 0)),
      obsPeak: Math.max(...turns.map((t) => t.obsTokens)),
      apUse: turns.reduce((a, t) => a + t.spent, 0)
             / Math.max(1, turns.reduce((a, t) => a + t.ap, 0)),
    },
    records: turns.map((t) => ({ game: gi, seed, ...t })),
  };
}

// 有限并发。完成一局报一次进度——进度走 stderr，不污染报告；
// 没有它，一个慢的提供方在外面看就是「什么都没发生」
const queue = Array.from({ length: GAMES }, (_, i) => i);
const done = [];
await Promise.all(Array.from({ length: Math.min(GAME_JOBS, GAMES) }, async () => {
  while (queue.length) {
    if (halted) { queue.length = 0; break; }
    const gi = queue.shift();
    done.push(await playGame(gi));
    process.stderr.write(`[progress] ${done.length}/${GAMES}\n`);
    if (BUDGET && spent >= BUDGET) {
      halted = `累计实扣 $${spent.toFixed(4)} 达到预算 $${BUDGET.toFixed(2)}`;
      process.stderr.write(`[halt] ${halted}，已完成 ${done.length}/${GAMES} 局\n`);
    }
  }
}));
// 并发完成的顺序不定，按局号排回来——报告与 jsonl 的行序必须可复现
done.sort((a, b) => a.result.game - b.result.game);
for (const d of done) { results.push(d.result); records.push(...d.records); }

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
console.log(`对局方 ${AGENT}\u3000${GAMES} 局\u3000席位轮换 ${SEATS.length} 席\n`);
console.log("局".padStart(3), "席位".padEnd(10), "档".padStart(3), "分".padStart(4),
  "终郡".padStart(5), "非法率".padStart(7), "观测峰".padStart(7), "令数用率".padStart(9));
for (const r of results) {
  console.log(
    String(r.game).padStart(3), r.seatName.slice(0, 6).padEnd(10),
    r.grade.padStart(3), String(r.score).padStart(4),
    `${r.commanderies}/${r.start}`.padStart(5),
    `${(r.illegalRate * 100).toFixed(0)}%`.padStart(7),
    String(r.obsPeak).padStart(7),
    `${(r.apUse * 100).toFixed(0)}%`.padStart(9),
  );
}
const usage = records.filter((r) => r.usage);
const failures = records.filter((r) => r.failure);

// 失败拆分必须**先于** token 统计，且不受 usage.length 约束。
// 此前整段被 `if (usage.length)` 包着——若每一季都走 catch 失败（网络断、
// 密钥无效），usage 为空，于是失败拆分一个字都不打，报告只剩「均分 0.0」。
// 一个全程没发出请求的跑，看上去和一个真打了 768 季只是打得很烂的跑一模一样
if (failures.length) {
  const by = { credits: [], auth: [], infra: [], budget: [], harness: [], model: [] };
  for (const r of failures) (by[r.failureKind ?? "model"] ??= []).push(r);
  if (by.credits.length) {
    console.log(`\n✗ 账户额度耗尽 ${by.credits.length} 季——本次结果不可用，与模型能力无关`);
  }
  if (by.auth.length) {
    console.log(`\n✗ 密钥无效或该模型不对本 key 开放 ${by.auth.length} 季`
      + `——本次结果不可用，与模型能力无关`);
  }
  console.log(`失败拆分（共 ${failures.length}/${records.length} 席·季）：`
    + `额度 ${by.credits.length}\u3000鉴权 ${by.auth.length}`
    + `\u3000基础设施（超时/网络/5xx）${by.infra.length}`
    + `\u3000harness（出参预算）${by.budget.length}`
    + `\u3000harness（自身异常）${by.harness.length}`
    + `\u3000模型（答不上来）${by.model.length}`);
  for (const k of Object.keys(by)) {
    if (by[k].length) console.log(`  ${k} 样例：${by[k][0].failure}`);
  }
  // 只有最后一栏算模型的分。占比过半时这一行的名次没有意义
  const notModel = failures.length - by.model.length;
  if (notModel > records.length * 0.2) {
    console.log(`  ⚠ ${(notModel / records.length * 100).toFixed(0)}% 的席·季`
      + `败在模型能力之外，**本次名次不可信**`);
  }
}

if (usage.length) {
  const sum = (k) => usage.reduce((a, r) => a + (r.usage[k] ?? 0), 0);
  const cacheRate = sum("prompt") ? sum("cached") / sum("prompt") : 0;
  console.log(`\ntoken：入 ${sum("prompt")}（命中缓存 ${sum("cached")}，`
    + `${(cacheRate * 100).toFixed(0)}%）`
    // 不报「推理占出参的百分比」：有的提供方 completion_tokens 含 reasoning，
    // 有的不含，同一个比值在两家的含义相反，实测出现过 108% 这种数。
    // 报每次调用的绝对量，跨模型直接可比
    + `\u3000出 ${sum("completion")}\u3000推理 ${sum("reasoning")}`
    + `（每次 ${Math.round(sum("reasoning") / usage.length)} tok）`
    + `\u3000调用 ${usage.length} 次`
    + `\u3000失败 ${records.filter((r) => r.failure).length} 次`);
  // 降到哪一档必须报出来：不同档位下模型受的约束不同（有无解码层强制、
  // 有无 temperature），分数本来就不完全可比。此前只有一个 structured 布尔值
  const byRung = {};
  for (const r of records) if (r.rung) byRung[r.rung] = (byRung[r.rung] ?? 0) + 1;
  console.log(`档位：${Object.entries(byRung).sort()
    .map(([k, v]) => `${k} ${v}`).join("\u3000")}`);
  // 出参预算被推理吃光是 harness 的配置问题，不是模型答不上来。
  // 混进「失败」计数等于把自己的 bug 算到模型头上
  // 推理占比高说明这个模型在花大量测试时算力。跨模型比分前要看这个，
  // 否则比的是各家默认给多少算力，不是策略能力。--reasoning=low|medium|high 可统一
  if (sum("reasoning") > 0 && !REASONING) {
    console.log(`注：每次调用烧 ${Math.round(sum("reasoning") / usage.length)} tok 推理，`
      + `未指定 --reasoning，该模型用的是自家默认档位`);
  }
  const grown = records.filter((r) => r.maxTokens > 8000);
  if (grown.length) {
    console.log(`⚠ ${grown.length} 季被推理顶到翻倍重试（harness 的配置问题，不是模型的分）`);
  }
}
console.log(`\n均分 ${avg(results.map((r) => r.score)).toFixed(1)}`
  + `\u3000非法率 ${(records.reduce((a, r) => a + (r.dropped?.length ?? 0), 0)
     / Math.max(1, records.reduce((a, r) => a + (r.pickCount ?? 0), 0)) * 100).toFixed(1)}%`
  + `\u3000观测峰值 ${Math.max(...results.map((r) => r.obsPeak))} tok`
  + `\u3000令数用率 ${(avg(results.map((r) => r.apUse)) * 100).toFixed(0)}%`);

if (OUT) {
  fs.writeFileSync(OUT, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\n→ ${OUT}\u3000${records.length} 条席·季记录`);
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    agent: AGENT, model: MODEL || null, games: GAMES, seats: SEATS,
    // 预算停手时，games 与实际跑完的局数不同。报告必须看得见这件事，
    // 否则「48 局的排名」可能其实只有 11 局
    played: results.length, spentUsd: +spent.toFixed(4), halted,
    keyEnum: KEY_ENUM, reasoning: REASONING?.effort ?? null, memory: MEMORY,
    // 这一跑是在什么条件下跑的。缺了这些，两周后这份结果与新结果之间
    // 的差是「模型变了」还是「我们改了提示词/内容包/引擎」就分不清——
    // 而这个仓库的提示词、内容包、引擎每周都在动
    stamp: {
      promptVersion: PROMPT_VERSION,
      packVersion: pack?.version ?? null,
      packScenario: pack?.scenario ?? null,
      git: (() => {
        try {
          return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
        } catch { return null; }
      })(),
      dirty: (() => {
        try {
          return execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
        } catch { return null; }
      })(),
      // 时间戳用 ISO，别用本地格式——跨机器读同一份结果时要能排序
      at: new Date().toISOString(),
    },
    results, records,
  }));
}
