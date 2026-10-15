import type { Candidate, GameState } from "./engine/types.ts";
import { planFeedback, planReset, type Plan } from "./strategy-plan.ts";

export interface DecisionReview {
  turn: number;
  seat: string;
  checks: Array<{ code: "target-owned" | "target-lost" | "unknown-target" | "status-stale" | "plan-warning" | "orders-dropped";
    text: string }>;
  commands: Array<{ key: string; label: string; status: "admitted" | "dropped"; reason?: string }>;
}

interface AdmissionReceipt {
  admitted: string[];
  dropped: Array<{ key: string; reason: string; detail?: string; label?: string }>;
}

const dropNames: Record<string, string> = { duplicate: "重复命令", "unknown-key": "候选中没有此命令",
  "over-budget": "行动点不足", rejected: "未通过命令校验" };

/** 只描述已提交的动作，不从 AI 的自然语言里猜它有没有兑现承诺。 */
function commandLabel(game: GameState, candidate: Candidate | undefined, fallback: string): string {
  const action = candidate?.action;
  if (!action) return fallback.slice(0, 100);
  switch (action.type) {
    case "campaign": return action.from === action.target ? `${action.from} 出城解围`
      : `自${action.from} 出兵至${action.target}（${{ skirmish: "偏师", main: "主力", allout: "倾国" }[action.strength]}）`;
    case "relocate": return `迁治至${action.to}`;
    case "withdraw": return `自${game.armies.find(a => a.id === action.army)?.target ?? "围城处"}撤军`;
    case "muster": return `于${action.at} 集结`;
    case "transfer": return `自${action.from} 调兵至${action.to}`;
    default: return candidate.label.slice(0, 100);
  }
}

/** 决策时的事实快照。只提示，不覆写计划，不拦截或追加模型调用。 */
export function reviewDecision(game: GameState, seat: string, plan: Plan | undefined,
  previous: Plan | null, candidates: readonly Candidate[], admission: AdmissionReceipt,
  planWarning?: string, backupsUsed: readonly string[] = []): DecisionReview {
  const checks: DecisionReview["checks"] = [];
  if (plan && typeof plan !== "string") {
    const facts = planFeedback(game, seat, plan);
    if (facts?.ownership === "unknown-target") checks.push({ code: "unknown-target",
      text: `目标郡“${plan.target}”无法识别，请重新选择。` });
    if (facts?.ownership === "own" && plan.stance === "attack" && plan.status !== "complete") {
      checks.push({ code: "target-owned", text: `决策时目标${plan.target}已属我方，请核对进攻目标与完成条件。` });
    }
    if (plan.stance !== "attack" && planReset(game, seat, plan)) {
      checks.push({ code: "target-lost", text: `目标${plan.target}上季净失且目前不属我方，原防守或发展阶段无法照旧执行。` });
    }
    if (previous && typeof previous !== "string" && plan.status === "continue"
        && (plan.target !== previous.target || plan.stance !== previous.stance
          || planReset(game, seat, previous))) {
      checks.push({ code: "status-stale", text: "主要目标、攻守方向或旧阶段的客观条件已改变，计划状态仍写“继续”，请复核。" });
    }
  }
  if (planWarning) checks.push({ code: "plan-warning", text: planWarning });
  const byKey = new Map(candidates.map(c => [c.key, c]));
  const backups = new Set(backupsUsed);
  const critical = new Set(["campaign", "relocate", "withdraw", "muster", "transfer", "seize"]);
  const blocked = admission.dropped.filter(d => critical.has(byKey.get(d.key)?.action.type ?? ""));
  if (blocked.length) checks.push({ code: "orders-dropped",
    text: `${blocked.length} 条出兵、迁治或兵力调动命令未获采纳，请按命令记录重新安排。` });
  return { turn: game.turn, seat, checks, commands: [
    ...admission.admitted.map(key => ({ key,
      label: `${commandLabel(game, byKey.get(key), key)}${backups.has(key) ? " · 备选补位" : ""}`,
      status: "admitted" as const })),
    ...admission.dropped.map(d => ({ key: d.key,
      label: commandLabel(game, byKey.get(d.key), d.label ?? d.key), status: "dropped" as const,
      reason: d.detail ?? dropNames[d.reason] ?? "未通过命令校验" })),
  ] };
}

/** 接收旧存档时字段可缺席；存在时校验结构，避免坏记录破坏下季输入与页面。 */
export function validDecisionReview(value: unknown): value is DecisionReview {
  if (!value || typeof value !== "object") return false;
  const r = value as DecisionReview;
  return Number.isInteger(r.turn) && r.turn >= 0 && typeof r.seat === "string"
    && Array.isArray(r.checks) && r.checks.length <= 6 && r.checks.every(c => c
      && ["target-owned", "target-lost", "unknown-target", "status-stale", "plan-warning", "orders-dropped"].includes(c.code)
      && typeof c.text === "string" && c.text.length <= 200)
    && Array.isArray(r.commands) && r.commands.length <= 16 && r.commands.every(c => c
      && typeof c.key === "string" && typeof c.label === "string"
      && ["admitted", "dropped"].includes(c.status)
      && (c.reason === undefined || typeof c.reason === "string"));
}

/** 只回传刚过去的一季、本席位的收据；旧记录不能冒充最近行动。 */
export function previousDecision(game: GameState, seat: string, review?: DecisionReview | null) {
  if (!review || !validDecisionReview(review) || review.seat !== seat || review.turn !== game.turn - 1) return null;
  return { turn: review.turn, checks: review.checks.map(c => c.text),
    admitted: review.commands.filter(c => c.status === "admitted").map(c => c.key),
    dropped: review.commands.filter(c => c.status === "dropped").map(c => ({ key: c.key, why: c.reason ?? "未采纳" })) };
}
