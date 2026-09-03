// OpenRouter 客户端。纯 fetch，不依赖 Next 或 Workers 运行时——
// 评测跑在本地 Node，人机对战走 API 路由，两边共用这一份。
import { backoffMs, classify, type Failure } from "./errors.ts";

/**
 * 请求降级的档位。**降到哪一档必须记进评测结果**：不同档位下模型拿到的
 * 约束不同（有无解码层强制、有无 temperature），分数本来就不完全可比。
 * 此前只有一个 structured 布尔值，「为什么退化」无从追溯。
 *
 * 档位顺序是实测排出来的，不是拍的（openai/gpt-5-nano 逐项对照）：
 *   schema        response_format + require_parameters + temperature
 *   schema-notemp 去掉 temperature —— 推理模型的端点不接受它，而
 *                 require_parameters 要求端点支持请求里的**每一个**参数，
 *                 两者一撞就把 4 个端点筛成 0，返回 404「No endpoints found」。
 *                 这一档专治它：实测同一模型去掉 temperature 即 200
 *   schema-any    去掉 require_parameters —— 端点没声明支持 json_schema 时
 *                 仍试着要结构化输出。有静默忽略的风险，故排在后面
 *   text          退回自由文本，由 parseDecision 兜住
 */
export type Rung = "schema" | "schema-notemp" | "schema-any" | "text";
const LADDER: Rung[] = ["schema", "schema-notemp", "schema-any", "text"];

/**
 * 出参预算的默认值。
 *
 * 原值 2000 会把推理模型饿死：实测 openai/gpt-5-nano 打真实观测时
 * 16 季全部把 1984 tok 花在 reasoning 上、content 返回空串，
 * 报告记成「解析不出决策、0 分、令数用率 0%」——看着像模型不行，
 * 其实是没让它说完。评测的立项目的是比模型，这种静默饥饿会把
 * 每个推理模型都判成废物，是比跑挂更坏的失败。
 *
 * 决策本身只要 ~200 tok（一串 key + 一句话），余量全是给推理留的。
 */
const DEFAULT_MAX_TOKENS = 8000;
/** 饿死后翻倍重试的上限。再高就不是预算问题，是模型不收敛 */
const MAX_MAX_TOKENS = 32_000;

