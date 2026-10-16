// 日志里的势力 id 换中文名：按**已知 id** 认，不按「一串小写字母」认。
//
// 原先是 `text.replace(/[a-z]+/g, …)`——扫出每串小写字母拿去查表，查不到原样放回。
// 今天的中文界面里碰不出事，因为日志里除了 id 几乎没有别的小写字母。
// 但它赌的是「一串小写字母就是 id」，而这个赌注**界面一说英文就输**：
// 那时每个英文单词都会被查一次表，撞上任何一个 id 就被换成一个人名，不报错。
// 今天两个剧本的 51 个 id 里没有一个是英文常用词，所以这不是在修一个正在出错的
// bug——是在拆掉那个前提。
//
// docs/I18N-PLAN.md 阶段 0 点名要先清掉的地基之一。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { idRe } from "../app/(zh)/play/id-regex.ts";

/** 真实的 194 势力 id */
const NAMES = (() => {
  const sc = JSON.parse(fs.readFileSync("lib/game/data/scenario-194.json", "utf8"));
  return new Map(sc.factions.map((f) => [f.id, f.name]));
})();
const cn = (t) => t.replace(idRe(NAMES), (m) => NAMES.get(m) ?? m);

test("id 替换：真实日志里的 id 照换", () => {
  assert.equal(cn("自 南阳郡 取 京兆尹（原属 lijue）"),
    `自 南阳郡 取 京兆尹（原属 ${NAMES.get("lijue")}）`);
  // 一行里多个
  const two = cn("lijue 与 lubu 交兵");
  assert.ok(!/lijue|lubu/.test(two), two);
});

test("id 替换：长的先吃，短 id 不许截断长 id", () => {
  // 这是交替正则的经典坑：liubiao 若排在 liu 后面，会被换成「刘＋biao」
  const long = [...NAMES.keys()].filter((a) =>
    [...NAMES.keys()].some((b) => b !== a && a.startsWith(b)));
  assert.ok(long.length, "剧本里没有互为前缀的 id，这条闸就失去了样本");
  for (const id of long) {
    assert.equal(cn(id), NAMES.get(id), `${id} 被一个更短的 id 截断了`);
  }
});

test("id 替换：不是整词就不换", () => {
  const id = [...NAMES.keys()][0];
  assert.equal(cn(`${id}x`), `${id}x`, "后面还粘着字母，不该命中");
  assert.equal(cn(`x${id}`), `x${id}`, "前面还粘着字母，不该命中");
  assert.equal(cn(`${id}1`), `${id}1`, "后面粘着数字，不该命中");
});

test("id 替换：表外的小写字母原样留着", () => {
  // 这正是旧写法与新写法的分界。英文界面上这句话里的每个词，
  // 旧写法都会拿去查一次表
  const s = "the city of war and peace";
  assert.equal(cn(s), s);
  // 而只要有一个词恰好是某个势力的 id，旧写法就会把它换掉
  const id = [...NAMES.keys()][0];
  assert.equal(cn(`a ${id} b`), `a ${NAMES.get(id)} b`, "整词命中仍要换");
});

test("id 替换：空表给一条永不命中的正则，不许退回 /[a-z]+/", () => {
  const empty = new Map();
  assert.equal("abc def".replace(idRe(empty), () => "X"), "abc def");
});

test("id 替换：同一个 Map 反复用，lastIndex 不许串台", () => {
  // 正则带 g 且被缓存，lastIndex 是有状态的。连续两次同样的输入必须同样的输出
  const t = "原属 lijue，后归 lubu";
  const a = cn(t), b = cn(t), c = cn(t);
  assert.equal(a, b);
  assert.equal(b, c);
  // 单独 exec 一次之后再 replace，也不许漏掉开头那个
  const re = idRe(NAMES);
  re.exec(t);
  assert.equal(t.replace(idRe(NAMES), (m) => NAMES.get(m) ?? m), a);
});
