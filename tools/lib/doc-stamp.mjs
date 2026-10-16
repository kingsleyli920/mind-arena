// 双语漂移戳的哈希算法。闸在 tests/bilingual-drift.test.mjs，算法在这里。
//
// 拆出来有个很具体的理由：闸原先把算法写在测试文件里，并在失败提示里教人
//   node -e "import('./tests/bilingual-drift.test.mjs').then(m=>console.log(m.sourceHash(…)))"
// 取哈希。**那条命令会把整套测试跑起来**，node:test 的报告跟着进 stdout，
// 于是 `h=$(…)` 捞到的是「哈希 + 一屏测试输出」——照着做一次，EVAL.en.md 的
// 戳里被塞进了半份 AssertionError。工具该能被脚本调用，而测试不能。
import fs from "node:fs";
import crypto from "node:crypto";

/** 语言切换行两边都会改，不计入哈希 */
const SWITCHER = /^\[中文\]\(.*\)\s*·\s*\[English\]\(.*\)\s*$/;

export function sourceHash(text) {
  const body = text.split("\n").filter((l) => !SWITCHER.test(l.trim()));
  return crypto.createHash("sha256").update(body.join("\n")).digest("hex").slice(0, 12);
}

export const stampFor = (zhPath) =>
  `<!-- translated-from: ${zhPath.split("/").pop()}@${sourceHash(fs.readFileSync(zhPath, "utf8"))} -->`;
