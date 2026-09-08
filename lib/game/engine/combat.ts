// 攻城判定。从 resolve.ts 抽出来，供结算与预告共用。
//
// 抽出来是为了消灭「预告与结算两份公式」的漂移——那正是 params.ts 开头
// 警告过的失败模式：模型按一套算、引擎按另一套结算，算出来对不上，
// 而且不会报错。放在同一个函数里，两边就没有机会分家。
import type { EngineParams } from "./params.ts";
import type { Formation, SiegeGear } from "./types.ts";

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
/**
 * 围城累加的缺口修正。**首攻扣、围困加。**
 *
 * 实测机器人自对局：围城 4734 次里 92% 只持续一季——首攻就破了城，于是围城节
 * 自己写的目标「让『解围』『围魏救赵』『断其粮道』成为真选项」几乎从不发生，
 * 存粮那只钟只响 1.6%。原因是首攻不付任何代价：带三倍兵即缺口 4，而典型城池
 * 可防守才 2–3，首攻破城率 73%。史实上以三比一强攻坚城基本不会一次得手——
 * 攻城要先筑土工、造器械。
 *
 * 于是：首攻 −firstAssaultPenalty，此后每季 +siegeBreachPerSeason。
 * 即「强攻是赌，围困是稳」。
 *
 * 一处出处：结算、攻城预告、续围前瞻三处都读它。同一个量两个出处，
 * 这个仓库栽过不止一次（缺口曾在候选与结算各算一遍）。
 */
export function siegeBreachDelta(siegeSeasons: number, P: EngineParams): number {
  return siegeSeasons === 0
    ? -P.firstAssaultPenalty
    : siegeSeasons * P.siegeBreachPerSeason;
}

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
    // 兵力比够不着最低门槛（base = 0）时，任何加成都不能凭空造出缺口。
    // 器械、主将、阵型都只是放大已经撕开的口子，不是口子的来源——
    // 否则「三千人带冲车破两万人的城」就成立了，
    // 而且「把门槛调到不可达则永不破城」这条不变量会悄悄失效
    breach: base === 0 ? 0 : Math.max(0, base + gearBonus + breachBonus),
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

/**
 * 三阵相克：鱼鳞克鹤翼、鹤翼克方圆、方圆克鱼鳞。
 * 一个三元环，一张表就说得完——可枚举、可推理、奖励侦察。
 */
const BEATS: Record<Formation, Formation> = {
  scale: "wings", wings: "square", square: "scale",
};

export const FORMATION_CN: Record<Formation, string> = {
  scale: "鱼鳞", wings: "鹤翼", square: "方圆",
};

/**
 * 攻方阵型对守方阵型的缺口修正：克之 +1，被克 −1，其余 0。
 *
 * **加缺口而不是乘战力**——破城判据是粗整数阶梯，±20% 的乘数常常一个缺口
 * 都不改（经济层与野战预告都栽过这个坑）。实测「缺口 − 可防守」的余量有
 * 43.1% 落在 {0,1}，所以 ±1 能翻转近半攻城的胜负。
 *
 * 守方阵型未探明时传 null：不知道就不该算加成，那正是刺探要买的东西。
 */
export function formationEdge(
  P: EngineParams, atk: Formation, def: Formation | null,
): number {
  if (!def) return 0;
  if (BEATS[atk] === def) return P.formationBreach;
  if (BEATS[def] === atk) return -P.formationBreach;
  return 0;
}

/**
 * 攻方阵型自带的缺口修正（与相克无关）。
 *
 * 相克是「谁对上谁」，这一项是「这个阵本身长于什么」：
 * 鱼鳞密阵突击 +1、鹤翼两翼包抄 −1（轻捷而不利于撞城）、方圆 0。
 * 未探明敌阵时相克那一项归零，但**这一项照算**——它不取决于对手是谁。
 */
export const formAtkBonus = (P: EngineParams, atk: Formation): number =>
  P.formAtk[atk] ?? 0;

/**
 * 守方阵型自带的可防守修正。方圆结圆自守 +1、鱼鳞 −1（密阵利攻不利守）。
 * 与上面同理：不取决于攻方是谁
 */
export const formDefBonus = (P: EngineParams, def: Formation): number =>
  P.formDef[def] ?? 0;
