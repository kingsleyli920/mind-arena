import { budgetMessage, type PlaySession } from "@/lib/game/session.ts";
import type { GameState } from "@/lib/game/engine/types.ts";
import { StrategyPlanView } from "./StrategyPlanView";
import { SeasonReviewView } from "./SeasonReviewView";
import { DecisionReviewView } from "./DecisionReviewView";
import { makeT, type Locale } from "@/lib/i18n";

/*
 * 动作名**不在这里**。这里原先自己写了一份，和 panels.ts 的 TYPE_CN 三处不一样：
 * relief 作「解围」（那边与引擎的候选标签、eval-dissect 都是「赴援」）、
 * build 作「建设」（那边是「兴建」）、seize 作「夺据点」（那边是「取据点」）。
 * 一比四，这一份是孤例——而两份表改一份另一份不会报错。
 */
/* 丢弃原因与动作名都从文案目录取：`drop.<reason>` 与 `action.<type>` */

export function SessionPanel({ game, session, onChange, names, seat, onView, busy,
  autoPlay, onAutoPlay, onAdvance, error, locale = "zh" }: {
  game: GameState; session: PlaySession; onChange: (s: PlaySession) => void;
  names: Map<string, string>; seat: string; onView: (id: string) => void;
  busy: boolean; autoPlay: boolean; onAutoPlay: (v: boolean) => void;
  onAdvance: () => void; error: string | null; locale?: Locale;
}) {
  const t = makeT(locale);
  const spectator = session.human === null;
  const budget = budgetMessage(game, session);
  const models = Object.entries(session.modelOf);
  const latest = session.records.filter((r) => r.turn === game.turn - 1);
  const knownCost = session.records.reduce((sum, r) => sum + (r.usage?.cost ?? 0), 0);
  const unknownCost = session.callsUsed - session.records.filter((r) => r.usage?.cost != null).length;
  return (
    <section className="session-panel" aria-label={t("panel.aria")}>
      {spectator && <>
        <label>{t("panel.watch.seat")}
          <select value={seat} disabled={busy} onChange={(e) => onView(e.target.value)}>
            {Object.values(game.factions).map((f) => <option key={f.id} value={f.id}>
              {names.get(f.id) ?? f.id}
              {f.eliminated ? t("panel.seat.dead") : f.retired ? t("panel.seat.retired") : ""}
            </option>)}
          </select>
        </label>
        <div className="session-actions">
          <button onClick={onAdvance} disabled={busy || autoPlay || game.finished || Boolean(budget)}>{t("panel.advance")}</button>
          <button onClick={() => onAutoPlay(!autoPlay)}
            disabled={game.finished || (!autoPlay && (busy || Boolean(budget)))}>
            {t(autoPlay ? "panel.auto.off" : "panel.auto.on")}
          </button>
        </div>
        <p role="status">
          {t(busy ? "panel.status.busy" : autoPlay ? "panel.status.auto" : "panel.status.idle")}</p>
      </>}
      <p>{t("panel.calls", { models: models.length,
        used: session.callsUsed, limit: session.callLimit })}</p>
      {session.callsUsed > 0 && <p>{t("panel.cost", { usd: knownCost.toFixed(4) })}
        {unknownCost > 0 && t("panel.cost.unknown", { n: unknownCost })}</p>}
      {session.records.some((r) => r.attempts > 1) && <p>{t("panel.retried")}</p>}
      {(error || budget) && <p className="warn-note" role="alert">{error ?? budget}</p>}
      {budget && !busy && !game.finished && <div className="session-actions">
        <button disabled={session.callLimit >= 4096}
          onClick={() => onChange({ ...session, callLimit: Math.min(4096, session.callLimit + 16) })}>
          {t("panel.quota.add")}</button>
        <button onClick={() => onChange({ ...session, modelOf: {} })}>{t("panel.quota.bots")}</button>
      </div>}
      <details>
        <summary>{t("panel.roster")}</summary>
        <ul className="session-roster">
          {Object.values(game.factions).map((f) => <li key={f.id}>
            <b>{names.get(f.id) ?? f.id}</b>
            <span>{session.human === f.id ? t("panel.role.human")
              : session.modelOf[f.id] ?? t("panel.role.bot")}</span>
            {session.plans[f.id] && <StrategyPlanView plan={session.plans[f.id]} game={game} faction={f.id} />}
          </li>)}
        </ul>
      </details>
      {latest.length > 0 && <details open>
        <summary>{t("panel.last", { n: latest.length })}</summary>
        {latest.map((r) => <article className="decision-record" key={`${r.turn}-${r.seat}`}>
          <b>{names.get(r.seat) ?? r.seat}</b><small>{r.model}</small>
          <p>{r.failure ?? r.reason ?? t("panel.no.reason")}</p>
          <p>{t("panel.adopted", { ok: r.admission.admitted.length, drop: r.admission.dropped.length })}
            {r.backupsUsed?.length ? t("panel.backups", { n: r.backupsUsed.length }) : ""}</p>
          <p>{t("panel.calls.detail", { attempts: r.attempts,
            secs: (r.elapsedMs / 1000).toFixed(1), max: r.maxTokens })}
            {r.usage?.cost != null
              ? t("panel.charged", { usd: r.usage.cost.toFixed(6) })
              : t("panel.charge.unknown")}</p>
          {r.plan && <StrategyPlanView plan={r.plan} faction={r.seat} />}
          {r.review && <DecisionReviewView review={r.review} />}
          <SeasonReviewView game={game} faction={r.seat} />
          {!r.review && r.planWarning && <p className="warn-note">{r.planWarning}</p>}
          {!r.review && r.admission.dropped.length > 0 && <ul>{r.admission.dropped.map((d, i) =>
            <li key={i}>
              {d.label ?? t(`action.${d.key.split(":")[0]}`) ?? t("panel.order")}
              {locale === "zh" ? "：" : ": "}
              {d.detail ?? t(`drop.${d.reason}`) ?? t("panel.drop.fallback")}</li>)}</ul>}
        </article>)}
      </details>}
    </section>
  );
}
