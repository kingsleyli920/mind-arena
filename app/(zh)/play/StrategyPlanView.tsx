import { planFeedback, type Plan } from "@/lib/game/strategy-plan.ts";
import type { GameState } from "@/lib/game/engine/types.ts";

export function StrategyPlanView({ plan, game, faction }: { plan: Plan; game?: GameState; faction: string }) {
  if (typeof plan === "string") return <p>文字方略（旧格式）：{plan}</p>;
  const feedback = game ? planFeedback(game, faction, plan) : null;
  const status = { continue: "继续", revise: "调整", complete: "完成" }[plan.status];
  return <div className="strategy-plan" aria-label="跨季计划">
    <p><b>阶段目标：</b>{plan.objective}</p>
    <p><b>目标郡：</b>{plan.target ?? "全局"} · { { attack: "进攻", defend: "防守", develop: "发展" }[plan.stance] }</p>
    <p><b>准备条件：</b>{plan.preparation}</p>
    <p><b>撤退或调整条件：</b>{plan.abortWhen}</p>
    <p><b>本季复核：</b>{plan.review}（AI 判断：{status}）</p>
    {feedback && <p><b>当前事实：</b>{feedback.lands} 郡，国库 {feedback.treasury} 金。
      {feedback.ownership === "global" ? "全局计划，请结合战报复核"
      : feedback.ownership === "unknown-target" ? "目标郡无法识别，请在下季纠正"
      : feedback.ownership === "own" ? `目标属我方，驻军 ${feedback.ownGarrison} 人${feedback.underSiege ? "，正在被围" : ""}`
      : feedback.ownership === "neutral" ? "目标目前无主" : "目标仍属其他势力"}
      {feedback.ownArmies?.length ? `；有 ${feedback.ownArmies.length} 支我军正向该目标行动` : ""}</p>}
  </div>;
}
