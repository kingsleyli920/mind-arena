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
