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
import { breachCount, fieldOutcome, formationEdge, FORMATION_CN,
         unitPower, unitGuard } from "./combat.ts";
import { garrisonBand, observedFormation, tierOf } from "./intel.ts";
import { attackRetinue, defendRetinue, retinueAt, type Roster } from "./officers.ts";
import type { Graph } from "./actions.ts";
import type { EngineParams } from "./params.ts";
import type { Action, Army, CommanderyId, FactionId, GameState } from "./types.ts";

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
/**
 * **续围**的预告：军团已在城下，不撤则本季照常结算，这一季会怎样。
 *
 * forecastCampaign 在城下有兵时返回 null，注释写着「另一套判定」——
 * 而那一套一直没写。实测「己方有围城军」的席·季里，100% 拿不到该目标的预告：
 * 模型只知道上季没打下来，不知道再围一季有没有戏。围城是唯一一类跨季、
 * 可逐季加码的决策（缺口每季 +1、守方每季掉兵、城防每季掉），
 * 「加码还是撤」正需要这个前瞻。
 *
 * 与结算同一套算式：所以它不是估计，是「不撤的话本季就会这样」。
 * 唯一的不确定是战力浮动（±jitter），故给区间。
 */
export function forecastSiege(
  s: GameState, viewer: FactionId, army: Army,
  g: Graph, P: EngineParams, roster: Roster | null,
): SiegeForecast | null {
  const tgt = army.target ? s.commanderies[army.target] : null;
  const src = s.commanderies[army.home];
  if (!tgt || !src || army.faction !== viewer) return null;

  const edge = (g.adj.get(army.home) ?? []).find((e) => e.to === army.target);
  const terrain = edge?.terrain ?? "plain";
  const corps = roster
    ? army.retinue.map((id) => roster.byId.get(id)).filter((o) => !!o)
    : [];
  const atk = roster ? attackRetinue(corps, P, terrain) : null;
  const def = roster ? defendRetinue(retinueAt(s, roster, army.target!, P), P) : null;
  const power = unitPower(P, army.unit, terrain, tgt.unit);
  const persist = army.siegeSeasons * P.siegeBreachPerSeason;
  const formEdge = formationEdge(P, src.formation, tgt.formation);
  const atGate = terrain === "gate";
  const bonus = (atk?.breachBonus ?? 0) + persist + formEdge;
  const mul = power * (atk?.attackMul ?? 1);
  const guard = unitGuard(P, tgt.unit);

  // 围城时守军是**真值**：自家军团就在城下，看得见
  const lo = breachCount(P, army.troops * (1 - P.jitter) * mul, tgt.garrison * guard,
                         tgt.defense, army.gear, terrain, atGate, bonus, def?.holdBonus ?? 0);
  const hi = breachCount(P, army.troops * (1 + P.jitter) * mul, tgt.garrison * guard,
                         tgt.defense, army.gear, terrain, atGate, bonus, def?.holdBonus ?? 0);
  const verdict = lo.breach > lo.hold ? "破城" : hi.breach > hi.hold ? "未知" : "不破";
  return {
    breachLo: lo.breach, breachHi: hi.breach,
    holdLo: lo.hold, holdHi: hi.hold, verdict, fog: "own",
    text: `续围：缺口 ${lo.breach === hi.breach ? lo.breach : `${lo.breach}–${hi.breach}`}`
        + ` 对可防守 ${lo.hold}→${verdict}`
        + `（已围 ${army.siegeSeasons} 季，累加 +${persist} 缺口；`
        + `满 ${P.siegeMaxSeasons} 季自动撤围）`,
  };
}

/**
 * 增兵续围的预告：把这一批兵并进城下那支军团之后，**本季**会怎样。
 *
 * 与 forecastSiege 同一套算式，只把兵力换成合并后的数——引擎的增兵分支
 * （resolve.ts 的 `mine.troops += troops`）就是这么并的，所以判词与结算对得上。
 * 已围季数沿用既有军团的：缺口的逐季累加算在它头上，不因增兵而重置。
 */
export function forecastReinforce(
  s: GameState, viewer: FactionId, target: CommanderyId, add: number,
  g: Graph, P: EngineParams, roster: Roster | null,
): SiegeForecast | null {
  const mine = s.armies.find((x) => x.target === target && x.faction === viewer);
  if (!mine) return null;
  return forecastSiege(s, viewer, { ...mine, troops: mine.troops + add }, g, P, roster);
}

