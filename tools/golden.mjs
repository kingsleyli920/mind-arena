// 金样回放：把**模型看到的那一面**逐字节钉住。
//
// 为什么要这个工具，而不是靠现有的回归测试：
//
// 引擎里约有七百条中文碎片、九十五处语序拼接（见 docs/I18N-PLAN.md 第二节）。
// 阶段 3 要把它们迁进带命名参数的格式化层，而那一层出错的方式很特别——
// **榜还能跑、分还出得来、selfplay 四道闸照样过，只是模型读到的字变了**。
// 所有现有的闸量的都是数字与结局，没有一条量「它读到了什么」。
//
// 所以这里不比分数，只比文本，而且比的是模型真正读到的三样：
//
//   一、规则摘要（renderSystem）——同一内容包下逐字节相同的静态前缀
//   二、观测（observe → renderUser）——每季重算的局势
//   三、候选标签（listActions 的 label）——它按 key 挑的那张选择题
//
// 只取第一季不够：文本随局面变（围城、在外军团、断供、俘虏都会改写它）。
// 所以用机器人自对局推进若干季，在几个固定季取样。机器人是确定性的
//（bot.ts 开头写着「不含任何随机——同一 state 必得同一结果」），
// 所以同一 seed 跑出来逐字节可复现。
//
// 用法：
//   npm run golden            比对基线，不一致就列出第一处差异并退出 1
//   npm run golden -- --update  重写基线（**改了措辞之后才做，而且要在提交里说清楚**）
import fs from "node:fs";
import crypto from "node:crypto";
import { createGame, refreshAp } from "../lib/game/engine/setup.ts";
import { resolve } from "../lib/game/engine/resolve.ts";
import { decide } from "../lib/game/engine/bot.ts";
import { listActions, DEFAULT_RULES } from "../lib/game/engine/actions.ts";
import { observe } from "../lib/game/engine/observe.ts";
import { renderSystem, renderUser, PROMPT_VERSION } from "../lib/arena/seat/prompt.ts";
import { loadWorld } from "./lib/world.mjs";

const UPDATE = process.argv.includes("--update");
const BASELINE = "tests/golden/model-view.txt";
/**
 * 段标题的前缀。**不能用 `### `**——规则摘要本身就是 markdown，里面有 `###`，
 * 于是「数一数有几段」和「差异在哪一段」都会把摘要自己的小标题算进来。
 * 实测：35 段的文件数出 69 个 `###`。
 */
const MARK = "@@ ";

/** 取样的季。1 是开局（没有军团、没有俘虏），8 与 16 已经打起来了 */
const SAMPLE_TURNS = [1, 8, 16];
const SEASONS = 16;
/** 每个剧本取三席：最强、中等、最弱——它们的观测形状差得远 */
const SEATS = { 194: ["yuanshao", "caocao", "lubu"], 200: ["yuanshao", "caocao", "zhanglu"] };

/** 一局机器人自对局，在取样季把模型看到的东西抄下来 */
function sample(scenario) {
  const w = loadWorld(scenario);
  const s = createGame(w.B, {
    seed: `golden-${scenario}`, roster: w.ROSTER, geo: w.GEO, graph: w.G,
    seasons: SEASONS, endCondition: "season-limit",
  }, w.P);
  const out = [];
  // 规则摘要只随内容包变，不随局面变——取一次就够，但必须取
  out.push(`${MARK}${scenario} 规则摘要\n${renderSystem(w.pack)}`);
  let g = s;
  for (let turn = 1; turn <= SEASONS; turn += 1) {
    if (SAMPLE_TURNS.includes(turn)) {
      for (const seat of SEATS[scenario]) {
        if (!g.factions[seat] || g.factions[seat].eliminated) {
          out.push(`${MARK}${scenario} 第${turn}季 ${seat}\n（已出局）`);
          continue;
        }
        const o = observe(g, seat, w.G, w.P, w.ROSTER, w.GEO, {});
        out.push(`${MARK}${scenario} 第${turn}季 ${seat} 观测\n${renderUser(o)}`);
        const cands = listActions(g, seat, w.G, w.P, DEFAULT_RULES, w.ROSTER,
          (id) => w.NAME[id] ?? id, w.GEO);
        out.push(`${MARK}${scenario} 第${turn}季 ${seat} 候选 ${cands.length} 条\n`
          + cands.map((c) => `${c.key}\t${c.label}`).join("\n"));
      }
    }
    if (turn === SEASONS) break;
    // 全部席位由机器人下令，推进一季。resolve 返回新状态（它内部 clone），
    // 所以必须接住返回值——原地改是改不动的
    const orders = [];
    for (const f of Object.keys(g.factions)) {
      if (g.factions[f].eliminated || g.factions[f].retired) continue;
      orders.push(...decide(g, f, w.G, "purpose", DEFAULT_RULES, w.ROSTER, w.P, w.GEO));
    }
    g = refreshAp(resolve(g, orders, w.G, w.P, w.ROSTER, w.GEO).state, w.P);
    if (g.finished) break;
  }
  return out;
}

