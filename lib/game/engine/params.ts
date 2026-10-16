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
  /** 据点：开局守军、取兵比、折损、仓补粮 */
  holdGarrison: number;
  holdSeizeRatio: number;
  holdLoss: number;
  depotProvision: number;
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
  /** 令数随郡数增长的指数。0.5 即 sqrt */
  apExp: number;
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
  /**
   * 三阵各自的长处。相克之外，各落在**不同的管子**上——
   * 鱼鳞加攻减守、鹤翼加速减攻、方圆加守减速。见内容包 constants.阵型.各阵之长
   */
  formAtk: Record<string, number>;
  formDef: Record<string, number>;
  /** 阵型给城中存粮加几季。方圆结圆自守，耐围 */
  formProv: Record<string, number>;
  formMarch: Record<string, number>;
  /** 招降：窗口季数、基础成功率、每点五维折减、同乡加成 */
  suadeWindow: number;
  suadeBase: number;
  suadePerStat: number;
  suadeHomeBonus: number;
  /** 劝降势力：目标郡数上限、实力倍数门槛、基础成功率、民心折减、倍数加成 */
  submitMaxCommanderies: number;
  /**
   * 劝降方自身的门槛：控州数，以及**已克敌城数**。
   * 看的是「自己够不够强」而不是「对方有多小」；而「够强」要打出来，
   * 不能只看地有多大——克城数那一条就是为此而设，见内容包的「门槛_为何要克城数」。
   */
  submitMinZhou: number;
  submitMinConquests: number;
  submitRatio: number;
  submitHegemonyZhou: number; submitHegemonyRatio: number;
  submitBase: number;
  submitPerMorale: number;
  submitPerRatio: number;
  goldOn: boolean;
  goldPerTier: number;
  goldDecay: number;
  /** 逐郡递减的地板：第 n 个郡至少按原值的这个比例计。见包里「为何要地板」 */
  goldDecayFloor: number;
  /** 待命军团归队：满几季 / 兵力跌破多少 */
  armyIdleLimit: number; armyMinTroops: number;
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
  /** 围城耗粮的分档：城中戍兵超过开局戍兵这几个倍数时，每季多耗一石 */
  siegeEatStep1: number; siegeEatStep2: number; siegeEatMax: number;
  /** 首攻（尚未筑土工造器械）扣几个缺口。围困每季 +1 会把它挣回来 */
  firstAssaultPenalty: number;
  /** 可防守里城防那一项：基准（0 = 从零算起）与「坚城」的门槛与加成 */
  defenseFloorBase: number; fortLine: number; fortBonus: number;
  siegeAttackerLoss: number; siegeDefenderLoss: number; siegeWithdrawKeep: number;
  siegeGarrisonFloor: number; siegeDefenseFloor: number; siegeMinTroops: number;
  siegeGripRatio: number; siegeEncircle: boolean;
  isolatedSubmit: boolean;
  swaySeasons: number; swaySoleOnly: boolean;
  /** 联军：一家坐大到霸档，天下共讨之。见内容包 constants.联军 */
  coalitionShare: number; coalitionLead: number; coalitionBreak: boolean;
  coalitionBanSeasons: number; coalitionAllySeasons: number;
  /** 联军可否复发：禁盟期满而仍独大则再起一次 */
  coalitionRepeat: boolean;
  /** 名器：朝廷在谁手里谁就能授州牧。见内容包 constants.名器 */
  courtSeat: string; investSway: boolean;
  /** 行军。见内容包 constants.行军 */
  marchDayPerCost: number; marchSeasonDays: number;
  marchAssaultWindow: number; marchGearMul: number;
  /** 粮：一律以「季」计，不是第二种货币。见内容包 constants.粮 */
  provBase: number; provPerTier: number; provCap: number;
  provStockSeasons: number; provStockGold: number; armySupplyCap: number;
  /** 建筑。永久生效，每郡至多 buildCap 座；见内容包 constants.建筑 */
  buildCap: number;
  buildGold: Record<string, number>;
  officeOrders: number; granarySeasons: number; marketMul: number; drillMul: number;
  ironworksForgeCut: number; salternGold: number; studTroopMul: number;
  /** 铁官让器械只降几级（而非清零）。包里写着，此前引擎硬编码成 1 */
  ironworksGearDrop: number;
  /** 募兵扣几档民心、安民加几档。同上，此前是写死的 ±1 */
  levyMorale: number; sootheMorale: number;
  /** 三项的顶。此前写死在 resolve 里，包里没有——模型于是不知道 5 是不是满 */
  yieldMax: number; moraleMax: number; defenseMax: number;
  farmsteadProv: number; farmsteadDrillMul: number;
  farmsteadUpkeepCut: number; officeCutYield: number; granaryProv: number;
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
  /** 无主郡每季自筑城防（按纪元）与其上限。见包里「为何改成筑壁」 */
  neutralWall: Record<number, number>; neutralWallCap: number;
  neutralDecay: number; neutralDecayFloor: number;
  /** 统一天下的州数门槛。达到即局终，胜者为该势力 */
  unifyZhou: number;
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
    holdGarrison: g("据点", "守军"),
    holdSeizeRatio: g("据点", "取兵比"),
    holdLoss: g("据点", "折损"),
    depotProvision: g("据点", "仓补粮"),
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
    apExp: g("令数", "版图指数"),
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
    formAtk: { scale: g("阵型", "鱼鳞_攻缺口"), wings: g("阵型", "鹤翼_攻缺口"), square: 0 },
    formDef: { scale: g("阵型", "鱼鳞_守可防守"), wings: 0, square: 0 },
    formProv: { scale: 0, wings: 0, square: g("阵型", "方圆_加存粮") },
    formMarch: { scale: 0, wings: g("阵型", "鹤翼_行军季"), square: g("阵型", "方圆_行军季") },
    suadeWindow: g("招降", "窗口季数"),
    suadeBase: g("招降", "基础成功率"),
    suadePerStat: g("招降", "每点五维折减"),
    suadeHomeBonus: g("招降", "同乡加成"),
    submitMaxCommanderies: g("归降", "门槛_目标郡数"),
    submitMinZhou: g("归降", "门槛_劝降方州数"),
    submitMinConquests: g("归降", "门槛_已克敌城"),
    submitRatio: g("归降", "门槛_实力倍数"),
    submitHegemonyZhou: g("归降", "霸业_劝降方州数"),
    submitHegemonyRatio: g("归降", "霸业_实力倍数"),
    submitBase: g("归降", "基础成功率"),
    submitPerMorale: g("归降", "民心每档折减"),
    submitPerRatio: g("归降", "倍数加成"),
    goldOn: !!(pack.constants?.["金"]?.["启用"]),
    goldPerTier: g("产出", "金_每产出档"),
    goldDecay: g("金", "收入_逐郡递减"),
    goldDecayFloor: g("金", "收入_递减地板"),
    armyIdleLimit: g("军团", "待命归队_季数"),
    armyMinTroops: g("军团", "待命归队_兵力下限"),
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
    siegeEatStep1: g("围城", "耗粮_超编一档"),
    siegeEatStep2: g("围城", "耗粮_超编二档"),
    siegeEatMax: g("围城", "耗粮上限"),
    firstAssaultPenalty: g("攻城", "首攻缺口罚"),
    defenseFloorBase: g("攻城", "城防基准"),
    fortLine: g("攻城", "坚城线"),
    fortBonus: g("攻城", "坚城加成"),
    siegeMinTroops: g("围城", "撤围_兵力下限"),
    siegeGripRatio: g("围城", "有效围困比"),
    // 布尔值不走 num()——那个函数是给数值用的，会把 true 判成缺数据
    siegeEncircle: C["围城"]?.["合围_邻郡过半"] === true,
    isolatedSubmit: C["孤悬"]?.["四邻皆属一家"] === true,
    swaySeasons: g("孤悬", "归附_季数"),
    swaySoleOnly: C["孤悬"]?.["归附_只一家接壤"] === true,
    coalitionShare: g("联军", "门槛_占全图郡数"),
    coalitionLead: g("联军", "门槛_倍于次强"),
    coalitionBreak: C["联军"]?.["称霸即绝盟"] === true,
    coalitionRepeat: C["联军"]?.["可复发"] === true,
    coalitionBanSeasons: g("联军", "绝盟后不得再缔_季数"),
    coalitionAllySeasons: g("联军", "接壤诸家自动互盟_季数"),
    courtSeat: String(C["名器"]?.["朝廷所在"] ?? "京兆尹"),
    investSway: C["名器"]?.["州牧_可越四境"] === true,
    marchDayPerCost: g("行军", "日每单位"),
    marchSeasonDays: g("行军", "一季日数"),
    marchAssaultWindow: g("行军", "攻城窗口日"),
    marchGearMul: g("行军", "带械行军系数"),
    provBase: g("粮", "郡存粮_基数"),
    provPerTier: g("粮", "郡存粮_每产出档"),
    provCap: g("粮", "郡存粮_上限"),
    provStockSeasons: g("粮", "屯粮_加季"),
    provStockGold: g("粮", "屯粮_金"),
    armySupplyCap: g("粮", "军团存粮_上限"),
    buildCap: g("建筑", "每郡上限"),
    buildGold: {
      office: g("建筑", "官府_金"), granary: g("建筑", "仓廪_金"),
      market: g("建筑", "市_金"), drill: g("建筑", "校场_金"),
      ironworks: g("建筑", "铁官_金"), saltern: g("建筑", "盐场_金"),
      stud: g("建筑", "马苑_金"), farmstead: g("建筑", "屯田_金"),
    },
    officeOrders: g("建筑", "官府_加令"),
    granarySeasons: g("建筑", "仓廪_加存粮"),
    marketMul: g("建筑", "市_产金倍"),
    drillMul: g("建筑", "校场_增兵倍"),
    ironworksForgeCut: g("建筑", "铁官_治械折"),
    ironworksGearDrop: g("建筑", "铁官_降几级"),
    levyMorale: g("内政", "募兵扣民心"),
    sootheMorale: g("内政", "安民增民心"),
    yieldMax: g("产出", "产出档上限"),
    moraleMax: g("内政", "民心档上限"),
    defenseMax: g("内政", "城防上限"),
    salternGold: g("建筑", "盐场_每季产金"),
    studTroopMul: g("建筑", "马苑_统兵倍"),
    farmsteadProv: g("建筑", "屯田_邻郡回粮"),
    farmsteadDrillMul: g("建筑", "屯田_增兵倍"),
    farmsteadUpkeepCut: g("建筑", "屯田_军费折"),
    officeCutYield: g("建筑", "官府_断供产出"),
    granaryProv: g("建筑", "仓廪_回粮"),
    siegeBreachPerSeason: g("围城", "每季加缺口"),
    siegeAttackerLoss: g("围城", "攻方每季损耗"),
    siegeDefenderLoss: g("围城", "守方每季损耗"),
    siegeWithdrawKeep: g("围城", "撤围残兵"),
    siegeDefenseErosion: g("围城", "每季削城防"),
    siegeGarrisonFloor: g("围城", "守军地板"),
    siegeDefenseFloor: g("围城", "城防地板"),
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
    unifyZhou: g("胜负", "统一州数"),
    epochMin: g("时钟", "纪元最短"),
    neutralWall: { 1: 0, 2: g("时钟", "无主筑壁_纪元二"), 3: g("时钟", "无主筑壁_纪元三") },
    neutralWallCap: g("时钟", "无主筑壁_上限"),
    neutralDecay: g("时钟", "无主散兵_每季"),
    neutralDecayFloor: g("时钟", "无主散兵_下限比"),
  };
}

