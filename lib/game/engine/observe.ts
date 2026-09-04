// 观测：某一席位这一季能看到的全部东西。
//
// 这是模型与引擎之间唯一的信息通道。三条硬约束：
//
// 1. **绝不出现 seed。** roll() 是 H(seed,年,季,势力,事件,序号) 的纯函数——
//    拿到 seed 就能反算情报偏差，把点估计还原成真值，整个迷雾作废。
//    这是唯一一个「泄漏即全盘作废」的字段。
// 2. **不塞 GameState。** 实测第 8 季时 JSON.stringify(state) 已 10 万字符，
//    且含全图真实守军、他方内政、他方情报表。
// 3. **只由白名单构成。** 新增字段要显式加进来，不能靠「过滤掉几个」——
//    过滤法在字段增长时必然漏。
import { listActions, type Graph, type Rules } from "./actions.ts";
import { visibleLog } from "./intel.ts";
import { supplyReach } from "./resolve.ts";
import { unitName, FORMATION_CN } from "./combat.ts";
import { retinueAt, isFiller } from "./officers.ts";
import type { Roster } from "./officers.ts";
import type { EngineParams } from "./params.ts";
import { briefFor, standingOf, GRADE_CN, type Geography } from "./victory.ts";
import type { Candidate, FactionId, GameState } from "./types.ts";

export const OBSERVATION_VERSION = "1.1.0";

export interface ObsCandidate {
  key: string;
  cost: number;
  label: string;
  /** 攻城预告。结构化给出，模型不必从文字里抠数 */
  forecast?: Candidate["forecast"];
  // Candidate.gain（取下此郡值什么）**故意不放进观测**，只走 label。
  // 与 forecast 不同：forecast 有四个数要比大小，抠文字容易错；
  // gain 的全部内容一句话就写完了，而结构化那份实测占 719 tok、
  // label 那份只占 169——同一件事花四倍的钱，还要顶破 6000 的闸门。
  // 机器人读的是 Candidate.gain 原件，不受此影响。
}

export interface Observation {
  version: string;
  /** 我是谁 */
  seat: { faction: FactionId; name: string; capital: string | null };
  /** 时钟。不含 seed */
  clock: { year: number; season: number; turn: number; totalTurns: number; epoch: number };
  /** 本季可用令数与结转 */
  /**
   * 本季令数。**用不完就作废**，最多结转 carryCap 条——所以它是「必须花掉的资源」，
   * 不是「别超过的上限」。实测不写明这一条，模型每季只花掉三成：
   * 它会拿免费的刺探与调任把 picks 填满，令数一条不动
   */
  budget: { ap: number; carried: number; carryCap: number;
            campaignAp: number; normalAp: number };
  /**
   * 国库与军费。金与令数是两条不同的约束：
   * 令数管「一季能做几件事」且几乎不结转，金**可积累**、按郡的贫富分布不均、
   * 且要为全部兵力持续付费。看不见国库就没法做「这季省着点」这类决策
   */
  treasury: { gold: number; upkeep: number };
  /** 现档与升档条件 */
  standing: {
    grade: string; commanderies: number; controlledZhou: number; zhouSeats: number;
    conquests: number;
    start: { commanderies: number; zhou: number; seats: number };
  };
  /** 态势简报：各州还差几郡即控制。这是「往哪打才算数」的唯一依据 */
  brief: string;
  /** 我的郡：自家账本，看得真切 */
  mine: Array<{
    id: string; zhou: string; garrison: number; defense: number;
    yieldTier: number; moraleTier: number; unit: string; gear: string;
    /** 本郡阵型。鱼鳞克鹤翼、鹤翼克方圆、方圆克鱼鳞，攻守各差一个缺口 */
    formation: string;
    /** 能随军的驻将（至多 retinueCap 人）。兵力上限 = 人数 × 每将统兵 */
    officers: string[];
    besiegedBy: FactionId | null;
    /**
     * 本郡是否**补给断绝**。断供则本季产出归零，且以此郡为后方的军团粮尽溃散。
     *
     * 这一项此前完全不在观测里，而它决定的事很大：一份实录里，袁术五郡断了四郡，
     * 模型在断供的汝南集结了 2033 人，当季就「后路断绝，粮尽溃散」——
     * 它的本季意图还写着「下季自汝南出兵取豫州」。
     * 规则摘要里讲了补给，观测里却看不见谁断了，等于让它蒙着眼睛按规则走
     */
    supplyCut: boolean;
  }>;
  /** 我在外的军团 */
  armies: Array<{ id: string; at: string; target: string | null; troops: number;
                  seasons: number; unit: string; gear: string }>;
  /** 现行盟约 */
  treaties: Array<{ with: FactionId; from: number; until: number }>;
  /** 上季战报：我方全部 + 天下大事 */
  report: { mine: string[]; world: string[] };
  /**
   * **我上季写下的跨季方略**。这是对局方唯一的记忆。
   *
   * 每次决策本来是无状态的：观测里全是「此刻的状态」，没有一条是
   * 「我上季打算干什么」——于是每季都在从零重想一遍，
   * 无法执行跨十几季的战役。而长局要打出统一，恰恰要求连续几十季朝一个方向使劲。
   * null 表示开局，或上一季没写
   */
  plan: string | null;
  /** 本季候选。模型只能从这里选，按 key 引用 */
  candidates: ObsCandidate[];
}

