// 混战：多个模型同场，各执一席，其余由机器人补齐。
//
// 与 eval-run.mjs 的分工要说清楚，两者测的**不是同一件事**：
//
//   eval-run  一局只有一个模型席位，其余三十家全是确定性机器人。
//             换任何模型来打，它面对的对手逐字节相同，所以分数可比——
//             这是排行榜的前提。代价是没有观赏性：模型之间从不照面。
//
//   melee     多个模型同场厮杀，外加机器人当参照。直观、好看，
//             但 A 的成绩既取决于自己也取决于 B 那天的发挥，
//             **不能当排行榜用**。它回答的是「这几家凑一桌谁能活下来」，
//             不是「谁更强」。
//
// 用法：
//   npm run melee -- --seats=caocao=z-ai/glm-5.3-flash,yuanshao=deepseek/deepseek-v3.2 --seasons=32
//   npm run melee -- --models=A,B,C --seasons=32        ← 随机抽席位派给它们
import fs from "node:fs";
import { execSync } from "node:child_process";
import { buildGraph, DEFAULT_RULES } from "../lib/game/engine/actions.ts";
import { decide } from "../lib/game/engine/bot.ts";
import { buildRoster } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { buildGeography, standingOf, epochLimitFor, GRADE_CN }
  from "../lib/game/engine/victory.ts";
import { modelDecide } from "../lib/arena/seat/model-seat.ts";
import { OpenRouterClient } from "../lib/arena/llm/client.ts";
import { GRADE_SCORE } from "../lib/arena/scoring.ts";
import { PROMPT_VERSION } from "../lib/arena/seat/prompt.ts";
import { roll } from "../lib/game/engine/rng.ts";
import { buildIndex, captureFrame, attachOutcome, REPLAY_VERSION }
  from "../lib/game/replay.ts";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const DATA = {
  commanderyState: read("commandery-state.json"), scenario: read("scenario-194.json"),
  commanderies: read("commanderies.json"), troopTypes: read("troop-types.json"),
};
const G = buildGraph(read("adjacency.json"));
const P = loadParams(pack);
const ROSTER = buildRoster(read("officers.json"), read("officer-availability-194.json"),
  new Map(read("commanderies.json").map((c) => [c.name, c.id])));
const GEO = buildGeography(read("commanderies.json"), read("province-seats-194.json"));
const NAME = Object.fromEntries(DATA.scenario.factions.map((f) => [f.id, f.name]));
const nameOf = (id) => NAME[id] ?? id;

const SEED = arg("seed", `melee-${Math.floor(Date.now() / 1000)}`);
const SEASONS = Number(arg("seasons", "32"));
const REASONING = arg("reasoning", "low");
const BUDGET = Number(arg("budget", "0")) || 0;
const OUT = arg("out", `混战-${SEED}.md`);
const BOT_PROFILES = ["turtle", "balanced", "aggressive", "opportunist"];
/** --provider=A,B：钉住提供方。不钉的话同一模型会在提供方之间跳，单次用时差过 45 倍 */
const PROVIDER = arg("provider", "");
/** --replay=<路径>：同时落一份逐季录像，供网页播放器回看。
 *  混战正是最该被看见的那种局——多个模型同场，而散文记不下同时发生的六件事 */
const REPLAY = arg("replay", "");

// 抽签池与 match-log 同一份：塞外诸部据的是名存实亡的边郡，抽到等于废签
const POOL = ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu",
  "liubei", "gongsunzan", "lijue", "gongsundu", "shixie", "zhangyang",
  "zhanglu", "maten", "hansui", "kongrong", "wanglang", "liuyao"];

/** 席位 → 模型。--seats=席位=模型,… 显式指定；--models=… 则随机抽席位 */
const seatOf = new Map();
const explicit = arg("seats", "");
if (explicit) {
  for (const pair of explicit.split(",")) {
    const [seat, model] = pair.split("=");
    if (!seat || !model) { console.error(`--seats 的写法是 席位=模型，收到「${pair}」`); process.exit(2); }
    seatOf.set(seat, model);
  }
} else {
  const models = arg("models", "").split(",").filter(Boolean);
  if (!models.length) { console.error("要么 --seats=席位=模型,…\u3000要么 --models=A,B,C"); process.exit(2); }
  const probe = createGame(DATA, { seed: SEED, roster: ROSTER, geo: GEO, seasons: SEASONS }, P);
  // 抽签用同一套确定性随机源：同 seed 同签，混战也可复现
  const drawn = POOL.filter((id) => probe.factions[id] && !probe.factions[id].eliminated)
    .map((id, i) => ({ id, r: roll({ seed: SEED, year: 0, season: 0, faction: "-", event: "melee", seq: i }) }))
    .sort((a, b) => a.r - b.r).slice(0, models.length).map((x) => x.id);
  models.forEach((m, i) => seatOf.set(drawn[i], m));
}

