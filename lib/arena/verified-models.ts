// 实测跑过整局的对局方。**这张表只收有实测数据的模型**，一条也不许凭印象填。
//
// 立这张表是因为选择器里有 428 个模型平铺着，而实测证明「便宜档」里
// 至少一半根本产不出正文：给榜选三个候选，qwen3.6-35b-a3b 有 25% 的季
// 把出参预算烧穿后返空、ling-3.0-flash-fin 是 84%，两个都带着
// `reasoning=low` 跑（docs/EVAL.md 第 27 条）。选择器不该把这些
// 与验过的混在一起按人气排序。
//
// 每局的钱是**实扣**，不是按价目表估的——价目表在重推理模型上会低估十倍
//（qwen 估 $1.61、实扣 $16.64）。
export type VerifiedModel = {
  id: string;
  /** 显示名。短，选择器里一行放得下 */
  label: string;
  /** 每局实扣（16 季）。除以 48 得整份榜的价 */
  usdPerGame: number;
  /** 一句话实测结论。给玩家看，也给两个月后的自己看 */
  note: string;
};

/** 见 docs/EVAL.md 第 24–27 条。48 局同 seed 同席位轮换，推理档 low */
export const VERIFIED_MODELS: VerifiedModel[] = [
  { id: "z-ai/glm-5.3-flash", label: "GLM 5.3 Flash", usdPerGame: 0.0375,
    note: "48 局榜分 223.9，与最强机器人分不开（+20.8 ±27.7）；非法率 3.8%" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", usdPerGame: 0.046,
    note: "48 局榜分 220.4；疆域倍数 2.10、48 局只被灭 1 次，最耐打" },
];

export const VERIFIED_IDS = new Set(VERIFIED_MODELS.map((m) => m.id));
