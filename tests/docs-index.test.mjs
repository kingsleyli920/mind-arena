// 文档索引的完整性。
//
// docs/README.md 是进 docs/ 的唯一入口。实测漏过一次：23 份文档里它只列了 5 份，
// 另外 18 份连同刚做好的英文平行本一起没有入口——文件在仓库里，而读者找不到。
// 漏掉不会有任何征兆，因为索引本身读起来是完整的。
//
// 这条闸只问一句：**每一份文档都在索引里被提到吗。** 它不管描述写得好不好，
// 那是人的事；它只保证没有一份是悄悄躺在那儿的。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("文档索引：docs/ 下每一份文档都要在索引里出现", () => {
  const index = fs.readFileSync("docs/README.md", "utf8");
  const docs = fs.readdirSync("docs")
    .filter((f) => f.endsWith(".md") && !f.endsWith(".en.md") && f !== "README.md");
  const missing = docs.filter((f) => !index.includes(f));
  assert.deepEqual(missing, [],
    `这些文档不在 docs/README.md 里：${missing.join("、")}`
    + " —— 文件在仓库里而读者找不到，加文档时索引要跟着加");
});

test("文档索引：索引里提到的文档都要真的存在", () => {
  const index = fs.readFileSync("docs/README.md", "utf8");
  const dead = [...index.matchAll(/`([A-Za-z0-9_.-]+\.md)`/g)]
    .map((m) => m[1])
    .filter((f, i, a) => a.indexOf(f) === i)
    .filter((f) => !fs.existsSync(`docs/${f}`) && !fs.existsSync(`docs/research/${f}`));
  assert.deepEqual(dead, [],
    `索引里提到但找不到的文档：${dead.join("、")}`);
});
