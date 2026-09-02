// 确定性规则 AI。
//
// 用途不是"把游戏玩好"，而是**在接模型之前先把玩法的病暴露出来**。
// 因此关键不在强，而在于：
//   1. 完全确定 —— 同一状态必出同一决策，否则自对局的结论不可复现
//   2. 策略画像必须真的不同 —— 若"苟活流"和"进攻流"打出同样的结果，
//      要么是机器人没区分开，要么是玩法本身分不出高下。两者都必须查明
import { listActions, type Graph, type Rules, DEFAULT_RULES } from "./actions.ts";
import type { Candidate, FactionId, GameState, Order } from "./types.ts";

export type Profile = "turtle" | "balanced" | "aggressive" | "opportunist";

export const PROFILES: Record<Profile, string> = {
  turtle:      "苟活流：只内政不出兵，验证「存续本身不得分」是否真的成立",
  balanced:    "均衡流：先安内后攘外，兵力比 ≥1.4 才打",
  aggressive:  "进攻流：兵力比 ≥1.1 就打，内政只在民心告急时做",
  opportunist: "投机流：只打最弱的邻居，且优先无主之地",
};

/** 各画像对每类动作的偏好权重。数值本身无量纲，只用于排序 */
const WEIGHTS: Record<Profile, Record<string, number>> = {
  turtle:      { govern: 10, scout: 3, ally: 6, muster: 0, campaign: -100, passage: 2, retire: 0 },
  balanced:    { govern: 6, scout: 4, ally: 4, muster: 5, campaign: 7, passage: 2, retire: 0 },
  aggressive:  { govern: 2, scout: 5, ally: 1, muster: 8, campaign: 12, passage: 1, retire: 0 },
  opportunist: { govern: 4, scout: 6, ally: 5, muster: 4, campaign: 9, passage: 2, retire: 0 },
};

/** 从候选的 label 里取回攻防比。label 由 listActions 生成，格式稳定 */
function ratioOf(c: Candidate): number {
  const m = /比 ([\d.]+)/.exec(c.label);
  return m ? Number(m[1]) : 0;
}

const MIN_RATIO: Record<Profile, number> = {
  turtle: Infinity, balanced: 1.4, aggressive: 1.1, opportunist: 1.25,
};

/**
 * 为一个势力挑本季的命令。
 * 不含任何随机——同一 state 必得同一结果，自对局才可复现。
 */
export function decide(
  s: GameState, f: FactionId, g: Graph, profile: Profile, rules: Rules = DEFAULT_RULES,
): Order[] {
  const cands = listActions(s, f, g, rules);
  if (!cands.length) return [];
  const w = WEIGHTS[profile];
  const minRatio = MIN_RATIO[profile];

  const scored = cands.map((c) => {
    let score = w[c.action.type] ?? 0;
    if (c.action.type === "campaign") {
      const r = ratioOf(c);
      // 达不到该画像的出兵门槛就直接弃掉，而不是给低分——
      // 给低分会让它在无仗可打时仍被选中，那是"被迫送死"而非策略
      if (r < minRatio) return { c, score: -1e9 };
      score += (r - minRatio) * 6;
      // 投机流额外偏好无主之地：不树敌，扩张最快
      if (profile === "opportunist" && !s.commanderies[c.action.target]?.owner) score += 8;
      // 倾国投入风险高，只在优势明显时选
      if (c.action.strength === "allout") score += r >= minRatio + 0.5 ? 3 : -5;
    }
    if (c.action.type === "govern") {
      const at = s.commanderies[(c.action as { at: string }).at];
      if (at && at.moraleTier <= 2) score += 5;            // 民心告急优先
    }
    return { c, score };
  })
    .filter((x) => x.score > -1e8)
    // 同分时按 key 排序，保证确定性
    .sort((a, b) => b.score - a.score || a.c.key.localeCompare(b.c.key));

  // 按令数预算贪心取，免费动作不占预算但受 freeUses 限制
  const orders: Order[] = [];
  let ap = s.factions[f]?.ap ?? 0;
  const freeUsed: Record<string, number> = {};
  const touched = new Map<string, number>();               // 郡 → 本季已下令数

  for (const { c } of scored) {
    const a = c.action;
    if (c.cost > ap) continue;
    if (c.cost === 0) {
      const cap = rules.freeUses[a.type] ?? Infinity;
      if ((freeUsed[a.type] ?? 0) >= cap) continue;
      freeUsed[a.type] = (freeUsed[a.type] ?? 0) + 1;
    }
    // 本地模拟郡国令数配额，避免下出必被拒的命令
    const ids = a.type === "campaign" ? [a.from]
      : a.type === "muster" ? a.from
      : a.type === "govern" ? [a.at] : [];
    if (ids.some((id) => (touched.get(id) ?? s.commanderies[id]?.ordersThisSeason ?? 0)
                         >= rules.perCommanderyOrders)) continue;
    for (const id of ids) {
      touched.set(id, (touched.get(id) ?? s.commanderies[id]?.ordersThisSeason ?? 0) + 1);
    }
    ap -= c.cost;
    orders.push({ faction: f, action: a });
  }
  return orders;
}
