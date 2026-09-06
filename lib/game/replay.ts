// 录像：把一局的每一季压成一帧，供网页播放器逐季回看。
//
// 存在的理由：这个引擎每季算出来的东西，此前只有两个出口——
// tools/match-log.mjs 把它 say() 成散文，tools/eval-run.mjs 的 records 只留
// 「模型选了哪些 key、花了多少 token」。**一格郡国、一支军团、一条日志都没落过。**
// 于是「这一局到底发生了什么」只能靠读两千行 Markdown。
//
// 三条设计约束：
//
// 1. **不复制对局循环。** 帧在已有的循环里顺手采，采集函数只读不写。
//    这个仓库为「复制一份迟早分家」栽过（见 eval-suite 开头那段注释）。
// 2. **帧要自足。** 不做跨帧增量——拖动进度条要能直接跳到第 40 季，
//    而不是从第 0 季累加。省下的那几十 KB 换不来那份 bug。
//    例外是 stations 与 capturedOfficers：它们单调累积，逐帧全量等于把
//    同一批人名抄 N 遍，48 季实测 15 万字节，比整个地图层还大。
// 3. **数组一律与 territory-grid.json 的 order 同序**（= commanderies.json 的
//    id 顺序，已核对逐位相同）。播放器画图时一趟循环、零次名字查表。
import { tierOf } from "./engine/intel.ts";
import { FORMATION_CN } from "./engine/combat.ts";
import { supplyReach } from "./engine/resolve.ts";
import { governorOf } from "./engine/officers.ts";
import { standingOf, gradeOf, GRADE_RANK, type Geography } from "./engine/victory.ts";
import type { Graph } from "./engine/actions.ts";
import type { Roster } from "./engine/officers.ts";
import type { EngineParams } from "./engine/params.ts";
import type { FactionId, GameState, Order } from "./engine/types.ts";

export const REPLAY_VERSION = "1.2.0";

/** 阵型 id 的顺序。**唯一来源是引擎的 FORMATION_CN**，帧里的 fm 是这个数组的下标 */
export const FORM_IDS = Object.keys(FORMATION_CN);

/** 一帧 = 一季**结算前**的局面 + 这一季下了什么 + 结算出了什么 */
export interface Frame {
  /** 年、季（1–4）、第几季（0 起）、纪元 */
  y: number; s: number; turn: number; epoch: number;
  /** 逐郡归属，势力下标；**−1 为无主** */
  own: number[];
  /**
   * 逐郡守军**档位**（1–9，档比 1.8），不是实数。
   *
   * 用 tierOf 算，与模型看到的迷雾同一把尺——播放器上显示的兵力档
   * 就是模型当时能看到的那个档。实数会让这一层从 21KB 涨到 102KB，
   * 而多出来的精度对「看一局发生了什么」没有用
   */
  gt: number[];
  /** 逐郡城防、民心档、产出档、阵型下标 */
  def: number[]; mor: number[]; yld: number[]; fm: number[];
  /** 逐郡太守的政治。**派生字段**，引擎里不存，录制时算 */
  gov: number[];
  /** 补给断绝的郡（下标）。也是派生的，每季由 supplyReach 现算 */
  cut: number[];
  /** 在外军团：[势力, 兵力, 所在郡, 目标郡（−1 为无）, 已围几季] */
  /** [势力, 兵力, 所在郡, 目标郡, 已围季, 在途季] */
  armies: Array<[number, number, number, number, number, number]>;
  /** 逐势力：[治所郡, 金, 令, 历史最高档, 终局档, 郡数, 控州, 州治, 出局] */
  fac: Record<number, [number, number, number, number, number, number, number, number, number]>;
  /** 本季新增日志：[类型, 势力（−1 为无主/天下）, 文本] */
  ev: Array<[string, number, string]>;
  /** 本季下达的命令：[势力, 动作类型, 主目标郡（−1 为无）] */
  orders: Array<[number, string, number]>;
  /** 武将驻地的**变化**：[武将 id, 郡下标]。−1 表示离任 */
  moves: Array<[string, number]>;
  /** 本季新增的被俘武将 id */
  captured: string[];
  /**
   * 各**模型席位**这一季的决策原文。
   *
   * 此前只录一席。单人局无所谓，但混战是两家对打——只看得到一边，
   * 「谁在算计谁」就无从谈起：实测一局里曹操写着「先与刘表缔盟求其退兵」，
   * 而刘表那一席同一季写的是继续围城，两条并排才读得出对抗。
   *
   * 只录模型席位，不录三十家机器人：候选全文六席全量实测每季 43KB，
   * 而决策原文（reason + plan + picks）六席也只有每季约 3KB
   */
  seats?: Array<{
    faction: number;
    picks: string[];
    dropped: Array<[string, string]>;
    reason: string | null;
    plan: string | null;
  }>;
}

