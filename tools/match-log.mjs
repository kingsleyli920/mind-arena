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
import { resolve } from "../lib/game/engine/resolve.ts";
import { buildGeography, standingOf, GRADE_CN } from "../lib/game/engine/victory.ts";
import { observe } from "../lib/game/engine/observe.ts";
import { visibleLog } from "../lib/game/engine/intel.ts";
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
      say(`- **${nameOf(id)}**　${f.startCommanderies} 郡 · ${st.controlledZhou} 州 · 州治 ${st.zhouSeats}　治 ${f.capital ?? "无"}`);
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
    nameOf, reasoning: { effort: REASONING } };

  let s = createGame(DATA, { seed: SEED, roster: ROSTER, geo: GEO, seasons: SEASONS }, P);
  const f0 = s.factions[SEAT];
  const st0 = standingOf(s, GEO, SEAT);

  say(`# 对局实录　${nameOf(SEAT)}`);
  say("");
  say(`| | |`);
  say(`|---|---|`);
  say(`| 对局方 | ${MODEL ? `模型 \`${MODEL}\`（推理档 ${REASONING}）` : AGENT} |`);
  say(`| 席位 | **${nameOf(SEAT)}**${drawn.length ? `　（${drawn.length > 1 ? "三选一" : "随机抽签"}，候选 ${drawn.map(nameOf).join("、")}）` : "　（手动指定）"} |`);
  say(`| 局长 | ${SEASONS} 季（${Math.round(SEASONS / 4)} 年） |`);
  say(`| 随机种子 | \`${SEED}\` |`);
  say(`| 开局 | ${f0.startCommanderies} 郡 · ${st0.controlledZhou} 州 · 州治 ${st0.zhouSeats}　治 ${f0.capital ?? "无"} |`);
  say(`| 胜负 | 先控 ${P.unifyZhou} 州者一统天下；打满则按相对开局的增量定档 |`);
  say(`| 提示词 | v${PROMPT_VERSION}　内容包 v${pack.version} |`);
  say("");
  if (LORE[SEAT]) say(`> **本年局势**　${LORE[SEAT]}`);
  say("");

  let since = 0, plan = null, spentUsd = 0, calls = 0, halted = null;
  let prev = snapshot(s, SEAT);
  const gained = [];   // 逐季净增，用来说趋势

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
    say(`## 第 ${turn + 1}/${SEASONS} 季　${s.year} 年 · ${SEASON_CN[s.season]}　纪元 ${s.epoch}`);
    say("");
    // ── 我方家底 ──
    say(`### 我方`);
    say("");
    const dn = before.n - prev.n, dt = before.troops - prev.troops, dg = before.gold - prev.gold;
    say(`**${nameOf(SEAT)}**　${before.n} 郡（${sign(dn)}）　控 ${before.zhou} 州　州治 ${before.seats}`
      + `　兵 ${fmt(before.troops)}（${sign(dt)}）　国库 ${fmt(before.gold)} 金（${sign(dg)}）`
      + `　令 ${s.factions[SEAT].ap}　现档 ${GRADE_CN[before.grade]}`);
    say("");
    if (before.mine.length) {
      say(`| 郡国 | 兵 | 产 | 心 | 防 | 阵 | 械 | 驻将 |`);
      say(`|---|---|---|---|---|---|---|---|`);
      for (const c of before.mine.slice(0, 20)) {
        const offs = ROSTER ? stationedAt(s, ROSTER, c.id).filter((o) => !isFiller(o)).map((o) => o.name) : [];
        say(`| ${c.id} | ${fmt(c.garrison)} | ${c.yieldTier} | ${c.moraleTier} | ${c.defense}`
          + ` | ${c.formation === "scale" ? "鱼鳞" : c.formation === "wings" ? "鹤翼" : "方圆"}`
          + ` | ${c.gear === "none" ? "—" : c.gear === "ram" ? "冲车" : "土山"}`
          + ` | ${offs.length ? offs.slice(0, 4).join("、") : "—"} |`);
      }
      if (before.mine.length > 20) say(`| …另 ${before.mine.length - 20} 郡 | | | | | | | |`);
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
      + [...byType].sort().map(([k, v]) => `${({ campaign: "征伐", relief: "赴援", withdraw: "撤围", muster: "集结", govern: "内政", array: "改阵", submit: "劝降", suade: "招降", appoint: "调任", scout: "刺探", ally: "外交", passage: "借道", retire: "归隐" })[k] ?? k} ${v}`).join("　")
      + `　｜其中预告可破城的 **${winnable}** 条`);

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
      say(`\`${MODEL}\`　用时 ${(rec.elapsedMs / 1000).toFixed(1)}s`
        + `　入 ${fmt(rec.usage?.prompt ?? 0)} tok（缓存 ${fmt(rec.usage?.cached ?? 0)}）`
        + `　出 ${fmt(rec.usage?.completion ?? 0)}（推理 ${fmt(rec.usage?.reasoning ?? 0)}）`
        + `　档位 ${rec.rung ?? "—"}　尝试 ${rec.attempts}`
        + `${rec.usage?.cost != null ? `　$${rec.usage.cost.toFixed(4)}` : ""}`);
      if (rec.failure) say(`\n> ⚠ **本季无回应**（${rec.failureKind}）：${rec.failure}`);
    } else {
      const variant = AGENT.split(":")[1] ?? "balanced";
      if (!PROFILES[variant]) { console.error(`未知画像 ${variant}`); process.exit(2); }
      const orders = decide(s, SEAT, G, variant, DEFAULT_RULES, ROSTER, P, GEO);
      // 机器人直接给命令，反查成 key 以便与模型同一套呈现
      picks = orders.map((o) => cands.find((c) =>
        JSON.stringify(c.action) === JSON.stringify(o.action))?.key).filter(Boolean);
      reason = `机器人画像 ${variant}`;
      say(`机器人 \`${AGENT}\`　用时 ${Date.now() - t0}ms`);
    }
    if (plan) say(`\n**跨季方略**　${plan}`);
    if (reason) say(`\n**本季意图**　${reason}`);

    const adm = admit(s, SEAT, picks, cands, G, ROSTER);
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
      say(`${i++}. ✗ ${labelOf(d.key)}　—— ${why}${d.detail ? `（${d.detail}）` : ""}`);
    }

    // ── 结算 ──
    const mark = s.log.length;
    const r = resolve(s, adm.orders, G, P, ROSTER, GEO);
    const fresh = visibleLog(r.state, SEAT, mark);
    say("");
    say(`### 本季结算`);
    say("");
    const mineLog = fresh.filter((e) => e.faction === SEAT);
    if (!mineLog.length) say(`（我方无事）`);
    for (const e of mineLog) {
      say(`- ${cn(e.text)}`
        + (e.attribution ? `　\`${Object.entries(e.attribution).map(([k, v]) => `${k} ${v}`).join("　")}\`` : ""));
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
    }).join("　"));
    say("");
    say(`存活 ${w1.live} 家　无主 ${w1.neutral} 郡`
      + `　｜我方近 ${recent.length} 季净 ${sign(trend)} 郡`
      + `　${trend > 0 ? "扩张中" : trend < 0 ? "**收缩中**" : "僵持"}`
      + `　｜距升档：${after.zhou > before.zhou || after.n > before.n ? "本季有进展" : "无变化"}`);

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
  say(`**${GRADE_CN[fin.grade]} 档　${GRADE_SCORE[fin.grade]} 分**`
    + `　天下第 ${w.rank.findIndex(([id]) => id === SEAT) + 1 || "—"}/${w.rank.length}`);
  if (halted) say(`\n> ⚠ ${halted}，实录到此为止`);
  if (calls) {
    say("");
    say(`模型调用 ${calls} 次，实扣 $${spentUsd.toFixed(4)}`);
  }
  say("");
  say(`> 生成于 ${new Date().toISOString()}　git \`${(() => {
    try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { return "?"; }
  })()}\``);

  fs.writeFileSync(OUT, lines.join("\n") + "\n");
  console.error(`\n→ ${OUT}`);
}

await main();
