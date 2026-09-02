// OpenRouter 客户端。纯 fetch，不依赖 Next 或 Workers 运行时——
// 评测跑在本地 Node，人机对战走 API 路由，两边共用这一份。
import { backoffMs, classify, type Failure } from "./errors.ts";

export interface ChatRequest {
  model: string;
  system: string;
  user: string;
  /** 结构化输出的 schema。不传则要自由文本 */
  schema?: { name: string; strict: boolean; schema: unknown };
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  usage: { prompt: number; completion: number; cached: number } | null;
  /** 实际用的是结构化输出还是退回了自由文本 */
  structured: boolean;
  attempts: number;
  elapsedMs: number;
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResult>;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterOptions { referer?: string; title?: string; maxAttempts?: number }

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
    const maxAttempts = this.opts.maxAttempts ?? 4;
    let structured = Boolean(req.schema);
    let attempts = 0;
    let last: Failure | null = null;

    while (attempts < maxAttempts) {
      attempts += 1;
      const res = await this.once(req, structured).catch((e: unknown) => e as Error);
      if (res instanceof Error) {
        last = { kind: "retryable", status: 0, message: res.message };
        await sleep(backoffMs(attempts));
        continue;
      }
      if (res.ok) {
        const json = await res.json() as {
          model?: string;
          choices?: Array<{ message?: { content?: string } }>;
          usage?: {
            prompt_tokens?: number; completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          };
        };
        return {
          content: json.choices?.[0]?.message?.content ?? "",
          model: json.model ?? req.model,
          usage: json.usage ? {
            prompt: json.usage.prompt_tokens ?? 0,
            completion: json.usage.completion_tokens ?? 0,
            cached: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
          } : null,
          structured, attempts, elapsedMs: Date.now() - started,
        };
      }
      last = classify(res.status, await res.text());
      if (last.kind === "degradable" && structured) {
        // 该模型的端点不吃 json_schema。退回自由文本，由 parseDecision 兜住
        structured = false;
        continue;
      }
      if (last.kind !== "retryable") break;
      await sleep(backoffMs(attempts, res.headers.get("retry-after")));
    }
    throw Object.assign(new Error(`OpenRouter 调用失败：${last?.message ?? "未知"}`), {
      failure: last, attempts, elapsedMs: Date.now() - started,
    });
  }

  private once(req: ChatRequest, structured: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      model: req.model,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 2000,
      messages: [
        // 规则摘要放 system 且逐字节稳定，前缀缓存才命中——
        // 一局 16 季重复发同一份 3.8k token，不缓存是纯浪费
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    };
    if (structured && req.schema) {
      body.response_format = { type: "json_schema", json_schema: req.schema };
      // 宁可 404 也不要静默忽略：某些端点会当没看见 response_format
      body.provider = { require_parameters: true };
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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
