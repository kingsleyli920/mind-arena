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
import { ADULT, adultFrom, goneBy as sliceGoneBy } from "./lib/officer-slice.mjs";

const YEAR = Number(process.argv[2] ?? 194);
/**
 * 切片的月份。默认岁末——194 剧本取的就是兴平元年岁末（见 scenario-194.json 的
 * meta），所以「卒于本年者一律不登场」在那里是对的。
 *
 * 但年初切片不是这样。建安五年正月，颜良、文丑（四月白马、延津）、
 * 淳于琼、沮授（十月乌巢）、田丰（官渡败后）、孙策（四月遇刺）全都还活着——
 * 而他们正是官渡那一仗的主角。只比年份会把整台戏的角都判成已故。
 *
 * 月份未知者按「正月即卒」处理，即任何切片都算已故。这是保守的一侧：
 * 岁末切片下与原先逐人相同（1 ≤ 12 恒成立），而年初切片宁可少一个人，
 * 不凭空让一个卒年失载月份的人活着。要让某人活过切片，就得补 deathMonth 与出处。
 */
const MONTH = Number(process.argv[3] ?? 12);
/** 卒于本年而活过切片者，basis 里要把月份与出处亮出来，否则读者无从复核 */
const SURVIVES = (o) => `卒 ${o.deathYear} 年${o.deathMonth} 月，在本切片（${YEAR} 年 ${MONTH} 月）之后`;
const LIFESPAN_GAP = 50;
/**
 * 编者在 historicalNote 里下的未成年断言，与切片生死判定——
 * 两条都在 tools/lib/officer-slice.mjs，测试读的是同一份。
 * 下面的 youngList 仍把命中的人逐个打出来：名单变了看得见，
 * 比一个悄悄变化的计数强。
 */
const ADULT_FROM = adultFrom;
const goneBy = (o) => sliceGoneBy(o, YEAR, MONTH);

const officers = JSON.parse(fs.readFileSync("lib/game/data/officers.json", "utf8"));
const out = [];
const youngList = [];
const tally = {};
const bump = (k) => { tally[k] = (tally[k] ?? 0) + 1; };

for (const o of officers) {
  const { birthYear: b, deathYear: d, affiliation194: aff } = o;
  let ok, basis;
  if (b) {
    ok = b <= YEAR - ADULT && !goneBy(o);
    basis = `生 ${b}${d ? `–卒 ${d}` : ""}，${YEAR} 年${ok ? `年 ${YEAR - b}` : b > YEAR - ADULT ? `未满 ${ADULT}` : "已卒"}`
      + (ok && d === YEAR ? `（${SURVIVES(o)}）` : "");
  } else if (aff) {
    const dead = goneBy(o);
    const y = ADULT_FROM(o.historicalNote);
    const young = y !== null && YEAR < y.from;
    ok = !dead && !young;
    basis = dead ? `affiliation194=${aff}，然卒 ${d}${o.deathMonth ? ` 年 ${o.deathMonth} 月` : "（月份失载，作正月计）"}，本切片时已故`
      : young ? `affiliation194=${aff}，然本传记「${y.phrase}」，生年 >${y.bound}，${YEAR} 年未满 ${ADULT}`
      : `《officers.json》affiliation194=${aff}，本年任职于此，为在场直证`
        + (!dead && d === YEAR ? `；${SURVIVES(o)}` : "");
    if (young) youngList.push(o.name);
  } else if (d) {
    // 两侧都要判：只判上界会把张梁（卒 184）这类本年已故者放进名册
    const gone = goneBy(o);
    // **这一支此前不认否决证据。** 它原本只比卒年差值，于是曹真、公孙渊、
    // 傅肜、向宠这些本传明写「本年尚幼」「本年未生」的人照常入 194 年名册——
    // 实测 12 人。他们之所以没全进来，只是因为正始那一代卒于 249、
    // 距 194 年 55 > 50 刚好够不着；切到 200 年差值变 49，整批就都放行了。
    // 侥幸不是判据，这里和「有归属」那一支认同一份证据
    const y = ADULT_FROM(o.historicalNote);
    const young = y !== null && YEAR < y.from;
    ok = !gone && !young && d - YEAR <= LIFESPAN_GAP;   // d === YEAR 时差值 0，自然通过
    // 「必未成年」是一句能被单条史料证伪的断言，而这里其实只是**证据不足**：
    // 孙资、向朗生年史无明文，卒年距本年远只说明我们不知道，不说明他年幼。
    // 语气写死会让读者以为已有判据，反而比「证据不足」更难被推翻
    basis = gone ? `无生年；卒 ${d}，${d === YEAR ? `卒于本年${o.deathMonth ? ` ${o.deathMonth} 月` : "（月份失载，作正月计）"}` : `早于本年 ${YEAR - d} 年`}，本切片时已故`
      : young ? `无生年；本传记「${y.phrase}」，生年 >${y.bound}，${YEAR} 年未满 ${ADULT}`
      : d === YEAR ? `无生年；${SURVIVES(o)}`
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
  month: MONTH,
  slice: `${YEAR} 年 ${MONTH} 月`,
  rule: `生年优先；无生年则以 affiliation194 为直证；再无则卒年距本年 >${LIFESPAN_GAP} 判为未成年；皆无则不登场`,
  caveat: `卒年规则会误伤长寿者——甘宁 194 年已在益州，因生卒年俱无而判为不登场。`
        + "此为已知假阴性，逐条修正需补生年，见各条 basis。",
  available: avail.length,
  officers: out,
}, null, 1) + "\n");

console.log(`${YEAR} 年 ${MONTH} 月可登场 ${avail.length}/${officers.length}`);
const survivors = officers.filter((o) => o.deathYear === YEAR && !goneBy(o));
if (survivors.length) {
  console.log(`  卒于本年而活过切片：${survivors.map((o) => `${o.name}(${o.deathMonth}月)`).join("、")}`);
}
if (youngList.length) {
  console.log(`  因本传记「本年尚幼／未生」而不登场：${youngList.join("、")}`);
}
for (const [k, v] of Object.entries(tally).sort()) console.log(` ${k} ${v}`);
