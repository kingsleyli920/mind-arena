// 从数据层构建开局状态。
//
// 数据全部来自 lib/game/data/，本模块不含任何硬编码的游戏数值——
// 数值改动只该发生在数据文件与内容包里。
import type { EngineParams } from "./params.ts";
import { rollRecruitPool, type Roster } from "./officers.ts";
import { standingOf, type Geography } from "./victory.ts";
import type { GameState, CommanderyState, FactionState, Grade } from "./types.ts";

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
}

/**
 * 剧本里「无主」是一个占位标记，不是有治所、有政令的势力。
 * 若当成势力处理，它会拿到令数、会被算补给连通（十一个散落各处的郡
 * 自然全部断供），还会出现在缔盟候选里 —— 全是噪声。
 * 这里统一折成 owner = null。
 */
const PLACEHOLDER_FACTIONS = new Set(["wuzhu"]);

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
      governor: null,
      unit: unitOf.get(c.id) ?? "infantry",
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
      bestGrade: "ding" as Grade,
      eliminated: mine.length === 0,
    };
  }

  const state: GameState = {
    seed: opts.seed,
    year: opts.year ?? 194,
    season: 1,
    turn: 0,
    epoch: 1,
    commanderies,
    factions,
    armies: [],
    treaties: [],
    passages: [],
    intel: {},
    capturedOfficers: [],
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

  // 君主坐镇治所。其余郡的太守空缺，交给 appoint —— 人事本身即决策，
  // 开局替模型排好班等于把这一层决策拿掉了。
  if (opts.roster) {
    for (const f of Object.values(factions)) {
      if (!f.capital) continue;
      const lord = opts.roster.byId.get(f.id);
      if (lord && lord.faction === f.id) commanderies[f.capital].governor = lord.id;
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
    const base = Math.min(P.apBase + Math.floor(Math.sqrt(n)), P.apCap);
    factions[id] = { ...f, ap: base + Math.min(P.carryCap, f.carried), carried: 0, freeUsed: {} };
  }
  const commanderies = { ...state.commanderies };
  for (const [id, c] of Object.entries(commanderies)) {
    commanderies[id] = { ...c, ordersThisSeason: 0 };
  }
  return { ...state, factions, commanderies };
}
