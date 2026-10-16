// 模型路径必须留在中文。
//
// 这条闸是为**将来**写的：文档已经双语了，下一个念头自然是让界面也说英文
//（方案与代价见 docs/I18N-PLAN.md）。而界面与模型今天读的是**同一批字符串**——
// listActions / briefFor / forecast / visibleLog / GRADE_CN / FORMATION_CN
// 这些函数与常量，观测走一遍、界面也走一遍。
//
// 于是「把界面翻成英文」这件事，默认写法就会连模型提示词一起翻掉。那不会报错，
// 只会让下一份排行榜**悄悄变成另一种东西**：候选的 key 本身是中文，模型读到的
// 规则摘要、档位名、阵型名全换了语言，而新旧两份榜仍会并排显示。
//
// 所以在动 i18n 之前先把钉子打进去：模型看见的那一面必须是中文，
// 且模型路径上的函数不许接受语言参数。谁要做界面双语，得先看见这条红灯。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// ── 其一：源码层面，模型路径不许出现语言开关 ──────────────────────
//
// 用正则读源码是脆的，但这里要拦的正是「有人加了一个参数」这件事，
// 而它在行为上与现状逐位相同，测不出来。命中时的提示里写清楚该怎么做。
const MODEL_PATH = [
  "lib/game/engine/observe.ts",
  "lib/arena/seat/prompt.ts",
  "lib/arena/seat/model-seat.ts",
];
const SWITCH = /\b(locale|lang|language|i18n|translate)\b/i;

test("模型路径：观测与提示词不许接受语言参数", () => {
  const hit = [];
  for (const f of MODEL_PATH) {
    const src = fs.readFileSync(f, "utf8");
    src.split("\n").forEach((line, i) => {
      // 注释不算——这条闸拦的是代码，而解释它存在的话本身要提到 i18n
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      if (SWITCH.test(code)) hit.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(hit, [],
    `模型路径上出现了语言开关：\n  ${hit.join("\n  ")}\n`
    + "  观测与提示词只能是中文：候选的 key 本身是中文，换语言则新旧榜不可比。\n"
    + "  要做界面双语，把 locale 穿过界面那一侧的调用，模型这一侧钉死 zh——"
    + "见 docs/I18N-PLAN.md 第四节");
});

// ── 其二：行为层面，观测里确实是中文 ──────────────────────────────
test("模型路径：观测里的档位、阵型、兵种名是中文", async () => {
  const { createGame } = await import("../lib/game/engine/setup.ts");
  const { buildGraph } = await import("../lib/game/engine/actions.ts");
  const { buildGeography } = await import("../lib/game/engine/victory.ts");
  const { loadParams } = await import("../lib/game/engine/params.ts");
  const { observe } = await import("../lib/game/engine/observe.ts");
  const b = JSON.parse(fs.readFileSync("public/game/runtime-194.json", "utf8"));
  const P = loadParams(b.pack), g = buildGraph(b.adjacency);
  const geo = buildGeography(b.commanderies, b.provinceSeats);
  const s = createGame(b, { seed: "locale", geo, graph: g, seasons: 16, endCondition: "season-limit" }, P);
  const json = JSON.stringify(observe(s, "yuanshao", g, P, null, geo, {}));
  // 档位名出自 victory.ts 的 GRADE_CN，阵型出自 combat.ts 的 FORMATION_CN，
  // 两者界面也在读；只要观测里还是这些字，就说明没有被翻译层截走
  for (const token of ["档", "郡", "季"]) {
    assert.ok(json.includes(token), `观测里找不到「${token}」——模型看到的已不是中文`);
  }
  // 反面：不该出现英文的档位/阵型名
  for (const bad of ["\"grade\":\"A\"", "formation\":\"wedge", "season\":\"spring"]) {
    assert.ok(!json.includes(bad), `观测里出现了英文化的 ${bad}`);
  }
});
