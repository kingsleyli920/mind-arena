// 适性：武将身上那几个标签，既参与结算，又要显示。
//
// 它们在数据里是中文字符串（officers.json 的 `aptitudes: ["山地", "攻城"]`），
// 引擎里直接拿字面量比：`o.aptitudes.includes("攻城")`。这是 docs/I18N-PLAN.md
// 阶段 0 点名的「既是逻辑又是显示」那一类——散落的字面量没有全集，
// 数据里写错一个字（「守成」之于「守城」）不会报错，只会让那个武将的加成
// **永远不触发**，而他看上去一切正常。
//
// **id 仍然是中文，这是有意的。** 见 I18N-PLAN 第三节：候选的 key 与观测都要留在
// 中文，换了语言则新旧榜不可比。所以这里不是「把中文换成英文 id」，是把那几个
// 字面量收到一处、给出全集、并把显示名单列出来——英文界面要的是另一张显示表，
// 而不是另一套 id。
import type { EngineParams } from "./params.ts";

/** 适性全集。改这里要同步 tests/aptitude.test.mjs 与 officers.json 的考订 */
export const APTITUDES = ["攻城", "守城", "治民", "水战", "山地", "说客"] as const;
export type Aptitude = (typeof APTITUDES)[number];

/** 按用途命名，省得在引擎里散落字面量 */
export const APT = {
  siege: "攻城",
  defend: "守城",
  govern: "治民",
  naval: "水战",
  mountain: "山地",
  envoy: "说客",
} as const satisfies Record<string, Aptitude>;

/**
 * 显示名。今天与 id 逐字相同——中文界面里本该如此。
 *
 * 单列一张表不是多余：它是「id 与显示名是两件事」这句话在代码里的落点。
 * 英文界面要加的是这张表的另一份，而不是另一套 id。
 */
export const APTITUDE_CN: Record<Aptitude, string> =
  Object.fromEntries(APTITUDES.map((a) => [a, a])) as Record<Aptitude, string>;

/**
 * 适性与地形的对应。攻城/守城适性不看地形，单列。
 *
 * 注意 `说客` 在引擎里**一处逻辑都没有**：officers.json 里有 50 名武将带着它，
 * 而它既不进战斗也不进内政，只在候选标签上露个脸。这不是 bug（它是显示用的），
 * 记在这里是因为「某个适性没人读」从代码里看不出来，而闸会盯着它。
 */
export const TERRAIN_APTITUDE: Partial<Record<string, Aptitude>> = {
  mountain: APT.mountain, hill: APT.mountain, river: APT.naval,
};

export const hasApt = (o: { aptitudes: string[] } | null, a: Aptitude) =>
  !!o && o.aptitudes.includes(a);

/** 地形给的适性加成。把「查地形 → 查适性 → 取系数」三步收在一处 */
export function terrainAptitudeBonus(
  o: { aptitudes: string[] }, terrain: string, P: EngineParams,
): { mul: number; note: string | null } {
  const apt = TERRAIN_APTITUDE[terrain];
  if (!apt || !o.aptitudes.includes(apt)) return { mul: 0, note: null };
  return { mul: P.aptitudeTerrainBonus, note: `${APTITUDE_CN[apt]}适性` };
}
