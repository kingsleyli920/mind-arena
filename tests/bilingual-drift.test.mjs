// 双语漂移闸。
//
// 中文是源，英文是平行本。两边是两个文件、两次编辑，而改中文的人
// 多半不会同时改英文——于是英文版会**悄悄**停在某个旧版本上，
// 读者看到的是一份过期的项目介绍，而仓库里没有任何东西会提醒。
//
// 这条闸的做法与规则指纹、README 版本号那两道相同：把「我是照哪一版译的」
// 写进文件本身，让漂移变成一次可见的失败。英文件末尾钉一行
//
//   <!-- translated-from: README.md@<sha256 前 12 位> -->
//
// 中文一改，哈希对不上，测试就点名说哪几份要补。这也正是让翻译能与
// 开发并行的前提：译者不必追一个还在动的目标，闸会告诉他停在哪儿。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sourceHash } from "../tools/lib/doc-stamp.mjs";

const ROOTS = [".", "docs"];
const STAMP = /<!--\s*translated-from:\s*([^@\s]+)@([0-9a-f]{12})\s*-->/;

const pairs = [];
for (const dir of ROOTS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".en.md")) continue;
    const en = path.join(dir, f);
    const zh = path.join(dir, f.replace(/\.en\.md$/, ".md"));
    pairs.push({ en, zh });
  }
}

test("双语：每份英文件都要有对应的中文原件", () => {
  const orphans = pairs.filter((p) => !fs.existsSync(p.zh)).map((p) => p.en);
  assert.deepEqual(orphans, [],
    `这些英文件找不到中文原件：${orphans.join("、")}——英文是平行本，不是独立文档`);
});

test("双语：英文件必须钉住所译中文原件的版本", () => {
  const missing = [];
  for (const p of pairs) {
    const m = STAMP.exec(fs.readFileSync(p.en, "utf8"));
    if (!m) missing.push(p.en);
    else if (m[1] !== path.basename(p.zh)) missing.push(`${p.en}（钉的是 ${m[1]}，应为 ${path.basename(p.zh)}）`);
  }
  assert.deepEqual(missing, [],
    `这些英文件末尾缺 translated-from 戳：${missing.join("、")}`
    + "\n  格式：<!-- translated-from: <中文件名>@<sha256 前 12 位> -->"
    + "\n  取戳：node tools/doc-stamp.mjs docs/EVAL.md");
});

test("双语：中文改了，英文就得跟上", () => {
  const stale = [];
  for (const p of pairs) {
    const m = STAMP.exec(fs.readFileSync(p.en, "utf8"));
    if (!m || !fs.existsSync(p.zh)) continue;        // 另有两条闸管这两种情况
    const now = sourceHash(fs.readFileSync(p.zh, "utf8"));
    if (now !== m[2]) stale.push(`${p.zh} 已改（${m[2]} → ${now}），而 ${p.en} 还停在旧版`);
  }
  assert.deepEqual(stale, [],
    `\n  ${stale.join("\n  ")}\n  改完英文后把戳里的哈希更新掉。`
    + "这条闸只说「对不上」，不替你判断改动要不要译——那是人的事");
});
