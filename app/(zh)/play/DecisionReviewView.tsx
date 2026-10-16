import type { DecisionReview } from "@/lib/game/decision-review.ts";
import { makeT, type Locale } from "@/lib/i18n";

export function DecisionReviewView({ review, locale = "zh" }: {
  review: DecisionReview; locale?: Locale;
}) {
  const t = makeT(locale);
  return <section className="decision-review" aria-label={t("review.aria")}>
    <p><b>{t("review.h", { turn: review.turn + 1 })}</b></p>
    {review.checks.length > 0 && <ul className="warn-note">
      {review.checks.map((check, i) => <li key={i}>{check.text}</li>)}
    </ul>}
    <p>{t("review.note")}</p>
    <details>
      <summary>{t("review.summary", { n: review.commands.length })}</summary>
      {review.commands.length ? <ul>{review.commands.map((command, i) => <li key={i}>
        <b>{t(command.status === "admitted" ? "review.admitted" : "review.rejected")}</b>
        {locale === "zh" ? "：" : ": "}{command.label}
        {command.reason && (locale === "zh" ? `；${command.reason}` : `; ${command.reason}`)}
      </li>)}</ul> : <p>{t("review.empty")}</p>}
    </details>
  </section>;
}
