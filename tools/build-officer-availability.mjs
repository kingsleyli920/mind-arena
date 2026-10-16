// 判定每名武将在某年是否可登场，并把判据一并写下。
//
// 808 人里 653 人无生卒年，若在引擎里隐式猜「大概在场吧」，
// 会让丁奉（卒 271）、费祎、董允这些明显还是孩童的人出现在 194 年。
// 因此把判定提到数据层，每条都带 basis，可被逐条推翻。
//
// 判据优先级（先命中先用）：
//   1. 有生年     → 需年满 16 且未卒
//   2. 有归属     → affiliation194 是「此人本年正在某方任职」的直接史证，
//                   但仍要过生死与成年两道闸门（见下）
//   3. 有卒年     → 须未卒于本年及以前；且卒年距本年 > 50 者，证据不足
//                   （长寿者会被误伤，见 caveat）
//   4. 皆无       → 无证据，不登场
//
// **卒于本年者一律不登场**。剧本切片取兴平元年岁末（见 scenario-194.json 的 meta），
// 那时陶谦、刘焉、马日磾都已死——而剧本自己的 note 就写着「陶谦已卒」「刘焉已卒」。
// 判据曾写作 `d >= YEAR`，于是这七人照常登场，与剧本自己的元数据直接矛盾。
// 引擎里武将不会老死，一个 194 年就该死的人会一路活到 197 年终局。
// 换成年初切片的剧本时，这条要逐人补卒月，不能只改这个不等号。
//
// **归属分支必须过同样的闸门**。它原本无条件放行，理由是「有归属即在场直证」；
// 但归属记的是「此人属于哪一方」，不是「此人本年在场」——于是曹彰（本年 5 岁）、
// 孙匡、袁尚、刘豹这些 officers.json 自己的 note 都写着「本年尚幼」「本年未生」
// 的人照常入册。note 里的这句话是编者自己下的否决证据，这里就该认它。
import fs from "node:fs";

const YEAR = Number(process.argv[2] ?? 194);
const ADULT = 16;
const LIFESPAN_GAP = 50;
/**
 * 「本年尚幼」这类话是编者在 historicalNote 里自己下的否决证据。
 * 用正则读散文是脆的，所以下面会把命中的人逐个打出来——
 * 名单变了看得见，比一个悄悄变化的计数强。
 *
 * **记成生年下界，不记成布尔。** 这些 note 里的「本年」指的是 194 年——
 * 全量数据是按兴平元年那个切片写的。写成布尔，换个年份的剧本就读错了：
 * 「194 年未生」到 211 年才可能成年，而「194 年尚幼」只说明他那年不满 16，
 * 到 195 年就已经可能及冠。两者差了十六年，不能混为一条。
 *
 * 下界取法：
 *   含「未生」（含「幼或未生」「尚幼或未生」「年少或未生」）→ 生年 > 194
 *   只写「尚幼」「幼」「当尚幼」                              → 生年 > 194 − 16 = 178
 * 于是可登场的最早年份是「下界 + 17」。194 年两者都拦得住，而拦住的理由
 * 第一次是**说得出口的**，不是靠卒年差值那个阈值碰巧够不着。
 */
const TOO_YOUNG = /本年[^。；]{0,8}?(未生|尚幼|当尚幼|幼)/;
const ADULT_FROM = (note) => {
  const m = TOO_YOUNG.exec(note ?? "");
  if (!m) return null;
  const bound = m[0].includes("未生") ? 194 : 194 - ADULT;
  return { phrase: m[0], bound, from: bound + 1 + ADULT };
};

const officers = JSON.parse(fs.readFileSync("lib/game/data/officers.json", "utf8"));
const out = [];
const youngList = [];
const tally = {};
const bump = (k) => { tally[k] = (tally[k] ?? 0) + 1; };

for (const o of officers) {
  const { birthYear: b, deathYear: d, affiliation194: aff } = o;
  let ok, basis;
  if (b) {
    ok = b <= YEAR - ADULT && (!d || d > YEAR);
    basis = `生 ${b}${d ? `–卒 ${d}` : ""}，${YEAR} 年${ok ? `年 ${YEAR - b}` : b > YEAR - ADULT ? `未满 ${ADULT}` : "已卒"}`;
  } else if (aff) {
    const dead = d && d <= YEAR;
    const y = ADULT_FROM(o.historicalNote);
    const young = y !== null && YEAR < y.from;
    ok = !dead && !young;
    basis = dead ? `affiliation194=${aff}，然卒 ${d}，本年岁末已故`
      : young ? `affiliation194=${aff}，然本传记「${y.phrase}」，生年 >${y.bound}，${YEAR} 年未满 ${ADULT}`
      : `《officers.json》affiliation194=${aff}，本年任职于此，为在场直证`;
    if (young) youngList.push(o.name);
  } else if (d) {
    // 两侧都要判：只判上界会把张梁（卒 184）这类本年已故者放进名册
    const gone = d <= YEAR;
    // **这一支此前不认否决证据。** 它原本只比卒年差值，于是曹真、公孙渊、
    // 傅肜、向宠这些本传明写「本年尚幼」「本年未生」的人照常入 194 年名册——
    // 实测 12 人。他们之所以没全进来，只是因为正始那一代卒于 249、
    // 距 194 年 55 > 50 刚好够不着；切到 200 年差值变 49，整批就都放行了。
    // 侥幸不是判据，这里和「有归属」那一支认同一份证据
    const y = ADULT_FROM(o.historicalNote);
    const young = y !== null && YEAR < y.from;
    ok = !gone && !young && d - YEAR <= LIFESPAN_GAP;
    // 「必未成年」是一句能被单条史料证伪的断言，而这里其实只是**证据不足**：
    // 孙资、向朗生年史无明文，卒年距本年远只说明我们不知道，不说明他年幼。
    // 语气写死会让读者以为已有判据，反而比「证据不足」更难被推翻
    basis = gone ? `无生年；卒 ${d}，${d === YEAR ? "卒于本年" : `早于本年 ${YEAR - d} 年`}，本年已故`
      : young ? `无生年；本传记「${y.phrase}」，生年 >${y.bound}，${YEAR} 年未满 ${ADULT}`
      : `无生年；卒 ${d}，距本年 ${d - YEAR} 年${ok ? "，本年可为成人" : `＞${LIFESPAN_GAP}，证据不足`}`;
    if (young) youngList.push(o.name);
  } else {
    ok = false;
    basis = "生卒年与本年归属俱无，无在场证据";
  }
  bump(`${ok ? "登场" : "不登场"}·${b ? "生年" : aff ? "归属" : d ? "卒年" : "无据"}`);
  out.push({ id: o.id, name: o.name, available: ok, basis });
}

const avail = out.filter((x) => x.available);
fs.writeFileSync(`lib/game/data/officer-availability-${YEAR}.json`, JSON.stringify({
  year: YEAR,
  rule: `生年优先；无生年则以 affiliation194 为直证；再无则卒年距本年 >${LIFESPAN_GAP} 判为未成年；皆无则不登场`,
  caveat: `卒年规则会误伤长寿者——甘宁 194 年已在益州，因生卒年俱无而判为不登场。`
        + "此为已知假阴性，逐条修正需补生年，见各条 basis。",
  available: avail.length,
  officers: out,
}, null, 1) + "\n");

console.log(`${YEAR} 年可登场 ${avail.length}/${officers.length}`);
if (youngList.length) {
  console.log(`  因本传记「本年尚幼／未生」而不登场：${youngList.join("、")}`);
}
for (const [k, v] of Object.entries(tally).sort()) console.log(` ${k} ${v}`);
