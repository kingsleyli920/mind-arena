/**
 * 战争节奏的尺子。
 *
 * 由来：用户问「一个回合一个季度是不是太长了，出兵时间没法拆分」。量下来发现
 * 真正的毛病不是季度太长，是**出兵根本不占时间**——campaign 把军团瞬移到目标郡、
 * 当季就打；而唯一该占时间的围城形同虚设：451 次破城里 445 次是首攻即克，
 * 围城超过一季的破城一次都没有。
 *
 * 这把尺子量的就是那条时间轴：从集结、出征、首攻，到续围或撤围，各占几季、
 * 军团在每一段掉多少兵、掉在谁手里。改动行军与围城规则前后各跑一遍，
 * 「预期的实测变化」才是可证伪的。
 *
 *   node tools/war-tempo.mjs                    默认 6 局 × 40 季纯机器人
 *   node tools/war-tempo.mjs --games=12 --seasons=64
 *   node tools/war-tempo.mjs --json=out.json    另存原始样本，便于前后对比
 *   node tools/war-tempo.mjs --no-withdraw      对照：引擎不动，只拿掉机器人的撤围令
 *
 * --no-withdraw 这个对照是必须先跑的。围城活不过第二季，八成八是**机器人自己撤的**
 * （首攻已过、进入新一季的 162 支围城军里，143 支被自家撤围令收掉，撞兵微下限的
 * 只有 1 支，进入该季时兵力中位 1716、无一支低于 500）。撤围的打分是
 * 「权重 + 已围季数×2 + (余兵<3000 ? 4 : 0)」，从不问围城是不是快赢了——
 * 因为 forecastSiege 只算本季那一击。
 * 所以基线里的「首攻即克 99%」讲的是机器人的策略，不是引擎的性质。任何引擎改动
 * 都要先和这个对照差分，否则测出来的差异归不到因上去。
 */
import fs from "node:fs";
import { DEFAULT_RULES } from "../lib/game/engine/actions.ts";
import { decide } from "../lib/game/engine/bot.ts";
import { loadWorld } from "./lib/world.mjs";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
// 剧本由 SCENARIO 选（默认 194）。读的是运行时数据包，与浏览器同一份——
// 天子所在之郡与武将归属都在打包时按剧本年解析过，见 tools/lib/world.mjs
const WORLD = loadWorld();
const { P, G, ROSTER, GEO, DATA } = WORLD;
const BOTS = ["turtle", "balanced", "aggressive", "opportunist"];

const GAMES = Number(arg("games", "6"));
const SEASONS = Number(arg("seasons", "40"));
const NO_WITHDRAW = process.argv.includes("--no-withdraw");

/** 每支军团一条履历：出生、每季兵力、结局。按 id 跨季追踪 */
const lives = new Map();
const breachAfter = [], starve = [];   // 破城时「已围了几季」
const endReason = {};     // 军团结局计数
let campaigns = 0, musters = 0;
let firstFail = 0, longSiege = 0;

