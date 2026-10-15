// 浏览器侧的 LlmClient：把请求转给 /api/openrouter/chat，密钥留在服务端。
//
// 有了它，lib/arena/seat/model-seat.ts 的 modelDecide 可以原封不动跑在浏览器里
// ——对局界面与评测跑因此共用同一份席位逻辑、同一套失败分桶、同一份记录格式。
import type { ChatRequest, ChatResult, LlmClient } from "./client.ts";
import type { Failure } from "./errors.ts";

export class ProxyLlmClient implements LlmClient {
  readonly endpoint: string;
  readonly signal?: AbortSignal;

  constructor(endpoint = "/api/openrouter/chat", signal?: AbortSignal) {
    this.endpoint = endpoint;
    this.signal = signal;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const r = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: this.signal,
    });
    const body = (await r.json()) as ChatResult & { error?: string; hint?: string; failure?: Failure };
    if (!r.ok) {
      // 把服务端的话原样抛出去。model-seat 按错误文本分桶，
      // 在这里改写成「请求失败」等于把「账户没钱了」冲成「模型答不上来」
      throw Object.assign(new Error(body.hint ? `${body.error}（${body.hint}）` : (body.error ?? `HTTP ${r.status}`)),
        { failure: body.failure, attempts: body.attempts, elapsedMs: body.elapsedMs });
    }
    return body;
  }
}