/**
 * 装配某席位的观测。纯读函数，在 resolve 之前调用，不进 RNG 序列——
 * 因此不影响 R6（裁决顺序无关）与 R33（逐位重放）。
 */
export function observe(
  s: GameState, faction: FactionId, g: Graph, P: EngineParams,
  roster: Roster | null, geo: Geography,
  opts: {
    nameOf?: (id: FactionId) => string; rules?: Rules; since?: number;
    /** 天下大事最多留几条 */
    worldCap?: number;
    /** 上季该席位自己写下的跨季方略。原样回传，是它唯一的记忆 */
    plan?: string | null;
  } = {},
): Observation {
  const nameOf = opts.nameOf ?? ((id: FactionId) => id);
  const f = s.factions[faction];
  const st = standingOf(s, geo, faction);
  const cands = listActions(s, faction, g, P, opts.rules, roster, nameOf, geo);
  const log = visibleLog(s, faction, opts.since ?? 0);
  // 补给连通分量：从治所出发，沿己方与借道盟友的郡国算。
  // 治所失守则整幅皆断——那是全图杠杆最高的一击
  const reach = supplyReach(s, g, faction);

  const mine = Object.values(s.commanderies)
    .filter((c) => c.owner === faction)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => ({
      id: c.id,
      zhou: geo.zhouOf.get(c.id) ?? "",
      garrison: c.garrison,
      defense: c.defense,
      yieldTier: c.yieldTier,
      moraleTier: c.moraleTier,
      unit: unitName(P, c.unit),
      gear: c.gear,
      formation: FORMATION_CN[c.formation],
      // 驻将：只报实际能随军的那几人（retinueCap），外加总数。
      // 全列出来会把观测撑爆——刘表十三郡各驻数人时峰值一度只剩 94 tok 余量，
      // 而多出来的名字对决策没有用：超过上限的人不随军也不加成
      officers: roster
        ? retinueAt(s, roster, c.id, P).filter((o) => !isFiller(o))
            .slice(0, P.retinueCap).map((o) => o.name)
        : [],
      besiegedBy: s.armies.find((x) => x.target === c.id)?.faction ?? null,
      supplyCut: !reach.has(c.id),
    }));

  return {
    version: OBSERVATION_VERSION,
    seat: { faction, name: nameOf(faction), capital: f?.capital ?? null },
    clock: {
      year: s.year, season: s.season, turn: s.turn,
      totalTurns: P.seasonsPerGame, epoch: s.epoch,
    },
    treasury: {
      gold: Math.round(f?.gold ?? 0),
      // 下季要交的军费：全部兵力 × 每兵每季
      upkeep: Math.round(
        (Object.values(s.commanderies).filter((c) => c.owner === faction)
          .reduce((n, c) => n + c.garrison, 0)
         + s.armies.filter((a) => a.faction === faction)
          .reduce((n, a) => n + a.troops, 0)) * P.goldUpkeepPerTroop),
    },
    budget: {
      ap: f?.ap ?? 0, carried: f?.carried ?? 0, carryCap: P.carryCap,
      campaignAp: opts.rules?.campaignAp ?? 2, normalAp: opts.rules?.normalAp ?? 1,
    },
    standing: {
      grade: GRADE_CN[f?.bestGrade ?? "ding"],
      commanderies: st.commanderies,
      controlledZhou: st.controlledZhou,
      zhouSeats: st.zhouSeats,
      conquests: st.conquests,
      start: {
        commanderies: f?.startCommanderies ?? 0,
        zhou: f?.startZhou ?? 0,
        seats: f?.startSeats ?? 0,
      },
    },
    brief: briefFor(s, geo, faction, g.adj, nameOf),
    mine,
    armies: s.armies.filter((a) => a.faction === faction).map((a) => ({
      id: a.id, at: a.at, target: a.target, troops: a.troops,
      seasons: a.siegeSeasons, unit: unitName(P, a.unit), gear: a.gear,
    })),
    treaties: s.treaties
      .filter((t) => t.a === faction || t.b === faction)
      .map((t) => ({ with: t.a === faction ? t.b : t.a, from: t.from, until: t.until })),
    plan: opts?.plan ?? null,
    report: {
      mine: log.filter((e) => e.faction === faction).map((e) => e.text),
      // 天下大事只留最近若干条。三十家势力一季能产出上百条公开事件，
      // 全铺出来会把观测预算吃掉一半，而模型真正需要的是最近的动向。
      // 砍这里而不砍候选：砍候选等于用观测预算去交换动作空间
      world: log.filter((e) => e.faction !== faction)
        .map((e) => `${e.faction ? `${nameOf(e.faction)}：` : ""}${e.text}`)
        .slice(-(opts.worldCap ?? 14)),
    },
    candidates: cands.map((c) => ({
      key: c.key, cost: c.cost, label: c.label, forecast: c.forecast,
    })),
  };
}