for (let gi = 0; gi < GAMES; gi += 1) {
  let s = createGame(DATA, { seed: `tempo-${gi}`, roster: ROSTER, geo: GEO, graph: G, seasons: SEASONS }, P);
  const seen = new Map();
  while (!s.finished) {
    let orders = [];
    for (const [i, f] of Object.keys(s.factions).sort().entries()) {
      if (s.factions[f].eliminated || s.factions[f].retired) continue;
      orders.push(...decide(s, f, G, BOTS[i % 4], DEFAULT_RULES, ROSTER, P, GEO));
    }
    if (NO_WITHDRAW) orders = orders.filter((o) => o.action?.type !== "withdraw");
    for (const o of orders) {
      if (o.action?.type === "muster") musters += 1;
      if (o.action?.type === "campaign") campaigns += 1;
    }
    // 结算前：记下每支军团此刻的兵力与围城季数，结算后才能算出这一季掉了多少
    const before = new Map(s.armies.map((a) => [a.id, { ...a }]));
    for (const a of s.armies) {
      if (!seen.has(a.id)) seen.set(a.id, { id: `${gi}:${a.id}`, born: s.turn, troops: [] });
      seen.get(a.id).troops.push(a.troops);
    }
    const mark = s.log.length;
    const r = resolve(s, orders, G, P, ROSTER, GEO, DEFAULT_RULES);

    for (const e of r.state.log.slice(mark)) {
      if (e.kind === "siege-starve") {
        // 粮尽开城也是「城拿下了」，且它正是围城时钟走完的那一种，
        // 不计进来这张表就只反映强攻
        const m = (e.text ?? "").match(/围 (\S+?) (\d+) 季/);
        if (m) starve.push(+m[2]);
      }
      if (e.kind === "siege-win") {
        const m = (e.text ?? "").match(/取 (\S+?)（/);
        const key = `${e.faction}|${m ? m[1] : ""}`;
        const army = [...before.values()].find((a) => `${a.faction}|${a.target}` === key);
        breachAfter.push(army ? army.siegeSeasons : 0);
      }
      // capital-lost-scatter 一定要在这张表里：实测它是**最大**的一项（对照跑里 252 次，
      // 比断粮溃散 193 和撤围 143 都多）。第一版漏了它，于是「军团都去哪了」这张表
      // 少了最大的一格，我据此说过好几句错话
      for (const [k, tag] of [["siege-lift", "撤围"], ["siege-abort", "粮尽撤围"],
                              ["muster-return", "归队"], ["supply-cut-scatter", "断粮溃散"],
                              ["capital-lost-scatter", "治所失守溃散"],
                              ["supply-cut-low", "存粮告急"], ["capital-lost-low", "治所失守·尚有粮"],
                              ["siege-starve", "围到粮尽·开城"],
                              ["siege-win", "强攻破城"]]) {
        if (e.kind === k) endReason[tag] = (endReason[tag] ?? 0) + 1;
      }
    }
    // 首攻那一击发生在结算内部：季初它还是待命军团，季末要么破了城不存在了、
    // 要么已经 siegeSeasons=1。所以「首攻」这一段季初季末都看不到，得在这里数
    for (const a of r.state.armies) {
      if (!a.target) continue;
      if (a.siegeSeasons === 1) firstFail += 1;        // 首攻未克，转入围困
      else if (a.siegeSeasons >= 2) longSiege += 1;    // 围过两季以上
    }
    // 军团这一季的兵力变化，按「在不在围城」分开记
    const after = new Map(r.state.armies.map((a) => [a.id, a]));
    for (const [id, b] of before) {
      const a = after.get(id);
      if (!a) continue;
      const rec = seen.get(id);
      if (!rec) continue;
      (rec.legs ??= []).push({ from: b.troops, to: a.troops,
                               siegeSeasons: b.siegeSeasons, besieging: !!b.target });
    }
    s = r.state.finished ? r.state : refreshAp(r.state, P);
  }
  for (const [, v] of seen) lives.set(v.id, v);
}

const q = (a, p) => { const x = [...a].sort((m, n) => m - n); return x.length ? x[Math.min(x.length - 1, Math.floor(x.length * p))] : NaN; };
const pct = (n, d) => (d ? `${(n / d * 100).toFixed(0)}%` : "—");
const line = (t) => console.log(t);

line(`\n══ 战争节奏　${GAMES} 局 × ${SEASONS} 季　纯机器人${NO_WITHDRAW ? "　【对照：拿掉撤围令】" : ""} ══\n`);
line(`下令　集结 ${musters}　出征 ${campaigns}`);

line(`\n── 破城要几季 ──`);
const hist = {};
for (const v of breachAfter) hist[v] = (hist[v] ?? 0) + 1;
line(`  破城 ${breachAfter.length} 次，破城时已围季数 ${JSON.stringify(hist)}`);
line(`  首攻即克 ${pct(breachAfter.filter((v) => v === 0).length, breachAfter.length)}`
   + `　中位 ${q(breachAfter, 0.5)}　九分位 ${q(breachAfter, 0.9)}`);
// 这三个数才是「围城活没活过来」的判据：
// 首攻未克之后还站在城下的有多少、其中撑到第二季以上的有多少
{ const h = {}; for (const v of starve) h[v] = (h[v] ?? 0) + 1;
  line(`  围到粮尽开城 ${starve.length} 次，用了几季 ${JSON.stringify(h)}`
     + `　占拿下的城 ${pct(starve.length, starve.length + breachAfter.length)}`); }
