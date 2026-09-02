// 确定性同时裁决。
//
// 两条硬性要求，都会被测试逐条检验：
//   R6  裁决顺序不影响任何结果 —— 命令列表打乱后，结果状态必须逐位相同
//   R33 随机只按坐标派生 —— 同一 seed 与同一命令集，重放必须逐位相同
//
// 为此做了三件事：
//   1. 先 canonicalOrder 规范化排序，再按阶段推进，不依赖提交顺序
//   2. 所有随机取数都带完整坐标（含事件序号），序号来自规范化后的位次
//   3. 同一目标被多方同时进攻时，用确定性规则裁决先后，而非数组顺序
import { roll } from "./rng.ts";
import { canonicalOrder, type Graph, type Rules, DEFAULT_RULES, validate } from "./actions.ts";
import type { EngineParams } from "./params.ts";
import { attackEffect, defendEffect, governEffect, governorOf, type Roster } from "./officers.ts";
import type { GameState, Order, Grade, CommanderyId, FactionId, GameEvent } from "./types.ts";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function log(s: GameState, e: Omit<GameEvent, "turn">): void {
  s.log.push({ turn: s.turn, ...e });
}

// ── 补给：从治所出发的连通分量（MERS R28）──────────────────────────
export function supplyReach(s: GameState, g: Graph, f: FactionId): Set<CommanderyId> {
  const cap = s.factions[f]?.capital;
  const seen = new Set<CommanderyId>();
  if (!cap || s.commanderies[cap]?.owner !== f) return seen;
  // 可通行的郡：己方所有，或有借道条款的盟友郡国
  const passable = (id: CommanderyId) => {
    const c = s.commanderies[id];
    if (!c) return false;
    if (c.owner === f) return true;
    return s.passages.some((p) => p.grantee === f && p.from <= s.turn
      && p.grantor === c.owner && p.through.includes(id));
  };
  const stack = [cap];
  seen.add(cap);
  while (stack.length) {
    const u = stack.pop()!;
    for (const e of g.adj.get(u) ?? []) {
      if (seen.has(e.to) || !passable(e.to)) continue;
      seen.add(e.to); stack.push(e.to);
    }
  }
  return seen;
}

/**
 * 攻城判定：缺口数 vs 守方可防守数（MERS R23–R24）。
 * 用「缺口数」而非「兵力比」是刻意的——比值是连续量，模型难以心算出
 * 自己究竟够不够；缺口数是小整数，一眼可数。
 *
 * 全部系数来自内容包，不在此硬编码：引擎与模型提示词必须共用同一份定义，
 * 否则模型按包里的公式算、引擎按另一套结算，算出来对不上。
 */
function breachCount(P: EngineParams, attack: number, defend: number, defense: number,
                     gear: keyof EngineParams["gearBreach"],
                     terrain: string, atGate: boolean,
                     breachBonus = 0, holdBonus = 0): { breach: number; hold: number } {
  const terrainDef = P.terrainDefense[terrain] ?? 0;
  const eff = defend * (1 + terrainDef);
  const ratio = eff > 0 ? attack / eff : 99;
  let base = 0;
  for (const [threshold, n] of P.breachLadder) { if (ratio >= threshold) { base = n; break; } }
  const gearBonus = atGate ? Math.floor(P.gearBreach[gear] / 2) : P.gearBreach[gear];
  // 可防守数必须把城防算进来。首版只看守军数，30–100 的城防等于白算，
  // 「修城」这条内政毫无用处，攻城易如反掌——自对局实测第一季就有
  // 17 个郡易主，96% 是势力互夺。
  const hold = P.holdBase
    + Math.floor(defense / P.defensePerHold)
    + Math.max(0, Math.floor(Math.log2(Math.max(1, defend / P.garrisonPerHold))));
  return { breach: base + gearBonus + breachBonus, hold: hold + holdBonus };
}

// ── 主裁决 ──────────────────────────────────────────────────────────
export interface ResolveResult {
  state: GameState;
  rejected: Array<{ order: Order; reason: string }>;
}

