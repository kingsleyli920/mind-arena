type DecisionRequest = {
  model?: string;
  observation?: unknown;
};

function parseDecision(content: string): { actionIndex: number; reason?: string } | null {
  const normalized = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(normalized) as { actionIndex?: unknown; reason?: unknown };
    if (!Number.isInteger(parsed.actionIndex) || Number(parsed.actionIndex) < 0) return null;
    return {
      actionIndex: Number(parsed.actionIndex),
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 220) : undefined,
    };
  } catch {
    const match = normalized.match(/"?actionIndex"?\s*:\s*(\d+)/i);
    return match ? { actionIndex: Number(match[1]) } : null;
  }
}

async function callOpenRouter(apiKey: string, model: string, observation: unknown, structured: boolean) {
  const body: Record<string, unknown> = {
    model,
    temperature: 0.35,
    max_tokens: 220,
    messages: [
      {
        role: "system",
        content: "你是策略游戏中的一方统帅。只能从 legalActions 中选择一个 actionIndex。不得虚构动作或修改事实。只返回 JSON：{\"actionIndex\": number, \"reason\": string}。",
      },
      { role: "user", content: JSON.stringify(observation) },
    ],
  };
  if (structured) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "strategy_decision",
        strict: true,
        schema: {
          type: "object",
          properties: {
            actionIndex: { type: "integer", minimum: 0 },
            reason: { type: "string" },
          },
          required: ["actionIndex", "reason"],
          additionalProperties: false,
        },
      },
    };
    body.provider = { require_parameters: true };
  }

  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Mind Arena",
    },
    body: JSON.stringify(body),
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENROUTER_API_KEY is not configured" }, { status: 503 });
  }

  const payload = (await request.json()) as DecisionRequest;
  if (!payload.model || payload.observation == null) {
    return Response.json({ error: "model and observation are required" }, { status: 400 });
  }
  if (payload.model.length > 160 || JSON.stringify(payload.observation).length > 30_000) {
    return Response.json({ error: "decision payload is too large" }, { status: 413 });
  }

  let response = await callOpenRouter(apiKey, payload.model, payload.observation, true);
  if (!response.ok && [400, 404, 422].includes(response.status)) {
    response = await callOpenRouter(apiKey, payload.model, payload.observation, false);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    return Response.json({ error: `OpenRouter decision failed (${response.status})`, detail }, { status: response.status });
  }

  const result = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const decision = parseDecision(result.choices?.[0]?.message?.content ?? "");
  if (!decision) return Response.json({ error: "Model returned an invalid decision" }, { status: 422 });
  return Response.json({ decision, model: result.model ?? payload.model, usage: result.usage ?? null });
}
