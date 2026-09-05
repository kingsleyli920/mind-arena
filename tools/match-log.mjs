// 对局实录：把一整局逐季摊开写，看得见「模型看到什么、想了什么、下了什么令、
// 结果如何、天下如何变」。
//
// 与 eval-run.mjs 的分工：那个是给排行榜用的，跑几十局、只落结构化指标；
// 这个只跑一局，产出给人读的实录。两者共用同一套席位逻辑（modelDecide）
// 与同一个引擎——实录里看到的每个数都是对局里真实发生的，不是复述。
//
// 席位默认**随机抽**，不手动指定：指定席位等于替对局方挑了难度，
// 而开局强弱是这个剧本里最大的分数来源。抽签用 seed，同 seed 同签。
//
// 用法：
//   npm run match -- --agent=bot:balanced --seasons=32          ← 不花钱，验管道
//   npm run match -- --model=z-ai/glm-5.3-flash --seasons=32
//   npm run match -- --model=... --pick3                        ← 抽三家让你挑
//   npm run match -- --model=... --seat=yuanshao                ← 指定（不推荐）
import fs from "node:fs";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { buildGraph, listActions, DEFAULT_RULES } from "../lib/game/engine/actions.ts";
import { decide, PROFILES } from "../lib/game/engine/bot.ts";
import { buildRoster, stationedAt, isFiller } from "../lib/game/engine/officers.ts";
import { loadParams } from "../lib/game/engine/params.ts";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve, supplyReach } from "../lib/game/engine/resolve.ts";
import { buildGeography, standingOf, epochLimitFor, GRADE_CN }
  from "../lib/game/engine/victory.ts";
import { visibleLog } from "../lib/game/engine/intel.ts";
import { buildIndex, captureFrame, attachOutcome, REPLAY_VERSION }
  from "../lib/game/replay.ts";
import { admit } from "../lib/arena/seat/admit.ts";
import { modelDecide } from "../lib/arena/seat/model-seat.ts";
import { OpenRouterClient } from "../lib/arena/llm/client.ts";
import { GRADE_SCORE } from "../lib/arena/scoring.ts";
import { PROMPT_VERSION } from "../lib/arena/seat/prompt.ts";
import { roll } from "../lib/game/engine/rng.ts";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const has = (k) => process.argv.includes(`--${k}`);

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
const LORE = Object.fromEntries(DATA.scenario.factions.map((f) => [f.id, f.situation ?? ""]));
const nameOf = (id) => NAME[id] ?? id;
/**
 * 战报里的势力 id 换成人话。
 *
 * 引擎的日志文本里存的是 id（`与 liubei 缔盟`），界面另有一层翻译；
 * 实录若直接抄原文，读者看到的就是半中半英。翻译放在**呈现层**而不是引擎里：
 * 日志要能被机器按 id 检索，人话是给人看的那一层的事
 */
const cn = (t) => String(t).replace(/[a-z][a-z0-9_]*/g, (m) => NAME[m] ?? m);

const SEED = arg("seed", `match-${Math.floor(Date.now() / 1000)}`);
const SEASONS = Number(arg("seasons", "32"));
const MODEL = arg("model", "");
const AGENT = MODEL ? "model" : arg("agent", "bot:balanced");
const REASONING = arg("reasoning", "low");
const OUT = arg("out", `实录-${SEED}.md`);
const BUDGET = Number(arg("budget", "0")) || 0;
/** --full：候选全文、引擎逐项算式、全场原始日志。默认开——实录本来就是要细 */
const FULL = !has("brief");
/** --provider=Parasail,Fireworks：钉住提供方。同一模型跳提供方会让结果不可比 */
const PROVIDER = arg("provider", "");
/** --replay=<路径>：同时落一份逐季录像 JSON，供网页播放器逐季回看。
 *  实录（Markdown）是给人读的散文，录像是给播放器读的结构化局面——
 *  引擎每季算出来的东西此前只有前一个出口 */
const REPLAY = arg("replay", "");
/** 其余势力的机器人画像。与 eval-run 同一份轮换口径 */
const BOT_PROFILES = ["turtle", "balanced", "aggressive", "opportunist"];
const SEATS_ROT = ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu"];

