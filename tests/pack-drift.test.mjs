// 内容包的自洽：**动作说明里写的数，必须与 constants 里的数一致**。
//
// 规则摘要（toRulesDigest）是模型读到的唯一规则来源，而它把
// constants 与 actions[].summary 拼在一起。两处说的话一旦不一致，
// 模型收到的是自相矛盾的规则，且没有任何东西会报错。
//
// 实测撞到过两次：
//   scout 的说明停在「13 档等比 1.4」「±15% 点估计」，而 constants.情报
//         早已是 9 档 / 1.8 / ±8%（那次改动连理由都写进了 constants，
//         唯独没同步 summary）
//   appoint 的说明还写着「任武将为郡太守…一人只能守一郡」，而语义早已
//         改成调任，太守是派生的、调动要收令
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { toRulesDigest } from "../lib/game/content/schema.ts";

const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const C = pack.constants;
const sum = (id) => pack.actions.find((a) => a.id === id)?.summary ?? "";

test("包：刺探的说明与情报常数一致", () => {
  const s = sum("scout");
  const I = C["情报"];
  assert.ok(s.includes(`${I["档数"]} 档`), `说明里的档数与 constants 不符：${s}`);
  assert.ok(s.includes(String(I["档比"])), `说明里的档比与 constants 不符：${s}`);
  assert.ok(s.includes(`±${Math.round(I["误差比"] * 100)}%`),
    `说明里的误差与 constants 不符：${s}`);
  // 旧值不得残留
  for (const stale of ["13 档", "1.4", "±15%"]) {
    assert.ok(!s.includes(stale), `说明里残留旧值「${stale}」：${s}`);
  }
});

test("包：调任的说明与武将常数一致", () => {
  const s = sum("appoint");
  const W = C["武将"];
  assert.ok(s.includes(`${W["随军上限"]} 人`), `随军上限不符：${s}`);
  assert.ok(s.includes(String(W["每将统兵"])), `每将统兵不符：${s}`);
  // 旧语义不得残留
  for (const stale of ["一人只能守一郡", "任武将为郡太守"]) {
    assert.ok(!s.includes(stale), `说明里残留旧语义「${stale}」：${s}`);
  }
});

test("包：规则摘要的散文里不出现裸的内部枚举", () => {
  // 「- 参数」那几行是 id(中文标签) 成对给出的（none(无) / ram(冲车)），
  // 那不是缺陷：它告诉模型这个参数的取值域，且中文就在括号里。
  // 要挡的是**散文里出现裸 id**——那种地方读者拿不到对照，
  // 读到的就是半中半英的规则（此前候选标签就犯过：「平原」写成 plain）
  const prose = toRulesDigest(pack)
    .split("\n")
    .filter((l) => !l.startsWith("- 参数 "))
    .join("\n");
  for (const id of ["infantry", "cavalry", "crossbow", "navy", "ram", "mound",
                    "plain", "hill", "mountain", "river", "gate"]) {
    assert.ok(!new RegExp(`\\b${id}\\b`).test(prose),
      `规则摘要的散文里出现裸的内部枚举「${id}」`);
  }
});

