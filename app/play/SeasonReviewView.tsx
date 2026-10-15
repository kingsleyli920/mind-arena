import { outcomeFor } from "@/lib/game/engine/season-outcome.ts";
import type { GameState } from "@/lib/game/engine/types.ts";

export function SeasonReviewView({ game, faction }: { game: GameState; faction: string }) {
  const outcome = outcomeFor(game, faction);
  if (!outcome) return null;
  const capital = game.factions[faction]?.capital;
  const held = capital && game.commanderies[capital]?.owner === faction;
  return <div aria-label="实际结算复盘">
    <p><b>第 {outcome.turn + 1} 季实际变化：</b>
      新得 {outcome.gained.join("、") || "无"}；失去 {outcome.lost.join("、") || "无"}。</p>
    <p>国库净变化 {outcome.goldDelta >= 0 ? "+" : ""}{outcome.goldDelta} 金；
      当前治所 {capital ? `${capital}（${held ? "我方掌握" : "已失守"}）` : "未设"}。</p>
  </div>;
}
