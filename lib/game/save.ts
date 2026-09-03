// 本地存档。
//
// 没有存档就不是一个可玩的游戏，只是一个 demo：十六季要坐一会儿，
// 刷新一下、误关一个标签页，整局就没了。
//
// 三条刻意的取舍：
//
// 1. **只存 GameState 与席位，不存派生量。** 候选表、简报、地图视角都能从
//    状态重算，存进去只会多一份会过期的副本——这个仓库已经为「两份真相」
//    栽过好几次。
// 2. **版本不合就丢，不迁移。** 引擎与内容包还在快速变，存档格式跟着变。
//    静默载入一个旧存档会得到一个规则对不上的局面，比丢档更坏。
// 3. **写入失败不能弄坏对局。** 隐私模式、配额满、被浏览器禁用都可能抛，
//    全部吞掉——存档是锦上添花，不该让人打不了游戏。
import type { GameState } from "./engine/types.ts";

const KEY = "mind-arena/play/v1";

/**
 * 存档格式版本。**改动 GameState 的形状就必须 +1**——
 * 加字段（stations、allyBanUntil…）、改语义都算。
 * 旧档会被直接丢弃并提示重开，不做迁移。
 */
export const SAVE_VERSION = 4;

export interface SavedGame {
  version: number;
  /** 引擎数据包的指纹。内容包一改，旧档的规则就对不上 */
  packStamp: string;
  seat: string;
  game: GameState;
  /** 本季已勾选但尚未封令的候选 key。中途关掉不该连这一季的思考也丢掉 */
  picked: string[];
  savedAt: number;
}

/** 内容包指纹：纪元数 × 一局季数 × 郡国数，够区分「规则换了」 */
export function packStamp(seasonsPerGame: number, commanderies: number, epochs: number): string {
  return `${seasonsPerGame}-${commanderies}-${epochs}`;
}

export function save(v: Omit<SavedGame, "version" | "savedAt">): void {
  try {
    const payload: SavedGame = { ...v, version: SAVE_VERSION, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // 配额满 / 隐私模式 / 被禁用：存不下就算了，不能因此打断对局
  }
}

export function load(stamp: string): SavedGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedGame;
    if (v.version !== SAVE_VERSION || v.packStamp !== stamp) return null;
    // 最低限度的结构校验：缺了这几样就不是一个能跑的局面
    if (!v.seat || !v.game?.commanderies || !v.game?.factions || v.game.turn == null) return null;
    return v;
  } catch {
    return null;
  }
}

export function clear(): void {
  try { localStorage.removeItem(KEY); } catch { /* 同上 */ }
}
