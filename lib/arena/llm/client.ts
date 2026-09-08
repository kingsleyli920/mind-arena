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
 * 每个模型学到的最高可用档位。**按模型 id 记，作用域是整个进程**
 *（不是按客户端实例——这里曾经写着「按实例」，而代码一直是模块级的）。
 * 键是模型 id，所以 melee 那种一进程多模型的跑法不会互相串味。
 *
 * 阶梯原本每次调用都从头试。实测 qwen3.7-flash 打一整局：
 * `档位：schema-any 16`——十六次决策全都降到第三档，也就是每次都要
 * 先被 schema 拒一次、再被 schema-notemp 拒一次，一个决策发三个请求。
 * 一局白发 32 个请求，48 局就是一千五百多个；时间三倍，钱也三倍。
 *
 * 记住之后从该档起步。**只记不忘**：档位只会因为再次被拒而下降，
 * 不会自己升回去——升回去等于把刚学到的东西每次都再交一遍学费。
 */
const learned = new Map<string, number>();

/**
 * 某个「模型×档位」被拒过几次。**要两次才作数**，一次不记。
 *
 * 起因是一次真实的误判：qwen3.7-flash 的上游在并发下限流，
 * OpenRouter 把提供方的错误裹成 4xx 转出来——本档的参数明明没问题，
 * 却被当成「这个模型不支持结构化输出」写进 learned，此后**整个进程**
 * 都在 text 档跑。而档位不是无关紧要的细节：候选 key 的 enum 一失效，
 * 实测非法率 0.7% → 8.6%、unknown-key 0 → 47（见 docs/EVAL.md）。
 * 一次限流就把「测策略」悄悄换成了「测中文转写」。
 *
 * 本次调用照样当场降档——总得先把这一季答出来；只是不写进记忆。
 * 真不支持的模型第二次还会被拒，代价只是多试一轮
 */
const rejects = new Map<string, number>();

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

/**
 * 每个模型学到的出参预算。与降级梯的 learned 同一个道理：
 * 交过的学费不该每季再交一遍。
 *
 * 实测 deepseek-v4-flash 打真实观测：出参 419 万 token 里 **400 万是推理**
 *（每次 5305 tok），一份 48 局的跑里 **129/756 季**被推理顶到饥饿、翻倍重试。
 * 那 129 次里每一次都白发了一个 8000 tok 的请求——钱照付、时间照花，
 * 而 harness 明明在第一次就知道了「这个模型要更大的预算」。
 *
 * 只涨不落，和档位同理：落回去等于把学费再交一遍。上限仍是
 * MAX_MAX_TOKENS，且只在**真的饿过**之后才涨——没饿过的模型照旧用默认值，
 * 不然一个不推理的模型也会被拖去发大预算的请求（提供方按上限预留算力，
 * 排队会变慢）。
 */
const learnedBudget = new Map<string, number>();
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
  /**
   * 单次调用的超时。默认 300s——原值 180s 对慢提供方不够：
   * deepseek 单次实测 38–69s，八路并发下常顶穿，而超时会被误记成模型的失败
   */
  timeoutMs?: number;
  /**
   * 推理档位。不传则各模型用自己的默认值——实测 gpt-5-nano 每次调用烧
   * 6739 出参 token（97.7% 是 reasoning），而 claude-haiku-4.5 只烧 103，
   * 相差 65 倍。不控这一项，比的就不是策略能力而是各家默认给多少测试时算力。
   * 控与不控都说得通（「按出厂设置比」也是一种口径），但必须是显式选择，
   * 且无论选哪种，reasoning token 都记进结果
   */
  reasoning?: { effort: "low" | "medium" | "high" } | { max_tokens: number };
  /**
   * 钉住提供方。OpenRouter 默认按可用性路由，同一个模型 id 会在不同提供方
   * 之间跳——一份 24 季的实录里跳了 **7 家**（Parasail / Cloudflare / Fireworks /
   * Together / Venice / NextBit / Morph）。后果有三：
   *   一、量化精度与上下文实现各家不同，「同一个模型」其实不是同一个东西；
   *   二、单季用时中位 11.2s 而最慢 511.2s，差 45 倍，慢的那次还超时断流；
   *   三、前缀缓存几乎不命中（197k 入参里只命中 4k，2%）——缓存是按提供方存的。
   * 评测要可比就得钉住；对局图省事可以不钉
   */
  provider?: { order: string[]; allow_fallbacks?: boolean };
}