export interface ChatRequest {
  model: string;
  system: string;
  user: string;
  /** 结构化输出的 schema。不传则直接从 text 档起步 */
  schema?: { name: string; strict: boolean; schema: unknown };
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  usage: {
    prompt: number; completion: number; cached: number;
    /** 出参里被推理吃掉的部分。推理模型的真实成本在这里，不在 content 长度上 */
    reasoning: number;
  } | null;
  /** 实际用的是结构化输出还是退回了自由文本。等价于 rung !== "text" */
  structured: boolean;
  /** 实际落在哪一档。评测报告要按档位分组，否则跨模型的分数不可比 */
  rung: Rung;
  /** 最终用的出参预算。被饿死翻倍过就与请求值不同 */
  maxTokens: number;
  finishReason: string | null;
  attempts: number;
  elapsedMs: number;
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResult>;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterOptions { referer?: string; title?: string; maxAttempts?: number }

interface RawChoice {
  finish_reason?: string;
  message?: { content?: string };
}
interface RawResponse {
  model?: string;
  choices?: RawChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export class OpenRouterClient implements LlmClient {
  // 显式字段而非构造函数参数属性：node --experimental-strip-types
  // 不支持后者，而评测跑就是用它跑的
  readonly apiKey: string;
  readonly opts: OpenRouterOptions;

  constructor(apiKey: string, opts: OpenRouterOptions = {}) {
    this.apiKey = apiKey;
    this.opts = opts;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();
    const maxAttempts = this.opts.maxAttempts ?? 6;
    // 没给 schema 就直接从 text 档起步，不必把上面三档白试一遍
    let rungIdx = req.schema ? 0 : LADDER.length - 1;
    let budget = req.maxTokens ?? DEFAULT_MAX_TOKENS;
    let attempts = 0;
    let starved = 0;
    let last: Failure | null = null;

    while (attempts < maxAttempts) {
      attempts += 1;
      const rung = LADDER[rungIdx];
      const res = await this.once(req, rung, budget).catch((e: unknown) => e as Error);
      if (res instanceof Error) {
        last = { kind: "retryable", status: 0, message: res.message };
        await sleep(backoffMs(attempts));
        continue;
      }

      if (res.ok) {
        const json = await res.json() as RawResponse;
        const choice = json.choices?.[0];
        const content = choice?.message?.content ?? "";
        const finishReason = choice?.finish_reason ?? null;
        const completion = json.usage?.completion_tokens ?? 0;
        const reasoning = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

        // 内容为空而出参顶到上限 = 推理把预算吃光了。这是我们的配置问题，
        // 不是模型答不上来，两者在评测里含义完全不同。翻倍再给一次机会
        if (!content.trim() && (finishReason === "length" || completion >= budget * 0.95)
            && starved < 2 && budget < MAX_MAX_TOKENS) {
          starved += 1;
          last = { kind: "starved", status: 200,
                   message: `出参预算 ${budget} 被推理占满（reasoning ${reasoning}），已翻倍重试` };
          budget = Math.min(budget * 2, MAX_MAX_TOKENS);
          continue;
        }

        return {
          content,
          model: json.model ?? req.model,
          usage: json.usage ? {
            prompt: json.usage.prompt_tokens ?? 0,
            completion,
            cached: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
            reasoning,
          } : null,
          structured: rung !== "text",
          rung, maxTokens: budget, finishReason,
          attempts, elapsedMs: Date.now() - started,
        };
      }

      last = classify(res.status, await res.text());
      // 本档的参数组合不被任何端点接受 —— 降一档重来，而不是一步退到自由文本。
      // 此前 404 直接把结构化输出整个丢掉，而实测只要去掉 temperature 就能过
      if (last.kind === "degradable" && rungIdx < LADDER.length - 1) {
        rungIdx += 1;
        continue;
      }
      if (last.kind !== "retryable") break;
      await sleep(backoffMs(attempts, res.headers.get("retry-after")));
    }
    throw Object.assign(new Error(`OpenRouter 调用失败：${last?.message ?? "未知"}`), {
      failure: last, attempts, elapsedMs: Date.now() - started,
    });
  }

  private once(req: ChatRequest, rung: Rung, maxTokens: number): Promise<Response> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: maxTokens,
      messages: [
        // 规则摘要放 system 且逐字节稳定，前缀缓存才命中——
        // 一局 16 季重复发同一份 2.8k token，不缓存是纯浪费。
        // 注意这只对自动缓存的提供方成立（OpenAI / Gemini / DeepSeek）；
        // Anthropic 系要显式 cache_control 断点，见 systemBlocks()
        { role: "system", content: this.systemBlocks(req.system) },
        { role: "user", content: req.user },
      ],
    };
    // temperature 只在最上一档发。推理模型的端点不接受它，而它与
    // require_parameters 一撞就是 404 —— 实测 4 个端点被筛成 0
    if (rung === "schema") body.temperature = req.temperature ?? 0.3;
    if (rung !== "text" && req.schema) {
      body.response_format = { type: "json_schema", json_schema: req.schema };
      // 宁可 404 也不要静默忽略：某些端点会当没看见 response_format。
      // 但 404 之后要降档重试，不能就此把结构化输出丢掉
      if (rung !== "schema-any") body.provider = { require_parameters: true };
    }
    return fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(this.opts.referer ? { "HTTP-Referer": this.opts.referer } : {}),
        ...(this.opts.title ? { "X-Title": this.opts.title } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs ?? 180_000),
    });
  }

  /**
   * system 消息带缓存断点。
   *
   * OpenAI / Gemini / DeepSeek 是自动前缀缓存，纯字符串就够；
   * **Anthropic 系必须显式打 cache_control 断点，否则一次都不命中**。
   * 这个项目最在意的就是 Claude 各档的对比，而规则摘要 2.8k tok
   * 一局要发 16 次——不打断点等于把「逐字节稳定」这条设计白做。
   *
   * 数组形式对自动缓存的提供方也是合法输入，故不必按模型名分支。
   */
  private systemBlocks(system: string) {
    return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
