// 模型看到的那一面，必须与金样逐字节相同。
//
// 这条闸管的是**所有别的闸都量不到的那种改动**：引擎里约七百条中文碎片、
// 九十五处语序拼接，改动它们之后榜照跑、分照出、selfplay 四道闸照过，
// 只是模型读到的字变了。没有任何现存的测试会红。
//
// 它也是 docs/I18N-PLAN.md 阶段 3 的硬前提：那一层整个就是在改这些字。
//
// 基线本身在 tests/golden/model-view.txt，由 `npm run golden -- --update` 重写。
// **重写不是绕过**：改了措辞就该重写，但要在提交里写清楚模型读到的哪一句变了。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

test("金样：模型看到的那一面没变", () => {
  assert.ok(fs.existsSync("tests/golden/model-view.txt"),
    "没有金样基线 —— 先跑 npm run golden -- --update");
  let out = "";
  try {
    out = execFileSync("node", ["--experimental-strip-types", "tools/golden.mjs"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // 工具自己把「第一处差异在哪一段、哪一行」printed 到 stderr 了，原样带出来
    assert.fail(`模型看到的那一面变了：\n${e.stderr || e.stdout || e.message}`);
  }
  assert.match(out, /逐字节相同/, out);
});

test("金样：基线里确实装着三样东西，不是空壳", () => {
  // 防一种退化：工具改坏了、只写了个头，而比对照样通过
  const base = fs.readFileSync("tests/golden/model-view.txt", "utf8");
  const marks = [...base.matchAll(/^@@ .*$/gm)].map((m) => m[0]);
  assert.ok(marks.length >= 30, `只有 ${marks.length} 段，太少`);
  assert.ok(marks.some((m) => m.includes("规则摘要")), "缺规则摘要");
  assert.ok(marks.some((m) => m.includes("观测")), "缺观测");
  assert.ok(marks.some((m) => m.includes("候选")), "缺候选标签");
  // 两个剧本都要在
  for (const s of ["194", "200"]) {
    assert.ok(marks.some((m) => m.includes(`@@ ${s} `)), `缺剧本 ${s}`);
  }
  // 段标题前缀不能是 `###`：规则摘要本身是 markdown，里面有 `###`，
  // 用它当分段符会把摘要自己的小标题也数成段（实测 35 段数出 69 个）
  assert.ok(!base.includes("\n### @@"), "段标题前缀与 markdown 撞了");
  assert.ok(base.length > 200_000, `基线只有 ${base.length} 字节，多半没取全`);
});

test("金样：戳着提示词版本 —— 它一升，基线本来就该变", () => {
  const base = fs.readFileSync("tests/golden/model-view.txt", "utf8");
  const m = base.match(/^# 提示词 (\S+)$/m);
  assert.ok(m, "金样头部没戳提示词版本");
  const src = fs.readFileSync("lib/arena/seat/prompt.ts", "utf8");
  const now = src.match(/PROMPT_VERSION = "([^"]+)"/)?.[1];
  assert.equal(m[1], now,
    `金样戳的是提示词 ${m[1]}，而现在是 ${now} —— 升了版本就要重跑 `
    + "npm run golden -- --update，并说清楚模型读到的哪一句变了");
});
