// 从数据层构建开局状态。
//
// 数据全部来自 lib/game/data/，本模块不含任何硬编码的游戏数值——
// 数值改动只该发生在数据文件与内容包里。
import type { EngineParams } from "./params.ts";
import { rollRecruitPool, type Roster } from "./officers.ts";
import { standingOf, type Geography } from "./victory.ts";
import type { GameState, CommanderyState, FactionState, Formation, Grade }
  from "./types.ts";

export interface SetupData {
  commanderyState: { commanderies: Array<{
    id: string; name: string; factionId: string | null; control: string | null;
    yieldTier: number; garrison: number; moraleTier: number; defense: number;
  }> };
  scenario: { factions: Array<{ id: string; name: string; seat?: string }> };
  commanderies: Array<{ id: string; name: string }>;
  troopTypes: { commanderies: Array<{ id: string; unit: string }> };
}

export interface SetupOptions {
  seed: string;
  /** 武将名册。给出则开局把君主坐镇治所，其余席位留给任命 */
  roster?: Roster;
  /** 州与州治。开局态势由它算出，是此后一切档位判定的基准 */
  geo: Geography;
  year?: number;
  /** 只保留这些势力为可操作席位；其余转为规则驱动。不传则全部保留 */
  playable?: string[];
  /**
   * 本局季数。不传则用内容包里的默认值（16，评测口径）。
   * 对局界面给玩家选长局；纪元时限随之缩放，见 epochLimitFor
   */
  seasons?: number;
}

/**
 * 剧本里「无主」是一个占位标记，不是有治所、有政令的势力。
 * 若当成势力处理，它会拿到令数、会被算补给连通（十一个散落各处的郡
 * 自然全部断供），还会出现在缔盟候选里 —— 全是噪声。
 * 这里统一折成 owner = null。
 */
const PLACEHOLDER_FACTIONS = new Set(["wuzhu"]);

/** 初始阵型按兵种定：骑兵→鱼鳞、弓弩→鹤翼、步卒与水军→方圆 */
const INITIAL_FORMATION: Record<string, Formation> = {
  cavalry: "scale", archer: "wings", infantry: "square", navy: "square",
};

