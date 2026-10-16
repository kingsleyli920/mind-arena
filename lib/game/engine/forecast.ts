import { besiegedBy } from "./siege.ts";
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
import { breachCount, fieldOutcome, formationEdge, formAtkBonus, formDefBonus,
         FORMATION_CN, unitPower, unitGuard, siegeBreachDelta } from "./combat.ts";
import { garrisonBand, observedFormation, tierOf } from "./intel.ts";
import { attackRetinue, defendRetinue, retinueAt, troopCap, type Roster } from "./officers.ts";
import type { Graph } from "./actions.ts";
import { provCapOf, siegeEat, type EngineParams } from "./params.ts";
import type { Action, Army, CommanderyId, FactionId, GameState } from "./types.ts";
import { V, SIEGE_VERDICT_CN, RELIEF_VERDICT_CN } from "./verdict.ts";

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
  const persist = siegeBreachDelta(army.siegeSeasons, P);
  const formEdge = formationEdge(P, src.formation, tgt.formation);
  // 与 resolve 同一个表达式。此前这里写 terrain === "gate" 而结算写
  // edge.gates.length > 0——两者在当前 adjacency 上恰好完全重合（31 对 31），
  // 所以是**潜伏**漂移：adjacency 是 tools/build-adjacency.mjs 生成的，
  // 重建一次就可能分家，那时预告会对着器械说谎（atGate 决定器械缺口要不要减半）
  const atGate = (edge?.gates.length ?? 0) > 0;
  const bonus = (atk?.breachBonus ?? 0) + persist + formEdge + formAtkBonus(P, src.formation);
  const mul = power * (atk?.attackMul ?? 1);
  const guard = unitGuard(P, tgt.unit);

  // 围城时守军是**真值**：自家军团就在城下，看得见
  const lo = breachCount(P, army.troops * (1 - P.jitter) * mul, tgt.garrison * guard,
                         tgt.defense, army.gear, terrain, atGate, bonus,
                         (def?.holdBonus ?? 0) + formDefBonus(P, tgt.formation));
  const hi = breachCount(P, army.troops * (1 + P.jitter) * mul, tgt.garrison * guard,
                         tgt.defense, army.gear, terrain, atGate, bonus,
                         (def?.holdBonus ?? 0) + formDefBonus(P, tgt.formation));
  const verdict = lo.breach > lo.hold ? V.breach : hi.breach > hi.hold ? V.unknown : V.hold;
  return {
    breachLo: lo.breach, breachHi: hi.breach,
    holdLo: lo.hold, holdHi: hi.hold, verdict, fog: "own",
    // 不重复「满 N 季自动撤围」：那是个常数，已在规则摘要里（一局只发一次），
    // 逐条重复要在每个席·季上付一次钱。「累加 +N 缺口」同理由「已围 N 季」推得出来。
    // 实测这两句去掉之后刘璋的观测峰值从 10242 压回闸门以内
    text: `续围：缺口 ${lo.breach === hi.breach ? lo.breach : `${lo.breach}–${hi.breach}`}`
        + ` 对可防守 ${lo.hold}→${SIEGE_VERDICT_CN[verdict]}（已围 ${army.siegeSeasons} 季`
        + `，城中存粮可支 ${tgt.provisions} 季）`,
  };
}

/**
 * 增兵续围的预告：把这一批兵并进城下那支军团之后，**本季**会怎样。
 *
 * 与 forecastSiege 同一套算式，只把兵力换成合并后的数——引擎的增兵分支
 * （resolve.ts 的 `mine.troops += troops`）就是这么并的，所以判词与结算对得上。
 * 已围季数沿用既有军团的：缺口的逐季累加算在它头上，不因增兵而重置。
 */
/**
 * 续围前瞻：照此耗法，**还要几季**才破得了这座城。
 *
 * 这是「撤还是围下去」唯一需要的那个数，而它此前不存在——forecastSiege 只算
 * 本季那一击（注释自己写着「不撤的话本季就会这样」），撤围候选连 forecast 都不设，
 * 于是 bot 只能回去抠标签的正则「已围 N 季，余 M 人」，按「季数×2 + 残兵少加 4」打分，
 * **从不问围城是不是快赢了**。实测 61 次撤围里 20 次撤的是本季必破的城；
 * 而把递推向前推，162 支围城军里 109 支（67%）在上限内可破。
 *
 * **不写闭式。** 闭式推得出来（守军未触地板时比值是纯几何
 * ρ=(1−攻方每季损耗)/(1−守方每季损耗)=1.173），但那是同一条规则的第二份实现，
 * 正是 combat.ts 抽出 breachCount 时要根除的东西；而且它在三处不收敛
 * （战力比够不到最低阶梯时一切加成被清零、守军触到地板后 ρ 翻成 0.88、
 * 守方每季一条募兵令即 ρ_eff=0.994），每一处都得单独写判据。
 * 上限只有 siegeMaxSeasons 季，直接照 resolve 的递推迭代同样是 O(3)，
 * 且逐字调用同一个 breachCount，不可能与结算说两套话。
 *
 * 取战力浮动的下界（与 forecastSiege 的判词同口径）：报「保守估计还要几季」，
 * 不计守方新命令、援军、行军和欠饷；局势改变时需重新估计。
 */