const parts = [];
for (const scenario of ["194", "200"]) parts.push(...sample(scenario));
// 版本戳进金样：改了提示词或内容包，基线本来就该变，而戳让「为什么变」一眼看得出
const body = `# 金样：模型看到的那一面\n`
  + `# 提示词 ${PROMPT_VERSION}\n`
  + `# 取样季 ${SAMPLE_TURNS.join("/")}（共 ${SEASONS} 季，机器人 purpose 自对局）\n\n`
  + parts.join("\n\n") + "\n";

if (UPDATE) {
  fs.mkdirSync("tests/golden", { recursive: true });
  fs.writeFileSync(BASELINE, body);
  const kb = (Buffer.byteLength(body) / 1024).toFixed(0);
  console.log(`基线已重写：${BASELINE}　${kb}KB　${parts.length} 段`);
  console.log(`  sha256 ${crypto.createHash("sha256").update(body).digest("hex").slice(0, 16)}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(`没有基线。先跑 npm run golden -- --update`);
  process.exit(2);
}
const want = fs.readFileSync(BASELINE, "utf8");
if (want === body) {
  console.log(`✓ 模型看到的那一面与基线逐字节相同　${parts.length} 段　`
    + `${(Buffer.byteLength(body) / 1024).toFixed(0)}KB`);
  process.exit(0);
}

// 不一致：指出**第一处**差异，并带上它所在的段标题。
// 只说「不一样」没用——这份东西有几百 KB，人要的是「哪一句变了」
const a = want.split("\n"), b = body.split("\n");
let i = 0;
while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
let head = "(段首未知)";
for (let j = i; j >= 0; j -= 1) if (b[j]?.startsWith(MARK)) { head = b[j]; break; }
console.error(`✗ 模型看到的那一面变了。第一处差异在第 ${i + 1} 行，${head}\n`);

/**
 * 长行只显示差异点前后一小段。
 *
 * 观测是**一整行 JSON**，一行一万五千字符。照原样打两行出来，失败信息就成了
 * 三万字符的墙，而人要的是「哪个字变了」。所以先找出行内第一个不同的字符，
 * 再各取前后六十字，并在下面标一个尖号。
 */
function windowAt(line, at) {
  const W = 60;
  const from = Math.max(0, at - W), to = Math.min(line.length, at + W);
  return (from > 0 ? "…" : "") + line.slice(from, to) + (to < line.length ? "…" : "");
}
const la = a[i] ?? "", lb = b[i] ?? "";
let k = 0;
while (k < la.length && k < lb.length && la[k] === lb[k]) k += 1;
if (la.length > 160 || lb.length > 160) {
  console.error(`  （这一行 ${Math.max(la.length, lb.length)} 字符，只显示第 ${k + 1} 字附近）`);
  console.error(`  基线：${windowAt(la, k)}`);
  console.error(`  现在：${windowAt(lb, k)}\n`);
} else {
  console.error(`  基线：${a[i] ?? "(没有这一行)"}`);
  console.error(`  现在：${b[i] ?? "(没有这一行)"}\n`);
}
console.error(`  行数 ${a.length} → ${b.length}`);
console.error(`  若这是有意的改动（改了措辞、升了提示词版本），跑 npm run golden -- --update，`);
console.error(`  并在提交里写清楚**模型读到的字变了哪一句**——这正是分数看不出来的那种改动。`);
process.exit(1);
