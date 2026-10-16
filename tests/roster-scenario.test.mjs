// 名册与剧本的对账。
//
// 武将的归属写在 officers.json 的 affiliation194 里——字段名就带着年份，
// 因为它记的是**兴平元年**谁在谁手下。加第二个剧本时这一点没人提醒：
// 建安五年里吕布、袁术、公孙瓒、刘繇、王朗、陆康、李傕、张济、张杨、孔融
// 都已不在，而程普、韩当、黄盖、吕范、孙贲连同**孙策本人**仍挂在袁术名下，
// 张辽臧霸挂在吕布名下，贾诩钟繇挂在李傕名下——实测 77 人无主，
// 孙策那一家开局一个武将都没有。
//
// 引擎不会报错：buildRoster 把归属不明的人按籍贯落位或留作待命，
// 于是这个洞只表现为「江东开局很弱」，而没有任何东西说得出为什么。
// 这条闸钉的是：**某剧本里可登场的武将，其归属要么为空，要么指向该剧本确实存在的势力。**
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const scenarios = fs.readdirSync("lib/game/data")
  .map((f) => /^scenario-(\d+)\.json$/.exec(f))
  .filter(Boolean)
  .map((m) => ({ year: m[1], data: JSON.parse(fs.readFileSync(`lib/game/data/${m[0]}`, "utf8")) }));

const officers = JSON.parse(fs.readFileSync("lib/game/data/officers.json", "utf8"));

// 解析规则与 tools/build-runtime-bundle.mjs 共用一份
const { affiliationIn } = await import("../tools/lib/officer-slice.mjs");
const affiliationOf = (o, year) => affiliationIn(o, year);

for (const { year, data } of scenarios) {
  const live = new Set(data.factions.map((f) => f.id));
  const avail = JSON.parse(
    fs.readFileSync(`lib/game/data/officer-availability-${year}.json`, "utf8"));
  const ok = new Set(avail.officers.filter((x) => x.available).map((x) => x.id));

  test(`名册×剧本 ${year}：可登场武将的归属不得指向该剧本没有的势力`, () => {
    const bad = new Map();
    for (const o of officers) {
      if (!ok.has(o.id)) continue;
      const f = affiliationOf(o, year);
      if (!f || live.has(f)) continue;
      if (!bad.has(f)) bad.set(f, []);
      bad.get(f).push(o.name);
    }
    const lines = [...bad].map(([f, names]) =>
      `  ${f}（${names.length} 人）：${names.slice(0, 10).join("、")}${names.length > 10 ? "…" : ""}`);
    assert.deepEqual(lines, [],
      `\n${lines.join("\n")}\n  这些势力在 ${year} 剧本里不存在。`
      + `补 officers.json 的 affiliation${year}，并写明依据——`
      + "归属是「此人本年在谁手下」，换了年份就要重判");
  });

  test(`名册×剧本 ${year}：每家有地的势力都该有人`, () => {
    const owners = new Set(Object.values(data.ownership).map((o) => o.factionId));
    const has = new Set();
    for (const o of officers) {
      if (!ok.has(o.id)) continue;
      const f = affiliationOf(o, year);
      if (f) has.add(f);
    }
    // 无主不是势力；异族诸部史料本就不记名姓，不强求
    const EXEMPT = new Set(["wuzhu", "xianbei", "wuhuan", "xiongnu", "qianghu", "nanzhongyi"]);
    const empty = [...owners].filter((f) => f && !EXEMPT.has(f) && !has.has(f));
    assert.deepEqual(empty, [],
      `这些势力在 ${year} 剧本里有地而无一人：${empty.join("、")}`
      + " —— 开局没有武将，等于没有统兵上限、没有太守加成，是个哑的席位");
  });
}

// ── 纪年也要跟着剧本 ────────────────────────────────────────────────
//
// 实测漏过一次：createGame 的 year 默认写死 194，而所有工具都不传。
// 后果不只是战报上的字——observe() 把 year 放进观测（clock.year），
// 于是模型执建安五年的席位却被告知现在是 194 年，而它据此判断谁该在场、
// 哪些事已经发生。match-log 的实录头当时就印着「194 年·春」。
test("剧本×纪年：开局年份取自剧本，不是写死的 194", async () => {
  const { createGame } = await import("../lib/game/engine/setup.ts");
  const { buildGraph } = await import("../lib/game/engine/actions.ts");
  const { buildGeography } = await import("../lib/game/engine/victory.ts");
  const { loadParams } = await import("../lib/game/engine/params.ts");
  const { observe } = await import("../lib/game/engine/observe.ts");
  for (const f of fs.readdirSync("public/game")) {
    const m = /^runtime-(\d+)\.json$/.exec(f);
    if (!m) continue;
    const b = JSON.parse(fs.readFileSync(`public/game/${f}`, "utf8"));
    const P = loadParams(b.pack), g = buildGraph(b.adjacency);
    const geo = buildGeography(b.commanderies, b.provinceSeats);
    const s = createGame(b, { seed: "year", geo, graph: g, seasons: 16, endCondition: "season-limit" }, P);
    assert.equal(s.year, b.scenario.meta.year,
      `${f}：开局纪年是 ${s.year}，而剧本写的是 ${b.scenario.meta.year}`);
    // 观测里那一份也要对——模型读的是它，不是 GameState
    const seat = Object.values(s.commanderies).find((c) => c.owner)?.owner;
    const o = observe(s, seat, g, P, null, geo, {});
    assert.equal(o.clock.year, b.scenario.meta.year,
      `${f}：观测里的纪年是 ${o.clock.year}，模型会据此判断谁该在场`);
  }
});
