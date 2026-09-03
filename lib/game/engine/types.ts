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
  /**
   * 太守。**派生字段，不存**——见 officers.ts 的 governorOf：
   * 取驻此郡的武将中政治最高者。此前它是唯一的武将槽位，
   * 一郡只装得下一人，于是袁绍二十六将里有十三人整局无所事事。
   */
  /** 主力兵种。由地理定，不可更改——想要骑兵就得打边郡 */
  unit: string;
  /** 已备器械。由内政「治械」逐级打造，出征用毕即折损 */
  gear: SiegeGear;
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
  /** 开局态势。胜负判据用相对开局的增量，不用绝对位置 */
  startCommanderies: number;
  startZhou: number;
  startSeats: number;
  /** 本局夺自他方（非无主）的郡国数。丙档要求「必须进攻才能拿」 */
  conquests: number;
  /**
   * 背盟后禁止缔盟至第几季。0 为无禁令。
   * 「背盟有代价」此前只写在包的文案里，引擎一分代价都不收
   */
  allyBanUntil: number;
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
  /** 主将。retinue[0]，单列一份便于战报与标签引用 */
  commander: OfficerId | null;
  /**
   * 随军的整支编制（含主将）。这些人**离开了驻地**——
   * 带将出征则后方空虚，那正是这套编制要制造的取舍。
   * 驻地本身不动（stations 不变），军团一散人就自动回位。
   */
  retinue: OfficerId[];
  troops: number;
  /** 所在郡。围城时为被围郡，待命时为己方郡 */
  at: CommanderyId;
  /** 围攻目标；null 表示驻守待命 */
  target: CommanderyId | null;
  posture: Posture;
  gear: SiegeGear;
  /** 兵种，取自起兵郡 */
  unit: string;
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
  /** 本纪元自第几季起。纪元推进是双触发，不写死在固定季号上 */
  epochStart: number;
  commanderies: Record<CommanderyId, CommanderyState>;
  factions: Record<FactionId, FactionState>;
  armies: Army[];
  treaties: Treaty[];
  passages: Passage[];
  /** 已探明的郡：faction → 郡 → 有效期至第几季 */
  intel: Record<FactionId, Record<CommanderyId, number>>;
  /**
   * 武将驻地：武将 id → 所在郡。这是「谁在哪」的唯一出处。
   *
   * 出征时该郡武将随军（主将全额、副将按 deputyWeight 递减），
   * 出征兵力上限也由随军人数定。换将靠调任——「把关羽调到江夏」
   * 因此是一条真决策，而不是出兵时顺手点的一个下拉框。
   */
  stations: Record<OfficerId, CommanderyId>;
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
  | { type: "govern"; at: CommanderyId; policy: "farm" | "levy" | "wall" | "soothe" | "forge" }
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
  /**
   * 攻城预告。结构化字段，供机器人与模型共用——
   * 此前机器人是从 label 里抠正则拿数的，标签一改就静默读错。
   */
  forecast?: {
    breachLo: number; breachHi: number; holdLo: number; holdHi: number;
    verdict: "破城" | "不破" | "未知"; fog: "own" | "scouted" | "tier";
  };
  /** 第三方围城军的观测兵力（已分档）。救援候选用 */
  siegeBy?: { faction: FactionId; troopsLo: number; troopsHi: number; seasons: number };
  /**
   * 取下此郡在**记分函数**上值什么。只讲归属与地理，绝不含守军与城防——
   * 那是 forecast 的事，这里再写一遍就成了第二个 forecast。
   *
   * 同世界配对 A/B（同 seed、只有一个席位读这个字段、360 组）实测 +17.2 ± 5.7 分；
   * 同等量级、同等稀疏度但挂在产出档/城防/民心上的对照组是 −6.4 ± 5.9。
   * 两者相差 23.6 分远超噪声——涨分来自「信息挂在记分函数上」，
   * 不是「随便加个权重都能涨」。经济层、士气、粮草、适性四次实验全部打平，
   * 因为它们都落在对照组那一侧。
   */
  gain?: {
    /** 目标所属州。这是当前观测里缺失的 郡→州 映射，模型无从别处得知 */
    zhou: string;
    /** 取此郡**前**还差几郡即控该州（≤0 表示已控） */
    needBefore: number;
    /** 取此郡**后**还差几郡 */
    needAfter: number;
    /** 目标是否该州州治 */
    isSeat: boolean;
    /** 目标现属，null 为无主 */
    owner: FactionId | null;
    /** 目标是否其所有者的治所。治所一失全境断供，是全图杠杆最高的一击 */
    isCapital: boolean;
    /** 取下后本势力可达到的最高档，仅在高于现档时给出。由 gradeOf 实算，不是启发式 */
    upgrade: Grade | null;
  };
  /**
   * 调任候选的结构化信息。机器人读这个，不从 label 抠正则——
   * 这个文件里已经为此栽过一次（forecast 之前就是抠出来的）。
   *
   * have 是要紧的那个数：出征兵力上限 = 驻将数 × 每将统兵，
   * 所以「零将的临敌郡」纵有十万戍兵也只出得动一支偏师。
   */
  post?: {
    at: CommanderyId;
    officer: OfficerId;
    /** 该郡现有驻将数 */
    have: number;
    /** 是否临敌 */
    front: boolean;
    leadership: number; might: number; politics: number; charisma: number;
    /** 自何处调来；在野征辟为 null */
    from: CommanderyId | null;
  };
}
