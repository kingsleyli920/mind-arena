// 调用失败的分级。
//
// 分级决定重试策略，也决定评测报告怎么记：
// 「模型答不上来」与「网关抖了一下」在评测里是完全不同的事，
// 混成一个「失败」计数，等于把基础设施的问题算到模型头上。
export type FailureKind =
  | "retryable"    // 429 / 502 / 503 —— 上游暂时不可用，退避后重试
  | "infra"        // 超时 / 网络错 —— 基础设施，**绝不能记成模型答不上来**
  | "degradable"   // 400 / 404 / 422 —— 本档请求参数不被端点接受，降一档重试
  | "starved"      // HTTP 200 但内容为空、出参顶到上限 —— 推理把预算吃光了
  | "budget"       // 402 —— 余额或额度耗尽，整跑停下
  | "fatal";       // 401 / 403 / 其它 —— 配置问题，停下

export interface Failure { kind: FailureKind; status: number; message: string }

export function classify(status: number, body: string): Failure {
  const message = body.slice(0, 400);
  if (status === 402) return { kind: "budget", status, message };
  if ([429, 408, 502, 503, 504].includes(status)) return { kind: "retryable", status, message };
  if ([400, 404, 422].includes(status)) return { kind: "degradable", status, message };
  return { kind: "fatal", status, message };
}

/** 指数退避，带抖动。上游给了 Retry-After 就听它的 */
export function backoffMs(attempt: number, retryAfter?: string | null): number {
  const hinted = retryAfter ? Number(retryAfter) * 1000 : NaN;
  if (Number.isFinite(hinted) && hinted > 0) return Math.min(60_000, hinted);
  return Math.min(30_000, 800 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
}
