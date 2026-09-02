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
import { breachCount, unitPower, unitGuard, unitName } from "./combat.ts";
import type { EngineParams } from "./params.ts";
import { attackEffect, defendEffect, governEffect, governorOf } from "./officers.ts";
import { GRADE_CN, GRADE_RANK, gradeOf, standingOf, type Geography } from "./victory.ts";
import type { OfficerRef, Roster } from "./officers.ts";
import type {
  Army, GameState, Order, Grade, CommanderyId, FactionId, GameEvent, OfficerId,
  Posture, SiegeGear,
} from "./types.ts";

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

/** 撤围：把军团从围城名单里摘掉 */
function lift(s: GameState, army: { id: string }): void {
  s.armies = s.armies.filter((x) => x.id !== army.id);
}

/** 残兵退回。本方已失该郡则就近择一己方郡，都没有则就地散去 */
function returnHome(s: GameState, army: { faction: FactionId; home: CommanderyId }, troops: number): void {
  if (troops <= 0) return;
  const home = s.commanderies[army.home];
  if (home?.owner === army.faction) { home.garrison += troops; return; }
  const fallback = Object.values(s.commanderies)
    .filter((c) => c.owner === army.faction)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (fallback) fallback.garrison += troops;
}

function beginSiege(
  s: GameState, faction: FactionId, from: CommanderyId, target: CommanderyId,
  troops: number, a: { commander: OfficerId | null; strength: Posture },
  lead: { id: string } | null, gear: SiegeGear, unit: string,
): void {
  s.armies.push({
    id: `${faction}:${s.turn}:${from}>${target}`,
    faction, commander: a.commander ?? lead?.id ?? null, troops,
    at: target, target, posture: a.strength, gear, unit,
    siegeSeasons: 0, home: from,
  });
}

/**
 * 野战：援军进入被围郡时与围城军交战（MERS 野战组）。
 * 判据是有效战力比，分四档，全部阈值来自内容包。
 * 返回胜方留在原地的兵力；攻方未胜则返回 0。
 */
function fieldBattle(
  s: GameState, P: EngineParams, roster: Roster | null,
  x: { atkFaction: FactionId; atkTroops: number; atkLead: OfficerRef | null;
       foe: Army; at: CommanderyId; terrain: string; seq: number; atkUnit: string;
       /** 攻方起兵郡，败退时残部退回此处 */
       from: CommanderyId },
): number {
  const atkEff = roster ? attackEffect(x.atkLead, P, x.terrain) : null;
  const foeLead = roster ? roster.byId.get(x.foe.commander ?? "") ?? null : null;
  const foeEff = roster ? attackEffect(foeLead, P, x.terrain) : null;
  const jitter = (1 - P.jitter) + roll({ seed: s.seed, year: s.year, season: s.season,
                                         faction: x.atkFaction, event: "field", seq: x.seq }) * P.jitter * 2;
  const A = x.atkTroops * (atkEff?.attackMul ?? 1) * jitter
          * unitPower(P, x.atkUnit, x.terrain, x.foe.unit);
  const D = x.foe.troops * (foeEff?.attackMul ?? 1)
          * unitPower(P, x.foe.unit, x.terrain, x.atkUnit);
  const ratio = D > 0 ? A / D : 99;

  let outcome: string, atkLoss: number, foeLoss: number, atkWins: boolean;
  if (ratio >= P.fieldRout) {
    outcome = "溃退"; atkLoss = P.fieldRoutWinnerLoss; foeLoss = P.fieldRoutLoserLoss; atkWins = true;
  } else if (ratio >= P.fieldPush) {
    outcome = "后撤"; atkLoss = P.fieldPushWinnerLoss; foeLoss = P.fieldPushLoserLoss; atkWins = true;
  } else if (ratio >= P.fieldStall) {
    outcome = "相持"; atkLoss = P.fieldStallLoss; foeLoss = P.fieldStallLoss; atkWins = false;
  } else {
    outcome = "大败"; atkLoss = P.fieldDefeatLoss; foeLoss = P.fieldRoutWinnerLoss; atkWins = false;
  }

  const atkLeft = Math.round(x.atkTroops * (1 - atkLoss));
  const foeLeft = Math.round(x.foe.troops * (1 - foeLoss));
  const attribution = {
    我军: x.atkTroops, 敌军: x.foe.troops, 战力比: Number(ratio.toFixed(2)),
    结果: outcome, 我将: atkEff?.note ?? "无主将", 敌将: foeEff?.note ?? "无主将",
    我兵种: unitName(P, x.atkUnit), 敌兵种: unitName(P, x.foe.unit), 地形: x.terrain,
  };

  if (atkWins) {
    lift(s, x.foe);
    returnHome(s, x.foe, foeLeft);
    log(s, { kind: "field-win", faction: x.atkFaction,
             text: `${x.at} 城下野战，破 ${x.foe.faction} 围城之师`, attribution });
    return atkLeft;
  }
  // 攻方未胜：残部退回起兵郡，围城继续
  x.foe.troops = foeLeft;
  returnHome(s, { faction: x.atkFaction, home: x.from }, atkLeft);
  log(s, { kind: "field-fail", faction: x.atkFaction,
           text: `${x.at} 城下野战${outcome}，未能解围`, attribution });
  return 0;
}

