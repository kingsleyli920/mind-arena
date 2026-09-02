// 观测：一方能看到什么。
//
// 此前候选标签直接写真实守军（actions.ts 的 `敌守军约 ${tgt.garrison}`），
// intel 只用来决定「哪些郡还值得刺探」——于是迷雾是装饰性的：
// 刺探这条动作什么也买不到，而模型将在完全信息下被评测，
// 情报这一整个维度测不出来。
//
// 内容包对此有明文规定（constants.情报）：未探按 13 档等比 1.4 显示，
// 已探为 ±15% 的点估计。这里把它实现出来。
import { roll } from "./rng.ts";
import type { EngineParams } from "./params.ts";
import type { CommanderyId, FactionId, GameState } from "./types.ts";

export interface Observed {
  /** 给模型看的数值。未探时是档位中值，已探时是带偏差的点估计 */
  value: number;
  /** 未探 / 已探 */
  scouted: boolean;
  /** 写进 label 的说法 */
  text: string;
}

/**
 * 某方观测到的某郡守军。
 *
 * 确定性：同一 seed、同一季、同一郡必得同一读数，否则同一回合内反复调用
 * listActions 会读出不同的数，模型看到的候选会自己抖动，R33 的逐位重放也不成立。
 * 偏差只按坐标派生，不掷骰。
 */
export function observedGarrison(
  s: GameState, viewer: FactionId, id: CommanderyId, P: EngineParams,
): Observed {
  const c = s.commanderies[id];
  if (!c) return { value: 0, scouted: false, text: "不详" };
  // 己方与盟友的郡是自家账本，看得真切
  if (c.owner === viewer) return { value: c.garrison, scouted: true, text: String(c.garrison) };
  const allied = s.treaties.some((t) => t.until > s.turn
    && ((t.a === viewer && t.b === c.owner) || (t.b === viewer && t.a === c.owner)));
  if (allied) return { value: c.garrison, scouted: true, text: String(c.garrison) };

  const until = s.intel[viewer]?.[id] ?? -1;
  if (until >= s.turn) {
    // 已探：±15% 点估计。偏差按坐标定死，一季之内不变
    const r = roll({ seed: s.seed, year: s.year, season: s.season,
                     faction: viewer, event: `intel:${id}`, seq: 0 });
    const v = Math.max(1, Math.round(c.garrison * (1 + (r - 0.5) * 2 * P.intelErrorRatio)));
    return { value: v, scouted: true, text: `约 ${v}（已探，误差 ±15%）` };
  }

  // 未探：只知道档位。等比 1.4 分 13 档，报中值与区间
  const tier = tierOf(c.garrison, P);
  const lo = Math.round(P.intelTierBase * P.intelTierRatio ** (tier - 1));
  const hi = Math.round(lo * P.intelTierRatio);
  return {
    value: Math.round((lo + hi) / 2),
    scouted: false,
    text: `${lo}–${hi} 之间（第 ${tier} 档，未探）`,
  };
}

/** 守军的观测档位，1..13。等比 1.4 */
export function tierOf(garrison: number, P: EngineParams): number {
  const t = 1 + Math.floor(Math.log(Math.max(1, garrison) / P.intelTierBase)
                         / Math.log(P.intelTierRatio));
  return Math.min(P.intelTiers, Math.max(1, t));
}
