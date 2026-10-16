// 95% 区间的乘数必须按样本量取。
//
// tools/verdict.mjs 原先写死 z=1.96——那是 n→∞ 的值。小样本下区间被压窄，
// 于是**多判显著**：实测 n=6 时正确的乘数是 t(5)=2.571，差 31%。
// 一份 6 局的对照里，glm 的州进度 +97.3 ±81.4 判成「显著」，
// 按 t 算是 ±106.8，并不显著——而我已经照那个判断报过一次结论。
//
// 排行榜那边有 48 局的下界，差别只有 2.7%；偏偏是几局的对照实验最容易被骗，
// 而那种实验正是这个工具存在的理由。
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

/** 从工具里取出 t95，避免在测试里抄第二份表 */
const t95 = await (async () => {
  const src = execSync("node -e \"process.stdout.write(require('fs').readFileSync('tools/verdict.mjs','utf8'))\"",
    { encoding: "utf8" });
  const from = src.indexOf("const T95 =");
  const to = src.indexOf("\n}", src.indexOf("function t95"));
  assert.ok(from > 0 && to > from, "verdict.mjs 里找不到 T95 / t95 —— 这条闸的锚点没了");
  const mod = `${src.slice(from, to + 2)}\nexport { t95 };`;
  const b64 = Buffer.from(mod).toString("base64");
  return (await import(`data:text/javascript;base64,${b64}`)).t95;
})();

test("区间乘数：小样本必须用 t，不是 1.96", () => {
  // 双尾 95% 的标准值
  assert.equal(t95(5), 2.571, "df=5（n=6）");
  assert.equal(t95(1), 12.706, "df=1");
  assert.equal(t95(10), 2.228, "df=10");
  // n=6 的乘数必须明显大于 1.96，否则这条闸等于没改
  assert.ok(t95(5) / 1.96 > 1.25, `t(5)/z = ${(t95(5) / 1.96).toFixed(2)}，压窄了区间`);
});

test("区间乘数：大样本趋近 1.96，不许反而变宽", () => {
  assert.ok(t95(200) <= 1.99 && t95(200) >= 1.96, `t(200)=${t95(200)}`);
  // 单调不增
  let prev = Infinity;
  for (const df of [1, 2, 5, 10, 20, 47, 100, 500]) {
    assert.ok(t95(df) <= prev, `t(${df})=${t95(df)} 比上一档还大`);
    prev = t95(df);
  }
});

test("区间乘数：插值档位落在相邻两档之间", () => {
  assert.ok(t95(43) > t95(60) && t95(43) < t95(40), `t(43)=${t95(43)} 不在 t(60)..t(40) 之间`);
});
