// 人机对战时替某一席位向模型请一季的令。
//
// 旧版每次只返回一个 actionIndex，且 observation 是 unknown 直接转发——
// 与引擎对不上（一季要在令数预算内选多条），也没有任何调用方。
// 现在：客户端只报 matchId/seat/observation 的**摘要**是不行的，
// 观测必须由客户端装配（它有完整 state），服务端只负责把它送出去并解析回来。
//
// 评测跑不走这条路由：Cloudflare Worker 每次调用只有 6 个并发连接、
// 免费版 50 个外部子请求，一局 16 次调用带重试会顶到；本地 Node 无此约束，
// 还能直接写 JSONL、断点续跑。见 tools/eval-run.mjs。
import { OpenRouterClient } from "@/lib/arena/llm/client.ts";
import { parseDecision } from "@/lib/arena/seat/parse.ts";

interface DecideBody {
  model?: string;
  /** 静态前缀：规则摘要 + 交代。由客户端用 renderSystem 装配 */
  system?: string;
  /** 本季观测的 JSON 字符串 */
  user?: string;
  /** 本季候选的 key 列表，用来生成 enum */
  keys?: string[];
}

const MAX_SYSTEM = 40_000;
const MAX_USER = 60_000;

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: "未配置 OPENROUTER_API_KEY",
      hint: "在项目根目录执行：echo 'OPENROUTER_API_KEY=你的key' >> .env.local",
    }, { status: 503 });
  }

  const b = (await request.json()) as DecideBody;
  if (!b.model || !b.system || !b.user || !Array.isArray(b.keys) || !b.keys.length) {
    return Response.json({ error: "需要 model / system / user / keys" }, { status: 400 });
  }
  if (b.system.length > MAX_SYSTEM || b.user.length > MAX_USER || b.keys.length > 200) {
    return Response.json({ error: "请求过大" }, { status: 413 });
  }

  const client = new OpenRouterClient(apiKey, {
    referer: request.headers.get("origin") ?? undefined, title: "Mind Arena",
  });
  try {
    const res = await client.chat({
      model: b.model, system: b.system, user: b.user,
      schema: {
        name: "season_orders", strict: true,
        schema: {
          type: "object", additionalProperties: false,
          required: ["picks", "reason"],
          properties: {
            picks: { type: "array", maxItems: 16,
                     items: { type: "string", enum: b.keys } },
            reason: { type: "string" },
          },
        },
      },
    });
    // 「没让它说完」与「它答不上来」是两回事，错误信息要说清楚，
    // 否则界面上只会显示「模型未给出决策」，而真正该改的是出参预算
    if (!res.content.trim()) {
      return Response.json({
        error: `模型未产出内容（finish=${res.finishReason ?? "?"}，出参预算 ${res.maxTokens}`
             + `${res.usage?.reasoning ? `，推理占 ${res.usage.reasoning}` : ""}）`,
      }, { status: 502 });
    }
    const decision = parseDecision(res.content);
    if (!decision) {
      return Response.json({ error: "模型未给出可解析的决策", raw: res.content.slice(0, 500) },
        { status: 422 });
    }
    return Response.json({
      decision, model: res.model, usage: res.usage,
      structured: res.structured, rung: res.rung, maxTokens: res.maxTokens,
      finishReason: res.finishReason, attempts: res.attempts, elapsedMs: res.elapsedMs,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
