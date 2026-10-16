// 挑对局方用的普查：价、能不能上结构化输出、真实吞吐、该钉哪家提供方。
//
// 立这个工具是因为一次 28 倍的误判。用 `~deepseek/deepseek-v4-flash-latest`
// 跑烟测，一季 341 秒，我先以为是模型慢、提供方慢、被限流——查下来才知道
// 那个浮动别名被路由到了 DigitalOcean，**p50 吞吐 5 tok/s**；同一个模型在
// DeepInfra 上是 44，而 glm-5.3-flash 在 BaseTen 上是 139。
// 一季约 1500 出参 token：5 tok/s 是五分钟，139 tok/s 是十一秒。
//
// 默认路由不看吞吐。所以开榜之前要在这里挑，并用 --provider 钉住。
//
// 还要挑「有没有哪家支持 structured_outputs」：没有的话候选 key 的 enum
// 强制不上，整跑退到 text 档——那时测的是中文转写不是策略能力
//（实测非法率 0.7% → 8.6%、unknown-key 0 → 47，见 docs/EVAL.md）。
//
// 用法：
//   npm run models                    # 国产便宜档，48 局 ≤$2.5
//   npm run models -- --max=1.5       # 只看更便宜的
//   npm run models -- --all           # 不限产地
//   npm run models -- --id=z-ai/glm-5.3-flash   # 单看一个模型的各家提供方
//
// 只读价目与端点统计，不发推理请求，不花钱。
const arg = (k, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const has = (k) => process.argv.slice(2).includes(`--${k}`);

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("没有 OPENROUTER_API_KEY。走 `npm run models`——脚本自己读 .env.local");
  process.exit(2);
}
const H = { authorization: `Bearer ${key}` };
const MAX = Number(arg("max", "2.5"));
const ONE = arg("id", "");

// 一局的实测口径：入约 96k tok、出约 8k tok（含推理）；
// 提供方自报的实扣约为价目表的 2 倍，故乘 2 留余量。与 eval-suite 同一套系数。
//
// **这一列对推理吃得凶的模型会低估一个数量级，而它看不出来。**
// 实测：deepseek/deepseek-v4.1-flash 这里报 48 局 $0.84，而六局实扣 $2.038
// ——折合 48 局约 $16，差二十倍。原因是它每次调用烧约 1.4 万推理 token，
// 一局出参 24 万，是上面那个 8k 假设的三十倍。推理用量既不在价目表里，
// 也不在端点统计里，事前无从得知。
// 所以：**这一列只能当下限读**，真要开榜先用 `--max-usd` 设一道事中的闸
//（见 tools/eval-run.mjs），或者先跑两局看实扣再外推。
const PER_GAME_IN = 96_000, PER_GAME_OUT = 8_000, MARKUP = 2, GAMES = 48;
const cost48 = (p) => (PER_GAME_IN * +p.prompt + PER_GAME_OUT * +p.completion) * MARKUP * GAMES;

/** 产地。按 OpenRouter 的作者前缀认，够用 */
const CN = /^(qwen|deepseek|z-ai|moonshotai|minimax|baidu|tencent|inclusionai|stepfun|01-ai|thudm)\//;

const pad = (s, n) => String(s).padEnd(n - (String(s).match(/[一-鿿]/g)?.length ?? 0));
const tp = (e) => e.throughput_last_30m?.p50 ?? 0;
const lat = (e) => (e.latency_last_30m?.p50 ?? 0) / 1000;
const structured = (e) => (e.supported_parameters ?? []).includes("structured_outputs");

async function endpoints(id) {
  const r = await fetch(`https://openrouter.ai/api/v1/models/${id.replace(/^~/, "")}/endpoints`, { headers: H });
  if (!r.ok) return [];
  return (await r.json())?.data?.endpoints ?? [];
}

