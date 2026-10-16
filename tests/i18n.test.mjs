// 界面文案目录的闸。
//
// 文档那边的漂移靠哈希戳拦（tests/bilingual-drift.test.mjs），界面这边拦不住——
// 一条文案没译，页面照样渲染，只是退回中文；少一个 {参数}，句子里就留个洞。
// 两种都不报错，所以得在这里拦。
//
// 还有一条**棘轮**：迁完的文件进 MIGRATED 名单，名单里的文件不许再出现裸中文。
// 只增不减。没有它，迁移就是一场永远差一点的拉锯——新写的组件会顺手又塞中文进去，
// 而「还有多少没迁」谁也说不清。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DICTS, LOCALES, DEFAULT_LOCALE, holesIn, translate, withLocale, localeFromPath }
  from "../lib/i18n/index.ts";
import { splitMarks, marksIn, marksBalanced } from "../lib/i18n/marks.ts";

test("目录：两份 key 集合必须一一对应", () => {
  const zh = Object.keys(DICTS.zh).sort();
  const en = Object.keys(DICTS.en).sort();
  const missing = zh.filter((k) => !(k in DICTS.en));
  const extra = en.filter((k) => !(k in DICTS.zh));
  assert.deepEqual(missing, [], `英文目录缺这些 key：${missing.join("、")}`);
  assert.deepEqual(extra, [],
    `英文目录多出这些 key：${extra.join("、")}——中文是源，多出来的多半是改名时漏删`);
});

test("目录：没有空值，也没有「还没译」的占位", () => {
  for (const loc of LOCALES) {
    for (const [k, v] of Object.entries(DICTS[loc])) {
      assert.ok(v.trim().length, `${loc} 的 ${k} 是空的`);
      assert.ok(!/^(TODO|TBD|FIXME|待译)/i.test(v.trim()), `${loc} 的 ${k} 还是占位：${v}`);
    }
  }
});

test("目录：每条文案的 {参数} 两边必须一致", () => {
  // 少一个参数不会报错，只会在句子里留个洞——比如英文版漏掉 {baseline}，
  // 页面上就是「Strongest bot baseline: .」
  const bad = [];
  for (const k of Object.keys(DICTS.zh)) {
    const a = holesIn(DICTS.zh[k]).join(",");
    const b = holesIn(DICTS.en[k] ?? "").join(",");
    if (a !== b) bad.push(`${k}：zh{${a}} ≠ en{${b}}`);
  }
  assert.deepEqual(bad, [], `参数对不上：\n  ${bad.join("\n  ")}`);
});

test("目录：英文里不许夹中文", () => {
  // 有意保留汉字的几条。每加一条都要说得出理由，否则这条闸就成了摆设：
  //   lang.switch        语言开关上印的就是「中文」两个字
  //   lab.game.0N.symbol 模块图标是**字形**不是文案，英文版照用同一个字
  const ALLOW = new Set([
    "lang.switch",
    "lab.game.01.symbol", "lab.game.02.symbol",
    "lab.game.03.symbol", "lab.game.04.symbol",
  ]);
  const hit = Object.entries(DICTS.en)
    .filter(([k, v]) => !ALLOW.has(k) && /[一-鿿]/.test(v))
    .map(([k, v]) => `${k}：${v}`);
  assert.deepEqual(hit, [],
    `英文目录里还留着中文：\n  ${hit.join("\n  ")}\n`
    + "  有意保留的（比如语言切换按钮上的「中文」）加进这条测试的 ALLOW");
});

test("取文案：缺 key 返回 key 本身，不抛错", () => {
  assert.equal(translate("en", "no.such.key"), "no.such.key");
  // 英文缺而中文有时退回中文，不是退回 key——半句中文好过一串点号
  const probe = Object.keys(DICTS.zh)[0];
  assert.equal(translate("en", probe), DICTS.en[probe]);
});

