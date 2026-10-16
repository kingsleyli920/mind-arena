// 「这份榜还作不作数」这句话，/board 页必须答对。
//
// 两处实测错过：
//
// 一、判据用的是**版本号**，而榜里早就盖了指纹。content/fingerprint.ts 开头
//     论证过版本号两个方向都会错，而这一页用的正是它自己说不该用的那把尺。
//
// 二、「其间升过哪几版」原先按「在改动记载里找到榜的版本，再往后数」算。
//     现挂的那份榜跑在 0.2.0/1.0.0 下，而改动记载从 1.1.0 才开始逐版记——
//     找不到，于是输出「其间升过 0 版」。**恰好在最该说话的时候闭嘴**，
//     而这条横幅存在的全部理由就是说这句话。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boardStale, versionsSince, verNum } from "../lib/arena/board-stale.ts";
import { ruleFingerprint } from "../lib/game/content/fingerprint.ts";

const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
const LOG = pack._frozen["改动记载"];

test("过期判定：指纹优先于版本号", () => {
  // 版本号一样而数值动过 → 过期。版本号那把尺在这里会说「可比」
  assert.equal(boardStale({ packVersion: pack.version, packFingerprint: "deadbeef0000" }, pack), true);
  // 指纹一样而版本号不同 → 不过期。那次「只改版本号与冻结标记、数值一个没动」
  // 的提交是真发生过的，见 fingerprint.ts 开头
  assert.equal(boardStale({ packVersion: "0.0.1", packFingerprint: ruleFingerprint(pack).hash }, pack), false);
});

test("过期判定：旧榜没盖指纹时才退回版本号", () => {
  assert.equal(boardStale({ packVersion: "1.0.0" }, pack), true);
  assert.equal(boardStale({ packVersion: pack.version }, pack), false);
  assert.equal(boardStale({ packVersion: "1.0.0", packFingerprint: null }, pack), true);
});

test("其间升过哪几版：榜比记载第一条还老时不许沉默", () => {
  // 现挂的那份榜。改动记载从 1.1.0 起，它一条都不在表里
  const since = versionsSince({ packVersion: "0.2.0/1.0.0" }, LOG);
  assert.ok(since.length >= 9,
    `只数出 ${since.length} 版——「找到再往后数」的老写法在这里会得 0，`
    + "而这条横幅存在的理由就是说这句话");
  assert.equal(since[0], "1.1.0");
  assert.equal(since.at(-1), pack.version);
});

test("其间升过哪几版：多版榜取最新的那个当基准", () => {
  // "2.3.0/2.4.0" 跑在两版上。比 2.4.0 新的才算「其间」，
  // 按 2.3.0 算会把 2.4.0 自己也数进去
  const since = versionsSince({ packVersion: "2.3.0/2.4.0" }, LOG);
  assert.ok(!since.includes("2.4.0"), `把基准版自己数进去了：${since.join("、")}`);
  assert.deepEqual(since, ["2.5.0", "2.6.0"]);
  // 当前版的榜：其间一版没升
  assert.deepEqual(versionsSince({ packVersion: pack.version }, LOG), []);
});

test("版本号比大小：按段比，不按字典序", () => {
  // 字典序下 "10.0.0" < "9.0.0"，而这里必须反过来
  assert.ok(verNum("10.0.0") > verNum("9.0.0"));
  assert.ok(verNum("2.6.0") > verNum("2.5.9"));
  assert.ok(verNum("1.0.0") > verNum("0.2.0"));
  // 段数不全或带脏字符不许炸，也不许把它排到最前面去
  assert.equal(verNum(""), 0);
  assert.ok(verNum("2") > 0);
});