// ── 主裁决 ──────────────────────────────────────────────────────────
export interface ResolveResult {
  state: GameState;
  rejected: Array<{ order: Order; reason: string }>;
}

export function resolve(
  prev: GameState, orders: readonly Order[], g: Graph, P: EngineParams,
  roster: Roster | null, geo: Geography,
  rules: Rules = DEFAULT_RULES,
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
      // 治械：逐级打造，不可越级。首版里器械是征伐时的自由选项，
      // 不花任何代价就能给每次攻城白送缺口
      case "forge": {
        const i = P.gearLadder.indexOf(c.gear);
        c.gear = (P.gearLadder[Math.min(i + 1, P.gearLadder.length - 1)] ?? "none") as typeof c.gear;
        break;
      }
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
  // 军团不再是死数据。集结出的军团驻在集结地待命，征伐时可整建制调用，
  // 兵力远大于单郡抽调——这才是「集结」相对「就地出兵」的意义。
  for (const o of accepted) {
    if (o.action.type !== "muster") continue;
    const a = o.action;
    let troops = 0;
    for (const src of a.from) {
      const c = s.commanderies[src];
      const take = Math.floor(c.garrison * P.musterTake);
      c.garrison -= take; troops += take;
    }
    s.armies.push({
      id: `${o.faction}:${s.turn}:${a.at}`,
      faction: o.faction, commander: a.commander, troops,
      at: a.at, target: null, posture: "main", gear: s.commanderies[a.at].gear,
      unit: s.commanderies[a.at].unit,
      siegeSeasons: 0, home: a.at,
    });
    s.commanderies[a.at].gear = "none";
    log(s, { kind: "muster", faction: o.faction, text: `于 ${a.at} 集结 ${troops} 人待命` });
  }

  // ── 阶段五：撤围 ──────────────────────────────────────────────────
  for (const o of accepted) {
    if (o.action.type !== "withdraw") continue;
    const want = o.action.army;
    const idx = s.armies.findIndex((x) => x.id === want && x.faction === o.faction);
    if (idx < 0) continue;
    const army = s.armies[idx];
    const kept = Math.round(army.troops * P.siegeWithdrawKeep);
    s.armies.splice(idx, 1);
    returnHome(s, army, kept);
    log(s, { kind: "siege-lift", faction: o.faction,
             text: `自 ${army.target} 撤围，携 ${kept} 人退回 ${army.home}` });
  }

  // ── 阶段六：征伐 ──────────────────────────────────────────────────
  // 三种情形，按目标郡当下的态势分流：
  //   目标有敌方围城军 → 野战（解围，或击破他人的围城军去抢这座城）
  //   目标已有己方围城军 → 增兵
  //   否则               → 新起围城
  // 同一目标被多方同时进攻时按「投入降序、势力 id 升序」定先后，而非数组顺序。
  const campaigns = accepted
    .filter((o) => o.action.type === "campaign")
    .map((o, i) => {
      const a = o.action as Extract<Order["action"], { type: "campaign" }>;
      const src = s.commanderies[a.from];
      // 起兵郡若有待命军团，整建制出征；否则按兵力档从郡守军抽调
      const ready = s.armies.find((x) => x.faction === o.faction && x.at === a.from && !x.target);
      const troops = ready ? ready.troops : Math.floor(src.garrison * P.strengthRatio[a.strength]);
      return { o, a, troops, ready, seq: i };
    })
    .sort((x, y) => y.troops - x.troops || x.o.faction.localeCompare(y.o.faction)
                 || x.a.target.localeCompare(y.a.target));

  for (const [i, c] of campaigns.entries()) {
    const { o, a, troops, ready } = c;
    const src = s.commanderies[a.from];
    const tgt = s.commanderies[a.target];
    if (!tgt) continue;
    if (troops <= 0) continue;
    if (!ready && src.garrison < troops) continue;

    // 攻城判定在阶段七统一做，这里只需要野战用的地形
    const terrain = (g.adj.get(a.from) ?? []).find((e) => e.to === a.target)?.terrain ?? "plain";
    const lead = roster ? governorOf(s, roster, a.from) : null;

    // 出兵：要么带走待命军团，要么从郡守军抽调
    if (ready) {
      s.armies = s.armies.filter((x) => x.id !== ready.id);
    } else {
      src.garrison -= troops;
    }
    // 器械随军出征，本郡即刻回到无械状态：它是一次性的投入，不是永久加成
    const gear = src.gear;
    src.gear = "none";

    const besiegers = s.armies.filter((x) => x.target === a.target && x.faction !== o.faction);
    if (besiegers.length) {
      // 野战：先解决城下的敌军，城墙的事之后再说
      const foe = [...besiegers].sort((x, y) => y.troops - x.troops
        || x.faction.localeCompare(y.faction))[0];
      const won = fieldBattle(s, P, roster, {
        atkFaction: o.faction, atkTroops: troops, atkLead: lead,
        foe, at: a.target, terrain, seq: i, from: a.from, atkUnit: src.unit,
      });
      if (won && tgt.owner !== o.faction) {
        // 击退围城军后接手围城
        beginSiege(s, o.faction, a.from, a.target, won, a, lead, gear, src.unit);
      } else if (won) {
        // 解自家之围：残部入城为戍
        tgt.garrison += won;
        log(s, { kind: "relief", faction: o.faction, text: `${a.target} 解围，${won} 人入城` });
      }
      continue;
    }

    if (tgt.owner === o.faction) continue;              // 城已在手，无须再攻

    const mine = s.armies.find((x) => x.target === a.target && x.faction === o.faction);
    if (mine) {
      mine.troops += troops;
      log(s, { kind: "siege-reinforce", faction: o.faction,
               text: `增兵 ${a.target} 城下，共 ${mine.troops} 人` });
      continue;
    }
    beginSiege(s, o.faction, a.from, a.target, troops, a, lead, gear, src.unit);
  }

  // ── 阶段七：围城结算 ──────────────────────────────────────────────
  // 每季一结。围而不下则双方耗兵，但缺口逐季累加——
  // 这才让「围点打援」「围魏救赵」成为真选项，而不是攻城一击定胜负。
  const sieges = s.armies.filter((x) => x.target)
    .sort((x, y) => x.faction.localeCompare(y.faction) || x.target!.localeCompare(y.target!));
  for (const [i, army] of sieges.entries()) {
    const tgt = s.commanderies[army.target!];
    if (!tgt || tgt.owner === army.faction) { lift(s, army); continue; }

    const edge = (g.adj.get(army.home) ?? []).find((e) => e.to === army.target);
    const terrain = edge?.terrain ?? "plain";
    const atGate = (edge?.gates.length ?? 0) > 0;
    const lead = roster ? roster.byId.get(army.commander ?? "") ?? null : null;
    const atk = roster ? attackEffect(lead, P, terrain) : null;
    const def = roster ? defendEffect(governorOf(s, roster, army.target!), P) : null;

    const jitter = (1 - P.jitter) + roll({ seed: s.seed, year: s.year, season: s.season,
                                           faction: army.faction, event: "siege", seq: i }) * P.jitter * 2;
    const power = unitPower(P, army.unit, terrain, tgt.unit);
    const attack = army.troops * jitter * (atk?.attackMul ?? 1) * power;
    const persist = army.siegeSeasons * P.siegeBreachPerSeason;   // 围得越久缺口越大
    const { breach, hold } = breachCount(P, attack, tgt.garrison * unitGuard(P, tgt.unit),
                                         tgt.defense, army.gear, terrain, atGate,
                                         (atk?.breachBonus ?? 0) + persist, def?.holdBonus ?? 0);
    const who = {
      主将: atk?.note ?? "无主将", 守将: def?.note ?? "无守将", 围城季: army.siegeSeasons,
      我军: `${unitName(P, army.unit)}×${power.toFixed(2)}`,
      敌军: `${unitName(P, tgt.unit)}守`,
      器械: army.gear,
    };

    if (breach > hold) {
      const survivors = Math.max(1, Math.round(army.troops - tgt.garrison * P.captureSurvivalPenalty));
      const loser = tgt.owner;
      const caught = tgt.governor;
      if (caught) {
        s.capturedOfficers.push(caught);
        tgt.governor = null;
        log(s, { kind: "officer-captured", faction: army.faction,
                 text: `${army.target} 守将 ${roster?.byId.get(caught)?.name ?? caught} 被俘` });
      }
      if (loser) s.factions[army.faction].conquests += 1;   // 只捡无主之地不算进攻
      tgt.owner = army.faction;
      tgt.garrison = survivors;
      tgt.moraleTier = Math.max(1, tgt.moraleTier - 1);
      tgt.defense = Math.max(20, tgt.defense - 15);
      lift(s, army);
      log(s, { kind: "siege-win", faction: army.faction,
               text: `自 ${army.home} 取 ${army.target}${loser ? `（原属 ${loser}）` : "（无主）"}`,
               attribution: { 投入: army.troops, 缺口: breach, 可防守: hold,
                              城防: tgt.defense, 地形: terrain, ...who } });
      continue;
    }

    // 首季是强攻，代价高；此后转为围困，耗得慢但缺口逐季累加。
    // 两档必须分开：若首攻失利也只折损一成二还能赖在城下续攻，
    // 攻方成本骤降，一郡势力必被磨死——实测曹操出局率因此从 0% 跳到 37%。
    const assault = army.siegeSeasons === 0;
    army.troops = Math.round(army.troops * (1 - (assault ? P.failLossRatio : P.siegeAttackerLoss)));
    tgt.garrison = Math.max(200, Math.round(tgt.garrison * (1 - P.siegeDefenderLoss)));
    tgt.defense = Math.max(10, tgt.defense - P.siegeDefenseErosion);   // 掘壕破坏
    army.siegeSeasons += 1;
    if (army.siegeSeasons >= P.siegeMaxSeasons || army.troops < 500) {
      const kept = Math.round(army.troops * P.siegeWithdrawKeep);
      lift(s, army);
      returnHome(s, army, kept);
      log(s, { kind: "siege-abort", faction: army.faction,
               text: `围 ${army.target} ${army.siegeSeasons} 季不下，粮尽撤围，${kept} 人退回`,
               attribution: { 缺口: breach, 可防守: hold, ...who } });
    } else {
      log(s, { kind: "siege-hold", faction: army.faction,
               text: `${assault ? `强攻 ${army.target} 未克，折损后` : `围 ${army.target} 第 ${army.siegeSeasons} 季，`}`
                   + `余 ${army.troops} 人转为围困`,
               attribution: { 缺口: breach, 可防守: hold, ...who } });
    }
  }

  // ── 阶段八：补给与产出 ────────────────────────────────────────────
  // 无主郡国随纪元推进而豪强坐大，自守渐坚。这给「早取无主之地」一个时间
  // 价值——若无主地永远同价，抢占时机就不成其为决策，模型大可无限期地
  // 先把内政做满再扩张
  const growth = P.neutralGrowth[s.epoch] ?? 0;
  if (growth > 0) {
    for (const c of Object.values(s.commanderies)) {
      if (c.owner || s.armies.some((x) => x.target === c.id)) continue;
      c.garrison = Math.min(Math.round(c.garrison * (1 + growth)), P.garrisonCap);
    }
  }

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
      // 被围之城同样无产出。若照常补兵，守军逐季回血会把围城累加的缺口抵消掉，
      // 围困就永远推不动进度——那等于「持续围城」这条机制只会白耗攻方的兵
      if (s.armies.some((x) => x.target === c.id && x.faction !== f.id)) {
        log(s, { kind: "besieged", faction: f.id, text: `${c.id} 被围，本季无产出` });
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

  // 断粮的军团溃散（R28）。围城军身在敌境，若其后方走廊被切断，
  // 它就是一支没有补给的孤军——「绕后断粮」由此成为真战术。
  for (const army of [...s.armies]) {
    const reach = supplyReach(s, g, army.faction);
    const anchor = army.target ? army.home : army.at;
    if (reach.has(anchor)) continue;
    s.armies = s.armies.filter((x) => x.id !== army.id);
    log(s, { kind: "army-scattered", faction: army.faction,
             text: `${army.target ? `围 ${army.target} 之师` : `${army.at} 驻军`}后路断绝，粮尽溃散` });
  }

  // ── 阶段九：存亡与档位 ────────────────────────────────────────────
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
    // 档位按本局曾达到过的最高档记，冲高后回落不扣分。
    // 判据是州级的（控制州数 / 州治 / 是否夺自他方），不是郡数倍数——
    // 后者让「占十个散郡」与「占一整州」同分，扩张的方向性无从体现；
    // 且「郡数不低于开局」在第一季自动成立，等于白送保底档，
    // 与内容包明写的「存续本身不得分」直接冲突
    const grade = gradeOf(standingOf(s, geo, f.id), {
      commanderies: f.startCommanderies,
      controlledZhou: f.startZhou,
      zhouSeats: f.startSeats,
    });
    if (GRADE_RANK[grade] > GRADE_RANK[f.bestGrade]) f.bestGrade = grade;
  }

  // 令数结转（MERS R9）。此前 FactionState.carried 全项目没有任何写入方，
  // 余令直接蒸发——而规则摘要里明写着「结转 ≤2」，等于在骗模型。
  // refreshAp 会读它并在下季清零
  for (const f of Object.values(s.factions)) {
    f.carried = Math.max(0, Math.min(P.carryCap, f.ap));
  }

  // ── 推进时钟与纪元 ────────────────────────────────────────────────
  s.turn += 1;
  s.season += 1;
  if (s.season > 4) { s.season = 1; s.year += 1; }

  // 纪元按包里的双触发推进：本纪元满时限，或已有势力达到本纪元的目标档。
  // 写死在固定季号上，纪元就只是个日历，与打法无关
  if (s.epoch < P.epochCount) {
    // 目标档不取丙：三十一个席位里总有人在第一季拿下一郡，
    // 纪元会在开局当季就跳进第二段，三段纪元几季内走完，等于没有
    const target: Grade = s.epoch === 1 ? "yi" : "jia";
    // 达标触发要设下限：公孙瓒这类只差一郡即控一州的席位第一季就能升乙，
    // 纪元会在开局当季跳段，三段纪元几季走完等于没有
    const reached = s.turn - s.epochStart >= P.epochMin
      && Object.values(s.factions).some((f) => GRADE_RANK[f.bestGrade] >= GRADE_RANK[target]);
    if (s.turn - s.epochStart >= P.epochLimit || reached) {
      s.epoch += 1;
      s.epochStart = s.turn;
      log(s, { kind: "epoch", text: `入第 ${s.epoch} 纪元`
        + `（${reached ? `已有势力达${GRADE_CN[target]}档` : "本纪元逾时"}）：`
        + `无主郡国守军每季自增 ${Math.round((P.neutralGrowth[s.epoch] ?? 0) * 100)}%` });
    }
  }
  if (s.turn >= P.seasonsPerGame) s.finished = true;

  return { state: s, rejected };
}