export interface ReplayDict {
  /** 105 个郡 id，与 territory-grid.json 的 order 逐位相同 */
  com: string[];
  /** 郡名、所属州 */
  name: string[]; zhou: string[];
  /** 预乘好的画布坐标 [(lon−94)×55, (43−lat)×55]，与 play-base.webp 的 1815×1485 对齐 */
  xy: Array<[number, number]>;
  /** 势力 id / 名 / 色，下标即帧里的势力下标 */
  fac: string[]; facName: string[]; facColor: string[];
  /**
   * 邻接表（郡下标 → 邻郡下标）。播放器用它求**最大连通块**：
   * 势力名标在全部疆域的重心上会出事——张鲁一块在汉中、一块在云中，
   * 重心落在中间的无人区，看着像标错了地方。飞地多的时候更明显
   */
  adj: number[][];
  /** 阵型 id，下标即帧里的 fm */
  formation: string[];
}

export interface Replay {
  version: string;
  meta: Record<string, unknown>;
  dict: ReplayDict;
  frames: Frame[];
}

/**
 * 建索引。一局只做一次——帧里所有下标都指向这里。
 *
 * 郡的顺序**必须**取自 commanderies.json 的原序，不能用 Object.keys(s.commanderies)：
 * 后者是插入序，与 territory-grid 的 order 没有任何保证的关系，
 * 一旦分家，播放器画出来的疆域会整体错位而且看不出来。
 */
export function buildIndex(
  commanderies: Array<{ id: string; name: string; zhou: string;
                        longitude: number; latitude: number }>,
  factions: Array<{ id: string; name: string; color?: string }>,
  /** 忽略：阵型顺序由 FORM_IDS 定，留着只为不改调用方 */
  _formations: string[],
  edges: ReadonlyArray<{ from: string; to: string }> = [],
): { dict: ReplayDict; ci: Map<string, number>; fi: Map<string, number> } {
  const ci = new Map(commanderies.map((c, i) => [c.id, i]));
  const fi = new Map(factions.map((f, i) => [f.id, i]));
  return {
    ci, fi,
    dict: {
      com: commanderies.map((c) => c.id),
      name: commanderies.map((c) => c.name),
      zhou: commanderies.map((c) => c.zhou),
      // 投影与 app/play/PlayClient.tsx 的 MAP 常量同一套：等距圆柱，
      // 原点 (94°E, 43°N)，每度 55 像素。底图 play-base.webp 实测正好 1815×1485
      xy: commanderies.map((c) => [
        Math.round((c.longitude - 94) * 55 * 10) / 10,
        Math.round((43 - c.latitude) * 55 * 10) / 10,
      ]),
      fac: factions.map((f) => f.id),
      facName: factions.map((f) => f.name),
      facColor: factions.map((f) => f.color ?? "#8a8378"),
      formation: FORM_IDS,
      adj: (() => {
        const a: number[][] = commanderies.map(() => []);
        for (const e of edges) {
          const i = ci.get(e.from), j = ci.get(e.to);
          if (i === undefined || j === undefined) continue;
          a[i].push(j); a[j].push(i);
        }
        return a;
      })(),
    },
  };
}

