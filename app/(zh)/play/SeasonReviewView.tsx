import { outcomeFor } from "@/lib/game/engine/season-outcome.ts";
import type { GameState } from "@/lib/game/engine/types.ts";
import { makeT, type Locale } from "@/lib/i18n";

export function SeasonReviewView({ game, faction, locale = "zh" }: {
  game: GameState; faction: string; locale?: Locale;
}) {
  const t = makeT(locale);
  const outcome = outcomeFor(game, faction);
  if (!outcome) return null;
  const capital = game.factions[faction]?.capital;
  const held = capital && game.commanderies[capital]?.owner === faction;
  // 郡名之间的分隔符跟着语言走：中文顿号，英文逗号
  const sep = locale === "zh" ? "、" : ", ";
  const list = (xs: string[]) => xs.join(sep) || t("outcome.none");
  return <div aria-label={t("outcome.aria")}>
    <p><b>{t("outcome.h", { turn: outcome.turn + 1 })}</b>
      {t("outcome.delta", { gained: list(outcome.gained), lost: list(outcome.lost) })}</p>
    <p>{t("outcome.gold", {
      delta: `${outcome.goldDelta >= 0 ? "+" : ""}${outcome.goldDelta}`,
    })}
      {capital
        ? t("outcome.capital", {
            name: capital,
            state: t(held ? "outcome.capital.held" : "outcome.capital.lost"),
          })
        : t("outcome.capital.none")}</p>
  </div>;
}
