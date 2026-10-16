// 「空手季」：引擎摆了候选出来，而模型一条令也没挑。
//
// 单独拎出来，是因为摘要里的「令数用率」会把两种病平均成一个数。挑便宜模型时
// 我见过 38%，读成「它打得保守」——实际是四季里两季把 32k 出参预算全烧在推理上、
// 一条令都没下，另两季正常地下了十一条。保守和交白卷是两回事，而均值分不开。
//
// 注意它与 lib/arena/llm/errors.ts 的失败分类不重叠：那边管的是「这次调用算谁的
// 账」（credits/auth/infra/budget/harness/model），这边管的是「调用成功了，可是
// 它什么也没说」。一季可以既不计失败、又是空手季——qwen3.5-9b 第 4 季正是如此。

/** 判一季是不是空手：有候选而 picks 为 0。候选数未知（—）时不判，宁可漏 */
export const isEmpty = (m) => (m?.candidates ?? 0) > 0 && (m?.picks ?? 0) === 0;

/** 超过这个比例就不该再把这一局当「这个模型怎么打」来读 */
export const EMPTY_WARN = 0.25;

export function emptySeasons(meta) {
  const list = (meta ?? []).filter(isEmpty);
  const share = list.length / Math.max(1, (meta ?? []).length);
  return { list, share, warn: share >= EMPTY_WARN };
}
