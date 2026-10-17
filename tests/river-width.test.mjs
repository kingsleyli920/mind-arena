// 河宽表的键必须与水系数据里的河名一一对应。
//
// 对局页按河名查一个笔宽（黄河 1.0、淮水 0.62…），查不到就落到默认值。
// 改名或新增一条河时，那条河会**安静地**用默认宽度画出来——图上看得出不对劲，
// 而没有任何东西会报错，也没人会想到去对这张表。
//
// 这类「中文当数据键」与 pack 的 `改动记载` 是同一形状：键本来就该是中文
//（见 docs/I18N-PLAN.md 第三节），所以不能靠「界面里不许有中文」那条棘轮拦，
// 只能拿数据去对。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** 从对局页里把那张表抠出来。它就在源码里，没有别处可取 */
function widths() {
  const src = fs.readFileSync("app/(zh)/play/PlayClient.tsx", "utf8");
  const i = src.indexOf("const RIVER_W");
  assert.ok(i > 0, "找不到 RIVER_W —— 这条闸的锚点没了");
  const body = src.slice(src.indexOf("{", i) + 1, src.indexOf("};", i));
  const out = {};
  for (const m of body.matchAll(/"?([^",:\s]+)"?\s*:\s*([\d.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

const rivers = (() => {
  const b = JSON.parse(fs.readFileSync("public/game/runtime-194.json", "utf8"));
  return b.hydrology.rivers.map((r) => r.name);
})();

test("河宽：水系里的每一条河都要有笔宽", () => {
  const w = widths();
  const missing = rivers.filter((n) => !(n in w));
  assert.deepEqual(missing, [],
    `这些河没有笔宽，会按默认值画：${missing.join("、")}`);
});

test("河宽：表里不许有水系没有的河", () => {
  // 反方向：改名时漏改一边，笔宽会挂在一个画不出来的名字上
  const w = widths();
  const ghosts = Object.keys(w).filter((n) => !rivers.includes(n));
  assert.deepEqual(ghosts, [],
    `笔宽表里有水系数据没有的河：${ghosts.join("、")}——多半是改名时漏了一边`);
});

test("河宽：值落在合理区间，且黄河长江最宽", () => {
  const w = widths();
  assert.ok(rivers.length >= 10, `只有 ${rivers.length} 条河，样本不足`);
  for (const [n, v] of Object.entries(w)) {
    assert.ok(v > 0 && v <= 1, `${n} 的笔宽 ${v} 不在 (0,1] 内`);
  }
  assert.equal(w["黄河"], 1.0);
  assert.equal(w["长江"], 1.0);
  assert.ok(Math.max(...Object.values(w)) === 1.0, "最宽的应当是 1.0");
});
