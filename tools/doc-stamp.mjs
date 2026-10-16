// 打印双语漂移戳。译完一份英文件，把这行贴到文件末尾。
//
//   node tools/doc-stamp.mjs docs/EVAL.md
//   node tools/doc-stamp.mjs          # 列出所有对不上的
//
// **只打印，不替你改文件**——戳的意思是「我照这一版译过了」。能一键盖戳的话，
// 这道闸就退化成一个每次红了就按掉的闹钟，而它存在的理由正是逼人去看中文改了什么。
import fs from "node:fs";
import path from "node:path";
import { sourceHash, stampFor } from "./lib/doc-stamp.mjs";

const one = process.argv[2];
if (one) {
  if (!fs.existsSync(one)) { console.error(`没有这个文件：${one}`); process.exit(2); }
  console.log(stampFor(one));
  process.exit(0);
}

const STAMP = /<!--\s*translated-from:\s*([^@\s]+)@([0-9a-f]{12})\s*-->/;
let stale = 0;
for (const dir of [".", "docs"]) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".en.md")) continue;
    const en = path.join(dir, f);
    const zh = path.join(dir, f.replace(/\.en\.md$/, ".md"));
    if (!fs.existsSync(zh)) continue;
    const m = STAMP.exec(fs.readFileSync(en, "utf8"));
    const now = sourceHash(fs.readFileSync(zh, "utf8"));
    if (m?.[2] === now) continue;
    stale++;
    console.log(`${zh} 已改（${m?.[2] ?? "无戳"} → ${now}）`);
    console.log(`  译完后把 ${en} 末尾那行换成：${stampFor(zh)}`);
  }
}
console.log(stale ? `\n共 ${stale} 份待补。` : "全部对得上。");