/**
 * 采一帧。**纯读**：不改 state、不进 RNG，与 observe 同性质，
 * 因此不影响 R6（裁决顺序无关）与 R33（逐位重放）。
 *
 * 在**结算前**调用：帧描述的是「这一季开始时的局面 + 这一季下的令」，
 * 而 ev（本季日志）要在结算后补进来，见 attachOutcome。
 */
export function captureFrame(
  s: GameState, idx: { ci: Map<string, number>; fi: Map<string, number> },
  g: Graph, P: EngineParams, roster: Roster | null, geo: Geography,
  orders: readonly Order[],
  opts: { /** 各模型席位的决策原文，按下令顺序 */
          seats?: Array<{ faction: FactionId; picks?: string[];
                          dropped?: Array<[string, string]>;
                          reason?: string | null; plan?: string | null }>;
          /** 上一帧的驻地表，用来只记变化 */
          prevStations?: Record<string, string>;
          prevCaptured?: readonly string[] } = {},
): Frame {
  const { ci, fi } = idx;
  const n = ci.size;
  const own = new Array<number>(n).fill(-1);
  const gt = new Array<number>(n).fill(0);
  const def = new Array<number>(n).fill(0);
  const mor = new Array<number>(n).fill(0);
  const yld = new Array<number>(n).fill(0);
  const fm = new Array<number>(n).fill(0);
  const gov = new Array<number>(n).fill(0);

  // **从引擎导出，不手抄**。此前这里写的是 ["scale","crane","square"]，
  // 而引擎里是 "wings" 不是 "crane"——indexOf 返回 −1、被 Math.max(0,…) 兜成 0，
  // 于是回放里每一个鹤翼郡都显示成鱼鳞，而且不报错
  const FORMS = FORM_IDS;
  for (const c of Object.values(s.commanderies)) {
    const i = ci.get(c.id);
    if (i === undefined) continue;                 // 剧本里有而地图上没有的，跳过而不是塞进 -1
    own[i] = c.owner ? (fi.get(c.owner) ?? -1) : -1;
    gt[i] = tierOf(c.garrison, P);
    def[i] = c.defense;
    mor[i] = c.moraleTier;
    yld[i] = c.yieldTier;
    fm[i] = Math.max(0, FORMS.indexOf(c.formation));
    gov[i] = roster ? (governorOf(s, roster, c.id, P)?.politics ?? 0) : 0;
  }

  // 断供逐势力算，合成一张全图的表。supplyReach 是每季现算的派生量，
  // 状态里不存——播放器跑不了引擎，只能在这里算好
  const cut: number[] = [];
  const owners = new Set(Object.values(s.commanderies).map((c) => c.owner).filter(Boolean));
  for (const f of owners) {
    const reach = supplyReach(s, g, f as FactionId);
    for (const c of Object.values(s.commanderies)) {
      if (c.owner !== f) continue;
      const i = ci.get(c.id);
      if (i !== undefined && !reach.has(c.id)) cut.push(i);
    }
  }
  cut.sort((a, b) => a - b);

  const fac: Frame["fac"] = {};
  for (const [id, f] of Object.entries(s.factions)) {
    const k = fi.get(id);
    if (k === undefined) continue;
    const st = standingOf(s, geo, id as FactionId);
    const final = gradeOf(st, { commanderies: f.startCommanderies,
                                controlledZhou: f.startZhou, zhouSeats: f.startSeats });
    fac[k] = [
      f.capital ? (ci.get(f.capital) ?? -1) : -1,
      Math.round(f.gold), f.ap,
      GRADE_RANK[f.bestGrade], GRADE_RANK[final],
      st.commanderies, st.controlledZhou, st.zhouSeats,
      f.eliminated ? 1 : 0,
    ];
  }

  // 驻地只记**变化**：114 名武将逐季全量存，48 季就是十万字节，
  // 而实际每季动的不过三五个人
  const moves: Array<[string, number]> = [];
  const prev = opts.prevStations ?? {};
  for (const [oid, at] of Object.entries(s.stations)) {
    if (prev[oid] !== at) moves.push([oid, ci.get(at) ?? -1]);
  }
  for (const oid of Object.keys(prev)) {
    if (!(oid in s.stations)) moves.push([oid, -1]);
  }

  const prevCap = new Set(opts.prevCaptured ?? []);
  const captured = (s.capturedOfficers ?? []).filter((o: string) => !prevCap.has(o));

  return {
    y: s.year, s: s.season, turn: s.turn, epoch: s.epoch,
    own, gt, def, mor, yld, fm, gov, cut,
    // 第六位是「还要走几季才到城下」。在途的军团在图上该看得出来还在路上——
    // 否则播放器会把一支刚出发的远征军画成已经围住了城
    armies: s.armies.map((a) => [
      fi.get(a.faction) ?? -1, a.troops,
      ci.get(a.at) ?? -1, a.target ? (ci.get(a.target) ?? -1) : -1,
      a.siegeSeasons ?? 0, a.marchLeft ?? 0,
    ] as [number, number, number, number, number, number]),
    fac,
    ev: [],
    orders: orders.map((o) => {
      const a = o.action as { type: string; at?: string; target?: string; from?: string };
      const site = a.target ?? a.at ?? a.from;
      return [fi.get(o.faction) ?? -1, a.type,
              site ? (ci.get(site) ?? -1) : -1] as [number, string, number];
    }),
    moves, captured,
    ...(opts.seats?.length
      ? { seats: opts.seats.map((x) => ({
            faction: fi.get(x.faction) ?? -1, picks: x.picks ?? [],
            dropped: x.dropped ?? [], reason: x.reason ?? null, plan: x.plan ?? null })) }
      : {}),
  };
}

