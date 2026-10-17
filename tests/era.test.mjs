// 年号必须和剧本目录说的一样。
//
// 这条闸是因为一处**只有一个字的不一致**：对局页把兴平写成了繁体的「興平」，
// 是全仓库唯一一处，于是同一个年号在 /game 上是「兴平元年」、在 /play 上是
// 「興平元年」。两边都跑得好好的，而玩家在两页之间切换时看到的是两个字。
//
// 它逃过了所有现有的闸：不是标签表副本（这是算法算出来的），不是文案目录
// （年号是算法输出），也不是数据漂移（数据那边一直是对的）。能逮住它的只有
// 「算出来的年号 == 剧本目录里的年号」这一句。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { eraName, hanNum, SEASON_CN } from "../app/(zh)/play/era.ts";

const registry = JSON.parse(fs.readFileSync("public/game/scenarios.json", "utf8"));

test("年号：算出来的必须等于剧本目录里的", () => {
  assert.ok(registry.scenarios.length >= 2, "目录里至少该有两个剧本");
  for (const s of registry.scenarios) {
    assert.equal(eraName(s.year), s.era,
      `剧本 ${s.id}（${s.year} 年）：目录说「${s.era}」，而 eraName 算出「${eraName(s.year)}」`);
  }
});

test("年号：建安那一段按汉数字写，元年不写「一年」", () => {
  assert.equal(eraName(196), "建安元年");
  assert.equal(eraName(197), "建安二年");
  assert.equal(eraName(200), "建安五年");
  assert.equal(eraName(205), "建安十年");
  assert.equal(eraName(215), "建安二十年");
  assert.equal(eraName(219), "建安二十四年");
  // 建安止于二十五年，再往后退回数字而不是编一个不存在的年号
  assert.equal(eraName(220), "建安二十五年");
  assert.equal(eraName(221), "221 年");
});

test("年号：没有繁体字混进来", () => {
  // 全仓库用简体。這條闸只盯年号这几个字——别处另有人管
  const probes = [193, 194, 195, 196, 200, 210, 220].map(eraName).join("");
  for (const bad of ["興", "漢", "國", "軍"]) {
    assert.ok(!probes.includes(bad), `年号里混进了繁体「${bad}」：${probes}`);
  }
});

test("汉数字：十位与个位都要对", () => {
  assert.equal(hanNum(1), "一");
  assert.equal(hanNum(9), "九");
  assert.equal(hanNum(10), "十");
  assert.equal(hanNum(11), "十一");
  assert.equal(hanNum(19), "十九");
  assert.equal(hanNum(20), "二十");
  assert.equal(hanNum(21), "二十一");
  assert.equal(hanNum(25), "二十五");
  // 整十不许拖一个空字（「二十」而不是「二十​」）
  assert.equal(hanNum(30), "三十");
});

test("季节：四季齐全，下标从 1 起", () => {
  assert.equal(SEASON_CN.length, 5, "第 0 位是占位的空串，让 season 直接当下标");
  assert.equal(SEASON_CN[0], "");
  assert.deepEqual(SEASON_CN.slice(1), ["春", "夏", "秋", "冬"]);
});