// ── 抽签：席位不手动指定 ────────────────────────────────────────────
//
// 可选席位限定在有名有姓的汉末群雄。塞外诸部（鲜卑、乌桓、南匈奴、羌胡）
// 与南中夷帅据的是名存实亡的边郡，产出极低、无路可扩，抽到等于抽到一张废签
const POOL = ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu",
  "liubei", "gongsunzan", "lijue", "sunce", "gongsundu", "shixie", "zhangyang",
  "zhanglu", "maten", "hansui", "kongrong", "wanglang", "liuyao", "luking"];
const probe = createGame(DATA, { seed: SEED, roster: ROSTER, geo: GEO, seasons: SEASONS }, P);
const playable = POOL.filter((id) => probe.factions[id] && !probe.factions[id].eliminated);

function drawSeat(n) {
  // 用同一套确定性随机源抽签：同 seed 同签，实录因此可复现
  const scored = playable
    .map((id, i) => ({ id, r: roll({ seed: SEED, year: 0, season: 0, faction: "-", event: "draw", seq: i }) }))
    .sort((a, b) => a.r - b.r);
  return scored.slice(0, n).map((x) => x.id);
}

let SEAT = arg("seat", "");
let drawn = [];
if (!SEAT) {
  drawn = drawSeat(has("pick3") ? 3 : 1);
  SEAT = drawn[0];
}

const lines = [];
const say = (t = "") => { lines.push(t); console.log(t); };
const fmt = (n) => n.toLocaleString("en-US");
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
const SEASON_CN = ["", "春", "夏", "秋", "冬"];

/** 该势力此刻的家底 */
function snapshot(s, f) {
  const mine = Object.values(s.commanderies).filter((c) => c.owner === f);
  const st = standingOf(s, GEO, f);
  return {
    n: mine.length, zhou: st.controlledZhou, seats: st.zhouSeats,
    troops: mine.reduce((a, c) => a + c.garrison, 0)
      + s.armies.filter((a) => a.faction === f).reduce((a, x) => a + x.troops, 0),
    gold: Math.round(s.factions[f].gold),
    yieldSum: mine.reduce((a, c) => a + c.yieldTier, 0),
    morale: mine.length ? mine.reduce((a, c) => a + c.moraleTier, 0) / mine.length : 0,
    armies: s.armies.filter((a) => a.faction === f).length,
    grade: s.factions[f].bestGrade, mine,
  };
}

/** 天下格局：各家郡数排行 */
function world(s) {
  const cnt = new Map();
  for (const c of Object.values(s.commanderies)) {
    if (c.owner) cnt.set(c.owner, (cnt.get(c.owner) ?? 0) + 1);
  }
  const rank = [...cnt].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const live = Object.values(s.factions).filter((f) => !f.eliminated && !f.retired).length;
  const neutral = Object.values(s.commanderies).filter((c) => !c.owner).length;
  return { rank, live, neutral, cnt };
}

