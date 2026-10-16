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
  | "config"       // 模型 id 根本不存在 —— **配置错，不是模型答不上来**。
                   //   降档重试一点用没有，而且每一季都会以同样的方式失败：
                   //   实测把 `deepseek/deepseek-v4-flash-latest` 写进去跑了六局，
                   //   96 席·季全被记成「模型（答不上来）」，报告出了一行「均分 0.0」——
                   //   一个打错的 id 于是看上去像「这个模型得零分」
  | "auth"         // 401 / 403 —— 密钥无效，或这个模型不对本 key 开放。
                   //   **本行不可用，但不该杀整批**：403 常是单模型的数据策略问题，
                   //   按「额度耗尽」中止全部，是拿一个假归因换掉另一个假归因
  | "fatal";       // 其它 —— 说不清，停下

export interface Failure { kind: FailureKind; status: number; message: string }

export function classify(status: number, body: string): Failure {
  const message = body.slice(0, 400);
  if (status === 402) return { kind: "budget", status, message };
  if (status === 401 || status === 403) return { kind: "auth", status, message };
  // 5xx 一律当上游抖动重试。此前只列了 502/503/504，于是 500 与 Cloudflare 的
  // 52x/529 掉进 fatal，再被记成「模型答不上来」——那是提供方挂了，不是模型不会玩
  if (status === 429 || status === 408 || status >= 500) {
    return { kind: "retryable", status, message };
  }
  // 400/404 里要先挑出「这个模型不存在」。它与「本档请求参数不被端点接受」
  // 长得一样（都是 400），但处置完全相反：后者降一档可能就过了，前者降到底
  // 也永远过不了，而且它该算 harness 的配置错，不该进模型的分
  if ((status === 400 || status === 404)
      && /not a valid model|no endpoints found|model not found|unknown model/i.test(message)) {
    return { kind: "config", status, message };
  }
  if ([400, 404, 422].includes(status)) return { kind: "degradable", status, message };
  return { kind: "fatal", status, message };
}

/** 指数退避，带抖动。上游给了 Retry-After 就听它的 */
export function backoffMs(attempt: number, retryAfter?: string | null): number {
  const hinted = retryAfter ? Number(retryAfter) * 1000 : NaN;
  if (Number.isFinite(hinted) && hinted > 0) return Math.min(60_000, hinted);
  return Math.min(30_000, 800 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
}