test("取文案：参数照填，缺参数原样留着", () => {
  assert.equal(translate("zh", "home.roster.measured", { games: 48 }), "实测 · 48 局");
  // 漏传参数时留着 {games} 而不是变成 undefined——前者一眼看得出是哪儿漏了
  assert.ok(translate("zh", "home.roster.measured").includes("{games}"));
});

test("路径：英文在 /en 下，中文不带前缀", () => {
  assert.equal(withLocale("zh", "/board"), "/board");
  assert.equal(withLocale("en", "/board"), "/en/board");
  assert.equal(withLocale("en", "/"), "/en");
  assert.equal(localeFromPath("/en"), "en");
  assert.equal(localeFromPath("/en/board"), "en");
  assert.equal(localeFromPath("/board"), "zh");
  // 「/enemy」不是英文版
  assert.equal(localeFromPath("/enemy"), "zh");
  assert.equal(DEFAULT_LOCALE, "zh");
});

test("强调标记：两边都要成对，不许落单", () => {
  // `**` 落单不会报错，页面上就多出两个星号——而译者最容易漏掉收尾那一对
  const bad = [];
  for (const loc of LOCALES) {
    for (const [k, v] of Object.entries(DICTS[loc])) {
      if (!marksBalanced(v)) bad.push(`${loc} 的 ${k}：${v.slice(0, 50)}`);
    }
  }
  assert.deepEqual(bad, [], `强调标记落单：\n  ${bad.join("\n  ")}`);
});

test("强调标记：中文有强调的，英文不该一处都没有", () => {
  // 数量可以不同（中英的强调位置本来就不一样），但「中文标了英文一处没标」
  // 多半是译的时候把标记吃掉了
  const bad = [];
  for (const [k, v] of Object.entries(DICTS.zh)) {
    const a = marksIn(v), b = marksIn(DICTS.en[k] ?? "");
    if (a > 0 && b === 0) bad.push(`${k}：中文 ${a} 处强调，英文 0 处`);
  }
  assert.deepEqual(bad, [], `英文把强调吃掉了：\n  ${bad.join("\n  ")}`);
});

test("强调标记：切段切对，且切完能拼回原文", () => {
  assert.deepEqual(splitMarks("没有标记"), [{ text: "没有标记", bold: false }]);
  assert.deepEqual(splitMarks("前**中**后"), [
    { text: "前", bold: false }, { text: "中", bold: true }, { text: "后", bold: false },
  ]);
  // 开头与结尾就是强调时不许切出空段——空段会在页面上变成一个空的 <b>
  assert.deepEqual(splitMarks("**整句**"), [{ text: "整句", bold: true }]);
  // 切完拼回去必须等于去掉标记的原文。这条比逐段比更抓得住边界错
  for (const probe of ["a**b**c", "**a**b", "a**b**", "**a****b**", "纯文本", ""]) {
    const joined = splitMarks(probe).map((x) => x.text).join("");
    assert.equal(joined, probe.replaceAll("**", ""), probe);
  }
  // 落单的星号不当标记，原样留着（成对与否由上一条闸拦，这里只保证不炸）
  assert.equal(splitMarks("落单 ** 星号").map((x) => x.text).join(""), "落单 ** 星号");
  assert.equal(marksBalanced("落单 ** 星号"), false);
  assert.equal(marksBalanced("成对 **的** 标记"), true);
});

test("档位名：中文那份必须逐字等于引擎的 GRADE_CN", async () => {
  // 目录里的 grade.* 是**显示名**，引擎的 GRADE_CN 是 id。两者今天相同，
  // 而「相同」必须被钉住——否则哪天引擎改了档位名，榜上与规则速览会各说各的，
  // 且只在中文版上出错（英文那份本来就不同，看不出来）
  const { GRADE_CN } = await import("../lib/game/engine/victory.ts");
  for (const [g, cn] of Object.entries(GRADE_CN)) {
    assert.equal(DICTS.zh[`grade.${g}`], cn,
      `grade.${g} 的中文显示名与引擎的 GRADE_CN 对不上`);
  }
  // 反方向：目录里不许有引擎不认的档位
  for (const k of Object.keys(DICTS.zh)) {
    if (!k.startsWith("grade.")) continue;
    const g = k.slice("grade.".length);
    assert.ok(g in GRADE_CN, `目录里有引擎不认的档位 ${g}`);
  }
});

