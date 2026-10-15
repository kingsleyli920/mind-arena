import { type Plan } from "../../game/strategy-plan.ts";
import { reviewDecision, type DecisionReview } from "../../game/decision-review.ts";
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
import type { ChatRequest, LlmClient, Rung } from "../llm/client.ts";
import type { Failure, FailureKind } from "../llm/errors.ts";
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
  /** 首选被拒时才尝试的备选，保持模型原顺序。 */
  backups?: string[];
  backupsUsed?: string[];
  reason?: string;
  /** 模型本季写下的跨季方略。下一季原样回传给它 —— 这是它唯一的记忆 */
  plan?: Plan;
  planWarning?: string;
  /** 决策时的客观提示与准入收据；采纳不代表行动成功。 */
  review?: DecisionReview;
  admission: Pick<Admission, "admitted" | "dropped" | "spent" | "illegalRate" | "mojibake">;
  usage: { prompt: number; completion: number; cached: number; reasoning: number;
           /** 提供方回报的真实扣费（美元）。价目表重算会少算，见 client.ts */
           cost: number | null } | null;
  structured: boolean;
  /**
   * 请求实际落在哪一档降级。跨模型比分前要先看这个，否则约束不同分数不可比。
   * **整跑失败时为 null**——此前这里留着初始占位值 "text"，
   * 于是报告里出现「kimi text×54」这种纯属虚构的档位分布
   */
  rung: Rung | null;
  /** 最终用的出参预算。被推理饿死翻倍过就与默认值不同 */
  maxTokens: number;
  /** 本季因推理吃光出参而真正翻倍重试的次数。与 maxTokens 不是一回事 */
  starved?: number;
  finishReason: string | null;
  attempts: number;
  elapsedMs: number;
  /** 实际服务的提供方与 generation id。OpenRouter 静默改路由时，只有这两项能看出来 */
  provider?: string | null;
  generationId?: string | null;
  /** 失败时记下原因，orders 为空 */
  failure?: string;
  /**
   * 失败归谁。评测报告按这个分栏，不能混成一个「失败」计数：
   *   credits 账户额度耗尽 —— 与模型能力毫无关系，整跑作废
   *   infra   超时 / 网络 —— 基础设施
   *   budget  出参预算被推理吃光 —— harness 的配置问题
   *   model   答不上来 / 解析不出 —— 只有这一类才算模型的分
   *
   * 两次教训都是同一个洞：**没有桶的失败会掉进 model**。
   * 第一次是超时（kimi 96 季里 54 季），第二次是额度耗尽——一份
   * 「国产模型全线 4–35 分、机器人 148 分」的排行榜，真相是账户没钱了，
   * 每个模型 768 季里有 688–765 季根本没发出请求。
   */
  failureKind?: FailureBucket;
}

/**
 * 失败归到哪一栏。只有 model 那一栏算模型的分。
 *
 * 写成**穷举表**而不是三元链：三元链的末项是 `: "model"`，
 * 于是每新增一种失败都默默落进「模型答不上来」。这个洞已经咬过三次——
 * 超时（kimi 96 季里 54 季）、额度耗尽（一份全线 4–35 分的假榜）、
 * 以及 401：实跑验证过，无效密钥会让榜上打出「模型失败 32 季、0 分」，
 * 一个请求都没被授权，报告却说这个模型不会玩。
 * 现在少写一项就编译不过。
 */
export type FailureBucket =
  | "credits"   // 账户余额耗尽 —— 与模型能力无关，整跑作废
  | "auth"      // 密钥无效或该模型不对本 key 开放 —— **这一行**不可用，不杀整批
  | "infra"     // 超时 / 网络 / 提供方 5xx
  | "budget"    // 出参预算被推理吃光 —— harness 的配置问题
  | "harness"   // 我们自己抛的异常 —— 也是 harness 的问题，别赖给模型
  | "model";    // 答不上来 / 解析不出 —— 只有这一类算模型的分

const BUCKET: Record<FailureKind, FailureBucket> = {
  budget: "credits",
  auth: "auth",
  infra: "infra",
  retryable: "infra",
  starved: "budget",
  degradable: "model",   // 四档都降完仍不被接受，只能算它答不上来
  fatal: "harness",      // 说不清的一律先算我们自己的
};

export interface ModelSeatDeps {
  limits?: Pick<ChatRequest, "maxTokens" | "maxTokensLimit" | "maxAttempts" | "timeoutMs">;
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
  /** 钉住提供方。评测要可比就得钉——同一个模型 id 会在提供方之间跳，见 client.ts */
  provider?: { order: string[]; allow_fallbacks?: boolean };
}