test("包：界面读的运行时包必须与内容包同源", () => {
  // 界面不直接读 lib/game/content/pack-194.json，而是读
  // public/game/runtime-194.json —— 那是 tools/build-runtime-bundle.mjs 的产物。
  //
  // 这条挡的是一次真实事故：加完阵型后所有测试全绿、构建也过，
  // 一进浏览器却是「载入失败：内容包缺少 constants.阵型.克制加缺口」——
  // 引擎读新包，界面读的是几个月前打的旧包。
  // 凡是同一份数据存在第二份副本的，都要有一条测试把两份钉在一起
  //
  // 这条判据原先只钉了 pack 一份。包里其实还整份带着 scenario、commanderyState、
  // adjacency 等等，而「同一份数据存第二份副本」的毛病一视同仁——重排势力配色之后
  // 引擎和复盘页都换了新色，对局页却仍画着旧色，就是因为它读的是包里那份陈的 scenario。
  const runtime = JSON.parse(fs.readFileSync("public/game/runtime-194.json", "utf8"));
  const stale = "已过期 —— 跑 node tools/build-runtime-bundle.mjs";
  assert.deepEqual(runtime.pack, pack, `运行时包里的内容包${stale}`);
  for (const [key, file] of [
    ["scenario", "scenario-194.json"],
    ["commanderyState", "commandery-state.json"],
    ["adjacency", "adjacency.json"],
    ["troopTypes", "troop-types.json"],
    ["resources", "resources.json"],
    ["provinceSeats", "province-seats-194.json"],
  ]) {
    assert.deepEqual(runtime[key], JSON.parse(fs.readFileSync(`lib/game/data/${file}`, "utf8")),
      `运行时包里的 ${file} ${stale}`);
  }
  // commanderies 与 officers 是**裁过的**（全量 officers.json 有 1MB，玩家不该为看一局先下它），
  // 整份比不了，只钉住条数与主键
  assert.equal(runtime.commanderies.length,
    JSON.parse(fs.readFileSync("lib/game/data/commanderies.json", "utf8")).length,
    `运行时包里的郡国数${stale}`);
});

// ── 名册也要闸 ──────────────────────────────────────────────────────
//
// officers.json 的 historicalNote 里，编者会自己写下「本年未生」「本年尚幼」——
// 那是**否决证据**，而不是花絮。判定器原先只在「有归属」那一支认它，
// 「只有卒年」那一支单看卒年差值，于是曹真、公孙渊、傅肜、向宠、毛皇后、
// 敬哀皇后这些明写着本年未生的人照常进了 194 年名册，实测 13 人。
//
// 它们之所以没有更多，只因正始那一代卒于 249、距 194 年 55 年，
// 刚好越过「卒年差值 ≤50」那条线——**侥幸不是判据**。
// 这条闸钉的是「证据不得被忽略」，不是钉人数：加剧本时人数必然变，而这条不变。
test("名册：本传自记「本年未生／尚幼」的人不得入册", async () => {
  const { adultFrom } = await import("../tools/lib/officer-slice.mjs");
  const YEAR = 194;
  const full = JSON.parse(fs.readFileSync("lib/game/data/officers.json", "utf8"));
  const by = new Map(full.map((o) => [o.id, o]));
  const avail = JSON.parse(
    fs.readFileSync(`lib/game/data/officer-availability-${YEAR}.json`, "utf8"));
  const bad = [];
  for (const a of avail.officers) {
    if (!a.available) continue;
    const o = by.get(a.id);
    if (!o || o.birthYear) continue;          // 有生年则以生年为准，note 是次级证据
    const y = adultFrom(o.historicalNote);
    if (y && YEAR < y.from) bad.push(`${o.name}（${y.phrase}）`);
  }
  assert.deepEqual(bad, [],
    `这些人本传自记未成年，却在 ${YEAR} 年名册里：${bad.join("、")}`
    + " —— 见 tools/lib/officer-slice.mjs 的 adultFrom");
});

// 卒月也要闸：年初切片的剧本靠它才有颜良、文丑、沮授、淳于琼、孙策，
// 而写了 deathMonth 却没写出处，等于凭空给一个人续命
test("名册：卒年等于切片年而补了月份的，必须附出处", () => {
  const full = JSON.parse(fs.readFileSync("lib/game/data/officers.json", "utf8"));
  const bad = full.filter((o) => o.deathMonth != null
    && !(typeof o.deathMonthBasis === "string" && o.deathMonthBasis.length > 20));
  assert.deepEqual(bad.map((o) => o.name), [],
    "这些人有 deathMonth 而无 deathMonthBasis —— 推定的月份尤其要写明是推定");
  for (const o of full) {
    if (o.deathMonth == null) continue;
    assert.ok(o.deathYear != null, `${o.name} 有卒月而无卒年`);
    assert.ok(o.deathMonth >= 1 && o.deathMonth <= 12, `${o.name} 的卒月 ${o.deathMonth} 不在 1–12`);
  }
});

