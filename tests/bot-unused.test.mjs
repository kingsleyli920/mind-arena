// 机器人用不了哪几类动作——这份清单必须是**写下来的**，不是碰巧的。
//
// 2026-10-16 量出来的：引擎每季给曹操席摆出 3–7 条取据点候选，五个画像在十五局
// 六十四季里一条都没挑（0/175–457）。从代码里看不出来，因为 `w[type] ?? 0` 不报错，
// 只是让那一类永远排在最后；从报告里也看不出来，因为「它没做某件事」没有行可印。
//
// 这条闸不要求补上——实测过补了也不改变胜负（见 bot.ts 权重表上的记载）。
// 它要求的是：这份「用不了」的清单**变了就得有人来改这里**，顺便说明当时量到了什么。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync("lib/game/engine/bot.ts", "utf8");

/** 权重表里出现过的动作类型 */
function weighted() {
  const m = src.match(/const WEIGHTS[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(m, "找不到 WEIGHTS 表——这条闸的锚点没了");
  return new Set([...m[1].matchAll(/([A-Za-z]+):\s*-?\d+/g)].map((x) => x[1]));
}

/** 内容包里的动作，加上引擎从征伐派生的那两个键 */
function offered() {
  const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
  return new Set([...pack.actions.map((a) => a.id), "relief", "withdraw"]);
}

/**
 * 权重表里没有的几类。**「没权重」不等于「不会用」**——这条闸第一次跑就纠正了我：
 * `relief`（赴援）没有权重，却在十五局里被挑了 **136 次**，因为它靠的是打分时的
 * 加成，不是底分。
 *
 * 所以这里钉的是「表里有没有」，而「实际挑没挑」另有一份实测记在下面。
 */
const NO_WEIGHT = ["relief", "relocate", "seize", "transfer"];

/**
 * 十五局（五画像 × 三种子 × 64 季，约 960 席·季）里**一次都没被挑**的几类。
 * 2026-10-16 实测：relief 136 次，其余三类 0 次。
 *
 * 这份清单不要求补上——`seize` 试过把权重拉到 999、让它每局取 39–48 个据点
 *（比模型还多），三个种子仍然一局没一统。详见 bot.ts 权重表上方的记载。
 */
const NEVER_PICKED = ["relocate", "seize", "transfer"];

test("机器人：权重表没覆盖的动作就是记下来的那几类，不多不少", () => {
  const w = weighted(), all = offered();
  const missing = [...all].filter((t) => !w.has(t)).sort();
  assert.deepEqual(missing, [...NO_WEIGHT].sort(),
    `机器人权重表的覆盖变了。\n`
    + `  现在没有权重的是：${missing.join("、")}\n`
    + `  记录在案的是：${NO_WEIGHT.join("、")}\n`
    + "  若是补上了某一类：更新这份清单，并改掉 bot.ts 权重表上方那段实测记载"
    + "（那里写着「补权重也不改变胜负」，补完要重新量）。\n"
    + "  若是新增了一类动作而忘了给机器人权重：那正是这条闸要拦的——"
    + "评测基线用不了的动作，等于那一类玩法没有基线。");
});

test("机器人：那几类确实是引擎会摆出来的，不是死条目", () => {
  // 若 seize 根本没有候选，「机器人不用它」就不算一件事。
  // 这里只钉「包里有它」——逐季候选数在实录的「摆在面前的选择」那一行里
  const all = offered();
  for (const t of [...NO_WEIGHT, ...NEVER_PICKED]) {
    assert.ok(all.has(t), `${t} 不在内容包的动作里，这份清单该删掉它`);
  }
});

test("机器人：一次没挑过的那几类，确实都是没权重的", () => {
  // 反过来若某一类有权重却从没被挑，那是另一种毛病（权重被别的加成压死），
  // 该单独记一笔而不是混在这份清单里。seize 恰好是这种——它**现在**没权重，
  // 但试过给它 5 仍然 0，详见 bot.ts 上方的记载
  const w = weighted();
  const odd = NEVER_PICKED.filter((t) => w.has(t));
  assert.deepEqual(odd, [],
    `${odd.join("、")} 有权重却一次没被挑——那不是「没接进去」，`
    + "是「接进去了但打不过别的加成」，要单独记");
});

test("机器人：权重表里不许有引擎不认的动作", () => {
  // 反方向：改名时漏改一边，权重会挂在一个没人用的键上，而它看起来一切正常
  const w = weighted(), all = offered();
  const ghosts = [...w].filter((t) => !all.has(t)).sort();
  assert.deepEqual(ghosts, [],
    `权重表里有内容包不认的动作：${ghosts.join("、")}——多半是改名时漏了一边`);
});
