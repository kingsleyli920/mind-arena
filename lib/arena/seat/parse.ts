// 模型输出的 schema 与宽容解析。
//
// 输出格式选「一季一次、给一串候选 key」而不是「逐令一次调用」：
// 逐令是 6–12 倍的成本，而且每取一条令都要重算候选表。代价是模型看不到
// 季内的中间结果——但引擎本来就是密封同时裁决，季内本无中间结果。
//
// key 用 enum 而不是下标：下标要求模型数数，而且候选表一变顺序就全错；
// enum 把「只能从候选里选」这条约束提升到解码层强制，而不是靠事后校验。
import type { Candidate } from "../../game/engine/types.ts";

export interface Decision {
  /** 本季要下的令，按 key 引用，顺序即优先级 */
  picks: string[];
  /** 一句话理由。用于审计，不进引擎 */
  reason?: string;
}

/**
 * 决策的 JSON Schema。
 *
 * keyEnum=true 时把候选 key 写成 enum，「只能从候选里选」由解码层强制。
 * 那是原设计，但它有个没算到的代价：schema 每季都变，而 OpenRouter 把
 * json_schema 译成 Anthropic 的 tool，Anthropic 的缓存前缀顺序是
 * tools → system → messages —— tool 一变，排在后面的 system 整块失效。
 * 实测同一 system 连发两次：schema 恒定则第二次 cached 4534，
 * schema 变则 cached 0 且重写整块。system 占入参 38–52%，
 * 等于「system 逐字节稳定才命中前缀缓存」这条设计被自己的 schema 打掉了。
 *
 * 默认因此是 false。依据是实测而非省钱：五个跑、四个模型
 * （haiku-4.5 / mistral-small / llama-3.1-8b / gpt-5-nano），
 * **unknown-key 一次都没出现过**——所有丢弃都是 rejected（引擎判组合不合法），
 * 而那是 enum 本来就拦不住的。也就是说 enum 拦下的错误是 0，
 * 代价是 Claude 的入参贵 2.8 倍（同局 A/B：178071 → 等效 63789）。
 *
 * 关掉之后「只能从候选里选」退回 admit() 逐条丢弃并计入 illegalRate。
 * 那不是失去保护：illegalRate 本来就是上报指标，将来真有模型开始
 * 编造 key，它会直接显示出来。要复现旧行为用 --keyenum=on。
 */
export function decisionSchemaForKeys(keys: readonly string[], keyEnum = false) {
  return {
    name: "season_orders",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["picks", "reason"],
      properties: {
        picks: {
          type: "array",
          maxItems: 16,
          items: keyEnum ? { type: "string", enum: [...keys] } : { type: "string" },
          description: "本季要下的令，按候选 key 逐字引用；顺序即优先级，令数不足时先保前面的",
        },
        reason: { type: "string", description: "一句话说明本季的意图" },
      },
    },
  };
}

/** 同上，直接吃候选表。引擎侧用这个，API 路由只有 key 用上面那个 */
export function decisionSchema(candidates: readonly Candidate[], keyEnum = false) {
  return decisionSchemaForKeys(candidates.map((c) => c.key), keyEnum);
}

/**
 * 宽容解析。模型即使不支持结构化输出，也常能给出可辨认的 JSON；
 * 完全解析不出时返回 null，由调用方记为「无回应」而不是当成「什么都不做」——
 * 两者在评测里含义不同。
 */
export function parseDecision(content: string): Decision | null {
  const text = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const tryParse = (src: string): Decision | null => {
    try {
      const v = JSON.parse(src) as { picks?: unknown; reason?: unknown };
      if (!Array.isArray(v.picks)) return null;
      const picks = v.picks.filter((x): x is string => typeof x === "string").slice(0, 16);
      return { picks, reason: typeof v.reason === "string" ? v.reason.slice(0, 400) : undefined };
    } catch { return null; }
  };
  const direct = tryParse(text);
  if (direct) return direct;
  // 退一步：从文字里抠出第一个 JSON 对象
  const m = /\{[\s\S]*\}/.exec(text);
  if (m) {
    const fromBlob = tryParse(m[0]);
    if (fromBlob) return fromBlob;
  }
  return null;
}
