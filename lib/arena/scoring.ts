// 档位到分数的唯一来源。
//
// 此前这张表在 tools/selfplay.mjs:43 与 tests/selfplay.test.mjs:30 各存了一份，
// 引擎与内容包都不知道分数。两份副本迟早分家，而分家的那一刻，
// 自对局验收与评测报告会各按各的算，谁也不知道哪个对。
import type { Grade } from "../game/engine/types.ts";

export const GRADE_SCORE: Record<Grade, number> = { jia: 300, yi: 200, bing: 100, ding: 0 };

/** 从内容包核对：包里的名额分与这张表必须一致 */
export function checkScoringAgainstPack(pack: unknown): string[] {
  const errs: string[] = [];
  const vs = (pack as { victory?: Array<{ id: string; description?: string }> }).victory ?? [];
  for (const v of vs) {
    const m = /名额分 (\d+)/.exec(v.description ?? "");
    if (!m) { errs.push(`victory.${v.id} 的说明里没有「名额分 N」`); continue; }
    const want = GRADE_SCORE[v.id as Grade];
    if (want === undefined) { errs.push(`未知档位 ${v.id}`); continue; }
    if (Number(m[1]) !== want) errs.push(`${v.id}：包里 ${m[1]}，代码里 ${want}`);
  }
  return errs;
}
