// 标签表只许有一份。
//
// 这是 docs/I18N-PLAN.md 阶段 0 的第一项，而它独立于英文化也该做：两份表的
// 危险不在于「现在不一样」，在于**改一份另一份不会报错**。榜上写「甲」、
// 对局页写别的，两边都跑得好好的。
//
// 实测过四份：PlayClient 里的 UNIT_CN2 / GEAR_CN2 / RESOURCE_CN2 / BUILD_CN2，
// 外加 app/board/page.tsx 自己写的一份 GRADE_CN。前两份抄的是 actions.ts，
// 而 UNIT_CN2 抄得更远——兵种名是**内容包里的数据**（units[].name），
// 抄到界面上等于把「规则即数据」在显示这一层破了个口子。
//
// 这正是 ARCHITECTURE 里「定价不许两份」那条闸拦的东西，只是它没拦到标签上。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BUILD_CN, RESOURCE_CN, GEAR_CN, POSTURE_CN, BUILD_NEEDS } from "../lib/game/engine/actions.ts";
import { GRADE_CN } from "../lib/game/engine/victory.ts";
import { FORMATION_CN, unitName } from "../lib/game/engine/combat.ts";
import { loadParams } from "../lib/game/engine/params.ts";

const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));

/** app/ 下所有 .ts/.tsx */
function uiFiles(dir = "app", out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) uiFiles(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const UI = uiFiles().map((f) => ({ f, src: fs.readFileSync(f, "utf8") }));

test("标签表：界面不许再出现 *_CN2 这类副本", () => {
  const hit = [];
  for (const { f, src } of UI) {
    src.split("\n").forEach((line, i) => {
      // 注释不算——解释这条闸为什么存在，本身就要提到那几个名字
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      if (/\b[A-Z_]+_CN2\b/.test(code)) hit.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(hit, [],
    `界面里又出现了标签表副本：\n  ${hit.join("\n  ")}\n`
    + "  从正本导入：建筑/物产/器械在 engine/actions.ts，档位在 victory.ts，"
    + "阵型在 combat.ts，兵种名在内容包里（用 unitName(P, …)）");
});

test("标签表：界面不许自己写一份已有正本的表", () => {
  // 按**内容**比，不按名字比：有人换个名字抄一遍，上一条闸就哑了
  const owned = { BUILD_CN, RESOURCE_CN, GEAR_CN, GRADE_CN, FORMATION_CN };
  const hit = [];
  for (const { f, src } of UI) {
    for (const [name, table] of Object.entries(owned)) {
      const vals = Object.values(table);
      // 一份表里至少有三个值同时出现在同一个对象字面量里，就当是抄的
      for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_]+)[^=]*=\s*\{([^}]*)\}/g)) {
        if (m[1].endsWith("_CN") === false && !/_CN\d?$/.test(m[1])) continue;
        const inside = m[2];
        const n = vals.filter((v) => inside.includes(`"${v}"`)).length;
        if (n >= 3) hit.push(`${f}  ${m[1]} 重复了 ${name} 的 ${n} 个值`);
      }
    }
  }
  assert.deepEqual(hit, [],
    `界面里有和引擎重复的标签表：\n  ${hit.join("\n  ")}\n`
    + "  删掉副本，从正本导入");
});

test("标签表：兵种名出自内容包，界面不许写死", () => {
  const P = loadParams(pack);
  const names = pack.units.map((u) => u.name);
  assert.deepEqual(names, ["步卒", "骑兵", "弓弩", "水军"], "包里的兵种名变了，这条闸要跟着改");
  // unitName 是唯一的取名路径
  for (const u of pack.units) assert.equal(unitName(P, u.id), u.name);
  // 界面里不许同时出现三个以上的兵种名字面量——那就是又抄了一份
  const hit = [];
  for (const { f, src } of UI) {
    const code = src.split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "")).join("\n");
    const n = names.filter((v) => code.includes(`"${v}"`)).length;
    if (n >= 3) hit.push(`${f} 写死了 ${n} 个兵种名`);
  }
  assert.deepEqual(hit, [],
    `${hit.join("、")}——兵种名是内容包里的数据，改包时界面不会跟着变。`
    + "用 unitName(P, unit)");
});

