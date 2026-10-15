import { budgetMessage, type PlaySession } from "@/lib/game/session.ts";
import type { GameState } from "@/lib/game/engine/types.ts";
import { StrategyPlanView } from "./StrategyPlanView";
import { SeasonReviewView } from "./SeasonReviewView";
import { DecisionReviewView } from "./DecisionReviewView";

const actionNames: Record<string, string> = { campaign: "征伐", relief: "解围", appoint: "调任",
  build: "建设", govern: "内政", scout: "刺探", transfer: "调兵", muster: "集结", withdraw: "撤围",
  seize: "夺据点", submit: "劝降", suade: "招降", array: "改阵", ally: "外交", relocate: "迁治" };
const dropReasons: Record<string, string> = { duplicate: "重复选择同一命令", "unknown-key": "未识别的候选命令",
  "over-budget": "行动点不足", rejected: "命令未通过校验" };

export function SessionPanel({ game, session, onChange, names, seat, onView, busy,
  autoPlay, onAutoPlay, onAdvance, error }: {
  game: GameState; session: PlaySession; onChange: (s: PlaySession) => void;
  names: Map<string, string>; seat: string; onView: (id: string) => void;
  busy: boolean; autoPlay: boolean; onAutoPlay: (v: boolean) => void;
  onAdvance: () => void; error: string | null;
}) {
  const spectator = session.human === null;
  const budget = budgetMessage(game, session);
  const models = Object.entries(session.modelOf);
  const latest = session.records.filter((r) => r.turn === game.turn - 1);
  const knownCost = session.records.reduce((sum, r) => sum + (r.usage?.cost ?? 0), 0);
  const unknownCost = session.callsUsed - session.records.filter((r) => r.usage?.cost != null).length;
  return (
    <section className="session-panel" aria-label="对局控制">
      {spectator && <>
        <label>观察势力
          <select value={seat} disabled={busy} onChange={(e) => onView(e.target.value)}>
            {Object.values(game.factions).map((f) => <option key={f.id} value={f.id}>
              {names.get(f.id) ?? f.id}{f.eliminated ? "（已覆灭）" : f.retired ? "（已退出）" : ""}
            </option>)}
          </select>
        </label>
        <div className="session-actions">
          <button onClick={onAdvance} disabled={busy || autoPlay || game.finished || Boolean(budget)}>推进一季</button>
          <button onClick={() => onAutoPlay(!autoPlay)}
            disabled={game.finished || (!autoPlay && (busy || Boolean(budget)))}>
            {autoPlay ? "暂停观战" : "自动观战"}
          </button>
        </div>
        <p role="status">{busy ? "本季正在结算；暂停会在本季完成后生效。" : autoPlay ? "自动推进中" : "已暂停"}</p>
      </>}
      <p>{models.length} 个模型席位 · 已用 {session.callsUsed}/{session.callLimit} 次决策</p>
      {session.callsUsed > 0 && <p>已回报费用 ${knownCost.toFixed(4)}
        {unknownCost > 0 && `；另有 ${unknownCost} 次费用未确认（含中断或失败），总额可能更高。`}</p>}
      {session.records.some((r) => r.attempts > 1) && <p>发生过重试；超时尝试可能未回报费用，完整扣费以提供方账单为准。</p>}
      {(error || budget) && <p className="warn-note" role="alert">{error ?? budget}</p>}
      {budget && !busy && !game.finished && <div className="session-actions">
        <button disabled={session.callLimit >= 4096}
          onClick={() => onChange({ ...session, callLimit: Math.min(4096, session.callLimit + 16) })}>增加 16 次额度</button>
        <button onClick={() => onChange({ ...session, modelOf: {} })}>改为全机器人继续</button>
      </div>}
      <details>
        <summary>控制者与跨季方略</summary>
        <ul className="session-roster">
          {Object.values(game.factions).map((f) => <li key={f.id}>
            <b>{names.get(f.id) ?? f.id}</b>
            <span>{session.human === f.id ? "玩家" : session.modelOf[f.id] ?? "规则机器人"}</span>
            {session.plans[f.id] && <StrategyPlanView plan={session.plans[f.id]} game={game} faction={f.id} />}
          </li>)}
        </ul>
      </details>
      {latest.length > 0 && <details open>
        <summary>上季 AI 决策 · {latest.length} 席</summary>
        {latest.map((r) => <article className="decision-record" key={`${r.turn}-${r.seat}`}>
          <b>{names.get(r.seat) ?? r.seat}</b><small>{r.model}</small>
          <p>{r.failure ?? r.reason ?? "未提供决策说明"}</p>
          <p>采纳 {r.admission.admitted.length} 条，丢弃 {r.admission.dropped.length} 条
            {r.backupsUsed?.length ? `，其中备选补入 ${r.backupsUsed.length} 条` : ""}</p>
          <p>{r.attempts} 次请求 · {(r.elapsedMs / 1000).toFixed(1)} 秒 · 输出上限 {r.maxTokens}
            {r.usage?.cost != null ? ` · 实扣 $${r.usage.cost.toFixed(6)}` : " · 费用未确认"}</p>
          {r.plan && <StrategyPlanView plan={r.plan} faction={r.seat} />}
          {r.review && <DecisionReviewView review={r.review} />}
          <SeasonReviewView game={game} faction={r.seat} />
          {!r.review && r.planWarning && <p className="warn-note">{r.planWarning}</p>}
          {!r.review && r.admission.dropped.length > 0 && <ul>{r.admission.dropped.map((d, i) =>
            <li key={i}>{d.label ?? actionNames[d.key.split(":")[0]] ?? "命令"}：{d.detail ?? dropReasons[d.reason] ?? "未通过校验"}</li>)}</ul>}
        </article>)}
      </details>}
    </section>
  );
}
