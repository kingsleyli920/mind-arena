// 武将接入。
//
// 808 人的五维此前完全没进引擎：commander 恒为 null，统率武力从不参与战斗，
// appoint 这条动作连候选都不生成——等于数据白建。
//
// 接法选「太守领兵」而非「每次出兵选主将」，理由是候选空间：
// 后者是 目标 × 兵力档 × 可用武将，袁绍二十六将十三郡下轻易过千条，
// 违背 R13「模型做选择题」。太守制把人事与军事解耦——
// 任命本身成为决策（关羽守哪个郡），而出兵时主将由驻地唯一确定。
//
// 一名武将同时是该郡的**主将、守将、行政官**，五维各司其职：
//   统率 → 出兵战力、守城可防守数
//   武力 → 破城缺口（阵前摧锋）
//   政治 → 该郡产出
//   魅力 → 该郡民心
//   适性 → 地形与攻守的额外系数
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

/** 已在任的武将（任一郡的太守）。一人不得兼两郡 */
export function postedOfficers(s: GameState): Set<OfficerId> {
  const out = new Set<OfficerId>();
  for (const c of Object.values(s.commanderies)) if (c.governor) out.add(c.governor);
  return out;
}

/**
 * 某势力当前可任命的武将：本方已仕者，加上籍贯郡已被己方控制的在野者。
 * 「占了颍川才用得上荀彧」——这给争夺人才郡一个理由，而不是开局分完拉倒。
 */
export function recruitable(s: GameState, r: Roster, f: FactionId): OfficerRef[] {
  const busy = postedOfficers(s);
  const out: OfficerRef[] = [];
  for (const o of r.byFaction.get(f) ?? []) {
    if (!busy.has(o.id) && !s.capturedOfficers.includes(o.id)) out.push(o);
  }
  for (const c of Object.values(s.commanderies)) {
    if (c.owner !== f) continue;
    for (const o of r.byHome.get(c.id) ?? []) {
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

export function governEffect(o: OfficerRef | null, P: EngineParams): OfficerEffect {
  if (!o) return none("太守");
  let mul = 1 + (o.politics - P.officerBase) / P.politicsYieldDivisor;
  if (o.aptitudes.includes("治民")) mul += P.civilAptitudeBonus;
  const morale = o.charisma >= P.charismaMoraleThreshold ? 1 : 0;
  return { ...NO_OFFICER, yieldMul: mul, moraleGain: morale,
           note: `${o.name}（政治${o.politics} 魅力${o.charisma}）` };
}

/** 取某郡守将。郡无主或无太守则为 null */
export function governorOf(s: GameState, r: Roster, id: CommanderyId): OfficerRef | null {
  const gid = s.commanderies[id]?.governor;
  return gid ? r.byId.get(gid) ?? null : null;
}