export function resolve(
  prev: GameState, orders: readonly Order[], g: Graph, P: EngineParams,
  roster: Roster | null = null, rules: Rules = DEFAULT_RULES,
): ResolveResult {
  const s = clone(prev);
  const rejected: Array<{ order: Order; reason: string }> = [];

  // 规范化排序：此后一切都与提交顺序无关
  const queue = canonicalOrder(orders);

  // 逐条校验并扣令。校验用的是**推进中的状态**，因此同一势力
  // 超额下令会被后面的条目自然拒绝，无需额外配额账本。
  const accepted: Order[] = [];
  for (const o of queue) {
    const reason = validate(s, o, g, rules, roster);
    if (reason) { rejected.push({ order: o, reason }); continue; }
    const a = o.action;
    const cost = a.type === "campaign" ? rules.campaignAp
      : a.type === "scout" || a.type === "appoint" ? 0 : rules.normalAp;
    const f = s.factions[o.faction];
    f.ap -= cost;
    if (cost === 0) f.freeUsed[a.type] = (f.freeUsed[a.type] ?? 0) + 1;
    // 占用郡国令数配额
    const touched: CommanderyId[] =
      a.type === "campaign" ? [a.from]
      : a.type === "muster" ? a.from
      : a.type === "govern" ? [a.at] : [];
    for (const id of touched) s.commanderies[id].ordersThisSeason += 1;
    accepted.push(o);
  }

  // ── 阶段一：观测与任命（无冲突）────────────────────────────────────
  for (const o of accepted) {
    const a = o.action;
    if (a.type === "scout") {
      (s.intel[o.faction] ??= {})[a.at] = s.turn + P.intelValidSeasons;
    } else if (a.type === "appoint") {
      s.commanderies[a.at].governor = a.officer;
    }
  }

  // ── 阶段二：内政 ──────────────────────────────────────────────────
  for (const o of accepted) {
    if (o.action.type !== "govern") continue;
    const c = s.commanderies[o.action.at];
    switch (o.action.policy) {
      case "farm":   c.yieldTier = Math.min(10, c.yieldTier + P.farmGain); break;
      case "levy":   c.garrison = Math.round(c.garrison * P.levyMultiplier);
                     c.moraleTier = Math.max(1, c.moraleTier - 1); break;
      case "wall":   c.defense = Math.min(100, c.defense + P.wallGain); break;
      case "soothe": c.moraleTier = Math.min(5, c.moraleTier + 1); break;
    }
  }

  // ── 阶段三：外交（变更延迟一季生效）────────────────────────────────
  for (const o of accepted) {
    const a = o.action;
    if (a.type === "ally") {
      const key = [o.faction, a.to].sort();
      const idx = s.treaties.findIndex((t) => t.a === key[0] && t.b === key[1]);
      if (a.act === "form") {
        const t = { a: key[0], b: key[1], kind: "alliance" as const,
                    from: s.turn + 1, until: s.turn + 1 + a.term };
        if (idx >= 0) s.treaties[idx] = t; else s.treaties.push(t);
        log(s, { kind: "ally", faction: o.faction, text: `与 ${a.to} 缔盟 ${a.term} 季（下季生效）` });
      } else if (idx >= 0) {
        const broke = s.treaties[idx].until > s.turn;
        s.treaties.splice(idx, 1);
        log(s, { kind: "ally-break", faction: o.faction,
                 text: `与 ${a.to} 绝盟${broke ? "（背盟，全席位可见）" : ""}` });
      }
    } else if (a.type === "passage") {
      s.passages.push({ grantor: o.faction, grantee: a.to, through: [a.through], from: s.turn + 1 });
    } else if (a.type === "retire") {
      const f = s.factions[o.faction];
      f.retired = true;
      for (const c of Object.values(s.commanderies)) {
        if (c.owner === o.faction && c.id !== f.capital) c.owner = null;
      }
      log(s, { kind: "retire", faction: o.faction, text: "归隐，弃治所外全部郡国" });
    }
  }

  // ── 阶段四：集结 ──────────────────────────────────────────────────
  for (const o of accepted) {
    if (o.action.type !== "muster") continue;
    const a = o.action;
    let troops = 0;
    for (const src of a.from) {
      const c = s.commanderies[src];
      const take = Math.floor(c.garrison * 0.5);
      c.garrison -= take; troops += take;
    }
    s.armies.push({
      id: `${o.faction}:${s.turn}:${a.at}`,
      faction: o.faction, commander: a.commander, troops,
      at: a.at, target: null, posture: "main", gear: "none",
      siegeXun: 0, marchXun: a.deadline,
    });
    log(s, { kind: "muster", faction: o.faction, text: `于 ${a.at} 集结 ${troops} 人` });
  }

  // ── 阶段五：征伐 ──────────────────────────────────────────────────
  // 同一目标被多方同时进攻时，按「攻击力降序、势力 id 升序」确定先后，
  // 而非数组顺序——否则打乱命令列表就会改变谁先破城。
  const campaigns = accepted
    .filter((o) => o.action.type === "campaign")
    .map((o, i) => {
      const a = o.action as Extract<Order["action"], { type: "campaign" }>;
      const src = s.commanderies[a.from];
      const troops = Math.floor(src.garrison * P.strengthRatio[a.strength]);
      return { o, a, troops, seq: i };
    })
    .sort((x, y) => y.troops - x.troops || x.o.faction.localeCompare(y.o.faction)
                 || x.a.target.localeCompare(y.a.target));

  for (const [i, c] of campaigns.entries()) {
    const { o, a, troops } = c;
    const src = s.commanderies[a.from];
    const tgt = s.commanderies[a.target];
    if (!tgt || tgt.owner === o.faction) continue;          // 已被同季先手拿下
    if (src.garrison < troops || troops <= 0) continue;

    const edge = (g.adj.get(a.from) ?? []).find((e) => e.to === a.target);
    const terrain = edge?.terrain ?? "plain";
    const atGate = (edge?.gates.length ?? 0) > 0;

    src.garrison -= troops;
    // 随机只影响 ±8% 的战力浮动，且在结算前就由坐标定死
    const jitter = (1 - P.jitter) + roll({ seed: s.seed, year: s.year, season: s.season,
                                           faction: o.faction, event: "siege", seq: i }) * P.jitter * 2;
    // 主将取自起兵郡的太守，守将取自目标郡的太守——太守领兵，见 officers.ts
    const atk = roster ? attackEffect(governorOf(s, roster, a.from), P, terrain) : null;
    const def = roster ? defendEffect(governorOf(s, roster, a.target), P) : null;
    const attack = troops * jitter * (atk?.attackMul ?? 1);
    const { breach, hold } = breachCount(P, attack, tgt.garrison, tgt.defense, a.siegeGear,
                                         terrain, atGate, atk?.breachBonus ?? 0, def?.holdBonus ?? 0);
    const who = { 主将: atk?.note ?? "无主将", 守将: def?.note ?? "无守将" };

    if (breach > hold) {
      const survivors = Math.max(1, Math.round(troops - tgt.garrison * P.captureSurvivalPenalty));
      const loser = tgt.owner;
      // 守将被俘：名将镇要地因此有真实风险，也让「打下人才郡」有额外收益
      const caught = tgt.governor;
      if (caught) {
        s.capturedOfficers.push(caught);
        tgt.governor = null;
        log(s, { kind: "officer-captured", faction: o.faction,
                 text: `${a.target} 守将 ${roster?.byId.get(caught)?.name ?? caught} 被俘` });
      }
      tgt.owner = o.faction;
      tgt.garrison = survivors;
      tgt.moraleTier = Math.max(1, tgt.moraleTier - 1);
      tgt.defense = Math.max(20, tgt.defense - 15);
      log(s, { kind: "siege-win", faction: o.faction,
               text: `自 ${a.from} 取 ${a.target}${loser ? `（原属 ${loser}）` : "（无主）"}`,
               attribution: { 投入: troops, 缺口: breach, 可防守: hold, 城防: tgt.defense,
                              地形: terrain, ...who } });
    } else {
      const lost = Math.round(troops * P.failLossRatio);
      src.garrison += Math.max(0, troops - lost);
      tgt.garrison = Math.max(200, Math.round(tgt.garrison * P.defenderAttritionOnHold));
      log(s, { kind: "siege-fail", faction: o.faction,
               text: `攻 ${a.target} 未克，折损 ${lost}`,
               attribution: { 投入: troops, 缺口: breach, 可防守: hold, 地形: terrain, ...who } });
    }
  }

  // ── 阶段六：补给与产出 ────────────────────────────────────────────
  for (const f of Object.values(s.factions)) {
    if (f.eliminated) continue;
    const reach = supplyReach(s, g, f.id);
    for (const c of Object.values(s.commanderies)) {
      if (c.owner !== f.id) continue;
      if (!reach.has(c.id)) {
        // 不可达：产出归零，仍属己方，守军仍在（R28）
        log(s, { kind: "supply-cut", faction: f.id, text: `${c.id} 补给断绝，本季无产出` });
        continue;
      }
      const gov = roster ? governEffect(governorOf(s, roster, c.id), P) : null;
      const factor = P.moraleBase + c.moraleTier / P.moraleDivisor;
      c.garrison = Math.min(
        Math.round(c.garrison + c.yieldTier * P.yieldToGarrison * factor * (gov?.yieldMul ?? 1)),
        P.garrisonCap);
      if (gov?.moraleGain) c.moraleTier = Math.min(5, c.moraleTier + gov.moraleGain);
    }
  }

  // ── 阶段七：存亡与档位 ────────────────────────────────────────────
  const countByFaction = new Map<FactionId, number>();
  for (const c of Object.values(s.commanderies)) {
    if (c.owner) countByFaction.set(c.owner, (countByFaction.get(c.owner) ?? 0) + 1);
  }
  for (const f of Object.values(s.factions)) {
    const n = countByFaction.get(f.id) ?? 0;
    if (n === 0 && !f.eliminated) {
      f.eliminated = true;
      log(s, { kind: "eliminated", faction: f.id, text: "尽失疆土" });
    }
    // 档位按本局曾达到过的最高记，冲高后回落不扣分
    const grade: Grade = n >= f.startCommanderies * P.gradeJia ? "jia"
      : n >= f.startCommanderies * P.gradeYi ? "yi"
      : n >= f.startCommanderies ? "bing" : "ding";
    const rank = { ding: 0, bing: 1, yi: 2, jia: 3 };
    if (rank[grade] > rank[f.bestGrade]) f.bestGrade = grade;
  }

  // ── 推进时钟 ──────────────────────────────────────────────────────
  s.turn += 1;
  s.season += 1;
  if (s.season > 4) { s.season = 1; s.year += 1; }
  s.epoch = s.turn < 6 ? 1 : s.turn < 11 ? 2 : 3;
  if (s.turn >= P.seasonsPerGame) s.finished = true;

  return { state: s, rejected };
}
