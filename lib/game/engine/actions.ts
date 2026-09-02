// 候选枚举与合法性校验。
//
// MERS R13 的要害：**动作参数不自由填，由引擎预筛成具体候选，模型做选择题**。
// 若让模型自由填参，仅征伐一项就是 目标 × 主将 × 兵力档 × 器械档，
// 袁绍十三郡下轻易过万种组合——模型选不过来，校验也挡不住乱填。
// 预筛之后每类动作 5–15 条，全部加起来落在 O(10²)，这才是可枚举。
import { recruitable, governorOf, type OfficerRef, type Roster } from "./officers.ts";
import type {
  Action, Candidate, CommanderyId, FactionId, GameState, Order,
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
export function listActions(
  s: GameState, f: FactionId, g: Graph, rules: Rules = DEFAULT_RULES,
  roster: Roster | null = null,
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
        const tgt = s.commanderies[tid];
        return { tid, e, ratio: tgt.garrison > 0 ? src.garrison / tgt.garrison : 99 };
      })
      .filter((x) => canOrder(x.e.from) && x.ratio > 0.35)   // 兵力比过低的不列
      .sort((a, b) => b.ratio - a.ratio || a.tid.localeCompare(b.tid))
      .slice(0, rules.perTypeCap);

    for (const { tid, e, ratio } of targets) {
      const tgt = s.commanderies[tid];
      const gateNote = e.gates.length ? `，扼于${e.gates.join("、")}` : "";
      // 主将由起兵郡的太守唯一确定（太守领兵），因此写进 label 与 action，
      // 让模型看得见「谁去打」，而不必自己再选一次人
      const lead = roster ? governorOf(s, roster, e.from) : null;
      const ready = s.armies.find((x) => x.faction === f && x.at === e.from && !x.target);
      const ongoing = s.armies.find((x) => x.target === tid);
      const siegeNote = !ongoing ? ""
        : ongoing.faction === f ? `｜我军已围 ${ongoing.siegeSeasons} 季（本令为增兵）`
        : `｜${ongoing.faction} 正围此城 ${ongoing.troops} 人（本令先野战）`;
      const armyNote = ready ? `｜${e.from} 有待命军团 ${ready.troops} 人，本令整建制出征` : "";
      const leadNote = lead
        ? `，${lead.name}领（统${lead.leadership} 武${lead.might}`
          + `${lead.aptitudes.length ? " " + lead.aptitudes.join("/") : ""}）`
        : "，无主将（该郡未设太守，战力无加成）";
      // 兵力档给两个（主力/倾国），器械按是否有关隘决定是否值得带
      for (const strength of ["main", "allout"] as const) {
        // 出兵后本郡余兵必须写进 label。只写「我方戍兵 6576」而不写
        // 「倾国后城中仅余 1315」，模型看不见自己正在把老巢掏空——
        // 实测投机流曹操因此 10/10 全灭
        const send = ready ? ready.troops
          : Math.floor(s.commanderies[e.from].garrison * (strength === "allout" ? 0.8 : 0.55));
        const left = ready ? s.commanderies[e.from].garrison
          : s.commanderies[e.from].garrison - send;
        out.push({
          key: `campaign:${e.from}>${tid}:${strength}`,
          action: { type: "campaign", target: tid, from: e.from, commander: lead?.id ?? null,
                    strength, siegeGear: e.gates.length ? "ram" : "none" },
          cost: rules.campaignAp,
          label: `自${e.from}征${tid}（${strength === "main" ? "主力" : "倾国"}）`
               + `：我方戍兵 ${s.commanderies[e.from].garrison}，`
               + `敌守军约 ${tgt.garrison}，比 ${ratio.toFixed(2)}，${e.terrain}${gateNote}${leadNote}`
               + `｜出 ${send} 人，${e.from} 城中余 ${left} 人`
               + `${armyNote}${siegeNote}`,
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
        const lead = roster ? governorOf(s, roster, src.id) : null;
        out.push({
          key: `relief:${src.id}>${foe.target}`,
          action: { type: "campaign", target: foe.target!, from: src.id,
                    commander: lead?.id ?? null, strength: "allout", siegeGear: "none" },
          cost: rules.campaignAp,
          label: `${isSortie ? `${src.id}出城迎战` : `自${src.id}赴援${foe.target}`}`
               + `（${foe.faction} 围城第 ${foe.siegeSeasons} 季，围军约 ${foe.troops} 人）：`
               + `我方可出 ${Math.floor(src.garrison * 0.8)} 人`
               + `${lead ? `，${lead.name}领（统${lead.leadership}）` : "，无主将"}`
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
        label: `自${army.target}撤围（已围 ${army.siegeSeasons} 季，余 ${army.troops} 人；`
             + `撤回可保 ${Math.round(army.troops * 0.85)} 人，续围则每季再耗一成二）`,
      });
    }
  }

  // ── 集结：只在有相邻己方郡可抽调时给出 ──────────────────────────────
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
        label: `于${at}集结，自${take.join("、")}抽调约 ${total} 人（下季抵达，集结地公开）`,
      });
    }
  }

  // ── 治：每郡只给最该做的那一项，不把四个方针全铺开 ──────────────────
  if (ap >= rules.normalAp) {
    const picks = mine.filter((c) => canOrder(c.id)).map((c) => {
      // 民心低先安民，守军薄先募兵，城防低且临敌先修城，否则劝农
      const isFront = (g.adj.get(c.id) ?? []).some((e) => s.commanderies[e.to]?.owner !== f);
      const policy = c.moraleTier <= 2 ? "soothe"
        : isFront && c.defense < 55 ? "wall"
        : isFront && c.garrison < 4000 ? "levy" : "farm";
      const why = { soothe: "民心低", wall: "临敌且城防薄", levy: "临敌且兵少", farm: "后方可劝农" }[policy];
      return { c, policy, why };
    }).sort((a, b) => a.c.id.localeCompare(b.c.id)).slice(0, rules.perTypeCap);
    for (const { c, policy, why } of picks) {
      out.push({
        key: `govern:${c.id}:${policy}`,
        action: { type: "govern", at: c.id, policy: policy as never },
        cost: rules.normalAp,
        label: `${c.id} 行${{ farm: "劝农", levy: "募兵", wall: "修城", soothe: "安民" }[policy]}`
             + `（${why}；产出${c.yieldTier} 民心${c.moraleTier} 城防${c.defense}）`,
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
        label: `刺探${id}（免费，本季余 ${freeLeft(s, f, "scout", rules)} 次；探后守军由档位变为 ±15% 点估计）`,
      });
    }
  }

  // ── 任命：免费但有次数上限。空缺席位 × 最合适的两人 ──────────────────
  // 不铺开成「全部郡 × 全部可用武将」——袁绍二十六将十三郡就是三百余条。
  // 引擎按郡的性质（临敌/后方）预筛出该郡最该要的人，模型只在人选间取舍。
  if (roster && freeLeft(s, f, "appoint", rules) > 0) {
    const pool = recruitable(s, roster, f);
    if (pool.length) {
      const vacancies = mine
        .filter((c) => !c.governor)
        .map((c) => {
          const front = (g.adj.get(c.id) ?? []).some((e) => s.commanderies[e.to]?.owner !== f);
          // 临敌郡看统率武力，后方郡看政治魅力——同一个人在两种郡上价值不同
          const fit = (o: OfficerRef) => front
            ? o.leadership * 2 + o.might + (o.aptitudes.includes("守城") ? 30 : 0)
            : o.politics * 2 + o.charisma + (o.aptitudes.includes("治民") ? 30 : 0);
          return { c, front, fit, weight: c.yieldTier * 10 + (front ? 25 : 0) };
        })
        .sort((a, b) => b.weight - a.weight || a.c.id.localeCompare(b.c.id))
        .slice(0, 4);

      // 首个空缺给最合适的两人（那里才是真正的人选取舍），
      // 其余空缺给尚未出现过的人——否则八条候选实际只有两个人，
      // 模型看到的是同一组重复，而非更多信息
      const shown = new Set<string>();
      for (const [vi, { c, front, fit }] of vacancies.entries()) {
        const ranked = [...pool].sort((x, y) => fit(y) - fit(x) || x.id.localeCompare(y.id));
        const best = vi === 0 ? ranked.slice(0, 2)
          : ranked.filter((o) => !shown.has(o.id)).slice(0, 2);
        for (const o of best) {
          shown.add(o.id);
          out.push({
            key: `appoint:${c.id}:${o.id}`,
            action: { type: "appoint", officer: o.id, at: c.id },
            cost: 0,
            label: `任 ${o.name} 为 ${c.id} 太守（${front ? "临敌" : "后方"}；`
                 + `统${o.leadership} 武${o.might} 政${o.politics} 魅${o.charisma}`
                 + `${o.aptitudes.length ? " " + o.aptitudes.join("/") : ""}）`
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
                   cost: rules.normalAp, label: `与${to}绝盟（威望大损，全席位可见）` });
      } else {
        out.push({ key: `ally:form:${to}`, action: { type: "ally", to, act: "form", term: 8 },
                   cost: rules.normalAp, label: `与${to}缔盟八季（延迟一季生效，全席位可见）` });
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
  const cost = a.type === "campaign" ? rules.campaignAp
    : a.type === "scout" || a.type === "appoint" ? 0 : rules.normalAp;
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
    ({ scout: 0, appoint: 1, govern: 2, passage: 3, ally: 4, muster: 5,
       withdraw: 6, campaign: 7, retire: 8 })[t] ?? 9;
  return [...orders].sort((x, y) =>
    phase(x.action.type) - phase(y.action.type)
    || x.faction.localeCompare(y.faction)
    || JSON.stringify(x.action).localeCompare(JSON.stringify(y.action)));
}
