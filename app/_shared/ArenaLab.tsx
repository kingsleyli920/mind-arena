"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ARENA_PROTOCOL_VERSION,
  canConfigureMatch,
  createMatchId,
  normalizeSeed,
  type MatchMode,
  type MatchSpec,
  type MatchStyle,
  type ModuleStatus,
} from "@/lib/arena/protocol";
import { makeT, type Locale } from "@/lib/i18n";

/**
 * 模块只留 **id 与画法**，文字全部按 `lab.game.<id>.*` 从目录取。
 *
 * 原先 title / description / statusLabel / decisionWindow 都写在这张表里，
 * 于是「加一种语言」等于把这张表再抄一份——而两份表改一份另一份不会报错，
 * 正是本仓库别处已经吃过亏的那个形状（见 tests/label-source.test.mjs）。
 * eyebrow 是刻意留下的：它本来就是英文标签，两种语言下都一样。
 */
type Game = {
  id: string;
  eyebrow: string;
  status: ModuleStatus;
  accent: string;
};

const games: Game[] = [
  { id: "01", eyebrow: "GRAND STRATEGY",    status: "prototype", accent: "amber" },
  { id: "02", eyebrow: "REAL-TIME TACTICS", status: "research",  accent: "cyan" },
  { id: "03", eyebrow: "SPORTS MANAGER",    status: "planned",   accent: "lime" },
  { id: "04", eyebrow: "POSSESSION GAME",   status: "planned",   accent: "rose" },
];

const fallbackModels = ["deepseek/deepseek-chat-v3.1", "qwen/qwen3-max", "moonshotai/kimi-k2.5"];