test("包：写给模型的数必须与引擎实际用的一致", () => {
  // 这条挡的是「规则摘要教模型一套、引擎跑另一套」。三处真实漂移：
  //   攻城节写「6 旬未破自动撤围」，而引擎读的是围城节的「上限季数 3」。
  //     六十日不足一季 —— 模型照它判会以为围城撑不过一季，
  //     于是每季重开强攻（2 令、折损 0.35）而不用增兵续围（0.12、缺口每季 +1）。
  //   情报节写「已探 ±15%」，而误差比是 0.08。
  //   scout 的效果许了产出与民心，引擎一次都没给 —— 而民心是劝降成功率的直接输入，
  //     模型会按「能探到民心」去分配每季仅有的三次免费刺探。
  const digest = toRulesDigest(pack);
  assert.ok(!/旬/.test(digest), "摘要里还留着以「旬」计的围城上限 —— 引擎按季算");
  // 测**摘要**而不是原始包：包里的「定档依据」会解释档宽是怎么定的
  //（提到未探的 ±28%、旧版的 ±17%/±15%），那些是设计说明，
  // 且键名含「依据」会被注解过滤器挡在摘要之外。模型读不到的东西不必测
  const err = Math.round(pack.constants.情报.误差比 * 100);
  for (const m of digest.matchAll(/±(\d+)%/g)) {
    assert.equal(Number(m[1]), err,
      `摘要里出现 ±${m[1]}%，而误差比是 ${err}% —— 模型会按错的带宽估敌情`);
  }
  const scout = pack.actions.find((a) => a.id === "scout");
  for (const bad of ["产出", "民心"]) {
    assert.ok(!scout.effects.some((e) => e.includes(bad) && !e.includes("不在")),
      `scout 的效果里许了「${bad}」，而引擎只给守军与阵型`);
  }
  // 纪元时限是随局长缩放的，包里那个数只是 16 季的默认值，必须说明
  assert.ok(pack.constants.时钟.纪元时限说明?.includes("epochLimitFor"),
    "纪元时限没写明它随局长缩放 —— 长局里这个数是错的");
});

// ── 势力配色 ─────────────────────────────────────────────────────────────
// 同属「两处说的话必须一致」这一类：配色的约束原先只写在注释里，
// 于是三十一家挤成一团也没有任何东西报错——用户在图上认出吕布和
// 李傕郭汜是同一种颜色，我才发现有 32 对势力 ΔE<18。判据挪进测试。
test("势力配色：任意两家可分，接壤的更要分得开", async () => {
  const { audit } = await import("../tools/check-palette.mjs");
  const sc = JSON.parse(fs.readFileSync("lib/game/data/scenario-194.json", "utf8"));
  const r = audit(Object.fromEntries(sc.factions.map((f) => [f.id, f.color])));
  assert.deepEqual(r.bad, [], `配色不达标：\n  ${r.bad.join("\n  ")}`);
});

// 渲染端不许再做「提纯」。历史上 PlayClient 与 replay 页各有一份 vivid()，
// 在渲染时统一拔高饱和度来救土色系配色。那是给数据层的毛病打渲染层的补丁：
// 提纯只能拉开已有的间距，造不出本来没有的间距，而且它不幂等——
// 连调两次会把饱和度推到上限，把刚排开的颜色重新挤到一起。
test("渲染端不得二次提纯势力色", () => {
  // 注释里可以提它（讲清为什么去掉了），代码里不行——先剥注释再查
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const f of ["app/play/PlayClient.tsx", "tools/build-replay-page.mjs"]) {
    const src = strip(fs.readFileSync(f, "utf8"));
    assert.equal(/vivid\s*\(/.test(src), false,
      `${f} 又出现了 vivid()：势力色应直接取 scenario 里的最终显示色`);
  }
});

