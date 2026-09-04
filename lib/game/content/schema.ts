// 游戏内容的类型契约。
//
// 设计原则：**规则即数据**。动作、常数、地形、兵种、特技全部写在 JSON 里，
// 引擎只负责按数据执行。这样做的直接收益是——同一份定义既驱动引擎，
// 又能序列化进模型的提示词。规则若硬编码在 TS 中，就必须另写一份给模型看的
// 说明，两份必然随迭代漂移，模型算出来的和引擎结算的对不上。

/** 离散档位：模型只在有限选项里挑，不给连续值 */
export interface Tier {
  id: string;
  label: string;
  /** 该档对应的数值，含义由使用它的字段决定 */
  value: number;
  note?: string;
}

export interface ActionParam {
  name: string;
  /** target 由引擎按 targetKind 枚举出候选；tier 从 tiers 里选 */
  type: "commandery" | "node" | "officer" | "faction" | "tier" | "int";
  /** type 为 target 类时，限定候选范围 */
  scope?: "own" | "adjacent" | "any" | "enemy" | "neutral" | "unassigned";
  tiers?: Tier[];
  min?: number;
  max?: number;
  optional?: boolean;
  description: string;
}

export interface ActionCost {
  /** 全局行动点。与领土脱钩、不可囤积，防止大势力动作数爆炸 */
  ap?: number;
  /** ap 为 0 时必须给出每季次数上限——免费不等于无限，
   *  否则模型可以一季刺探全图，观测预算与博弈深度双双失守 */
  freeUses?: number;
  gold?: number;
  grain?: number;
  /** 表达式，变量由引擎在校验时注入 */
  formula?: string;
}

export interface ActionDef {
  id: string;
  name: string;
  category: "military" | "civil" | "diplomacy" | "personnel" | "intel";
  /** 给模型看的一句话说明，必须写清"什么时候该用它" */
  summary: string;
  params: ActionParam[];
  cost: ActionCost;
  /** 前置条件的自然语言表述，供模型理解；引擎另有代码校验 */
  preconditions: string[];
  /** 效果的自然语言表述 */
  effects: string[];
  /** 生效延迟（**季**）。0 表示立即。引擎里没有「旬」这个时间单位，一切按季 */
  delay?: number;
  /** 是否为持续命令：下达后自动推进直到中断 */
  standing?: boolean;
}

export interface TerrainDef {
  id: string;
  name: string;
  /** 行军成本倍率 */
  marchCost: number;
  /** 守方防御加成 */
  defenseBonus: number;
  /** 该地形上的粮食产出倍率 */
  yieldFactor: number;
  description: string;
}

export interface UnitDef {
  id: string;
  name: string;
  /** 相克关系：被本兵种克制的兵种 id */
  strongAgainst: string[];
  attack: number;
  defense: number;
  /** 已废：引擎里没有粮这个量，金节明写「不另设兵粮」 */
  upkeep: number;
  marchSpeed: number;
  /** 招募所需，写成表达式或定值 */
  recruitCost: { gold: number; grain: number };
  description: string;
}

export interface SkillDef {
  id: string;
  name: string;
  /** 触发时机 */
  trigger: "battle" | "siege" | "march" | "civil" | "passive";
  /** 效果的机器可读描述 */
  effect: { stat: string; op: "add" | "mul"; value: number }[];
  summary: string;
}

/** 数值常数集中一处，模型可据此心算 */
export interface Constants {
  [group: string]: { [key: string]: number | string };
}

export interface VictoryCondition {
  id: string;
  name: string;
  /** 判据表达式，供引擎求值；同时给模型看 */
  test: string;
  description: string;
}

export interface ContentPack {
  version: string;
  scenario: string;
  actions: ActionDef[];
  terrain: TerrainDef[];
  units: UnitDef[];
  skills: SkillDef[];
  constants: Constants;
  victory: VictoryCondition[];
}

