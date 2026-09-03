// 无密钥的桩席位。
//
// 存在的意义：把「模型接线」之外的整条管道——观测装配、准入、记录、
// 评测跑、报告——在没有 API key 的情况下全部验证掉。
// 否则这些代码在密钥到位之前一行都没跑过，等真接上模型时，
// 分不清是模型的问题还是管道的问题。
import { shuffle } from "../../game/engine/rng.ts";
import type { Candidate, FactionId, GameState } from "../../game/engine/types.ts";
import type { Decision } from "./parse.ts";

export type StubKind =
  /** 从合法候选里确定性地随机取，直到令数用尽。评测的下界基线 */
  | "random-legal"
  /** 什么都不做。用来验证「存续不得分」在真实管道里也成立 */
  | "idle"
  /** 故意混入非法 key，用来验证准入层 */
  | "chaos";

export function stubDecide(
  s: GameState, faction: FactionId, candidates: readonly Candidate[], kind: StubKind,
): Decision {
  if (kind === "idle") return { picks: [], reason: "按兵不动" };
  // 不认识的变体必须炸，不能悄悄跑成 random-legal——
  // `--agent=bot:balanced` 曾因此静默跑成随机基线，而报告照样标着 bot:balanced。
  // 排行榜上一个悄悄跑错的基线比没有基线更坏
  if (kind !== "random-legal" && kind !== "chaos") {
    throw new Error(`未知的桩变体 ${kind}（只有 random-legal / idle / chaos）`);
  }

  const order = shuffle(candidates,
    { seed: s.seed, year: s.year, season: s.season, faction, event: `stub:${kind}` });

  const picks: string[] = [];
  let ap = s.factions[faction]?.ap ?? 0;
  for (const c of order) {
    if (c.cost > ap) continue;
    ap -= c.cost;
    picks.push(c.key);
    if (ap <= 0) break;
  }
  if (kind === "chaos") {
    // 掺进三类非法：不存在的 key、重复、超预算
    picks.splice(1, 0, "campaign:不存在>也不存在:main");
    if (picks[0]) picks.push(picks[0]);
    for (const c of candidates) if (c.cost > 0) { picks.push(c.key); break; }
  }
  return { picks, reason: `桩席位 ${kind}` };
}

