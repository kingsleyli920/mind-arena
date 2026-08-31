"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HistoricalMap } from "./HistoricalMap";
import { MapSiteIcon } from "./MapSiteIcon";
import { HISTORICAL_PLACES, getHistoricalPlace, projectLongitudeLatitude } from "@/lib/game/historical-map";
import { buildRenderedRoads, isCityVisible, layoutCityLabels, smoothRoadPath } from "@/lib/game/map-rendering";
import { countExternalControllers, findDuplicateModelIds } from "@/lib/game/controller-assignment";
import {
  FACTIONS,
  ROUTES,
  STRATEGIC_SEATS,
  actionKey,
  actionLabel,
  chooseLocalAction,
  createAgentObservation,
  createStrategyGame,
  getCurrentSeason,
  getFactionDefinition,
  getFactionState,
  getLegalActions,
  getOwnedCities,
  resolveStrategyRound,
  type FactionId,
  type PlannedOrder,
  type StrategyAction,
  type StrategyState,
} from "@/lib/game/strategy";

type ModelOption = { id: string; name: string };
type ControllerMap = Record<FactionId, string>;

const localControllers = Object.fromEntries(FACTIONS.map((faction) => [faction.id, "local"])) as ControllerMap;

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function factionMeta(id: FactionId) {
  return getFactionDefinition(id);
}

function placeKindLabel(kind: string) {
  return ({ "province-seat": "州治", "commandery-seat": "郡国治所", "county-seat": "县城", settlement: "聚落", village: "村寨", stronghold: "堡寨", battlefield: "古战场", gate: "关隘", port: "港口", crossing: "渡口" } as Record<string, string>)[kind] ?? "据点";
}

function certaintyLabel(certainty: string) {
  return ({ attested: "史料/遗址可证", "located-approx": "位置约定", "scenario-inferred": "剧本推定", "game-abstract": "玩法抽象" } as Record<string, string>)[certainty] ?? certainty;
}

function actionCost(game: StrategyState, action: StrategyAction): string {
  if (action.type === "develop") return "18 金 · 增城防与民心";
  if (action.type === "recruit") return "24 粮 · 12 金 · 民心 -8";
  if (action.type === "appease") return "10 金 · 恢复民心军心";
  const route = ROUTES.find((candidate) => candidate.id === [action.sourceId, action.targetId].sort().join("--"));
  return `${route?.grainCost ?? "?"} 粮 · 派出 56% 守军`;
}

