import {
  HISTORICAL_PLACES,
  HISTORICAL_ROUTES,
  getHistoricalPlace,
  projectLongitudeLatitude,
  type HistoricalCertainty,
  type HistoricalPlaceKind,
} from "./historical-map";

export const FACTIONS = [
  { id: "cao", name: "曹操", color: "#9d3f35", motto: "经略兖州，奉迎天子", region: "兖州", playable: true, leader: { name: "曹操", leadership: 5, strength: 3, intelligence: 5, politics: 5, charisma: 4 } },
  { id: "yuan", name: "袁绍", color: "#9b7b35", motto: "据有河北，南争中原", region: "冀州", playable: true, leader: { name: "袁绍", leadership: 4, strength: 3, intelligence: 3, politics: 4, charisma: 5 } },
  { id: "liu", name: "刘备", color: "#416d8f", motto: "安定徐州，聚拢人心", region: "徐州", playable: true, leader: { name: "刘备", leadership: 4, strength: 4, intelligence: 3, politics: 4, charisma: 5 } },
  { id: "sun", name: "孙策", color: "#bc5b2f", motto: "渡江而东，平定吴会", region: "江东", playable: true, leader: { name: "孙策", leadership: 5, strength: 5, intelligence: 3, politics: 3, charisma: 4 } },
  { id: "biao", name: "刘表", color: "#47735e", motto: "坐镇荆襄，通连四方", region: "荆州", playable: true, leader: { name: "刘表", leadership: 3, strength: 2, intelligence: 4, politics: 4, charisma: 4 } },
  { id: "zhang", name: "刘璋", color: "#795f3e", motto: "凭恃天府，固守巴蜀", region: "益州", playable: true, leader: { name: "刘璋", leadership: 2, strength: 2, intelligence: 3, politics: 4, charisma: 3 } },
  { id: "gongsun", name: "公孙瓒", color: "#8e9898", motto: "白马塞北", region: "幽州", playable: false, leader: { name: "公孙瓒", leadership: 4, strength: 4, intelligence: 2, politics: 2, charisma: 3 } },
  { id: "du", name: "公孙度", color: "#647a86", motto: "雄据辽东", region: "辽东", playable: false, leader: { name: "公孙度", leadership: 3, strength: 3, intelligence: 3, politics: 4, charisma: 2 } },
  { id: "lu", name: "吕布", color: "#702c35", motto: "纵横兖州", region: "濮阳", playable: false, leader: { name: "吕布", leadership: 4, strength: 5, intelligence: 1, politics: 1, charisma: 3 } },
  { id: "shu", name: "袁术", color: "#776b34", motto: "雄据淮南", region: "淮南", playable: false, leader: { name: "袁术", leadership: 3, strength: 2, intelligence: 2, politics: 3, charisma: 3 } },
  { id: "han", name: "张鲁", color: "#326a67", motto: "扼守汉中", region: "汉中", playable: false, leader: { name: "张鲁", leadership: 3, strength: 2, intelligence: 3, politics: 4, charisma: 4 } },
  { id: "li", name: "李傕", color: "#5d5353", motto: "挟持朝廷", region: "关中", playable: false, leader: { name: "李傕", leadership: 3, strength: 4, intelligence: 2, politics: 1, charisma: 1 } },
  { id: "ma", name: "马腾", color: "#7c4b33", motto: "驰骋凉州", region: "凉州", playable: false, leader: { name: "马腾", leadership: 4, strength: 4, intelligence: 2, politics: 2, charisma: 4 } },
  { id: "kong", name: "孔融", color: "#66825c", motto: "守北海，礼贤士", region: "北海", playable: false, leader: { name: "孔融", leadership: 2, strength: 1, intelligence: 4, politics: 4, charisma: 5 } },
  { id: "xiu", name: "张绣", color: "#694f64", motto: "据宛扼道", region: "南阳", playable: false, leader: { name: "张绣", leadership: 4, strength: 4, intelligence: 2, politics: 2, charisma: 2 } },
  { id: "yao", name: "刘繇", color: "#607d72", motto: "据丹阳而守江东", region: "丹阳", playable: false, leader: { name: "刘繇", leadership: 2, strength: 2, intelligence: 3, politics: 4, charisma: 3 } },
  { id: "wang", name: "王朗", color: "#756985", motto: "治会稽", region: "会稽", playable: false, leader: { name: "王朗", leadership: 2, strength: 1, intelligence: 4, politics: 5, charisma: 3 } },
  { id: "shi", name: "士燮", color: "#4c7350", motto: "保境交州", region: "交州", playable: false, leader: { name: "士燮", leadership: 2, strength: 2, intelligence: 4, politics: 5, charisma: 4 } },
] as const;

