type OpenRouterModel = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
};

export async function GET() {
  const headers: HeadersInit = { Accept: "application/json" };
  if (process.env.OPENROUTER_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=text&sort=most-popular", {
      headers,
      next: { revalidate: 3600 },
    });
    if (!response.ok) {
      return Response.json({ data: [], error: `OpenRouter models request failed (${response.status})` }, { status: response.status });
    }
    const payload = (await response.json()) as { data?: OpenRouterModel[] };
    const data = (payload.data ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      contextLength: model.context_length ?? 0,
      promptPrice: model.pricing?.prompt ?? "0",
      completionPrice: model.pricing?.completion ?? "0",
      structuredOutput: model.supported_parameters?.includes("response_format") ?? false,
    }));
    return Response.json({ data, count: data.length, authenticated: Boolean(process.env.OPENROUTER_API_KEY) });
  } catch (error) {
    return Response.json(
      { data: [], error: error instanceof Error ? error.message : "Unable to reach OpenRouter" },
      { status: 502 },
    );
  }
}