export function ArenaLab({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  const [selectedId, setSelectedId] = useState("01");
  const [mode, setMode] = useState<MatchMode>("model-v-model");
  const [style, setStyle] = useState<MatchStyle>("benchmark");
  const [models, setModels] = useState(fallbackModels);
  const [modelA, setModelA] = useState(fallbackModels[0]);
  const [modelB, setModelB] = useState(fallbackModels[1]);
  /**
   * 模型目录那一行的状态。存 **key**，不存成句的文字，也不在这里取文案。
   *
   * 存成句子的话，语言一换这一行就停在上一种语言上，直到下一次请求回来才改口。
   * 而把 `t` 搬进取数据的 effect 里同样不行：那会让 effect 依赖语言，换个语言
   * 就重新请求一次模型目录——语言是显示的事，不该牵动网络。
   */
  const [modelStatus, setModelStatus] =
    useState<{ key: string; count?: number; authKey?: string }>({ key: "lab.models.loading" });
  const [seed, setSeed] = useState("xingping-194-001");
  const [prepared, setPrepared] = useState<MatchSpec | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedId) ?? games[0],
    [selectedId],
  );
  const configurable = canConfigureMatch(selectedGame.status);
  /** 当前模块的文案。`lab.game.<id>.<什么>` */
  const g = (what: string) => t(`lab.game.${selectedGame.id}.${what}`);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/openrouter/models", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { data?: Array<{ id: string }>; count?: number; authenticated?: boolean };
        if (!response.ok || !payload.data?.length) throw new Error("model directory unavailable");
        const ids = payload.data.map((model) => model.id);
        setModels(ids);
        setModelA(ids[0]);
        setModelB(ids[1] ?? ids[0]);
        setModelStatus({
          key: "lab.models.ok",
          count: payload.count ?? ids.length,
          authKey: payload.authenticated ? "lab.models.auth.yes" : "lab.models.auth.no",
        });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setModelStatus({ key: "lab.models.fail" });
      });
    return () => controller.abort();
  }, []);

  function inspectGame(gameId: string) {
    setSelectedId(gameId);
    setPrepared(null);
    requestAnimationFrame(() => consoleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function submitMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configurable) return;

    setPrepared({
      gameId: selectedGame.id,
      mode,
      style,
      contenderA: mode === "human-v-model" ? "PLAYER 01" : modelA,
      contenderB: modelB,
      seed: normalizeSeed(seed),
    });
  }

  return (
    <section className="game-section" id="games">
      <div className="section-heading">
        <div>
          <p className="kicker">{t("lab.kicker")}</p>
          <h2>{t("lab.title")}</h2>
        </div>
        <p>{t("lab.lede")}</p>
      </div>

      <div className="game-grid">
        {games.map((game) => (
          <article className={`game-card ${game.accent} ${selectedId === game.id ? "selected" : ""}`} key={game.id}>
            <div className="card-meta"><span>{game.id}</span>
              <span>{t(`lab.game.${game.id}.status`)}</span></div>
            <div className="card-symbol" aria-hidden="true">{t(`lab.game.${game.id}.symbol`)}</div>
            <p className="card-eyebrow">{game.eyebrow}</p>
            <h3>{t(`lab.game.${game.id}.title`)}</h3>
            <p>{t(`lab.game.${game.id}.desc`)}</p>
            <button type="button"
              aria-label={t("lab.card.inspect.aria", { title: t(`lab.game.${game.id}.title`) })}
              onClick={() => inspectGame(game.id)}>
              {t(game.status === "prototype" ? "lab.card.configure" : "lab.card.roadmap")} <span>↗</span>
            </button>
          </article>
        ))}
      </div>

      <div className="match-console" ref={consoleRef} id="match-lab">
        <div className="console-summary">
          <div className="console-topline">
            <span>MATCH CONFIGURATOR</span>
            <span className={configurable ? "ready" : "planned"}>{configurable ? "OPENROUTER READY" : "ROADMAP"}</span>
          </div>
          <div className={`mini-symbol ${selectedGame.accent}`}>{g("symbol")}</div>
          <p className="card-eyebrow">MODULE {selectedGame.id} · {selectedGame.eyebrow}</p>
          <h3>{g("title")}</h3>
          <p>{g("desc")}</p>
          <dl className="module-facts">
            <div><dt>{t("lab.fact.window")}</dt><dd>{g("window")}</dd></div>
            <div><dt>{t("lab.fact.truth")}</dt><dd>{t("lab.fact.truth.v")}</dd></div>
            <div><dt>{t("lab.fact.replay")}</dt><dd>Replay JSON</dd></div>
          </dl>
        </div>

        <form className="match-form" onSubmit={submitMatch} aria-label={t("lab.form.aria", { title: g("title") })}>
          {!configurable ? (
            <div className="roadmap-notice">
              <span>MODULE {selectedGame.id}</span>
              <h4>{t("lab.notice.title")}</h4>
              <p>{t("lab.notice.body")}</p>
              <button type="button" onClick={() => inspectGame("01")}>
                {t("lab.notice.back")} <span>→</span></button>
            </div>
          ) : (
            <>
              <fieldset className="segmented-field">
                <legend>{t("lab.mode.legend")}</legend>
                <button type="button" className={mode === "model-v-model" ? "active" : ""}
                  onClick={() => setMode("model-v-model")}>{t("lab.mode.mvm")}</button>
                <button type="button" className={mode === "human-v-model" ? "active" : ""}
                  onClick={() => setMode("human-v-model")}>{t("lab.mode.hvm")}</button>
              </fieldset>

              <div className="contender-grid">
                <label>
                  <span>{t("lab.seat.a")}</span>
                  {mode === "human-v-model" ? (
                    <strong className="human-slot">PLAYER 01</strong>
                  ) : (
                    <select value={modelA} onChange={(event) => setModelA(event.target.value)} aria-label={t("lab.seat.a.aria")}>
                      {models.map((model) => <option key={model}>{model}</option>)}
                    </select>
                  )}
                </label>
                <b>VS</b>
                <label>
                  <span>{t("lab.seat.b")}</span>
                  <select value={modelB} onChange={(event) => setModelB(event.target.value)} aria-label={t("lab.seat.b.aria")}>
                    {models.map((model) => <option key={model}>{model}</option>)}
                  </select>
                </label>
              </div>

              <fieldset className="segmented-field compact">
                <legend>{t("lab.style.legend")}</legend>
                <button type="button" className={style === "benchmark" ? "active" : ""}
                  onClick={() => setStyle("benchmark")}>{t("lab.style.benchmark")}</button>
                <button type="button" className={style === "persona" ? "active" : ""}
                  onClick={() => setStyle("persona")}>{t("lab.style.persona")}</button>
              </fieldset>

              <label className="seed-field">
                <span>{t("lab.seed")}</span>
                <input value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="mind-arena-001" />
              </label>

              <button className="prepare-button" type="submit">
                {t("lab.submit")} <span>↗</span></button>
              <p className="connection-note">
                {t("lab.note", { status: t(modelStatus.key, {
                  count: modelStatus.count ?? 0,
                  auth: modelStatus.authKey ? t(modelStatus.authKey) : "",
                }) })}</p>

              {prepared ? (
                <output className="prepared-match" data-testid="prepared-match">
                  <span>CONFIG PREPARED · PROTOCOL {ARENA_PROTOCOL_VERSION}</span>
                  <strong>{createMatchId(prepared)}</strong>
                  <p>{prepared.contenderA} vs {prepared.contenderB} ·{" "}
                    {t(prepared.style === "benchmark" ? "lab.style.benchmark" : "lab.style.persona")}</p>
                  <ul>
                    <li>Seed: {prepared.seed}</li>
                    <li>{t("lab.prepared.same")}</li>
                    <li>{t("lab.prepared.replay")}</li>
                  </ul>
                  <Link className="launch-game" href="/game">
                    {t("lab.prepared.launch")} <span>→</span></Link>
                </output>
              ) : null}
            </>
          )}
        </form>
      </div>
    </section>
  );
}