// ── 校验 ─────────────────────────────────────────────────────────────
// 不引入 zod 等依赖：内容包是自己产出的，需要的是"发现手误"，不是防御恶意输入。

export interface Issue { path: string; message: string }

function req(v: unknown, path: string, out: Issue[], type: string): boolean {
  if (v === undefined || v === null) { out.push({ path, message: `缺少 ${type}` }); return false; }
  if (type === "string" && typeof v !== "string") { out.push({ path, message: "应为字符串" }); return false; }
  if (type === "number" && typeof v !== "number") { out.push({ path, message: "应为数字" }); return false; }
  if (type === "array" && !Array.isArray(v)) { out.push({ path, message: "应为数组" }); return false; }
  return true;
}

export function validateContent(pack: ContentPack): Issue[] {
  const issues: Issue[] = [];
  req(pack.version, "version", issues, "string");
  req(pack.actions, "actions", issues, "array");

  const ids = new Set<string>();
  for (const [i, a] of (pack.actions ?? []).entries()) {
    const p = `actions[${i}]`;
    if (!req(a.id, `${p}.id`, issues, "string")) continue;
    if (ids.has(a.id)) issues.push({ path: `${p}.id`, message: `id 重复：${a.id}` });
    ids.add(a.id);
    req(a.name, `${p}.name`, issues, "string");
    req(a.summary, `${p}.summary`, issues, "string");
    if (!a.summary || a.summary.length < 8) {
      issues.push({ path: `${p}.summary`, message: "summary 要写清何时使用，太短模型看不懂" });
    }
    req(a.params, `${p}.params`, issues, "array");
    for (const [j, prm] of (a.params ?? []).entries()) {
      const pp = `${p}.params[${j}]`;
      req(prm.name, `${pp}.name`, issues, "string");
      req(prm.description, `${pp}.description`, issues, "string");
      if (prm.type === "tier" && (!prm.tiers || prm.tiers.length === 0)) {
        issues.push({ path: pp, message: "type=tier 必须给出 tiers" });
      }
      // 上限 5：内政有五个方针（劝农/募兵/修城/安民/治械）。
      // 卡在 4 会逼着包里少声明一条，而少声明的那条在引擎里照样存在——
      // 规则摘要于是向模型漏说了器械的来源
      if (prm.tiers && prm.tiers.length > 5) {
        issues.push({ path: pp, message: `档位 ${prm.tiers.length} 个，超过 5 个难以权衡` });
      }
    }
    if (!a.cost || (a.cost.ap === undefined && a.cost.gold === undefined
                 && a.cost.grain === undefined && !a.cost.formula)) {
      issues.push({ path: `${p}.cost`, message: "动作必须有代价，否则会被无限刷" });
    }
    if (a.cost?.ap === 0 && a.cost.freeUses === undefined) {
      issues.push({ path: `${p}.cost`, message: "免费动作必须声明 freeUses 每季上限" });
    }
    if (!a.effects?.length) issues.push({ path: `${p}.effects`, message: "缺少效果说明" });
  }

  const unitIds = new Set((pack.units ?? []).map((u) => u.id));
  for (const [i, u] of (pack.units ?? []).entries()) {
    for (const s of u.strongAgainst ?? []) {
      if (!unitIds.has(s)) issues.push({ path: `units[${i}].strongAgainst`, message: `未知兵种 ${s}` });
    }
  }
  return issues;
}

/**
 * 把内容包压成给模型看的规则摘要。
 * 引擎与提示词共用同一份定义，从根上杜绝"说明与实现漂移"。
 */
/**
 * 内容包里有两类文字：规则（模型该看）与开发者旁白（模型不该看）。
 *
 * 旁白里写着「差别定价会诱使模型算价而非算势」「无主自守是给早取无主之地
 * 一个时间价值」这样的话——那是在教模型该怎么想，会直接污染评测：
 * 测出来的不是它的策略能力，是它照抄提示的能力。
 * 还有大量「首版如何、实测如何、已修」的开发史，对局中一文不值却占 token。
 */
