// 判定每名武将在某年是否可登场，并把判据一并写下。
//
// 808 人里 653 人无生卒年，若在引擎里隐式猜「大概在场吧」，
// 会让丁奉（卒 271）、费祎、董允这些明显还是孩童的人出现在 194 年。
// 因此把判定提到数据层，每条都带 basis，可被逐条推翻。
//
// 判据优先级（先命中先用）：
//   1. 有生年     → 需年满 16 且未卒
//   2. 有归属     → affiliation194 是「此人本年正在某方任职」的直接史证
//   3. 有卒年     → 须未卒于本年之前；且卒年距本年 > 50 者，本年必未成年
//                   （长寿者会被误伤，见 caveat）
//   4. 皆无       → 无证据，不登场
import fs from "node:fs";

const YEAR = Number(process.argv[2] ?? 194);
const ADULT = 16;
const LIFESPAN_GAP = 50;

const officers = JSON.parse(fs.readFileSync("lib/game/data/officers.json", "utf8"));
const out = [];
const tally = {};
const bump = (k) => { tally[k] = (tally[k] ?? 0) + 1; };

for (const o of officers) {
  const { birthYear: b, deathYear: d, affiliation194: aff } = o;
  let ok, basis;
  if (b) {
    ok = b <= YEAR - ADULT && (!d || d >= YEAR);
    basis = `生 ${b}${d ? `–卒 ${d}` : ""}，${YEAR} 年${ok ? `年 ${YEAR - b}` : b > YEAR - ADULT ? `未满 ${ADULT}` : "已卒"}`;
  } else if (aff) {
    ok = true;
    basis = `《officers.json》affiliation194=${aff}，本年任职于此，为在场直证`;
  } else if (d) {
    // 两侧都要判：只判上界会把张梁（卒 184）这类本年已故者放进名册
    const gone = d < YEAR;
    ok = !gone && d - YEAR <= LIFESPAN_GAP;
    basis = gone ? `无生年；卒 ${d}，早于本年 ${YEAR - d} 年，本年已故`
      : `无生年；卒 ${d}，距本年 ${d - YEAR} 年${ok ? "，本年可为成人" : `＞${LIFESPAN_GAP}，本年必未成年`}`;
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
for (const [k, v] of Object.entries(tally).sort()) console.log(` ${k} ${v}`);
