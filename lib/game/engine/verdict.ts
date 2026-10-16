// 判词：预告给出的那几个词。攻城「破城/不破/未知」、野战「溃退/后撤/相持/大败」、
// 赴援「可解围/解不了/未知」。
//
// 与适性（aptitude.ts）不同，这一类**危险的那一半已经有闸了**：它们是 TypeScript
// 的字面量联合类型，写错一个字是编译错误，而不是一个永远不触发的分支。
// 所以这里不是在堵洞，是在把 docs/I18N-PLAN.md 阶段 0 要的那条线画出来——
//
//   判词本身是 **id**：bot.ts 拿它做决策（`verdict === "解不了"` 就不去送死），
//   观测里也按它写。id 换了语言，机器人的分支与模型读到的观测一起变，新旧榜不可比。
//
//   显示名是**另一回事**：界面上那几个字可以是别的语言，而判等不该跟着动。
//
// 两者今天逐字相同，意义在于它们**可以**不同。英文界面要加的是下面这几张表的
// 另一份，而不是另一套联合类型。

export const SIEGE_VERDICTS = ["破城", "不破", "未知"] as const;
export const RELIEF_VERDICTS = ["可解围", "解不了", "未知"] as const;
export const FIELD_OUTCOMES = ["溃退", "后撤", "相持", "大败"] as const;

export type SiegeVerdict = (typeof SIEGE_VERDICTS)[number];
export type ReliefVerdict = (typeof RELIEF_VERDICTS)[number];

/** 按用途命名，省得在 bot.ts 里散落字面量 */
export const V = {
  breach: "破城",
  hold: "不破",
  unknown: "未知",
  canRelieve: "可解围",
  cannotRelieve: "解不了",
} as const;

const same = <T extends readonly string[]>(xs: T) =>
  Object.fromEntries(xs.map((x) => [x, x])) as Record<T[number], string>;

export const SIEGE_VERDICT_CN = same(SIEGE_VERDICTS);
export const RELIEF_VERDICT_CN = same(RELIEF_VERDICTS);
export type FieldOutcome = (typeof FIELD_OUTCOMES)[number];
export const FIELD_OUTCOME_CN = same(FIELD_OUTCOMES);
