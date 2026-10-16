import { planFeedback, type Plan } from "@/lib/game/strategy-plan.ts";
import type { GameState } from "@/lib/game/engine/types.ts";
import { makeT, type Locale } from "@/lib/i18n";

export function StrategyPlanView({ plan, game, faction, locale = "zh" }: {
  plan: Plan; game?: GameState; faction: string; locale?: Locale;
}) {
  const t = makeT(locale);
  if (typeof plan === "string") return <p>{t("plan.legacy", { text: plan })}</p>;
  const feedback = game ? planFeedback(game, faction, plan) : null;
  // status 与 stance 是**引擎给的 id**，显示名按语言取；拿 id 直接往页面上印
  // 就是英文界面上露出 `revise` 的那条老路
  const status = t(`plan.status.${plan.status}`);
  const stance = t(`plan.stance.${plan.stance}`);
  const own = feedback && (
    feedback.ownership === "global" ? t("plan.own.global")
    : feedback.ownership === "unknown-target" ? t("plan.own.unknown")
    : feedback.ownership === "own"
      ? t("plan.own.mine", { n: feedback.ownGarrison ?? 0 })
        + (feedback.underSiege ? t("plan.own.besieged") : "")
    : feedback.ownership === "neutral" ? t("plan.own.neutral") : t("plan.own.other"));
  return <div className="strategy-plan" aria-label={t("plan.aria")}>
    <p><b>{t("plan.objective")}</b>{plan.objective}</p>
    <p><b>{t("plan.target")}</b>{plan.target ?? t("plan.target.global")} · {stance}</p>
    <p><b>{t("plan.prep")}</b>{plan.preparation}</p>
    <p><b>{t("plan.abort")}</b>{plan.abortWhen}</p>
    <p><b>{t("plan.review")}</b>{plan.review}{t("plan.review.judged", { status })}</p>
    {feedback && <p><b>{t("plan.facts")}</b>
      {t("plan.facts.v", { lands: feedback.lands, gold: feedback.treasury })}
      {own}
      {feedback.ownArmies?.length ? t("plan.own.marching", { n: feedback.ownArmies.length }) : ""}</p>}
  </div>;
}