line(`  首攻未克转入围困 ${firstFail} 次　（占出征 ${pct(firstFail, campaigns)}）`);
line(`  围过两季以上　　 ${longSiege} 次　（占转入围困 ${pct(longSiege, firstFail)}）`);

line(`\n── 军团结局 ──`);
for (const [k, v] of Object.entries(endReason).sort((a, b) => b[1] - a[1])) line(`  ${k.padEnd(10)} ${v}`);

line(`\n── 一季掉多少兵 ──`);
const legs = [...lives.values()].flatMap((v) => v.legs ?? []);
const loss = (l) => (l.from > 0 ? 1 - l.to / l.from : 0);
for (const [tag, sel] of [
  ["续围（围城季 ≥1）", (l) => l.besieging && l.siegeSeasons >= 1],
  ["待命（未出征）", (l) => !l.besieging],
]) {
  const g = legs.filter(sel);
  if (!g.length) { line(`  ${tag.padEnd(20)} 无样本`); continue; }
  line(`  ${tag.padEnd(20)} 样本 ${String(g.length).padStart(5)}`
     + `　季损中位 ${(q(g.map(loss), 0.5) * 100).toFixed(0)}%`
     + `　九分位 ${(q(g.map(loss), 0.9) * 100).toFixed(0)}%`
     + `　起始兵力中位 ${q(g.map((l) => l.from), 0.5)}`);
}

line(`\n── 军团活多久 ──`);
const spans = [...lives.values()].map((v) => v.troops.length);
line(`  军团 ${lives.size} 支，在图上存续季数：中位 ${q(spans, 0.5)}　九分位 ${q(spans, 0.9)}　最长 ${Math.max(0, ...spans)}`);
const peak = [...lives.values()].map((v) => Math.max(...v.troops));
const last = [...lives.values()].map((v) => v.troops[v.troops.length - 1]);
line(`  峰值兵力中位 ${q(peak, 0.5)}　终值兵力中位 ${q(last, 0.5)}`);
line(`  从峰值掉到 500 以下的军团：${pct(last.filter((v) => v < 500).length, last.length)}\n`);

// ── 行军这一半 ────────────────────────────────────────────────────────
// 出兵现在不占时间，但要给它定价就得先知道「一步有多远」。
// adjacency.json 早就备好了：cost 是地形加权距离，meta.costUnit 写明
// 「1 = 100km 平原」，meta.terrainCost 给了各地形系数
// （plain 1 · hill 1.35 · river 1.8 · mountain 2.1 · gate 2.6）。
// 别另造一套系数——关隘在已有数据里是 2.6，仅次于山地，凭直觉多半会猜低。
const adjacency = WORLD.B.adjacency;
const DAY_PER_COST = 100 / 12.5;   // 汉军常态行军日三十里≈12.5km，一个 cost 单位=100km 平原
const SEASON_DAYS = 90;
const marched = adjacency.edges.map((e) => ({ ...e, days: e.cost * DAY_PER_COST }));
line(`── 一步有多远（按 adjacency 的 cost，日三十里）──`);
line(`  邻郡边 ${marched.length} 条　行军日：中位 ${q(marched.map((e) => e.days), 0.5).toFixed(0)}`
   + `　九分位 ${q(marched.map((e) => e.days), 0.9).toFixed(0)}`
   + `　最长 ${Math.max(...marched.map((e) => e.days)).toFixed(0)}　（一季 ${SEASON_DAYS} 日）`);
for (const t of ["plain", "hill", "river", "mountain", "gate"]) {
  const g = marched.filter((e) => e.terrain === t).map((e) => e.days);
  if (!g.length) continue;
  line(`  ${t.padEnd(9)} 边 ${String(g.length).padStart(3)}`
     + `　中位 ${q(g, 0.5).toFixed(0).padStart(3)} 日`
     + `　九分位 ${q(g, 0.9).toFixed(0).padStart(3)}`
     + `　最长 ${Math.max(...g).toFixed(0).padStart(3)}`);
}
line(`  走不满一季（>${SEASON_DAYS} 日）的边：${marched.filter((e) => e.days > SEASON_DAYS).length} 条`);
line("");

const out = arg("json", "");
if (out) {
  fs.writeFileSync(out, JSON.stringify({ GAMES, SEASONS, breachAfter, endReason, legs, spans, peak, last }, null, 1));
  console.log(`→ ${out}`);
}
