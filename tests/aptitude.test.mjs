// 适性：既参与结算，又要显示。
//
// 它们在 officers.json 里是中文字符串，引擎里直接拿字面量比
//（`o.aptitudes.includes("攻城")`）。没有全集，就没人拦得住数据里写错一个字：
// 「守成」之于「守城」不会报错，只会让那个武将的加成**永远不触发**，
// 而他在名册上、在候选标签上、在战报里都一切正常。
//
// docs/I18N-PLAN.md 阶段 0 的第三项（「既是逻辑又是显示」的值拆成 id + 显示名）。
// 注意 **id 仍然是中文**，这是有意的：I18N-PLAN 第三节写明候选 key 与观测都要留在
// 中文，换了语言则新旧榜不可比。拆的是「显示名」这一层，不是把 id 改成英文。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { APTITUDES, APT, APTITUDE_CN, TERRAIN_APTITUDE, hasApt }
  from "../lib/game/engine/aptitude.ts";

const officers = JSON.parse(fs.readFileSync("lib/game/data/officers.json", "utf8"));
const used = new Map();
for (const o of officers) {
  for (const a of o.aptitudes ?? []) used.set(a, (used.get(a) ?? 0) + 1);
}

test("适性：数据里没有全集之外的值", () => {
  const unknown = [...used.keys()].filter((a) => !APTITUDES.includes(a));
  assert.deepEqual(unknown, [],
    `officers.json 里有引擎不认的适性：${unknown.join("、")}——`
    + "这种值不报错，只是那个武将的加成永远不触发。要么是错别字，要么要在 "
    + "lib/game/engine/aptitude.ts 的 APTITUDES 里加上它");
});

test("适性：全集里的每一个都真的有人带", () => {
  // 反方向：引擎认得而数据里一个都没有，多半是改名时漏了一边
  const orphan = APTITUDES.filter((a) => !used.has(a));
  assert.deepEqual(orphan, [],
    `这些适性引擎认得，而 808 名武将里一个都没有：${orphan.join("、")}`);
});

test("适性：各自有多少人带（数据口径的留底）", () => {
  // 不是判对错，是钉住分布：哪天考订改了名册，这里会提醒有多少人受影响
  assert.deepEqual(Object.fromEntries([...used].sort()), {
    "山地": 136, "攻城": 32, "水战": 46, "治民": 67, "守城": 44, "说客": 50,
  });
});

test("适性：说客在引擎里一处逻辑都没有", () => {
  // 50 名武将带着它，而它既不进战斗也不进内政，只在候选标签上露个脸。
  // **这不是 bug**，记一条闸是因为「某个适性没人读」从代码里看不出来——
  // 哪天给它接上了逻辑，这条会失败，那时把它挪进下面那张表
  const src = ["officers.ts", "actions.ts", "combat.ts", "resolve.ts", "forecast.ts"]
    .map((f) => fs.readFileSync(`lib/game/engine/${f}`, "utf8"))
    .join("\n")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, ""))
    .join("\n");
  assert.ok(!src.includes("envoy") && !src.includes(APT.envoy),
    "说客现在有逻辑读它了——把它从「纯显示」里挪出来，并更新这条闸");
  // 另外五个都要有人读
  for (const key of ["siege", "defend", "govern"]) {
    assert.ok(src.includes(`APT.${key}`), `APT.${key} 在引擎里没人读了`);
  }
  // 地形那两个经 TERRAIN_APTITUDE 读
  assert.ok(src.includes("TERRAIN_APTITUDE") || src.includes("terrainAptitudeBonus"),
    "地形适性没人读了");
});

test("适性：地形对应表只用全集里的值", () => {
  for (const [terrain, apt] of Object.entries(TERRAIN_APTITUDE)) {
    assert.ok(APTITUDES.includes(apt), `地形 ${terrain} 映到了全集外的 ${apt}`);
  }
  // 攻城/守城不看地形——它们若混进来，等于平地也给攻城加成
  assert.ok(!Object.values(TERRAIN_APTITUDE).includes(APT.siege));
  assert.ok(!Object.values(TERRAIN_APTITUDE).includes(APT.defend));
});

test("适性：显示名今天与 id 逐字相同，但必须是两张表", () => {
  for (const a of APTITUDES) assert.equal(APTITUDE_CN[a], a);
  // 两张表的意义在于它们可以不同。英文界面要加的是 APTITUDE_CN 的另一份，
  // 而不是另一套 id——id 换了语言，候选 key 与观测跟着换，新旧榜不可比
  assert.equal(Object.keys(APTITUDE_CN).length, APTITUDES.length);
});

test("适性：hasApt 对空与龙套不炸", () => {
  assert.equal(hasApt(null, APT.siege), false);
  assert.equal(hasApt({ aptitudes: [] }, APT.siege), false);
  assert.equal(hasApt({ aptitudes: [APT.siege] }, APT.siege), true);
});