/**
 * 一郡的存粮上限，以**季**计。产出档 1–10 → 2–5 季。
 *
 * 放在这里而不是 setup.ts：setup 与 resolve 都要用它，而 setup 依赖 resolve 的类型，
 * 放过去会成环。它只吃产出档与参数，本来也不属于「开局装配」。
 * 产出档本身是 log10(户数)，所以「富郡耐围、瘠郡易饥」不必另立一份数据。
 */
export function provisionsCap(yieldTier: number, P: EngineParams): number {
  return Math.min(P.provCap, P.provBase + Math.floor(yieldTier * P.provPerTier));
}

/**
 * 行军要走几季才动得了手。
 *
 * 返回 0 表示当季抵达并首攻；1 表示当季只到城下扎营、首攻推到下季；以此类推。
 *
 * 判据是「这一击本季落不落得下」，不是「走了几里」——用户问过一个回合一季
 * 是不是太长，量下来 232 条邻郡边只有一条走不满一季，行军天然是季度以下的量。
 * 把回合切到月是 3 倍模型调用换一堆无事可决的回合；真正缺的是这个二值判断，
 * 而它一季就装得下。
 *
 * 带器械再乘 marchGearMul：辎重重则行迟。这把「带械攻城更易」与
 * 「可能错过本季这一击」摆成一个取舍。
 */