/** 包里某个动作的某个 tier 参数：{id: label} */
function tiersOf(actionId, paramName) {
  const a = pack.actions.find((x) => x.id === actionId);
  const p = (a?.params ?? []).find((x) => x.name === paramName);
  assert.ok(p?.tiers?.length, `内容包里找不到 ${actionId}.${paramName} 的 tiers`);
  return Object.fromEntries(p.tiers.map((t) => [t.id, t.label]));
}

// 正本自己也会和包漂移，而这一侧更要紧：**规则摘要里的档位名取自包**
// （content/schema.ts 渲染成 `id(label)`），候选标签与结算回执取自这几张表。
// 两边不一致，就是模型读到的规则和它挑的候选用着两个名字。
//
// 实测逮到一处：包里 siegeGear 的 none 标成「无」，而 GEAR_CN 写的是「无械」。
// 摘要告诉模型 `none(无)`，候选与回执却说「无械」——四方对账里最容易漏的那一方。
// 已把包改成「无械」（纯文字，指纹不动），并升了 PROMPT_VERSION。
test("标签表：引擎的档位名与内容包逐字一致", () => {
  const cases = [
    ["build", "kind", BUILD_CN, "BUILD_CN"],
    ["campaign", "siegeGear", GEAR_CN, "GEAR_CN"],
    ["campaign", "strength", POSTURE_CN, "POSTURE_CN"],
  ];
  for (const [action, param, table, name] of cases) {
    const want = tiersOf(action, param);
    assert.deepEqual(table, want,
      `${name} 与包里 ${action}.${param} 的 label 不一致。`
      + "规则摘要取包里的 label，候选标签取这张表——两边不一样，"
      + "等于告诉模型一套名字、让它挑另一套");
  }
});

test("标签表：物产表覆盖包里用到的每一种物产", () => {
  const build = pack.actions.find((a) => a.id === "build");
  const kind = (build?.params ?? []).find((x) => x.name === "kind");
  // needs 写在每个 tier 的 note 里不作数，这里按引擎的 BUILD_NEEDS 取
  for (const r of Object.values(BUILD_NEEDS)) {
    assert.ok(r in RESOURCE_CN, `包里有物产 ${r}，而 RESOURCE_CN 没有它`);
  }
  // 反面：表里不许有包和引擎都不认的物产
  assert.ok(kind, "包里没有 build.kind");
});

// ── 判词：id 与显示名是两件事 ──────────────────────────────────────
//
// 与适性不同，判词**危险的那一半已经有闸了**：它们是 TypeScript 的字面量联合
// 类型，写错一个字是编译错误。这里钉的是另一半——判词是 id（bot.ts 拿它做决策，
// 观测里按它写），显示名可以换语言而判等不该跟着动。
test("判词：显示表覆盖每一个判词，且今天与 id 逐字相同", async () => {
  const v = await import("../lib/game/engine/verdict.ts");
  const sets = [
    [v.SIEGE_VERDICTS, v.SIEGE_VERDICT_CN, "攻城"],
    [v.RELIEF_VERDICTS, v.RELIEF_VERDICT_CN, "赴援"],
    [v.FIELD_OUTCOMES, v.FIELD_OUTCOME_CN, "野战"],
  ];
  for (const [ids, cn, what] of sets) {
    assert.deepEqual(Object.keys(cn).sort(), [...ids].sort(), `${what}判词的显示表漏了`);
    for (const id of ids) assert.equal(cn[id], id, `${what}判词 ${id} 的显示名`);
  }
  // V 里的每个名字都要落在某个全集里
  const all = new Set([...v.SIEGE_VERDICTS, ...v.RELIEF_VERDICTS, ...v.FIELD_OUTCOMES]);
  for (const [k, val] of Object.entries(v.V)) assert.ok(all.has(val), `V.${k}=${val} 不在任何全集里`);
});

test("判词：决策不许再拿中文字面量比", () => {
  // bot.ts 用判词做决策（「解不了」就不去送死）。拿字面量比，日后换个说法
  // 就会悄悄少一个分支——而机器人是评测的基线，它变了整条基线就变了
  const src = fs.readFileSync("lib/game/engine/bot.ts", "utf8")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const hit = [...src.matchAll(/verdict\s*[!=]==\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hit, [],
    `bot.ts 里又出现了判词字面量：${hit.join("、")}——用 lib/game/engine/verdict.ts 的 V`);
});
