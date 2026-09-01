import assert from "node:assert/strict";
import test from "node:test";
import { roll, rollInt, shuffle, keyString } from "../lib/game/engine/rng.ts";

const base = { seed: "xingping-194", year: 194, season: 1, faction: "caocao", event: "field", seq: 0 };

test("同一坐标必得同一数", () => {
  assert.equal(roll(base), roll({ ...base }));
});

test("任一维变化都改变结果", () => {
  const b = roll(base);
  for (const patch of [{ seed: "x" }, { year: 195 }, { season: 2 },
                       { faction: "yuanshao" }, { event: "siege" }, { seq: 1 }]) {
    assert.notEqual(roll({ ...base, ...patch }), b, `${JSON.stringify(patch)} 未改变结果`);
  }
});

test("值域落在 [0,1)", () => {
  for (let i = 0; i < 20000; i += 1) {
    const v = roll({ ...base, seq: i });
    assert.ok(v >= 0 && v < 1, `第 ${i} 次越界: ${v}`);
  }
});

test("分布大体均匀（十分位偏差 < 8%）", () => {
  const bins = new Array(10).fill(0);
  const N = 100000;
  for (let i = 0; i < N; i += 1) bins[Math.floor(roll({ ...base, seq: i }) * 10)] += 1;
  for (const [i, c] of bins.entries()) {
    const dev = Math.abs(c - N / 10) / (N / 10);
    assert.ok(dev < 0.08, `第 ${i} 桶偏差 ${(dev * 100).toFixed(1)}%`);
  }
});

test("取数与顺序无关——这是 R6 的地基", () => {
  // 正序取一遍，逆序再取一遍，逐位必须相同
  const forward = [], backward = [];
  for (let i = 0; i < 500; i += 1) forward.push(roll({ ...base, seq: i }));
  for (let i = 499; i >= 0; i -= 1) backward.unshift(roll({ ...base, seq: i }));
  assert.deepEqual(forward, backward);
});

test("rollInt 不越界且覆盖全域", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) {
    const v = rollInt({ ...base, seq: i }, 7);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 7);
    seen.add(v);
  }
  assert.equal(seen.size, 7, "未覆盖全部取值");
});

test("洗牌确定且为原集合的排列", () => {
  const src = Array.from({ length: 40 }, (_, i) => i);
  const k = { seed: "s", year: 194, season: 1, faction: "*", event: "recruit" };
  const a = shuffle(src, k), b = shuffle(src, k);
  assert.deepEqual(a, b, "同 key 洗牌结果不一致");
  assert.deepEqual([...a].sort((x, y) => x - y), src, "洗牌后元素集合改变");
  assert.notDeepEqual(a, src, "洗牌未生效");
});

test("keyString 无歧义：分隔符不被内容吞掉", () => {
  // 若用简单拼接，faction="a" event="b|c" 会与 faction="a|b" event="c" 撞车
  assert.notEqual(
    keyString({ ...base, faction: "a", event: "b|c" }),
    keyString({ ...base, faction: "a|b", event: "c" }),
  );
});