// ── 棘轮：迁完的文件不许再写裸中文 ─────────────────────────────────
//
// 名单只增不减。迁一个文件就往里加一个——回潮立刻红，而「还剩多少」
// 永远是「app/ 下的文件数 − 名单长度」，不用猜。
const MIGRATED = [
  "app/_shared/HomeView.tsx",
  "app/_shared/ArenaLab.tsx",
  "app/(zh)/layout.tsx",
  "app/(en)/layout.tsx",
  "app/(zh)/page.tsx",
  "app/(en)/en/page.tsx",
  "app/_shared/BoardView.tsx",
  "app/(zh)/board/page.tsx",
  "app/(en)/en/board/page.tsx",
  "app/_shared/Primer.tsx",
  "app/(zh)/play/SessionPanel.tsx",
  "app/(zh)/play/MatchSetup.tsx",
  "app/(zh)/play/StrategyPlanView.tsx",
  "app/(zh)/play/DecisionReviewView.tsx",
  "app/(zh)/play/SeasonReviewView.tsx",
  // panels.ts 迁完之后只剩 PANEL_ORDER（顺序与语言无关），一条文案都没有，
  // 所以它在上面这张「不许有裸中文」的名单里，不在下面那张「必须用到 t」的里
  "app/(zh)/play/panels.ts",
];

/**
 * 其中真正装着文案的那几个。薄包装（只写 `<HomeView locale="zh"/>`）本来就没有
 * 文案，拿「有没有用到 t」去要求它只会逼出一句假的调用
 */
const USES_CATALOGUE = [
  "app/_shared/HomeView.tsx",
  "app/_shared/ArenaLab.tsx",
  "app/_shared/BoardView.tsx",
  "app/_shared/Primer.tsx",
  "app/(zh)/play/SessionPanel.tsx",
  "app/(zh)/play/MatchSetup.tsx",
  "app/(zh)/play/StrategyPlanView.tsx",
  "app/(zh)/play/DecisionReviewView.tsx",
  "app/(zh)/play/SeasonReviewView.tsx",
];

/** 去掉注释后，还剩的中文字面量与 JSX 文本 */
function bareChinese(src) {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const out = [];
  for (const m of s.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) {
    if (/[一-鿿]/.test(m[0])) out.push(m[0].slice(0, 40));
  }
  const noStr = s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  for (const m of noStr.matchAll(/>([^<>{}]*)</g)) {
    const t = m[1].trim();
    if (t && /[一-鿿]/.test(t)) out.push(t.slice(0, 40));
  }
  return out;
}

test("棘轮：迁完的文件里不许再出现裸中文", () => {
  const bad = [];
  for (const f of MIGRATED) {
    assert.ok(fs.existsSync(f), `名单里的 ${f} 不存在了——迁移名单要跟着改名走`);
    const hit = bareChinese(fs.readFileSync(f, "utf8"));
    if (hit.length) bad.push(`${f}：${hit.join(" / ")}`);
  }
  assert.deepEqual(bad, [],
    `这些文件已经迁完了，又写回中文：\n  ${bad.join("\n  ")}\n`
    + "  文案进 lib/i18n/zh.ts 与 en.ts，组件里用 t('key')。\n"
    + "  若那是**数据键**（内容包的键名本来就是中文），别开白名单——"
    + "把它收进懂它的那个 lib 模块里，像 lib/arena/board-stale.ts 的 changeLogOf");
});

test("棘轮：名单里的文件确实在用目录", () => {
  // 防一种偷懒：把中文删了但没接目录，页面上变成空白
  for (const f of USES_CATALOGUE) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(/\bt\(|makeT|useT|translate\(/.test(src),
      `${f} 在迁移名单里，却没用到取文案的函数——是不是只把中文删了？`);
  }
});
