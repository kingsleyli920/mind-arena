// 对局状态的类型契约。
//
// 一条贯穿全局的原则：**状态必须是纯数据**，可 JSON 序列化、可结构相等比较。
// 引擎的每个函数都是 (state, x) => newState，不改原状态。
// 这既是逐位重放的前提，也让"裁决顺序不影响结果"可被机械验证。

export type CommanderyId = string;
export type FactionId = string;
export type OfficerId = string;

export type Control = "firm" | "contested" | "nominal";
/**
 * 档位。丁→甲判**相对开局的增量**（中和开局强弱，短局与评测用这一段）；
 * 超→王判**绝对疆域**（长局才够得着，与开局无关）。
 * 增量判据到甲就封顶，长局后半段每一次胜利都不再有回报——所以要接上面三档
 */
export type Grade = "ding" | "bing" | "yi" | "jia" | "chao" | "ba" | "wang";
/** 三阵。鱼鳞克鹤翼、鹤翼克方圆、方圆克鱼鳞 */
export type Formation = "scale" | "wings" | "square";

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
  /**
   * 阵型。与兵种同为郡的属性：出兵按起兵郡的阵、守城按被攻郡的阵。
   * 三阵循环相克（鱼鳞克鹤翼、鹤翼克方圆、方圆克鱼鳞），克制方 +1 缺口。
   *
   * 加缺口而不是乘战力：破城是粗整数阶梯，±20% 的乘数常常一个缺口都不改。
   * 实测「缺口 − 可防守」的余量有 43.1% 落在 {0,1}，±1 缺口能翻转近半攻城。
   */
  formation: Formation;
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
  /**
   * 上季**作废**的令数（余令超出结转上限的部分）。
   *
   * 这一项存在的唯一理由是把它回传给模型。实测四个模型的令数用率是
   * 72% / 92% / 74% / 67%，而机器人是 93%——每席·季平均扔掉 2.2~3.0 条令，
   * 一整局白扔一千五到一千九百条。这不是判断力的差距，是吞吐的差距：
   * 拿四分之三的行动经济去打满负荷的对手。
   *
   * 而模型看不见自己扔了多少：每次决策都是独立问答，它不知道上季有没有花完。
   * 「用不完就作废」写在规则里不够——那句话已经把用率从 36% 抬到 76%，
   * 剩下的缺口要靠**逐季反馈**补
   */
  wasted: number;
  /** 免费动作本季已用次数，按动作 id 计 */
  freeUsed: Record<string, number>;
  retired: boolean;
  /** 开局态势。胜负判据用相对开局的增量，不用绝对位置 */
  startCommanderies: number;
  startZhou: number;
  /**
   * 开局的**连续州进度**（zhouEquiv）。定档用的是整数州数，
   * 这一项只给细分名次用——见 lib/arena/scoring.ts 的 contScore
   */
  startZhouEquiv: number;
  startSeats: number;
  /** 本局夺自他方（非无主）的郡国数。丙档要求「必须进攻才能拿」 */
  conquests: number;
  /**
   * 国库。唯一货币，军费也从这里出。
   *
   * 加它的理由不是「再来一层经济」——那一层实测过、无影响：产出→兵力的
   * 换算率拉三倍，得分相关系数纹丝不动。但那个实验测的是**把唯一那个去向
   * 做大**，而金是多去向的：同一笔钱可以变成兵、城防、器械、盟约。
   *
   * 更根本的是，此前**兵是免费的**——守军靠产出自动长、军团在外不花一分钱，
   * 于是最优解永远是「攒到最大再打」。军费让常备军有持续成本，
   * 也让「先打南阳还是先打敦煌」第一次有经济上的区别。
   */
  gold: number;
  /**
   * 背盟后禁止缔盟至第几季。0 为无禁令。
   * 「背盟有代价」此前只写在包的文案里，引擎一分代价都不收
   */
  allyBanUntil: number;
  /** 本局曾达到过的最高档 —— 冲高后回落不扣分 */
  bestGrade: Grade;
  eliminated: boolean;
  /** 归降于谁。null 为未归降。归降者与被灭者都退出，但死因不同，报告要分得开 */
  submittedTo: FactionId | null;
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
  /**
   * **本局**季数。写在状态上而不是只读 EngineParams，是因为评测与对局
   * 要的长度根本不同：评测要短而固定（一局 16 季 = 16 次调用，48 局才付得起，
   * 且定档按增量判，四年里多拿一两个州是合理量级）；而作为游戏，
   * 十六季刚把内政理顺就结束了——史上 194 到三分天下用了二十六年。
   * 两件事共用一个常数，必然有一边被将就
   */
  seasonsPerGame: number;
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
  /** 破城被俘的守将，本局不再出场（招降成功者会从这里移出） */
  capturedOfficers: OfficerId[];
  /** 尚在招降窗口内的俘虏。过窗即出列，名单因此不会只增不减 */
  captives: Array<{ officer: OfficerId; by: FactionId; at: CommanderyId; since: number }>;
  /** 本局可招募的在野武将。由 seed 抽定，是全局唯一的开局随机 */
  recruitPool: OfficerId[];
  log: GameEvent[];
  finished: boolean;
  /**
   * 统一天下者。null 表示本局无人统一（打到季数上限，或仍在进行）。
   *
   * 这与档位是两件事，不要混：档位（丁丙乙甲…）是**给模型评测用的量尺**——
   * 曹操开局一郡、袁绍十三郡，直接比疆域没意义，所以改成比「相对开局涨了多少」。
   * 但玩游戏不这么算：谁先统一谁赢。两套判据服务两个目的，所以分开
   */
  winner: FactionId | null;
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
  | { type: "passage"; to: FactionId }
  | { type: "scout"; at: CommanderyId }
  | { type: "withdraw"; army: string }
  /** 改阵。阵型是郡的属性，这是唯一能改它的令 */
  | { type: "array"; at: CommanderyId; to: Formation }
  /** 招降俘虏。成败由确定性随机定，失败则该人永久离场 */
  | { type: "suade"; officer: OfficerId }
  /**
   * 劝降一方势力。成则其疆土与武将整体归入，该势力退出。
   *
   * 没有这一条，天下就收不拢：实测长局的终局是「两强 + 长尾」，
   * 四局合计 32 家以整整一个郡活到最后——一郡势力把全部兵力、武将、
   * 满城防堆在一点（守军上限 60000），而进攻方压得上的中位只有 2894 人，
   * 硬打永远打不动。历史上的统一本来也不是逐城拔取：
   * 刘琮献荆州、张鲁降汉中，都是整个势力过户
   */
  | { type: "submit"; to: FactionId }
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
   * 野战预告。赴援候选此前只有 siegeBy 的兵力档而**没有任何胜负预告**，
   * 于是机器人拿「兵力比 ≥0.9」当判据——而野战比的是
   * 兵力 × 武将加成 × 兵种系数。实测 62% 的野战在战力比 <0.8 时发起、
   * 直接大败。这与征伐的 forecast 是同一类东西，同一个理由
   */
  field?: {
    ratioLo: number; ratioHi: number;
    verdict: "可解围" | "解不了" | "未知";
    text: string;
  };
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
    /**
     * **现任太守**的政治。太守由「驻此郡者中政治最高者」派生，
     * 收入按它打系数——不给这个数，「调他来会不会换掉太守」就无从判断。
     * 郡中无人则为 null
     */
    govPolitics: number | null;
  };
}
