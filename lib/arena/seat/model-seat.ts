// 模型席位：观测 → 提示词 → 调用 → 解析 → 准入。
//
// 任何一步失败都要**记下来并降级**，而不是让整局崩掉：评测跑一次几十局，
// 中途因为一个 429 断掉是不可接受的。降级到「本季不下令」也是一种结果，
// 它会体现在分数里，且非法率/无回应率是独立上报的指标。
import { listActions, type Graph, type Rules, DEFAULT_RULES } from "../../game/engine/actions.ts";
import { observe, estTokens } from "../../game/engine/observe.ts";
import type { Roster } from "../../game/engine/officers.ts";
import type { EngineParams } from "../../game/engine/params.ts";
import type { Geography } from "../../game/engine/victory.ts";
import type { FactionId, GameState, Order } from "../../game/engine/types.ts";
import type { LlmClient, Rung } from "../llm/client.ts";
import { admit, type Admission } from "./admit.ts";
import { decisionSchema, parseDecision } from "./parse.ts";
import { renderSystem, renderUser, PROMPT_VERSION } from "./prompt.ts";

export interface ModelTurnRecord {
  turn: number;
  seat: FactionId;
  model: string;
  promptVersion: string;
  /** 观测的哈希，用于审计「模型看到的是不是同一份东西」 */
  obsChars: number;
  /**
   * 观测的 token 数，走 estTokens（已按三家 tokenizer 标定）。
   * 此前评测跑是拿 obsChars/2.4 现算的，而桩席位那条路走的是 estTokens——
   * 同一列「观测峰」对模型和对桩是两把不同的尺子，跨对局方比不了
   */
  obsTokens: number;
  candidates: number;
  picks: string[];
  reason?: string;
  admission: Pick<Admission, "admitted" | "dropped" | "spent" | "illegalRate">;
  usage: { prompt: number; completion: number; cached: number; reasoning: number } | null;
  structured: boolean;
  /** 请求实际落在哪一档降级。跨模型比分前要先看这个，否则约束不同分数不可比 */
  rung: Rung;
  /** 最终用的出参预算。被推理饿死翻倍过就与默认值不同 */
  maxTokens: number;
  finishReason: string | null;
  attempts: number;
  elapsedMs: number;
  /** 失败时记下原因，orders 为空 */
  failure?: string;
}

export interface ModelSeatDeps {
  client: LlmClient;
  model: string;
  pack: unknown;
  g: Graph; P: EngineParams; roster: Roster; geo: Geography;
  rules?: Rules;
  nameOf?: (id: FactionId) => string;
  /**
   * 候选 key 是否写成 schema 的 enum。默认 true（解码层强制，R13）。
   * 置 false 换回 Anthropic 的前缀缓存，代价是实测 8.3% 的令被丢掉。
   * 详见 decisionSchema 里的两组实测
   */
  keyEnum?: boolean;
  /** 推理档位。不给则各模型用自己的默认值，见 ChatRequest.reasoning */
  reasoning?: { effort: "low" | "medium" | "high" } | { max_tokens: number };
}

export async function modelDecide(
  s: GameState, faction: FactionId, since: number, deps: ModelSeatDeps,
): Promise<{ orders: Order[]; record: ModelTurnRecord }> {
  const rules = deps.rules ?? DEFAULT_RULES;
  const cands = listActions(s, faction, deps.g, deps.P, rules, deps.roster,
    deps.nameOf, deps.geo);
  const o = observe(s, faction, deps.g, deps.P, deps.roster, deps.geo,
    { nameOf: deps.nameOf, rules, since });
  const user = renderUser(o);

  const base: ModelTurnRecord = {
    turn: s.turn, seat: faction, model: deps.model, promptVersion: PROMPT_VERSION,
    obsChars: user.length, obsTokens: estTokens(user), candidates: cands.length,
    picks: [], admission: { admitted: [], dropped: [], spent: 0, illegalRate: 0 },
    usage: null, structured: false, rung: "text", maxTokens: 0,
    finishReason: null, attempts: 0, elapsedMs: 0,
  };
  if (!cands.length) return { orders: [], record: base };

  try {
    const res = await deps.client.chat({
      model: deps.model,
      system: renderSystem(deps.pack),
      user,
      schema: decisionSchema(cands, deps.keyEnum ?? true),
      reasoning: deps.reasoning,
    });
    // 「没让它说完」与「它答不上来」必须分开记。前者是 harness 的配置问题
    // ——推理模型把出参预算全花在 reasoning 上，content 返回空串——
    // 记成后者会把每个推理模型都判成废物，而这个 harness 的立项目的就是比模型
    if (!res.content.trim()) {
      const r = res.usage?.reasoning ?? 0;
      return { orders: [], record: { ...base, ...meta(res),
        failure: `无内容（finish=${res.finishReason ?? "?"}，出参预算 ${res.maxTokens}`
               + `${r ? `，推理占 ${r}` : ""}）` } };
    }
    const dec = parseDecision(res.content);
    if (!dec) {
      // 解析不出记为「无回应」，不是「什么都不做」——两者在评测里含义不同
      return { orders: [], record: { ...base, ...meta(res), failure: "解析不出决策" } };
    }
    const a = admit(s, faction, dec.picks, cands, deps.g, deps.roster, rules);
    return {
      orders: a.orders,
      record: {
        ...base, ...meta(res), picks: dec.picks, reason: dec.reason,
        admission: { admitted: a.admitted, dropped: a.dropped, spent: a.spent,
                     illegalRate: a.illegalRate },
      },
    };
  } catch (e) {
    return { orders: [], record: { ...base, failure: (e as Error).message } };
  }
}

const meta = (r: { model: string; usage: ModelTurnRecord["usage"]; structured: boolean;
                   rung: Rung; maxTokens: number; finishReason: string | null;
                   attempts: number; elapsedMs: number }) => ({
  model: r.model, usage: r.usage, structured: r.structured,
  rung: r.rung, maxTokens: r.maxTokens, finishReason: r.finishReason,
  attempts: r.attempts, elapsedMs: r.elapsedMs,
});