/**
 * 结算之后把这一季的日志补进帧。
 *
 * 日志是所有层里最大的一层（48 季实测四十多万字节），而其中大半是流水账：
 * 实测各类计数 treasury 937、govern 748、supply-cut 699、scout 635，
 * 而真正的破城 siege-win 全局只有 100 次。原样铺出来会比表格更难读——
 * 正好打掉「录像要比表格好读」这件事的目标。
 * 折掉的这几类在帧的其他字段里都查得到（国库在 fac、断供在 cut、内政在 yld/mor）
 */
const NOISE = new Set(["treasury", "govern", "scout", "appoint", "array"]);

/**
 * 外交与集结**折成一行计数**，不逐条铺。
 *
 * 实测 48 季一局留下 2444 条事件，其中 ally 623 + ally-break 492 + muster 314
 * 占了 58%——三十家机器人每季互相缔盟绝盟，而这份录像是用来看
 * 「这一局发生了什么」的。逐条铺出来每季 51 行，真正的破城（全局 84 条）
 * 会被埋在里面，正好打掉「录像要比表格好读」这件事的目标。
 * 界面那边（app/play/PlayClient.tsx）早就在这么折了。
 */
const FOLD: Array<[string, string]> = [
  ["ally", "起结盟"], ["ally-break", "起绝盟"], ["muster", "处集结"],
];

export function attachOutcome(frame: Frame, fresh: readonly {
  kind: string; faction?: string; text: string;
}[], fi: Map<string, number>): void {
  const folded = new Map<string, number>();
  const kept: Frame["ev"] = [];
  for (const e of fresh) {
    if (NOISE.has(e.kind)) continue;
    if (FOLD.some(([k]) => k === e.kind)) {
      folded.set(e.kind, (folded.get(e.kind) ?? 0) + 1);
      continue;
    }
    kept.push([e.kind, e.faction ? (fi.get(e.faction) ?? -1) : -1, e.text]);
  }
  const parts = FOLD
    .filter(([k]) => folded.get(k))
    .map(([k, cn]) => `${folded.get(k)} ${cn}`);
  if (parts.length) kept.push(["fold", -1, `本季天下另有 ${parts.join("、")}`]);
  frame.ev = kept;
}
