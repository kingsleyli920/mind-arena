// 引擎参数：唯一来源是内容包。
//
// 立内容层的理由是「引擎与模型提示词共用同一份定义」——规则若硬编码在
// 引擎里，就得另写一份给模型看的说明，两份随迭代必然漂移，
// **模型按包里的公式算，引擎按另一套结算，算出来对不上，评测即失效**。
//
// 首版引擎恰恰犯了这个错：pack-194.json 写着攻城判据，resolve.ts 里
// 却是另一组硬编码常量。本模块把所有战斗与结算常数收回内容包，
// 并在载入时校验缺失项——宁可启动即报错，也不要静默用默认值跑出错误结论。
import type { Posture, SiegeGear } from "./types.ts";

export interface EngineParams {
  /** 兵力档 → 投入比例 */
  strengthRatio: Record<Posture, number>;
  /** 器械 → 缺口加成 */
  gearBreach: Record<SiegeGear, number>;
  /** 地形 → 守方加成 */
  terrainDefense: Record<string, number>;
  /** 地形的中文名。候选标签是给人和模型两边看的，plain / gate 两边都读不顺 */
  terrainName: Record<string, string>;
  /** 缺口分档：[兵力比阈值, 缺口数]，降序 */
  breachLadder: Array<[number, number]>;
  /** 可防守数 = base + floor(城防/defensePerHold) + log2(守军/garrisonPerHold) */
  holdBase: number;
  defensePerHold: number;
  garrisonPerHold: number;
  /** 战力浮动幅度（±） */
  jitter: number;
  /** 破城后攻方存活率与守方折损 */
  captureSurvivalPenalty: number;
  failLossRatio: number;
  defenderAttritionOnHold: number;
  /** 内政效果 */
  farmGain: number; levyMultiplier: number; wallGain: number;
  /** 每季产出：守军增量 = 产出档 × yieldToGarrison × (moraleBase + 民心/moraleDivisor) */
  yieldToGarrison: number; moraleBase: number; moraleDivisor: number;
  garrisonCap: number;
  /** 令数 */
  apBase: number; apCap: number; carryCap: number;
  /** 时钟 */
  seasonsPerGame: number; intelValidSeasons: number;
  /** 情报：未探的档位表与已探的误差 */
  intelTiers: number; intelTierRatio: number; intelTierBase: number; intelErrorRatio: number;
  /** 武将：五维折算成战斗与内政系数的基准与除数 */
  officerBase: number;
  leadershipAttackDivisor: number; leadershipDefenseStep: number;
  mightBreachThreshold: number; mightBreach: number;
  siegeAptitudeBreach: number; holdAptitudeBonus: number;
  aptitudeTerrainBonus: number; civilAptitudeBonus: number;
  politicsYieldDivisor: number; charismaMoraleThreshold: number;
  /** 随军武将上限（含主将）。副将按 deputyWeight 递减折算 */
  retinueCap: number;
  deputyWeight: number;
  /** 副将的摧锋/攻城适性合计最多加几个缺口。不设上限则堆将可无限加 */
  deputyBreachCap: number;
  /** 每名随军武将能带多少兵。这是「多少武将能带多少兵」的唯一出处 */
  troopsPerOfficer: number;
  /** 龙套郡守的五维。无名将驻守的郡自动有一名，弱但不为零 */
  fillerLeadership: number; fillerMight: number;
  fillerPolitics: number; fillerCharisma: number;
  /** 背盟的民心罚（全境每郡 −N）。民心直接乘进产出，这是可算的代价 */
  /** ── 金 ── 唯一货币，军费也用它付。见内容包 constants.金 */
  /** 金这一层是否启用。关着时收入/军费/价格一律为零 */
  /** 阵型相克加减的缺口数。见内容包 constants.阵型 */
  formationBreach: number;
  /** 招降：窗口季数、基础成功率、每点五维折减、同乡加成 */
  suadeWindow: number;
  suadeBase: number;
  suadePerStat: number;
  suadeHomeBonus: number;
  goldOn: boolean;
  goldPerTier: number;
  goldDecay: number;
  goldBase: number;
  goldUpkeepPerTroop: number;
  goldPerLevyTroop: number;
  goldPerWall: number;
  goldGear: Record<string, number>;
  goldStart: number;
  goldCap: number;
  betrayMoralePenalty: number;
  /** 背盟后禁止缔盟的季数 */
  betrayBanSeasons: number;
  /** 围城：持续制 */
  siegeMaxSeasons: number; siegeBreachPerSeason: number;
  siegeAttackerLoss: number; siegeDefenderLoss: number; siegeWithdrawKeep: number;
  siegeDefenseErosion: number;
  /** 野战：援军进入被围郡时与围城军交战 */
  fieldRout: number; fieldPush: number; fieldStall: number;
  fieldRoutLoserLoss: number; fieldRoutWinnerLoss: number;
  fieldPushLoserLoss: number; fieldPushWinnerLoss: number;
  fieldStallLoss: number; fieldDefeatLoss: number;
  /** 集结：每个来源郡抽调的守军比例 */
  musterTake: number;
  /** 开局在野可招募比例，由 seed 抽定 */
  wildRecruitRatio: number;
  /** 兵种表：攻防系数、地形系数、克制关系 */
  units: Record<string, {
    name: string; attack: number; defense: number;
    terrain: Record<string, number>; strongAgainst: string[];
  }>;
  counterBonus: number;
  /** 器械：治械每次提升一级的顺序 */
  gearLadder: string[];
  /** 纪元 */
  epochCount: number; epochLimit: number; epochMin: number;
  neutralGrowth: Record<number, number>;
}