if (!process.env.OPENROUTER_API_KEY) {
  console.error("需要 OPENROUTER_API_KEY。npm run melee 已带 --env-file-if-exists=.env.local");
  process.exit(2);
}
const client = new OpenRouterClient(process.env.OPENROUTER_API_KEY, { title: "melee" });
const depsBase = { client, pack, g: G, P, roster: ROSTER, geo: GEO, nameOf,
  reasoning: { effort: REASONING },
  ...(PROVIDER ? { provider: { order: PROVIDER.split(","), allow_fallbacks: false } } : {}) };

const lines = [];
const say = (t = "") => { lines.push(t); console.log(t); };
const fmt = (n) => n.toLocaleString("en-US");
const SEASON_CN = ["", "春", "夏", "秋", "冬"];

let s = createGame(DATA, { seed: SEED, roster: ROSTER, geo: GEO, seasons: SEASONS }, P);
const plans = new Map(), spent = new Map(), calls = new Map(), meta = [];
let since = 0;

say(`# 混战实录\u3000${[...seatOf].map(([k, v]) => `${nameOf(k)}(${v.split("/").pop()})`).join(" vs ")}`);
say("");
say(`> **这不是排行榜。** 一局里 A 的成绩既取决于自己，也取决于 B 那天的发挥，`);
say(`> 所以名次不能跨局比较。要比谁更强，用 \`npm run eval:suite\`——`);
say(`> 那边一局只有一个模型席位、其余全是确定性机器人，每个模型面对的对手逐字节相同。`);
say("");
say(`| | |`);
say(`|---|---|`);
for (const [seat, model] of seatOf) {
  const f = s.factions[seat];
  const st = standingOf(s, GEO, seat);
  say(`| **${nameOf(seat)}** | \`${model}\`\u3000开局 ${f.startCommanderies} 郡 · ${st.controlledZhou} 州 · 州治 ${st.zhouSeats} |`);
}
say(`| 其余 ${Object.keys(s.factions).length - seatOf.size} 家 | 确定性机器人（四画像轮转）|`);
say(`| 局长 | ${SEASONS} 季\u3000种子 \`${SEED}\`\u3000推理档 ${REASONING} |`);
say(`| 胜负 | 先控 ${P.unifyZhou} 州者一统天下 |`);
say(`| 提示词 | v${PROMPT_VERSION}\u3000内容包 v${pack.version} |`);

// 录像索引。郡序取 commanderies.json 原序（= territory-grid 的 order）
const IDX = REPLAY ? buildIndex(
  DATA.commanderies,
  DATA.scenario.factions.map((f) => ({ id: f.id, name: f.name, color: f.color })),
  ["scale", "crane", "square"],
) : null;
const frames = [];
let prevStations = {}, prevCaptured = [];

