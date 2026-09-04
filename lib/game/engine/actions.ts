// 候选枚举与合法性校验。
//
// MERS R13 的要害：**动作参数不自由填，由引擎预筛成具体候选，模型做选择题**。
// 若让模型自由填参，仅征伐一项就是 目标 × 主将 × 兵力档 × 器械档，
// 袁绍十三郡下轻易过万种组合——模型选不过来，校验也挡不住乱填。
// 预筛之后每类动作 5–15 条，全部加起来落在 O(10²)，这才是可枚举。
import { recruitable, retinueAt, stationedAt, troopCap, isFiller,
  type OfficerRef, type Roster }
  from "./officers.ts";
import { observedGarrison, observedFormation, tierOf } from "./intel.ts";
import { forecastCampaign, forecastField } from "./forecast.ts";
import { formationEdge, FORMATION_CN } from "./combat.ts";
import { suadeChance } from "./officers.ts";

const statSum = (o: OfficerRef) =>
  o.leadership + o.might + o.intellect + o.politics + o.charisma;
import { attackRetinue } from "./officers.ts";
import { gradeIfTaken, standingOf, GRADE_CN, GRADE_RANK, type Geography } from "./victory.ts";
import type { EngineParams } from "./params.ts";
import type {
  Action, Candidate, CommanderyId, FactionId, GameState, Order, Formation,
} from "./types.ts";

export interface Graph {
  /** 郡 → 邻接郡及其通行代价与地形 */
  adj: Map<CommanderyId, Array<{ to: CommanderyId; cost: number; terrain: string; gates: string[] }>>;
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
}

export const DEFAULT_RULES: Rules = {
  perTypeCap: 12,
  totalCap: 60,
  freeUses: { scout: 3, appoint: 5 },
  campaignAp: 2,
  normalAp: 1,
  perCommanderyOrders: 2,
};

export function buildGraph(adjacency: { edges: Array<{
  from: string; to: string; cost: number; terrain: string;
  nodes: Array<{ name: string; kind: string }>;
}> }): Graph {
  const adj = new Map<string, Array<{ to: string; cost: number; terrain: string; gates: string[] }>>();
  const push = (a: string, b: string, cost: number, terrain: string, gates: string[]) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, cost, terrain, gates });
  };
  for (const e of adjacency.edges) {
    const gates = e.nodes.filter((n) => n.kind === "gate" || n.kind === "pass").map((n) => n.name);
    push(e.from, e.to, e.cost, e.terrain, gates);
    push(e.to, e.from, e.cost, e.terrain, gates);
  }
  return { adj };
}

const ownedBy = (s: GameState, f: FactionId) =>
  Object.values(s.commanderies).filter((c) => c.owner === f);