const COMMENTARY_KEYS = new Set([
  "接法", "产地判据", "登场判定", "损耗不对称", "caveat", "_note", "_why",
]);
/**
 * 键名里带这些字的一律是旁白。**用规则而不是白名单**——
 * 白名单每加一个新的注释键就漏一次：这次是「定价依据」，
 * 它把「满价把曹操的出局率从 42% 推到 57%」写进了模型读的规则摘要，
 * 既泄漏席位名（毁掉前缀缓存），也是在教模型怎么想。
 */
const COMMENTARY_KEY_RE = /说明|依据|理由|为何|意图|意义|教训|代价|注$/;
const COMMENTARY_RE = /实测|自对局|首版|此前|原先|等于没有|白送|装饰|评测|设计|踩过|漂移/;

function isCommentary(key: string, value: unknown): boolean {
  if (COMMENTARY_KEYS.has(key) || COMMENTARY_KEY_RE.test(key)) return true;
  return typeof value === "string" && COMMENTARY_RE.test(value);
}

export function toRulesDigest(pack: ContentPack): string {
  const lines: string[] = [`# 规则摘要 v${pack.version} · ${pack.scenario}`];

  lines.push("\n## 数值常数");
  for (const [group, kv] of Object.entries(pack.constants ?? {})) {
    const kept = Object.entries(kv).filter(([k, v]) => !isCommentary(k, v));
    if (!kept.length) continue;
    lines.push(`- **${group}**：` + kept.map(([k, v]) => `${k}=${v}`).join("，"));
  }

  lines.push("\n## 可用动作");
  for (const a of pack.actions ?? []) {
    const cost = [
      a.cost.ap !== undefined ? `${a.cost.ap} 行动点` : null,
      a.cost.gold ? `${a.cost.gold} 金` : null,
      a.cost.grain ? `${a.cost.grain} 粮` : null,
      a.cost.formula ?? null,
    ].filter(Boolean).join(" + ") || "无";
    lines.push(`\n### ${a.id} ${a.name}（${cost}${a.delay ? `，${a.delay} 季后生效` : ""}${a.standing ? "，持续命令" : ""}）`);
    lines.push(a.summary);
    for (const prm of a.params) {
      const opts = prm.tiers ? `：${prm.tiers.map((t) => `${t.id}(${t.label})`).join(" / ")}` : "";
      lines.push(`- 参数 \`${prm.name}\`（${prm.type}${prm.scope ? `/${prm.scope}` : ""}${prm.optional ? "，可省" : ""}）${prm.description}${opts}`);
    }
    if (a.preconditions.length) lines.push(`- 前置：${a.preconditions.join("；")}`);
    lines.push(`- 效果：${a.effects.join("；")}`);
  }

  if (pack.terrain?.length) {
    lines.push("\n## 地形");
    lines.push("| 地形 | 行军成本 | 守方加成 | 产出 |");
    lines.push("| --- | --- | --- | --- |");
    for (const t of pack.terrain) {
      lines.push(`| ${t.name} | ×${t.marchCost} | +${Math.round(t.defenseBonus * 100)}% | ×${t.yieldFactor} |`);
    }
  }
  if (pack.units?.length) {
    lines.push("\n## 兵种");
    lines.push("| 兵种 | 攻 | 防 | 粮耗 | 速 | 克制 |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const u of pack.units) {
      const s = u.strongAgainst.map((x) => pack.units.find((y) => y.id === x)?.name ?? x).join("、") || "—";
      lines.push(`| ${u.name} | ${u.attack} | ${u.defense} | ${u.upkeep} | ${u.marchSpeed} | ${s} |`);
    }
  }
  if (pack.victory?.length) {
    lines.push("\n## 胜负");
    for (const v of pack.victory) lines.push(`- **${v.name}**：${v.description}（判据 \`${v.test}\`）`);
  }
  return lines.join("\n");
}
