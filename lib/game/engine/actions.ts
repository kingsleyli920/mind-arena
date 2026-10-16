// 候选枚举与合法性校验。
//
// MERS R13 的要害：**动作参数不自由填，由引擎预筛成具体候选，模型做选择题**。
// 若让模型自由填参，仅征伐一项就是 目标 × 主将 × 兵力档 × 器械档，
// 袁绍十三郡下轻易过万种组合——模型选不过来，校验也挡不住乱填。
// 预筛之后每类动作 5–15 条，全部加起来落在 O(10²)，这才是可枚举。
import { recruitable, retinueAt, stationedAt, troopCap, isFiller, governorOf,
  type OfficerRef, type Roster }
  from "./officers.ts";
import { observedGarrison, observedFormation, tierOf } from "./intel.ts";
import { forecastCampaign, forecastField, forecastReinforce, projectSiege, projectCampaign }
  from "./forecast.ts";
import { formationEdge, FORMATION_CN } from "./combat.ts";
import { suadeChance } from "./officers.ts";

const statSum = (o: OfficerRef) =>
  o.leadership + o.might + o.intellect + o.politics + o.charisma;
import { attackRetinue } from "./officers.ts";
import { gradeIfTaken, standingOf, GRADE_CN, GRADE_RANK, type Geography } from "./victory.ts";
import { marchSeasons, provCapOf, type EngineParams } from "./params.ts";
import type {
  Action, Building, Candidate, CommanderyId, FactionId, GameState, Order, Formation, Resource,
} from "./types.ts";
import { cmp } from "./cmp.ts";

export interface Graph {
  /** 郡 → 邻接郡及其通行代价与地形 */
  adj: Map<CommanderyId, Array<{ to: CommanderyId; cost: number; terrain: string; gates: string[] }>>;
  /**
   * 路上的据点：关渡港仓。**它们有主**，开局归所在之郡的主人。
   *
   * `on` 是它扼守的那些边——一个渡口常服务多条路线，取下它，那几条路
   * 一起变。`host` 是它算在哪个郡境内，由通行图生成器按到两端治所的距离判定。
   */
  sites: Map<string, { id: string; name: string; kind: string; host: CommanderyId;
                       on: Array<[CommanderyId, CommanderyId]> }>;
}

export interface Rules {
  /** 每类动作最多给出几条候选。防止某一类挤占全部预算 */
  perTypeCap: number;
  /** 候选总数上限 */
  totalCap: number;
  freeUses: Record<string, number>;
  campaignAp: number;
  normalAp: number;
  perCommanderyOrders: number;
  /** 征伐标签上标不标「倾巢」（出兵后本郡守不住）。见 DEFAULT_RULES 的注 */
  bareNote?: boolean;
}

/** 这座己方郡国此刻是否正被别家围着（在途的不算——它还在路上） */
export function besiegedNow(s: GameState, id: CommanderyId, mine: FactionId): boolean {
  return s.armies.some((x) => x.target === id && x.marchLeft <= 0 && x.faction !== mine);
}

/** 建筑名。与内容包 actions[build].params[kind].tiers 一一对应 */
export const BUILD_CN: Record<Building, string> = {
  office: "官府", granary: "仓廪", market: "市", drill: "校场",
  ironworks: "铁官", saltern: "盐场", stud: "马苑", farmstead: "屯田",
};
/** 特殊建筑所需的物产。前四种为空，任何己方郡皆可建 */
export const BUILD_NEEDS: Partial<Record<Building, Resource>> = {
  ironworks: "iron", saltern: "salt", stud: "horse", farmstead: "tuntian",
};
export const RESOURCE_CN: Record<Resource, string> = {
  iron: "铁", salt: "盐", horse: "牧苑", tuntian: "可垦之地",
};

/**
 * 一郡本季还能不能下令。官府使该郡的令数上限 +officeOrders。
 *
 * 这条一定要抽出来：候选生成与 validate 各有一处判据，两处一旦分家，
 * 就会出现「候选给了但引擎拒收」——那正是 tests 里
 * 「界面的准入判据与引擎一致：按它贪心勾选，引擎不应拒绝任何一条」要挡的事
 */
export function ordersLeft(
  s: GameState, id: CommanderyId, rules: Rules, P: EngineParams | null,
): boolean {
  const c = s.commanderies[id];
  const cap = rules.perCommanderyOrders
    + (P && c?.buildings.includes("office") ? P.officeOrders : 0);
  return (c?.ordersThisSeason ?? 0) < cap;
}

export const DEFAULT_RULES: Rules = {
  // 征伐标签上标不标「倾巢」。默认标；关掉是为了跑 A/B——
  // 这个警告在弱席上每条候选都会亮（曹操 10/10、袁术 14/14），
  // 有没有用不能靠猜
  bareNote: true,
  perTypeCap: 12,
  totalCap: 60,
  freeUses: { scout: 3, appoint: 5 },
  campaignAp: 2,
  normalAp: 1,
  perCommanderyOrders: 2,
};

export function buildGraph(adjacency: { edges: Array<{
  from: string; to: string; cost: number; terrain: string;
  nodes: Array<{ id?: string; name: string; kind: string; host?: string }>;
}> }): Graph {
  const adj = new Map<string, Array<{ to: string; cost: number; terrain: string; gates: string[] }>>();
  const sites: Graph["sites"] = new Map();
  const push = (a: string, b: string, cost: number, terrain: string, gates: string[]) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, cost, terrain, gates });
  };
  for (const e of adjacency.edges) {
    const gates = e.nodes.filter((n) => n.kind === "gate" || n.kind === "pass").map((n) => n.name);
    push(e.from, e.to, e.cost, e.terrain, gates);
    push(e.to, e.from, e.cost, e.terrain, gates);
    for (const n of e.nodes) {
      if (!n.id) continue;
      const cur = sites.get(n.id);
      if (cur) { cur.on.push([e.from, e.to]); continue; }
      sites.set(n.id, { id: n.id, name: n.name, kind: n.kind,
                        host: n.host ?? e.from, on: [[e.from, e.to]] });
    }
  }
  return { adj, sites };
}

const ownedBy = (s: GameState, f: FactionId) =>
  Object.values(s.commanderies).filter((c) => c.owner === f);

/** 己方任一郡的邻接敌郡（含无主），即可攻击面 */
function frontier(s: GameState, g: Graph, f: FactionId) {
  const out = new Map<CommanderyId, { from: CommanderyId; cost: number; terrain: string; gates: string[] }>();
  /** 同一目标的**第二条路**：不是最省的，但可能出得动更多兵 */
  const alt = new Map<CommanderyId, { from: CommanderyId; cost: number; terrain: string; gates: string[] }>();
  for (const c of ownedBy(s, f)) {
    for (const e of g.adj.get(c.id) ?? []) {
      const t = s.commanderies[e.to];
      if (!t || t.owner === f) continue;
      const cand = { from: c.id, cost: e.cost, terrain: e.terrain, gates: e.gates };
      // 同一目标可能从多郡可达。取代价最低的那条路——并列时按郡 id，
      // 不能靠遍历先后：那是确定的，但不是一个**声明出来的**全序
      const prev = out.get(e.to);
      if (!prev || e.cost < prev.cost || (e.cost === prev.cost && cmp(c.id, prev.from) < 0)) {
        if (prev) keepAlt(alt, e.to, prev, s);
        out.set(e.to, cand);
      } else {
        keepAlt(alt, e.to, cand, s);
      }
    }
  }
  return { best: out, alt };
}

/**
 * 备选路留「出得动兵最多」的那一条，不是第二省的。
 *
 * 行军耗时若只走最省的路，它的代价就是按**席位地理**派发的：实测开局三十家
 * 里十八家一条慢路都没有（曹操、吕布、刘备、公孙瓒都在其中），而南中夷 100%、
 * 刘璋 71%。那是地理罚分，不是决策。
 *
 * 给出第二条路，「从近的弱郡快到，还是从远的强郡慢到」才成为一个真问题——
 * 实测三十家里有十三家至少有一个目标可从两郡进攻。
 */
function keepAlt(
  alt: Map<CommanderyId, { from: CommanderyId; cost: number; terrain: string; gates: string[] }>,
  to: CommanderyId,
  cand: { from: CommanderyId; cost: number; terrain: string; gates: string[] },
  s: GameState,
): void {
  const force = (id: CommanderyId) => s.commanderies[id]?.garrison ?? 0;
  const prev = alt.get(to);
  if (!prev || force(cand.from) > force(prev.from)
      || (force(cand.from) === force(prev.from) && cmp(cand.from, prev.from) < 0)) {
    alt.set(to, cand);
  }
}

const remainingAp = (s: GameState, f: FactionId) => s.factions[f]?.ap ?? 0;

/**
 * 一条命令要几令。**校验、结算、候选表三处共用这一个函数**——
 * 此前它在 actions.ts 与 resolve.ts 各写了一遍三元表达式，
 * 而调任的计费一旦分档，两份副本立刻会算出不同的价钱。
 *
 * 调任分两档：**首次就任免费，调动已在任者要 1 令**。
 * 免费无摩擦的调任会无限空转——实测机器人让同五个人每季来回搬十一季，
 * 黄忠的轨迹是 南阳→长沙→桂阳→江夏→零陵→京兆→南海→京兆→长沙…
 * 把人从 A 调到 B 就让 A 又缺人，下季再调回去。没有代价就必然震荡。
 */
/**
 * 一条令占用哪几个郡的「本季令数」配额。
 *
 * 这条规则曾经在 admit / bot / resolve 三处各抄了一遍，加改阵时只改了 resolve，
 * 于是界面判据放行的令被引擎拒收。凡是三处都要问同一个问题的，只留一份答案
 */
/**
 * 劝降的成功率。
 *
 * 民心高的势力不肯降（每档折减），碾压得越狠越肯降（超出门槛的倍数加成）。
 * 夹在 [0.05, 0.9]：留 5% 是不让「必不成功」，压到 9 成是不让它变成必然，
 * 否则一到门槛就自动过户，劝降就不是决策了
 */
/** 归降的统一门槛：候选、准入与结算使用相同条件。 */
export function submissionTerms(s: GameState, faction: FactionId, target: FactionId,
  g: Graph, P: EngineParams, geo: Geography): { ratio: number; mine: number; theirs: number } | null {
  if (faction === target || !s.factions[target] || s.factions[target].eliminated
      || s.factions[target].retired || s.turn < submitBanUntil(s, target)) return null;
  const own = Object.values(s.commanderies).filter((c) => c.owner === faction);
  const theirs = Object.values(s.commanderies).filter((c) => c.owner === target).length;
  if (!theirs || !own.some((c) => (g.adj.get(c.id) ?? []).some((e) => s.commanderies[e.to]?.owner === target))) return null;
  const zhou = standingOf(s, geo, faction).controlledZhou;
  const hegemony = zhou >= P.submitHegemonyZhou;
  const ratio = hegemony ? P.submitHegemonyRatio : P.submitRatio;
  // **须已克敌城若干座。** 州数只看「地有多大」，而名分收得拢人是因为
  // 你已经打赢了——刘琮献荆州在曹操已下河北之后，不是因为他地大。
  // 这一条不是锦上添花：建安五年剧本里曹操开局即据司隶东部、兖、豫、徐四州，
  // 正好站在州数门槛上而一仗未打，实测第一季劝降刘备刘表孙策、第六季袁绍
  // 举二十四郡来降，六季一统。州数门槛按兴平元年那张破碎的图标定，换一张
  // 已整合的图就失效；克城数是**挣来的**，任何剧本开局都是零，没有这个毛病。
  // 对兴平元年是空转：实测任何人首次控到四州时已克城二十座以上（门槛取 15）
  if ((s.factions[faction]?.conquests ?? 0) < P.submitMinConquests) return null;
  if (zhou < P.submitMinZhou || (!hegemony && theirs > P.submitMaxCommanderies)
      || own.length < theirs * ratio) return null;
  return { ratio, mine: own.length, theirs };
}