/** 己方任一郡的邻接敌郡（含无主），即可攻击面 */
function frontier(s: GameState, g: Graph, f: FactionId) {
  const out = new Map<CommanderyId, { from: CommanderyId; cost: number; terrain: string; gates: string[] }>();
  for (const c of ownedBy(s, f)) {
    for (const e of g.adj.get(c.id) ?? []) {
      const t = s.commanderies[e.to];
      if (!t || t.owner === f) continue;
      // 同一目标可能从多郡可达，取代价最低的那条路
      const prev = out.get(e.to);
      if (!prev || e.cost < prev.cost) out.set(e.to, { from: c.id, cost: e.cost, terrain: e.terrain, gates: e.gates });
    }
  }
  return out;
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
export function submitChance(
  P: EngineParams, mine: number, theirs: number, morale: number,
): number {
  const ratio = theirs > 0 ? mine / theirs : P.submitRatio;
  const p = P.submitBase - morale * P.submitPerMorale
    + Math.max(0, ratio - P.submitRatio) * P.submitPerRatio;
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

export function orderSites(a: Action): CommanderyId[] {
  return a.type === "campaign" ? [a.from]
    : a.type === "muster" ? [...a.from]
    : a.type === "govern" || a.type === "array" ? [a.at]
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
  c: { garrison: number; gear: string }, policy: string, P: EngineParams,
): number {
  if (!P.goldOn) return 0;
  if (policy === "levy") {
    return Math.round(c.garrison * (P.levyMultiplier - 1) * P.goldPerLevyTroop);
  }
  if (policy === "wall") return P.goldPerWall * P.wallGain;
  if (policy === "forge") {
    const next = P.gearLadder[Math.min(P.gearLadder.indexOf(c.gear) + 1,
                                       P.gearLadder.length - 1)];
    return P.goldGear[next] ?? 0;
  }
  return 0;
}

/** 器械的中文名。兵种名走内容包，器械只有三级且是引擎的内部枚举，就近定义。
    导出给 resolve 的内政回执共用——各存一份迟早写出两套说法 */
export const GEAR_CN: Record<string, string> = { none: "无械", ram: "冲车", mound: "土山" };
/** 内政方针的中文名。同上，候选标签与结算回执必须是同一套字 */
export const POLICY_CN: Record<string, string> = {
  farm: "劝农", levy: "募兵", wall: "修城", soothe: "安民", forge: "治械",
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
  const mine = ownedBy(s, f).sort((a, b) => a.id.localeCompare(b.id));
  const canOrder = (id: CommanderyId) =>
    (s.commanderies[id]?.ordersThisSeason ?? 0) < rules.perCommanderyOrders;

  // ── 征伐：按「己方兵力 / 目标守军」降序取前 N 个目标 ────────────────
  // 只给打得动的。把明显打不动的目标塞进候选，等于用无效选项浪费模型的注意力。
  if (ap >= rules.campaignAp) {
    const targets = [...frontier(s, g, f).entries()]
      .map(([tid, e]) => {
        const src = s.commanderies[e.from];
        // 用观测值而非真值：候选标签是给对局方看的，写真实守军等于开天眼，
        // 刺探这条动作也就什么都买不到
        const seen = observedGarrison(s, f, tid, P);
        // 这个比值只用来给候选排序（先列打得动的），不进 label——
        // 它与引擎判胜负用的量不是一回事，写进 label 会误导
        return { tid, e, seen, ratio: seen.value > 0 ? src.garrison / seen.value : 99 };
      })
      .filter((x) => canOrder(x.e.from) && x.ratio > 0.35)   // 兵力比过低的不列
      .sort((a, b) => b.ratio - a.ratio || a.tid.localeCompare(b.tid))
      .slice(0, rules.perTypeCap);

    for (const { tid, e, seen } of targets) {
      const tgt = s.commanderies[tid];
      // 目标级，两个兵力档共用一份——同一目标的 main/allout 两条标签
      // 本来就有六成字是逐字重复的，不必再算两遍
      const gn = geo ? gainOf(s, geo, f, tid) : undefined;
      const gateNote = e.gates.length ? `，扼于${e.gates.join("、")}` : "";
      // 随军编制由起兵郡唯一确定（驻地编制），写进 label 让模型看得见「谁去打」、
      // 也看得见「能带多少兵」——出征兵力上限就是随军人数 × 每将统兵
      const corps = roster ? retinueAt(s, roster, e.from, P) : [];
      // 主将由**攻势排位**定，与结算用的是同一个函数。
      // 此前这里取 corps[0]（按 id 排序的第一个），于是标签写着「蔡瑁领」
      // 而实际出战的是文聘——告诉对局方的主将和真打的不是同一个人
      const march = roster ? attackRetinue(corps, P, e.terrain).members : [];
      const lead = march[0] ?? null;
      const cap = roster ? troopCap(corps, P) : Infinity;
      const ready = s.armies.find((x) => x.faction === f && x.at === e.from && !x.target);
      const src0 = s.commanderies[e.from];
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
      const siegeNote = !ongoing ? ""
        : ongoing.faction === f ? `｜我军已围 ${ongoing.siegeSeasons} 季（本令为增兵）`
        : `｜${nameOf(ongoing.faction)} 正围此城，${troopBand(ongoing.troops, P)}（本令先野战）`;
      // 城下有第三方围城军时，这一令结算的是**野战**而不是攻城。
      // 此前标签里写着「本令先野战」，而结构化的 forecast 仍是缺口对可防守——
      // 机器人按攻城的判断去打野战，实测 57% 的野战在战力比 <0.8 时发起。
      // 判词与结算必须对得上，光在散文里提一句不算
      const foeSiege = ongoing && ongoing.faction !== f ? ongoing : null;
      const armyNote = ready ? `｜${e.from} 有待命军团 ${ready.troops} 人，本令整建制出征` : "";
      // 五维已折进 forecast，这里只报是谁、几人——人数决定兵力上限，
      // 那是玩家/模型唯一能据以判断「该不该先调将过来」的东西
      // 只报主将与人数：人数定兵力上限，主将定五维加成，副将是谁不影响判断。
      // 全名铺开会把候选 token 撑爆——刘表一度顶到 10059/10000
      // 只报随军的那几人：march 已按 retinueCap 截过，报全员会多报出不出征的人
      const named = march.filter((o) => !isFiller(o));
      const leadNote = named.length
        ? `，${named[0].name}${named.length > 1 ? `等 ${named.length} 将` : ""}领`
        : "，仅郡守（无名将）";
      // 兵力档给两个（主力/倾国），器械按是否有关隘决定是否值得带
      for (const strength of ["main", "allout"] as const) {
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
        const capNote = send < want
          ? `（${named.length || 1} 将统兵上限 ${cap}，余 ${want - send} 人带不走）` : "";
        const ffc = foeSiege ? forecastField(s, f, e.from, foeSiege, send, g, P, roster) : null;
        const fc = forecastCampaign(s, f, {
          type: "campaign", target: tid, from: e.from, commander: lead?.id ?? null,
          strength, siegeGear: src0.gear,
        }, g, P, roster, send);
        out.push({
          key: `campaign:${e.from}>${tid}:${strength}`,
          action: { type: "campaign", target: tid, from: e.from, commander: lead?.id ?? null,
                    strength, siegeGear: src0.gear },
          cost: rules.campaignAp,
          forecast: fc ?? undefined,
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
               + `${unitNote}${armyNote}${siegeNote}`
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
    for (const foe of besieged.sort((a, b) => a.target!.localeCompare(b.target!))) {
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
        const send = Math.min(Math.floor(src.garrison * P.strengthRatio.allout),
                              roster ? troopCap(corps, P) : Infinity);
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
               + `我方可出 ${send} 人`
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
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 4)) {
      out.push({
        key: `withdraw:${army.id}`,
        action: { type: "withdraw", army: army.id },
        cost: rules.normalAp,
        label: `自${army.target}撤围（已围 ${army.siegeSeasons} 季，余 ${army.troops} 人，`
             + `撤回可保 ${Math.round(army.troops * P.siegeWithdrawKeep)}）`,
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
      .sort((a, b) => b.sources.length - a.sources.length || a.at.localeCompare(b.at))
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
      const wants: Array<[string, boolean, string]> = [
        ["soothe", c.moraleTier <= 2 && c.moraleTier < 5, "民心告急"],
        ["wall", isFront && c.defense < 55, "临敌且城防薄"],
        ["levy", isFront && c.garrison < 4000, "临敌且兵少"],
        ["forge", isFront && c.gear !== P.gearLadder[P.gearLadder.length - 1],
         `器械仅「${GEAR_CN[c.gear]}」`],
        ["farm", c.yieldTier < 10, "产出可增"],
        ["soothe", c.moraleTier < 5, "民心可安"],
        ["wall", c.defense < 100, "城防可修"],
      ];
      for (const [policy, want, why] of wants) {
        if (!want) continue;
        const price = governPrice(c, policy, P);
        if (price > (fs_.gold ?? 0)) continue;      // 付不起就看下一项
        return { c, policy, why, price };
      }
      return null;
    }).filter((x) => !!x)
      .sort((a, b) => a.c.id.localeCompare(b.c.id)).slice(0, rules.perTypeCap);
    for (const { c, policy, why, price } of picks) {
      out.push({
        key: `govern:${c.id}:${policy}`,
        action: { type: "govern", at: c.id, policy: policy as never },
        cost: rules.normalAp,
        label: `${c.id} 行${POLICY_CN[policy]}${price > 0 ? `（${price} 金）` : ""}`
             + `（${why}；产${c.yieldTier} 心${c.moraleTier} 防${c.defense}`
             + ` ${unitName(P, c.unit)}·${GEAR_CN[c.gear]}）`,
      });
    }
  }

  // ── 探：免费但有次数上限，只给尚未探明的邻接敌郡 ────────────────────
  if (freeLeft(s, f, "scout", rules) > 0) {
    const known = s.intel[f] ?? {};
    const unknown = [...frontier(s, g, f).keys()]
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

  // ── 劝降势力：接壤、弱小、且被自己碾压时才给 ────────────────────────
  //
  // 门槛定得严（对方 ≤2 郡且自己是其 6 倍以上），是为了让它只在
  // 「对方已近覆亡」时出现。放宽就是一台滚雪球放大器：它会把评测最看重的
  // 「开局↔得分相关系数」推高，而那正是测得出模型强弱的前提。
  //
  // 没有这一条天下就收不拢：实测长局终局是「两强 + 长尾」，
  // 四局合计 32 家以整整一个郡活到最后，硬打打不动
  //
  // 判据看的是**劝降方够不够强**，不是对方有多小。曹操建安二十年能收汉中，
  // 是因为他已据有大半个北方；兴平元年谁也做不到。这一条同时挡住了两件事：
  //   一、开局就小的席位被规则直接判死——只看绝对大小时，曹操（开局一郡）
  //       第一季就符合「弱小」，实测出局率从 45% 飙到 92%、
  //       策略差异从 48.9 塌到 22.2；
  //   二、16 季评测被污染——十六季里没有势力控得到三州，
  //       所以评测口径完全不受影响，而长局的霸主够得着
  //
  // 门槛用**州数**而不是郡数：郡数 20 在十六季里就够得着（实测曹操出局率
  // 45%→67%），而「据三州之地」是霸主的量级，短局里到不了
  const myZhou = geo ? standingOf(s, geo, f).controlledZhou : 0;
  if (ap >= rules.normalAp && myZhou >= P.submitMinZhou) {
    const mineCount = mine.length;
    const owned = new Set(mine.map((c) => c.id));
    const foes = new Map<FactionId, { n: number; morale: number }>();
    for (const c of Object.values(s.commanderies)) {
      if (!c.owner || c.owner === f) continue;
      const cur = foes.get(c.owner) ?? { n: 0, morale: 0 };
      cur.n += 1; cur.morale += c.moraleTier;
      foes.set(c.owner, cur);
    }
    const adjacent = new Set<FactionId>();
    for (const id of owned) {
      for (const e of g.adj.get(id) ?? []) {
        const o2 = s.commanderies[e.to]?.owner;
        if (o2 && o2 !== f) adjacent.add(o2);
      }
    }
    const cands2 = [...foes]
      .filter(([id, v]) => adjacent.has(id)
        && !s.factions[id]?.eliminated && !s.factions[id]?.retired
        && v.n <= P.submitMaxCommanderies
        && mineCount >= v.n * P.submitRatio
        && s.turn >= (submitBanUntil(s, id) ?? 0))
      .sort((a, b) => a[1].n - b[1].n || a[0].localeCompare(b[0]))
      .slice(0, rules.perTypeCap);
    for (const [id, v] of cands2) {
      const pct = Math.round(submitChance(P, mineCount, v.n, v.morale / v.n) * 100);
      out.push({
        key: `submit:${id}`,
        action: { type: "submit", to: id },
        cost: rules.normalAp,
        label: `劝降${nameOf(id)}（其 ${v.n} 郡，我 ${mineCount} 郡；`
             + `其民心均 ${(v.morale / v.n).toFixed(1)} 档`
             + `｜成功 ${pct}%，成则疆土武将尽归我；不成则两季内不再受劝）`,
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
      .sort((a, b) => statSum(b.o!) - statSum(a.o!) || a.x.officer.localeCompare(b.x.officer))
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
      .sort((a, b) => b.c.garrison - a.c.garrison || a.c.id.localeCompare(b.c.id))
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
                   weight: c.yieldTier * 10 + (front ? 25 : 0) + (P.retinueCap - have) * 20 };
        })
        .sort((a, b) => b.weight - a.weight || a.c.id.localeCompare(b.c.id))
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
          return stationedAt(s, roster, at).length > have;
        }).sort((x, y) => fit(y) - fit(x) || x.id.localeCompare(y.id));
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
                    from: s.stations[o.id] ?? null },
            label: `调 ${o.name} 驻 ${c.id}（${front ? "临敌" : "后方"}，现 ${have} 将；`
                 + `统${o.leadership} 武${o.might} 政${o.politics} 魅${o.charisma}`
                 + `${o.aptitudes.length ? " " + o.aptitudes.join("/") : ""}）`
                 + `${s.stations[o.id] && s.stations[o.id] !== c.id ? `｜自 ${s.stations[o.id]}` : ""}`
                 + `${o.faction === f ? "" : "｜在野征辟"}`,
          });
        }
      }
    }
  }

  // ── 盟：只对有共同边界或共同敌人的势力给出 ──────────────────────────
  if (ap >= rules.normalAp) {
    const neighbours = new Set<FactionId>();
    for (const [tid] of frontier(s, g, f)) {
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
  out.sort((a, b) => a.key.localeCompare(b.key));
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
  return picked.sort((a, b) => a.key.localeCompare(b.key));
}

/** 校验一条命令是否合法。返回 null 表示合法，否则给出拒绝理由 */
export function validate(
  s: GameState, o: Order, g: Graph, rules: Rules = DEFAULT_RULES,
  roster: Roster | null = null,
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
    (s.commanderies[id]?.ordersThisSeason ?? 0) < rules.perCommanderyOrders;

  switch (a.type) {
    case "campaign": {
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
    case "govern":
      if (!own(a.at)) return "非己方郡国";
      if (!quota(a.at)) return "该郡本季令数已满";
      return null;
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
      if (!own(a.through)) return "非己方郡国";
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
    ({ scout: 0, suade: 1, appoint: 1, array: 2, govern: 2, passage: 3, ally: 4,
       submit: 4, muster: 5, withdraw: 6, campaign: 7, retire: 8 })[t] ?? 9;
  return [...orders].sort((x, y) =>
    phase(x.action.type) - phase(y.action.type)
    || x.faction.localeCompare(y.faction)
    || JSON.stringify(x.action).localeCompare(JSON.stringify(y.action)));
}
