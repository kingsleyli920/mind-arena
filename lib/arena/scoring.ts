// 档位到分数的唯一来源。
//
// 此前这张表在 tools/selfplay.mjs:43 与 tests/selfplay.test.mjs:30 各存了一份，
// 引擎与内容包都不知道分数。两份副本迟早分家，而分家的那一刻，
// 自对局验收与评测报告会各按各的算，谁也不知道哪个对。
import type { Grade } from "../game/engine/types.ts";

export const GRADE_SCORE: Record<Grade, number> =
  { ding: 0, bing: 100, yi: 200, jia: 300, chao: 400, ba: 500, wang: 600 };

/**
 * 细分名次：档位分 + 档内进度，用来做**配对比较**，不改档位本身。
 *
 * 四档太粗，两个明显不同的结局会被记成平手：一次实测里同 seed 的两臂
 * 一个 28 郡、一个 44 郡，都判甲档 300 分，配对差 0——差了十六个郡却算平局。
 * 每局的配对差只能取 0 或 ±100，噪声因此天然很大，48 局的下限正是被它逼出来的。
 *
 * 档内进度必须长在**定档判据自己的轴上**。此前试过拿郡数增量救场，没用：
 * 目的流拿分更高而占郡更少（−0.4 郡），因为它挑的是值钱的郡不是多的郡——
 * 郡数不是目标函数。定档看的是州与州治，所以细分也看它们，
 * 郡数只在同州同州治时兜底。
 *
 * 三级字典序压进 0–99 的带内：州增量 → 州治增量 → 郡增量。
 * 档位分仍是头号指标，这一项只在同档时起作用，因此不会与档位排序打架。
 *
 * **它并不会让统计更灵敏**，这一点要说清楚。在一组 12 局的配对数据上实测：
 *   四档   配对差 +92 ± 74  平局 2/12
 *   细分   配对差 +101 ± 81  平局 0/12
 * 平局是消掉了，但连续项自己带进方差，信噪比几乎没动（1.24 → 1.25）。
 * 它的价值在**可读**而不在功效：一张两个对局方同分、而疆域差十六个郡的榜，
 * 读者会据此得出错误结论。48 局的下限不因为有了它就能放松
 */
export function fineScore(r: {
  grade: Grade; zhou: number; startZhou?: number;
  seats?: number; startSeats?: number;
  commanderies: number; start: number;
}): number {
  const dZhou = r.zhou - (r.startZhou ?? 0);
  const dSeat = (r.seats ?? 0) - (r.startSeats ?? 0);
  const dJun = r.commanderies - r.start;
  // 各级的量程取得比实际跨度宽，保证低一级永远压不过高一级
  const frac = Math.min(0.99,
    Math.max(0, Math.min(dZhou, 12)) / 13
    + Math.max(0, Math.min(dSeat, 12)) / 13 / 13
    + Math.max(0, Math.min(dJun, 90)) / 100 / 13 / 13);
  return GRADE_SCORE[r.grade] + 100 * frac;
}

/**
 * **连续名次**：把定档那道台阶摊成斜坡，用来做配对比较。
 *
 * 与上面的 fineScore 不是一回事。fineScore 是字典序压位，只在同档时破平局，
 * 连续项被压到 1/13、1/169 的量级，几乎不带信息——实测平局从 2/12 消到 0/12，
 * 但信噪比只从 1.24 走到 1.25，等于没用。
 *
 * 这一个换了做法：不在档位上加小数，而是**直接量定档判据的连续版**。
 * 州进度（zhouEquiv：每州按「我方郡数 ÷ 过半所需」计、封顶 1）加上州治，
 * 都取相对开局的增量，再乘 100 对齐档位的百步尺。
 *
 * 州治的权重取 0.5：定档里「多控 1 州」与「多据 1 州治」同为乙，
 * 而「多控 1 州 + 多据 2 州治」与「多控 2 州」同为甲——即一个州治约合半个州。
 *
 * **它到底有没有把噪声压下去，要用机器人对局实测**，不能想当然。
 * 见 docs/EVAL.md：好看不等于有用，fineScore 就是前车之鉴
 */
export function contScore(r: {
  zhouEquiv: number; startZhouEquiv?: number;
  seats?: number; startSeats?: number;
}): number {
  const dz = r.zhouEquiv - (r.startZhouEquiv ?? 0);
  const ds = (r.seats ?? 0) - (r.startSeats ?? 0);
  return 100 * (dz + 0.5 * ds);
}

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
