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

type Game = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  statusLabel: string;
  status: ModuleStatus;
  accent: string;
  symbol: string;
  decisionWindow: string;
};

const games: Game[] = [
  {
    id: "01",
    title: "群雄沙盘",
    eyebrow: "GRAND STRATEGY",
    description: "六路模型经营城池、调度粮草、缔结盟约，在同一张天下图上争夺最终话语权。",
    statusLabel: "首发原型",
    status: "prototype",
    accent: "amber",
    symbol: "将",
    decisionWindow: "每回合一次",
  },
  {
    id: "02",
    title: "塔防生存",
    eyebrow: "REAL-TIME TACTICS",
    description: "模型在固定决策窗口配置防线，规则引擎持续推进战场并记录每次判断。",
    statusLabel: "规则预研",
    status: "research",
    accent: "cyan",
    symbol: "塔",
    decisionWindow: "每 12 秒一次",
  },
  {
    id: "03",
    title: "足球教练",
    eyebrow: "SPORTS MANAGER",
    description: "阵型、换人、节奏与临场事件共同构成一场可复盘的模型教练对决。",
    statusLabel: "概念排期",
    status: "planned",
    accent: "lime",
    symbol: "⚽",
    decisionWindow: "比赛阶段切换",
  },
  {
    id: "04",
    title: "篮球战术",
    eyebrow: "POSSESSION GAME",
    description: "以回合和球权为最小单位，让模型安排轮换、战术与最后一攻。",
    statusLabel: "概念排期",
    status: "planned",
    accent: "rose",
    symbol: "24",
    decisionWindow: "每个球权一次",
  },
];

const fallbackModels = ["deepseek/deepseek-chat-v3.1", "qwen/qwen3-max", "moonshotai/kimi-k2.5"];

export function ArenaLab() {
  const [selectedId, setSelectedId] = useState("01");
  const [mode, setMode] = useState<MatchMode>("model-v-model");
  const [style, setStyle] = useState<MatchStyle>("benchmark");
  const [models, setModels] = useState(fallbackModels);
  const [modelA, setModelA] = useState(fallbackModels[0]);
  const [modelB, setModelB] = useState(fallbackModels[1]);
  const [modelStatus, setModelStatus] = useState("正在读取 OpenRouter 模型目录…");
  const [seed, setSeed] = useState("xingping-194-001");
  const [prepared, setPrepared] = useState<MatchSpec | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedId) ?? games[0],
    [selectedId],
  );
  const configurable = canConfigureMatch(selectedGame.status);

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
        setModelStatus(`${payload.count ?? ids.length} 个文本模型 · ${payload.authenticated ? "API 已配置" : "待配置 server-only key"}`);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setModelStatus("模型目录暂不可用 · 已显示常用回退选项");
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
          <p className="kicker">GAME MODULES</p>
          <h2>一套平台，四种战场</h2>
        </div>
        <p>首发只把“群雄沙盘”做深；其余游戏复用模型、回放、排行榜和验证能力。</p>
      </div>

      <div className="game-grid">
        {games.map((game) => (
          <article className={`game-card ${game.accent} ${selectedId === game.id ? "selected" : ""}`} key={game.id}>
            <div className="card-meta"><span>{game.id}</span><span>{game.statusLabel}</span></div>
            <div className="card-symbol" aria-hidden="true">{game.symbol}</div>
            <p className="card-eyebrow">{game.eyebrow}</p>
            <h3>{game.title}</h3>
            <p>{game.description}</p>
            <button type="button" aria-label={`查看${game.title}规划`} onClick={() => inspectGame(game.id)}>
              {game.status === "prototype" ? "配置首场对局" : "查看模块规划"} <span>↗</span>
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
          <div className={`mini-symbol ${selectedGame.accent}`}>{selectedGame.symbol}</div>
          <p className="card-eyebrow">MODULE {selectedGame.id} · {selectedGame.eyebrow}</p>
          <h3>{selectedGame.title}</h3>
          <p>{selectedGame.description}</p>
          <dl className="module-facts">
            <div><dt>决策窗口</dt><dd>{selectedGame.decisionWindow}</dd></div>
            <div><dt>规则真相</dt><dd>确定性引擎</dd></div>
            <div><dt>回放格式</dt><dd>Replay JSON</dd></div>
          </dl>
        </div>

        <form className="match-form" onSubmit={submitMatch} aria-label={`${selectedGame.title}对局配置`}>
          {!configurable ? (
            <div className="roadmap-notice">
              <span>MODULE {selectedGame.id}</span>
              <h4>保留在共享协议路线图中</h4>
              <p>先验证“群雄沙盘”的 Agent 对战闭环，再复用同一套模型适配器、回放和评测系统。</p>
              <button type="button" onClick={() => inspectGame("01")}>返回首发原型 <span>→</span></button>
            </div>
          ) : (
            <>
              <fieldset className="segmented-field">
                <legend>对战方式</legend>
                <button type="button" className={mode === "model-v-model" ? "active" : ""} onClick={() => setMode("model-v-model")}>模型 vs 模型</button>
                <button type="button" className={mode === "human-v-model" ? "active" : ""} onClick={() => setMode("human-v-model")}>玩家 vs 模型</button>
              </fieldset>

              <div className="contender-grid">
                <label>
                  <span>席位 A</span>
                  {mode === "human-v-model" ? (
                    <strong className="human-slot">PLAYER 01</strong>
                  ) : (
                    <select value={modelA} onChange={(event) => setModelA(event.target.value)} aria-label="席位 A 模型">
                      {models.map((model) => <option key={model}>{model}</option>)}
                    </select>
                  )}
                </label>
                <b>VS</b>
                <label>
                  <span>席位 B</span>
                  <select value={modelB} onChange={(event) => setModelB(event.target.value)} aria-label="席位 B 模型">
                    {models.map((model) => <option key={model}>{model}</option>)}
                  </select>
                </label>
              </div>

              <fieldset className="segmented-field compact">
                <legend>实验模式</legend>
                <button type="button" className={style === "benchmark" ? "active" : ""} onClick={() => setStyle("benchmark")}>公平基准</button>
                <button type="button" className={style === "persona" ? "active" : ""} onClick={() => setStyle("persona")}>人格娱乐</button>
              </fieldset>

              <label className="seed-field">
                <span>确定性种子</span>
                <input value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="mind-arena-001" />
              </label>

              <button className="prepare-button" type="submit">生成本地对局配置 <span>↗</span></button>
              <p className="connection-note">{modelStatus}。这里先预配两席；进入沙盘后可为六个主要势力分别绑定任意 OpenRouter 文本模型。</p>

              {prepared ? (
                <output className="prepared-match" data-testid="prepared-match">
                  <span>CONFIG PREPARED · PROTOCOL {ARENA_PROTOCOL_VERSION}</span>
                  <strong>{createMatchId(prepared)}</strong>
                  <p>{prepared.contenderA} vs {prepared.contenderB} · {prepared.style === "benchmark" ? "公平基准" : "人格娱乐"}</p>
                  <ul>
                    <li>Seed: {prepared.seed}</li>
                    <li>相同局势 / 相同动作预算</li>
                    <li>决策、校验与结算全部进入回放</li>
                  </ul>
                  <Link className="launch-game" href="/game">进入可玩沙盘 <span>→</span></Link>
                </output>
              ) : null}
            </>
          )}
        </form>
      </div>
    </section>
  );
}