export function createGame(data: SetupData, opts: SetupOptions, P: EngineParams): GameState {
  const nameToId = new Map(data.commanderies.map((c) => [c.name, c.id]));
  const unitOf = new Map(data.troopTypes.commanderies.map((c) => [c.id, c.unit]));

  const commanderies: Record<string, CommanderyState> = {};
  for (const c of data.commanderyState.commanderies) {
    commanderies[c.id] = {
      id: c.id,
      owner: c.factionId && !PLACEHOLDER_FACTIONS.has(c.factionId) ? c.factionId : null,
      garrison: c.garrison,
      yieldTier: c.yieldTier,
      moraleTier: c.moraleTier,
      defense: c.defense,
      unit: unitOf.get(c.id) ?? "infantry",
      // 初始阵型由兵种定，确定且有由头：骑兵密阵突击、弓弩两翼展开、
      // 步卒与水军结圆自守。改阵是一条令，开局不替对局方排好
      formation: INITIAL_FORMATION[unitOf.get(c.id) ?? "infantry"] ?? "square",
      gear: "none",
      ordersThisSeason: 0,
    };
  }

  // 势力的治所：取剧本给的 seat，落不到具体郡则退回其辖下产出最高的郡
  const owned = new Map<string, string[]>();
  for (const c of Object.values(commanderies)) {
    if (c.owner) (owned.get(c.owner) ?? owned.set(c.owner, []).get(c.owner)!).push(c.id);
  }

  const factions: Record<string, FactionState> = {};
  for (const f of data.scenario.factions) {
    if (PLACEHOLDER_FACTIONS.has(f.id)) continue;
    const mine = owned.get(f.id) ?? [];
    let capital = f.seat ? nameToId.get(f.seat) ?? null : null;
    if (!capital || !mine.includes(capital)) {
      capital = mine.length
        ? mine.reduce((best, id) =>
            commanderies[id].yieldTier > commanderies[best].yieldTier ? id : best, mine[0])
        : null;
    }
    factions[f.id] = {
      id: f.id,
      capital,
      ap: 0,
      carried: 0,
      freeUsed: {},
      retired: false,
      startCommanderies: mine.length,
      startZhou: 0,
      startSeats: 0,
      conquests: 0,
      allyBanUntil: 0,
      gold: P.goldOn ? P.goldStart : 0,
      bestGrade: "ding" as Grade,
      eliminated: mine.length === 0,
      submittedTo: null,
    };
  }

  const state: GameState = {
    stations: {},
    seed: opts.seed,
    year: opts.year ?? 194,
    season: 1,
    turn: 0,
    epoch: 1,
    epochStart: 0,
    seasonsPerGame: opts.seasons ?? P.seasonsPerGame,
    winner: null,
    commanderies,
    factions,
    armies: [],
    treaties: [],
    passages: [],
    intel: {},
    capturedOfficers: [],
    captives: [],
    recruitPool: opts.roster ? rollRecruitPool(opts.roster, opts.seed, P.wildRecruitRatio) : [],
    log: [],
    finished: false,
  };

  // 开局态势要在君主就位前算好，它是此后一切档位判定的基准
  for (const f of Object.values(factions)) {
    const st = standingOf(state, opts.geo, f.id);
    f.startZhou = st.controlledZhou;
    f.startSeats = st.zhouSeats;
  }

  // 初始驻地：籍贯郡属本势力则驻籍贯，否则回治所。
  //
  // 首版是「只有君主坐镇治所，其余全空，交给 appoint」。那在一郡一将下尚可，
  // 但现在一郡可驻多人，全空意味着开局所有郡都只有龙套守将——
  // 二十六员将在名册里干看着，玩家得先花十几令把人一个个放出去。
  // 按籍贯落位既有史据（本地豪族守本乡），也让开局的「调兵遣将」
  // 成为一个有起点的决策，而不是从零排班。
  if (opts.roster) {
    for (const f of Object.values(factions)) {
      // 君主坐镇治所
      const lord = opts.roster.byId.get(f.id);
      if (lord && lord.faction === f.id && f.capital) state.stations[lord.id] = f.capital;
      for (const o of (opts.roster.byFaction.get(f.id) ?? [])
        .slice().sort((a, b) => a.id.localeCompare(b.id))) {
        if (state.stations[o.id]) continue;
        // **只按籍贯落位**：籍贯郡在己方治下才驻，否则转入待命，靠调任投放。
        //
        // 曾经把落不下的人一律堆到治所。那让大势力开局就满编——曹操二十四将
        // 全压在济阴一郡——而满编直接换成兵力上限与攻防加成。实测
        // 「开局郡数 ↔ 得分」的相关系数因此从 0.03 涨到 0.60，逼近
        // 「得分完全由开局决定」的红线，评测的区分度当场塌掉一半。
        // 现在人才的投放重新成为逐季的决策，而不是发牌时就分完。
        const at = o.home && commanderies[o.home]?.owner === f.id ? o.home : null;
        if (at) state.stations[o.id] = at;
      }
    }
  }
  for (const id of Object.keys(factions)) state.intel[id] = {};
  return refreshAp(state, P);
}

/** 季初重算令数。公式与上限来自内容包，不在此硬编码 */
export function refreshAp(state: GameState, P: EngineParams): GameState {
  const count = new Map<string, number>();
  for (const c of Object.values(state.commanderies)) {
    if (c.owner) count.set(c.owner, (count.get(c.owner) ?? 0) + 1);
  }
  const factions = { ...state.factions };
  for (const [id, f] of Object.entries(factions)) {
    const n = count.get(id) ?? 0;
    // 令数随疆域增长的形状。指数 0.5 即原来的 sqrt——
    // 28 郡只比 13 郡多两条令，于是大国守不住新占的边界，
    // 打下一座丢一座，长局停在均衡点上，永远没人能统一。
    // 那条刹车是为「压住滚雪球、让评测测得出模型强弱」装的，对 16 季是对的；
    // 但作为游戏，没有胜利条件的盘不成其为游戏。指数与上限因此都做成可调，
    // 具体取值由实测定（要「统一确实打得出来」），不是拍脑袋
    const base = Math.min(P.apBase + Math.floor(n ** P.apExp), P.apCap);
    factions[id] = { ...f, ap: base + Math.min(P.carryCap, f.carried), carried: 0, freeUsed: {} };
  }
  const commanderies = { ...state.commanderies };
  for (const [id, c] of Object.entries(commanderies)) {
    commanderies[id] = { ...c, ordersThisSeason: 0 };
  }
  return { ...state, factions, commanderies };
}
