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

/** 按本季候选表生成 JSON Schema。keys 是 enum，模型选不出表外的东西 */
export function decisionSchema(candidates: readonly Candidate[]) {
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
          items: { type: "string", enum: candidates.map((c) => c.key) },
          description: "本季要下的令，按候选 key 引用；顺序即优先级，令数不足时先保前面的",
        },
        reason: { type: "string", description: "一句话说明本季的意图" },
      },
    },
  };
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
