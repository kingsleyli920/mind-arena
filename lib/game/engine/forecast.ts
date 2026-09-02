// 攻城预告：把「打不打得下」按**观测量**算给对局方看。
//
// 为什么必须有这一层：候选标签此前写的是 `比 ${src.garrison / 敌守军}`，
// 而引擎判胜负用的是完全另一组数——出兵数 × 战力浮动 × 主将统率 × 兵种 ×
// 地形，对上 守军 × 兵种防 × (1+地形加成)，再折成缺口数与可防守数。
// 实测：标签「比 4.35」的仗打不下来，「比 2.26」的能破城。
// **模型被要求推理的那个数，与决定胜负的那个数没有关系。**
//
// 这一层不替模型做决策：它只把引擎已有的公式在观测量上跑一遍，
// 结果是一个**区间**与三值判断，不是断言。MERS 要测的是「往哪打、
// 什么时候打」（S1/S2），不是心算能力。
import { breachCount, unitPower, unitGuard } from "./combat.ts";
import { garrisonBand } from "./intel.ts";
import { attackEffect, defendEffect, governorOf, type Roster } from "./officers.ts";
import type { Graph } from "./actions.ts";
import type { EngineParams } from "./params.ts";
import type { Action, FactionId, GameState } from "./types.ts";

export interface SiegeForecast {
  /** 我方能开的缺口数。取战力浮动的下界，保守报 */
  breachLo: number;
  breachHi: number;
  /** 守方可防守数的区间。未探时城防与守将都不明，区间会很宽 */
  holdLo: number;
  holdHi: number;
  verdict: "破城" | "不破" | "未知";
  /** 观测层级：自家 / 已探 / 只知档位 */
  fog: "own" | "scouted" | "tier";
  /** 一句话，直接进 label */
  text: string;
}

/** 未探时城防的可能范围。引擎把城防夹在 [20,100]（破城后降到 ≥20，修城上限 100） */
const DEFENSE_DARK: [number, number] = [20, 100];
/** 未探时敌方守将的可防守加成范围。统率 100 且带守城适性时最高 +2 */
const HOLDBONUS_DARK: [number, number] = [0, 2];

/**
 * 只用观测量预告一场攻城。目标已被围（走野战或增兵分支）时返回 null。
 *
 * 绝不读 tgt.garrison / tgt.defense 的真值——那样预告就成了开天眼，
 * 刺探也就白做了。
 */
export function forecastCampaign(
  s: GameState, viewer: FactionId, a: Extract<Action, { type: "campaign" }>,
  g: Graph, P: EngineParams, roster: Roster | null, troops: number,
): SiegeForecast | null {
  const tgt = s.commanderies[a.target];
  const src = s.commanderies[a.from];
  if (!tgt || !src) return null;
  if (s.armies.some((x) => x.target === a.target)) return null;   // 城下有兵，另一套判定

  const edge = (g.adj.get(a.from) ?? []).find((e) => e.to === a.target);
  const terrain = edge?.terrain ?? "plain";
  const atGate = (edge?.gates.length ?? 0) > 0;

  const band = garrisonBand(s, viewer, a.target, P);
  const fog: SiegeForecast["fog"] = band.own ? "own" : band.scouted ? "scouted" : "tier";

  // 我方这一侧全是自家账本，算得准
  const lead = roster ? governorOf(s, roster, a.from) : null;
  const atk = roster ? attackEffect(lead, P, terrain) : null;
  const power = unitPower(P, src.unit, terrain, tgt.unit);
  const mul = (atk?.attackMul ?? 1) * power;

  // 城防与敌方守将：已探才知道，未探只能给范围
  const [defLo, defHi] = fog === "tier" ? DEFENSE_DARK : [tgt.defense, tgt.defense];
  const [hbLo, hbHi] = fog === "tier" ? HOLDBONUS_DARK
    : [defendEffect(roster ? governorOf(s, roster, a.target) : null, P).holdBonus,
       defendEffect(roster ? governorOf(s, roster, a.target) : null, P).holdBonus];

  const guard = unitGuard(P, tgt.unit);
  // 战力浮动在结算前由坐标定死，攻方算不出，只能按 ±jitter 取两端
  const lo = breachCount(P, troops * (1 - P.jitter) * mul, band.hi * guard, defHi,
                         a.siegeGear, terrain, atGate, atk?.breachBonus ?? 0, hbHi);
  const hi = breachCount(P, troops * (1 + P.jitter) * mul, band.lo * guard, defLo,
                         a.siegeGear, terrain, atGate, atk?.breachBonus ?? 0, hbLo);

  const breachLo = Math.min(lo.breach, hi.breach), breachHi = Math.max(lo.breach, hi.breach);
  const holdLo = Math.min(lo.hold, hi.hold), holdHi = Math.max(lo.hold, hi.hold);
  // 破城判据是「缺口 > 可防守」，严格大于
  const verdict = breachLo > holdHi ? "破城" : breachHi <= holdLo ? "不破" : "未知";

  const range = (a2: number, b2: number) => (a2 === b2 ? String(a2) : `${a2}–${b2}`);
  return {
    breachLo, breachHi, holdLo, holdHi, verdict, fog,
    text: `缺口 ${range(breachLo, breachHi)} 对可防守 ${range(holdLo, holdHi)}，本季判「${verdict}」`
        + (fog === "tier" ? "（未探，城防与守将不明，区间偏宽）" : ""),
  };
}