export interface ChatResult {
  content: string;
  model: string;
  usage: {
    prompt: number; completion: number; cached: number;
    /** 出参里被推理吃掉的部分。推理模型的真实成本在这里，不在 content 长度上 */
    reasoning: number;
    /**
     * 提供方回报的**真实扣费**（美元）。取不到则 null。
     *
     * 这一项优先于「按价目表乘 token 数」重算。同一局实测：价目表算出 $0.0081，
     * 而提供方自报 $0.0162——**价目表少算一半**。两个原因叠加：
     *   一、/models 报的是该模型的**最低**价，而 OpenRouter 实际路由到的
     *       提供方可能更贵；
     *   二、有的提供方 completion_tokens **不含** reasoning
     *      （一次回包里 completion 26、reasoning 38），而计费按两者之和。
     * 余额有限时，一个少算一半的预算表就是「以为花五块、实际花十块」，
     * 正好复刻历史上那次跑到一半没钱、产出一份假榜的事故。
     *
     * 校准方法要留一句：**别拿账户余额端点做短窗口校准**——实测 5 次调用后
     * 余额一动不动，它有分钟级结算延迟，短窗口的「余额差」里混着上一批的尾账。
     * 要核就核累计：充值后余额共掉 $0.088，同期各次 usage.cost 合计 $0.086，
     * 吻合到 2% 以内
     */
    cost: number | null;
  } | null;
  /** 实际用的是结构化输出还是退回了自由文本。等价于 rung !== "text" */
  structured: boolean;
  /** 实际落在哪一档。评测报告要按档位分组，否则跨模型的分数不可比 */
  rung: Rung;
  /**
   * 本次调用里因推理吃光出参而翻倍重试的次数。
   *
   * 与 maxTokens 不是一回事：预算按模型记忆之后，后面每一季都**从**提高后的
   * 预算起步却一次没重试。报告里曾拿 `maxTokens > 8000` 当重试数，
   * 于是一份 766 季的跑报出「757 季被推理顶到翻倍重试」——听着像 harness
   * 快散架了，实际上那正是记忆在起作用
   */
  starved: number;
  /** 最终用的出参预算。被饿死翻倍过就与请求值不同 */
  maxTokens: number;
  finishReason: string | null;
  attempts: number;
  elapsedMs: number;
  /**
   * 实际服务的提供方，与 OpenRouter 的 generation id。
   *
   * 同一个模型 id 可能被路由到不同提供方，量化精度、上下文长度、
   * 速率限制都不同，而响应里的 model 字段照旧是你请求的那个 id——
   * 只看它看不出换了底座。留下这两项，事后才能回查这一列分数是谁跑出来的
   */
  provider: string | null;
  generationId: string | null;
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
  /** OpenRouter 的 generation id，可回查 /api/v1/generation */
  id?: string;
  /** 实际服务的提供方。OpenRouter 会静默改路由，只看 model 字段看不出来 */
  provider?: string;
  choices?: RawChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
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
    // 被丢弃的那次尝试**照样计费**。只报最后一次的扣费会系统性少算：
    // 实测一局里有 1 季被推理顶到翻倍重试，自报 $0.0200 而实扣 $0.0226，
    // 差的正是那一次被丢掉的请求。重试是 harness 自己的浪费，
    // 更应该算进账里——不然「加大出参预算」这类决定就是在拿看不见的钱做的
    let costAccum = 0;
    const maxAttempts = this.opts.maxAttempts ?? 6;
    // 没给 schema 就直接从 text 档起步，不必把上面三档白试一遍
    let rungIdx = req.schema ? (learned.get(req.model) ?? 0) : LADDER.length - 1;
    let budget = Math.max(req.maxTokens ?? DEFAULT_MAX_TOKENS,
                          learnedBudget.get(req.model) ?? 0);
    let attempts = 0;
    let starved = 0;
    let last: Failure | null = null;

