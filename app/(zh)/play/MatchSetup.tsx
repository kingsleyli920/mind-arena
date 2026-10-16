import type { PlaySession } from "@/lib/game/session.ts";
import { VERIFIED_MODELS } from "@/lib/arena/verified-models.ts";
import { makeT, type Locale } from "@/lib/i18n";

export type ModelRow = { id: string; name: string; contextLength: number;
  promptPrice: string; completionPrice: string; structuredOutput: boolean };
export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export type SetupSeat = { id: string; name: string; lands: number };

export function MatchSetup({ session, onChange, seats, models, onLoadModels, error, onStart,
  locale = "zh" }: {
  session: PlaySession; onChange: (session: PlaySession) => void;
  seats: SetupSeat[]; models: ModelRow[]; onLoadModels: () => void;
  error: string | null; onStart: () => void; locale?: Locale;
}) {
  const t = makeT(locale);
  const count = Object.keys(session.modelOf).length;
  const names = new Map<string, string>([
    [DEFAULT_MODEL, t("setup.model.free")],
    ...VERIFIED_MODELS.map((m): [string, string] => [m.id, t("setup.model.verified", { label: m.label })]),
    ...models.map((m): [string, string] => [m.id, t("setup.model.price", {
      name: m.name,
      in: (Number(m.promptPrice) * 1e6).toFixed(2),
      out: (Number(m.completionPrice) * 1e6).toFixed(2),
    })]),
  ]);
  for (const id of Object.values(session.modelOf)) if (!names.has(id)) names.set(id, id);
  function control(id: string, kind: string) {
    const modelOf = { ...session.modelOf };
    delete modelOf[id];
    if (kind === "model") { modelOf[id] = DEFAULT_MODEL; onLoadModels(); }
    onChange({ ...session, modelOf,
      human: kind === "human" ? id : session.human === id ? null : session.human });
  }
  return (
    <section className="match-setup" aria-label={t("setup.aria")}>
      <h2>{t("setup.h")}</h2>
      <div className="setup-options">
        <label>{t("setup.join")}
          <select value={session.human ? "play" : "watch"} onChange={(e) => {
            const human = e.target.value === "watch" ? null : "caocao";
            const modelOf = { ...session.modelOf };
            if (human) delete modelOf[human];
            onChange({ ...session, human, modelOf });
          }}>
            <option value="play">{t("setup.join.play")}</option>
            <option value="watch">{t("setup.join.watch")}</option>
          </select>
        </label>
        <label>{t("setup.limit")}
          <select value={session.callLimit} onChange={(e) => onChange({ ...session, callLimit: Number(e.target.value) })}>
            {[4, 16, 32, 64, 128, 256].map((n) =>
              <option key={n} value={n}>{t("setup.limit.unit", { n })}</option>)}
          </select>
        </label>
        <label>{t("setup.maxtok")}
          <select value={session.maxTokens} onChange={(e) => onChange({ ...session, maxTokens: Number(e.target.value) })}>
            {[4000, 8000, 16000].map((n) =>
              <option key={n} value={n}>{t("setup.maxtok.unit", { n })}</option>)}
          </select>
        </label>
        <label>{t("setup.effort")}
          <select value={session.effort} onChange={(e) => onChange({ ...session, effort: e.target.value as PlaySession["effort"] })}>
            <option value="low">{t("setup.effort.low")}</option>
            <option value="medium">{t("setup.effort.medium")}</option>
            <option value="high">{t("setup.effort.high")}</option>
          </select>
        </label>
      </div>
      <p>{t("setup.note")}</p>
      <div className="controller-list">
        {seats.map((f) => (
          <div className="controller-row" key={f.id}>
            <span><b>{f.name}</b><small>{t("setup.lands", { n: f.lands })}</small></span>
            <select aria-label={t("setup.ctrl.aria", { name: f.name })}
              value={session.human === f.id ? "human" : session.modelOf[f.id] ? "model" : "bot"}
              onChange={(e) => control(f.id, e.target.value)}>
              <option value="bot">{t("setup.ctrl.bot")}</option>
              <option value="human">{t("setup.ctrl.human")}</option>
              <option value="model">{t("setup.ctrl.model")}</option>
            </select>
            {session.modelOf[f.id] && <select aria-label={t("setup.model.aria", { name: f.name })}
              value={session.modelOf[f.id]}
              onChange={(e) => onChange({ ...session, modelOf: { ...session.modelOf, [f.id]: e.target.value } })}>
              {[...names].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>}
          </div>
        ))}
      </div>
      {error && <p role="status">{t("setup.models.fail", { err: error })}</p>}
      <div className="setup-launch">
        <p>{session.human
          ? t("setup.will.play", {
              name: seats.find((f) => f.id === session.human)?.name ?? session.human })
          : t("setup.will.watch")}{locale === "zh" ? "。" : "."}
          {count ? t("setup.seats", { n: count, limit: session.callLimit })
            : t("setup.seats.none")}
          {count > 0 && <small>{t("setup.seats.fine")}</small>}
        </p>
        <button className="go" onClick={onStart}>
          {t(session.human ? "setup.go.play" : "setup.go.watch")}</button>
      </div>
    </section>
  );
}
