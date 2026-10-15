import type { FactionOutcome, GameState, SeasonOutcome } from "./types.ts";
import { cmp } from "./cmp.ts";

/** 对照季初与季末所有权，覆盖攻城、归附、劝降和归隐；不解析战报文字。 */
export function summarizeSeason(before: GameState, after: GameState): SeasonOutcome {
  const factions: Record<string, FactionOutcome> = {};
  for (const id of Object.keys(before.factions).sort(cmp)) {
    factions[id] = { gained: [], lost: [],
      goldDelta: Math.round(after.factions[id].gold) - Math.round(before.factions[id].gold) };
  }
  for (const id of Object.keys(before.commanderies).sort(cmp)) {
    const oldOwner = before.commanderies[id].owner;
    const newOwner = after.commanderies[id].owner;
    if (oldOwner === newOwner) continue;
    if (oldOwner) factions[oldOwner].lost.push(id);
    if (newOwner) factions[newOwner].gained.push(id);
  }
  return { turn: before.turn, factions };
}

/** 只取观察方账本；旧的或缺失的季报不冒充本季事实。 */
export function outcomeFor(s: GameState, faction: string) {
  const outcome = s.lastOutcome;
  const own = outcome?.factions[faction];
  if (!outcome || !own || outcome.turn !== s.turn - 1) return null;
  return { turn: outcome.turn, ...own };
}
