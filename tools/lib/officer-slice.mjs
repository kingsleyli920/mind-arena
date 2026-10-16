// 剧本切片下的武将在场判定。**工具与测试共用这一份**——
// 这条规则此前在 tools/build-officer-availability.mjs 与 tests/pack-drift.test.mjs
// 各抄了一遍，而它们问的是同一个问题。
export const ADULT = 16;

/**
 * 全量数据里「本年」一律指 194 年——officers.json 是按兴平元年那个切片写的。
 * 所以 note 里的否决证据要记成**生年下界**，不能记成布尔：
 * 「194 年未生」到 211 年才可能成年，「194 年尚幼」195 年就可能及冠，差十六年。
 */
export const NOTE_YEAR = 194;

/**
 * 从 historicalNote 里读出编者下的未成年断言，换算成生年下界。
 *
 * 逐个扫「本年」出现处、取到句读为止的一段再判，**不能用惰性正则一次命中**：
 * 「本年幼或未生」上惰性匹配只吃到「本年幼」，于是毕轨、邓飏、丁谧、郝昭
 * 这批本传写着「幼或未生」的人会按「尚幼」（下界 178）放行，而他们该按
 * 「未生」（下界 194）拦住。实测 200 年切片因此多放 4 人。
 *
 * 返回 null 表示本传没有这类断言——那是证据缺失，不是证据支持他在场。
 */
export function adultFrom(note) {
  for (const m of (note ?? "").matchAll(/本年[^。；]{0,10}/g)) {
    const span = m[0];
    // 否决词只认「未生」与「幼」一系。**「年少」不算**：古汉语「少年」指青年，
    // 不是未成年——田豫本传「本年少年，自托于刘备甚见亲待」正是说他在场。
    // 把「年少」收进来会误伤田豫、魏延、刘巴、廖化、邓芝、杨仪等 13 人
    if (!/未生|尚幼|幼/.test(span)) continue;
    const bound = span.includes("未生") ? NOTE_YEAR : NOTE_YEAR - ADULT;
    return { phrase: span, bound, from: bound + 1 + ADULT };
  }
  return null;
}

/**
 * 此人在 (year, month) 这个切片时是否已故。
 * 卒年等于切片年而月份缺载者作「正月即卒」——保守的一侧：岁末切片下与
 * 「卒于本年一律已故」逐人相同，年初切片宁可少一人，不凭空让人活着。
 */
export function goneBy(o, year, month) {
  const d = o.deathYear;
  if (!d) return false;
  if (d !== year) return d < year;
  return (o.deathMonth ?? 1) <= month;
}

/**
 * 某剧本年此人在谁手下。
 *
 * officers.json 的基准字段是 affiliation194——字段名就带着年份，因为它记的是
 * **兴平元年**的归属，不是一生的主君（张辽此年属吕布、徐晃此年属杨奉）。
 * 换个剧本年就要重判：建安五年里吕布、袁术、公孙瓒、刘繇、王朗、陆康、李傕、
 * 张济、张杨都已不在，而程普韩当黄盖吕范孙贲连同**孙策本人**仍挂在袁术名下。
 *
 * 用 hasOwn 而不是 ??：`affiliation200: null` 要能表达「本年无主」（纪灵、陈兰、
 * 白波诸帅这些人随旧主覆灭而去向失载），而 ?? 会把它悄悄退回 194 年的归属。
 */
export function affiliationIn(o, year) {
  const key = `affiliation${year}`;
  return Object.hasOwn(o, key) ? (o[key] ?? null) : (o.affiliation194 ?? null);
}
