// 汉末纪年与季节。
//
// 这是**算法**，不是文案：它按年份算出年号，而不是查一张表。所以它不进 lib/i18n
// ——英文要的不是翻译这几个字，是另一套写法（"Xingping 1" 还是 "194 CE"），
// 那属于 docs/I18N-PLAN.md 的阶段 4（专名表），需要人判断，不是搬字符串。
//
// 抽成单独文件是为了能被测试读到（PlayClient.tsx 带 JSX，node --test import 不进来），
// 而它确实需要被测：这里原先把兴平写成了**繁体的「興平」**，是全仓库唯一一处，
// 于是同一个年号在 /game 上是「兴平元年」、在 /play 上是「興平元年」。
// 两边都跑得好好的，没有任何东西会报错。
//
// 注意**用相对路径而非 `@/` 别名**：本文件被 node 测试直接导入，而 node 不认
// tsconfig 的 paths。
const HAN_NUM = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

export function hanNum(n: number): string {
  if (n <= 10) return n === 10 ? "十" : HAN_NUM[n];
  if (n < 20) return `十${HAN_NUM[n - 10]}`;
  const t = Math.floor(n / 10), o = n % 10;
  return `${HAN_NUM[t]}十${o ? HAN_NUM[o] : ""}`;
}

export function eraName(year: number): string {
  if (year <= 193) return "初平四年";
  if (year <= 195) return year === 194 ? "兴平元年" : "兴平二年";
  const n = year - 195;                      // 196 = 建安元年
  // 建安止于二十五年（220）。再往后本剧本够不着，退回数字——
  // 竖排里靠 text-combine-upright 把三位数合成一格，不会一位一行地摞下来
  return n <= 25 ? `建安${n === 1 ? "元" : hanNum(n)}年` : `${year} 年`;
}

export const SEASON_CN = ["", "春", "夏", "秋", "冬"];