export const MAJOR_FACTIONS = FACTIONS.filter((faction) => faction.playable);
export type FactionId = (typeof FACTIONS)[number]["id"];
export type GameStatus = "playing" | "victory" | "defeat" | "draw";
export type Season = "春" | "夏" | "秋" | "冬";
export type RouteTerrain = "官道" | "平原" | "山道" | "关隘" | "大河";

export interface OfficerStats { leadership: number; strength: number; intelligence: number; politics: number; charisma: number; }
export interface FactionState { id: FactionId; grain: number; gold: number; prestige: number; legitimacy: number; trust: number; }
export interface CityState {
  id: string; name: string; historicalNote: string; modernReference: string; province: string; commandery: string;
  kind: HistoricalPlaceKind; certainty: HistoricalCertainty; owner: FactionId; x: number; y: number; troops: number;
  level: number; morale: number; publicOrder: number; defense: number; neighbors: string[];
}
export interface RouteDefinition { id: string; from: string; to: string; terrain: RouteTerrain; routeName?: string; grainCost: number; }
export type StrategyAction =
  | { type: "develop"; sourceId: string }
  | { type: "recruit"; sourceId: string }
  | { type: "appease"; sourceId: string }
  | { type: "march"; sourceId: string; targetId: string };
export interface PlannedOrder { factionId: FactionId; action: StrategyAction; source: MatchLogEntry["source"]; reason?: string; controller?: string; usageTotal?: number; }
export interface MatchLogEntry { id: number; turn: number; factionId?: FactionId; source: "system" | "player" | "local-ai" | "openrouter"; message: string; }
export interface StrategyState {
  turn: number; year: number; seasonIndex: number; maxTurns: number; seed: string; playerFactionId: FactionId;
  status: GameStatus; winnerFactionId?: FactionId; cities: CityState[]; factions: FactionState[]; log: MatchLogEntry[];
}

const SEASONS: Season[] = ["春", "夏", "秋", "冬"];
const OPERATIONAL_PLACES = HISTORICAL_PLACES.filter((place) => place.operational);
const OPERATIONAL_IDS = new Set(OPERATIONAL_PLACES.map((place) => place.id));
const explicitOwners: Partial<Record<string, FactionId>> = {
  xiangping: "du", ji: "gongsun", beiping: "gongsun",
  nanpi: "yuan", ye: "yuan", pingyuan: "yuan", jinyang: "yuan", shangdang: "yuan",
  beihai: "kong", jinan: "kong", puyang: "lu", baima: "lu",
  chenliu: "cao", xuxian: "cao", guandu: "cao", yanjin: "cao",
  qiao: "shu", runan: "shu", shouchun: "shu", hefei: "shu", guangling: "shu", jiangdu: "shu",
  xiaopei: "liu", xiapi: "liu",
  changan: "li", hongnong: "li", luoyang: "li", hangu: "li", tongguan: "li", hulao: "li", wuguan: "li",
  wuwei: "ma", xiping: "ma", tianshui: "ma", sanguan: "ma", wudu: "ma",
  hanzhong: "han", yangping: "han", shangyong: "han",
  wan: "xiu", xinye: "xiu",
  chaisang: "sun", poyang: "sun", hukou: "sun", lujiang: "sun", ruxu: "sun",
  moling: "yao", wu: "yao", niuzhu: "yao", kuaiji: "wang", jiaozhi: "shi",
};