/** 观测里若出现这些，就是漏了。给测试用 */
export const FORBIDDEN_IN_OBSERVATION = ["seed"];

/**
 * 估算 token 数。系数由三家真实 tokenizer 标定，不是拍的。
 *
 * 拿 13 份真实提示词（规则摘要 + 各席位各季的观测，3.5k–13k 字符）
 * 逐条发给 OpenRouter 读 prompt_tokens，最小二乘拟合每字符的 token 数：
 *
 *   anthropic/claude-haiku-4.5   汉字 1.300  ASCII 0.446
 *   openai/gpt-5-nano            汉字 1.040  ASCII 0.420
 *   deepseek/deepseek-v3.2       汉字 0.855  ASCII 0.467
 *
 * 原系数是 0.9 / 0.25，把实际用量低估了 1.33–1.59 倍——错得最狠的是 ASCII：
 * 观测 JSON 里全是键名、标点、数字这类短片段，压不到四分之一个 token。
 * 于是「袁绍峰值 5828 / 预算 6000」这句话是假的，真实值约 9300。
 *
 * 取 Claude 的系数（三家里最保守，也正是本项目主要要评的对象）：
 * 预算闸门宁可报高，不可报低——报低会让人以为还有余量。
 */
export function estTokens(text: string): number {
  let cjk = 0, ascii = 0;
  for (const ch of text) { if (ch.codePointAt(0)! > 0x2e80) cjk += 1; else ascii += 1; }
  return Math.round(cjk * 1.3 + ascii * 0.45);
}