interface RawPack {
  constants?: Record<string, Record<string, unknown>>;
  units?: Array<{
    id: string; name: string; attack: number; defense: number;
    terrainFactor?: Record<string, number>; strongAgainst?: string[];
  }>;
  terrain?: Array<{ id: string; defenseBonus: number; label?: string }>;
  actions?: Array<{ id: string; params?: Array<{ name: string; tiers?: Array<{ id: string; value: number }> }> }>;
}

const num = (v: unknown, path: string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`内容包缺少或非法：${path}（得到 ${JSON.stringify(v)}）`);
  }
  return n;
};

/**
 * 从内容包提取引擎参数。任何缺失都抛错而非取默认值——
 * 静默兜底会让「包里改了数值但引擎没跟上」这类问题无声通过。
 */
/** 兵种表。缺地形系数即抛错——静默当 1 会让「山地骑兵减半」无声失效 */
function unitTable(pack: RawPack): EngineParams["units"] {
  const out: EngineParams["units"] = {};
  for (const u of pack.units ?? []) {
    const tf = u.terrainFactor;
    for (const k of ["plain", "hill", "mountain", "gate", "river"]) {
      if (typeof tf?.[k] !== "number") throw new Error(`内容包 units.${u.id} 缺地形系数 ${k}`);
    }
    out[u.id] = { name: u.name, attack: num(u.attack, `units.${u.id}.attack`),
                  defense: num(u.defense, `units.${u.id}.defense`),
                  terrain: tf!, strongAgainst: u.strongAgainst ?? [] };
  }
  for (const k of ["infantry", "cavalry", "archer", "navy"]) {
    if (!out[k]) throw new Error(`内容包缺兵种 ${k}`);
  }
  return out;
}