export function StrategyGame() {
  const [game, setGame] = useState<StrategyState | null>(null);
  const [playerFaction, setPlayerFaction] = useState<FactionId>("cao");
  const [controlMode, setControlMode] = useState<"intervene" | "observe">("intervene");
  const [humanFactionId, setHumanFactionId] = useState<FactionId | null>(null);
  const [focusFactionId, setFocusFactionId] = useState<FactionId>("cao");
  const [zoom, setZoom] = useState<1 | 2 | 3>(1);
  const [autoRun, setAutoRun] = useState(false);
  const [seed, setSeed] = useState("xingping-194-001");
  const [controllers, setControllers] = useState<ControllerMap>(localControllers);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelStatus, setModelStatus] = useState("正在读取 OpenRouter 模型目录…");
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedContextPlaceId, setSelectedContextPlaceId] = useState<string | null>(null);
  const [plannedAction, setPlannedAction] = useState<StrategyAction | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolutionOrders, setResolutionOrders] = useState<PlannedOrder[]>([]);
  const [agentNote, setAgentNote] = useState("等待开局");
  const [commandPanelOpen, setCommandPanelOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [mapDragging, setMapDragging] = useState(false);
  const [mapWindow, setMapWindow] = useState({ left: 0, top: 0, width: 100, height: 100 });
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const endTurnButtonRef = useRef<HTMLButtonElement>(null);
  const mapDragRef = useRef({ pointerId: -1, x: 0, y: 0, left: 0, top: 0 });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/openrouter/models", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { data?: ModelOption[]; count?: number; authenticated?: boolean; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "模型目录读取失败");
        setModels(payload.data ?? []);
        setModelStatus(`${payload.count ?? 0} 个文本模型 · ${payload.authenticated ? "API 已配置" : "需要配置 API Key 才能出手"}`);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setModelStatus(`目录暂不可用 · ${error.message}`);
      });
    return () => controller.abort();
  }, []);

  const selectedCity = useMemo(
    () => game?.cities.find((city) => city.id === selectedCityId) ?? null,
    [game, selectedCityId],
  );
  const selectedContextPlace = useMemo(
    () => HISTORICAL_PLACES.find((place) => place.id === selectedContextPlaceId && !place.operational) ?? null,
    [selectedContextPlaceId],
  );
  const selectedMapPoint = useMemo(() => {
    if (selectedCity) return { x: selectedCity.x, y: selectedCity.y };
    return selectedContextPlace ? projectLongitudeLatitude(selectedContextPlace.longitude, selectedContextPlace.latitude) : null;
  }, [selectedCity, selectedContextPlace]);
  const contextPlaces = useMemo(() => HISTORICAL_PLACES.filter((place) => !place.operational), []);
  const focusState = game ? getFactionState(game, focusFactionId) : null;
  const focusCities = game ? getOwnedCities(game, focusFactionId) : [];
  const renderedRoads = useMemo(() => game ? buildRenderedRoads(game.cities, ROUTES, zoom) : [], [game, zoom]);
  const cityLabelLayout = useMemo(() => game ? layoutCityLabels(game.cities, zoom) : [], [game, zoom]);
  const cityLabelById = useMemo(() => new Map(cityLabelLayout.map((layout) => [layout.id, layout])), [cityLabelLayout]);
  const inactiveControllerIds = useMemo(() => controlMode === "intervene" ? [playerFaction] : [], [controlMode, playerFaction]);
  const duplicateModelIds = useMemo(() => findDuplicateModelIds(controllers, inactiveControllerIds), [controllers, inactiveControllerIds]);
  const externalControllerCount = useMemo(() => countExternalControllers(controllers, inactiveControllerIds), [controllers, inactiveControllerIds]);

  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport || !selectedMapPoint) return;

    const timer = window.setTimeout(() => {
      const canvas = viewport.firstElementChild as HTMLElement | null;
      if (!canvas) return;
      const left = (selectedMapPoint.x / 100) * canvas.clientWidth - viewport.clientWidth / 2;
      const top = (selectedMapPoint.y / 100) * canvas.clientHeight - viewport.clientHeight / 2;
      viewport.scrollTo({
        left: Math.max(0, Math.min(left, canvas.clientWidth - viewport.clientWidth)),
        top: Math.max(0, Math.min(top, canvas.clientHeight - viewport.clientHeight)),
        behavior: "smooth",
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [selectedMapPoint, zoom]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const viewport = mapViewportRef.current;
      const canvas = viewport?.firstElementChild as HTMLElement | null;
      if (!viewport || !canvas) return;
      setMapWindow({
        left: (viewport.scrollLeft / Math.max(1, canvas.scrollWidth)) * 100,
        top: (viewport.scrollTop / Math.max(1, canvas.scrollHeight)) * 100,
        width: Math.min(100, (viewport.clientWidth / Math.max(1, canvas.scrollWidth)) * 100),
        height: Math.min(100, (viewport.clientHeight / Math.max(1, canvas.scrollHeight)) * 100),
      });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [zoom, game]);

  useEffect(() => {
    if (!autoRun || !game || humanFactionId || resolving || game.status !== "playing") return;
    const timer = window.setTimeout(() => endTurnButtonRef.current?.click(), 1400);
    return () => window.clearTimeout(timer);
  }, [autoRun, game, humanFactionId, resolving]);

  function startGame() {
    if (duplicateModelIds.size) {
      setModelStatus(`有 ${duplicateModelIds.size} 个模型被重复分配；每个外部模型只能统帅一路诸侯`);
      return;
    }
    const next = createStrategyGame(playerFaction, seed);
    setGame(next);
    setHumanFactionId(controlMode === "intervene" ? playerFaction : null);
    setFocusFactionId(playerFaction);
    setZoom(1);
    setAutoRun(controlMode === "observe");
    setSelectedCityId(next.cities.find((city) => city.owner === playerFaction)?.id ?? null);
    setSelectedContextPlaceId(null);
    setPlannedAction(null);
    setResolutionOrders([]);
    setAgentNote(controlMode === "intervene" ? "选择一座己方据点，下达本季唯一一道密令" : "全 AI 观战已开启；可随时选中据点并接管其势力");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }

  function planPlayerAction(action: StrategyAction) {
    if (!game || resolving) return;
    setPlannedAction(action);
    setAgentNote(`密令已拟定：${actionLabel(game, action)}。结算前仍可更改。`);
  }

  function syncMapWindow() {
    const viewport = mapViewportRef.current;
    const canvas = viewport?.firstElementChild as HTMLElement | null;
    if (!viewport || !canvas) return;
    setMapWindow({
      left: (viewport.scrollLeft / Math.max(1, canvas.scrollWidth)) * 100,
      top: (viewport.scrollTop / Math.max(1, canvas.scrollHeight)) * 100,
      width: Math.min(100, (viewport.clientWidth / Math.max(1, canvas.scrollWidth)) * 100),
      height: Math.min(100, (viewport.clientHeight / Math.max(1, canvas.scrollHeight)) * 100),
    });
  }

  function beginMapDrag(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = mapViewportRef.current;
    if (!viewport || (event.target as HTMLElement).closest("button")) return;
    mapDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    setMapDragging(true);
  }

  function moveMapDrag(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = mapViewportRef.current;
    const drag = mapDragRef.current;
    if (!viewport || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
    syncMapWindow();
  }

  function endMapDrag(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = mapViewportRef.current;
    if (mapDragRef.current.pointerId !== event.pointerId) return;
    if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    mapDragRef.current.pointerId = -1;
    setMapDragging(false);
  }

  function resetMapView() {
    const viewport = mapViewportRef.current;
    const canvas = viewport?.firstElementChild as HTMLElement | null;
    if (!viewport || !canvas) return;
    viewport.scrollTo({ left: Math.max(0, (canvas.scrollWidth - viewport.clientWidth) / 2), top: Math.max(0, (canvas.scrollHeight - viewport.clientHeight) / 2), behavior: "smooth" });
    window.setTimeout(syncMapWindow, 360);
  }

  async function endTurn() {
    if (!game || resolving || game.status !== "playing") return;
    setResolving(true);
    const snapshot = game;
    const orders: PlannedOrder[] = plannedAction && humanFactionId
      ? [{ factionId: humanFactionId, action: plannedAction, source: "player" }]
      : [];

    const aiFactions = FACTIONS.filter((faction) => faction.id !== humanFactionId && getOwnedCities(snapshot, faction.id).length);
    setAgentNote(`${aiFactions.length} 路诸侯正在并行拟定密令…`);
    const aiOrders = await mapWithConcurrency(aiFactions, 6, async (faction): Promise<PlannedOrder | null> => {
      const legal = getLegalActions(snapshot, faction.id);
      if (!legal.length) return null;
      const controller = controllers[faction.id];
      let action: StrategyAction | null = null;
      let source: PlannedOrder["source"] = "local-ai";
      let reason: string | undefined;
      let usageTotal: number | undefined;

      if (controller !== "local") {
        try {
          const response = await fetch("/api/openrouter/decide", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: controller, observation: createAgentObservation(snapshot, faction.id) }),
          });
          const payload = await response.json() as { decision?: { actionIndex?: number; reason?: string }; usage?: { total_tokens?: number }; error?: string };
          const index = payload.decision?.actionIndex;
          if (response.ok && Number.isInteger(index) && legal[Number(index)]) {
            action = legal[Number(index)];
            source = "openrouter";
            reason = payload.decision?.reason;
            usageTotal = payload.usage?.total_tokens;
          }
        } catch { /* Fall through to the deterministic local controller. */ }
      }

      action ??= chooseLocalAction(snapshot, faction.id);
      return action ? { factionId: faction.id, action, source, reason, controller: source === "openrouter" ? controller : "local", usageTotal } : null;
    });
    orders.push(...aiOrders.filter((order): order is PlannedOrder => order !== null));

    setResolutionOrders(orders);
    setAgentNote(`${orders.length} 道密令已公开：行军路线与内政落点正在沙盘上执行…`);
    await new Promise((resolve) => window.setTimeout(resolve, 980));
    const next = resolveStrategyRound(snapshot, orders);
    setGame(next);
    setPlannedAction(null);
    setResolutionOrders([]);
    setResolving(false);
    const selectedStillOwned = humanFactionId && next.cities.find((city) => city.id === selectedCityId)?.owner === humanFactionId;
    if (humanFactionId && !selectedStillOwned) setSelectedCityId(next.cities.find((city) => city.owner === humanFactionId)?.id ?? null);
    setAgentNote(next.status === "playing" ? `${next.year} 年${getCurrentSeason(next)} · ${humanFactionId ? "请下达新一季密令" : "全 AI 已完成本季，可继续推演或随时接管"}` : "对局结束");
  }

  if (!game) {
    return (
      <main className="setup-screen">
        <Link className="back-link" href="/">← 返回 Mind Arena</Link>
        <section className="setup-card">
          <header>
            <p>PLAYABLE VERTICAL SLICE · 194 WARLORDS</p>
            <h1>群雄沙盘</h1>
            <span>不是虚构大陆，也不是看板。选择一方进入兴平元年的中国，每季与其他统帅同时下令，争夺城池、粮道与天下要冲。</span>
          </header>

          <div className="setup-grid">
            <div>
              <h2>选择开局方式</h2>
              <div className="control-mode-picker" role="group" aria-label="开局控制方式">
                <button type="button" className={controlMode === "intervene" ? "selected" : ""} onClick={() => setControlMode("intervene")}>
                  <strong>我来入局</strong><span>选择一方亲自下令，其他势力由 AI 控制</span>
                </button>
                <button type="button" className={controlMode === "observe" ? "selected" : ""} onClick={() => setControlMode("observe")}>
                  <strong>全 AI 演义</strong><span>所有势力由 AI 推演，运行中可随时接管</span>
                </button>
              </div>
              <h2 className="faction-title">{controlMode === "intervene" ? "选择初始势力" : "选择初始观察席位"}</h2>
              <div className="faction-picker">
                {FACTIONS.map((faction) => (
                  <button
                    type="button"
                    key={faction.id}
                    className={playerFaction === faction.id ? "selected" : ""}
                    onClick={() => setPlayerFaction(faction.id)}
                    style={{ "--faction": faction.color } as CSSProperties}
                  >
                    <i />
                    <strong>{faction.name}<em>{faction.region}</em></strong>
                    <span>{faction.motto}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="controller-setup">
              <div className="controller-heading">
                <h2>配置全部十八路诸侯</h2>
                <span>{externalControllerCount} 路外部模型 · {modelStatus}</span>
              </div>
              <datalist id="openrouter-models">
                {models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}
              </datalist>
              <div className="controller-list">
                {FACTIONS.map((faction) => {
                  const controller = controllers[faction.id];
                  const conflicting = controller !== "local" && duplicateModelIds.has(controller.toLowerCase());
                  return (
                    <label key={faction.id} className={conflicting ? "controller-conflict" : ""}>
                      <span><i style={{ background: faction.color }} />{faction.name}<em>{faction.region}</em></span>
                      {controlMode === "intervene" && faction.id === playerFaction ? (
                        <strong>PLAYER · 你</strong>
                      ) : (
                        <input
                          list="openrouter-models"
                          value={controller === "local" ? "" : controller}
                          onChange={(event) => setControllers((current) => ({ ...current, [faction.id]: event.target.value.trim() || "local" }))}
                          placeholder="本地 AI，或唯一模型 ID"
                          aria-label={`${faction.name}统帅模型`}
                          aria-invalid={conflicting}
                        />
                      )}
                      {conflicting ? <small>此模型已被另一势力占用</small> : null}
                    </label>
                  );
                })}
              </div>
              <p className="minor-factions">全部十八路势力都可选择、接管或交还 AI。留空使用该势力自己的确定性本地策略；填写 OpenRouter 模型时，同一个精确模型 ID 只能分配给一路诸侯。</p>
            </div>
          </div>

          <footer className="setup-footer">
            <label><span>对局种子</span><input value={seed} onChange={(event) => setSeed(event.target.value)} /></label>
            <button type="button" onClick={startGame} disabled={duplicateModelIds.size > 0}>{duplicateModelIds.size ? "请先处理重复模型" : controlMode === "intervene" ? "进入兴平元年" : "观看群雄推演"} <span>↗</span></button>
          </footer>
          <p className="setup-note">留空使用内置策略 AI。填入 OpenRouter 模型 ID 后，该席位会在每季请求真实模型；模型失败或提交非法动作时自动回退，规则引擎始终拥有最终裁决权。</p>
        </section>
      </main>
    );
  }

  const meta = factionMeta(focusFactionId);
  const cityOwner = selectedCity ? factionMeta(selectedCity.owner) : null;
  const legalActions = selectedCity && humanFactionId && selectedCity.owner === humanFactionId
    ? getLegalActions(game, humanFactionId).filter((action) => action.sourceId === selectedCity.id)
    : [];

  return (
    <main className="game-shell" style={{ "--player-color": meta.color } as CSSProperties}>
      <header className="game-header">
        <Link href="/" className="game-brand"><b>MA</b><span>群雄沙盘<small>兴平元年 · 194 WARLORDS</small></span></Link>
        <div className="turn-block"><span>{game.year} 年 {getCurrentSeason(game)}</span><strong>{String(game.turn).padStart(2, "0")}</strong><small>/ {game.maxTurns}</small></div>
        <div className="resource-strip">
          <span>{meta.name} · 粮 <b>{focusState?.grain}</b></span>
          <span>金铢 <b>{focusState?.gold}</b></span>
          <span>威望 <b>{focusState?.prestige}</b></span>
          <span>信誉 <b>{focusState?.trust}</b></span>
          <span>据点 <b>{focusCities.length}/{game.cities.length}</b></span>
        </div>
        <div className="header-actions">
          <span className={humanFactionId ? "human-active" : "ai-active"}>{humanFactionId ? `玩家 · ${factionMeta(humanFactionId).name}` : "全 AI"}</span>
          <button className="header-tool" type="button" onClick={() => setCommandPanelOpen((current) => !current)}>{commandPanelOpen ? "收起军议" : "展开军议"}</button>
          <button className="new-game" type="button" onClick={() => setGame(null)}>重新开局</button>
        </div>
      </header>

      <div className={`game-layout ${commandPanelOpen ? "panel-open" : "panel-closed"}`}>
        <section className="map-stage" aria-label="194 年群雄割据中国沙盘地图">
          <div className="map-toolbar">
            <span>沙盘尺度</span>
            <button type="button" className={zoom === 1 ? "active" : ""} onClick={() => setZoom(1)}>天下</button>
            <button type="button" className={zoom === 2 ? "active" : ""} onClick={() => setZoom(2)}>州郡</button>
            <button type="button" className={zoom === 3 ? "active" : ""} onClick={() => setZoom(3)}>县 · 村 · 关港</button>
            <i className="toolbar-divider" />
            <button type="button" className="map-tool-button" onClick={() => setZoom((current) => Math.max(1, current - 1) as 1 | 2 | 3)} aria-label="缩小地图">−</button>
            <button type="button" className="map-tool-button" onClick={() => setZoom((current) => Math.min(3, current + 1) as 1 | 2 | 3)} aria-label="放大地图">＋</button>
            <button type="button" className="map-tool-reset" onClick={resetMapView}>归中</button>
            <b>{game.cities.length} 可争夺据点 · {HISTORICAL_PLACES.length} 处历史地点 · 拖拽地图移动</b>
          </div>
          <div
            className={`map-viewport ${mapDragging ? "dragging" : ""}`}
            ref={mapViewportRef}
            onScroll={syncMapWindow}
            onPointerDown={beginMapDrag}
            onPointerMove={moveMapDrag}
            onPointerUp={endMapDrag}
            onPointerCancel={endMapDrag}
          >
          <div className={`map-canvas zoom-${zoom}`}>
          <HistoricalMap zoom={zoom} cities={game.cities} />
          <svg className="route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {renderedRoads.map((road) => {
              const from = game.cities.find((city) => city.id === road.fromId);
              const to = game.cities.find((city) => city.id === road.toId);
              if (!from || !to) return null;
              const controlled = from.owner === to.owner;
              const path = smoothRoadPath(road);
              const routeClass = road.terrain === "大河" ? "river-route" : road.terrain === "山道" || road.terrain === "关隘" ? "mountain-route" : "land-route";
              return (
                <g key={road.id} className={`road-corridor ${routeClass} ${controlled ? "controlled" : "frontier"}`} data-from={road.fromId} data-to={road.toId}>
                  <title>{`${from.name}—${to.name}${road.routeNames.length ? ` · ${road.routeNames.join("、")}` : ""}`}</title>
                  <path d={path} className="road-shadow" />
                  <path d={path} className="road-surface" />
                  <path d={path} className="road-detail" />
                </g>
              );
            })}
          </svg>
          {resolutionOrders.length ? (
            <svg className="order-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="本季密令执行动画">
              {resolutionOrders.map((order) => {
                const source = game.cities.find((city) => city.id === order.action.sourceId);
                if (!source) return null;
                const color = factionMeta(order.factionId).color;
                if (order.action.type !== "march") {
                  return (
                    <g key={`${order.factionId}-${actionKey(order.action)}`} className="domestic-order" style={{ "--order-color": color } as CSSProperties}>
                      <circle cx={source.x} cy={source.y} r="2.4" />
                      <circle cx={source.x} cy={source.y} r="4.2" />
                    </g>
                  );
                }
                const marchAction = order.action;
                const target = game.cities.find((city) => city.id === marchAction.targetId);
                if (!target) return null;
                const path = `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
                return (
                  <g key={`${order.factionId}-${actionKey(order.action)}`} className="march-order" style={{ "--order-color": color } as CSSProperties}>
                    <path d={path} />
                    <circle r="1.1">
                      <animateMotion dur=".9s" repeatCount="indefinite" path={path} />
                    </circle>
                  </g>
                );
              })}
            </svg>
          ) : null}
          <svg className="label-leader-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {cityLabelLayout.filter((layout) => zoom !== 1 || (STRATEGIC_SEATS as readonly string[]).includes(layout.id) || layout.id === selectedCityId).map((layout) => {
              const displaced = Math.hypot(layout.anchorX - layout.labelX, layout.anchorY - layout.labelY) > 0.15;
              return displaced ? <line key={layout.id} x1={layout.anchorX} y1={layout.anchorY} x2={layout.labelX} y2={layout.labelY} /> : null;
            })}
          </svg>
          <div className="map-vignette" />
          {game.cities.map((city) => {
            const faction = factionMeta(city.owner);
            const selected = city.id === selectedCityId;
            const strategic = (STRATEGIC_SEATS as readonly string[]).includes(city.id);
            const place = getHistoricalPlace(city.id);
            if (!isCityVisible(city, zoom)) return null;
            const layout = cityLabelById.get(city.id);
            if (!layout) return null;
            return (
              <div className="city-map-item" key={city.id}>
                <button
                  type="button"
                  className={`city-site kind-${city.kind} rank-${place?.rank ?? 2} ${selected ? "selected" : ""}`}
                  style={{ left: `${city.x}%`, top: `${city.y}%`, "--city-color": faction.color } as CSSProperties}
                  onClick={() => { setSelectedContextPlaceId(null); setSelectedCityId(city.id); setFocusFactionId(city.owner); setCommandPanelOpen(true); }}
                  aria-label={`${city.name}${placeKindLabel(city.kind)}，${faction.name}控制`}
                >
                  <MapSiteIcon kind={city.kind} seal={faction.name.slice(0, 1)} />
                </button>
                {zoom !== 1 || strategic || selected ? <button
                  type="button"
                  data-city-id={city.id}
                  className={`city-marker kind-${city.kind} rank-${place?.rank ?? 2} ${selected ? "selected" : ""} ${city.owner === humanFactionId ? "friendly" : "enemy"} ${strategic ? "strategic" : ""}`}
                  style={{ left: `${layout.labelX}%`, top: `${layout.labelY}%`, "--city-color": faction.color } as CSSProperties}
                  onClick={() => { setSelectedContextPlaceId(null); setSelectedCityId(city.id); setFocusFactionId(city.owner); setCommandPanelOpen(true); }}
                  aria-label={`${city.name}，${faction.name}，兵力${city.troops}，民心${city.publicOrder}`}
                >
                  <span className="city-banner">{faction.name.slice(0, 1)}</span>
                  <strong>{city.name}</strong>
                  <small>{city.kind === "gate" ? "关" : city.kind === "port" ? "港" : city.kind === "crossing" ? "渡" : city.troops}</small>
                </button> : null}
              </div>
            );
          })}
          {contextPlaces.filter((place) => zoom === 3 || (zoom === 2 && place.rank <= 2)).map((place, index) => {
            const point = projectLongitudeLatitude(place.longitude, place.latitude);
            const selected = place.id === selectedContextPlaceId;
            return (
              <button
                type="button"
                key={place.id}
                data-context-id={place.id}
                className={`minor-site kind-${place.kind} rank-${place.rank} ${selected ? "selected" : ""} label-variant-${index % 4}`}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
                onClick={() => { setSelectedCityId(null); setSelectedContextPlaceId(place.id); setCommandPanelOpen(true); }}
                aria-label={`${place.name}，${placeKindLabel(place.kind)}，${place.historicalNote}`}
              >
                <MapSiteIcon kind={place.kind} minor />
                <span>{place.name}</span>
                <small>{placeKindLabel(place.kind)}</small>
              </button>
            );
          })}
          <div className="map-objective"><span>{zoom === 1 ? "州域总览" : zoom === 2 ? "郡国军略" : "县邑地形"}</span><strong>{zoom === 1 ? "州界、山河与十八路诸侯" : zoom === 2 ? "郡治、粮道、关塞与水运" : "县城 · 堡寨 · 村落 · 关隘 · 港口 · 渡口"}</strong></div>
          </div>
          </div>
          <div className="map-legend" aria-label="地图图例">
            <span><i className="legend-city" />城池</span><span><i className="legend-stronghold" />堡寨</span><span><i className="legend-village" />村落</span><span><i className="legend-gate" />关隘</span><span><i className="legend-port" />港口</span><span><i className="legend-crossing" />渡口</span>
          </div>
          <button type="button" className="map-minimap" onClick={resetMapView} aria-label="小地图，点击归中">
            <span className="minimap-land" />
            <i style={{ left: `${mapWindow.left}%`, top: `${mapWindow.top}%`, width: `${mapWindow.width}%`, height: `${mapWindow.height}%` }} />
            <b>天下舆图</b>
          </button>
          <button type="button" className="map-panel-toggle" onClick={() => setCommandPanelOpen((current) => !current)}>{commandPanelOpen ? "军议 ›" : "‹ 军议"}</button>
        </section>

        <aside className={`command-panel ${commandPanelOpen ? "open" : "closed"}`} aria-hidden={!commandPanelOpen}>
          <div className="command-head">
            <span>WAR COUNCIL · 季度密令</span>
            <i className={resolving ? "thinking" : ""} />
          </div>
          <div className="selected-city">
            {selectedContextPlace ? (
              <>
                <p className="context-kicker">舆图志 · {selectedContextPlace.province} · {placeKindLabel(selectedContextPlace.kind)}</p>
                <h2>{selectedContextPlace.name}</h2>
                <span className="historical-note">{selectedContextPlace.commandery} · 今 {selectedContextPlace.modernReference} · {certaintyLabel(selectedContextPlace.certainty)}<br />{selectedContextPlace.historicalNote}</span>
                <dl className="context-stats">
                  <div><dt>层级</dt><dd>{selectedContextPlace.rank === 1 ? "天下要地" : selectedContextPlace.rank === 2 ? "区域节点" : "地方节点"}</dd></div>
                  <div><dt>状态</dt><dd>舆图地标</dd></div>
                </dl>
                <p className="context-note">首版中作为道路、地貌和历史信息节点；后续可升级为屯田、伏击、补给或水军设施。</p>
              </>
            ) : selectedCity && cityOwner ? (
              <>
                <p style={{ color: cityOwner.color }}>{cityOwner.name} · {selectedCity.province} · {placeKindLabel(selectedCity.kind)}</p>
                <h2>{selectedCity.name}</h2>
                <span className="historical-note">{selectedCity.commandery} · 今 {selectedCity.modernReference} · {certaintyLabel(selectedCity.certainty)}<br />{selectedCity.historicalNote}</span>
                <dl>
                  <div><dt>兵力</dt><dd>{selectedCity.troops}</dd></div>
                  <div><dt>城防</dt><dd>{selectedCity.defense}</dd></div>
                  <div><dt>军心</dt><dd>{selectedCity.morale}</dd></div>
                  <div><dt>民心</dt><dd>{selectedCity.publicOrder}</dd></div>
                </dl>
                <div className="ruler-card">
                  <span>{cityOwner.leader.name} · 五维</span>
                  <b>统 {cityOwner.leader.leadership}</b><b>武 {cityOwner.leader.strength}</b><b>智 {cityOwner.leader.intelligence}</b><b>政 {cityOwner.leader.politics}</b><b>魅 {cityOwner.leader.charisma}</b>
                </div>
                <div className="control-transfer">
                  {humanFactionId === selectedCity.owner ? (
                    <button type="button" disabled={resolving} onClick={() => { setHumanFactionId(null); setAutoRun(false); setPlannedAction(null); setAgentNote(`${cityOwner.name}已交还 AI；现在是全 AI 观战。`); }}>交还 AI</button>
                  ) : (
                    <button type="button" disabled={resolving} onClick={() => { setHumanFactionId(selectedCity.owner); setAutoRun(false); setFocusFactionId(selectedCity.owner); setPlannedAction(null); setAgentNote(`你已接管${cityOwner.name}，从下一道密令开始亲自决策。`); }}>接管 {cityOwner.name}</button>
                  )}
                  <span>{humanFactionId ? `当前玩家：${factionMeta(humanFactionId).name}` : "当前：全部由 AI 运行"}</span>
                </div>
              </>
            ) : <p>从地图选择一座城池</p>}
          </div>

          <div className="action-list">
            <h3>本季只能封缄一道命令</h3>
            {selectedContextPlace ? (
              <p className="action-hint">这是细分历史地标，不单独结算季度命令。选择带势力旗帜的城池、关隘或港口下令。</p>
            ) : !humanFactionId ? (
              <p className="action-hint">当前为全 AI 观战。你可以继续结算，也可以在上方接管所选势力。</p>
            ) : selectedCity?.owner !== humanFactionId ? (
              <p className="action-hint">该据点不属于你当前接管的势力。可以直接接管其势力，或选择自己的据点下令。</p>
            ) : legalActions.length ? (
              legalActions.map((action) => (
                <button
                  type="button"
                  key={actionKey(action)}
                  className={plannedAction && actionKey(plannedAction) === actionKey(action) ? "planned" : ""}
                  disabled={resolving}
                  onClick={() => planPlayerAction(action)}
                >
                  <span>{action.type === "develop" ? "建" : action.type === "recruit" ? "兵" : action.type === "appease" ? "民" : "战"}</span>
                  <strong>{actionLabel(game, action)}</strong>
                  <small>{actionCost(game, action)}</small>
                </button>
              ))
            ) : <p className="action-hint">当前没有可执行命令。</p>}
          </div>

          <div className="agent-status"><span>COUNCIL STATUS</span><p>{agentNote}</p></div>
          {!humanFactionId ? (
            <button className={`auto-run ${autoRun ? "active" : ""}`} type="button" disabled={game.status !== "playing"} onClick={() => setAutoRun((current) => !current)}>
              {autoRun ? "暂停连续推演" : "开启连续推演"}<span>{autoRun ? "●" : "○"}</span>
            </button>
          ) : null}
          <button ref={endTurnButtonRef} className="end-turn" type="button" disabled={resolving || game.status !== "playing"} onClick={endTurn}>
            {resolving ? "诸侯密令结算中…" : plannedAction ? "封缄并结算本季" : humanFactionId ? "不下令，直接结算" : "单步推进一季"}<span>→</span>
          </button>
        </aside>
      </div>

      <section className={`replay-strip ${replayOpen ? "open" : "collapsed"}`} aria-label="对局事件回放">
        <header><span>军报 · REPLAY</span><b>{game.log.length} EVENTS</b><button type="button" onClick={() => setReplayOpen((current) => !current)}>{replayOpen ? "收起" : "展开"}</button></header>
        <div>
          {game.log.slice(-24).reverse().map((entry) => (
            <article key={entry.id}><span>T{String(entry.turn).padStart(2, "0")}</span><p>{entry.message}</p><small>{entry.source}</small></article>
          ))}
        </div>
      </section>

      {game.status !== "playing" ? (
        <div className="result-overlay">
          <div>
            <span>MATCH COMPLETE</span>
            <h2>{humanFactionId ? (game.winnerFactionId === humanFactionId ? "霸业已成" : "此局败北") : "演义终局"}</h2>
            <p>{factionMeta(game.winnerFactionId ?? game.playerFactionId).name}赢得本局。全部密令、合法性检查和结算结果仍保留在 Replay Feed 中。</p>
            <button type="button" onClick={() => setGame(null)}>再开一局</button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
