// 武将接入。
//
// 808 人的五维此前完全没进引擎：commander 恒为 null，统率武力从不参与战斗，
// appoint 这条动作连候选都不生成——等于数据白建。
//
// 接法是**驻地编制**：武将驻于某郡，出征时该郡武将随军，主将全额、副将递减。
// 不在出兵时逐次点将——那是 目标 × 兵力档 × 武将组合，袁绍二十六将十三郡下
// 轻易过千条，违背 R13「模型做选择题」。换将靠调任，那本身就是决策。
//
// 首版是「一郡一将」（governor 单槽），后果是名册里一半以上的人整局无所事事：
// 刘璋 30 将只有 9 个郡、袁绍 26 将只有 13 个郡。而一个郡平均辖十一个县，
// 只配一员将本身也不像样。现在一郡可驻多人，出征兵力上限由随军人数定
// ——「多少武将能带多少兵」。
//
// 无名将驻守的郡自动有一名龙套郡守（五维取包里的庸将基准）：
// 此前「无主将」是一条直接归零的分支，等于逼着每个郡都塞人。
//
// 五维各司其职：
//   统率 → 出兵战力、守城可防守数
//   武力 → 破城缺口（阵前摧锋）
//   政治 → 该郡产出
//   魅力 → 该郡民心
//   适性 → 地形与攻守的额外系数
import { roll } from "./rng.ts";
import type { EngineParams } from "./params.ts";
import type { CommanderyId, FactionId, GameState, OfficerId } from "./types.ts";

export interface OfficerRef {
  id: OfficerId;
  name: string;
  /** 开局归属；null 为在野 */
  faction: FactionId | null;
  /** 籍贯郡。在野武将由控制其籍贯郡的势力征辟 */
  home: CommanderyId | null;
  leadership: number; might: number; intellect: number;
  politics: number; charisma: number;
  aptitudes: string[];
}

export interface Roster {
  byId: Map<OfficerId, OfficerRef>;
  /** 已仕者按势力分组，均按 id 升序 */
  byFaction: Map<FactionId, OfficerRef[]>;
  /** 在野者按籍贯郡分组 */
  byHome: Map<CommanderyId, OfficerRef[]>;
}

interface RawOfficer {
  id: string; name: string; commandery?: string | null;
  affiliation194?: string | null;
  leadership?: number; might?: number; intellect?: number;
  politics?: number; charisma?: number; aptitudes?: string[];
}

/**
 * 建立名册。只收「本年可登场且五维齐备」者：
 * 登场判定见 lib/game/data/officer-availability-194.json，每条带史料判据；
 * 五维缺失者若混进来，会以 undefined 参与算术而静默变成 NaN。
 */
export function buildRoster(
  officers: RawOfficer[],
  availability: { officers: Array<{ id: string; available: boolean }> },
  commanderyNameToId: Map<string, CommanderyId>,
): Roster {
  const ok = new Set(availability.officers.filter((x) => x.available).map((x) => x.id));
  const byId = new Map<OfficerId, OfficerRef>();
  const byFaction = new Map<FactionId, OfficerRef[]>();
  const byHome = new Map<CommanderyId, OfficerRef[]>();

  for (const o of [...officers].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!ok.has(o.id)) continue;
    const five = [o.leadership, o.might, o.intellect, o.politics, o.charisma];
    if (five.some((v) => typeof v !== "number")) continue;
    const ref: OfficerRef = {
      id: o.id, name: o.name,
      faction: o.affiliation194 ?? null,
      home: (o.commandery && commanderyNameToId.get(o.commandery)) || null,
      leadership: o.leadership!, might: o.might!, intellect: o.intellect!,
      politics: o.politics!, charisma: o.charisma!,
      aptitudes: o.aptitudes ?? [],
    };
    byId.set(ref.id, ref);
    if (ref.faction) {
      if (!byFaction.has(ref.faction)) byFaction.set(ref.faction, []);
      byFaction.get(ref.faction)!.push(ref);
    } else if (ref.home) {
      if (!byHome.has(ref.home)) byHome.set(ref.home, []);
      byHome.get(ref.home)!.push(ref);
    }
  }
  return { byId, byFaction, byHome };
}