// 散文里写死的**个数**是最容易漂的一类：加一档方针、加一种建筑，
// 而 summary 里那句「五个方针互斥」没人记得改。实测栽过一次（屯粮）
test("包：动作说明里写的档数，必须与实际档数一致", () => {
  const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  for (const a of pack.actions) {
    const tiers = a.params?.find((p) => p.tiers)?.tiers;
    if (!tiers) continue;
    // 「**后**四种须有物产」说的是后四种，不是总数——限定词要排掉
    const m = /(?<![后前另])(?<!其中)([零一二三四五六七八九十]+)\s*(个|种|档)(?!以)/.exec(a.summary ?? "");
    if (!m) continue;
    assert.equal(m[1], CN[tiers.length],
      `${a.id} 的说明写着「${m[0]}」，而实际有 ${tiers.length} 档`);
  }
});

// 预告与结算必须对着同一个「关隘」定义。此前 forecast 写 terrain === "gate"、
// resolve 写 edge.gates.length > 0，在当前数据上恰好完全重合（31 对 31），
// 所以谁都没发现——而 adjacency 是生成的，重建一次就可能分家，
// 那时预告会对着器械说谎（atGate 决定器械缺口要不要减半）
test("关隘：地形标记与关津节点必须一致，否则预告与结算会分家", () => {
  const adj = JSON.parse(fs.readFileSync("lib/game/data/adjacency.json", "utf8"));
  const bad = [];
  for (const e of adj.edges) {
    const byTerrain = e.terrain === "gate";
    const byNodes = (e.nodes ?? []).some((n) => n.kind === "gate" || n.kind === "pass");
    if (byTerrain !== byNodes) bad.push(`${e.from}→${e.to}（地形 ${e.terrain}，关津 ${byNodes}）`);
  }
  assert.deepEqual(bad, [],
    `这些边的地形标记与关津节点对不上：\n  ${bad.join("\n  ")}`);
});

// ── 冻结闸：胜负数值的指纹 ────────────────────────────────────────────
//
// 内容包 1.0.0 起冻结（见包里的 _frozen）。冻结的含义不是「不许改」，
// 是「改了必须知道自己在改，并且重跑基线」——两份 packVersion 不同的榜
// 不能并排读，而那件事在报告上看不出来，只有 stamp 里一行小字。
//
// 指纹只取**数字**，不取文字：常数分组里大半是说明与依据，改一句措辞
// 不该让这道闸响；而任何一个影响胜负判定的数一动，它必须响。
const { ruleFingerprint } = await import("../lib/game/content/fingerprint.ts");

test("冻结闸：胜负数值的指纹未变", () => {
  const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
  const fp = ruleFingerprint(pack);
  // 改规则数值时，把下面两行更新成新指纹，**同时**：
  //   一、升 pack.version（0.2.0 → 1.0.0 是冻结那一次）
  //   二、重跑机器人基线，并在 docs/EVAL.md 里说明新旧榜不可比
  const WANT = {"count":304,"hash":"g2hcrkrvytig"};
  assert.equal(fp.count, WANT.count,
    `胜负数值的条数变了（${WANT.count} → ${fp.count}）——加/删了一个数`);
  assert.equal(fp.hash, WANT.hash,
    "胜负数值变了。这不是禁止，是提醒：升 pack.version、重跑基线、"
    + "并在 EVAL 里写明新旧榜不可比。确认之后把本测试里的指纹更新掉");
  assert.equal(pack.version, "2.5.0", "冻结版本号");
  // 版本号升了、改动记载没跟上，是这套冻结流程最容易漏的一步——
  // 闸只钉了版本号与指纹，谁都不会注意到记载停在上一版。
  // 实测漏过一次：version 已是 2.3.0，而记载末尾还是 2.2.0，
  // 那一版改了什么只能回头从 docs/EVAL.md 里还原。
  const log = pack._frozen["改动记载"];
  assert.equal(log[log.length - 1]["版本"], pack.version,
    `改动记载末尾是 ${log[log.length - 1]["版本"]}，而 pack.version 是 ${pack.version}`
    + " —— 升版本必须同时记一条：改了什么、为什么、后果");
  // README 末尾那句「当前规则包 x.y.z」也会掉队，而它是**仓库首页**上的话。
  // 闸管得住包内（指纹、版本、记载三者互钉），管不到包外抄了一份版本号的地方。
  // 实测漏过一次：包已是 2.4.0，README 还写着 2.3.0，经历了两次升版都没人发现
  const readme = fs.readFileSync("README.md", "utf8");
  assert.ok(readme.includes(`当前规则包 ${pack.version}`),
    `README 没写着「当前规则包 ${pack.version}」——升版本时它也要跟着改`);
});