// ── 单个模型：把各家提供方摊开 ──────────────────────────────────────
if (ONE) {
  const eps = await endpoints(ONE);
  if (!eps.length) {
    console.log(`${ONE}：查不到端点。浮动别名（~作者/型号-latest）通常如此——`
      + "\n  而别名正是路由到慢提供方的常见来源，开榜请用确定的 model id");
    process.exit(0);
  }
  console.log(`\n${ONE}　${eps.length} 家提供方\n`);
  console.log(pad("提供方", 18) + "吞吐p50  首字p50   1日可用  结构化  量化");
  for (const e of eps.sort((a, b) => tp(b) - tp(a))) {
    console.log(pad(e.provider_name, 18)
      + `${String(Math.round(tp(e))).padStart(5)} t/s`
      + `${lat(e).toFixed(1).padStart(7)}s`
      + `${String(Math.round(e.uptime_last_1d ?? 0)).padStart(8)}%`
      + `${structured(e) ? "     ✓" : "     ✗"}`
      + `   ${e.quantization ?? "—"}`);
  }
  const best = eps.filter(structured).sort((a, b) => tp(b) - tp(a))[0];
  if (best) console.log(`\n开榜请钉住：--provider=${best.provider_name}\n`);
  else console.log("\n⚠ 没有一家支持结构化输出——这个模型只能在 text 档评，读分要按另一把尺\n");
  process.exit(0);
}

// ── 全表 ────────────────────────────────────────────────────────────
const list = await (await fetch("https://openrouter.ai/api/v1/models?output_modalities=text", { headers: H })).json();
const cands = list.data
  .filter((m) => (has("all") || CN.test(m.id)) && m.pricing?.prompt)
  .map((m) => ({ id: m.id, c: cost48(m.pricing) }))
  .filter((m) => m.c > 0 && m.c <= MAX)
  .sort((a, b) => a.c - b.c);

console.log(`\n${has("all") ? "全部" : "国产"}、48 局 ≤$${MAX} 的候选 ${cands.length} 个，逐个查端点…`);
const rows = [];
const noStruct = [];
// 串行查：这是个开榜前跑一次的工具，没必要为了几秒去压人家的接口
for (const m of cands) {
  const eps = await endpoints(m.id);
  const ok = eps.filter(structured);
  if (!eps.length) continue;
  if (!ok.length) { noStruct.push(m.id); continue; }
  const best = ok.sort((a, b) => tp(b) - tp(a))[0];
  rows.push({ ...m, p: best.provider_name, tp: tp(best), lat: lat(best),
              up: best.uptime_last_1d ?? 0, n: ok.length });
}
rows.sort((a, b) => b.tp - a.tp);

console.log(`\n${pad("模型", 34)}48局    钉这家          吞吐p50  首字  1日可用  能上结构化`);
for (const r of rows.slice(0, 20)) {
  console.log(pad(r.id, 34) + `$${r.c.toFixed(2)}`.padStart(6)
    + "  " + pad(r.p, 15) + `${String(Math.round(r.tp)).padStart(5)} t/s`
    + `${r.lat.toFixed(1).padStart(6)}s` + `${String(Math.round(r.up)).padStart(8)}%`
    + `${String(r.n).padStart(7)} 家`);
}
// 一季约 1500 出参 token（含推理）。这一列是「值不值得等」的那一列
console.log(`\n吞吐折成工期（一季约 1500 出参 tok，一局 16 季，48 局按 4 路并发）：`);
for (const r of rows.slice(0, 5)) {
  const perSeason = 1500 / Math.max(1, r.tp) + r.lat;
  console.log(`  ${pad(r.id, 34)}一季 ${perSeason.toFixed(0)}s　一局 ${(perSeason * 16 / 60).toFixed(0)}分`
    + `　48 局约 ${(perSeason * 16 * 48 / 4 / 3600).toFixed(1)} 小时`);
}
if (noStruct.length) {
  console.log(`\n没有任何提供方支持结构化输出（只能在 text 档评，读分要按另一把尺）：`);
  console.log(`  ${noStruct.slice(0, 12).join("　")}${noStruct.length > 12 ? ` …共 ${noStruct.length} 个` : ""}`);
}
console.log("");
