import { type Plan, parsePlan } from "./strategy-plan.ts";
import { validDecisionReview } from "./decision-review.ts";
import type { ModelSeatDeps, ModelTurnRecord } from "../arena/seat/model-seat.ts";
import { modelDecide } from "../arena/seat/model-seat.ts";
import { decideForPlay } from "./engine/bot.ts";
import { resolve } from "./engine/resolve.ts";
import { refreshAp } from "./engine/setup.ts";
import type { GameState, Order } from "./engine/types.ts";

/** 控制者与跨季记忆属于对局，切换观战视角不改变它们。 */
export interface PlaySession {
  human: string | null;
  modelOf: Record<string, string>;
  effort: "low" | "medium" | "high";
  callLimit: number;
  callsUsed: number;
  maxTokens: number;
  plans: Record<string, Plan>;
  drops: Record<string, ModelTurnRecord["admission"]["dropped"]>;
  records: ModelTurnRecord[];
  since: number;
}

export function newSession(human: string | null = "caocao"): PlaySession {
  return { human, modelOf: {}, effort: "low", callLimit: 32, callsUsed: 0,
    maxTokens: 8000, plans: {}, drops: {}, records: [], since: 0 };
}

export function modelSeats(s: GameState, session: PlaySession): string[] {
  return Object.keys(s.factions).sort().filter((id) => id !== session.human
    && !s.factions[id].eliminated && !s.factions[id].retired && session.modelOf[id]);
}

export function budgetMessage(s: GameState, session: PlaySession): string | null {
  const needed = modelSeats(s, session).length;
  const left = session.callLimit - session.callsUsed;
  return needed > left
    ? `本季需要 ${needed} 次模型决策，剩余 ${left} 次。已暂停，可增加额度或改用机器人。`
    : null;
}

export function validSession(v: PlaySession, s: GameState): boolean {
  return Boolean(v && (v.human === null || s.factions[v.human])
    && ["low", "medium", "high"].includes(v.effort)
    && Number.isInteger(v.callLimit) && v.callLimit >= 0 && v.callLimit <= 4096
    && Number.isInteger(v.callsUsed) && v.callsUsed >= 0 && v.callsUsed <= v.callLimit
    && [4000, 8000, 16000].includes(v.maxTokens)
    && v.modelOf && Object.entries(v.modelOf).every(([id, model]) => s.factions[id]
      && id !== v.human && typeof model === "string" && model.length > 0)
    && v.plans && Object.values(v.plans).every((plan) => parsePlan(plan) !== undefined)
    && v.drops && Object.values(v.drops).every((drops) => Array.isArray(drops))
    && Array.isArray(v.records) && v.records.every((r) => r && s.factions[r.seat]
      && typeof r.model === "string" && Number.isInteger(r.turn)
      && r.admission && Array.isArray(r.admission.admitted) && Array.isArray(r.admission.dropped)
      && (r.review === undefined || (validDecisionReview(r.review)
        && r.review.seat === r.seat && r.review.turn === r.turn)))
    && Number.isInteger(v.since) && v.since >= 0 && v.since <= s.log.length);
}

type SeasonDeps = Omit<ModelSeatDeps, "model">;

/** 调用前先落盘预留额度。刷新或失败也不会把已发出的调用额度退回来。 */
export async function advanceSeason(
  game: GameState, session: PlaySession, humanOrders: Order[], deps: SeasonDeps,
  onReserve: (reserved: PlaySession) => void,
  onDecision?: (seat: string, record: ModelTurnRecord) => void,
): Promise<{ game: GameState; session: PlaySession; rejected: ReturnType<typeof resolve>["rejected"] }> {
  if (game.finished) throw new Error("本局已经结束");
  const message = budgetMessage(game, session);
  if (message) throw new Error(message);
  const modeled = modelSeats(game, session);
  const reserved = { ...session, callsUsed: session.callsUsed + modeled.length };
  onReserve(reserved);
  const results = await Promise.all(modeled.map(async (id) => {
    const result = await modelDecide(game, id, session.since, {
      ...deps, model: session.modelOf[id], reasoning: { effort: session.effort },
      limits: { maxTokens: session.maxTokens, maxTokensLimit: session.maxTokens,
        maxAttempts: 2, timeoutMs: 90000 },
    }, session.plans[id] ?? null, session.drops[id] ?? [],
    session.records.findLast(r => r.seat === id && r.turn === game.turn - 1)?.review ?? null);
    onDecision?.(id, result.record);
    return result;
  }));
  const orders = humanOrders.filter((o) => o.faction === session.human);
  for (const result of results) orders.push(...result.orders);
  const ids = Object.keys(game.factions).sort();
  for (const id of ids) {
    if (id === session.human || modeled.includes(id)
        || game.factions[id].eliminated || game.factions[id].retired) continue;
    orders.push(...decideForPlay(game, id, deps.g,
      deps.rules, deps.roster, deps.P, deps.geo));
  }
  const resolved = resolve(game, orders, deps.g, deps.P, deps.roster, deps.geo);
  const next: PlaySession = { ...reserved, plans: { ...session.plans },
    // 下一季要看本季新产生的战报，所以游标停在结算前的日志末尾。
    drops: { ...session.drops }, records: [...session.records], since: game.log.length };
  for (const { record } of results) {
    next.records.push(record);
    if (record.plan) next.plans[record.seat] = record.plan;
    next.drops[record.seat] = record.admission.dropped;
  }
  return { game: resolved.state.finished ? resolved.state : refreshAp(resolved.state, deps.P), session: next,
    rejected: resolved.rejected };
}