// ── 通行图也要冻 ────────────────────────────────────────────────────
//
// 规则指纹只盖规则包（constants / actions / victory / terrain / units / skills）。
// 但**改通行图一样是改规则**：一条边的地形档决定行军代价（平原 1.0 到关道 2.6）
// 与守方加成，多一条边就是多一条攻击路线。
//
// 实测过一次：把关津挂载半径从 45 km 放宽到 79 km，两条边成了关道、
// 一条被剪掉的长江渡口边回来了、三条边的地形从**回退公式编出来的** hill
// 改回**实测的** plain——游戏实打实地变了，而规则指纹纹丝不动。
// 那一次是有意为之且过了验收（ρ 0.37 不变、四道闸 4/4），但它不该悄悄发生。
test("通行图的形状被钉住", () => {
  const adj = JSON.parse(fs.readFileSync("lib/game/data/adjacency.json", "utf8"));
  const es = adj.edges;
  const hist = {};
  for (const e of es) hist[e.terrain] = (hist[e.terrain] ?? 0) + 1;
  const sig = createHash("sha256").update(JSON.stringify(
    es.map((e) => [e.from, e.to, e.terrain, e.cost]).sort())).digest("hex").slice(0, 12);

  assert.equal(es.length, 232, "边数");
  assert.deepEqual(hist, { mountain: 59, river: 43, plain: 69, gate: 29, hill: 32 },
    "各地形档的边数");
  assert.equal(sig, "1a47c8a48981",
    "通行图指纹（from/to/地形/代价）。改动了就更新这个值，"
    + "并且**必须先跑一遍 npm run selfplay**——四道闸与 ρ 都得过");
});

// ── 每个剧本的规则摘要里，朝廷只能有一个 ────────────────────────────
//
// 天子在哪个郡是**剧本事实**，由 tools/build-runtime-bundle.mjs 在打包时
// 按剧本改写进包。实测漏过一处：改写只覆盖了授官令的 preconditions[0]，
// 而 summary 里那句「须持朝廷（据京兆尹）」原样留着——于是建安五年的摘要
// 同时告诉模型「朝廷所在=颍川郡」和「须持朝廷（据京兆尹）」，两个郡。
//
// 模型读的是摘要。教它一套、引擎跑另一套，不会报错，只会让它一直去打错的郡。
test("剧本×摘要：授官令提到的朝廷所在只能是本剧本那一个", async () => {
  const names = new Set(JSON.parse(fs.readFileSync("lib/game/data/commanderies.json", "utf8"))
    .map((c) => c.name));
  for (const f of fs.readdirSync("public/game")) {
    const m = /^runtime-(\d+)\.json$/.exec(f);
    if (!m) continue;
    const b = JSON.parse(fs.readFileSync(`public/game/${f}`, "utf8"));
    const seat = b.pack.constants["名器"]["朝廷所在"];
    assert.ok(names.has(seat), `${f}：朝廷所在「${seat}」不是郡国`);
    assert.equal(seat, b.scenario.meta.courtSeat,
      `${f}：包里的朝廷所在与剧本申报的不一致`);
    const invest = b.pack.actions.find((a) => a.id === "invest");
    const text = [invest.summary, ...invest.preconditions, ...invest.effects].join("　");
    const mentioned = [...names].filter((n) => text.includes(n));
    assert.deepEqual(mentioned, [seat],
      `${f} 的授官令里提到了 ${mentioned.join("、")}，而本剧本的朝廷在 ${seat}`
      + " —— 模型会同时读到两个郡");
  }
});
