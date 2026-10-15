import { OrderBudget } from "../../game/engine/order-budget.ts";
// 准入：把模型选的一串 key 收敛成引擎能执行的命令。
//
// 处理非法输出的原则是**前缀贪心**，不是整回合作废：
// 整回合作废会因为一个坏 key 就抹掉模型这一季的全部判断，评测拿不到信号，
// 而且惩罚与错误的严重程度不成比例。逐条丢弃则既保住了合法部分，
// 又能把「非法率」当成一项独立指标报出来——那本身就是模型能力的一面。
//
// 预算裁剪也在这里，不在 resolve：resolve 若还见到「令数不足」的拒绝，
// 就说明准入层有 bug（resolve 里有断言）。
import { orderCost, type Graph, type Rules, DEFAULT_RULES } from "../../game/engine/actions.ts";
import type { Roster } from "../../game/engine/officers.ts";
import type { EngineParams } from "../../game/engine/params.ts";
import type { Action, Candidate, FactionId, GameState, Order } from "../../game/engine/types.ts";

export type DropReason =
  | "unknown-key"      // 候选表里没有这个 key
  | "mojibake"         // key 是被转码搞坏的，已复原（不计模型的过）
  | "duplicate"        // 同一 key 选了两次
  | "over-budget"      // 令数不够
  | "rejected";        // 引擎校验不过（郡令数满、免费次数用尽等）

/**
 * 把被转码搞坏的 key 复原。
 *
 * 症状：中文按 UTF-8 编码后又被按 Latin-1 解了一遍，
 * 「济阴郡」变成「æµ\x8eé\x98´é\x83¡」。这是路由层或提供方的编码问题，
 * 与模型能力无关——把它记成「候选表里没有这个 key」，就是又一次
 * 把基础设施的失败算到模型头上。
 *
 * 只在**复原后恰好命中候选**时才返回，所以复原不会把真正的幻觉洗白：
 * 模型编造的 key 复原之后仍然不在表里。
 */
function repairMojibake(key: string, byKey: Map<string, Candidate>): string | null {
  // 全是 ASCII 就不可能是这种乱码
  if (!/[\u0080-\u00ff]/.test(key)) return null;
  try {
    const fixed = Buffer.from(key, "latin1").toString("utf8");
    return byKey.has(fixed) ? fixed : null;
  } catch { return null; }
}

export interface Admission {
  /** 采纳的命令 */
  orders: Order[];
  /** 采纳的 key，按提交顺序 */
  admitted: string[];
  /** 首选被拒后，从模型自己的备选里补入的 key。 */
  backupsUsed: string[];
  /** 逐条丢弃的理由 */
  dropped: Array<{ key: string; reason: DropReason; detail?: string; label?: string }>;
  /** 花掉的令数 */
  spent: number;
  /** 非法率 = 丢弃数 / 提交数。0 表示这一季的输出全部合法。
   *  被转码搞坏又复原的不计入——那不是模型的过 */
  illegalRate: number;
  /** 本季有几条 key 是转码坏了、已复原的。非零说明提供方的编码有问题 */
  mojibake: number;
  /**
   * 采纳完这些命令之后的状态。界面用它判「下一条还能不能选」——
   * 只看令数是不够的：免费动作有次数上限，同一郡每季至多 2 令，
   * 这些规则界面若不知道，就会让玩家勾上引擎必然丢弃的条目。
   */
  state: GameState;
  check: (action: Action) => string | null;
}

export function admit(
  s: GameState, faction: FactionId, picks: readonly string[],
  candidates: readonly Candidate[], g: Graph,
  roster: Roster | null, rules: Rules = DEFAULT_RULES,
  P: EngineParams | null = null,
  backups: readonly string[] = [],
): Admission {
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const orders: Order[] = [];
  const admitted: string[] = [];
  const backupsUsed: string[] = [];
  const dropped: Admission["dropped"] = [];
  const seen = new Set<string>();

  // 在推进中的状态副本上校验：同一势力超额下令会被后面的条目自然拒绝，
  // 与 resolve 的做法一致，无需另建配额账本
  const reservation = new OrderBudget(s, g, roster, P, rules);
  const probe = reservation.state;
  let spent = 0;
  let mojibake = 0;
  const budget = s.factions[faction]?.ap ?? 0;

  const consider = (raw: string): string | null => {
    // **转码复原**。某些提供方会把中文按 UTF-8 编码后再按 Latin-1 解一遍，
    // 于是「济阴郡」变成「æµ\x8eé\x98´é\x83¡」。实测一份 48 局的排行榜里
    // qwen3-30b 有 2806 次 unknown-key 全是这个，非法率被记成 50.9%——
    // 而它其实每一条都选对了。这是路由层的编码问题，算到模型头上就是
    // 「基础设施的失败算成模型的分」，这个仓库为它栽过三次。
    //
    // 只在**复原后恰好命中候选**时才认，所以不会把真正的幻觉洗白
    const fixed = byKey.has(raw) ? raw : repairMojibake(raw, byKey);
    const key = fixed ?? raw;
    if (fixed && fixed !== raw) mojibake += 1;
    const c = byKey.get(key);
    if (!c) { dropped.push({ key, reason: "unknown-key" }); return null; }
    if (seen.has(key)) { dropped.push({ key, label: c.label, reason: "duplicate" }); return null; }
    if (spent + c.cost > budget) {
      dropped.push({ key, label: c.label, reason: "over-budget", detail: `余 ${budget - spent} 令，需 ${c.cost}` });
      return null;
    }
    const order: Order = { faction, action: c.action };
    const cost = orderCost(c.action, probe, rules);
    const why = reservation.take(order);
    if (why) { dropped.push({ key, label: c.label, reason: "rejected", detail: why }); return null; }

    seen.add(key);
    admitted.push(key);
    orders.push(order);
    spent += cost;
    return key;
  };
  for (const raw of picks) consider(raw);
  // 模型明确给出的备选，只替代被拒的首选。拒绝备选不占补位名额，
  // 所有命令仍共用同一个预算与冲突账本，不另发模型请求。
  let unfilled = dropped.length;
  let triedBackups = 0;
  for (const raw of backups) {
    if (!unfilled) break;
    triedBackups++;
    const key = consider(raw);
    if (key) { backupsUsed.push(key); unfilled--; }
  }
  return {
    orders, admitted, backupsUsed, dropped, spent, state: probe, mojibake,
    check: (action) => reservation.check({ faction, action }),
    illegalRate: picks.length + triedBackups ? dropped.length / (picks.length + triedBackups) : 0,
  };
}