    while (attempts < maxAttempts) {
      attempts += 1;
      const rung = LADDER[rungIdx];
      const res = await this.once(req, rung, budget).catch((e: unknown) => e as Error);
      if (res instanceof Error) {
        // 超时与网络错都是**基础设施**问题，不是模型答不上来。
        // 实测 deepseek 单次 38–69s、八路并发下顶穿 180s，
        // 于是 35/96 季被记成「模型答不上来」——评测据此排名就是在惩罚慢的提供方
        last = { kind: "infra", status: 0, message: res.message };
        await sleep(backoffMs(attempts));
        continue;
      }

      if (res.ok) {
        // 读 body 也会失败，而且失败得很难看：慢提供方常在响应中途断流，
        // 抛的是原始的 `The operation was aborted due to timeout`。
        // 此前这一行没有任何保护——异常直接穿出 chat()，不带分级、不重试，
        // 于是被记成 harness（一份实录里真的出现过：尝试 0、用时 0.0s、
        // 那一季一条令都没下）。发出去的请求钱照付，却连一次重试都没有。
        // 归 infra 并重试：这与「fetch 阶段超时」是同一件事，只是断在后半程
        const json = await res.json().catch((e: unknown) => e as Error) as RawResponse | Error;
        if (json instanceof Error) {
          last = { kind: "infra", status: res.status,
                   message: `读取响应失败：${json.message}` };
          await sleep(backoffMs(attempts));
          continue;
        }
        const choice = json.choices?.[0];
        const content = choice?.message?.content ?? "";
        const finishReason = choice?.finish_reason ?? null;
        const completion = json.usage?.completion_tokens ?? 0;
        const reasoning = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
        // 每次尝试都累加，包括下面因饥饿被丢弃的那一次
        if (typeof json.usage?.cost === "number") costAccum += json.usage.cost;

        // 出参被推理吃光了。这是我们的配置问题，不是模型答不上来，
        // 两者在评测里含义完全不同。翻倍再给一次机会。
        //
        // **finish_reason 为 length 本身就是决定性的**——那是我们把它砍断了。
        // 此前这里还要求 content 为空，于是漏掉了一半的情形：
        // 重推理模型常常先吐几百 token 的自言自语才开始写 JSON，被砍断时
        // content 非空但没有决策，落到解析失败那条路上，记成「模型答不上来」。
        // 实测 nemotron-3-ultra 打真实观测：8000 出参里 7244 是 reasoning，
        // finish=length，content 是一段没写完的英文分析——按旧条件不翻倍，
        // 直接被判成模型不会玩。
        //
        // 「无 finish_reason 但出参逼近上限」这条启发式仍要求 content 为空，
        // 否则一次正常收尾的长回答会被误判成饥饿
        if ((finishReason === "length" || (!content.trim() && completion >= budget * 0.95))
            && starved < 2 && budget < MAX_MAX_TOKENS) {
          starved += 1;
          last = { kind: "starved", status: 200,
                   message: `出参预算 ${budget} 被推理占满（reasoning ${reasoning}），已翻倍重试` };
          budget = Math.min(budget * 2, MAX_MAX_TOKENS);
          // 记住：下一季直接从这个预算起步，不再白发一个注定被砍断的请求
          learnedBudget.set(req.model, Math.max(learnedBudget.get(req.model) ?? 0, budget));
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
            cost: costAccum || (typeof json.usage.cost === "number" ? json.usage.cost : null),
          } : null,
          structured: rung !== "text",
          rung, maxTokens: budget, starved, finishReason,
          provider: json.provider ?? null, generationId: json.id ?? null,
          attempts, elapsedMs: Date.now() - started,
        };
      }

      last = classify(res.status, await res.text());
      // 本档的参数组合不被任何端点接受 —— 降一档重来，而不是一步退到自由文本。
      // 此前 404 直接把结构化输出整个丢掉，而实测只要去掉 temperature 就能过
      if (last.kind === "degradable" && rungIdx < LADDER.length - 1) {
        // 同一档被拒到第二次才写进记忆——第一次可能只是上游抖了一下
        const k = `${req.model}\u0000${rung}`;
        const n = (rejects.get(k) ?? 0) + 1;
        rejects.set(k, n);
        rungIdx += 1;
        // 学到了就记住：下次直接从这一档起步，不再把前面那几档重交一遍学费
        if (n >= 2) learned.set(req.model, Math.max(learned.get(req.model) ?? 0, rungIdx));
        continue;
      }
      if (last.kind !== "retryable" && last.kind !== "infra") break;
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
    if (req.reasoning) body.reasoning = req.reasoning;
    if (req.provider) {
      // 与下面 require_parameters 那一项合并：两者都写在 provider 下
      body.provider = { ...req.provider, allow_fallbacks: req.provider.allow_fallbacks ?? false };
    }
    if (rung !== "text" && req.schema) {
      body.response_format = { type: "json_schema", json_schema: req.schema };
      // 宁可 404 也不要静默忽略：某些端点会当没看见 response_format。
      // 但 404 之后要降档重试，不能就此把结构化输出丢掉
      if (rung !== "schema-any") {
        body.provider = { ...(body.provider as object ?? {}), require_parameters: true };
      }
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
      signal: AbortSignal.timeout(req.timeoutMs ?? 300_000),
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