export function loadParams(pack: RawPack): EngineParams {
  const C = pack.constants ?? {};
  const g = (group: string, key: string) => num(C[group]?.[key], `constants.${group}.${key}`);

  // 兵力档与器械档从动作定义里取，避免同一组数字在包中出现两次
  const campaign = pack.actions?.find((a) => a.id === "campaign");
  const tierMap = (paramName: string) => {
    const p = campaign?.params?.find((x) => x.name === paramName);
    if (!p?.tiers?.length) throw new Error(`内容包 campaign.${paramName} 缺少 tiers`);
    return Object.fromEntries(p.tiers.map((t) => [t.id, t.value]));
  };
  const strength = tierMap("strength") as Record<Posture, number>;
  const gear = tierMap("siegeGear") as Record<SiegeGear, number>;
  for (const k of ["skirmish", "main", "allout"] as const) {
    if (typeof strength[k] !== "number") throw new Error(`内容包缺兵力档 ${k}`);
  }
  for (const k of ["none", "ram", "mound"] as const) {
    if (typeof gear[k] !== "number") throw new Error(`内容包缺器械档 ${k}`);
  }

  const terrainDefense: Record<string, number> = {};
  const terrainName: Record<string, string> = {};
  for (const t of pack.terrain ?? []) {
    terrainDefense[t.id] = t.defenseBonus;
    terrainName[t.id] = t.label ?? t.id;
  }
  for (const k of ["plain", "hill", "mountain", "gate", "river"]) {
    if (typeof terrainDefense[k] !== "number") throw new Error(`内容包缺地形 ${k} 的 defenseBonus`);
  }

  return {
    strengthRatio: strength,
    gearBreach: gear,
    terrainDefense,
    terrainName,
    breachLadder: [
      [g("攻城", "缺口比_四"), 4], [g("攻城", "缺口比_三"), 3],
      [g("攻城", "缺口比_二"), 2], [g("攻城", "缺口比_一"), 1],
    ],
    holdBase: g("攻城", "可防守基数"),
    defensePerHold: g("攻城", "城防每档"),
    garrisonPerHold: g("攻城", "守军每档"),
    jitter: g("野战", "战力浮动"),
    captureSurvivalPenalty: g("攻城", "破城后守军折算"),
    failLossRatio: g("攻城", "攻城失利折损"),
    defenderAttritionOnHold: g("攻城", "守住后守军损耗"),
    farmGain: g("内政", "劝农增产出档"),
    levyMultiplier: g("内政", "募兵倍率"),
    wallGain: g("内政", "修城增城防"),
    yieldToGarrison: g("产出", "产出档折兵"),
    moraleBase: g("产出", "民心基数"),
    moraleDivisor: g("产出", "民心除数"),
    garrisonCap: g("产出", "守军上限"),
    apBase: g("令数", "基数"),
    apCap: g("令数", "上限"),
    carryCap: g("令数", "结转上限"),
    seasonsPerGame: g("时钟", "一局季数"),
    intelValidSeasons: g("情报", "有效季数"),
    intelTiers: g("情报", "档数"),
    intelTierRatio: g("情报", "档比"),
    intelTierBase: g("情报", "档基数"),
    intelErrorRatio: g("情报", "误差比"),
    officerBase: g("武将", "基准值"),
    leadershipAttackDivisor: g("武将", "统率攻势除数"),
    leadershipDefenseStep: g("武将", "统率守备每档"),
    mightBreachThreshold: g("武将", "武力摧锋阈值"),
    mightBreach: g("武将", "武力加缺口"),
    siegeAptitudeBreach: g("武将", "攻城适性加缺口"),
    holdAptitudeBonus: g("武将", "守城适性加防守"),
    aptitudeTerrainBonus: g("武将", "地形适性加战力"),
    civilAptitudeBonus: g("武将", "治民适性加产出"),
    politicsYieldDivisor: g("武将", "政治产出除数"),
    charismaMoraleThreshold: g("武将", "魅力安民阈值"),
    retinueCap: g("武将", "随军上限"),
    deputyWeight: g("武将", "副将权重"),
    deputyBreachCap: g("武将", "副将缺口上限"),
    troopsPerOfficer: g("武将", "每将统兵"),
    fillerLeadership: g("武将", "庸将_统率"),
    fillerMight: g("武将", "庸将_武力"),
    fillerPolitics: g("武将", "庸将_政治"),
    fillerCharisma: g("武将", "庸将_魅力"),
    formationBreach: g("阵型", "克制加缺口"),
    suadeWindow: g("招降", "窗口季数"),
    suadeBase: g("招降", "基础成功率"),
    suadePerStat: g("招降", "每点五维折减"),
    suadeHomeBonus: g("招降", "同乡加成"),
    goldOn: !!(pack.constants?.["金"]?.["启用"]),
    goldPerTier: g("产出", "金_每产出档"),
    goldDecay: g("金", "收入_逐郡递减"),
    goldBase: g("金", "基础收入"),
    goldUpkeepPerTroop: g("金", "军费_每兵每季"),
    goldPerLevyTroop: g("金", "募兵_每兵"),
    goldPerWall: g("金", "修城_每点"),
    goldGear: { none: 0, ram: g("金", "治械_冲车"), mound: g("金", "治械_土山") },
    goldStart: g("金", "开局金"),
    goldCap: g("金", "上限"),
    betrayMoralePenalty: g("外交", "背盟_民心罚"),
    betrayBanSeasons: g("外交", "背盟_禁缔盟季数"),
    siegeMaxSeasons: g("围城", "上限季数"),
    siegeBreachPerSeason: g("围城", "每季加缺口"),
    siegeAttackerLoss: g("围城", "攻方每季损耗"),
    siegeDefenderLoss: g("围城", "守方每季损耗"),
    siegeWithdrawKeep: g("围城", "撤围残兵"),
    siegeDefenseErosion: g("围城", "每季削城防"),
    fieldRout: g("野战", "溃退比"),
    fieldPush: g("野战", "后撤比"),
    fieldStall: g("野战", "相持比"),
    fieldRoutLoserLoss: g("野战", "溃退_败方损"),
    fieldRoutWinnerLoss: g("野战", "溃退_胜方损"),
    fieldPushLoserLoss: g("野战", "后撤_败方损"),
    fieldPushWinnerLoss: g("野战", "后撤_胜方损"),
    fieldStallLoss: g("野战", "相持_双方损"),
    fieldDefeatLoss: g("野战", "大败_攻方损"),
    musterTake: g("集结", "每郡抽调比"),
    wildRecruitRatio: g("随机", "在野可招募比例"),
    units: unitTable(pack),
    counterBonus: g("兵种", "克制加成"),
    gearLadder: ["none", "ram", "mound"],
    epochCount: g("时钟", "纪元数"),
    epochLimit: g("时钟", "纪元时限"),
    epochMin: g("时钟", "纪元最短"),
    neutralGrowth: { 1: 0, 2: g("时钟", "无主自守_纪元二"), 3: g("时钟", "无主自守_纪元三") },
  };
}
