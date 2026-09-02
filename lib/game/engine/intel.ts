// 观测：一方能看到什么。
//
// 此前候选标签直接写真实守军（actions.ts 的 `敌守军约 ${tgt.garrison}`），
// intel 只用来决定「哪些郡还值得刺探」——于是迷雾是装饰性的：
// 刺探这条动作什么也买不到，而模型将在完全信息下被评测，
// 情报这一整个维度测不出来。
//
// 内容包对此有明文规定（constants.情报）：未探只报档位区间，已探为点估计。
// 档数、档比、误差比一律从 P 读，不在注释或文案里另写一份数——
// 写死的话包一改就变成向模型谎报「刺探能买到什么」。
import { roll } from "./rng.ts";
import type { EngineParams } from "./params.ts";
import type { CommanderyId, FactionId, GameState } from "./types.ts";

export interface Observed {
  /** 给模型看的数值。未探时是档位中值，已探时是带偏差的点估计 */
  value: number;
  /** 观测带的上下界。预告攻城结果时要按带算，不能拿中值当真值 */
  lo: number;
  hi: number;
  /** 已探（或盟友通报） */
  scouted: boolean;
  /** 自家的郡，读的是账本不是情报 */
  own: boolean;
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
  if (!c) return { value: 0, lo: 0, hi: 0, scouted: false, own: false, text: "不详" };
  // 己方的郡是自家账本
  if (c.owner === viewer) return { value: c.garrison, scouted: true, own: true, lo: c.garrison, hi: c.garrison, text: String(c.garrison) };

  // 盟友只降到「已探级」，不给真值。
  // 缔盟在本引擎里不需对方同意（resolve 阶段三），若盟友给真值，
  // 花 1 令缔盟就能买断邻境全部实数——那是比刺探便宜得多的开天眼。
  // 且必须查生效季：盟约延迟一季生效，未生效的盟友不该已经共享军情。
  const allied = s.treaties.some((t) => t.from <= s.turn && t.until > s.turn
    && ((t.a === viewer && t.b === c.owner) || (t.b === viewer && t.a === c.owner)));
  const scoutedUntil = s.intel[viewer]?.[id] ?? -1;
  if (allied || scoutedUntil >= s.turn) {
    const r = roll({ seed: s.seed, year: s.year, season: s.season,
                     faction: viewer, event: `intel:${id}`, seq: 0 });
    const v = Math.max(1, Math.round(c.garrison * (1 + (r - 0.5) * 2 * P.intelErrorRatio)));
    const pct = Math.round(P.intelErrorRatio * 100);
    return {
      value: v, scouted: true, own: false,
      lo: Math.round(v * (1 - P.intelErrorRatio)), hi: Math.round(v * (1 + P.intelErrorRatio)),
      text: `约 ${v}±${pct}%（${allied && scoutedUntil < s.turn ? "盟友通报" : "已探"}）`,
    };
  }

  // 未探：只知道档位
  const tier = tierOf(c.garrison, P);
  const lo = Math.round(P.intelTierBase * P.intelTierRatio ** (tier - 1));
  const hi = Math.round(lo * P.intelTierRatio);
  return {
    value: Math.round((lo + hi) / 2), scouted: false, own: false, lo, hi,
    text: `${lo}–${hi}（未探·第 ${tier}/${P.intelTiers} 档）`,
  };
}

/**
 * 哪些事件是天下皆知。
 *
 * 城池易主、势力覆灭、名将被俘、缔盟绝盟、纪元推进——这些瞒不住；
 * 补给断绝、集结、内政、围城进度、军团溃散是自家内情。
 *
 * 这个划分必须由引擎给出而不是各处各写一遍：对局界面与模型观测若各判各的，
 * 人看到的和模型看到的就不是同一场战争，评测也就不可比。
 */
export const PUBLIC_EVENTS = new Set([
  "siege-win", "eliminated", "officer-captured", "ally", "ally-break", "retire", "epoch",
]);

/** 某方本季能看到的战报。己方全部可见，他方只见天下大事 */
export function visibleLog(s: GameState, viewer: FactionId, since = 0) {
  return s.log.slice(since).filter((e) =>
    e.faction === viewer || !e.faction || PUBLIC_EVENTS.has(e.kind));
}

/** 观测带。预告攻城要按带算，不能拿中值当真值 */
export function garrisonBand(
  s: GameState, viewer: FactionId, id: CommanderyId, P: EngineParams,
): { lo: number; hi: number; scouted: boolean; own: boolean } {
  const o = observedGarrison(s, viewer, id, P);
  return { lo: o.lo, hi: o.hi, scouted: o.scouted, own: o.own };
}

/** 守军的观测档位，1..P.intelTiers */
export function tierOf(garrison: number, P: EngineParams): number {
  const t = 1 + Math.floor(Math.log(Math.max(1, garrison) / P.intelTierBase)
                         / Math.log(P.intelTierRatio));
  return Math.min(P.intelTiers, Math.max(1, t));
}
