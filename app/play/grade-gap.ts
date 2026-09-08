// 「离下一档还差多少」——界面上两处都用它。
//
// 单独成文件是为了让测试能读到（PlayClient.tsx 带 JSX，测试里 import 不进来）。
// panels.ts 当年为同一个理由拆出来，而这次的教训一模一样：这件事在
// 状态栏与终局各硬编码了一遍，改门槛之后三处同时说错话——终局说
// 「已至甲档，本剧本的顶」（甲早已不是顶，上面还有超/霸/王），状态栏在甲档上
// 说「再多控 1 州 → 甲」，乙档那段用的是旧甲门槛 2 州。而全部测试是绿的，
// 因为没有一条测试读过它们。
import { GRADE_CUTS } from "../../lib/game/engine/victory.ts";
import type { Grade } from "../../lib/game/engine/types.ts";

/**
 * 离下一档还差多少——**从 GRADE_CUTS 算，不写死**。
 *
 * 此前这件事在两处各硬编码了一遍（状态栏一句、终局一句），门槛一改就双双
 * 说错话：改完之后终局还在说「已至甲档，本剧本的顶」（甲早已不是顶，上面
 * 还有超/霸/王），状态栏在甲档上还在说「再多控 1 州 → 甲」，而乙档那段用的
 * 是旧甲门槛 2 州。三处都错，而全部测试是绿的——因为没有一条测试读它们。
 *
 * 州分 = 多控州数 + 半个 × 多据州治数，与 gradeOf 同一条轴。
 */
export function nextGrade(zhouGain: number, seatGain: number): {
  grade: Grade | null; needZhou: number; needSeat: number; score: number;
} {
  const score = zhouGain + 0.5 * seatGain;
  const ladder: Array<[Grade, number]> = [["yi", GRADE_CUTS.yi], ["jia", GRADE_CUTS.jia],
                                          ["chao", GRADE_CUTS.chao]];
  const next = ladder.find(([, cut]) => score < cut);
  if (!next) return { grade: null, needZhou: 0, needSeat: 0, score };
  const gap = next[1] - score;
  // 差的那点可以用整州补，也可以用州治补（一个州治半个州）
  return { grade: next[0], needZhou: Math.ceil(gap), needSeat: Math.ceil(gap * 2), score };
}

