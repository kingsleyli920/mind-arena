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

/**
 * 空文件也有哈希，而且长得和正常哈希一模一样（`e3b0c442...`）。
 *
 * 这不是假想：今天我用 python 改 README，`open(p,"w")` 在内层读之前就把文件
 * 截断了，于是 README.md 变成 0 字节，取戳工具照样吐出一个体面的 12 位十六进制，
 * 闸也照样显示「全部对得上」——**一份被清空的文档被盖上了「已译」的戳**。
 * 同一个形状的错今天是第二次（上一次把 build-runtime-bundle.mjs 截成 0 字节）。
 *
 * 闸只会比对哈希，分不出「改小了」和「没了」。所以在出戳这一步拦。
 */
export function stampFor(zhPath) {
  const text = fs.readFileSync(zhPath, "utf8");
  if (text.trim().length < 100) {
    throw new Error(`${zhPath} 只有 ${text.length} 字节——空文件也有哈希，`
      + "盖上去闸就会说「对得上」。先确认这个文件是不是被截断了");
  }
  return `<!-- translated-from: ${zhPath.split("/").pop()}@${sourceHash(text)} -->`;
}
