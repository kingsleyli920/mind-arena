// 把服务端做成一个 **LlmClient 代理**：收一份 ChatRequest，回一份 ChatResult。
//
// 为什么是这个形状，而不是「服务端替你决策」：
// 席位逻辑（观测 → 提示词 → 调用 → 解析 → 准入）已经有一份实现，
// 在 lib/arena/seat/model-seat.ts，评测跑就是走它。若服务端再写一份
// 「收观测、回决策」的路由，同一套规则就有了两份实现，迟早各走各的
// ——这个仓库已经在「哪些令占郡国配额」上栽过一次：那条规则抄了三遍，
// 加新动作时只改了其中一处，界面判据放行的令被引擎拒收。
//
// 现在浏览器里跑的是同一个 modelDecide，只是把 LlmClient 换成打这条路由的代理。
// 密钥留在服务端，四档降级、重试、被推理饿死时翻倍出参这些也都留在服务端。
//
// 评测跑不走这条路由：Cloudflare Worker 每次调用只有 6 个并发连接、
// 免费版 50 个外部子请求，一局 16 次调用带重试会顶到；本地 Node 无此约束，
// 还能直接写 JSONL、断点续跑。见 tools/eval-run.mjs。
import { OpenRouterClient, type ChatRequest } from "@/lib/arena/llm/client.ts";

const MAX_SYSTEM = 40_000;
const MAX_USER = 60_000;

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: "未配置 OPENROUTER_API_KEY",
      hint: "在项目根目录执行 echo 'OPENROUTER_API_KEY=你的key' >> .env.local，然后重启 dev",
    }, { status: 503 });
  }

  let b: Partial<ChatRequest>;
  try { b = await request.json(); } catch {
    return Response.json({ error: "需要 JSON 请求" }, { status: 400 });
  }
  if (!b || typeof b.model !== "string" || !b.model.trim()
      || typeof b.system !== "string" || typeof b.user !== "string") {
    return Response.json({ error: "需要 model / system / user" }, { status: 400 });
  }
  if (b.system.length > MAX_SYSTEM || b.user.length > MAX_USER) {
    return Response.json({ error: "请求过大" }, { status: 413 });
  }
  for (const key of ["maxTokens", "maxTokensLimit", "maxAttempts", "timeoutMs"] as const) {
    if (b[key] !== undefined && (!Number.isInteger(b[key]) || b[key]! <= 0)) {
      return Response.json({ error: `${key} 必须为正整数` }, { status: 400 });
    }
  }

  const client = new OpenRouterClient(apiKey, {
    referer: request.headers.get("origin") ?? undefined, title: "Mind Arena",
  });
  try {
    return Response.json(await client.chat({
      model: b.model, system: b.system, user: b.user,
      schema: b.schema, maxTokens: Math.min(b.maxTokens ?? 8000, 16000), temperature: b.temperature,
      maxTokensLimit: Math.min(b.maxTokensLimit ?? 8000, 16000),
      maxAttempts: Math.min(b.maxAttempts ?? 2, 2),
      timeoutMs: Math.min(b.timeoutMs ?? 90000, 90000), reasoning: b.reasoning,
      provider: b.provider,
    }));
  } catch (e) {
    // 原样把错误文本带回去。调用方（model-seat）按它分桶：
    // 额度耗尽 / 基础设施 / 出参预算 / 模型答不上来 —— 四类的含义完全不同
    const err = e as Error & { failure?: unknown; attempts?: number; elapsedMs?: number };
    return Response.json({ error: err.message, failure: err.failure,
      attempts: err.attempts, elapsedMs: err.elapsedMs }, { status: 502 });
  }
}
