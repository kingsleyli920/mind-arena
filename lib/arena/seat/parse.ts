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
  /**
   * **跨季方略**。模型自己写，下一季原样还给它。
   *
   * 这是模型唯一的记忆。每次调用本来是无状态的：观测里有敌情、候选、上季战报，
   * 但没有一条是「我上季打算干什么」——于是它每季都在从零重想一遍，
   * 根本无法执行一场跨十几季的战役。而「统一天下」恰恰要求连续几十季朝一个方向使劲。
   *
   * 做成模型自己写、而不是回放它上季的 reason：reason 讲的是这一季，
   * 方略讲的是这一阶段；由它自己决定什么值得记，比我们替它挑更准
   */
  plan?: string;
}

/**
 * 决策的 JSON Schema。
 *
 * keyEnum=true（默认）把候选 key 写成 enum，「只能从候选里选」由解码层强制（R13）。
 *
 * 这一项曾被改成默认关闭，依据是「实测 enum 拦下的错误是 0」——**那个结论是错的**，
 * 它建立在每个模型只跑 1 局（16 季）的样本上。同规模放大到 6 局（96 季）后：
 *
 *   claude-haiku-4.5    均分    非法率   unknown-key   缓存
 *   enum 关            216.7    8.6%        47        45%
 *   enum 开            233.3    0.7%         0         0%
 *
 * 那 47 条是模型本想下而被丢掉的令，占它下令数的 8.3%。分差 +16.6 在 6 局下
 * 不算显著（见 docs/EVAL.md 的功效分析），但非法率的差是直接的机制性差异。
 * 而且逐字复现长中文 key 是转写能力不是策略能力，让它进分数是测错了东西。
 *
 * 代价是真实存在的：OpenRouter 把 json_schema 译成 Anthropic 的 tool，
 * 而 Anthropic 的缓存前缀顺序是 tools → system → messages——候选 key 每季都变
 * → tool 变 → 排在后面的 system 整块失效。system 占入参 38–52%，
 * 按缓存 0.1× 计价即 Claude 的入参贵约 2.8 倍。
 * 隔离实验（同一 system 连发两次，claude-haiku-4.5）：
 *   无 response_format        2nd cached 4317  ✓
 *   有，schema 恒定           2nd cached 4534  ✓
 *   有，schema 每次不同        2nd cached 0，重写整块  ✗
 *
 * 结论是拿正确性换钱，不是免费午餐。--keyenum=off 可换回缓存，
 * 换到的分数要按「该模型有 x% 的令被丢掉」来读。
 */
export function decisionSchemaForKeys(keys: readonly string[], keyEnum = true) {
  return {
    name: "season_orders",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["picks", "reason", "plan"],
      properties: {
        picks: {
          type: "array",
          maxItems: 16,
          items: keyEnum ? { type: "string", enum: [...keys] } : { type: "string" },
          description: "本季要下的令，按候选 key 逐字引用；顺序即优先级，令数不足时先保前面的",
        },
        reason: { type: "string", description: "一句话说明本季的意图" },
        plan: {
          type: "string",
          description: "跨季方略：这一阶段要达成什么、下几季朝哪个方向使劲。"
            + "下一季会把这句话原样还给你——这是你唯一的记忆，"
            + "没有它你每季都在从零重想。方向变了就改写它，没变就原样抄回来",
        },
      },
    },
  };
}

/** 同上，直接吃候选表。引擎侧用这个，API 路由只有 key 用上面那个 */
export function decisionSchema(candidates: readonly Candidate[], keyEnum = true) {
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
