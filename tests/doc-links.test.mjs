// 文档里指向仓库内文件的链接，必须真的指得到。
//
// 这条闸是在一次**假警报**之后加的：我从仓库根目录去找 docs/EVAL.md 里的
// `reports/...`，四十一个文件一个都找不到，以为所有原始数据从来没入过库。
// 实际上 Markdown 的相对链接是**相对文档所在目录**解析的，那些文件都在
// docs/reports/ 下，GitHub 上点得开。
//
// 假警报本身不花什么，但它说明一件事：这些链接没有任何东西在看着。
// 而这个项目的卖点是「不公布胜负，公开证据」——证据的链接断了，那句话就成了假话，
// 而且断得无声无息（Markdown 不会因为链接坏了而渲染失败）。
//
// 只查**仓库内**的相对链接。外链要联网，不在这道闸的职责里。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** 要查的文档：docs/ 下全部，加根上的两份 README */
const DOCS = [
  ...fs.readdirSync("docs").filter((f) => f.endsWith(".md")).map((f) => path.join("docs", f)),
  "README.md", "README.en.md",
].filter((f) => fs.existsSync(f));

/** `](路径)` 里的路径。跳过 http(s)、锚点、邮件 */
const LINK = /\]\(([^)\s#][^)\s]*)\)/g;
const external = (t) => /^(https?:|mailto:|#)/.test(t);

test("文档链接：仓库内的相对链接都要指得到", () => {
  const bad = [];
  for (const doc of DOCS) {
    const base = path.dirname(doc);
    for (const m of fs.readFileSync(doc, "utf8").matchAll(LINK)) {
      const raw = m[1];
      if (external(raw)) continue;
      // 去掉锚点与查询串再解析
      const target = raw.split("#")[0].split("?")[0];
      if (!target) continue;
      const abs = target.startsWith("/")
        ? path.join(".", target)           // 以 / 开头的当仓库根算
        : path.join(base, target);
      if (!fs.existsSync(abs)) bad.push(`${doc} → ${raw}（解析为 ${path.normalize(abs)}）`);
    }
  }
  assert.deepEqual(bad, [],
    `这些链接指向不存在的文件：\n  ${bad.join("\n  ")}\n`
    + "  注意 Markdown 的相对链接是相对**文档所在目录**解析的："
    + "docs/EVAL.md 里的 `reports/x` 指的是 docs/reports/x，不是仓库根的 reports/x");
});

test("文档链接：至少查到了一批，否则这条闸是空转的", () => {
  // 正则写错、DOCS 取空，都会让上一条无声通过
  let n = 0;
  for (const doc of DOCS) {
    for (const m of fs.readFileSync(doc, "utf8").matchAll(LINK)) {
      if (!external(m[1])) n++;
    }
  }
  assert.ok(DOCS.length >= 20, `只扫到 ${DOCS.length} 份文档`);
  assert.ok(n >= 30, `只查到 ${n} 条仓库内链接——正则多半没匹配上`);
});