export function forecastCampaign(
  s: GameState, viewer: FactionId, a: Extract<Action, { type: "campaign" }>,
  g: Graph, P: EngineParams, roster: Roster | null, troops: number,
): SiegeForecast | null {
  const tgt = s.commanderies[a.target];
  const src = s.commanderies[a.from];
  if (!tgt || !src) return null;
  // 城下有**别家**围城军时这一令结算的是野战，走 forecastField，不是这里。
  //
  // 这行原先不分敌我，于是自家围城军也把预告打成 null——而候选侧
  // 明明已经分好了（actions.ts 的 siegeNote：自家写「本令为增兵」、
  // 别家写「本令先野战」）。后果是增兵续围候选一条预告都拿不到，
  // 而 bot 对无 forecast 的征伐直接判 −1e9：实测 136 条候选、0 条带预告、
  // **0 条被采纳**，对照组「第三方围城的征伐候选」166 条则 166 条全带野战预告。
  // 增兵的正确预告不是这个函数，是「并入之后这场围城会怎样」——见 forecastReinforce
  if (s.armies.some((x) => x.target === a.target && x.faction !== viewer)) return null;

  const edge = (g.adj.get(a.from) ?? []).find((e) => e.to === a.target);
  const terrain = edge?.terrain ?? "plain";
  const atGate = (edge?.gates.length ?? 0) > 0;

  const band = garrisonBand(s, viewer, a.target, P);
  const fog: SiegeForecast["fog"] = band.own ? "own" : band.scouted ? "scouted" : "tier";

  // 我方这一侧全是自家账本，算得准。取的是**整支编制**：
  // 主将全额、副将递减，与结算走同一个 attackRetinue，两边没有分家的机会
  const atk = roster ? attackRetinue(retinueAt(s, roster, a.from, P), P, terrain) : null;
  const power = unitPower(P, src.unit, terrain, tgt.unit);
  const mul = (atk?.attackMul ?? 1) * power;

  // 阵型：已探才看得见。未探时不假设任何加成，但区间要覆盖三种可能
  // ——这正是刺探新买到的东西：不探则「可能被克也可能克他」，区间宽一格
  const myForm = src.formation;
  const theirForm = observedFormation(s, viewer, a.target);
  const [feLo, feHi] = theirForm !== null
    ? [formationEdge(P, myForm, theirForm), formationEdge(P, myForm, theirForm)]
    : [-P.formationBreach, P.formationBreach];

  // 城防与敌方守将：已探才知道，未探只能给范围
  const [defLo, defHi] = fog === "tier" ? DEFENSE_DARK : [tgt.defense, tgt.defense];
  // 敌方守将同样按编制算——一座城里驻着三员将，可防守数与只有一人不同
  const defHold = roster ? defendRetinue(retinueAt(s, roster, a.target, P), P).holdBonus : 0;
  const [hbLo, hbHi] = fog === "tier" ? HOLDBONUS_DARK : [defHold, defHold];

  const guard = unitGuard(P, tgt.unit);
  // 战力浮动在结算前由坐标定死，攻方算不出，只能按 ±jitter 取两端
  const lo = breachCount(P, troops * (1 - P.jitter) * mul, band.hi * guard, defHi,
                         a.siegeGear, terrain, atGate, (atk?.breachBonus ?? 0) + feLo, hbHi);
  const hi = breachCount(P, troops * (1 + P.jitter) * mul, band.lo * guard, defLo,
                         a.siegeGear, terrain, atGate, (atk?.breachBonus ?? 0) + feHi, hbLo);

  const breachLo = Math.min(lo.breach, hi.breach), breachHi = Math.max(lo.breach, hi.breach);
  const holdLo = Math.min(lo.hold, hi.hold), holdHi = Math.max(lo.hold, hi.hold);
  // 破城判据是「缺口 > 可防守」，严格大于
  const verdict = breachLo > holdHi ? "破城" : breachHi <= holdLo ? "不破" : "未知";

  const range = (a2: number, b2: number) => (a2 === b2 ? String(a2) : `${a2}–${b2}`);
  return {
    breachLo, breachHi, holdLo, holdHi, verdict, fog,
    // 只写这一条候选特有的数。「未探时区间为何偏宽」是规则，
    // 该在规则摘要里说一次，不该在每条候选上重复一遍
    text: `缺口 ${range(breachLo, breachHi)} 对可防守 ${range(holdLo, holdHi)}→${verdict}`
        + (theirForm !== null
            ? (feLo === 0 ? "" : `｜阵${FORMATION_CN[myForm]}对${FORMATION_CN[theirForm]}`
                                 + `（${feLo > 0 ? "克" : "被克"}，${feLo > 0 ? "+" : ""}${feLo} 缺口）`)
            // 只留标记，不重复解释。这句话在一季的候选表里出现 23 次、
            // 占 460 tok——凡是逐条重复的同一句话，都该搬进只发一次
            // 且能被前缀缓存的规则摘要里，而不是占用每条候选的位置
            : "｜阵未探"),
  };
}

