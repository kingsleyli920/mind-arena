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
export const SAVE_VERSION = 6;

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

/**
 * 内容包指纹。
 *
 * 此前是「一局季数 × 郡国数 × 纪元数」——那三个量**对任何规则常数的改动都无感**。
 * 于是加粮、加建筑、加行军、把围城上限从 3 改到 6，指纹一动不动，旧档静默载入到
 * 一套对不上的规则里：上一季本该收 0.35 的一击按旧规则结算过，这一季按新规则跑，
 * 同一支军团的两次结算用了两套价钱，而系统一个字的提示都没有。
 * SAVE_VERSION 是唯一的闸门，可它要人记得改——而「改语义也算」这句话写在注释里，
 * 靠的是自觉。
 *
 * 改成对 constants 求一个稳定摘要：任何数值常数一改，指纹就变，旧档自动作废。
 * 只取**数值**，不取说明文本——那些是给维护者的旁白，改它不该让玩家的存档失效。
 */
export function packStamp(
  seasonsPerGame: number, commanderies: number, epochs: number,
  constants?: Record<string, unknown>,
): string {
  const base = `${seasonsPerGame}-${commanderies}-${epochs}`;
  if (!constants) return base;
  const nums: string[] = [];
  for (const [g, kv] of Object.entries(constants)) {
    if (!kv || typeof kv !== "object") continue;
    for (const [k, v] of Object.entries(kv as Record<string, unknown>)) {
      if (typeof v === "number" || typeof v === "boolean") nums.push(`${g}.${k}=${v}`);
    }
  }
  nums.sort();
  // 32 位 FNV-1a：够短、够稳，且不依赖任何运行时库
  let h = 0x811c9dc5;
  for (const ch of nums.join(";")) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${base}-${h.toString(36)}`;
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