/**
 * 抽定本局的在野可招募名单。同一 seed 必得同一名单，且与调用顺序无关：
 * 每人的入选只由其在全表中的固定位次决定。
 */
export function rollRecruitPool(r: Roster, seed: string, ratio: number): OfficerId[] {
  const wild = [...r.byId.values()].filter((o) => !o.faction && o.home)
    .sort((a, b) => a.id.localeCompare(b.id));
  return wild
    .filter((o, i) => roll({ seed, year: 0, season: 0, faction: "-", event: "recruit", seq: i }) < ratio)
    .map((o) => o.id);
}

/** 已有驻地的武将。一人只能驻一郡 */
export function postedOfficers(s: GameState): Set<OfficerId> {
  return new Set(Object.keys(s.stations));
}

/**
 * 驻某郡且**当前在城**的武将，按 id 升序。不含龙套——龙套由 retinueAt 补。
 *
 * 随军在外的人不算在内：带将出征则后方空虚，那是这套编制的取舍所在。
 * 驻地记在 stations 里始终不动，军团一散人就自动回位，不必两处同步。
 */
export function stationedAt(s: GameState, r: Roster, id: CommanderyId): OfficerRef[] {
  const away = new Set<OfficerId>();
  for (const a of s.armies) for (const oid of a.retinue) away.add(oid);
  const out: OfficerRef[] = [];
  for (const [oid, at] of Object.entries(s.stations)) {
    if (at !== id || away.has(oid)) continue;
    const o = r.byId.get(oid);
    if (o) out.push(o);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 龙套郡守。没有名将驻守的郡照样要能打能守，只是明显弱——
 * 此前这里是一条归零的分支，逼得每个郡都得塞人，而人根本不够。
 * id 带 `filler:` 前缀，与真名册不会撞；它不进 stations，也不会被俘。
 */
export function fillerOfficer(id: CommanderyId, P: EngineParams): OfficerRef {
  return {
    id: `filler:${id}`, name: `${id}守将`, faction: null, home: null,
    leadership: P.fillerLeadership, might: P.fillerMight,
    intellect: P.fillerPolitics, politics: P.fillerPolitics,
    charisma: P.fillerCharisma, aptitudes: [],
  };
}

export const isFiller = (o: OfficerRef) => o.id.startsWith("filler:");

/**
 * 某郡的**编制**：驻此郡的武将，无人则一名龙套。
 * 出征与守城都从这里取人，两边同源，不会出现「预告按一套、结算按另一套」。
 */
export function retinueAt(
  s: GameState, r: Roster | null, id: CommanderyId, P: EngineParams,
): OfficerRef[] {
  const posted = r ? stationedAt(s, r, id) : [];
  return posted.length ? posted : [fillerOfficer(id, P)];
}

/**
 * 某势力当前可任命的武将：本方已仕者，加上籍贯郡已被己方控制的在野者。
 * 「占了颍川才用得上荀彧」——这给争夺人才郡一个理由，而不是开局分完拉倒。
 */
export function recruitable(s: GameState, r: Roster, f: FactionId): OfficerRef[] {
  const out: OfficerRef[] = [];
  // 本方武将一律可调——「已在任」不再是排除条件，因为现在人人都有驻地，
  // 按旧规则可调的人恒为空集。调任的本体就是把人从一个郡挪到另一个郡：
  // 「把关羽调到江夏」此前根本无法表达
  const away = new Set<OfficerId>();
  for (const a of s.armies) for (const oid of a.retinue) away.add(oid);
  for (const o of r.byFaction.get(f) ?? []) {
    // 随军在外的不能调——他正在城下围着
    if (!away.has(o.id) && !s.capturedOfficers.includes(o.id)) out.push(o);
  }
  const busy = postedOfficers(s);
  const pool = new Set(s.recruitPool);
  for (const c of Object.values(s.commanderies)) {
    if (c.owner !== f) continue;
    for (const o of r.byHome.get(c.id) ?? []) {
      // 在野者还需落在本局抽定的名单里——同一剧本换个 seed，可用的人才就不同。
      // 这是内容包声明的开局唯一随机源
      if (!pool.has(o.id)) continue;
      if (!busy.has(o.id) && !s.capturedOfficers.includes(o.id)) out.push(o);
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ── 五维折算成战斗与内政系数 ────────────────────────────────────────
// 全部阈值与除数来自内容包，理由同 params.ts：模型按包里的说明推算，
// 引擎若另用一套，两边算出的战果对不上。

export interface OfficerEffect {
  /** 出兵战力乘数 */
  attackMul: number;
  /** 攻城缺口加成 */
  breachBonus: number;
  /** 守城可防守数加成 */
  holdBonus: number;
  /** 产出乘数 */
  yieldMul: number;
  /** 本季民心增益 */
  moraleGain: number;
  /** 归因文本，写进战报 */
  note: string;
}

export const NO_OFFICER: OfficerEffect = {
  attackMul: 1, breachBonus: 0, holdBonus: 0, yieldMul: 1, moraleGain: 0, note: "无",
};
const none = (role: string): OfficerEffect => ({ ...NO_OFFICER, note: `无${role}` });

/** 适性与地形的对应。攻城/守城适性不看地形，单列 */
const TERRAIN_APTITUDE: Record<string, string> = {
  mountain: "山地", hill: "山地", river: "水战",
};

export function attackEffect(o: OfficerRef | null, P: EngineParams, terrain: string): OfficerEffect {
  if (!o) return none("主将");
  const parts: string[] = [];
  let mul = 1 + (o.leadership - P.officerBase) / P.leadershipAttackDivisor;
  parts.push(`统率${o.leadership}`);
  const apt = TERRAIN_APTITUDE[terrain];
  if (apt && o.aptitudes.includes(apt)) { mul += P.aptitudeTerrainBonus; parts.push(`${apt}适性`); }
  let breach = 0;
  if (o.might >= P.mightBreachThreshold) { breach += P.mightBreach; parts.push(`武力${o.might}摧锋`); }
  if (o.aptitudes.includes("攻城")) { breach += P.siegeAptitudeBreach; parts.push("攻城适性"); }
  return { ...NO_OFFICER, attackMul: mul, breachBonus: breach, note: `${o.name}（${parts.join("、")}）` };
}

export function defendEffect(o: OfficerRef | null, P: EngineParams): OfficerEffect {
  if (!o) return none("守将");
  const parts = [`统率${o.leadership}`];
  let hold = Math.floor(Math.max(0, o.leadership - P.officerBase) / P.leadershipDefenseStep);
  if (o.aptitudes.includes("守城")) { hold += P.holdAptitudeBonus; parts.push("守城适性"); }
  return { ...NO_OFFICER, holdBonus: hold, note: `${o.name}（${parts.join("、")}）` };
}

/** 出征时的排位分。主将取最高，其余为副将 */
const attackScore = (o: OfficerRef, terrain: string) =>
  o.leadership + o.might / 2
  + (TERRAIN_APTITUDE[terrain] && o.aptitudes.includes(TERRAIN_APTITUDE[terrain]) ? 20 : 0)
  + (o.aptitudes.includes("攻城") ? 10 : 0);

/** 守城时的排位分 */
const defendScore = (o: OfficerRef) =>
  o.leadership + (o.aptitudes.includes("守城") ? 20 : 0);

/**
 * 一支出征部队的合并效果：主将全额，副将各按 deputyWeight 折算后累加。
 *
 * 副将的摧锋与攻城适性合计封顶 deputyBreachCap——缺口是小整数，
 * 不封顶就变成「把将全堆一处」的无脑最优解，那不是决策是刷数值。
 */
export function attackRetinue(
  officers: readonly OfficerRef[], P: EngineParams, terrain: string,
): OfficerEffect & { lead: OfficerRef | null; members: OfficerRef[] } {
  const ranked = [...officers]
    .sort((a, b) => attackScore(b, terrain) - attackScore(a, terrain) || a.id.localeCompare(b.id))
    .slice(0, P.retinueCap);
  if (!ranked.length) return { ...none("主将"), lead: null, members: [] };
  const head = attackEffect(ranked[0], P, terrain);
  let mul = head.attackMul;
  let deputyBreach = 0;
  for (const d of ranked.slice(1)) {
    const e = attackEffect(d, P, terrain);
    mul += (e.attackMul - 1) * P.deputyWeight;
    deputyBreach += e.breachBonus;
  }
  const note = ranked.length === 1 ? head.note
    : `${head.note}，副将 ${ranked.slice(1).map((o) => o.name).join("、")}`;
  return {
    ...NO_OFFICER,
    attackMul: mul,
    breachBonus: head.breachBonus + Math.min(deputyBreach, P.deputyBreachCap),
    lead: ranked[0], members: ranked, note,
  };
}

/** 守城的合并效果。同样是主将全额、副将折算封顶 */
export function defendRetinue(
  officers: readonly OfficerRef[], P: EngineParams,
): OfficerEffect & { lead: OfficerRef | null; members: OfficerRef[] } {
  const ranked = [...officers]
    .sort((a, b) => defendScore(b) - defendScore(a) || a.id.localeCompare(b.id))
    .slice(0, P.retinueCap);
  if (!ranked.length) return { ...none("守将"), lead: null, members: [] };
  const head = defendEffect(ranked[0], P);
  let deputy = 0;
  for (const d of ranked.slice(1)) deputy += defendEffect(d, P).holdBonus;
  const note = ranked.length === 1 ? head.note
    : `${head.note}，副将 ${ranked.slice(1).map((o) => o.name).join("、")}`;
  return {
    ...NO_OFFICER,
    holdBonus: head.holdBonus + Math.min(Math.floor(deputy * P.deputyWeight), P.deputyBreachCap),
    lead: ranked[0], members: ranked, note,
  };
}

/**
 * 出征兵力上限 = 随军武将数 × 每将统兵。
 * 这是「一个城里有多少武将、就能带多少兵」的唯一出处。
 */
export function troopCap(officers: readonly OfficerRef[], P: EngineParams): number {
  return Math.min(officers.length, P.retinueCap) * P.troopsPerOfficer;
}

export function governEffect(o: OfficerRef | null, P: EngineParams): OfficerEffect {
  if (!o) return none("太守");
  let mul = 1 + (o.politics - P.officerBase) / P.politicsYieldDivisor;
  if (o.aptitudes.includes("治民")) mul += P.civilAptitudeBonus;
  const morale = o.charisma >= P.charismaMoraleThreshold ? 1 : 0;
  return { ...NO_OFFICER, yieldMul: mul, moraleGain: morale,
           note: `${o.name}（政治${o.politics} 魅力${o.charisma}）` };
}

/**
 * 太守 = 驻此郡的武将中**政治最高**者（同分取 id 升序）。派生而非存储：
 * 存一份就有两个真相来源，而这个仓库已经为此栽过好几次。
 * 无人驻守则是龙套郡守——郡照样要出产出。
 */
export function governorOf(
  s: GameState, r: Roster, id: CommanderyId, P: EngineParams,
): OfficerRef | null {
  const list = retinueAt(s, r, id, P);
  return list.slice().sort((a, b) => b.politics - a.politics || a.id.localeCompare(b.id))[0] ?? null;
}