function scenarioOwner(id: string, province: string): FactionId {
  if (explicitOwners[id]) return explicitOwners[id];
  if (province === "凉州" || province === "雍州") return "ma";
  if (province === "益州") return "zhang";
  if (province === "荆州") return "biao";
  if (province === "扬州") return "yao";
  if (province === "交州") return "shi";
  if (province === "幽州") return "gongsun";
  if (province === "并州" || province === "冀州") return "yuan";
  if (province === "青州") return "kong";
  if (province === "徐州") return "liu";
  if (province === "豫州") return "shu";
  if (province === "兖州") return "cao";
  return "li";
}

function idVariation(id: string, modulo: number): number {
  return [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % modulo;
}

function baseStats(kind: HistoricalPlaceKind, rank: 1 | 2 | 3) {
  const gateBonus = kind === "gate" ? 22 : 0;
  const portPenalty = kind === "port" ? -4 : 0;
  return {
    troops: 48 + (4 - rank) * 24 + gateBonus + idVariation(kind, 17), level: rank === 1 ? 3 : rank === 2 ? 2 : 1,
    morale: 62 + (4 - rank) * 4 + idVariation(kind, 9), publicOrder: 59 + (4 - rank) * 5 + idVariation(kind, 11),
    defense: 41 + (4 - rank) * 9 + gateBonus + portPenalty,
  };
}

export const ROUTES: RouteDefinition[] = HISTORICAL_ROUTES
  .filter((route) => OPERATIONAL_IDS.has(route.from) && OPERATIONAL_IDS.has(route.to))
  .map((route) => {
    const from = getHistoricalPlace(route.from)!;
    const to = getHistoricalPlace(route.to)!;
    const longitudeScale = Math.cos((((from.latitude + to.latitude) / 2) * Math.PI) / 180);
    const distance = Math.hypot((from.longitude - to.longitude) * longitudeScale, from.latitude - to.latitude);
    const multiplier = route.terrain === "山道" ? 1.35 : route.terrain === "关隘" ? 1.45 : route.terrain === "大河" ? 1.18 : 1;
    return { ...route, id: [route.from, route.to].sort().join("--"), grainCost: Math.max(7, Math.min(32, Math.round(6 + distance * 3.8 * multiplier))) };
  });

const citySeed: Array<Omit<CityState, "neighbors">> = OPERATIONAL_PLACES.map((place) => ({
  id: place.id, name: place.name, historicalNote: place.historicalNote, modernReference: place.modernReference,
  province: place.province, commandery: place.commandery, kind: place.kind, certainty: place.certainty,
  owner: scenarioOwner(place.id, place.province), ...projectLongitudeLatitude(place.longitude, place.latitude), ...baseStats(place.kind, place.rank),
}));

function getOwnedOpeningCount(factionId: FactionId): number { return citySeed.filter((city) => city.owner === factionId).length; }
const resourceOverrides: Partial<Record<FactionId, Omit<FactionState, "id">>> = {
  cao: { grain: 156, gold: 104, prestige: 12, legitimacy: 18, trust: 54 }, yuan: { grain: 186, gold: 122, prestige: 18, legitimacy: 26, trust: 50 },
  liu: { grain: 98, gold: 66, prestige: 12, legitimacy: 38, trust: 72 }, sun: { grain: 102, gold: 75, prestige: 10, legitimacy: 10, trust: 58 },
  biao: { grain: 192, gold: 124, prestige: 14, legitimacy: 28, trust: 62 }, zhang: { grain: 188, gold: 112, prestige: 8, legitimacy: 20, trust: 64 },
};
const startingResources = Object.fromEntries(FACTIONS.map((faction) => [faction.id, resourceOverrides[faction.id] ?? {
  grain: 88 + getOwnedOpeningCount(faction.id) * 7, gold: 54 + getOwnedOpeningCount(faction.id) * 5,
  prestige: 5, legitimacy: faction.id === "li" ? 45 : 10, trust: 42,
}])) as Record<FactionId, Omit<FactionState, "id">>;

export const STRATEGIC_SEATS = ["ye", "luoyang", "xuxian", "changan", "hanzhong", "chengdu", "xiangyang", "shouchun", "moling"] as const;
export function getFactionDefinition(id: FactionId) { return FACTIONS.find((faction) => faction.id === id) ?? FACTIONS[0]; }
function factionName(id: FactionId): string { return getFactionDefinition(id).name; }
function leaderStats(id: FactionId): OfficerStats { return getFactionDefinition(id).leader; }

function deterministicRoll(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) { hash ^= key.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967295;
}

function cloneState(state: StrategyState): StrategyState {
  return { ...state, cities: state.cities.map((city) => ({ ...city, neighbors: [...city.neighbors] })), factions: state.factions.map((faction) => ({ ...faction })), log: state.log.map((entry) => ({ ...entry })) };
}
function addLog(state: StrategyState, message: string, source: MatchLogEntry["source"], factionId?: FactionId): void {
  const nextId = (state.log.at(-1)?.id ?? 0) + 1;
  state.log.push({ id: nextId, turn: state.turn, factionId, source, message });
  if (state.log.length > 180) state.log = state.log.slice(-180);
}
function getRoute(from: string, to: string): RouteDefinition | undefined { return ROUTES.find((route) => route.id === [from, to].sort().join("--")); }
export function getCurrentSeason(state: StrategyState): Season { return SEASONS[state.seasonIndex] ?? "春"; }

export function createStrategyGame(playerFactionId: FactionId, seed: string): StrategyState {
  const cities = citySeed.map((city) => ({ ...city, neighbors: ROUTES.flatMap((route) => route.from === city.id ? [route.to] : route.to === city.id ? [route.from] : []) }));
  const state: StrategyState = { turn: 1, year: 194, seasonIndex: 1, maxTurns: 20, seed: seed.trim() || "xingping-194-001", playerFactionId, status: "playing", cities, factions: FACTIONS.map((faction) => ({ id: faction.id, ...startingResources[faction.id] })), log: [] };
  addLog(state, `兴平元年夏，${cities.length} 处城邑、关港与渡口进入同一沙盘。当前观察席位为${factionName(playerFactionId)}。`, "system");
  return state;
}

export function getFactionState(state: StrategyState, factionId: FactionId): FactionState {
  const faction = state.factions.find((item) => item.id === factionId);
  if (!faction) throw new Error(`Unknown faction: ${factionId}`);
  return faction;
}
export function getOwnedCities(state: StrategyState, factionId: FactionId): CityState[] { return state.cities.filter((city) => city.owner === factionId); }

export function getLegalActions(state: StrategyState, factionId: FactionId): StrategyAction[] {
  if (state.status !== "playing") return [];
  const faction = getFactionState(state, factionId);
  const actions: StrategyAction[] = [];
  for (const city of getOwnedCities(state, factionId)) {
    if (faction.gold >= 18 && city.level < 4 && city.kind !== "crossing") actions.push({ type: "develop", sourceId: city.id });
    if (faction.grain >= 24 && faction.gold >= 12 && city.publicOrder >= 38 && city.kind !== "crossing") actions.push({ type: "recruit", sourceId: city.id });
    if (faction.gold >= 10 && (city.publicOrder < 95 || city.morale < 95)) actions.push({ type: "appease", sourceId: city.id });
    if (city.troops >= 68) for (const targetId of city.neighbors) {
      const target = state.cities.find((candidate) => candidate.id === targetId);
      const route = getRoute(city.id, targetId);
      if (target && route && target.owner !== factionId && faction.grain >= route.grainCost) actions.push({ type: "march", sourceId: city.id, targetId });
    }
  }
  return actions;
}

export function actionKey(action: StrategyAction): string { return action.type === "march" ? `${action.type}:${action.sourceId}:${action.targetId}` : `${action.type}:${action.sourceId}`; }
export function actionLabel(state: StrategyState, action: StrategyAction): string {
  const source = state.cities.find((city) => city.id === action.sourceId)?.name ?? action.sourceId;
  if (action.type === "develop") return `整治 ${source}`;
  if (action.type === "recruit") return `在 ${source} 征募`;
  if (action.type === "appease") return `安抚 ${source}`;
  const target = state.cities.find((city) => city.id === action.targetId)?.name ?? action.targetId;
  const route = getRoute(action.sourceId, action.targetId);
  return `从 ${source} 行军 ${target}${route ? ` · ${route.routeName ?? route.terrain}` : ""}`;
}

function applyResolvedAction(state: StrategyState, factionId: FactionId, action: StrategyAction, source: MatchLogEntry["source"]): void {
  const legalAction = getLegalActions(state, factionId).find((candidate) => actionKey(candidate) === actionKey(action));
  if (!legalAction) { addLog(state, `${factionName(factionId)}的密令因局势变化而失效。`, source, factionId); return; }
  const faction = getFactionState(state, factionId);
  const city = state.cities.find((item) => item.id === legalAction.sourceId);
  if (!city) return;
  if (legalAction.type === "develop") {
    const politics = leaderStats(factionId).politics; faction.gold -= 18; faction.prestige += 2; city.level += 1;
    city.publicOrder = Math.min(100, city.publicOrder + politics * 2); city.defense = Math.min(100, city.defense + 6 + politics);
    addLog(state, `${factionName(factionId)}整治${city.name}，据点升至 ${city.level} 级。`, source, factionId); return;
  }
  if (legalAction.type === "recruit") {
    const charisma = leaderStats(factionId).charisma; faction.grain -= 24; faction.gold -= 12; city.troops += 38 + city.level * 7 + charisma * 4;
    city.morale = Math.max(42, city.morale - 4); city.publicOrder = Math.max(20, city.publicOrder - 8);
    addLog(state, `${factionName(factionId)}在${city.name}征募新军，民心降至 ${city.publicOrder}。`, source, factionId); return;
  }
  if (legalAction.type === "appease") {
    const charisma = leaderStats(factionId).charisma; faction.gold -= 10; city.morale = Math.min(100, city.morale + 8 + charisma);
    city.publicOrder = Math.min(100, city.publicOrder + 10 + charisma * 2); faction.trust = Math.min(100, faction.trust + 1);
    addLog(state, `${factionName(factionId)}安抚${city.name}，民心与士气回升。`, source, factionId); return;
  }
  const target = state.cities.find((item) => item.id === legalAction.targetId);
  const route = getRoute(city.id, legalAction.targetId);
  if (!target || !route) return;
  faction.grain -= route.grainCost;
  const formerOwner = target.owner;
  const attackingTroops = Math.floor(city.troops * 0.56);
  city.troops -= attackingTroops;
  const nodeDefense = target.kind === "gate" ? 0.24 : target.kind === "port" ? 0.08 : target.kind === "crossing" ? 0.04 : 0;
  const terrainDefense = route.terrain === "关隘" ? 0.20 : route.terrain === "山道" ? 0.12 : route.terrain === "大河" ? 0.10 : 0;
  const attackPower = attackingTroops * (0.78 + city.morale / 300 + leaderStats(factionId).leadership * 0.035 + leaderStats(factionId).strength * 0.012) * (0.9 + deterministicRoll(`${state.seed}:${state.turn}:${city.id}:${target.id}:A`) * 0.2);
  const defendPower = target.troops * (0.79 + target.morale / 320 + target.defense / 500 + leaderStats(formerOwner).leadership * 0.028 + terrainDefense + nodeDefense) * (0.91 + deterministicRoll(`${state.seed}:${state.turn}:${city.id}:${target.id}:D`) * 0.18);
  if (attackPower > defendPower) {
    target.owner = factionId; target.troops = Math.max(24, Math.round(attackingTroops - target.troops * 0.52)); target.morale = Math.max(46, city.morale - 9);
    target.publicOrder = Math.max(32, target.publicOrder - 10); target.defense = Math.max(28, target.defense - 12); faction.prestige += target.kind === "gate" || target.kind === "port" ? 6 : 9;
    addLog(state, `${factionName(factionId)}沿${route.routeName ?? route.terrain}攻取${target.name}${target.kind === "gate" ? "关" : target.kind === "port" ? "港" : ""}，${factionName(formerOwner)}失守。`, source, factionId);
  } else {
    target.troops = Math.max(20, Math.round(target.troops - attackingTroops * 0.38)); target.morale = Math.max(38, target.morale - 4); city.morale = Math.max(36, city.morale - 11);
    addLog(state, `${factionName(factionId)}进攻${target.name}受挫，${route.terrain}与守备拖累了攻势。`, source, factionId);
  }
}

function evaluateVictory(state: StrategyState): StrategyState {
  const cityThreshold = Math.max(18, Math.ceil(state.cities.length * 0.36));
  const contenders = state.factions.map((faction) => ({ id: faction.id, cities: getOwnedCities(state, faction.id).length, seats: STRATEGIC_SEATS.filter((seat) => state.cities.find((city) => city.id === seat)?.owner === faction.id).length })).filter((item) => item.cities > 0);
  const leader = contenders.find((item) => item.cities >= cityThreshold || (item.cities >= 15 && item.seats >= 4));
  if (!leader) return state;
  state.winnerFactionId = leader.id; state.status = leader.id === state.playerFactionId ? "victory" : "defeat";
  addLog(state, `${factionName(leader.id)}控制关键州郡与天下要冲，霸业已成。`, "system", leader.id); return state;
}

export function applyStrategyAction(state: StrategyState, factionId: FactionId, action: StrategyAction, source: MatchLogEntry["source"]): StrategyState {
  if (!getLegalActions(state, factionId).some((candidate) => actionKey(candidate) === actionKey(action))) return state;
  const next = cloneState(state); applyResolvedAction(next, factionId, action, source); return evaluateVictory(next);
}

export function resolveStrategyRound(state: StrategyState, orders: PlannedOrder[]): StrategyState {
  if (state.status !== "playing") return state;
  const next = cloneState(state);
  const ranked = [...orders].sort((a, b) => {
    const aScore = (a.action.type === "march" ? leaderStats(a.factionId).leadership : leaderStats(a.factionId).politics) * 10;
    const bScore = (b.action.type === "march" ? leaderStats(b.factionId).leadership : leaderStats(b.factionId).politics) * 10;
    return aScore !== bScore ? bScore - aScore : deterministicRoll(`${state.seed}:${state.turn}:${a.factionId}`) - deterministicRoll(`${state.seed}:${state.turn}:${b.factionId}`);
  });
  addLog(next, `${state.year} 年${getCurrentSeason(state)}季密令开始统一结算，共 ${ranked.length} 道。`, "system");
  for (const order of ranked) {
    if (order.source === "openrouter") addLog(next, `${factionName(order.factionId)} · ${order.controller ?? "OpenRouter model"}：${actionLabel(next, order.action)}${order.reason ? `｜${order.reason}` : ""}${order.usageTotal ? ` · ${order.usageTotal} tokens` : ""}`, order.source, order.factionId);
    applyResolvedAction(next, order.factionId, order.action, order.source);
  }
  return completeStrategyRound(next);
}

export function chooseLocalAction(state: StrategyState, factionId: FactionId): StrategyAction | null {
  const actions = getLegalActions(state, factionId);
  if (!actions.length) return null;
  const scored = actions.map((action) => {
    let score = deterministicRoll(`${state.seed}:${state.turn}:${factionId}:${actionKey(action)}`) * 9;
    const source = state.cities.find((city) => city.id === action.sourceId)!;
    if (action.type === "march") {
      const target = state.cities.find((city) => city.id === action.targetId)!; const route = getRoute(source.id, target.id)!;
      score += source.troops > target.troops * 1.4 ? 66 : source.troops > target.troops * 1.1 ? 35 : 2;
      if (getOwnedCities(state, target.owner).length === 1) score += 15;
      if ((STRATEGIC_SEATS as readonly string[]).includes(target.id)) score += 13;
      if (route.terrain === "关隘" || route.terrain === "山道") score -= 10;
    } else if (action.type === "recruit") { score += source.troops < 105 ? 42 : 14; score += source.publicOrder > 70 ? 8 : -12; }
    else if (action.type === "develop") { score += state.turn < 8 ? 35 : 12; score += source.publicOrder > 65 ? 7 : 0; }
    else score += source.publicOrder < 60 ? 50 : source.morale < 62 ? 32 : 6;
    return { action, score };
  });
  scored.sort((a, b) => b.score - a.score); return scored[0].action;
}

export function completeStrategyRound(state: StrategyState): StrategyState {
  if (state.status !== "playing") return state;
  const next = cloneState(state);
  for (const faction of next.factions) {
    const cities = getOwnedCities(next, faction.id); if (!cities.length) continue;
    faction.grain += cities.reduce((total, city) => total + (city.kind === "port" ? 8 : 4) + city.level * 3 + Math.floor(city.publicOrder / 30), 0);
    faction.gold += cities.reduce((total, city) => total + (city.kind === "port" ? 7 : 3) + city.level * 2 + Math.floor(city.publicOrder / 36), 0);
    for (const city of cities) city.morale = Math.min(100, city.morale + 2);
  }
  const eventRoll = deterministicRoll(`${next.seed}:event:${next.turn}`);
  const city = next.cities[Math.floor(eventRoll * next.cities.length) % next.cities.length]; const owner = getFactionState(next, city.owner);
  if (eventRoll < 0.2) { owner.grain += 26; city.publicOrder = Math.min(100, city.publicOrder + 3); addLog(next, `${city.name}秋成丰稔，${factionName(city.owner)}粮草增加。`, "system", city.owner); }
  else if (eventRoll < 0.34) { city.troops = Math.max(20, Math.round(city.troops * 0.86)); city.publicOrder = Math.max(28, city.publicOrder - 7); addLog(next, `${city.name}发生疫病，守军与民心受损。`, "system", city.owner); }
  else if (eventRoll < 0.46) { owner.gold = Math.max(0, owner.gold - 12); city.publicOrder = Math.max(24, city.publicOrder - 9); addLog(next, `${city.name}遭逢水患，府库拨款赈济。`, "system", city.owner); }
  evaluateVictory(next);
  if (next.status === "playing" && next.turn >= next.maxTurns) {
    const ranking = next.factions.map((faction) => ({ id: faction.id, score: getOwnedCities(next, faction.id).length * 100 + faction.prestige * 3 + faction.legitimacy * 2 + faction.trust + faction.gold / 8 })).sort((a, b) => b.score - a.score);
    next.winnerFactionId = ranking[0].id; next.status = ranking[0].id === next.playerFactionId ? "victory" : "defeat";
    addLog(next, `五年推演结束，${factionName(ranking[0].id)}以综合国势获胜。`, "system", ranking[0].id);
  }
  if (next.status === "playing") { next.turn += 1; next.seasonIndex = (next.seasonIndex + 1) % SEASONS.length; if (next.seasonIndex === 0) next.year += 1; }
  return next;
}

export function createAgentObservation(state: StrategyState, factionId: FactionId) {
  const legalActions = getLegalActions(state, factionId); const definition = getFactionDefinition(factionId);
  return {
    scenario: "兴平元年·群雄割据", date: { year: state.year, season: getCurrentSeason(state), turn: state.turn, maxTurns: state.maxTurns },
    faction: { name: definition.name, region: definition.region, ruler: definition.leader, ...getFactionState(state, factionId) },
    cities: state.cities.map(({ id, name, kind, province, commandery, owner, troops, level, morale, publicOrder, defense, neighbors }) => ({ id, name, kind, province, commandery, owner: factionName(owner), troops, level, morale, publicOrder, defense, neighbors })),
    routes: ROUTES, legalActions: legalActions.map((action, index) => ({ index, key: actionKey(action), label: actionLabel(state, action) })),
    objective: "在五年内争夺关键州郡、关隘和港口，同时维持粮草、民心、军心和信誉。每季只能提交一道密令。",
  };
}