export interface FieldForecast {
  /** 有效战力比的区间。上下界来自战力浮动与围城军的兵力档 */
  ratioLo: number;
  ratioHi: number;
  /** 区间两端各自的判词。两端一致时就是确定的结果 */
  verdictLo: "溃退" | "后撤" | "相持" | "大败";
  verdictHi: "溃退" | "后撤" | "相持" | "大败";
  /** 解得了围吗：区间两端都赢才算「可解」，都输才算「不可解」 */
  verdict: "可解围" | "解不了" | "未知";
  text: string;
}

/**
 * 野战预告：赴援打得过城下这支围城军吗。
 *
 * 此前赴援候选**没有任何预告**——只给了围城军的兵力档，而野战比的是
 * 兵力 × 武将加成 × 兵种系数。机器人只好拿「兵力比 ≥0.9」当判据，
 * 实测 62% 的野战在战力比 <0.8 时发起、直接大败，中位战力比 0.71，
 * 五次里输四次。这与「让解围成为真选项」那条设计直接冲突。
 *
 * 与攻城预告同构：只跑引擎已有的公式，给区间与判词，不替对局方决策。
 * 阶梯来自 combat.ts 的 fieldOutcome，与结算共用一份。
 */
export function forecastField(
  s: GameState, viewer: FactionId, from: CommanderyId, foe: Army,
  troops: number, g: Graph, P: EngineParams, roster: Roster | null,
): FieldForecast | null {
  const src = s.commanderies[from];
  const at = s.commanderies[foe.target ?? ""];
  if (!src || !at) return null;
  // 出城迎战时起点即被围之郡，没有边；取该郡自身地形的替身「平原」
  const terrain = from === foe.target
    ? "plain"
    : (g.adj.get(from) ?? []).find((e) => e.to === foe.target)?.terrain ?? "plain";

  // 我方：自家账本，算得准
  const corps = roster ? retinueAt(s, roster, from, P) : [];
  const atkMul = roster ? attackRetinue(corps, P, terrain).attackMul : 1;
  const A = troops * atkMul * unitPower(P, src.unit, terrain, foe.unit);

  // 敌围城军：兵力只知档位，主将读得到（军团是公开的）——
  // 与 observedGarrison 同一条口径：能看见的看真值，看不见的给区间
  const foeCorps = roster
    ? foe.retinue.map((id) => roster.byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o)
    : [];
  const foeMul = roster ? attackRetinue(foeCorps, P, terrain).attackMul : 1;
  const tier = tierOf(foe.troops, P);
  const lo = Math.round(P.intelTierBase * P.intelTierRatio ** (tier - 1));
  const hi = Math.round(lo * P.intelTierRatio);
  const power = unitPower(P, foe.unit, terrain, src.unit);

  const rHi = A * (1 + P.jitter) / Math.max(1, lo * foeMul * power);
  const rLo = A * (1 - P.jitter) / Math.max(1, hi * foeMul * power);
  const oLo = fieldOutcome(P, rLo), oHi = fieldOutcome(P, rHi);
  const verdict = oLo.atkWins && oHi.atkWins ? "可解围"
    : !oLo.atkWins && !oHi.atkWins ? "解不了" : "未知";
  return {
    ratioLo: Number(rLo.toFixed(2)), ratioHi: Number(rHi.toFixed(2)),
    verdictLo: oLo.outcome, verdictHi: oHi.outcome, verdict,
    text: `战力比 ${rLo.toFixed(2)}–${rHi.toFixed(2)}`
        + `（${oLo.outcome === oHi.outcome ? oLo.outcome : `${oLo.outcome}–${oHi.outcome}`}）`
        + `→${verdict}`,
  };
}