export function submitChance(
  P: EngineParams, mine: number, theirs: number, morale: number, threshold = P.submitRatio,
): number {
  const ratio = theirs > 0 ? mine / theirs : P.submitRatio;
  const p = P.submitBase - morale * P.submitPerMorale
    + Math.max(0, ratio - threshold) * P.submitPerRatio;
  return Math.max(0.05, Math.min(0.9, p));
}

/**
 * 该势力拒降后的禁劝期。拒降记在日志里，不另开状态字段——
 * 状态字段要落存档、要进观测，而这条只需从最近两季的日志里读得出来
 */
export function submitBanUntil(s: GameState, target: FactionId): number {
  for (let i = s.log.length - 1; i >= 0 && i > s.log.length - 400; i -= 1) {
    const e = s.log[i];
    if (e.kind === "submit-refuse" && e.text.includes(`::${target}::`)) return e.turn + 2;
  }
  return 0;
}

/** 后方到最近边境的己方道路跳数。用于列出可执行的逐郡调兵路线。 */
export function frontDistances(s: GameState, g: Graph, f: FactionId): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: string[] = [];
  for (const c of Object.values(s.commanderies)) {
    if (c.owner === f && (g.adj.get(c.id) ?? []).some((e) => s.commanderies[e.to]?.owner !== f)) {
      distances.set(c.id, 0); queue.push(c.id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    for (const e of g.adj.get(queue[i]) ?? []) {
      if (s.commanderies[e.to]?.owner !== f || distances.has(e.to)) continue;
      distances.set(e.to, distances.get(queue[i])! + 1); queue.push(e.to);
    }
  }
  return distances;
}

/** 调兵保留至少一半守军，并且不能超过目的地驻军上限。 */
/** 是否能把后方或统兵负担较小处的将领集中到前线；边际比较避免次季原路调回。 */
export function reinforcesFront(s: GameState, g: Graph, f: FactionId,
  from: CommanderyId, to: CommanderyId, sourceCount: number, targetCount: number): boolean {
  const front = (id: CommanderyId) => (g.adj.get(id) ?? []).some((e) => s.commanderies[e.to]?.owner !== f);
  if (!front(to) || sourceCount <= 0) return false;
  if (!front(from)) return true;
  return s.commanderies[to].garrison / (targetCount + 1)
    > s.commanderies[from].garrison / sourceCount;
}

export function transferAmount(s: GameState, from: CommanderyId, to: CommanderyId, P: EngineParams): number {
  return Math.max(0, Math.min(Math.floor((s.commanderies[from]?.garrison ?? 0) * P.musterTake),
    P.garrisonCap - (s.commanderies[to]?.garrison ?? P.garrisonCap)));
}

export function orderSites(a: Action): CommanderyId[] {
  return a.type === "campaign" ? [a.from]
    : a.type === "muster" ? [...a.from]
    : a.type === "transfer" ? [a.from, a.to]
    : a.type === "govern" || a.type === "array" || a.type === "build" ? [a.at]
    : a.type === "relocate" ? [a.to]
    : [];
}

export function orderCost(a: Action, s: GameState, rules: Rules): number {
  if (a.type === "campaign") return rules.campaignAp;
  if (a.type === "scout") return 0;
  if (a.type === "appoint") return s.stations[a.officer] ? rules.normalAp : 0;
  return rules.normalAp;
}

function freeLeft(s: GameState, f: FactionId, type: string, rules: Rules): number {
  const cap = rules.freeUses[type];
  if (cap === undefined) return Infinity;
  return cap - (s.factions[f]?.freeUsed[type] ?? 0);
}

/**
 * 列出该势力本季的全部合法候选。
 * 排序是确定性的：同一状态必得同一候选列表与同一顺序，
 * 否则模型看到的选项会随机漂移，重放也对不上。
 */
/**
 * 他方军团兵力只报档位，不报数。
 * 围城候选此前直接写 `正围此城 4231 人`——同一句里目标守军还标着「未探」，
 * 等于在迷雾中开了一扇天窗：第三方军团的实数比守军还好用（它决定野战胜负）。
 */
const bandLo = (troops: number, P: EngineParams) =>
  Math.round(P.intelTierBase * P.intelTierRatio ** (tierOf(troops, P) - 1));
const bandHi = (troops: number, P: EngineParams) => Math.round(bandLo(troops, P) * P.intelTierRatio);

function troopBand(troops: number, P: EngineParams): string {
  return `约 ${bandLo(troops, P)}–${bandHi(troops, P)} 人`
       + `（第 ${tierOf(troops, P)}/${P.intelTiers} 档）`;
}

/**
 * 一条内政令要多少金。**校验、结算、候选表三处共用这一个函数**——
 * 与 orderCost 同理：价钱一分档，两份副本立刻会算出不同的数。
 */
export function governPrice(
  c: { garrison: number; gear: string; buildings?: readonly Building[] },
  policy: string, P: EngineParams,
): number {
  if (!P.goldOn) return 0;
  if (policy === "levy") {
    return Math.round(c.garrison * (P.levyMultiplier - 1) * P.goldPerLevyTroop);
  }
  if (policy === "wall") return P.goldPerWall * P.wallGain;
  if (policy === "stock") return P.provStockGold;
  if (policy === "forge") {
    const next = P.gearLadder[Math.min(P.gearLadder.indexOf(c.gear) + 1,
                                       P.gearLadder.length - 1)];
    // 铁官治械减半。器械现在逐级打造、一出征就清零，于是治械的钱每次都白花一半；
    // 铁官让本郡成为攻城基地，这是「解锁」不是「加成」
    const cut = c.buildings?.includes("ironworks") ? P.ironworksForgeCut : 1;
    return Math.round((P.goldGear[next] ?? 0) * cut);
  }
  return 0;
}

/** 器械的中文名。兵种名走内容包，器械只有三级且是引擎的内部枚举，就近定义。
    导出给 resolve 的内政回执共用——各存一份迟早写出两套说法 */
export const GEAR_CN: Record<string, string> = { none: "无械", ram: "冲车", mound: "土山" };
/** 据点的中文名。候选标签、结算回执、界面三处共用 */
export const KIND_CN: Record<string, string> = {
  gate: "关隘", pass: "谷道", ford: "渡口", port: "港", depot: "仓", battlefield: "古战场",
};
/** 内政方针的中文名。同上，候选标签与结算回执必须是同一套字 */
export const POLICY_CN: Record<string, string> = {
  farm: "劝农", levy: "募兵", wall: "修城", soothe: "安民", forge: "治械", stock: "屯粮",
};
/** 兵力档的中文名。此前只有界面有一份（PlayClient 的 STRENGTH_CN），
    而这三个字也出现在规则摘要里——两处各存一份，改一处另一处不会报错 */
export const POSTURE_CN: Record<string, string> = {
  skirmish: "偏师", main: "主力", allout: "倾国",
};
const unitName = (P: EngineParams, unit: string) => P.units[unit]?.name ?? unit;

/**
 * 取下 tid 在记分函数上值什么。只读地理与归属，一个守军数字都不碰。
 *
 * 实测分叉频率（20 局、1857 席·季）：65.8% 的「有征伐候选的席·季」里存在
 * 至少一条「取下即升乙档以上」的候选，而其中 62.3%（占全部席·季 40.8%）
 * 里余量最大的那条**不是**升档的那条——每五个席·季有两个，
 * 「最好打的」和「值钱的」不是同一个目标。此前候选表上两者长得一模一样。
 */
function gainOf(
  s: GameState, geo: Geography, f: FactionId, tid: CommanderyId,
): Candidate["gain"] | undefined {
  const z = geo.zhouOf.get(tid);
  if (!z) return undefined;
  const members = geo.zhouMembers.get(z) ?? [];
  let mine = 0;
  for (const id of members) if (s.commanderies[id]?.owner === f) mine += 1;
  const needBefore = Math.floor(members.length / 2) + 1 - mine;
  const owner = s.commanderies[tid]?.owner ?? null;
  const now = s.factions[f]?.bestGrade ?? "ding";
  const after = gradeIfTaken(s, geo, f, tid);
  return {
    zhou: z,
    needBefore,
    needAfter: needBefore - 1,
    isSeat: geo.zhouSeat.get(z) === tid,
    owner,
    isCapital: !!owner && s.factions[owner]?.capital === tid,
    upgrade: after && GRADE_RANK[after.grade] > GRADE_RANK[now] ? after.grade : null,
  };
}

/**
 * gain 的稀疏编码。观测预算只剩 145 tok 余量，能省的都省：
 * 州名总是写（这是缺失的映射，别处拿不到）；「再取 N 即控」只在 N≤2 时写
 * ——N≥3 占 75%，让 brief 去讲；「尚差 N 郡」与势力名一概不写，
 * 稠密版实测把峰值从 5855 顶到 5921。
 */
function gainNote(gn: NonNullable<Candidate["gain"]>): string {
  const near = gn.needBefore > 0 && gn.needBefore <= 2 ? `再取${gn.needBefore}即控` : "";
  return `｜${gn.zhou}${near}${gn.isSeat ? "·州治" : ""}${gn.isCapital ? "·敌治所" : ""}`
       + (gn.upgrade ? `｜取下即升${GRADE_CN[gn.upgrade]}档` : "");
}

/**
 * 起兵郡的待命军团：取**兵力最多**的那支。
 *
 * 三处（候选标签、赴援、结算）必须用同一条口径，否则标签写的兵力与实际
 * 出征的不是一回事——这个文件已经为「候选与结算分家」栽过一次
 *（386 条赴援候选有 18 条算错、倍数 0.45）。
 * `.find()` 取的是 push 序第一支＝最老、被军费磨得最小的那支，是最坏选择
 */
function readyAt(s: GameState, f: FactionId, at: CommanderyId) {
  return s.armies
    .filter((x) => x.faction === f && x.at === at && !x.target)
    .sort((x, y) => y.troops - x.troops || cmp(x.id, y.id))[0];
}

export function listActions(
  s: GameState, f: FactionId, g: Graph, P: EngineParams, rules: Rules = DEFAULT_RULES,
  roster: Roster | null = null,
  /** 势力 id → 显示名。不给则原样写 id——候选标签是给人和模型看的，
      「与 lijue 缔盟」这种写法两边都读不懂 */
  nameOf: (id: FactionId) => string = (id) => id,
  /** 地理。给了才算得出「取下这个郡值什么」——不给则候选只讲攻防，退回旧行为 */
  geo: Geography | null = null,
): Candidate[] {
  const fs_ = s.factions[f];
  if (!fs_ || fs_.eliminated || fs_.retired || s.finished) return [];
  const out: Candidate[] = [];
  const ap = remainingAp(s, f);
  const mine = ownedBy(s, f).sort((a, b) => cmp(a.id, b.id));
  const canOrder = (id: CommanderyId) =>
    ordersLeft(s, id, rules, P);

  // ── 征伐：按「己方兵力 / 目标守军」降序取前 N 个目标 ────────────────
  // 只给打得动的。把明显打不动的目标塞进候选，等于用无效选项浪费模型的注意力。
  if (ap >= rules.campaignAp) {
    // 每个目标最多两条路：最省的，加一条「出得动兵最多」的备选（若不同）。
    // 只走最省的话，行军耗时的代价就是按席位地理派发的——实测开局三十家里
    // 十八家一条慢路都没有，那是罚分不是决策
    const fr = frontier(s, g, f);
    const routes: Array<[CommanderyId, { from: CommanderyId; cost: number; terrain: string; gates: string[] }]> = [];
    for (const [tid, e] of fr.best) {
      routes.push([tid, e]);
      const a = fr.alt.get(tid);
      if (s.endCondition === "unification") {
        // 同样快的路也可能由完全不同的编制出兵，保留实际战力最强的方向。
        const strongest = (g.adj.get(tid) ?? []).filter((edge) => s.commanderies[edge.to]?.owner === f)
          .map((edge) => {
            const src = s.commanderies[edge.to];
            const corps = retinueAt(s, roster, src.id, P);
            const force = Math.min(src.garrison * P.strengthRatio.allout,
              troopCap(corps, P) * (src.buildings.includes("stud") ? P.studTroopMul : 1));
            return { edge, power: force * attackRetinue(corps, P, edge.terrain).attackMul };
          }).sort((x, y) => y.power - x.power || cmp(x.edge.to, y.edge.to))[0];
        if (strongest && strongest.edge.to !== e.from) routes.push([tid,
          { ...strongest.edge, from: strongest.edge.to }]);
      } else if (a && a.from !== e.from
          && marchSeasons(a.cost, false, P) !== marchSeasons(e.cost, false, P)) {
        routes.push([tid, a]);
      }
    }
    const targets = routes
      // 已有己方围城军的目标：起兵郡**必须**改成那支军团的 home，否则列出的
      // 增兵候选会被 validate 以「增兵须自同一郡」拒收——候选逐条合法是
      // tests 里「按界面贪心勾选，引擎不应拒绝任何一条」钉住的不变量
      .map(([tid, e]) => {
        const held = s.armies.find((x) => x.target === tid && x.faction === f);
        if (!held || held.home === e.from) return [tid, e] as const;
        const back = (g.adj.get(held.home) ?? []).find((x) => x.to === tid);
        return [tid, back
          ? { from: held.home, cost: back.cost, terrain: back.terrain, gates: back.gates }
          : e] as const;
      })
      // 改写起兵郡之后要去重：同一目标本可有两条路（最省的与出兵最多的），
      // 而上面那步把两条都改写成了围城军的 home——于是 (起兵郡, 目标) 完全相同，
      // 键也相同。候选键是模型选择的地址（R13），重键意味着枚举里有两个一样的
      // 地址，界面上则是两行逐字相同的候选。实测在「已围一城又有备选路」时触发
      .filter((x, i, all) =>
        all.findIndex((y) => y[0] === x[0] && y[1].from === x[1].from) === i)
      .map(([tid, e]) => {
        const src = s.commanderies[e.from];
        // 用观测值而非真值：候选标签是给对局方看的，写真实守军等于开天眼，
        // 刺探这条动作也就什么都买不到
        const seen = observedGarrison(s, f, tid, P);
        // 这个比值只用来给候选排序（先列打得动的），不进 label——
        // 它与引擎判胜负用的量不是一回事，写进 label 会误导
        // 分子要算上**待命军团**：出征时它整建制上，而这里只看郡守军，
        // 于是一个「守军已被集结抽干、但军团就在城里」的郡被判成打不动。
        // 同一函数下面的 want 早就在用 ready.troops，两处口径必须一致
        const ready = readyAt(s, f, e.from);
        const force = src.garrison + (ready?.troops ?? 0);
        return { tid, e, seen, ratio: seen.value > 0 ? force / seen.value : 99 };
      })
      // 兵力比过低的不列——但**要升档的目标不许滤掉**。
      //
      // 这条过滤本意是「别用无效选项浪费注意力」，可它是单季快照：
      // 引擎里同一目标的增兵会无上限并入既有围城军（resolve 的围城累加），
      // 被围郡每季掉 25% 守军、攻方每季白得 +1 缺口——围三季是包里
      // 明写的「啃得动高城防之郡的办法」。ratio 0.1 的目标未必真打不动。
      //
      // 而它滤掉的恰恰是最值钱的那些：实测一局里简报每季报
      // 「豫州 共 6 郡，我 3，无主 3｜再取 1 郡即控制」，候选表里却没有梁国，
      // 模型于是把令花在反复刺探上（86 条），确认一件它改不了的事。
      // 简报与候选表在对模型说两套话，这不是这套评测想测的维度
      .filter((x) => s.commanderies[x.e.from]?.owner === f && canOrder(x.e.from)
        && (x.ratio > 0.35 || s.armies.some((a) => a.faction === f && a.target === x.tid)
          || (geo ? gainOf(s, geo, f, x.tid)?.upgrade != null : false)))
      .sort((a, b) => {
        const ongoing = (id: string) => s.endCondition === "unification"
          && s.armies.some((army) => army.faction === f && army.target === id) ? 1 : 0;
        return ongoing(b.tid) - ongoing(a.tid) || b.ratio - a.ratio || cmp(a.tid, b.tid);
      })
      .slice(0, rules.perTypeCap);

    for (const { tid, e, seen } of targets) {
      const tgt = s.commanderies[tid];
      // 目标级，两个兵力档共用一份——同一目标的 main/allout 两条标签
      // 本来就有六成字是逐字重复的，不必再算两遍
      const gn = geo ? gainOf(s, geo, f, tid) : undefined;
      // 关在谁手里，直接决定这一仗守方有没有关隘之利——模型必须看得见。
      // 「扼于虎牢关」不说归属，等于把一条已经生效的规则藏起来
      const onEdge = [...g.sites.values()].filter((n) =>
        (n.kind === "gate" || n.kind === "pass" || n.kind === "ford" || n.kind === "port")
        && n.on.some(([x, y]) => (x === e.from && y === tid) || (x === tid && y === e.from)));
      const allMine = onEdge.length > 0 && onEdge.every((n) => s.holds[n.id]?.owner === f);
      const gateNote = e.gates.length
        ? `，扼于${e.gates.join("、")}${allMine ? "（已在我手，守方无关隘之利）" : ""}`
        : "";
      // 随军编制由起兵郡唯一确定（驻地编制），写进 label 让模型看得见「谁去打」、
      // 也看得见「能带多少兵」——出征兵力上限就是随军人数 × 每将统兵
      const corps = roster ? retinueAt(s, roster, e.from, P) : [];
      // 主将由**攻势排位**定，与结算用的是同一个函数。
      // 此前这里取 corps[0]（按 id 排序的第一个），于是标签写着「蔡瑁领」
      // 而实际出战的是文聘——告诉对局方的主将和真打的不是同一个人
      const march = roster ? attackRetinue(corps, P, e.terrain).members : [];
      const lead = march[0] ?? null;
      const ready = readyAt(s, f, e.from);
      const src0 = s.commanderies[e.from];
      // 与 resolve 同口径：马苑使本郡每将统兵 ×1.5。两处分家的话，
      // 标签写的出兵数与真正出的兵就对不上——那正是 combat.ts 抽出来要根除的漂移
      const studMul = src0.buildings.includes("stud") ? P.studTroopMul : 1;
      const cap = roster ? Math.round(studMul * troopCap(corps, P)) : Infinity;
      // 兵种对位与器械的效果已经折进 forecast 的缺口数里，标签只标一次名目。
      // 用散文再复述一遍等于花两份 token 说同一件事
      const unitNote = `｜${unitName(P, src0.unit)}对${unitName(P, tgt.unit)}`
        + (src0.gear === "none" ? "" : `，携${GEAR_CN[src0.gear]}`);
      // 打盟友是合法的，但要标出来：这一击会当场背盟，全境民心 −1、
      // 数季内不得再缔盟。不标的话，模型与玩家都会在毫不知情下付这笔账
      const allyKey = tgt.owner ? [f, tgt.owner].sort() : null;
      const betrayNote = allyKey && s.treaties.some((t) => t.a === allyKey[0] && t.b === allyKey[1]
        && t.from <= s.turn && t.until > s.turn)
        ? `｜⚠此举背盟：全境民心 −${P.betrayMoralePenalty}，${P.betrayBanSeasons} 季不得缔盟` : "";
      const ongoing = s.armies.find((x) => x.target === tid);
      // 自家在围时不再单写「我军已围 N 季」：增兵候选的预告文案本身就以
      // 「续围：…（已围 N 季）」开头，两处说同一个数，而候选表的 token
      // 是按席·季结算的（刘璋末季一度 10186/10000，超的正好是这类重复）
      const siegeNote = !ongoing ? ""
        : ongoing.faction === f ? `（本令为增兵）`
        : `｜${nameOf(ongoing.faction)} 正围此城，${troopBand(ongoing.troops, P)}（本令先野战）`;
      // 城下有第三方围城军时，这一令结算的是**野战**而不是攻城。
      // 此前标签里写着「本令先野战」，而结构化的 forecast 仍是缺口对可防守——
      // 机器人按攻城的判断去打野战，实测 57% 的野战在战力比 <0.8 时发起。
      // 判词与结算必须对得上，光在散文里提一句不算
      const foeSiege = ongoing && ongoing.faction !== f ? ongoing : null;
      // 起兵郡在标签开头已写过，兵力在「出 N 人」里也写过，不再重复
      const armyNote = ready ? "｜整建制调用待命军团" : "";
      // 五维已折进 forecast，这里只报是谁、几人——人数决定兵力上限，
      // 那是玩家/模型唯一能据以判断「该不该先调将过来」的东西
      // 只报主将与人数：人数定兵力上限，主将定五维加成，副将是谁不影响判断。
      // 全名铺开会把候选 token 撑爆——刘表一度顶到 10059/10000
      // 只报随军的那几人：march 已按 retinueCap 截过，报全员会多报出不出征的人
      const named = march.filter((o) => !isFiller(o));
      const leadNote = named.length
        ? `，${named[0].name}${named.length > 1 ? `等 ${named.length} 将` : ""}领`
        : "，仅郡守（无名将）";
      // 兵力档给两个（主力/倾国），器械按是否有关隘决定是否值得带。
      // **但起兵郡有待命军团时只给一条**：那时 want = ready.troops，与档位无关，
      // 两条候选除了「主力/倾国」四个字完全一样，而 posture 全仓从来没被读过。
      // 实测这种重复占主力/倾国成对的 9%，40 季全势力白花 166,089 tok
      const strengths = ready ? (["allout"] as const) : (["main", "allout"] as const);
      for (const strength of strengths) {
        // 出兵后本郡余兵必须写进 label。只写「我方戍兵 6576」而不写
        // 「倾国后城中仅余 1315」，模型看不见自己正在把老巢掏空——
        // 实测投机流曹操因此 10/10 全灭
        // 兵力上限：带多少兵由随军武将数定。这条是「一个城里有多少武将、
        // 就能带多少兵」的落点——没将的郡纵有十万戍兵也只出得动一支偏师
        const want = ready ? ready.troops
          : Math.floor(s.commanderies[e.from].garrison * P.strengthRatio[strength]);
        const send = Math.min(want, cap);
        const left = ready ? s.commanderies[e.from].garrison
          : s.commanderies[e.from].garrison - send;
        // 行军：这一击本季落不落得下。带械行迟，所以两档兵力共用同一个判断，
        // 但器械那一项会改结果——「带械攻城更易，却可能错过本季这一击」正是取舍所在
        // 阵型进得来：鹤翼少走一季、方圆多走一季，与结算同一个函数同一套参数
        const mSeasons = marchSeasons(e.cost, src0.gear !== "none", P, src0.formation);
        const formNote = P.formMarch[src0.formation]
          ? `（${FORMATION_CN[src0.formation]}${P.formMarch[src0.formation] < 0 ? "行疾" : "辎重多"}）`
          : "";
        const marchNote = mSeasons === 0 ? ""
          : `｜道远，行军 ${mSeasons} 季${src0.gear !== "none" ? "（带械行迟）" : ""}${formNote}`;
        // 目标郡的物产：铁官只能建在有铁之郡，别处建不得——所以「该抢哪个郡」
        // 因此有了地理上的答案。这条挂在记分函数那根管子上（赔付是一个郡），
        // 而这个仓库量过：挂在记分函数上的信息 +17.2±5.7，挂在产出档/城防/民心上
        // 的是 −6.4±5.9。物产是常量，不随迷雾变，写出来不算开天眼
        // 共讨：目标之主已被天下共讨，打他是联军的正事。
        // 只绝盟不给理由的话联军等于什么都没做——实测袁绍在 21 郡触发共讨，
        // 之后照样长到 34 郡，因为那八家结了盟却谁也没去打他
        const coalition = tgt.owner && s.factions[tgt.owner]?.coalitionAgainst
          ? "｜**天下共讨之**" : "";
        // 只报**稀缺**的三种。可垦之地占全图 55/105，出现得越普遍信息量越低，
        // 而候选表的 token 是按席·季结算的——把它也写上实测顶破 10000 的闸门
        const scarce = tgt.resources.filter((r) => r !== "tuntian");
        const resNote = scarce.length
          ? `｜有${scarce.map((r) => RESOURCE_CN[r]).join("、")}` : "";
        // 出兵之后这个郡还守不守得住：邻敌最多带得走自己八成戍兵，而破开两档
        // 可防守要兵力比 2.0——故余兵低于「最强邻敌 × 0.4」就是一击可破。
        //
        // 这个数机器人一直在算（bot.ts 的 safeRatio，掏空老巢的候选它根本看不见），
        // 而模型看得见却要自己去查邻郡守军。实测：gpt-5-nano 的 11 次灭亡
        // **全部**落在最弱的两席（袁术 6/8、曹操 5/8），而在最强的袁绍席上
        // 它 +7.0 反超机器人的 +6.2——它不是不会打，是穷的时候会把自己玩死。
        // 所以把这个比较写成一个数摆在标签上，而不是让它自己去比
        const foe = Math.max(0, ...(g.adj.get(e.from) ?? [])
          .map((x) => s.commanderies[x.to])
          .filter((x) => x?.owner && x.owner !== f)
          .map((x) => observedGarrison(s, f, x.id, P).value));
        const bare = foe > 0 && left < foe * (Math.max(...Object.values(P.strengthRatio))
          / (P.breachLadder.find(([, n]) => n === 3)?.[0] ?? 2));
        const bareNote = bare && rules.bareNote !== false ? `｜**倾巢**：余 ${left} 人，邻敌最强 ${Math.round(foe)}` : "";
        const capNote = send < want
          ? `（${named.length || 1} 将统兵上限 ${cap}，余 ${want - send} 人带不走）` : "";
        const ffc = foeSiege ? forecastField(s, f, e.from, foeSiege, send, g, P, roster) : null;
        // 三条岔路，判词必须与本令实际结算的那一套对上：
        //   城下有别家围城军 → 结算野战 → forecastField
        //   城下有自家围城军 → 结算增兵续围 → forecastReinforce（并入后这场围会怎样）
        //   城下无人           → 结算新起围城 → forecastCampaign
        // 中间那条此前是**空的**：forecastCampaign 里「城下有兵」那行不分敌我，
        // 自家围城军也把预告打成 null，而 bot 对无 forecast 的征伐直接 −1e9。
        // 实测 136 条增兵候选、0 条带预告、0 条被采纳——标签写着「本令为增兵」
        // 承诺了一个决策，打分层却保证它永不被选中
        const mySiege = ongoing && ongoing.faction === f ? ongoing : null;
        const fc = mySiege
          ? forecastReinforce(s, f, tid, send, g, P, roster)
          : forecastCampaign(s, f, {
              type: "campaign", target: tid, from: e.from, commander: lead?.id ?? null,
              strength, siegeGear: src0.gear,
            }, g, P, roster, send);
        const projected = projectCampaign(s, f, {
          type: "campaign", from: e.from, target: tid, strength,
          commander: lead?.id ?? null, siegeGear: src0.gear,
        }, send, g, P, roster);
        out.push({
          key: `campaign:${e.from}>${tid}:${strength}`,
          action: { type: "campaign", target: tid, from: e.from, commander: lead?.id ?? null,
                    strength, siegeGear: src0.gear },
          cost: rules.campaignAp,
          forecast: fc ?? undefined,
          mobilization: { troops: send, left },
          project: projected ? { seasons: projected.seasons, reinforcement: projected.reinforcement } : undefined,
          field: ffc ? { ratioLo: ffc.ratioLo, ratioHi: ffc.ratioHi,
                         verdict: ffc.verdict, text: ffc.text } : undefined,
          gain: gn,
          siegeBy: ongoing && ongoing.faction !== f
            ? { faction: ongoing.faction, seasons: ongoing.siegeSeasons,
                troopsLo: bandLo(ongoing.troops, P), troopsHi: bandHi(ongoing.troops, P) }
            : undefined,
          // 不写「兵力比」：那个数与引擎判胜负用的数没有关系——
          // 实测「比 4.35」的仗打不下来，「比 2.26」的能破城。
          // 写缺口对可防守，那才是引擎真正比的两个量
          label: `自${e.from}征${tid}（${strength === "main" ? "主力" : "倾国"}）`
               + `：出 ${send} 人${capNote}，本郡余 ${left}；敌守军 ${seen.text}`
               + `；${P.terrainName[e.terrain] ?? e.terrain}${gateNote}${leadNote}`
               + `${ffc ? `｜先野战：${ffc.text}` : fc ? `｜${fc.text}` : ""}`
               + `${bareNote}${coalition}${marchNote}${resNote}${unitNote}${armyNote}${siegeNote}`
               + `${projected && projected.seasons !== null && projected.seasons > 0 ? `｜守方不变${projected.reinforcement ? `且次轮增兵${projected.reinforcement}人` : ""}时再围${projected.seasons}季可破（不计行军/欠饷）` : ""}`
               + `${gn ? gainNote(gn) : ""}${betrayNote}`,
        });
      }
    }
  }

  // ── 救援：己方郡被围时，从邻郡发兵解围 ──────────────────────────────
  // 这条不给出，围城就是单向的：敌人围我城，我只能干看着。
  if (ap >= rules.campaignAp) {
    const besieged = s.armies.filter((x) => x.target && s.commanderies[x.target]?.owner === f
                                            && x.faction !== f);
    for (const foe of besieged.sort((a, b) => cmp(a.target!, b.target!))) {
      // 出击（背城一战）必须给：只有一个郡的势力无邻郡可派援，
      // 若连出城迎战都不许，被围即等于必亡——曹操 194 年正是在濮阳突火而出的
      const sortie = s.commanderies[foe.target!];
      const routes = [
        ...(canOrder(sortie.id) ? [sortie] : []),
        ...mine
          .filter((c) => canOrder(c.id) && (g.adj.get(c.id) ?? []).some((e) => e.to === foe.target))
          .sort((a, b) => b.garrison - a.garrison)
          .slice(0, 2),
      ];
      for (const src of routes) {
        const isSortie = src.id === foe.target;
        const corps = roster ? retinueAt(s, roster, src.id, P) : [];
        // 赴援打的是野战，主将同样按攻势排位定。出城迎战没有边，地形按平原算
        const rTerrain = isSortie ? "plain"
          : (g.adj.get(src.id) ?? []).find((e2) => e2.to === foe.target)?.terrain ?? "plain";
        const march = roster ? attackRetinue(corps, P, rTerrain).members : [];
        const lead = march[0] ?? null;
        const named = march.filter((o) => !isFiller(o));
        // 取兵必须与结算同一套：resolve 在起兵郡有**待命军团**时整建制派它，
        // 而不是按守军抽调。此前这里只算守军，于是标签与预告都算错了——
        // 实测 386 条赴援候选里 18 条落在这个分叉上，且有高报的
        //（标签写「可出 2425 人」，引擎实际只派 1084，倍数 0.45）。
        // 高报是更危险的方向：模型读到「可解围」下令，派出去的不到一半，
        // 判词与结果直接反号
        const rReady = readyAt(s, f, src.id);
        // 与 resolve 同口径：马苑使本郡每将统兵 ×1.5
        const studMul = src.buildings.includes("stud") ? P.studTroopMul : 1;
        const cap = roster ? Math.round(studMul * troopCap(corps, P)) : Infinity;
        const send = Math.min(rReady ? rReady.troops
                                     : Math.floor(src.garrison * P.strengthRatio.allout), cap);
        const ff = forecastField(s, f, src.id, foe, send, g, P, roster);
        out.push({
          key: `relief:${src.id}>${foe.target}`,
          action: { type: "campaign", target: foe.target!, from: src.id,
                    commander: lead?.id ?? null, strength: "allout", siegeGear: "none" },
          cost: rules.campaignAp,
          siegeBy: { faction: foe.faction, seasons: foe.siegeSeasons,
                     troopsLo: bandLo(foe.troops, P), troopsHi: bandHi(foe.troops, P) },
          field: ff ? { ratioLo: ff.ratioLo, ratioHi: ff.ratioHi,
                        verdict: ff.verdict, text: ff.text } : undefined,
          label: `${isSortie ? `${src.id}出城迎战` : `自${src.id}赴援${foe.target}`}`
               + `（${nameOf(foe.faction)} 围城第 ${foe.siegeSeasons} 季，围军 ${troopBand(foe.troops, P)}）：`
               + `我方可出 ${send} 人${rReady ? `（整建制调用待命军团）` : ""}`
               + `${named.length ? `，${named[0].name}${named.length > 1 ? `等 ${named.length} 将` : ""}领` : "，仅郡守"}`
               + `${ff ? `｜${ff.text}` : ""}`
               + `${isSortie ? "；败则城中兵力大损" : ""}`,
        });
      }
    }
  }

  // ── 撤围：围而不下时主动收兵，保住残部 ──────────────────────────────
  if (ap >= rules.normalAp) {
    for (const army of s.armies.filter((x) => x.faction === f && x.target)
      .sort((a, b) => cmp(a.id, b.id)).slice(0, 4)) {
      // 撤围是整份候选表里唯一「既无 forecast 又无 gain」的进攻类候选，
      // 于是它是关于**经过了多久**的令，而不是关于这场围城的令。补齐三样：
      //   forecast 本季这一击会怎样　project 还要几季破得了　gain 这座城值什么
      const wpj = projectSiege(s, f, army, g, P, roster);
      const wgn = geo && army.target ? gainOf(s, geo, f, army.target) : undefined;
      out.push({
        key: `withdraw:${army.id}`,
        action: { type: "withdraw", army: army.id },
        cost: rules.normalAp,
        // 不带 forecast：本季那一击的预告在同一份观测的 armies[].siege 里，
        // 每支围城军都有一份，逐条重复要在每个席·季上再付一次钱。
        // 撤围这条令关心的是**跨季**的那个数，那是 project
        // 只留 seasons：散文在 label 里已经有一份，结构化字段再存一遍
        // 等于把同一句话在观测 JSON 里写两次
        project: wpj ? { seasons: wpj.seasons } : undefined,
        gain: wgn,
        label: `自${army.target}撤围（已围 ${army.siegeSeasons} 季，余 ${army.troops} 人，`
             + `撤回可保 ${Math.round(army.troops * P.siegeWithdrawKeep)}）`
             // 只写前瞻，不重复 gainNote：同一目标的增兵候选标签上已经写过「这座城值什么」，
             // 而候选表的 token 是按席·季结算的——实测把两样都写上会顶破 10000 的闸门
             // （3/309 席·季超出，最大 10252）。gain 仍以结构化字段交给打分函数
             + `${wpj ? `｜不撤：${wpj.text}` : ""}`,
      });
    }
  }

  // ── 集结：只在有相邻己方郡可抽调时给出 ──────────────────────────────
  //
  // 只从**相邻**己方郡抽、至多 3 个、每郡一半——这几个数试过放开，都不成立。
  // 长局实测：帝国十九万兵在一个点上只压得出中位 2894 人，而一郡残余把全部
  // 家当堆在一处（守军上限 60000），所以堡垒啃不动、天下收不拢。看着像是
  // 「集中不了兵力」，于是把抽调范围放到 2–4 跳、郡数放到 12：
  //   邻郡 3 个（现状）  最大 25.8 郡
  //   2 跳 × 5 郡        最大 25.3 郡
  //   3 跳 × 8 郡        最大 18.5 郡  ← 更差
  //   4 跳 × 12 郡       最大 20.0 郡
  // 越放开越差：把后方的守军抽空，那些郡自己就丢了。而且同一改动把 16 季的
  // 开局↔得分 ρ 从 0.66 推到 0.77（滚雪球加剧，评测区分度下降）。
  // 结论是这条路走不通，维持原状
  if (ap >= rules.normalAp) {
    const cands = mine
      .map((c) => {
        // 集结地本身也应出兵。只从邻郡抽调时，集结往往还不如就地倾国而出，
        // 这条动作就失去了存在理由
        const sources = [
          ...(canOrder(c.id) ? [c.id] : []),
          ...(g.adj.get(c.id) ?? [])
            .filter((e) => s.commanderies[e.to]?.owner === f && canOrder(e.to))
            .map((e) => e.to),
        ];
        return { at: c.id, sources };
      })
      .filter((x) => x.sources.length >= 2 && canOrder(x.at))
      // 排序按「己方邻郡最多」。试过改成**前线优先**——理由看着很硬：
      // 己方邻郡最多的地方按定义是腹地，而仗在边境打；实测机器人集结 387 次、
      // 均 3396 人，征伐里只有 2.9% 动用了待命军团，军团空等 2891 个席位季。
      // 改完使用率升到 5.1%，但前线郡的己方邻居少、集结规模掉到 2485 人，
      // 空等反而涨到 5103 季；更要命的是**三个画像的均分一起涨、非苟活极差
      // 从 38.0 塌到 4.7**——策略选择几乎不再影响结果。
      //
      // 这是第二次栽在同一件事上（第一次是机器人的外交判据）：
      // **改在候选生成层的东西对所有画像一视同仁，只会抹平差异、不会制造差异**，
      // 而差异正是评测要测的。机器人要变强，得改在**各画像不同**的权重上
      .sort((a, b) => b.sources.length - a.sources.length || cmp(a.at, b.at))
      .slice(0, Math.min(6, rules.perTypeCap));
    for (const { at, sources } of cands) {
      const take = sources.slice(0, 3);
      const total = take.reduce((n, id) => n + Math.floor(s.commanderies[id].garrison * 0.5), 0);
      out.push({
        key: `muster:${at}:${take.join("+")}`,
        action: { type: "muster", at, from: take, commander: null, deadline: 1 },
        cost: rules.normalAp,
        label: `于${at}集结，自${take.join("、")}抽调约 ${total} 人`,
      });
    }
  }

  // ── 调兵：由后方沿己方道路逐郡支援边境，围城不能绕过粮道限制 ─────
  if (ap >= rules.normalAp) {
    const distance = frontDistances(s, g, f);
    const routes = mine.flatMap((src) => (g.adj.get(src.id) ?? []).flatMap((e) => {
      if (s.commanderies[e.to]?.owner !== f || !canOrder(src.id) || !canOrder(e.to)
          || besiegedNow(s, src.id, f) || besiegedNow(s, e.to, f)) return [];
      const fromDistance = distance.get(src.id) ?? Infinity, toDistance = distance.get(e.to) ?? Infinity;
      if (fromDistance <= toDistance) return [];
      const troops = transferAmount(s, src.id, e.to, P);
      return troops >= P.siegeMinTroops ? [{ from: src.id, to: e.to, troops, toDistance }] : [];
    })).sort((a, b) => a.toDistance - b.toDistance || b.troops - a.troops || cmp(a.from, b.from) || cmp(a.to, b.to))
      .slice(0, Math.min(6, rules.perTypeCap));
    for (const r of routes) out.push({ key: `transfer:${r.from}>${r.to}`,
      action: { type: "transfer", from: r.from, to: r.to }, cost: rules.normalAp,
      label: `自${r.from}调兵${r.troops}人至${r.to}（保留至少半数守军，${r.toDistance === 0 ? "支援边境" : "向边境转运"}）` });
  }

  // ── 治：每郡只给最该做的那一项，不把四个方针全铺开 ──────────────────
  if (ap >= rules.normalAp) {
    const picks = mine.filter((c) => canOrder(c.id)).map((c) => {
      // 民心低先安民，守军薄先募兵，城防低且临敌先修城，否则劝农
      const isFront = (g.adj.get(c.id) ?? []).some((e) => s.commanderies[e.to]?.owner !== f);
      // 优先级从高到低。**逐项回退**：最该做的那一项若已至上限或付不起，
      // 就退到下一项，而不是把整个郡的内政候选删掉。
      //
      // 此前是「算出一个 policy，不合适就返回 null」。加上金之后这条直接
      // 要了小势力的命：曹操只有一个郡，若临敌优先治械（900 金）而国库不够，
      // 他这一季就一条内政候选都没有——实测出局率因此从 42% 升到 53%，
      // 而他死时国库还有上千金。删掉的不是钱，是选项
      // 正被围时屯粮排第一：那一刻它是唯一能推迟开城的令，而守方每郡每季只有 2 条。
      // 攻方选强攻还是围困，守方就得押哪一头——押错则另一头破城
      const underSiege = besiegedNow(s, c.id, f);
      // 上限要用 provCapOf 而不是 provisionsCap：后者只按产出档算，
      // 不含仓廪的 +2 与方圆的 +1，而结算那边用的是含的那个。
      // 差的后果是**有仓廪的城永远填不满最后那两档**——候选以为满了就不再列屯粮，
      // 而围城那只钟正是按存粮走的
      const provCap = provCapOf(c, P);
      // 被围时募兵与劝农都不合法（见 validate 的 govern 分支），候选也不能列，
      // 否则「按界面贪心勾选，引擎不应拒绝任何一条」当场破
      const wants: Array<[string, boolean, string]> = [
        ["stock", underSiege && c.provisions < provCap, `被围，存粮仅 ${c.provisions} 季`],
        ["soothe", c.moraleTier <= 2 && c.moraleTier < P.moraleMax, "民心告急"],
        ["wall", isFront && c.defense < 55, "临敌且城防薄"],
        ["levy", !underSiege && isFront && c.garrison < 4000, "临敌且兵少"],
        ["forge", isFront && c.gear !== P.gearLadder[P.gearLadder.length - 1],
         `器械仅「${GEAR_CN[c.gear]}」`],
        ["stock", isFront && c.provisions < provCap, `临敌，存粮 ${c.provisions}/${provCap} 季`],
        ["farm", !underSiege && c.yieldTier < P.yieldMax, "产出可增"],
        ["soothe", c.moraleTier < P.moraleMax, "民心可安"],
        ["wall", c.defense < P.defenseMax, "城防可修"],
      ];
      for (const [policy, want, why] of wants) {
        if (!want) continue;
        const price = governPrice(c, policy, P);
        if (price > (fs_.gold ?? 0)) continue;      // 付不起就看下一项
        return { c, policy, why, price };
      }
      return null;
    }).filter((x) => !!x)
      .sort((a, b) => cmp(a.c.id, b.c.id)).slice(0, rules.perTypeCap);
    for (const { c, policy, why, price } of picks) {
      out.push({
        key: `govern:${c.id}:${policy}`,
        action: { type: "govern", at: c.id, policy: policy as never },
        cost: rules.normalAp,
        // 产/心/防/兵种/械**不重复写**：这五项 observe 的 mine[] 里逐郡都有，
        // 而内政候选一季能有十条，等于把同一份郡情抄十遍。
        // why 留着——它是引擎的优先级判断（「临敌且城防薄」），别处推不出来
        label: `${c.id} 行${POLICY_CN[policy]}${price > 0 ? `（${price} 金）` : ""}（${why}）`,
      });
    }
  }

  // ── 取据点：路上的关渡港仓 ──────────────────────────────────────────
  //
  // 只列**邻边上、且不归自己**的。据点不计入郡数，取它图的是那条路：
  // 关渡到手，从这条路打过去守方就没有关隘之利了；仓到手，邻郡多一份粮。
  if (ap >= rules.normalAp) {
    const seen = new Set<string>();
    const cands: Array<{ site: NonNullable<ReturnType<typeof g.sites.get>>; from: CommanderyId }> = [];
    for (const c of mine) {
      if (!canOrder(c.id)) continue;
      for (const site of g.sites.values()) {
        if (seen.has(site.id)) continue;
        if (!site.on.some(([a, b]) => a === c.id || b === c.id)) continue;
        if (s.holds[site.id]?.owner === f) continue;
        seen.add(site.id);
        cands.push({ site, from: c.id });
      }
    }
    for (const { site, from } of cands.sort((a, b) => cmp(a.site.id, b.site.id))
      .slice(0, rules.perTypeCap)) {
      const h = s.holds[site.id];
      const send = Math.floor(s.commanderies[from].garrison * P.strengthRatio.main);
      const need = Math.ceil((h?.garrison ?? P.holdGarrison) * P.holdSeizeRatio);
      // **只列取得下的。**取据点的胜负是确定的（出兵 ≥ 需兵即克），
      // 列出必败的一条就是纯噪声——实测机器人一局刷了 355 次必败的攻，
      // 而取下的只有 82 次。这与 R13「引擎预筛出你实际打得动的」是同一条：
      // 征伐要列打不下的，是因为守军未探、结果本来就不确定；这里没有未知
      if (send < need) continue;
      // 那几条路一起变——一个渡口常服务多条路线，标签要说清取它值在哪
      const roads = site.on.filter(([a, b]) => a === from || b === from)
        .map(([a, b]) => (a === from ? b : a));
      out.push({
        key: `seize:${site.id}:${from}`,
        action: { type: "seize", node: site.id, from },
        cost: rules.normalAp,
        label: `自${from} 取${site.name}（${KIND_CN[site.kind] ?? site.kind}）`
          + `　出 ${send} 人，守军 ${h?.garrison ?? P.holdGarrison}，需 ${need} 人`
          + `${h?.owner ? `　现属 ${nameOf(h.owner)}` : "　无主"}`
          + (roads.length ? `　扼 ${roads.join("、")} 之路` : ""),
      });
    }
  }

  // ── 兴建：**按建筑种类去重**，每种只列它最好的一处 ─────────────────
  //
  // 不按郡列。按郡列的话十二个郡会吐出十二条候选而其中十条是同一座屯田——
  // 同一件事列十二遍，却要占掉候选总额（totalCap 60）里的十二格。
  // 实测那样直接把征伐从二十多条挤到十二条：兴建是长线的，征伐才是决胜的，
  // 挤掉后者换前者是坏交易。
  //
  // 按种类去重之后，候选是「在中山国建铁官／在乐安国建屯田／在邺建官府」——
  // 三条**互不相同**的选择，常在三到五条之间。
  if (ap >= rules.normalAp) {
    const mine = ownedBy(s, f).filter((c) => canOrder(c.id) && c.buildings.length < P.buildCap);
    const front = (id: CommanderyId) => (g.adj.get(id) ?? [])
      .some((e) => s.commanderies[e.to]?.owner && s.commanderies[e.to].owner !== f);
    /** 每种建筑挑一处最合适的郡。挑法各不相同，理由写进 why */
    const site = (kind: Building): { c: typeof mine[number]; why: string } | null => {
      const need = BUILD_NEEDS[kind];
      const ok = mine.filter((c) => !c.buildings.includes(kind)
        && (!need || c.resources.includes(need)));
      if (!ok.length) return null;
      // 特殊建筑：别处建不得，挑产出档最高的一处（同样一座，富郡回本快）
      if (need) {
        const c = [...ok].sort((x, y) => y.yieldTier - x.yieldTier || cmp(x.id, y.id))[0];
        return { c, why: kind === "farmstead"
          ? "地可垦，并惠及相邻己方郡" : `此地有${RESOURCE_CN[need]}，别处建不得` };
      }
      // 通用建筑：仓廪与校场看前线，官府与市看产出
      if (kind === "granary" || kind === "drill") {
        const f0 = ok.filter((c) => front(c.id));
        const c = (f0.length ? f0 : ok).sort((x, y) => y.yieldTier - x.yieldTier || cmp(x.id, y.id))[0];
        return { c, why: f0.length ? "临敌之郡" : "" };
      }
      const c = [...ok].sort((x, y) => y.yieldTier - x.yieldTier || cmp(x.id, y.id))[0];
      return { c, why: kind === "office" ? "该郡每季可下的令 +1" : "产出可观，市利更厚" };
    };
    const KINDS: Building[] = ["ironworks", "stud", "saltern", "farmstead",
                               "office", "granary", "market", "drill"];
    const picks = KINDS.map((kind) => {
      const hit = site(kind);
      if (!hit) return null;
      const price = P.goldOn ? P.buildGold[kind] : 0;
      if (price > (fs_.gold ?? 0)) return null;      // 付不起就不列
      return { kind, ...hit, price };
    // 只留 4 条。候选总额 totalCap 是 60 且**已经打满**——兴建不是往上加，
    // 是跟征伐、内政抢那 60 格。放 7 条实测把征伐从二十多条挤到 16 条，
    // 袁绍十三个郡里有几个就再也没有出兵的选项了。兴建是长线的、这季不建下季还能建；
    // 征伐是决胜的、错过的窗口不再来。KINDS 已按「特殊在前」排好，
    // 所以砍掉的总是那几种哪个郡都能建的
    }).filter((x) => !!x).slice(0, Math.min(4, rules.perTypeCap));
    for (const { c, kind, why, price } of picks) {
      out.push({
        key: `build:${c.id}:${kind}`,
        action: { type: "build", at: c.id, kind },
        cost: rules.normalAp,
        label: `${c.id} 兴建${BUILD_CN[kind]}${price > 0 ? `（${price} 金）` : ""}`
             + `${why ? `（${why}）` : ""}`,
      });
    }
  }

  // ── 授官：以朝廷之名授某家一州之牧 ────────────────────────────────
  //
  // 兴平元年献帝在长安，李傕挟之——司隶校尉随朝廷驻长安，故以京兆尹之主为
  // 持朝廷者（出处见 province-seats-194.json 的 _note）。
  //
  // 这是《宏图策：三国》有而我们没有的那一类里唯一挂在**记分函数**上的：
  // 档位判控州与郡数的增量，而州牧之号直接改变一个州里的郡怎么归属。
  // 其余那些（科技树、贸易、财政、制度政策）都是往战力上乘系数，
  // 而这个仓库量过挂在那根管子上的四次实验全部打平。
  //
  // 候选按**这个号真能收几郡**排，不按州里空了几郡：归附意向只在
  // 「无主郡的邻郡属于持号者」时才累积，所以授交州牧给一个不挨着交州的人，
  // 名分再好听也是一纸空文。第一版正是这么列的——李傕拿到的四条全是交州
  if (geo && ap >= rules.normalAp && s.commanderies[P.courtSeat]?.owner === f) {
    const holderOf = (z: string) =>
      Object.values(s.factions).find((x) => x.governorships.includes(z))?.id ?? null;
    // (州, 势力) → 该势力凭这个号能收的无主郡数
    const yield_ = new Map<string, number>();
    for (const c of Object.values(s.commanderies)) {
      if (c.owner) continue;
      const z = geo.zhouOf.get(c.id);
      if (!z) continue;
      const lords = new Set((g.adj.get(c.id) ?? [])
        .map((e) => s.commanderies[e.to]?.owner).filter((x): x is FactionId => !!x));
      for (const l of lords) {
        const k = `${z}\u0000${l}`;
        yield_.set(k, (yield_.get(k) ?? 0) + 1);
      }
    }
    const rows = [...yield_.entries()]
      .map(([k, n]) => { const [z, to] = k.split("\u0000"); return { z, to: to as FactionId, n }; })
      .filter((r) => holderOf(r.z) !== r.to)
      // 自授优先：把名分送人是要读局势的一步，让它排在后面但仍留在表上
      .sort((a, b) => (b.to === f ? 1 : 0) - (a.to === f ? 1 : 0)
                   || b.n - a.n || cmp(a.z, b.z) || cmp(a.to, b.to))
      .slice(0, 4);   // 与兴建同理：跟征伐抢那 60 格
    for (const { z, to, n } of rows) {
      const who = holderOf(z);
      out.push({
        key: `invest:${z}:${to}`,
        action: { type: "invest", zhou: z, to },
        cost: rules.normalAp,
        sway: { commanderies: n },
        label: `以朝廷之名授${to === f ? "己" : nameOf(to)}为${z}牧`
             + `（凭此号可传檄收 ${n} 郡${who ? `；今牧为 ${nameOf(who)}，改授即撤` : ""}）`,
      });
    }
  }

  // ── 迁治：只在**治所已失或断供**时列出 ──────────────────────────
  //
  // 治所没事的时候迁治几乎总是坏主意（当季与下季全境断供），列出来只是噪声；
  // 而治所一失，它是唯一的活路——此前引擎里根本没有这条路，
  // 实测 11~15% 的势力·季卡在「零产出 + 军团季季溃散」里出不来，张鲁待了 39 季。
  // 候选按「与其余郡连得最广」排：迁过去之后接得回来的郡最多
  if (ap >= rules.campaignAp) {
    const cap = fs_.capital;
    const capLost = !cap || s.commanderies[cap]?.owner !== f;
    // 只判失守。「治所还在但断供」不成立——补给是从治所出发算的连通分量，
    // 治所自己按定义永远在里面
    if (capLost && mine.length) {
      const reach = (id: CommanderyId) => {
        const seen = new Set([id]); const q = [id];
        for (let i = 0; i < q.length; i += 1)
          for (const e of g.adj.get(q[i]) ?? [])
            if (!seen.has(e.to) && s.commanderies[e.to]?.owner === f) { seen.add(e.to); q.push(e.to); }
        return seen.size;
      };
      for (const c of mine.filter((x) => canOrder(x.id) && x.id !== cap)
        .map((x) => ({ c: x, n: reach(x.id) }))
        .sort((a, b) => b.n - a.n || cmp(a.c.id, b.c.id))
        .slice(0, Math.min(4, rules.perTypeCap))) {
        out.push({
          key: `relocate:${c.c.id}`,
          action: { type: "relocate", to: c.c.id },
          cost: rules.campaignAp,
          label: `迁治于${c.c.id}（下季生效；迁后可连回 ${c.n} 郡`
               + `｜产${c.c.yieldTier} 防${c.c.defense}）`
               + "｜**治所已失，全境政令不通**",
        });
      }
    }
  }

  // ── 探：免费但有次数上限，只给尚未探明的邻接敌郡 ────────────────────
  if (freeLeft(s, f, "scout", rules) > 0) {
    const known = s.intel[f] ?? {};
    const unknown = [...frontier(s, g, f).best.keys()]
      .filter((id) => (known[id] ?? -1) < s.turn)
      .sort()
      .slice(0, Math.min(6, rules.perTypeCap));
    for (const id of unknown) {
      out.push({
        key: `scout:${id}`,
        action: { type: "scout", at: id },
        cost: 0,
        label: `刺探${id}（现 ${observedGarrison(s, f, id, P).text}，`
             + `本季余 ${freeLeft(s, f, "scout", rules)} 次）`,
      });
    }
  }

  // ── 劝降势力：初期收小势力，霸业形成后可作区域归降 ──────────────
  if (ap >= rules.normalAp && geo) {
    for (const id of Object.keys(s.factions).sort(cmp)) {
      const terms = submissionTerms(s, f, id, g, P, geo);
      if (!terms) continue;
      const theirs = Object.values(s.commanderies).filter((c) => c.owner === id);
      const morale = theirs.reduce((sum, c) => sum + c.moraleTier, 0) / theirs.length;
      const pct = Math.round(submitChance(P, terms.mine, terms.theirs, morale, terms.ratio) * 100);
      out.push({ key: `submit:${id}`, action: { type: "submit", to: id }, cost: rules.normalAp,
        label: `劝降${nameOf(id)}（其 ${terms.theirs} 郡，我 ${terms.mine} 郡；`
          + `其民心均 ${morale.toFixed(1)} 档｜成功 ${pct}%，成则疆土武将尽归我；不成则两季内不再受劝）` });
    }
  }

  // ── 借道：与盟友互开边境，只在**真能接回断供之郡**时列出 ────────────
  //
  // 规则摘要里三处许了借道，引擎的校验也一直通着，唯独这里从不生成候选——
  // 实跑 48 季 s.passages 恒为空，模型与玩家都点不到。一条永远没人下的令，
  // 等于摘要在骗人；而它恰好是「看得见断供却无法可施」的那把钥匙。
  //
  // 只在有实效时给：算一遍「互开之后补给能不能接回来」，接不回就不占候选位。
  // 候选表是稀缺资源（totalCap 60），一条没用的令挤掉的是一条有用的
  if (ap >= rules.normalAp && fs_.capital && s.commanderies[fs_.capital]?.owner === f) {
    // 现在断供的己方郡。只走己方territory 的连通分量，与 resolve 的 supplyReach 同一套
    const cutNow = new Set<CommanderyId>();
    {
      const ok = new Set([fs_.capital]);
      const st = [fs_.capital];
      while (st.length) {
        const u = st.pop()!;
        for (const e of g.adj.get(u) ?? []) {
          if (ok.has(e.to) || s.commanderies[e.to]?.owner !== f) continue;
          ok.add(e.to); st.push(e.to);
        }
      }
      for (const c of mine) if (!ok.has(c.id)) cutNow.add(c.id);
    }
    const allies = s.treaties
      .filter((t) => t.from <= s.turn && t.until > s.turn && (t.a === f || t.b === f))
      .map((t) => (t.a === f ? t.b : t.a))
      .filter((id) => !s.passages.some((p) => p.grantee === f && p.grantor === id));
    for (const ally of [...new Set(allies)].sort().slice(0, rules.perTypeCap)) {
      // 互开之后可通行的集合：己方 + 盟友沿共同边界的郡
      const allyBorder = new Set(Object.values(s.commanderies)
        .filter((c) => c.owner === ally
          && (g.adj.get(c.id) ?? []).some((e) => s.commanderies[e.to]?.owner === f))
        .map((c) => c.id));
      if (!allyBorder.size) continue;
      const reach = new Set([fs_.capital]);
      const stack = [fs_.capital];
      while (stack.length) {
        const u = stack.pop()!;
        for (const e of g.adj.get(u) ?? []) {
          if (reach.has(e.to)) continue;
          const c2 = s.commanderies[e.to];
          if (!c2 || (c2.owner !== f && !allyBorder.has(e.to))) continue;
          reach.add(e.to); stack.push(e.to);
        }
      }
      const rescued = mine.filter((c) => cutNow.has(c.id) && reach.has(c.id));
      if (!rescued.length) continue;
      out.push({
        key: `passage:${ally}`,
        action: { type: "passage", to: ally },
        cost: rules.normalAp,
        label: `与${nameOf(ally)}互开边境（双方沿共同边界开放补给线；`
             + `接回我方断供之郡 ${rescued.length} 个：${rescued.map((c) => c.id).join("、")}）`,
      });
    }
  }

  // ── 招降：破城后两季内可招被俘之将 ────────────────────────────────
  //
  // 不设时限则俘虏名单只增不减，候选逐季膨胀（违背 R13）；
  // 两季的窗口也让「先招人还是先修城」成为真取舍。
  // 名将基本招不来（均值 90 约 5%），所以这不是「打赢就白捡一个关羽」
  if (ap >= rules.normalAp && roster) {
    const mine_ = new Set(mine.map((c) => c.id));
    const pool = s.captives
      .filter((x) => x.by === f)
      .map((x) => ({ x, o: roster.byId.get(x.officer) }))
      .filter((e) => !!e.o)
      .sort((a, b) => statSum(b.o!) - statSum(a.o!) || cmp(a.x.officer, b.x.officer))
      .slice(0, rules.perTypeCap);
    for (const { x, o } of pool) {
      const home = o!.home && mine_.has(o!.home);
      const pct = Math.round(suadeChance(o!, P, !!home) * 100);
      // 剔除发生在结算末尾（且在 turn 自增之前），判据是 turn + 1 − since <= 窗口。
      // 所以最后一个能下令的季是 since + 窗口 —— 提示只在那一季给，
      // 早一季给等于在撒谎，而这句提示正是要让人分清「还能等」和「不能等」
      const last = s.turn - x.since >= P.suadeWindow;
      out.push({
        key: `suade:${x.officer}`,
        action: { type: "suade", officer: x.officer },
        cost: rules.normalAp,
        label: `招降 ${o!.name}（于${x.at}｜统${o!.leadership} 武${o!.might} 智${o!.intellect}`
             + ` 政${o!.politics} 魅${o!.charisma}`
             + `${home ? `｜籍贯${o!.home}在我手，+${Math.round(P.suadeHomeBonus * 100)}%` : ""}`
             + `｜成功 ${pct}%，不成则不屈永殁`
             + `${last ? "｜本季末出窗，过期不可招" : ""}）`,
      });
    }
  }

  // ── 改阵：只在「当面之敌的阵正克本郡」时列出 ────────────────────────
  //
  // 阵型是郡的属性（不乘候选数），改阵是唯一能动它的令。
  // 引擎不铺开「每郡 × 三阵」——那是 105×3；只在**看得见的**邻敌正克本郡时
  // 给一条，并指明改成哪一阵可反克。看不见（未探）就不给：
  // 那正是刺探要买的东西，替对局方猜等于把迷雾送掉
  if (ap >= rules.normalAp) {
    const fixes = mine
      .filter((c) => canOrder(c.id))
      .map((c) => {
        // 当面之敌里，阵型看得见且正克本郡的
        const foes = (g.adj.get(c.id) ?? [])
          .map((e) => s.commanderies[e.to])
          .filter((t) => t?.owner && t.owner !== f)
          .map((t) => ({ t, form: observedFormation(s, f, t.id) }))
          .filter((x) => x.form !== null
            && formationEdge(P, x.form, c.formation) > 0);
        if (!foes.length) return null;
        const threat = foes[0];
        const tf = threat.form as Formation;
        // 改成克制对方的那一阵
        const want = (Object.keys(FORMATION_CN) as Formation[])
          .find((x) => formationEdge(P, x, tf) > 0);
        if (!want || want === c.formation) return null;
        return { c, want, tf, at: threat.t.id };
      })
      .filter((x) => !!x)
      .sort((a, b) => b.c.garrison - a.c.garrison || cmp(a.c.id, b.c.id))
      .slice(0, rules.perTypeCap);
    for (const { c, want, tf, at } of fixes) {
      out.push({
        key: `array:${c.id}:${want}`,
        action: { type: "array", at: c.id, to: want },
        cost: rules.normalAp,
        label: `${c.id} 改${FORMATION_CN[want]}阵`
             + `（现${FORMATION_CN[c.formation]}，`
             + `当面 ${at} 为${FORMATION_CN[tf]}正克我；`
             + `改后反克，攻守各差 ${P.formationBreach} 个缺口）`,
      });
    }
  }

  // ── 调任：免费但有次数上限。缺将之郡 × 最合适的两人 ──────────────────
  // 不铺开成「全部郡 × 全部可用武将」——袁绍二十六将十三郡就是三百余条。
  // 引擎按郡的性质（临敌/后方、现有几将）预筛出该郡最该要的人，
  // 模型只在人选间取舍。
  //
  // 语义从「任命到空缺」改成了「调驻」：现在人人都有驻地，按空缺筛的话
  // 候选恒为空。而调任正是这套编制的决策面——把将堆到要打的方向，
  // 后方就空虚；分散驻守则处处能守而处处打不动。
  if (roster && freeLeft(s, f, "appoint", rules) > 0) {
    const pool = recruitable(s, roster, f);
    if (pool.length) {
      const vacancies = mine
        .filter((c) => stationedAt(s, roster, c.id).length < P.retinueCap)
        .map((c) => {
          const front = (g.adj.get(c.id) ?? []).some((e) => s.commanderies[e.to]?.owner !== f);
          // 临敌郡看统率武力，后方郡看政治魅力——同一个人在两种郡上价值不同
          const fit = (o: OfficerRef) => front
            ? o.leadership * 2 + o.might + (o.aptitudes.includes("守城") ? 30 : 0)
            : o.politics * 2 + o.charisma + (o.aptitudes.includes("治民") ? 30 : 0);
          // 名将越少越该补人：兵力上限直接由驻将数定，零名将的前线郡
          // 纵有十万戍兵也只出得动一支偏师
          const have = stationedAt(s, roster, c.id).length;
          return { c, front, fit, have,
                   weight: s.endCondition === "unification"
                     ? (front ? 100 : 0) + Math.min(P.retinueCap, c.garrison / P.troopsPerOfficer) * 20 - have * 20
                     : c.yieldTier * 10 + (front ? 25 : 0) + (P.retinueCap - have) * 20 };
        })
        .sort((a, b) => b.weight - a.weight || cmp(a.c.id, b.c.id))
        .slice(0, 4);

      // 首个空缺给最合适的两人（那里才是真正的人选取舍），
      // 其余空缺给尚未出现过的人——否则八条候选实际只有两个人，
      // 模型看到的是同一组重复，而非更多信息
      const shown = new Set<string>();
      for (const [vi, { c, front, fit, have }] of vacancies.entries()) {
        const ranked = pool.filter((o) => {
          const at = s.stations[o.id];
          if (at === c.id) return false;                 // 已驻此郡
          if (!at) return true;                          // 在野/待命，随时可就任
          // **只许从人多处调往人少处**。不加这一条，候选里就会同时存在
          // A→B 与 B→A，把人从 A 调走使 A 又缺人，下季再调回去——
          // 实测机器人让同五个人来回搬了十一季，黄忠的轨迹是
          // 南阳→长沙→桂阳→江夏→零陵→京兆→南海→京兆→长沙…
          // 有了这条，反向那一步下季就不再是候选，震荡自然消失
          const sourceCount = stationedAt(s, roster, at).length;
          return (s.endCondition === "unification"
            && reinforcesFront(s, g, f, at, c.id, sourceCount, have)) || sourceCount > have;
        }).sort((x, y) => fit(y) - fit(x) || cmp(x.id, y.id));
        const best = vi === 0 ? ranked.slice(0, 2)
          : ranked.filter((o) => !shown.has(o.id)).slice(0, 2);
        for (const o of best) {
          shown.add(o.id);
          out.push({
            key: `appoint:${c.id}:${o.id}`,
            action: { type: "appoint", officer: o.id, at: c.id },
            cost: s.stations[o.id] ? rules.normalAp : 0,
            post: { at: c.id, officer: o.id, have, front,
                    leadership: o.leadership, might: o.might,
                    politics: o.politics, charisma: o.charisma,
                    from: s.stations[o.id] ?? null,
                    govPolitics: governorOf(s, roster, c.id, P)?.politics ?? null },
            label: `调 ${o.name} 驻 ${c.id}（${front ? "临敌" : "后方"}，现 ${have} 将；`
                 + `统${o.leadership} 武${o.might} 政${o.politics} 魅${o.charisma}`
                 + `${o.aptitudes.length ? " " + o.aptitudes.join("/") : ""}）`
                 + `${s.stations[o.id] && s.stations[o.id] !== c.id ? `｜自 ${s.stations[o.id]}` : ""}`
                 + `${o.faction === f ? "" : "｜在野征辟"}`
                 // 太守是「驻此郡者中政治最高者」派生的，收入按太守政治打系数。
                 // 候选此前只写这个人的政治，不写**现任太守**的——于是
                 // 「调他来会不会换掉太守、换了收入变多少」在观测里无从判断。
                 // 只在真会换人时写这一段：不换就不发，那是最常见的情形
                 + `${(() => {
                     const gp = governorOf(s, roster, c.id, P)?.politics ?? null;
                     return gp !== null && o.politics > gp ? `｜太守政 ${gp}→${o.politics}` : "";
                   })()}`,
          });
        }
      }
    }
  }

  // ── 盟：只对有共同边界或共同敌人的势力给出 ──────────────────────────
  if (ap >= rules.normalAp) {
    const neighbours = new Set<FactionId>();
    for (const [tid] of frontier(s, g, f).best) {
      const o = s.commanderies[tid]?.owner;
      if (o && o !== f) neighbours.add(o);
    }
    const allied = new Set(
      s.treaties.filter((t) => t.until > s.turn && (t.a === f || t.b === f))
        .map((t) => (t.a === f ? t.b : t.a)),
    );
    for (const to of [...neighbours].sort().slice(0, 5)) {
      if (allied.has(to)) {
        out.push({ key: `ally:break:${to}`, action: { type: "ally", to, act: "break", term: 4 },
                   cost: rules.normalAp, label: `与${nameOf(to)}绝盟` });
      } else if (fs_.allyBanUntil <= s.turn) {
        out.push({ key: `ally:form:${to}`, action: { type: "ally", to, act: "form", term: 8 },
                   cost: rules.normalAp, label: `与${nameOf(to)}缔盟八季` });
      }
    }
  }

  // ── 归隐：仅在明显落后时才列出，免得成为默认选项 ────────────────────
  if (!fs_.retired && ap >= rules.normalAp) {
    const now = mine.length;
    if (now > 0 && now < fs_.startCommanderies * 0.5) {
      out.push({
        key: "retire",
        action: { type: "retire" },
        cost: rules.normalAp,
        label: `归隐（一局一次不可逆：弃治所外全部 ${now - 1} 郡，此后不可被攻击亦不可扩张，产出翻倍）`,
      });
    }
  }

  // 截断必须按类轮转，不能排序后一刀切。
  // 按 key 字母序截断会让字母靠后的整类消失——袁绍这类大势力候选本就超额，
  // scout 排在最后，结果是「版图越大越看不见刺探选项」，这不是设计，是排序副作用。
  //
  // 分桶按 key 前缀而非 action.type：救援与普通征伐同属 campaign，
  // 若按 type 分桶，"relief:" 排在 "campaign:" 之后，会被整批截掉——
  // 实测 530 条救援候选无一被采纳，被围的势力等于没有反制手段。
  out.sort((a, b) => cmp(a.key, b.key));
  const buckets = new Map<string, Candidate[]>();
  for (const c of out) {
    const cls = c.key.split(":")[0];
    if (!buckets.has(cls)) buckets.set(cls, []);
    buckets.get(cls)!.push(c);
  }
  const types = [...buckets.keys()].sort();
  const picked: Candidate[] = [];
  for (let round = 0; picked.length < rules.totalCap; round += 1) {
    let any = false;
    for (const ty of types) {
      const list = buckets.get(ty)!;
      if (round >= list.length) continue;
      any = true;
      picked.push(list[round]);
      if (picked.length >= rules.totalCap) break;
    }
    if (!any) break;
  }
  return picked.sort((a, b) => cmp(a.key, b.key));
}

/** 校验一条命令是否合法。返回 null 表示合法，否则给出拒绝理由 */
export function validate(
  s: GameState, o: Order, g: Graph, rules: Rules = DEFAULT_RULES,
  roster: Roster | null = null, P: EngineParams | null = null, geo: Geography | null = null,
): string | null {
  const f = s.factions[o.faction];
  if (!f) return "未知势力";
  if (f.eliminated) return "该势力已出局";
  if (f.retired && o.action.type !== "scout") return "已归隐，不可再行动";
  if (s.finished) return "对局已结束";

  const a = o.action;
  const cost = orderCost(a, s, rules);
  if (cost > f.ap) return `令数不足（需 ${cost}，余 ${f.ap}）`;
  if (cost === 0 && freeLeft(s, o.faction, a.type, rules) <= 0) {
    return `${a.type} 本季免费次数已用尽`;
  }

  const own = (id: CommanderyId) => s.commanderies[id]?.owner === o.faction;
  const quota = (id: CommanderyId) =>
    ordersLeft(s, id, rules, P);

  switch (a.type) {
    case "campaign": {
      // 增兵须自**当初起兵的那条边**。军团的 home 决定三件事：补给锚点、
      // 攻城用的地形系数、残兵退回何处；而增兵分支只做 troops += troops，
      // 不动 home。于是「先从平原近邻派一支象征性部队立寨，下季再从渡河的
      // 远邻增兵八千」——主力白得平原路的地形系数。实测放行且 home 不变。
      // 要换方向就得先撤围重来，那本身是一个真决策
      {
        const held = s.armies.find((x) => x.target === a.target && x.faction === o.faction);
        if (held && held.home !== a.from) {
          return `${a.target} 城下已有我军（自 ${held.home} 起兵），增兵须自同一郡`;
        }
      }
      if (!own(a.from)) return "起点非己方所有";
      if (!s.commanderies[a.target]) return "目标郡不存在";
      // 己方郡正被围时可以发兵——那是救援。禁掉这条，「解围」就无从谈起
      const underSiege = s.armies.some((x) => x.target === a.target && x.faction !== o.faction);
      if (own(a.target) && !underSiege) return "目标已属己方";
      // 出城迎战：起点即被围之郡，不需要邻接边
      if (a.from === a.target) {
        if (!underSiege) return "该郡未被围，无从出击";
        if (!own(a.from)) return "非己方郡国";
        if (!quota(a.from)) return "该郡本季令数已满";
        return null;
      }
      const edge = (g.adj.get(a.from) ?? []).find((e) => e.to === a.target);
      if (!edge) return "目标与起点不邻接";
      if (!quota(a.from)) return "起点郡本季令数已满";
      return null;
    }
    case "transfer": {
      if (!P) return "缺少调兵规则";
      if (!own(a.from) || !own(a.to)) return "调兵两端须属己方";
      if (!(g.adj.get(a.from) ?? []).some((e) => e.to === a.to)) return "调兵只可沿相邻己方道路";
      if (besiegedNow(s, a.from, o.faction) || besiegedNow(s, a.to, o.faction)) return "被围城池不可调兵";
      if (!quota(a.from) || !quota(a.to)) return "调兵郡本季令数已满";
      return transferAmount(s, a.from, a.to, P) > 0 ? null : "无可调兵力或目的地已满";
    }
    case "muster": {
      if (!own(a.at)) return "集结地非己方所有";
      if (a.from.length < 2 || a.from.length > 5) return "来源郡须 2–5 个";
      for (const src of a.from) {
        if (!own(src)) return `来源郡 ${src} 非己方所有`;
        if (src !== a.at && !(g.adj.get(src) ?? []).some((e) => e.to === a.at)) {
          return `来源郡 ${src} 与集结地不连地`;
        }
        if (!quota(src)) return `来源郡 ${src} 本季令数已满`;
      }
      return null;
    }
    case "govern": {
      if (!own(a.at)) return "非己方郡国";
      if (!quota(a.at)) return "该郡本季令数已满";
      // 被围之城不得募兵。这条规则包里**早就写着**——「围城期间城中不得补兵，
      // 否则守军逐季回血，缺口累加被抵消，围困永远推不动进度」——但只实现在
      // 产出那一路（阶段八），没管募兵令。算一下就知道有多要命：
      // 攻守比每季 ×(1−0.12)/(1−0.25) = 1.1733，而一条募兵令是 ×1.18，
      // 于是 ρ_eff = 0.9944 ≤ 1，**一条令就把围城时钟按停**。
      // 临界值 ln(1.1733)/ln(1.18) = 0.9658，离 1 只差 3.4%——这三个常数
      // 当初是各自定的，碰巧留下这点余量。
      // 守方被围时该做的是屯粮（买时间）、修城（抗强攻）、或出城野战求援
      if (a.policy === "levy" && besiegedNow(s, a.at, o.faction)) {
        return "此城正被围，城中不得补兵";
      }
      // 劝农在被围之城是死令：被围则本季无产出，而劝农提的是产出档
      if (a.policy === "farm" && besiegedNow(s, a.at, o.faction)) {
        return "此城正被围，本季无产出，劝农无从施行";
      }
      return null;
    }
    case "invest": {
      // 须持朝廷。兴平元年献帝在长安，司隶校尉随朝廷驻长安，故以京兆尹之主为持朝廷者
      if (!P) return null;
      if (s.commanderies[P.courtSeat]?.owner !== o.faction) return "朝廷不在我手，授不得官";
      if (!s.factions[a.to]) return "未知势力";
      if (s.factions[a.to].eliminated) return "该势力已出局";
      const holder = Object.values(s.factions).find((x) => x.governorships.includes(a.zhou));
      if (holder?.id === a.to) return "此州之牧已是此人";
      return null;
    }
    case "seize": {
      if (!own(a.from)) return "非己方郡国";
      if (!quota(a.from)) return "该郡本季令数已满";
      const site = g.sites.get(a.node);
      if (!site) return "无此据点";
      if (!site.on.some(([x, y]) => x === a.from || y === a.from)) return "该据点不在此郡的邻边上";
      if (s.holds[a.node]?.owner === o.faction) return "此据点已归我方";
      return null;
    }
    case "build": {
      if (!own(a.at)) return "非己方郡国";
      if (!quota(a.at)) return "该郡本季令数已满";
      const c = s.commanderies[a.at];
      if (c.buildings.includes(a.kind)) return "该郡已有此建筑";
      const need = BUILD_NEEDS[a.kind];
      if (need && !c.resources.includes(need)) return `该郡无${RESOURCE_CN[need]}，建不得${BUILD_CN[a.kind]}`;
      // 上限与金价要读参数。P 可缺省（界面与部分测试不传），那两项就留给候选生成器把关；
      // 引擎侧 resolve 一定传 P，所以真正落地的那一次是全的
      if (!P) return null;
      if (c.buildings.length >= P.buildCap) return `该郡已建满 ${P.buildCap} 座`;
      if (P.goldOn && (s.factions[o.faction]?.gold ?? 0) < P.buildGold[a.kind]) return "国库不足";
      return null;
    }
    case "appoint": {
      if (!own(a.at)) return "非己方郡国";
      if (!roster) return null;
      const who = roster.byId.get(a.officer);
      if (!who) return "该武将本年不登场";
      if (s.capturedOfficers.includes(a.officer)) return "该武将已被俘";
      if (!recruitable(s, roster, o.faction).some((x) => x.id === a.officer)) {
        return who.faction && who.faction !== o.faction ? "该武将属于他方"
          : "该武将已在任，或其籍贯郡不在己方治下";
      }
      return null;
    }
    case "ally":
      if (a.to === o.faction) return "不能与自己缔盟";
      if (!s.factions[a.to]) return "未知势力";
      return null;
    case "passage":
      if (!s.treaties.some((t) => t.until > s.turn &&
          ((t.a === o.faction && t.b === a.to) || (t.b === o.faction && t.a === a.to)))) {
        return "双方非同盟，不可借道";
      }
      return null;
    case "scout":
      if (!s.commanderies[a.at]) return "目标郡不存在";
      return null;
    case "submit": {
      const tgt = s.factions[a.to];
      if (!tgt || tgt.eliminated || tgt.retired) return "该势力已不在场";
      if (a.to === o.faction) return "不能劝降自己";
      if (P && geo && !submissionTerms(s, o.faction, a.to, g, P, geo)) return "未满足归降实力、州数或接壤条件";
      if (s.turn < (submitBanUntil(s, a.to) ?? 0)) return "该势力新近拒降，暂不再受劝";
      return null;
    }
    case "suade": {
      // 只查归属：**在册即在窗**。出窗者每季末已被剔除，
      // 时限判据因此只有一处（resolve 的剔除），不用在这里再写一遍
      const cap = s.captives.find((x) => x.officer === a.officer);
      if (!cap || cap.by !== o.faction) return "此人不在我方俘中";
      return null;
    }
    case "relocate": {
      if (!own(a.to)) return "非己方郡国";
      if (!quota(a.to)) return "该郡本季令数已满";
      if (s.factions[o.faction]?.capital === a.to) return "本已是治所";
      return null;
    }
    case "array": {
      if (!own(a.at)) return "非己方郡国";
      if (!quota(a.at)) return "该郡本季令数已满";
      if (s.commanderies[a.at].formation === a.to) return "本已是此阵";
      return null;
    }
    case "withdraw": {
      const army = s.armies.find((x) => x.id === a.army);
      if (!army) return "无此军团";
      if (army.faction !== o.faction) return "非己方军团";
      if (!army.target) return "该军团未在围城";
      return null;
    }
    case "retire":
      if (f.retired) return "已归隐";
      return null;
    default:
      return "未知动作";
  }
}

/** 规范化排序：使裁决顺序与提交顺序无关（MERS R6） */
export function canonicalOrder(orders: readonly Order[]): Order[] {
  const phase = (t: Action["type"]) =>
    ({ scout: 0, suade: 1, appoint: 1, array: 2, govern: 2, build: 2, relocate: 2, passage: 3,
       ally: 4, submit: 4, invest: 4, transfer: 4.5, muster: 5, withdraw: 6, seize: 6.5, campaign: 7,
       retire: 8 })[t] ?? 9;
  return [...orders].sort((x, y) =>
    phase(x.action.type) - phase(y.action.type)
    || cmp(x.faction, y.faction)
    || cmp(JSON.stringify(x.action), JSON.stringify(y.action)));
}