while (!s.finished) {
  const turn = s.turn;
  say(`\n---\n`);
  say(`## 第 ${turn + 1}/${SEASONS} 季\u3000${s.year} 年 · ${SEASON_CN[s.season]}\u3000纪元 ${s.epoch}/${P.epochCount}`
    + `（至多再 ${Math.max(0, epochLimitFor(s, P) - (s.turn - s.epochStart))} 季推进；无主郡国守军每季自增 ${Math.round((P.neutralGrowth[s.epoch] ?? 0) * 100)}%${s.epoch < P.epochCount ? `，推进后 ${Math.round((P.neutralGrowth[s.epoch + 1] ?? 0) * 100)}%` : ""}）`);
  say("");

  // 模型席位并发请求：串行会让一局等成几小时
  const modelSeats = [...seatOf.keys()]
    .filter((f) => !s.factions[f].eliminated && !s.factions[f].retired);
  const done = await Promise.all(modelSeats.map(async (f) => {
    const out = await modelDecide(s, f, since, { ...depsBase, model: seatOf.get(f) },
      plans.get(f) ?? null);
    if (out.record.plan) plans.set(f, out.record.plan);
    if (typeof out.record.usage?.cost === "number") {
      spent.set(f, (spent.get(f) ?? 0) + out.record.usage.cost);
    }
    calls.set(f, (calls.get(f) ?? 0) + 1);
    meta.push({ turn: turn + 1, seat: f, model: seatOf.get(f),
      ms: out.record.elapsedMs, prompt: out.record.usage?.prompt ?? 0,
      cached: out.record.usage?.cached ?? 0, completion: out.record.usage?.completion ?? 0,
      reasoning: out.record.usage?.reasoning ?? 0, cost: out.record.usage?.cost ?? null,
      rung: out.record.rung, provider: out.record.provider,
      picks: out.record.picks?.length ?? 0,
      admitted: out.record.admission.admitted.length, spent: out.record.admission.spent,
      ap: s.factions[f].ap, failure: out.record.failure ?? null });
    return { f, out };
  }));

  const orders = [];
  for (const { f, out } of done) {
    orders.push(...out.orders);
    const st = standingOf(s, GEO, f);
    const n = Object.values(s.commanderies).filter((c) => c.owner === f).length;
    say(`### ${nameOf(f)}\u3000\`${seatOf.get(f).split("/").pop()}\``);
    say("");
    say(`${n} 郡 · ${st.controlledZhou} 州\u3000兵 ${fmt(Object.values(s.commanderies)
      .filter((c) => c.owner === f).reduce((a, c) => a + c.garrison, 0))}`
      + `\u3000国库 ${Math.round(s.factions[f].gold)} 金\u3000令 ${s.factions[f].ap}`
      + `\u3000${out.record.elapsedMs ? `用时 ${(out.record.elapsedMs / 1000).toFixed(1)}s` : ""}`
      + `${out.record.usage?.cost != null ? `\u3000$${out.record.usage.cost.toFixed(4)}` : ""}`);
    if (out.record.failure) say(`\n> ⚠ 无回应（${out.record.failureKind}）：${out.record.failure}`);
    if (plans.get(f)) say(`\n**方略**\u3000${plans.get(f)}`);
    if (out.record.reason) say(`\n**本季**\u3000${out.record.reason}`);
    say("");
    for (const k of out.record.admission.admitted) say(`- ✓ \`${k}\``);
    for (const d of out.record.admission.dropped) say(`- ✗ \`${d.key}\`\u3000${d.reason}`);
    say("");
  }
  // 其余势力：确定性机器人
  const ids = Object.keys(s.factions).sort();
  for (const [i, f] of ids.entries()) {
    if (seatOf.has(f) || s.factions[f].eliminated || s.factions[f].retired) continue;
    orders.push(...decide(s, f, G, BOT_PROFILES[i % 4], DEFAULT_RULES, ROSTER, P, GEO));
  }

  const mark = s.log.length;
  // 帧描述「这一季开始时的局面 + 这一季下的令」，故在结算前采。
  // 混战有多个模型席位，seat 那一块只能给一席——这里给**第一席**，
  // 其余各家的意图仍在 Markdown 实录里逐季写着
  const first = [...seatOf.keys()][0];
  const firstRec = done.find((d) => d.f === first)?.out.record;
  const frame = IDX ? captureFrame(s, IDX, G, P, ROSTER, GEO, orders, {
    seat: first, picks: firstRec?.picks ?? [],
    dropped: (firstRec?.admission?.dropped ?? []).map((d) => [d.key, d.reason]),
    reason: firstRec?.reason ?? null, plan: plans.get(first) ?? null,
    prevStations, prevCaptured,
  }) : null;
  if (IDX) { prevStations = { ...s.stations }; prevCaptured = [...(s.capturedOfficers ?? [])]; }
  const r = resolve(s, orders, G, P, ROSTER, GEO);
  if (frame) { attachOutcome(frame, r.state.log.slice(mark), IDX.fi); frames.push(frame); }
  const fresh = r.state.log.slice(mark);
  say(`### 本季天下`);
  say("");
  // 只报模型席位相关与大事：全场一季上百条，全铺出来读不动
  const BIG = new Set(["siege-win", "eliminated", "submitted", "unified", "officer-captured"]);
  const rows = fresh.filter((e) => BIG.has(e.kind) || (e.faction && seatOf.has(e.faction)));
  for (const e of rows.slice(0, 40)) {
    say(`- ${e.faction ? `**${nameOf(e.faction)}**：` : ""}`
      + String(e.text).replace(/[a-z][a-z0-9_]*/g, (m) => NAME[m] ?? m));
  }
  if (rows.length > 40) say(`- …另 ${rows.length - 40} 条`);

  s = r.state.finished ? r.state : refreshAp(r.state, P);
  const cnt = new Map();
  for (const c of Object.values(s.commanderies)) {
    if (c.owner) cnt.set(c.owner, (cnt.get(c.owner) ?? 0) + 1);
  }
  const rank = [...cnt].sort((a, b) => b[1] - a[1]);
  say("");
  say(`**排名**\u3000` + rank.slice(0, 8).map(([id, n], i) =>
    `${i + 1}. ${seatOf.has(id) ? `**${nameOf(id)}**` : nameOf(id)} ${n}`).join("\u3000"));
  since = r.state.log.length;
  const total = [...spent.values()].reduce((a, b) => a + b, 0);
  if (BUDGET && total >= BUDGET) {
    say(`\n> ⚠ 累计 $${total.toFixed(4)} 达到预算，实录到此为止`);
    break;
  }
}