export function marchSeasons(
  cost: number, withGear: boolean, P: EngineParams,
  /**
   * 起兵郡的阵型。鹤翼两翼包抄、轻捷，少走一季；方圆结圆自守、辎重多，多走一季。
   * 不给则按 0 算——这条要能在不知阵型的地方（如纯地理的尺子）照旧算出天数
   */
  form?: string,
): number {
  const days = cost * P.marchDayPerCost * (withGear ? P.marchGearMul : 1);
  const base = days <= P.marchAssaultWindow
    ? 0 : Math.ceil((days - P.marchAssaultWindow) / P.marchSeasonDays);
  // 最少 0：鹤翼能把「一季到」变成「当季即至」，但变不出负的季数
  return Math.max(0, base + (form ? P.formMarch[form] ?? 0 : 0));
}

/**
 * 一郡的存粮上限：底数由产出档定，仓廪再加 granarySeasons 季。
 * 无主郡没有建筑，走的也是同一个函数——口径要一致，不能一处带建筑一处不带。
 */
export function provCapOf(
  c: { yieldTier: number; buildings: readonly string[]; formation?: string },
  P: EngineParams,
): number {
  return provisionsCap(c.yieldTier, P)
    + (c.buildings.includes("granary") ? P.granarySeasons : 0)
    // 方圆结圆自守，城中多囤一季。围它要多熬一季，而强攻的判据一点不动
    + (c.formation ? P.formProv[c.formation] ?? 0 : 0);
}

/**
 * 被围时每季耗多少存粮。
 *
 * 此前恒 1，与城里有多少人无关——三万三千戍兵的豫章郡与三百兵的上谷郡撑一样久。
 * 现在按**城中戍兵相对开局戍兵的倍数**分档：基准取 startGarrison（由户口算出），
 * 那正是「这座城本来养得起多少兵」。
 *
 * 一处出处：结算扣粮、候选标签上的「存粮可支 N 季」、界面的进度环都读它。
 * 分家的代价这个仓库付过好几次（缺口曾在候选与结算各算一遍）。
 */
export function siegeEat(
  c: { garrison: number; startGarrison: number }, P: EngineParams,
): number {
  const ratio = c.garrison / Math.max(1, c.startGarrison);
  const n = ratio >= P.siegeEatStep2 ? 3 : ratio >= P.siegeEatStep1 ? 2 : 1;
  return Math.min(P.siegeEatMax, n);
}

/** 被围时还撑得住几季。存粮 ÷ 每季耗粮，向上取整 */
export function siegeHoldSeasons(
  c: { garrison: number; startGarrison: number; provisions: number }, P: EngineParams,
): number {
  return Math.ceil(c.provisions / siegeEat(c, P));
}
