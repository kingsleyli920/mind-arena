// 攻城判定。从 resolve.ts 抽出来，供结算与预告共用。
//
// 抽出来是为了消灭「预告与结算两份公式」的漂移——那正是 params.ts 开头
// 警告过的失败模式：模型按一套算、引擎按另一套结算，算出来对不上，
// 而且不会报错。放在同一个函数里，两边就没有机会分家。
import type { EngineParams } from "./params.ts";
import type { SiegeGear } from "./types.ts";

/**
 * 兵种系数。内容包定义了四个兵种而引擎一度零引用——兵种是纯装饰。
 * 地形系数缺项在 loadParams 就抛错，此处不兜底。
 */
export function unitPower(P: EngineParams, unit: string, terrain: string, foe: string | null): number {
  const u = P.units[unit];
  if (!u) return 1;
  const counter = foe && u.strongAgainst.includes(foe) ? P.counterBonus : 0;
  return u.attack * (u.terrain[terrain] ?? 1) * (1 + counter);
}

export function unitGuard(P: EngineParams, unit: string): number {
  return P.units[unit]?.defense ?? 1;
}

export const unitName = (P: EngineParams, unit: string) => P.units[unit]?.name ?? unit;

/**
 * 缺口数 vs 守方可防守数（MERS R23–R24）。
 *
 * 用「缺口数」而非「兵力比」是刻意的——比值是连续量，模型难以心算出
 * 自己究竟够不够；缺口数是小整数，一眼可数。
 */
export function breachCount(
  P: EngineParams, attack: number, defend: number, defense: number,
  gear: SiegeGear, terrain: string, atGate: boolean,
  breachBonus = 0, holdBonus = 0,
): { breach: number; hold: number } {
  const terrainDef = P.terrainDefense[terrain] ?? 0;
  const eff = defend * (1 + terrainDef);
  const ratio = eff > 0 ? attack / eff : 99;
  let base = 0;
  for (const [threshold, n] of P.breachLadder) { if (ratio >= threshold) { base = n; break; } }
  const gearBonus = atGate ? Math.floor(P.gearBreach[gear] / 2) : P.gearBreach[gear];
  return {
    breach: base + gearBonus + breachBonus,
    hold: holdOf(P, defend, defense, holdBonus),
  };
}

/**
 * 可防守数。城防必须算进来——首版只看守军数，30–100 的城防等于白算，
 * 「修城」这条内政毫无用处，攻城易如反掌：自对局实测第一季就有 17 个郡
 * 易主，96% 是势力互夺。
 */
export function holdOf(P: EngineParams, defend: number, defense: number, holdBonus: number): number {
  return P.holdBase
    + Math.floor(defense / P.defensePerHold)
    + Math.max(0, Math.floor(Math.log2(Math.max(1, defend / P.garrisonPerHold))))
    + holdBonus;
}

/**
 * 野战判词。抽出来的理由与 breachCount 完全相同：
 * 预告与结算若各写一份阶梯，两边算出的结果对不上，而且不会报错。
 *
 * 此前赴援候选**根本没有预告**，机器人只好拿「兵力比 ≥0.9」当判据——
 * 而野战比的是 兵力 × 武将加成 × 兵种系数，不是raw 兵力。
 * 后果实测：62% 的野战在战力比 <0.8 时发起，直接大败，中位战力比 0.71。
 */
export function fieldOutcome(P: EngineParams, ratio: number): {
  outcome: "溃退" | "后撤" | "相持" | "大败";
  atkLoss: number; foeLoss: number; atkWins: boolean;
} {
  if (ratio >= P.fieldRout) {
    return { outcome: "溃退", atkLoss: P.fieldRoutWinnerLoss,
             foeLoss: P.fieldRoutLoserLoss, atkWins: true };
  }
  if (ratio >= P.fieldPush) {
    return { outcome: "后撤", atkLoss: P.fieldPushWinnerLoss,
             foeLoss: P.fieldPushLoserLoss, atkWins: true };
  }
  if (ratio >= P.fieldStall) {
    return { outcome: "相持", atkLoss: P.fieldStallLoss,
             foeLoss: P.fieldStallLoss, atkWins: false };
  }
  return { outcome: "大败", atkLoss: P.fieldDefeatLoss,
           foeLoss: P.fieldRoutWinnerLoss, atkWins: false };
}
