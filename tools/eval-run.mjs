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
import { buildGraph, listActions, DEFAULT_RULES } from "../lib/game/engine/actions.ts";
import { decide, pick as botPick, PROFILES } from "../lib/game/engine/bot.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { buildGeography } from "../lib/game/engine/victory.ts";
import { observe, estTokens } from "../lib/game/engine/observe.ts";
import { admit } from "../lib/arena/seat/admit.ts";
import { stubDecide } from "../lib/arena/seat/stub-seat.ts";
import { modelDecide } from "../lib/arena/seat/model-seat.ts";
import { OpenRouterClient } from "../lib/arena/llm/client.ts";
import { GRADE_SCORE } from "../lib/arena/scoring.ts";

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
  commanderies: read("commanderies.json"), troopTypes: read("troop-types.json"),
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

async function playGame(gi) {
  const seed = `eval-${gi}`;
  // 席位轮换：同一 seed 下每个被测席位都轮过一遍位置，消掉席位固有优劣
  const rot = gi % SEATS.length;
  const under = SEATS[(0 + rot) % SEATS.length];       // 本局由 agent 驾驶的席位
  let s = createGame(DATA, { seed, roster: ROSTER, geo: GEO }, P);
  let since = 0;
  const turns = [];

  while (!s.finished) {
    const orders = [];
    let mine = null;
    for (const f of Object.keys(s.factions)) {
      if (s.factions[f].eliminated || s.factions[f].retired) continue;
      if (f === under && MODEL_DEPS) {
        const { orders: os, record } = await modelDecide(s, f, since, MODEL_DEPS);
        orders.push(...os);
        mine = {
          turn: s.turn, seat: f, obsTokens: record.obsTokens,
          candidates: record.candidates, picks: record.picks.length,
          admitted: record.admission.admitted.length, spent: record.admission.spent,
          ap: s.factions[f].ap, illegalRate: record.admission.illegalRate,
          dropped: record.admission.dropped.map((d) => d.reason),
          usage: record.usage, failure: record.failure, reason: record.reason,
          structured: record.structured, rung: record.rung,
          maxTokens: record.maxTokens, finishReason: record.finishReason,
          elapsedMs: record.elapsedMs,
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
          candidates: cands.length, picks: dec.picks.length,
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
      commanderies: Object.values(s.commanderies).filter((c) => c.owner === under).length,
      start: f.startCommanderies, eliminated: f.eliminated,
      illegalRate: turns.reduce((a, t) => a + t.illegalRate, 0) / Math.max(1, turns.length),
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
    const gi = queue.shift();
    done.push(await playGame(gi));
    process.stderr.write(`[progress] ${done.length}/${GAMES}\n`);
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
if (usage.length) {
  const sum = (k) => usage.reduce((a, r) => a + (r.usage[k] ?? 0), 0);
  const cacheRate = sum("prompt") ? sum("cached") / sum("prompt") : 0;
  console.log(`\ntoken：入 ${sum("prompt")}（命中缓存 ${sum("cached")}，`
    + `${(cacheRate * 100).toFixed(0)}%）`
    + `\u3000出 ${sum("completion")}（其中推理 ${sum("reasoning")}，`
    + `${sum("completion") ? (sum("reasoning") / sum("completion") * 100).toFixed(0) : 0}%）`
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
  if (sum("reasoning") > sum("completion") * 0.5 && !REASONING) {
    console.log(`注：出参有 ${(sum("reasoning") / sum("completion") * 100).toFixed(0)}% 是推理，`
      + `每次调用 ${Math.round(sum("completion") / usage.length)} tok。`
      + `未指定 --reasoning，该模型用的是自家默认档位`);
  }
  const starved = records.filter((r) => (r.failure ?? "").startsWith("无内容"));
  const grown = records.filter((r) => r.maxTokens > 8000);
  if (starved.length || grown.length) {
    console.log(`⚠ 出参预算：${starved.length} 季返回空内容，`
      + `${grown.length} 季被推理顶到翻倍重试。这是 harness 的配置问题，不是模型的分`);
    if (starved.length) console.log(`  样例：${starved[0].failure}`);
  }
}
console.log(`\n均分 ${avg(results.map((r) => r.score)).toFixed(1)}`
  + `\u3000非法率 ${(avg(results.map((r) => r.illegalRate)) * 100).toFixed(1)}%`
  + `\u3000观测峰值 ${Math.max(...results.map((r) => r.obsPeak))} tok`
  + `\u3000令数用率 ${(avg(results.map((r) => r.apUse)) * 100).toFixed(0)}%`);

if (OUT) {
  fs.writeFileSync(OUT, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\n→ ${OUT}\u3000${records.length} 条席·季记录`);
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    agent: AGENT, model: MODEL || null, games: GAMES, seats: SEATS,
    keyEnum: KEY_ENUM, reasoning: REASONING?.effort ?? null,
    results, records,
  }));
}