// ── 终局 ──
say(`\n---\n`);
say(`## 终局`);
say("");
const cnt = new Map();
for (const c of Object.values(s.commanderies)) {
  if (c.owner) cnt.set(c.owner, (cnt.get(c.owner) ?? 0) + 1);
}
say(`| 席位 | 模型 | 开局郡 | 终局郡 | 控州 | 档位 | 分 | 调用 | 实扣 |`);
say(`|---|---|---|---|---|---|---|---|---|`);
const rows = [...seatOf.keys()].sort((a, b) => (cnt.get(b) ?? 0) - (cnt.get(a) ?? 0));
for (const f of rows) {
  const fs_ = s.factions[f];
  const st = standingOf(s, GEO, f);
  say(`| ${nameOf(f)}${s.winner === f ? " 🏆" : ""} | \`${seatOf.get(f)}\``
    + ` | ${fs_.startCommanderies} | **${cnt.get(f) ?? 0}** | ${st.controlledZhou}`
    + ` | ${GRADE_CN[fs_.bestGrade]} | ${GRADE_SCORE[fs_.bestGrade]}`
    + ` | ${calls.get(f) ?? 0} | $${(spent.get(f) ?? 0).toFixed(4)} |`);
}
// 机器人里最强的一家作参照——没有它就不知道模型到底强在哪
const botTop = [...cnt].filter(([id]) => !seatOf.has(id)).sort((a, b) => b[1] - a[1])[0];
if (botTop) {
  const fs_ = s.factions[botTop[0]];
  say(`| ${nameOf(botTop[0])}（机器人）| — | ${fs_.startCommanderies} | ${botTop[1]}`
    + ` | ${standingOf(s, GEO, botTop[0]).controlledZhou} | ${GRADE_CN[fs_.bestGrade]}`
    + ` | ${GRADE_SCORE[fs_.bestGrade]} | — | — |`);
}
say("");
say(s.winner ? `**${nameOf(s.winner)} 一统天下**（第 ${s.turn}/${SEASONS} 季）`
  : `打满 ${SEASONS} 季，无人一统`);

const sum = (k) => meta.reduce((a, m) => a + (m[k] ?? 0), 0);
say(`\n---\n`);
say(`## 游戏外元数据`);
say("");
say(`> 与游戏内发生的事无关，是「我们花了多少代价」的账。`);
say("");
say(`| 模型 | 调用 | 入参 | 缓存 | 出参 | 推理 | 实扣 | 单季用时中位 |`);
say(`|---|---|---|---|---|---|---|---|`);
for (const [seat, model] of seatOf) {
  const mine = meta.filter((m) => m.seat === seat);
  if (!mine.length) continue;
  const ms = mine.map((m) => m.ms).sort((a, b) => a - b);
  const S = (k) => mine.reduce((a, m) => a + (m[k] ?? 0), 0);
  say(`| \`${model}\` | ${mine.length} | ${fmt(S("prompt"))} | ${fmt(S("cached"))}`
    + ` | ${fmt(S("completion"))} | ${fmt(S("reasoning"))}`
    + ` | $${(spent.get(seat) ?? 0).toFixed(4)} | ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)}s |`);
}
say("");
say(`合计实扣 $${[...spent.values()].reduce((a, b) => a + b, 0).toFixed(4)}`
  + `\u3000总调用 ${meta.length} 次\u3000入参 ${fmt(sum("prompt"))} tok`);
say("");
say(`> git \`${(() => {
  try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { return "?"; }
})()}\`\u3000${new Date().toISOString()}`);

if (REPLAY && IDX) {
  fs.writeFileSync(REPLAY, JSON.stringify({
    version: REPLAY_VERSION,
    meta: { seed: SEED, seasons: SEASONS,
            seat: [...seatOf.keys()][0], seatName: nameOf([...seatOf.keys()][0]),
            seats: Object.fromEntries(seatOf),
            agent: "melee", reasoning: REASONING,
            packVersion: pack.version, promptVersion: PROMPT_VERSION,
            winner: s.winner ?? null, finished: s.finished },
    dict: IDX.dict, frames,
  }));
  console.error(`→ ${REPLAY}\u3000${frames.length} 帧\u3000`
    + `${(fs.statSync(REPLAY).size / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(OUT, lines.join("\n") + "\n");
fs.writeFileSync(OUT.replace(/\.md$/, "") + "-元数据.json", JSON.stringify({
  seed: SEED, seasons: SEASONS, seats: Object.fromEntries(seatOf),
  promptVersion: PROMPT_VERSION, packVersion: pack.version,
  winner: s.winner, perCall: meta,
}, null, 1));
console.error(`\n→ ${OUT}`);