export function projectSiege(
  s: GameState, viewer: FactionId, army: Army,
  g: Graph, P: EngineParams, roster: Roster | null, reinforcement = 0,
): { seasons: number | null; text: string } | null {
  const tgt0 = army.target ? s.commanderies[army.target] : null;
  const src = s.commanderies[army.home];
  if (!tgt0 || !src || army.faction !== viewer) return null;

  const edge = (g.adj.get(army.home) ?? []).find((e) => e.to === army.target);
  const terrain = edge?.terrain ?? "plain";
  const corps = roster
    ? army.retinue.map((id) => roster.byId.get(id)).filter((o) => !!o)
    : [];
  const atk = roster ? attackRetinue(corps, P, terrain) : null;
  const def = roster ? defendRetinue(retinueAt(s, roster, army.target!, P), P) : null;
  const power = unitPower(P, army.unit, terrain, tgt0.unit);
  const formEdge = formationEdge(P, src.formation, tgt0.formation);
  // 与 resolve 同一个表达式。此前这里写 terrain === "gate" 而结算写
  // edge.gates.length > 0——两者在当前 adjacency 上恰好完全重合（31 对 31），
  // 所以是**潜伏**漂移：adjacency 是 tools/build-adjacency.mjs 生成的，
  // 重建一次就可能分家，那时预告会对着器械说谎（atGate 决定器械缺口要不要减半）
  const atGate = (edge?.gates.length ?? 0) > 0;
  const mul = power * (atk?.attackMul ?? 1);
  const guard = unitGuard(P, tgt0.unit);
  // 守方阵之长（方圆 +1、鱼鳞 −1）与主将加成同属可防守那一侧
  const holdBonus = (def?.holdBonus ?? 0) + formDefBonus(P, tgt0.formation);

  // 逐季推进，每一步都与 resolve 的围城结算同序：先判这一击，再折损，再进季，再判撤围
  let troops = army.troops;
  let garrison = tgt0.garrison;
  let defense = tgt0.defense;
  let prov = tgt0.provisions;
  let ss = army.siegeSeasons;
  for (let n = 0; ; n += 1) {
    if (n === 1) troops += reinforcement;
    const bonus = (atk?.breachBonus ?? 0) + siegeBreachDelta(ss, P) + formEdge
      + formAtkBonus(P, src.formation);
    const r = breachCount(P, troops * (1 - P.jitter) * mul, garrison * guard,
                          defense, army.gear, terrain, atGate, bonus, holdBonus);
    if (r.breach > r.hold) {
      return { seasons: n,
               text: n === 0 ? "本季即破" : `照此耗法还要 ${n} 季可破` };
    }
    // 首季是强攻，此后转围困——两档折损不同，外推必须跟着分
    troops = Math.round(troops * (1 - (ss === 0 ? P.failLossRatio : P.siegeAttackerLoss)));
    garrison = Math.max(P.siegeGarrisonFloor,
                        Math.round(garrison * (1 - P.siegeDefenderLoss)));
    defense = Math.max(P.siegeDefenseFloor, defense - P.siegeDefenseErosion);
    ss += 1;
    // 与结算同序：折损后判断封锁，按剩余守军规模扣粮；合围也能截粮。
    const target = { ...tgt0, garrison, defense, provisions: prov };
    const projected = { ...s, commanderies: { ...s.commanderies, [target.id]: target },
      armies: [{ ...army, troops, marchLeft: 0, siegeSeasons: ss }] };
    if (besiegedBy(projected, target.id, target.owner, P, g)) {
      prov -= siegeEat(target, P);
      if (prov <= 0) return { seasons: n,
        text: n === 0 ? "本季城中粮尽，可不战而下" : `再围 ${n} 季城中粮尽` };
    }
    if (ss >= P.siegeMaxSeasons || troops < P.siegeMinTroops) {
      return { seasons: null,
               text: ss >= P.siegeMaxSeasons
                 ? `围到满 ${P.siegeMaxSeasons} 季也破不了`
                 : `再围 ${n + 1} 季残兵不足 ${P.siegeMinTroops}，围不下去` };
    }
  }
}

