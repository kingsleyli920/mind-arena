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
