// 标签避让的原语。三处调用点（牌记、路题记、关津名）共用这两条，
// 写错一个不等号不会报错，只会让某一类标签悄悄不避让——那正是关津此前的情形
import { test } from "node:test";
import assert from "node:assert/strict";
import { overlaps, fitLabel, textWidth } from "../app/(zh)/play/label-fit.ts";

test("相交判定：边贴边不算相交", () => {
  assert.equal(overlaps([0, 0, 10, 10], [10, 0, 10, 10]), false, "右边贴左边");
  assert.equal(overlaps([0, 0, 10, 10], [0, 10, 10, 10]), false, "下边贴上边");
  assert.equal(overlaps([0, 0, 10, 10], [9.9, 0, 10, 10]), true, "重叠 0.1");
  assert.equal(overlaps([0, 0, 10, 10], [2, 2, 3, 3]), true, "整个包住");
  assert.equal(overlaps([0, 0, 10, 10], [20, 20, 5, 5]), false, "错开");
});

test("四档位置：撞了就换下一档，命中即占位", () => {
  const placed = [[0, 0, 10, 10]];
  const got = fitLabel(placed, [[1, 1, 5, 5], [20, 20, 5, 5]]);
  assert.deepEqual(got, [20, 20, 5, 5], "第一档撞，取第二档");
  assert.equal(placed.length, 2, "命中的那一档要推进已占位表");
  // 后来者看得见先来者
  assert.equal(fitLabel(placed, [[20, 20, 5, 5]]), null, "同一处不能放两个");
});

test("全撞则不发这一条", () => {
  const placed = [[0, 0, 100, 100]];
  assert.equal(fitLabel(placed, [[1, 1, 5, 5], [2, 2, 5, 5]]), null);
  assert.equal(placed.length, 1, "没放成就不该占位");
});

test("字宽：中文按 1em，数字与空格按 0.55em", () => {
  assert.equal(textWidth("白马津", 10), 30);
  // 「关道·潼关 41 日」= 一等宽 6（关道·潼关 与 日）+ 半宽 4（两个空格与 4、1）
  assert.equal(textWidth("关道·潼关 41 日", 10), 6 * 10 + 4 * 5.5);
  assert.ok(textWidth("延津", 10) < textWidth("小平津", 10), "字多则宽");
  // 一刀切 0.62 是低估：那正是题记压在城印上的原因
  assert.ok(textWidth("关道·潼关 41 日", 10) > "关道·潼关 41 日".length * 6.2);
});