async function main() {
  if (drawn.length > 1) {
    say(`## 抽签\n`);
    for (const id of drawn) {
      const st = standingOf(probe, GEO, id);
      const f = probe.factions[id];
      say(`- **${nameOf(id)}**\u3000${f.startCommanderies} 郡 · ${st.controlledZhou} 州 · 州治 ${st.zhouSeats}\u3000治 ${f.capital ?? "无"}`);
      if (LORE[id]) say(`  > ${LORE[id]}`);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((r) => rl.question(`\n选哪一家？（1-${drawn.length}，回车取第一个）`, r));
    rl.close();
    const i = Number(ans.trim()) - 1;
    SEAT = drawn[Number.isInteger(i) && i >= 0 && i < drawn.length ? i : 0];
    say("");
  }

  const client = MODEL ? new OpenRouterClient(process.env.OPENROUTER_API_KEY, { title: "match-log" }) : null;
  if (MODEL && !process.env.OPENROUTER_API_KEY) {
    console.error("需要 OPENROUTER_API_KEY。npm run match 已带 --env-file-if-exists=.env.local");
    process.exit(2);
  }
  const deps = client && { client, model: MODEL, pack, g: G, P, roster: ROSTER, geo: GEO,
    nameOf, reasoning: { effort: REASONING },
    ...(PROVIDER ? { provider: { order: PROVIDER.split(","), allow_fallbacks: false } } : {}) };

  let s = createGame(DATA, { seed: SEED, roster: ROSTER, geo: GEO, seasons: SEASONS }, P);
  const f0 = s.factions[SEAT];
  const st0 = standingOf(s, GEO, SEAT);

  say(`# 对局实录\u3000${nameOf(SEAT)}`);
  say("");
  say(`| | |`);
  say(`|---|---|`);
  say(`| 对局方 | ${MODEL ? `模型 \`${MODEL}\`（推理档 ${REASONING}）` : AGENT} |`);
  say(`| 席位 | **${nameOf(SEAT)}**${drawn.length ? `\u3000（${drawn.length > 1 ? "三选一" : "随机抽签"}，候选 ${drawn.map(nameOf).join("、")}）` : "\u3000（手动指定）"} |`);
  say(`| 局长 | ${SEASONS} 季（${Math.round(SEASONS / 4)} 年） |`);
  say(`| 随机种子 | \`${SEED}\` |`);
  say(`| 开局 | ${f0.startCommanderies} 郡 · ${st0.controlledZhou} 州 · 州治 ${st0.zhouSeats}\u3000治 ${f0.capital ?? "无"} |`);
  say(`| 胜负 | 先控 ${P.unifyZhou} 州者一统天下；打满则按相对开局的增量定档 |`);
  say(`| 提示词 | v${PROMPT_VERSION}\u3000内容包 v${pack.version} |`);
  say("");
  if (LORE[SEAT]) say(`> **本年局势**\u3000${LORE[SEAT]}`);
  say("");

  let since = 0, plan = null, spentUsd = 0, calls = 0, halted = null;
  // ── 游戏外元数据 ────────────────────────────────────────────────
  // 与游戏内信息分开记：token 与钱不是这一局里发生的事，
  // 它们是「我们花了多少代价去问模型」的账，两者混在一起谁也看不清
  const meta = [];
  let prev = snapshot(s, SEAT);
  const gained = [];   // 逐季净增，用来说趋势

  // 录像索引。郡序取 commanderies.json 原序（= territory-grid 的 order），
  // 不能用 Object.keys(s.commanderies)——后者是插入序，一旦分家疆域整体错位
  const IDX = REPLAY ? buildIndex(
    DATA.commanderies,
    DATA.scenario.factions.map((f) => ({ id: f.id, name: f.name, color: f.color })),
    ["scale", "crane", "square"],
    read("adjacency.json").edges,
  ) : null;
  const frames = [];
  let prevStations = {};
  let prevCaptured = [];

  while (!s.finished) {
    const turn = s.turn;
    const before = snapshot(s, SEAT);
    const w0 = world(s);
    const cands = listActions(s, SEAT, G, P, DEFAULT_RULES, ROSTER, nameOf, GEO);
    const byType = new Map();
    for (const c of cands) {
      const k = c.key.split(":")[0];
      byType.set(k, (byType.get(k) ?? 0) + 1);
    }
    const winnable = cands.filter((c) => c.forecast?.verdict === "破城").length;

    say(`\n---\n`);
    say(`## 第 ${turn + 1}/${SEASONS} 季\u3000${s.year} 年 · ${SEASON_CN[s.season]}\u3000纪元 ${s.epoch}/${P.epochCount}`
      + `（至多再 ${Math.max(0, epochLimitFor(s, P) - (s.turn - s.epochStart))} 季推进；无主郡国城防每季 +${P.neutralWall[s.epoch] ?? 0}，至多 ${P.neutralWallCap}${s.epoch < P.epochCount ? `，推进后每季 +${P.neutralWall[s.epoch + 1] ?? 0}` : ""}）`);
    say("");
    // ── 我方家底 ──
    say(`### 我方`);
    say("");
    const dn = before.n - prev.n, dt = before.troops - prev.troops, dg = before.gold - prev.gold;
    say(`**${nameOf(SEAT)}**\u3000${before.n} 郡（${sign(dn)}）\u3000控 ${before.zhou} 州\u3000州治 ${before.seats}`
      + `\u3000兵 ${fmt(before.troops)}（${sign(dt)}）\u3000国库 ${fmt(before.gold)} 金（${sign(dg)}）`
      + `\u3000令 ${s.factions[SEAT].ap}\u3000现档 ${GRADE_CN[before.grade]}`);
    say("");
    if (before.mine.length) {
      // 断供单列一栏：产出归零、以此为后方的军团粮尽溃散，
      // 而它在逐郡数字里看不出来。一份实录里袁术五郡断了四郡、
      // 刚集结的两千人当季溃散，正是从这一栏缺失开始的
      const reach = supplyReach(s, G, SEAT);
      const cut = before.mine.filter((c) => !reach.has(c.id)).length;
      say(`| 郡国 | 兵 | 产 | 心 | 防 | 阵 | 械 | 供 | 驻将 |`);
      say(`|---|---|---|---|---|---|---|---|---|`);
      for (const c of before.mine.slice(0, 20)) {
        const offs = ROSTER ? stationedAt(s, ROSTER, c.id).filter((o) => !isFiller(o)).map((o) => o.name) : [];
        say(`| ${c.id} | ${fmt(c.garrison)} | ${c.yieldTier} | ${c.moraleTier} | ${c.defense}`
          + ` | ${c.formation === "scale" ? "鱼鳞" : c.formation === "wings" ? "鹤翼" : "方圆"}`
          + ` | ${c.gear === "none" ? "—" : c.gear === "ram" ? "冲车" : "土山"}`
          + ` | ${reach.has(c.id) ? "通" : "**断**"}`
          + ` | ${offs.length ? offs.slice(0, 4).join("、") : "—"} |`);
      }
      if (before.mine.length > 20) say(`| …另 ${before.mine.length - 20} 郡 | | | | | | | | |`);
      if (cut) {
        say("");
        say(`> ⚠ **${cut} 郡补给断绝**：本季产出归零，以其为后方的军团粮尽溃散。`
          + `补给自治所 ${s.factions[SEAT].capital ?? "（已失）"} 起算。`);
      }
      say("");
    }
    for (const a of s.armies.filter((a) => a.faction === SEAT)) {
      say(`- 在外军团 \`${a.id}\`：${fmt(a.troops)} 人，驻 ${a.at}`
        + `${a.target ? `，围 ${a.target}（第 ${a.siegeSeasons} 季）` : "，待命"}`);
    }

    // ── 候选 ──
    say("");
    say(`### 摆在面前的选择`);
    say("");
    say(`候选 ${cands.length} 条：`
      + [...byType].sort().map(([k, v]) => `${({ campaign: "征伐", relief: "赴援", withdraw: "撤围", muster: "集结", govern: "内政", array: "改阵", submit: "劝降", suade: "招降", appoint: "调任", scout: "刺探", ally: "外交", passage: "借道", retire: "归隐" })[k] ?? k} ${v}`).join("\u3000")
      + `\u3000｜其中预告可破城的 **${winnable}** 条`);
    if (FULL) {
      // 候选全文。只报类型计数等于把「它面前摆的是什么」抹掉了——
      // 而模型的每一条令都只能从这里选，这就是它的全部选项
      say("");
      say(`<details><summary>候选全文 ${cands.length} 条</summary>\n`);
      for (const c of cands) {
        say(`- \`${c.key}\`（耗 ${c.cost} 令）${c.label}`
          + (c.forecast ? `\n  - 预告：${c.forecast.text}` : "")
          + (c.field ? `\n  - 野战：${c.field.text}（${c.field.verdict}）` : ""));
      }
      say(`\n</details>`);
    }

    // ── 决策 ──
    say("");
    say(`### 决策`);
    say("");
    let picks = [], reason = "", rec = null, t0 = Date.now();
    if (deps) {
      const out = await modelDecide(s, SEAT, since, deps, plan);
      rec = out.record;
      picks = rec.picks ?? [];
      reason = rec.reason ?? "";
      if (rec.plan) plan = rec.plan;
      if (typeof rec.usage?.cost === "number") spentUsd += rec.usage.cost;
      calls += 1;
      say(`\`${MODEL}\`\u3000用时 ${(rec.elapsedMs / 1000).toFixed(1)}s`
        + `\u3000入 ${fmt(rec.usage?.prompt ?? 0)} tok（缓存 ${fmt(rec.usage?.cached ?? 0)}）`
        + `\u3000出 ${fmt(rec.usage?.completion ?? 0)}（推理 ${fmt(rec.usage?.reasoning ?? 0)}）`
        + `\u3000档位 ${rec.rung ?? "—"}\u3000尝试 ${rec.attempts}`
        + `${rec.usage?.cost != null ? `\u3000$${rec.usage.cost.toFixed(4)}` : ""}`);
      if (rec.failure) say(`\n> ⚠ **本季无回应**（${rec.failureKind}）：${rec.failure}`);
      meta.push({
        turn: turn + 1, ms: rec.elapsedMs,
        prompt: rec.usage?.prompt ?? 0, cached: rec.usage?.cached ?? 0,
        completion: rec.usage?.completion ?? 0, reasoning: rec.usage?.reasoning ?? 0,
        cost: rec.usage?.cost ?? null, rung: rec.rung, attempts: rec.attempts,
        maxTokens: rec.maxTokens, finish: rec.finishReason,
        provider: rec.provider, generationId: rec.generationId,
        picks: rec.picks?.length ?? 0, admitted: 0, spent: 0, illegalRate: 0,
        failure: rec.failure ?? null, failureKind: rec.failureKind ?? null,
      });
    } else {
      const variant = AGENT.split(":")[1] ?? "balanced";
      if (!PROFILES[variant]) { console.error(`未知画像 ${variant}`); process.exit(2); }
      const orders = decide(s, SEAT, G, variant, DEFAULT_RULES, ROSTER, P, GEO);
      // 机器人直接给命令，反查成 key 以便与模型同一套呈现
      picks = orders.map((o) => cands.find((c) =>
        JSON.stringify(c.action) === JSON.stringify(o.action))?.key).filter(Boolean);
      reason = `机器人画像 ${variant}`;
      say(`机器人 \`${AGENT}\`\u3000用时 ${Date.now() - t0}ms`);
    }
    if (plan) say(`\n**跨季方略**\u3000${plan}`);
    if (reason) say(`\n**本季意图**\u3000${reason}`);

    const adm = admit(s, SEAT, picks, cands, G, ROSTER);
    if (meta.length && meta[meta.length - 1].turn === turn + 1) {
      Object.assign(meta[meta.length - 1], { admitted: adm.admitted.length,
        spent: adm.spent, ap: s.factions[SEAT].ap, illegalRate: adm.illegalRate,
        candidates: cands.length, winnable });
    }
    say("");
    say(`挑 ${picks.length} 条，采纳 ${adm.admitted.length} 条，耗 ${adm.spent}/${s.factions[SEAT].ap} 令`
      + `${adm.dropped.length ? `，丢弃 ${adm.dropped.length} 条` : ""}`);
    say("");
    const labelOf = (k) => cands.find((c) => c.key === k)?.label ?? k;
    let i = 1;
    for (const k of adm.admitted) say(`${i++}. ✓ ${labelOf(k)}`);
    for (const d of adm.dropped) {
      const why = ({ "unknown-key": "候选表里没有这个 key", duplicate: "重复选取",
        "over-budget": "令数不够", rejected: "引擎校验不过" })[d.reason] ?? d.reason;
      say(`${i++}. ✗ ${labelOf(d.key)}\u3000—— ${why}${d.detail ? `（${d.detail}）` : ""}`);
    }

    // ── 结算 ──
    const mark = s.log.length;
    const trace = { faction: SEAT, lines: [] };
    const snapBefore = new Map(Object.values(s.commanderies)
      .filter((c) => c.owner === SEAT || (before.mine.some((m) => m.id === c.id)))
      .map((c) => [c.id, { ...c }]));
    // 录像帧描述的是「这一季开始时的局面 + 这一季下的令」，所以在结算**前**采；
    // 日志要结算后才有，结算完再补进这一帧
    // ── 其余三十家：确定性机器人 ──────────────────────────────────
    //
    // 此前**整个文件没有这一段**：resolve 只收到被观察席位的命令，
    // 其余三十家从头到尾一动不动。48 季实测零郡易主、全场命令 100% 出自本席——
    // 于是这份「详细实录」记录的是一个人对着冻结的棋盘自弈，
    // 而它正是用来看「模型到底怎么打」的那份材料。
    //
    // eval-run 与 melee 都有这一段，只有这里漏了。画像轮换与 eval-run 同口径，
    // 但**跳过被观察席位**——那一席的命令已经在 adm.orders 里
    const worldOrders = [];
    {
      const ids = Object.keys(s.factions).sort();
      for (const [i, f] of ids.entries()) {
        if (f === SEAT || s.factions[f].eliminated || s.factions[f].retired) continue;
        const si = SEATS_ROT.indexOf(f);
        worldOrders.push(...decide(s, f, G,
          si >= 0 ? BOT_PROFILES[si % BOT_PROFILES.length] : BOT_PROFILES[i % BOT_PROFILES.length],
          DEFAULT_RULES, ROSTER, P, GEO));
      }
    }
    const allOrders = [...adm.orders, ...worldOrders];

    const frame = IDX ? captureFrame(s, IDX, G, P, ROSTER, GEO, allOrders, {
      seats: [{ faction: SEAT, picks,
                dropped: adm.dropped.map((d) => [d.key, d.reason]),
                reason: reason || null, plan }],
      prevStations, prevCaptured,
    }) : null;
    if (IDX) {
      prevStations = { ...s.stations };
      prevCaptured = [...(s.capturedOfficers ?? [])];
    }
    const r = resolve(s, allOrders, G, P, ROSTER, GEO, DEFAULT_RULES, trace);
    const fresh = visibleLog(r.state, SEAT, mark);
    if (frame) {
      // 全场日志（不只我方可见的那一份）——播放器是上帝视角，不受迷雾限制
      attachOutcome(frame, r.state.log.slice(mark), IDX.fi);
      frames.push(frame);
    }
    say("");
    say(`### 本季结算`);
    say("");
    const mineLog = fresh.filter((e) => e.faction === SEAT);
    if (!mineLog.length) say(`（我方无事）`);
    for (const e of mineLog) {
      say(`- ${cn(e.text)}`
        + (e.attribution ? `\u3000\`${Object.entries(e.attribution).map(([k, v]) => `${k} ${v}`).join("\u3000")}\`` : ""));
    }
    if (FULL && trace.lines.length) {
      say("");
      say(`<details><summary>引擎逐项算式 ${trace.lines.length} 条</summary>\n`);
      say("```");
      for (const l of trace.lines) say(l);
      say("```");
      say(`\n</details>`);
    }
    // 逐郡 before → after：哪一格变了、变了多少。这是「到底发生了什么」
    // 最直接的答案，不依赖任何一方的复述
    const after0 = Object.values(r.state.commanderies).filter((c) => c.owner === SEAT);
    const diffs = [];
    const F = [["garrison", "兵"], ["yieldTier", "产"], ["moraleTier", "心"],
      ["defense", "防"], ["gear", "械"], ["formation", "阵"], ["owner", "属"]];
    for (const c of after0) {
      const b = snapBefore.get(c.id);
      if (!b) { diffs.push(`+ **${c.id}** 新入我手（原属 ${nameOf(snapBefore.get(c.id)?.owner ?? "无主")}）`); continue; }
      const ch = F.map(([k, cn2]) => (b[k] !== c[k]
        ? `${cn2} ${b[k]}→${c[k]}${typeof b[k] === "number" ? `（${sign(c[k] - b[k])}）` : ""}` : null))
        .filter(Boolean);
      if (ch.length) diffs.push(`· ${c.id}\u3000${ch.join("\u3000")}`);
    }
    for (const id of snapBefore.keys()) {
      if (!after0.some((c) => c.id === id)) {
        diffs.push(`− **${id}** 已失（现属 ${nameOf(r.state.commanderies[id]?.owner ?? "无主")}）`);
      }
    }
    if (diffs.length) {
      say("");
      say(`**逐郡变化**`);
      say("");
      for (const d of diffs) say(d);
    }
    const worldLog = fresh.filter((e) => e.faction !== SEAT);
    if (worldLog.length) {
      say("");
      say(`<details><summary>天下大事 ${worldLog.length} 条</summary>\n`);
      for (const e of worldLog.slice(0, 40)) {
        say(`- ${e.faction ? `**${nameOf(e.faction)}**：` : ""}${cn(e.text)}`);
      }
      if (worldLog.length > 40) say(`- …另 ${worldLog.length - 40} 条`);
      say(`\n</details>`);
    }

    // ── 局势 ──
    s = r.state.finished ? r.state : refreshAp(r.state, P);
    const after = snapshot(s, SEAT);
    const w1 = world(s);
    gained.push(after.n - before.n);
    const recent = gained.slice(-6);
    const trend = recent.reduce((a, b) => a + b, 0);
    say("");
    say(`### 天下`);
    say("");
    say(w1.rank.slice(0, 8).map(([id, n], idx) => {
      const was = w0.cnt.get(id) ?? 0;
      const d = n - was;
      return `${idx + 1}. ${id === SEAT ? `**${nameOf(id)}**` : nameOf(id)} ${n}${d ? `（${sign(d)}）` : ""}`;
    }).join("\u3000"));
    say("");
    say(`存活 ${w1.live} 家\u3000无主 ${w1.neutral} 郡`
      + `\u3000｜我方近 ${recent.length} 季净 ${sign(trend)} 郡`
      + `\u3000${trend > 0 ? "扩张中" : trend < 0 ? "**收缩中**" : "僵持"}`
      + `\u3000｜距升档：${after.zhou > before.zhou || after.n > before.n ? "本季有进展" : "无变化"}`);

    since = r.state.log.length;
    prev = after;
    if (BUDGET && spentUsd >= BUDGET) { halted = `累计 $${spentUsd.toFixed(4)} 达到预算`; break; }
  }

  // ── 终局 ──
  const fin = snapshot(s, SEAT);
  const w = world(s);
  say(`\n---\n`);
  say(`## 终局`);
  say("");
  const win = s.winner === SEAT;
  say(win ? `### 一统天下`
    : s.winner ? `### 天下归${nameOf(s.winner)}`
    : s.factions[SEAT].eliminated ? `### 覆灭` : `### 打满 ${SEASONS} 季`);
  say("");
  say(`| | 开局 | 终局 |`);
  say(`|---|---|---|`);
  say(`| 郡国 | ${f0.startCommanderies} | **${fin.n}** |`);
  say(`| 控制州 | ${st0.controlledZhou} | **${fin.zhou}** |`);
  say(`| 州治 | ${st0.zhouSeats} | ${fin.seats} |`);
  say(`| 兵力 | — | ${fmt(fin.troops)} |`);
  say(`| 夺自他方 | 0 | ${s.factions[SEAT].conquests} 郡 |`);
  say("");
  say(`**${GRADE_CN[fin.grade]} 档\u3000${GRADE_SCORE[fin.grade]} 分**`
    + `\u3000天下第 ${w.rank.findIndex(([id]) => id === SEAT) + 1 || "—"}/${w.rank.length}`);
  if (halted) say(`\n> ⚠ ${halted}，实录到此为止`);
  // ── 游戏外元数据 ──────────────────────────────────────────────
  if (meta.length) {
    const sum = (k) => meta.reduce((a, m) => a + (m[k] ?? 0), 0);
    const ms = meta.map((m) => m.ms).sort((a, b) => a - b);
    const mid = ms[Math.floor(ms.length / 2)] ?? 0;
    const rungs = {};
    for (const m of meta) rungs[m.rung ?? "失败"] = (rungs[m.rung ?? "失败"] ?? 0) + 1;
    const fails = {};
    for (const m of meta) if (m.failureKind) fails[m.failureKind] = (fails[m.failureKind] ?? 0) + 1;
    say(`\n---\n`);
    say(`## 游戏外元数据`);
    say("");
    say(`> 以下与游戏内发生的事无关，是「我们花了多少代价去问模型」的账。`);
    say("");
    say(`| | |`);
    say(`|---|---|`);
    say(`| 模型 | \`${MODEL}\`（推理档 ${REASONING}${PROVIDER ? `，钉住提供方 ${PROVIDER}` : "，提供方未钉住"}） |`);
    say(`| 提供方 | ${[...new Set(meta.map((m) => m.provider).filter(Boolean))].join("、") || "—"} |`);
    say(`| 调用次数 | ${calls}（每季一次） |`);
    say(`| 入参 token | ${fmt(sum("prompt"))}\u3000其中命中缓存 ${fmt(sum("cached"))}（${(sum("cached") / Math.max(1, sum("prompt")) * 100).toFixed(0)}%） |`);
    say(`| 出参 token | ${fmt(sum("completion"))}\u3000其中推理 ${fmt(sum("reasoning"))} |`);
    say(`| **实扣** | **$${spentUsd.toFixed(4)}**\u3000单季均 $${(spentUsd / Math.max(1, calls)).toFixed(5)} |`);
    say(`| 用时 | 合计 ${(sum("ms") / 1000 / 60).toFixed(1)} 分\u3000单季中位 ${(mid / 1000).toFixed(1)}s\u3000最慢 ${(Math.max(...ms) / 1000).toFixed(1)}s |`);
    say(`| 降级档位 | ${Object.entries(rungs).map(([k, v]) => `${k}×${v}`).join("\u3000")} |`);
    say(`| 失败 | ${Object.keys(fails).length ? Object.entries(fails).map(([k, v]) => `${k}×${v}`).join("\u3000") : "无"} |`);
    say(`| 出参预算翻倍 | ${meta.filter((m) => m.maxTokens > 8000).length} 季 |`);
    say(`| 非法率 | ${(meta.reduce((a, m) => a + (m.illegalRate ?? 0), 0) / Math.max(1, meta.length) * 100).toFixed(1)}% |`);
    say(`| 令数用率 | ${(meta.reduce((a, m) => a + (m.spent ?? 0), 0) / Math.max(1, meta.reduce((a, m) => a + (m.ap ?? 0), 0)) * 100).toFixed(0)}% |`);
    say("");
    say(`<details><summary>逐季元数据 ${meta.length} 行</summary>\n`);
    say(`| 季 | 用时s | 入参 | 缓存 | 出参 | 推理 | 实扣$ | 档位 | 尝试 | 候选 | 可破 | 挑 | 采纳 | 耗令 |`);
    say(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const m of meta) {
      say(`| ${m.turn} | ${(m.ms / 1000).toFixed(1)} | ${fmt(m.prompt)} | ${fmt(m.cached)}`
        + ` | ${fmt(m.completion)} | ${fmt(m.reasoning)} | ${m.cost != null ? m.cost.toFixed(5) : "—"}`
        + ` | ${m.rung ?? "失败"} | ${m.attempts} | ${m.candidates ?? "—"} | ${m.winnable ?? "—"}`
        + ` | ${m.picks} | ${m.admitted} | ${m.spent}/${m.ap ?? "—"} |`);
    }
    say(`\n</details>`);
    fs.writeFileSync(OUT.replace(/\.md$/, "") + "-元数据.json", JSON.stringify({
      model: MODEL, reasoning: REASONING, seat: SEAT, seed: SEED, seasons: SEASONS,
      promptVersion: PROMPT_VERSION, packVersion: pack.version,
      totals: { calls, costUsd: +spentUsd.toFixed(6),
        prompt: sum("prompt"), cached: sum("cached"),
        completion: sum("completion"), reasoning: sum("reasoning"), ms: sum("ms") },
      perSeason: meta,
    }, null, 1));
  }
  say("");
  say(`> 生成于 ${new Date().toISOString()}\u3000git \`${(() => {
    try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { return "?"; }
  })()}\``);

  fs.writeFileSync(OUT, lines.join("\n") + "\n");
  console.error(`\n→ ${OUT}`);

  if (REPLAY && IDX) {
    fs.writeFileSync(REPLAY, JSON.stringify({
      version: REPLAY_VERSION,
      meta: { seed: SEED, seasons: SEASONS, seat: SEAT, seatName: nameOf(SEAT),
              agent: MODEL || AGENT, reasoning: MODEL ? REASONING : null,
              packVersion: pack.version, promptVersion: PROMPT_VERSION,
              winner: s.winner ?? null, finished: s.finished },
      dict: IDX.dict, frames,
    }));
    const kb = (fs.statSync(REPLAY).size / 1024).toFixed(0);
    console.error(`→ ${REPLAY}\u3000${frames.length} 帧\u3000${kb} KB`);

    // 天下一动不动的哨兵。此前整个文件不给其余三十家下令，
    // 48 季实测零郡易主、命令 100% 出自本席——而这份实录正是用来看
    // 「模型到底怎么打」的材料，等于让它对着冻结的棋盘自弈。
    // 静默失效的东西要有人吼一声，不然下次还是查不出来
    if (frames.length > 4) {
      const a = frames[0].own, z = frames[frames.length - 1].own;
      const flips = a.reduce((n, v, i) => n + (v !== z[i] ? 1 : 0), 0);
      const actors = new Set(frames.flatMap((f) => f.orders.map((o) => o[0]))).size;
      if (flips === 0 || actors < 2) {
        console.error(`\n⚠ 天下没动：${frames.length} 季里易主 ${flips} 郡、`
          + `下过令的势力只有 ${actors} 家。其余势力多半没被驱动——`
          + `这份实录记的是对着冻结棋盘的自弈，不能用。`);
      }
    }
  }
}

await main();
