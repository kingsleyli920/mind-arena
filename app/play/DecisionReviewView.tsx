import type { DecisionReview } from "@/lib/game/decision-review.ts";

export function DecisionReviewView({ review }: { review: DecisionReview }) {
  return <section className="decision-review" aria-label="计划与命令核对">
    <p><b>第 {review.turn + 1} 季计划与命令核对</b></p>
    {review.checks.length > 0 && <ul className="warn-note">
      {review.checks.map((check, i) => <li key={i}>{check.text}</li>)}
    </ul>}
    <p>以下是下令时的校验结果。采纳表示进入结算，实际战果见本季变化与战报。</p>
    <details>
      <summary>查看命令采纳记录 · {review.commands.length} 条</summary>
      {review.commands.length ? <ul>{review.commands.map((command, i) => <li key={i}>
        <b>{command.status === "admitted" ? "已采纳" : "未采纳"}</b>：{command.label}
        {command.reason && `；${command.reason}`}
      </li>)}</ul> : <p>本季未提交命令。</p>}
    </details>
  </section>;
}
