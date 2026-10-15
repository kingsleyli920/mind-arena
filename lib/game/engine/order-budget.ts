import { canonicalOrder, DEFAULT_RULES, governPrice, orderCost, orderSites, validate,
  type Graph, type Rules } from "./actions.ts";
import type { Roster } from "./officers.ts";
import type { EngineParams } from "./params.ts";
import type { Action, GameState, Order } from "./types.ts";
import type { Geography } from "./victory.ts";

/** 同时调兵的唯一分配口径：先扣出发兵力，所有调兵完成后才入城。 */
export function allocateTransfers(s: GameState, orders: readonly Order[], P: EngineParams) {
  const available = new Map(Object.values(s.commanderies)
    .map(c => [c.id, Math.floor(c.garrison * P.musterTake)]));
  const remaining = new Map(Object.values(s.commanderies).map(c => [c.id, c.garrison]));
  const incoming = new Map<string, number>();
  return canonicalOrder(orders).filter(o => o.action.type === "transfer").map(order => {
    const a = order.action as Extract<Action, { type: "transfer" }>;
    const owned = s.commanderies[a.from]?.owner === order.faction
      && s.commanderies[a.to]?.owner === order.faction;
    const room = P.garrisonCap - (remaining.get(a.to) ?? 0) - (incoming.get(a.to) ?? 0);
    const troops = owned ? Math.max(0, Math.min(available.get(a.from) ?? 0, room)) : 0;
    available.set(a.from, (available.get(a.from) ?? 0) - troops);
    remaining.set(a.from, (remaining.get(a.from) ?? 0) - troops);
    incoming.set(a.to, (incoming.get(a.to) ?? 0) + troops);
    return { order, troops };
  });
}

function exclusiveKeys(a: Action): string[] {
  switch (a.type) {
    case "campaign": return [`dispatch:${a.from}`, `campaign-target:${a.target}`];
    case "appoint": return [`officer:${a.officer}`];
    case "muster": return [`muster:${a.at}`, ...a.from.map(id => `muster-source:${id}`)];
    case "govern": return [`govern:${a.at}:${a.policy}`];
    case "build": return [`build:${a.at}:${a.kind}`];
    case "array": return [`array:${a.at}`];
    case "seize": return [`seize:${a.node}`];
    case "scout": return [`scout:${a.at}`];
    case "withdraw": return [`withdraw:${a.army}`];
    case "suade": return [`suade:${a.officer}`];
    case "invest": return [`invest:${a.zhou}`];
    case "ally": return [`ally:${a.to}`];
    case "passage": return [`passage:${a.to}`];
    case "submit": return [`submit:${a.to}`];
    case "transfer": return [`transfer:${a.from}:${a.to}`];
    case "relocate": return ["relocate"];
    case "retire": return ["retire"];
  }
}

/** 只预留资源，不提前执行战斗。调用者决定优先级；结算仍采用规范化顺序。 */
export class OrderBudget {
  readonly state: GameState;
  private accepted: Order[] = [];
  private original: GameState;
  private g: Graph;
  private roster: Roster | null;
  private P: EngineParams | null;
  private rules: Rules;
  private geo: Geography | null;

  constructor(original: GameState, g: Graph, roster: Roster | null,
    P: EngineParams | null, rules: Rules = DEFAULT_RULES, geo: Geography | null = null) {
    this.original = original; this.g = g; this.roster = roster;
    this.P = P; this.rules = rules; this.geo = geo;
    this.state = structuredClone(original);
  }

  check(order: Order): string | null {
    const a = order.action;
    const prior = this.accepted.filter(o => o.faction === order.faction);
    const keys = new Set(prior.flatMap(o => exclusiveKeys(o.action)));
    if (exclusiveKeys(a).some(key => keys.has(key))) return "命令冲突：同一兵源、目标或对象本季已安排";
    for (const o of prior) {
      const x = o.action;
      if (a.type === "retire" || x.type === "retire") return "归隐不能与其他命令同时提交";
      const retreat = a.type === "withdraw" ? a : x.type === "withdraw" ? x : null;
      const attack = a.type === "campaign" ? a : x.type === "campaign" ? x : null;
      if (retreat && attack && this.original.armies.some(army => army.id === retreat.army
          && army.target === attack.target)) return "不能同时撤围与向同一目标增兵";
      const transfer = a.type === "transfer" ? a : x.type === "transfer" ? x : null;
      const muster = a.type === "muster" ? a : x.type === "muster" ? x : null;
      if (transfer && (attack?.from === transfer.from || muster?.from.includes(transfer.from))) {
        return "同一郡的兵力不能同时外调与出征或集结";
      }
    }
    const why = validate(this.state, order, this.g, this.rules, this.roster, this.P, this.geo);
    if (why) return why;
    if (!this.P) return null;
    const P = this.P;
    const price = this.price(order);
    if (price > this.state.factions[order.faction].gold) return `国库已预留，余 ${Math.floor(this.state.factions[order.faction].gold)} 金，需 ${price}`;
    if (a.type === "build") {
      const count = prior.filter(o => o.action.type === "build" && o.action.at === a.at).length;
      if (this.original.commanderies[a.at].buildings.length + count >= P.buildCap) return "建筑位置已预留";
    }
    if (a.type === "campaign") {
      const ready = this.original.armies.some(x => x.faction === order.faction && x.at === a.from
        && !x.target && x.troops > 0);
      if (!ready && Math.floor(this.original.commanderies[a.from].garrison * P.strengthRatio[a.strength]) <= 0) return "没有可出征兵力";
    }
    if (a.type === "muster" && new Set(a.from).size !== a.from.length) return "集结来源郡不可重复";
    if (a.type === "transfer" && allocateTransfers(this.original, [...this.accepted, order], P)
      .some(x => x.troops <= 0)) return "调兵兵力或目的地容量已被其他命令预留";
    return null;
  }

  private price(o: Order): number {
    if (!this.P) return 0;
    if (o.action.type === "govern") return governPrice(this.original.commanderies[o.action.at], o.action.policy, this.P);
    return o.action.type === "build" && this.P.goldOn ? this.P.buildGold[o.action.kind] : 0;
  }

  take(order: Order): string | null {
    const why = this.check(order);
    if (why) return why;
    const a = order.action, f = this.state.factions[order.faction];
    const cost = orderCost(a, this.state, this.rules);
    f.ap -= cost;
    f.gold -= this.price(order);
    if (cost === 0) f.freeUsed[a.type] = (f.freeUsed[a.type] ?? 0) + 1;
    for (const id of orderSites(a)) this.state.commanderies[id].ordersThisSeason += 1;
    this.accepted.push(order);
    return null;
  }
}
