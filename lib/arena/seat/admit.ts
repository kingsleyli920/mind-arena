// 准入：把模型选的一串 key 收敛成引擎能执行的命令。
//
// 处理非法输出的原则是**前缀贪心**，不是整回合作废：
// 整回合作废会因为一个坏 key 就抹掉模型这一季的全部判断，评测拿不到信号，
// 而且惩罚与错误的严重程度不成比例。逐条丢弃则既保住了合法部分，
// 又能把「非法率」当成一项独立指标报出来——那本身就是模型能力的一面。
//
// 预算裁剪也在这里，不在 resolve：resolve 若还见到「令数不足」的拒绝，
// 就说明准入层有 bug（resolve 里有断言）。
import { validate, type Graph, type Rules, DEFAULT_RULES } from "../../game/engine/actions.ts";
import type { Roster } from "../../game/engine/officers.ts";
import type { Candidate, FactionId, GameState, Order } from "../../game/engine/types.ts";

export type DropReason =
  | "unknown-key"      // 候选表里没有这个 key
  | "duplicate"        // 同一 key 选了两次
  | "over-budget"      // 令数不够
  | "rejected";        // 引擎校验不过（郡令数满、免费次数用尽等）

export interface Admission {
  /** 采纳的命令 */
  orders: Order[];
  /** 采纳的 key，按提交顺序 */
  admitted: string[];
  /** 逐条丢弃的理由 */
  dropped: Array<{ key: string; reason: DropReason; detail?: string }>;
  /** 花掉的令数 */
  spent: number;
  /** 非法率 = 丢弃数 / 提交数。0 表示这一季的输出全部合法 */
  illegalRate: number;
}

export function admit(
  s: GameState, faction: FactionId, picks: readonly string[],
  candidates: readonly Candidate[], g: Graph,
  roster: Roster | null, rules: Rules = DEFAULT_RULES,
): Admission {
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const orders: Order[] = [];
  const admitted: string[] = [];
  const dropped: Admission["dropped"] = [];
  const seen = new Set<string>();

  // 在推进中的状态副本上校验：同一势力超额下令会被后面的条目自然拒绝，
  // 与 resolve 的做法一致，无需另建配额账本
  let probe: GameState = JSON.parse(JSON.stringify(s));
  let spent = 0;
  const budget = s.factions[faction]?.ap ?? 0;

  for (const key of picks) {
    const c = byKey.get(key);
    if (!c) { dropped.push({ key, reason: "unknown-key" }); continue; }
    if (seen.has(key)) { dropped.push({ key, reason: "duplicate" }); continue; }
    if (spent + c.cost > budget) {
      dropped.push({ key, reason: "over-budget", detail: `余 ${budget - spent} 令，需 ${c.cost}` });
      continue;
    }
    const order: Order = { faction, action: c.action };
    const why = validate(probe, order, g, rules, roster);
    if (why) { dropped.push({ key, reason: "rejected", detail: why }); continue; }

    // 推进探针状态：扣令、占郡国配额、记免费次数
    const f = probe.factions[faction];
    f.ap -= c.cost;
    if (c.cost === 0) f.freeUsed[c.action.type] = (f.freeUsed[c.action.type] ?? 0) + 1;
    const touched = c.action.type === "campaign" ? [c.action.from]
      : c.action.type === "muster" ? c.action.from
      : c.action.type === "govern" ? [c.action.at] : [];
    for (const id of touched) probe.commanderies[id].ordersThisSeason += 1;

    seen.add(key);
    admitted.push(key);
    orders.push(order);
    spent += c.cost;
  }
  probe = null as unknown as GameState;

  return {
    orders, admitted, dropped, spent,
    illegalRate: picks.length ? dropped.length / picks.length : 0,
  };
}
