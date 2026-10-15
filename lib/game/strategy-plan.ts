import type { GameState } from "./engine/types.ts";
import { outcomeFor } from "./engine/season-outcome.ts";

export interface StrategyPlan {
  objective: string;
  target: string | null;
  stance: "attack" | "defend" | "develop";
  preparation: string;
  abortWhen: string;
  status: "continue" | "revise" | "complete";
  review: string;
}

/** 旧评测记录的文字方略仍可回放；新请求要求结构化计划。 */
export type Plan = StrategyPlan | string;
const limits = { objective: 80, preparation: 100, abortWhen: 100, review: 160 } as const;

export function parsePlan(value: unknown): Plan | undefined {
  if (typeof value === "string") return value.slice(0, 600);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const p = value as Record<string, unknown>;
  if (!["attack", "defend", "develop"].includes(String(p.stance))
      || !["continue", "revise", "complete"].includes(String(p.status))
      || !(p.target === null || (typeof p.target === "string" && p.target.length <= 40))
      || Object.keys(limits).some(k => typeof p[k] !== "string" || !(p[k] as string).trim())) return undefined;
  return { objective: (p.objective as string).slice(0, limits.objective),
    target: p.target as string | null, stance: p.stance as StrategyPlan["stance"],
    preparation: (p.preparation as string).slice(0, limits.preparation),
    abortWhen: (p.abortWhen as string).slice(0, limits.abortWhen),
    status: p.status as StrategyPlan["status"], review: (p.review as string).slice(0, limits.review) };
}

// 跨提供方采用共同支持的 schema 子集，长度在 parsePlan 中收紧。
export const strategyPlanSchema = {
  type: "object", additionalProperties: false,
  required: ["objective", "target", "stance", "preparation", "abortWhen", "status", "review"],
  properties: {
    objective: { type: "string", description: "阶段目标及可检查的完成条件" },
    target: { type: ["string", "null"], description: "主要目标郡的准确名称；无单一目标时为 null" },
    stance: { type: "string", enum: ["attack", "defend", "develop"] },
    preparation: { type: "string", description: "下一步需要的兵力、补给或侦察；满足后做什么" },
    abortWhen: { type: "string", description: "出现何种可观察条件时撤退或改目标" },
    status: { type: "string", enum: ["continue", "revise", "complete"] },
    review: { type: "string", description: "据本季观测和上季战报复核目标，说明继续、调整或完成的依据；首季写开局依据" },
  },
};

export interface PlanFeedback {
  target: string | null;
  ownership: "global" | "unknown-target" | "own" | "other" | "neutral";
  lands: number;
  treasury: number;
  owner?: string | null;
  ownGarrison?: number;
  underSiege?: boolean;
  ownArmies?: Array<{ troops: number; marchLeft: number; siegeSeasons: number }>;
}

/** 只提供己方兵力和公开归属，不替模型判定战略成功，也不泄露隐藏守军。 */
export function planFeedback(s: GameState, faction: string, plan: Plan | null): PlanFeedback | null {
  if (!plan || typeof plan === "string") return null;
  const base = { target: plan.target,
    lands: Object.values(s.commanderies).filter(c => c.owner === faction).length,
    treasury: Math.floor(s.factions[faction]?.gold ?? 0) };
  if (plan.target === null) return { ...base, ownership: "global" };
  const target = s.commanderies[plan.target];
  if (!target) return { ...base, ownership: "unknown-target" };
  return { ...base, target: target.id, owner: target.owner,
    ownership: target.owner === faction ? "own" : target.owner ? "other" : "neutral",
    ...(target.owner === faction ? { ownGarrison: target.garrison,
      underSiege: s.armies.some(a => a.target === target.id && a.faction !== faction && a.marchLeft === 0) } : {}),
    ownArmies: s.armies.filter(a => a.faction === faction && a.target === target.id)
      .map(a => ({ troops: a.troops, marchLeft: a.marchLeft, siegeSeasons: a.siegeSeasons })),
  };
}

/** 只重置由归属和上季净得失能确定已失效的旧目标。 */
export function planReset(s: GameState, faction: string, plan: Plan | null) {
  if (!plan || typeof plan === "string" || !plan.target) return null;
  const facts = planFeedback(s, faction, plan);
  if (plan.stance === "attack") {
    return facts?.ownership === "own" && !facts.underSiege
      ? { target: plan.target, reason: "旧进攻目标已属我方且未被围，请按当前局势重新制定阶段目标；归属变化发生在哪一季仍以战报为准。" }
      : null;
  }
  // 防守或发展目标刚净失，原来的守城／建设阶段已无法照旧执行。
  // 只用本方上季结算账本；旧失城或同季失而复得不能冒充本季失守。
  const lostLastSeason = outcomeFor(s, faction)?.lost.includes(plan.target) ?? false;
  return lostLastSeason && facts?.ownership !== "own"
    ? { target: plan.target, reason: "旧防守或发展目标上季净失且目前不属我方，请依据当前归属与战报重新制定阶段目标。" }
    : null;
}

export function formatPlan(plan: Plan): string {
  if (typeof plan === "string") return plan;
  return `目标：${plan.objective}；准备：${plan.preparation}；调整条件：${plan.abortWhen}；复核：${plan.review}`;
}