/** 已侦察目标的跨季围攻预估；未探城池不读取隐藏守军与城防。守方反应仍可能改变结果。 */
export function projectCampaign(
  s: GameState, viewer: FactionId, a: Extract<Action, { type: "campaign" }>,
  troops: number, g: Graph, P: EngineParams, roster: Roster | null,
): { seasons: number | null; text: string; reinforcement?: number } | null {
  const src = s.commanderies[a.from];
  if (!src) return null;
  const own = s.armies.find((army) => army.target === a.target && army.faction === viewer);
  const band = garrisonBand(s, viewer, a.target, P);
  if (!own && (!band.scouted || s.armies.some((army) => army.target === a.target))) return null;
  const corps = roster ? retinueAt(s, roster, a.from, P) : [];
  // 未到城下时守军只知观测区间；粮储按满仓估计，避免使用隐藏余粮。
  const projectedState = own ? s : { ...s, commanderies: { ...s.commanderies,
    [a.target]: { ...s.commanderies[a.target], garrison: band.hi,
      provisions: provCapOf(s.commanderies[a.target], P) } } };
  const army: Army = own ? { ...own, troops: own.troops + troops } : {
    id: "projection", faction: viewer, commander: a.commander, retinue: corps.map((o) => o.id),
    troops, at: a.target, target: a.target, home: a.from, posture: a.strength,
    gear: a.siegeGear, unit: src.unit, marchLeft: 0, siegeSeasons: 0, idleSeasons: 0, supply: 0,
  };
  const first = projectSiege(projectedState, viewer, army, g, P, roster);
  if (first?.seasons !== null) return first;
  // 首批够不到统兵上限之外的兵力，但后续可以再增援。明确展示这个条件，
  // 不把尚未发出的第二道令算成已经到场的兵，也不使用未来征募收入。
  const reinforcement = Math.min(Math.floor(Math.max(0, src.garrison - troops) * P.strengthRatio[a.strength]),
    troopCap(corps, P) * (src.buildings.includes("stud") ? P.studTroopMul : 1));
  if (reinforcement < P.siegeMinTroops) return first;
  const next = projectSiege(projectedState, viewer, army, g, P, roster, reinforcement);
  return next?.seasons !== null && next ? { ...next, reinforcement } : first;
}

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
  const verdict = breachLo > holdHi ? V.breach : breachHi <= holdLo ? V.hold : V.unknown;

  const range = (a2: number, b2: number) => (a2 === b2 ? String(a2) : `${a2}–${b2}`);
  return {
    breachLo, breachHi, holdLo, holdHi, verdict, fog,
    // 只写这一条候选特有的数。「未探时区间为何偏宽」是规则，
    // 该在规则摘要里说一次，不该在每条候选上重复一遍
    text: `缺口 ${range(breachLo, breachHi)} 对可防守 ${range(holdLo, holdHi)}`
        + `→${SIEGE_VERDICT_CN[verdict]}`
        + (theirForm !== null
            ? (feLo === 0 ? "" : `｜阵${FORMATION_CN[myForm]}对${FORMATION_CN[theirForm]}`
                                 + `（${feLo > 0 ? "克" : "被克"}，${feLo > 0 ? "+" : ""}${feLo} 缺口）`)
            // **什么都不写**。这是信息的缺席，而缺席不必逐条声明——
            // 「阵未探」在一季的候选表里出现二十余次，纯样板占位。
            // 规则摘要里已经写明「敌方阵型与城防同级可见，未探则不显示」，
            // 那一句一局只发一次；这里逐条重复等于把同一句话买二十遍
            : ""),
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
  const verdict = oLo.atkWins && oHi.atkWins ? V.canRelieve
    : !oLo.atkWins && !oHi.atkWins ? "解不了" : "未知";
  return {
    ratioLo: Number(rLo.toFixed(2)), ratioHi: Number(rHi.toFixed(2)),
    verdictLo: oLo.outcome, verdictHi: oHi.outcome, verdict,
    text: `战力比 ${rLo.toFixed(2)}–${rHi.toFixed(2)}`
        + `（${oLo.outcome === oHi.outcome ? oLo.outcome : `${oLo.outcome}–${oHi.outcome}`}）`
        + `→${RELIEF_VERDICT_CN[verdict]}`,
  };
}
