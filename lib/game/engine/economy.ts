import type { EngineParams } from "./params.ts";
import type { FactionId, GameState } from "./types.ts";

/** 当前兵力的每季军费；屯田只减本郡守军费用，出征军团按全额。 */
export function upkeepFor(s: GameState, faction: FactionId, P: EngineParams): number {
  if (!P.goldOn) return 0;
  const armies = s.armies.filter((a) => a.faction === faction)
    .reduce((sum, a) => sum + a.troops, 0);
  const garrisons = Object.values(s.commanderies).filter((c) => c.owner === faction)
    .reduce((sum, c) => sum + c.garrison
      * (c.buildings.includes("farmstead") ? P.farmsteadUpkeepCut : 1), 0);
  return Math.round((armies + garrisons) * P.goldUpkeepPerTroop);
}