export async function modelDecide(
  s: GameState, faction: FactionId, since: number, deps: ModelSeatDeps,
  /** 该席位上季写下的跨季方略。不给则本季无记忆 */
  plan: Plan | null = null,
  /**
   * 该席位上季被丢掉的令。与方略同理：不回授的话，模型每季重犯同一个错
   * 而收不到任何信号——实测非法率 7.6–9.4%，全是「合起来不合法」那一类
   */
  dropped: Array<{ key: string; reason: string; detail?: string }> = [],
  previousReview: DecisionReview | null = null,
): Promise<{ orders: Order[]; record: ModelTurnRecord }> {
  const rules = deps.rules ?? DEFAULT_RULES;
  const cands = listActions(s, faction, deps.g, deps.P, rules, deps.roster,
    deps.nameOf, deps.geo);
  const o = observe(s, faction, deps.g, deps.P, deps.roster, deps.geo,
    { nameOf: deps.nameOf, rules, since, plan, dropped, previousReview });
  const user = renderUser(o);

  const base: ModelTurnRecord = {
    turn: s.turn, seat: faction, model: deps.model, promptVersion: PROMPT_VERSION,
    obsChars: user.length, obsTokens: estTokens(user), candidates: cands.length,
    picks: [], admission: { admitted: [], dropped: [], spent: 0, illegalRate: 0, mojibake: 0 },
    usage: null, structured: false, rung: null, maxTokens: 0, starved: 0,
    finishReason: null, attempts: 0, elapsedMs: 0,
  };
  if (!cands.length) return { orders: [], record: base };

  try {
    const res = await deps.client.chat({
      ...deps.limits,
      model: deps.model,
      system: renderSystem(deps.pack),
      user,
      schema: decisionSchema(cands, deps.keyEnum ?? true),
      reasoning: deps.reasoning,
      provider: deps.provider,
    });
    // 「没让它说完」与「它答不上来」必须分开记。前者是 harness 的配置问题
    // ——推理模型把出参预算全花在 reasoning 上，content 返回空串——
    // 记成后者会把每个推理模型都判成废物，而这个 harness 的立项目的就是比模型
    if (!res.content.trim()) {
      const r = res.usage?.reasoning ?? 0;
      const c = res.usage?.completion ?? 0;
      // 空内容有两种，含义完全不同，不能都记成「出参预算不够」：
      //   花掉了出参才空 → 被推理吃光了，是 harness 的配置问题（budget）
      //   一个 token 都没花就空 → 提供方回了个空壳，多半是限流或路由抽风（infra）
      // 实测见过后者：某免费模型 0.6 秒返回空内容、无 usage 无 finish_reason，
      // 而同一份载荷手工重发就正常。把它记成 budget 会让人去调出参预算，
      // 而该做的是重试或换提供方
      const spent = res.finishReason === "length" || r > 0 || c > 0;
      return { orders: [], record: { ...base, ...meta(res),
        failureKind: spent ? "budget" : "infra",
        failure: spent
          ? `无内容（finish=${res.finishReason ?? "?"}，出参预算 ${res.maxTokens}`
            + `${r ? `，推理占 ${r}` : ""}）`
          : `提供方回了空壳（finish=${res.finishReason ?? "无"}，未计出参`
            + `，耗时 ${res.elapsedMs}ms）——多半是限流或路由问题，非模型能力` } };
    }
    const dec = parseDecision(res.content);
    if (!dec) {
      // 解析不出记为「无回应」，不是「什么都不做」——两者在评测里含义不同
      return { orders: [], record: { ...base, ...meta(res),
        failureKind: res.finishReason === "length" ? "budget" : "model",
        failure: res.finishReason === "length" ? "达到输出上限，决策未完成" : "解析不出决策" } };
    }
    const a = admit(s, faction, dec.picks, cands, deps.g, deps.roster, rules, deps.P,
      dec.backups ?? []);
    const planWarning = dec.plan === undefined
      ? "本季计划缺失或格式无效，保留上季计划供下季复核"
      : typeof dec.plan === "object" && plan && typeof plan === "object"
        && dec.plan.review.trim() === plan.review.trim()
        ? "复核沿用上季文字，请结合实际变化检查" : undefined;
    return {
      orders: a.orders,
      record: {
        ...base, ...meta(res), picks: dec.picks,
        ...(dec.backups ? { backups: dec.backups, backupsUsed: a.backupsUsed } : {}),
        reason: dec.reason, plan: dec.plan,
        ...(planWarning ? { planWarning } : {}),
        review: reviewDecision(s, faction, dec.plan, plan, cands, a, planWarning,
          a.backupsUsed),
        admission: { admitted: a.admitted, dropped: a.dropped, spent: a.spent,
                     mojibake: a.mojibake,
                     illegalRate: a.illegalRate },
      },
    };
  } catch (e) {
    const f = (e as { failure?: Failure }).failure;
    // 没带分级的异常记 harness，不记 model。这里同时兜着 admit/parse 自己抛的错
    //（它们在同一个 try 里）——把 harness 自己的 bug 算成「模型答不上来」，
    // 是这套管线出过两次的那类事故
    const kind: FailureBucket = f ? BUCKET[f.kind] : "harness";
    const detail = e as Error & { attempts?: number; elapsedMs?: number };
    return { orders: [], record: { ...base, failureKind: kind, failure: detail.message,
      attempts: detail.attempts ?? 0, elapsedMs: detail.elapsedMs ?? 0 } };
  }
}

const meta = (r: { model: string; usage: ModelTurnRecord["usage"]; structured: boolean;
                   rung: Rung; maxTokens: number; starved: number; finishReason: string | null;
                   attempts: number; elapsedMs: number;
                   provider?: string | null; generationId?: string | null }) => ({
  model: r.model, usage: r.usage, structured: r.structured,
  rung: r.rung, maxTokens: r.maxTokens, starved: r.starved, finishReason: r.finishReason,
  attempts: r.attempts, elapsedMs: r.elapsedMs,
  provider: r.provider ?? null, generationId: r.generationId ?? null,
});
