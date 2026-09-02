// 对局状态的类型契约。
//
// 一条贯穿全局的原则：**状态必须是纯数据**，可 JSON 序列化、可结构相等比较。
// 引擎的每个函数都是 (state, x) => newState，不改原状态。
// 这既是逐位重放的前提，也让"裁决顺序不影响结果"可被机械验证。

export type CommanderyId = string;
export type FactionId = string;
export type OfficerId = string;

export type Control = "firm" | "contested" | "nominal";
export type Grade = "jia" | "yi" | "bing" | "ding";

export interface CommanderyState {
  id: CommanderyId;
  owner: FactionId | null;
  /** 戍兵实数。观测时压成 13 档等比 1.4 */
  garrison: number;
  yieldTier: number;      // 1–10
  moraleTier: number;     // 1–5
  defense: number;        // 0–100
  governor: OfficerId | null;
  /** 本季已下令数，用于 R12「同一郡国每季最多 2 令」 */
  ordersThisSeason: number;
}

export interface FactionState {
  id: FactionId;
  capital: CommanderyId | null;
  /** 本季可用令数，季初重算 */
  ap: number;
  /** 结转，上限 2 */
  carried: number;
  /** 免费动作本季已用次数，按动作 id 计 */
  freeUsed: Record<string, number>;
  retired: boolean;
  /** 开局郡国数，胜负判据用相对开局的增量 */
  startCommanderies: number;
  /** 本局曾达到过的最高档 —— 冲高后回落不扣分 */
  bestGrade: Grade;
  eliminated: boolean;
}

export type Posture = "skirmish" | "main" | "allout";
export type SiegeGear = "none" | "ram" | "mound";

/**
 * 军团。首版里它是个空壳——muster 造出来后再无人读取，征伐直接用郡守军，
 * 于是行军瞬时、围城无过程、「绕后断粮」无从谈起。
 * 现在它是实体：占据地图上的位置，围城要耗季，可被野战击溃，会断粮溃散。
 */
export interface Army {
  id: string;
  faction: FactionId;
  commander: OfficerId | null;
  troops: number;
  /** 所在郡。围城时为被围郡，待命时为己方郡 */
  at: CommanderyId;
  /** 围攻目标；null 表示驻守待命 */
  target: CommanderyId | null;
  posture: Posture;
  gear: SiegeGear;
  /** 已围季数，满上限自动撤围 */
  siegeSeasons: number;
  /** 撤围或溃退时退回的郡 */
  home: CommanderyId;
}

export interface Treaty {
  a: FactionId;
  b: FactionId;
  kind: "alliance";
  /** 到期季序（绝对季号）。到期自动回落中立，不算背盟 */
  until: number;
  /** 生效季序。变更延迟一季 */
  from: number;
}

export interface Passage {
  grantor: FactionId;
  grantee: FactionId;
  through: CommanderyId[];
  from: number;
}

export interface GameEvent {
  turn: number;
  kind: string;
  faction?: FactionId;
  text: string;
  /** 结算归因：哪个维度、哪个适性、哪个地形各贡献多少（MERS R38） */
  attribution?: Record<string, number | string>;
}

export interface GameState {
  seed: string;
  year: number;
  /** 1–4 */
  season: number;
  /** 绝对季号，从 0 起。用于盟约到期等比较 */
  turn: number;
  epoch: number;
  commanderies: Record<CommanderyId, CommanderyState>;
  factions: Record<FactionId, FactionState>;
  armies: Army[];
  treaties: Treaty[];
  passages: Passage[];
  /** 已探明的郡：faction → 郡 → 有效期至第几季 */
  intel: Record<FactionId, Record<CommanderyId, number>>;
  /** 破城被俘的守将，本局不再出场 */
  capturedOfficers: OfficerId[];
  /** 本局可招募的在野武将。由 seed 抽定，是全局唯一的开局随机 */
  recruitPool: OfficerId[];
  log: GameEvent[];
  finished: boolean;
}

// ── 动作 ────────────────────────────────────────────────────────────
export type Action =
  | { type: "campaign"; target: CommanderyId; from: CommanderyId; commander: OfficerId | null;
      strength: Posture; siegeGear: SiegeGear }
  | { type: "muster"; at: CommanderyId; from: CommanderyId[]; commander: OfficerId | null;
      deadline: 1 | 2 }
  | { type: "govern"; at: CommanderyId; policy: "farm" | "levy" | "wall" | "soothe" }
  | { type: "appoint"; officer: OfficerId; at: CommanderyId }
  | { type: "ally"; to: FactionId; act: "form" | "break"; term: 4 | 8 }
  | { type: "passage"; to: FactionId; through: CommanderyId }
  | { type: "scout"; at: CommanderyId }
  | { type: "withdraw"; army: string }
  | { type: "retire" };

export interface Order {
  faction: FactionId;
  action: Action;
}

/** 引擎预筛出的具体候选。模型从中选择，不自由填参 */
export interface Candidate {
  /** 稳定 id，供模型引用与日志追溯 */
  key: string;
  action: Action;
  cost: number;
  /** 给模型的一句话说明，含关键数字 */
  label: string;
}
