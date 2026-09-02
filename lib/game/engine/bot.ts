// 确定性规则 AI。
//
// 用途不是"把游戏玩好"，而是**在接模型之前先把玩法的病暴露出来**。
// 因此关键不在强，而在于：
//   1. 完全确定 —— 同一状态必出同一决策，否则自对局的结论不可复现
//   2. 策略画像必须真的不同 —— 若"苟活流"和"进攻流"打出同样的结果，
//      要么是机器人没区分开，要么是玩法本身分不出高下。两者都必须查明
import { listActions, type Graph, type Rules, DEFAULT_RULES } from "./actions.ts";
import type { EngineParams } from "./params.ts";
import type { Roster } from "./officers.ts";
import type { FactionId, GameState, Order } from "./types.ts";

export type Profile = "turtle" | "balanced" | "aggressive" | "opportunist";

export const PROFILES: Record<Profile, string> = {
  turtle:      "苟活流：只内政不出兵，验证「存续本身不得分」是否真的成立",
  balanced:    "均衡流：先安内后攘外，兵力比 ≥1.4 才打",
  aggressive:  "进攻流：兵力比 ≥1.1 就打，内政只在民心告急时做",
  opportunist: "投机流：只打最弱的邻居，且优先无主之地",
};

/** 各画像对每类动作的偏好权重。数值本身无量纲，只用于排序 */
const WEIGHTS: Record<Profile, Record<string, number>> = {
  turtle:      { govern: 10, scout: 3, ally: 6, muster: 0, campaign: -100, passage: 2, retire: 0, appoint: 9, withdraw: 11 },
  balanced:    { govern: 6, scout: 4, ally: 4, muster: 5, campaign: 7, passage: 2, retire: 0, appoint: 8, withdraw: 3 },
  aggressive:  { govern: 2, scout: 5, ally: 1, muster: 8, campaign: 12, passage: 1, retire: 0, appoint: 8, withdraw: 0 },
  opportunist: { govern: 4, scout: 6, ally: 5, muster: 4, campaign: 9, passage: 2, retire: 0, appoint: 7, withdraw: 5 },
};

/**
 * 出兵门槛，单位是「缺口余量」= 我方最少缺口 − 敌方最多可防守。
 * 大于 0 表示无论浮动与迷雾怎么走都破得了城。
 *
 * 此前这里是「兵力比」，从 label 里抠正则拿。两处都是错的：
 * 比值与引擎判胜负用的量没有关系（实测比 4.35 打不下、比 2.26 能破城），
 * 而从 label 抠正则意味着标签一改就静默读错。现在读 Candidate.forecast。
 */
const MIN_MARGIN: Record<Profile, number> = {
  turtle: Infinity, balanced: 0, aggressive: -2, opportunist: -1,
};

/**
 * 为一个势力挑本季的命令。
 * 不含任何随机——同一 state 必得同一结果，自对局才可复现。
 */
export function decide(
  s: GameState, f: FactionId, g: Graph, profile: Profile, rules: Rules = DEFAULT_RULES,
  roster: Roster | null, P: EngineParams,
): Order[] {
  // 「出兵后余兵低到什么程度算把城送出去」由规则推导，不拍系数：
  // 邻敌最多带走自己八成守军，而破开「城防 30 以上 + 基数」的两档可防守
  // 需要兵力比 2.0，故余兵低于邻敌的 0.8/2.0 即一击可破。
  // 拿这个数去拟合出局率会得到 0.35，但那是对着指标调参，包一改就不成立了。
  const maxStrength = Math.max(...Object.values(P.strengthRatio));
  const breachTwo = P.breachLadder.find(([, n]) => n === 3)?.[0] ?? 2;
  const safeRatio = maxStrength / breachTwo;
  const cands = listActions(s, f, g, P, rules, roster);
  if (!cands.length) return [];
  const w = WEIGHTS[profile];
  const minMargin = MIN_MARGIN[profile];

  const scored = cands.map((c) => {
    let score = w[c.action.type] ?? 0;
    // 救援必须先判：它的 label 里没有「比 X」，若落进下面的通用征伐闸门，
    // ratioOf 取到 0 而被当成「打不动」直接弃掉——实测 608 条救援候选无一被采纳
    if (c.key.startsWith("relief:")) {
      // 丢城的代价高于野战失利，除苟活流外都应优先出兵解围。
      // 围军兵力读结构化字段的档位上界（保守估计），不从 label 抠
      const from = s.commanderies[(c.action as { from: string }).from];
      const mine = Math.floor((from?.garrison ?? 0) * 0.8);
      const odds = mine / Math.max(1, c.siegeBy?.troopsHi ?? 1);
      if (profile === "turtle" && odds < 1.5) return { c, score: -1e9 };
      if (odds < 0.9) return { c, score: -1e9 };            // 明显打不过就不送
      return { c, score: 14 + Math.min(8, (odds - 1) * 4) };
    }
    if (c.action.type === "campaign") {
      // 掏空老巢是所有画像共有的死法，不是某一流派的风格问题。
      // 四个画像都该有这条常识，否则测出来的不是策略差异，而是同一个失误——
      // 实测投机流曹操因此 10/10 全灭
      const from = s.commanderies[c.action.from];
      const m = /城中余 (\d+) 人/.exec(c.label);
      const left = m ? Number(m[1]) : from?.garrison ?? 0;
      const threat = Math.max(0, ...(g.adj.get(c.action.from) ?? [])
        .filter((e) => s.commanderies[e.to]?.owner && s.commanderies[e.to].owner !== f)
        .map((e) => s.commanderies[e.to].garrison));
      if (threat > 0 && left < threat * safeRatio) return { c, score: -1e9 };

      const fc = c.forecast;
      if (!fc) return { c, score: -1e9 };                    // 城下有兵，另一套判定
      // 缺口余量：最少能开的缺口 − 最多要面对的可防守数
      const margin = fc.breachLo - fc.holdHi;
      // 达不到该画像的出兵门槛就直接弃掉，而不是给低分——
      // 给低分会让它在无仗可打时仍被选中，那是「被迫送死」而非策略
      if (margin < minMargin) return { c, score: -1e9 };
      score += (margin - minMargin) * 4 + (fc.verdict === "破城" ? 6 : 0);
      // 迷雾里的仗要打折：未探时城防与守将不明，区间宽得多
      if (fc.fog === "tier") score -= 3;
      // 投机流额外偏好无主之地：不树敌，扩张最快
      if (profile === "opportunist" && !s.commanderies[c.action.target]?.owner) score += 8;
      // 倾国投入风险高，只在余量确实够时选
      if (c.action.strength === "allout") score += margin >= minMargin + 1 ? 3 : -5;
    }
    if (c.action.type === "withdraw") {
      // 围城季数越多、残兵越少，越该收兵
      const m = /已围 (\d+) 季，余 (\d+) 人/.exec(c.label);
      score += m ? Number(m[1]) * 2 + (Number(m[2]) < 3000 ? 4 : 0) : 0;
    }
    if (c.action.type === "appoint") {
      // 候选已按郡的性质预筛过人选，这里只再表达画像偏好：
      // 进攻流优先把人放到临敌郡，苟活流优先后方
      const front = c.label.includes("临敌");
      score += profile === "turtle" ? (front ? 0 : 3) : (front ? 3 : 0);
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
