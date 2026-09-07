"use client";

// 对局界面。
//
// 引擎是纯函数，直接跑在客户端：同一 seed 与同一命令必得同一结果，
// 服务端与浏览器算出来是一样的，不必为了「权威结算」多绕一层。
//
// 疆域不烤进底图。底图是中性地形（tools/render-terrain-map.mjs FACTIONS=0），
// 归属由 territory-grid 逐格查表后按当前局势实时着色——烤进去的疆域
// 一开打就不对了。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildGraph, listActions, validate, POLICY_CN, type Graph }
  from "@/lib/game/engine/actions.ts";
import { decide, PROFILES, type Profile } from "@/lib/game/engine/bot.ts";
import { buildRoster, stationedAt, type Roster } from "@/lib/game/engine/officers.ts";
import { observedGarrison, visibleLog, PUBLIC_EVENTS } from "@/lib/game/engine/intel.ts";
import { FORMATION_CN } from "@/lib/game/engine/combat.ts";
import { admit } from "@/lib/arena/seat/admit.ts";
import { modelDecide, type ModelTurnRecord } from "@/lib/arena/seat/model-seat.ts";
import { ProxyLlmClient } from "@/lib/arena/llm/proxy-client.ts";
import { GRADE_SCORE } from "@/lib/arena/scoring.ts";
import { Primer } from "./Primer.tsx";
import { PANEL_ORDER, TYPE_CN } from "./panels.ts";
import { save as saveGame, load as loadGame, clear as clearSave, packStamp,
  type SavedGame } from "@/lib/game/save.ts";
import { loadParams, marchSeasons, type EngineParams } from "@/lib/game/engine/params.ts";
import { createGame, refreshAp } from "@/lib/game/engine/setup.ts";
import { resolve, supplyReach } from "@/lib/game/engine/resolve.ts";
import { buildGeography, briefFor, standingOf, GRADE_CN, type Geography }
  from "@/lib/game/engine/victory.ts";
import type { Action, Candidate, GameState, Order } from "@/lib/game/engine/types.ts";
import { cmp } from "@/lib/game/engine/cmp";

/**
 * 瓦片金字塔。tools/slice-map-tiles.mjs 早就切好了四级
 * （z0 908×743 → z3 7260×5940，512 见方，webp，合计 5MB），
 * 而对局页此前一直只贴那张 1815 的整图——放大到六倍看的仍是同一张图放大六倍。
 *
 * 换成按视野取瓦片：屏上要多少像素就取哪一级，只加载看得见的那十几块。
 * z3 全级 180 块，实际同屏最多二十来块
 */
const TILES = "/game/map/tiles";
const TILE = 512;
const LEVELS = [
  { z: 1, w: 1815, h: 1485 },
  { z: 2, w: 3630, h: 2970 },
  { z: 3, w: 7260, h: 5940 },
];
/** 放大到几倍换哪一级：屏宽 × 倍数超过该级像素宽就该换下一级 */
const levelFor = (k: number, screenW: number) =>
  LEVELS.find((L) => L.w >= screenW * k) ?? LEVELS[LEVELS.length - 1];

const BASE = "/game/map/play-base.webp";
/**
 * 海波与云气。底图把陆地画得很足，海却是一片平色——传世舆图不这么画。
 * 单出一层是因为它要跟着海岸走、要避开陆地，那要读高程栅格（283MB），
 * 只能离线出（tools/render-map-decor.mjs）
 */
const DECOR = "/game/map/decor.webp";
// 放大后换高清一档。只有一张 1815 的话，k=6 是把它插值放大六倍，
// 越拉越糊——而底图本来就有 7260 的细节可用

/**
 * 汉字纪年。图题是竖排，阿拉伯数字在里面会一位一行地摞下来。
 *
 * 194 是兴平元年；195 兴平二年；196 起改元建安，建安元年至二十五年（220）。
 * 再往后本剧本够不着，兜底写成汉字数字
 */
const HAN_NUM = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
function hanNum(n: number): string {
  if (n <= 10) return n === 10 ? "十" : HAN_NUM[n];
  if (n < 20) return `十${HAN_NUM[n - 10]}`;
  const t = Math.floor(n / 10), o = n % 10;
  return `${HAN_NUM[t]}十${o ? HAN_NUM[o] : ""}`;
}
function eraName(year: number): string {
  if (year <= 193) return "初平四年";
  if (year <= 195) return year === 194 ? "興平元年" : "興平二年";
  const n = year - 195;                      // 196 = 建安元年
  // 建安止于二十五年（220）。再往后本剧本够不着，退回数字——
  // 竖排里靠 text-combine-upright 把三位数合成一格，不会一位一行地摞下来
  return n <= 25 ? `建安${n === 1 ? "元" : hanNum(n)}年` : `${year} 年`;
}

const SEASON_CN = ["", "春", "夏", "秋", "冬"];
/**
 * 面板顺序按「有多急」写死，不按 key 的字母序。
 * 字母序下实际是 ally → appoint → campaign → …→ relief 第六位：
 * 最不紧急的外交顶在最上面，而「救我被围的城」被十几条征伐压在滚筒里。
 */
/**
 * 候选的短标题。从 c.action 直接生成——界面手里本来就有结构化的动作对象，
 * 不必去解析引擎拼好的长句子（那正是机器人从 label 抠正则的老毛病）。
 * label 留作展开后的细节，观测的 token 成本不变。
 */
/**
 * 候选行的标题。**势力与武将一律取显示名，不许露 id**。
 *
 * 此前这里直接写 a.to / a.officer，于是标题栏是「与 lijue 缔盟」
 * 「任 weiyan 守 桂阳郡」，而下面那行灰字写着「与李傕、郭汜缔盟八季」
 * ——同一条候选，标题是机器 id、正文是人话。actions.ts 的注释早就写过
 * 「与 lijue 缔盟」这种写法两边都读不懂，只是界面这一层没照做。
 *
 * 方针的中文名走引擎的 POLICY_CN，不在这里再存第三份
 * （包里一份、actions.ts 一份，这里曾经还有一份）。
 */
function titleOf(
  a: Action,
  nameOf: (id: string) => string = (id) => id,
  officerOf: (id: string) => string = (id) => id,
): string {
  switch (a.type) {
    case "campaign":
      return a.from === a.target ? `${a.from} 出城迎战` : `自${a.from} 征 ${a.target}`;
    case "withdraw": return "自围城撤兵";
    case "muster": return `于${a.at} 集结`;
    case "govern": return `${a.at} ${POLICY_CN[a.policy] ?? a.policy}`;
    case "array": return `${a.at} 改${FORMATION_CN[a.to]}阵`;
    case "suade": return `招降 ${officerOf(a.officer)}`;
    case "submit": return `劝降 ${nameOf(a.to)}`;
    case "appoint": return `调 ${officerOf(a.officer)} 驻 ${a.at}`;
    case "scout": return `刺探 ${a.at}`;
    case "ally": return a.act === "form" ? `与${nameOf(a.to)}缔盟` : `与${nameOf(a.to)}绝盟`;
    case "passage": return `许${nameOf(a.to)}借道`;
    case "retire": return "归隐";
    default: return "";
  }
}

/** OpenRouter 模型列表的一行。价格是「每 token 美元」的字符串 */
type ModelRow = {
  id: string; name: string; contextLength: number;
  promptPrice: string; completionPrice: string; structuredOutput: boolean;
};

/**
 * 默认模型选一个**免费且实测跑得通**的。
 *
 * 免费不是为了省钱，是为了「打开就能试」：付费模型在账户余额为负时一律拒绝，
 * 而第一次点「让对手用大模型」的人如果直接撞上一条报错，
 * 他不会知道该去充值还是该改配置。
 *
 * 具体选哪个是实测出来的，不是挑的。拿真实观测（袁绍开局，system 6969 字、
 * user 13119 字、候选 60 条、带 enum 的 json_schema）把 18 个免费模型全跑一遍，
 * 只有 5 个能回出可解析且合法的决策：
 *   ✓ nemotron-3-super-120b-a12b   58.5s  推理 4085  挑 12 全合法  ← 用这个
 *   ✓ dots-3-note-preview          64.8s  推理 5374  挑  9 全合法
 *   ✓ minimax-m2.7                 85.0s  推理 4396  挑  4 全合法
 *   ✓ nemotron-3-nano-omni         99.2s  推理 4397  挑  1
 *   ✓ minimax-m3                  131.5s  finish=length，挑 7
 * 其余或 429/403，或把 8000 出参全烧在推理上被截断。
 * 尤其 nemotron-3-ultra-550b（曾经的默认）：7244 tok 推理、finish=length，
 * 一季要重试三次、拖十分钟——「参数量最大」和「能用」是两回事。
 */
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

/** 一次调用的花费（美元）。价格是每 token 的字符串，缓存命中部分仍按入参计价 */
function costOf(r: ModelTurnRecord, price: Map<string, ModelRow>): number {
  const m = price.get(r.model);
  if (!m || !r.usage) return 0;
  return r.usage.prompt * Number(m.promptPrice || 0)
       + r.usage.completion * Number(m.completionPrice || 0);
}

/** 兵力档的中文 */
const STRENGTH_CN: Record<string, string> = { skirmish: "偏师", main: "主力", allout: "倾国" };

/**
 * 终局时说清「差的那一步是什么」。对局中状态栏另有一句 nextStep，
 * 那句只报下一档的判据；这里要把现状与判据的差摊开算给玩家看。
 *
 * 判据是州级的（多控一州 / 多据一州治 / 多控两州），而整局十六季都在郡这一层
 * 做决定。只报一个「丁档」，玩家算不出自己离下一档差多少，也就无从改进——
 * 那正是十六季之后最该回答的问题。数字全部现算，与 victory.ts 的 gradeOf 同源。
 */
function endingGap(
  me: { bestGrade: string; startCommanderies: number; startZhou: number; startSeats: number },
  st: { commanderies: number; controlledZhou: number; zhouSeats: number; conquests: number },
): string {
  const zhouGain = st.controlledZhou - me.startZhou;
  const seatGain = st.zhouSeats - me.startSeats;
  if (me.bestGrade === "jia") return "已至甲档，本剧本的顶。";
  if (me.bestGrade === "yi") {
    const byZhou = 2 - zhouGain;
    const bySeat = zhouGain >= 1 ? 2 - seatGain : null;
    return `距甲档：再多控 ${byZhou} 州`
      + (bySeat !== null && bySeat > 0 ? `，或再多据 ${bySeat} 个州治` : "")
      + "。";
  }
  if (me.bestGrade === "bing") {
    return "距乙档：相对开局多控一整州（拥有该州过半郡国），或多据一个州治。"
      + `现控 ${st.controlledZhou} 州（开局 ${me.startZhou}）、`
      + `据 ${st.zhouSeats} 个州治（开局 ${me.startSeats}）。`;
  }
  // 丁档：拆开说，两个条件缺哪个是两回事——只捡无主之地永远拿不到丙
  const need: string[] = [];
  if (st.commanderies <= me.startCommanderies) {
    need.push(`郡数要高于开局（现 ${st.commanderies}，开局 ${me.startCommanderies}）`);
  }
  if (st.conquests < 1) need.push("且至少一郡是从他方手里夺来的（只捡无主之地不算进攻）");
  return need.length ? `距丙档：${need.join("，")}。` : "距丙档：条件已足，本局未及结算。";
}

/** 器械的中文名。与 actions.ts 的 GEAR_CN 同源，只是那边没导出给界面用 */
const GEAR_LABEL: Record<string, string> = { none: "无械", ram: "冲车", mound: "土山" };


type Bundle = {
  scenario: { factions: Array<{ id: string; name: string; color?: string; seat?: string;
                               courtesyName?: string; situation?: string }> };
  commanderyState: unknown; commanderies: Array<{ id: string; name: string; zhou: string;
    longitude: number; latitude: number }>;
  adjacency: { edges: Array<{ from: string; to: string; km: number; terrain: string; cost: number;
    crossings: string[]; nodes: Array<{ id: string; name: string; kind: string; offset: number }> }> };
  nodes: MapNode[];
  troopTypes: unknown; resources: unknown; provinceSeats: unknown;
  officers: unknown[]; pack: unknown;
};
type Territory = {
  meta: { west: number; north: number; cellSize: number; cols: number; rows: number; none: number };
  order: string[]; grid: string;
};

/** 关津港仓：非郡治的战略据点。图上画得出「这条路上卡着什么」全靠它 */
type MapNode = {
  id: string; name: string; kind: string;
  longitude: number; latitude: number; at: string | null;
};

type MapPoint = {
  id: string; name: string; zhou: string;
  longitude: number; latitude: number;
  households?: number | null; population?: number | null;
};

/** 剧本给的就是最终显示色，直接拆成 RGB。
 *
 * 这里曾有个 vivid() 做「提纯」：原配色是配墨底地图取的土色系，三十一家彼此难分，
 * 于是在渲染时统一拔高饱和度。那是在给数据层的毛病打渲染层的补丁，而且补不动——
 * 提纯只能拉开已有的间距，造不出本来就没有的间距，改完仍有 32 对势力 ΔE<18。
 * 现在配色在 tools/build-scenario-194.mjs 里就按「最大化最小色差」排好了，
 * 再提纯反而会把饱和度重新推到上限、把刚拉开的颜色又挤到一起。 */
function hexRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 逐通道方框模糊。只在 330×270 的归属栅格上跑（约 8.9 万像素），
 * 代价可忽略，且不依赖 ctx.filter 的浏览器支持。
 */
function blurRGBA(d: Uint8ClampedArray, w: number, h: number, r: number): void {
  const tmp = new Uint8ClampedArray(d.length);
  const win = r * 2 + 1;
  for (let c = 0; c < 4; c += 1) {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let acc = 0;
        for (let k = -r; k <= r; k += 1) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          acc += d[(y * w + xx) * 4 + c];
        }
        tmp[(y * w + x) * 4 + c] = acc / win;
      }
    }
    for (let x = 0; x < w; x += 1) {
      for (let y = 0; y < h; y += 1) {
        let acc = 0;
        for (let k = -r; k <= r; k += 1) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          acc += tmp[(yy * w + x) * 4 + c];
        }
        d[(y * w + x) * 4 + c] = acc / win;
      }
    }
  }
}

/**
 * 缩放的上下限。
 *
 * 上限从 6 提到 14：瓦片有 7260 那一级，六倍根本没用上；而更要紧的是
 * **图元要靠放大才分得开**——京兆尹与左冯翊图上只隔 16 像素，六倍下城印仍有
 * 34 像素宽，怎么拉都叠着。
 * 下限不是 1，是「铺满画框」那个倍数（minK）：画框比画心高时，1 倍会在
 * 上下留白，那正是「地图拉不开」的观感来源
 */
const K_MAX = 14;

/**
 * 以视野中心为锚点缩放。按 (0,0) 缩放的话，每按一次加号都往左上角跑，
 * 想看的地方反而离开视野。
 */
function zoomAt(v: { k: number; x: number; y: number }, mul: number, kMin = 1) {
  const k = Math.min(K_MAX, Math.max(kMin, v.k * mul));
  const lim = (n: number) => Math.min(0, Math.max(-(k - 1) * 100, n));
  // 视野中心在图上的归一化位置，缩放前后保持不变
  const cx = (0.5 - v.x / 100) / v.k;
  const cy = (0.5 - v.y / 100) / v.k;
  return { k, x: lim((0.5 - cx * k) * 100), y: lim((0.5 - cy * k) * 100) };
}

/** 「全图」：铺满画框，居中。画框比画心高时这不是 1 倍 */
function fitAll(kMin: number) {
  const k = Math.max(1, kMin);
  const lim = (n: number) => Math.min(0, Math.max(-(k - 1) * 100, n));
  return { k, x: lim((0.5 - 0.5 * k) * 100), y: lim((0.5 - 0.5 * k) * 100) };
}

/** 把某个经纬度移到视野中心 */
function centerOn(lon: number, lat: number, k: number, MAPX: typeof MAP) {
  const px = ((lon - MAPX.west) * MAPX.ppd) / MAPX.w;
  const py = ((MAPX.north - lat) * MAPX.ppd) / MAPX.h;
  const lim = (n: number) => Math.min(0, Math.max(-(k - 1) * 100, n));
  return { k, x: lim((0.5 - px * k) * 100), y: lim((0.5 - py * k) * 100) };
}

/** 底图尺寸与地理范围。SVG 用同一坐标系，图元尺寸才好按像素定 */
const MAP = { w: 1815, h: 1485, west: 94, north: 43, ppd: 55 };

/**
 * 城池图元。圆点看不出等级也看不出归属，只是「标了个位置」——
 * 这里按等级换不同的一幅：州治重檐带角楼、大郡带门楼、寻常郡一段城墙。
 * 图本身是 tools/render-map-glyphs.mjs 用画底图那支笔渲的（见下面 GLYPH 的注）。
 */
function CityMark({ x, y, size, fill, mine, seat: isSeat, besieged, detail, at }: {
  x: number; y: number; size: number; fill: string | null;
  mine: boolean; seat: boolean; besieged: boolean;
  /** 近观档：换更大的一幅，细节多一级 */
  detail?: boolean;
  /** 郡名。用来定取哪一幅——同一个郡永远同一幅 */
  at: string;
}) {
  // 三等城：州治重檐带角楼、大郡带门楼、寻常郡只一段墙。
  // 等级差别画在**笔墨里**，不靠加个小旗表示
  const kind = isSeat ? "city-seat" : detail || size > 26 ? "city-large" : "city-small";
  const id = `${kind}-${variantOf(at, kind)}`;
  const w = size * 2.3;
  const l = x - w / 2, t = y - w * GLYPH_BASE;
  return (
    <g className="city">
      {/* 纸色衬底：符号落在斑驳的墨底上，没有衬底就糊成一团。
          比早先的实心椭圆淡得多——笔墨版本身有飞白，压太实反而假 */}
      <ellipse cx={x} cy={y - w * 0.28} rx={w * 0.44} ry={w * 0.34} className="city-halo" />
      {besieged && <circle cx={x} cy={y - w * 0.3} r={w * 0.52} className="siege-ring" />}
      {/* 势力色刷在 wash 面上：mask 用 objectBoundingBox，一份 mask 供全图复用 */}
      <rect x={l} y={t} width={w} height={w} fill={fill ?? "#efe9dc"}
        mask={`url(#wash-${id})`} opacity={mine ? 1 : 0.88} />
      <image href={`${GLYPH}/${id}-ink.png`} x={l} y={t} width={w} height={w} />
    </g>
  );
}

/**
 * 图上符号的笔墨版，由 tools/render-map-glyphs.mjs 用画底图那支笔渲出。
 *
 * 为什么不再手写 <path>：底图是 brush.mjs 的笔锋（钉头鼠尾、飞白、墨度沿
 * 笔身衰减）加三十枚公有领域山水画的皴法图章画出来的，而符号是平涂加硬描边。
 * 两套工艺摆在一张图上，形状再怎么调也是贴纸压在画上。
 *
 * 每个符号两张：ink 是墨线（不随势力变），wash 是可上色的面——
 * 界面拿它作 mask 刷势力色，于是三十一家仍各有其色，而墨还是那支笔的墨
 */
const GLYPH = "/game/glyphs";
/**
 * 每类几幅。同一类城在图上出现几十次，一幅反复贴就是重复图案——
 * 那正是「元素堆砌」的观感来源。
 *
 * 这份表必须与 public/game/glyphs/manifest.json 对得上，
 * tests 里「符号变体数与渲出来的对得上」钉住这件事：贴一幅不存在的图，
 * 界面上是一个空洞，控制台一声不吭
 */
const GLYPH_N: Record<string, number> = {
  "city-small": 3, "city-large": 3, "city-seat": 2,
  gate: 3, pass: 2, ford: 2, port: 2, depot: 2, battlefield: 2, tent: 2, camp: 2,
};
/** 有可上色面的那几个 */
const WASHED = ["city-small", "city-large", "city-seat", "tent", "camp"] as const;
/** 符号画面里的地平线在 0.82 处：图元要**站在**那个点上，不是以它为心 */
const GLYPH_BASE = 0.82;
/**
 * 取哪一幅。按名字的哈希定：同一个郡永远是同一幅，
 * 换了席位、读了存档、翻到下一季都不变——图上的城不该每季换一副面孔
 */
function variantOf(id: string, kind: string): number {
  const n = GLYPH_N[kind] ?? 1;
  let h = 0x811c9dc5;
  for (const ch of `${kind}:${id}`) { h ^= ch.codePointAt(0) ?? 0; h = Math.imul(h, 0x01000193) >>> 0; }
  return h % n;
}

const NODE_CN: Record<string, string> = {
  gate: "关隘", pass: "谷道", ford: "渡口", port: "港口", depot: "粮仓", battlefield: "古战场",
};

/**
 * 关津港仓的图元。走过两版都被指出「粗糙」：
 *   一版 圆圈里写个「关」字——城印是画的、关津是写的，两套笔法摆在一张图上
 *   二版 手写 <path> 的矢量形——形状对了，可平涂加硬描边仍是「软件里的图标」
 * 现在是笔墨版：关是双阙夹券门上覆飞檐、道是两峰夹栈道、津是一叶横舟、
 * 港是舟上张帆、仓是两座圆囷、战是折戟交叉
 */
function NodeMark({ x, y, r, kind, id }: {
  x: number; y: number; r: number; kind: string; id: string;
}) {
  const w = r * 3.4;
  return (
    <g className={`node ${kind}`}>
      <ellipse cx={x} cy={y - w * 0.26} rx={w * 0.38} ry={w * 0.3} className="node-halo" />
      <image href={`${GLYPH}/${kind}-${variantOf(id, kind)}-ink.png`}
        x={x - w / 2} y={y - w * GLYPH_BASE} width={w} height={w} />
    </g>
  );
}

/**
 * 军团图元。在途画行营（帐上一面旗），待命画营垒（一列栅栏）——
 * 两者的处境不同：一个是「已经动了、还没到」，一个是「在家闲着」。
 * 帐面与栅面刷势力色，图上一眼看得出这支兵是谁的
 */
function ArmyMark({ x, y, s, color, marching, at }: {
  x: number; y: number; s: number; color: string; marching: boolean;
  /** 军团 id：同一支军团一路上是同一顶帐 */
  at: string;
}) {
  const kind = marching ? "tent" : "camp";
  const id = `${kind}-${variantOf(at, kind)}`;
  const w = s * 2.4;
  const l = x - w / 2, t = y - w * GLYPH_BASE;
  return (
    <g>
      <rect x={l} y={t} width={w} height={w} fill={color}
        mask={`url(#wash-${id})`} opacity={0.9} />
      <image href={`${GLYPH}/${id}-ink.png`} x={l} y={t} width={w} height={w} />
    </g>
  );
}

/**
 * 图上符号的笔墨版，由 tools/render-map-glyphs.mjs 用画底图那支笔渲出。
 *
 * 为什么不再手写 <path>：底图是 brush.mjs 的笔锋（钉头鼠尾、飞白、墨度沿
 * 笔身衰减）加三十枚公有领域山水画的皴法图章画出来的，而符号是平涂加硬描边。
 * 两套工艺摆在一张图上，形状再怎么调也是贴纸压在画上。
 *
 * 每个符号两张：ink 是墨线（不随势力变），wash 是可上色的面——
 * 界面拿它作 mask 刷势力色，于是三十一家仍各有其色，而墨还是那支笔的墨
 */

/** 边的地形怎么画。引擎按 cost 算行军天数，图上要看得出这条路难在哪 */
const EDGE_STYLE: Record<string, { stroke: string; dash: string; width: number }> = {
  plain:    { stroke: "#8a7c62", dash: "",       width: 1.5 },
  hill:     { stroke: "#7d7050", dash: "9 5",    width: 1.5 },
  mountain: { stroke: "#5d5443", dash: "3 6",    width: 1.7 },
  river:    { stroke: "#5b7f93", dash: "13 4 3 4", width: 1.7 },
  gate:     { stroke: "#7a3b32", dash: "",       width: 2.1 },
};
const EDGE_CN: Record<string, string> = {
  plain: "平道", hill: "丘陵", mountain: "山道", river: "水路", gate: "关道",
};

interface Engine {
  P: EngineParams; G: Graph; roster: Roster; geo: Geography;
  colorOf: Map<string, string>; nameOf: Map<string, string>;
  lore: Map<string, { courtesyName?: string; situation?: string }>;
  data: Parameters<typeof createGame>[0];
  /** 内容包原文。模型席位的 system 提示词由它渲染（renderSystem） */
  pack: unknown;
  /** 画点用的经纬度。SetupData 里的 commanderies 只声明 id/name */
  points: MapPoint[];
  /** 关津港仓 61 处 */
  nodes: MapNode[];
  /** 边的地形与关津。图上画路要用，引擎那边只认 cost */
  edges: Bundle["adjacency"]["edges"];
}

/** 图例里的小图与地图上的是同一段代码画的——另画一份必然与地图分家 */
const legendGlyph = (kind: string) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`${GLYPH}/${kind}-0-ink.png`} alt="" width={24} height={24} />
);
const legendArmy = (marching: boolean) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`${GLYPH}/${marching ? "tent" : "camp"}-0-ink.png`} alt="" width={24} height={24} />
);

/**
 * 瓦片层。只渲染**看得见**的那几块，且底下永远垫一张整图——
 * 瓦片是逐块加载的，没有垫底的话缩放瞬间会露出纸色的空洞。
 *
 * 位置一律用百分比：舞台本身被 scale(k) 变换，用百分比就不必跟着换算，
 * 且同一套式子对每一级都成立
 */
function TileLayer({ view, screenW }: {
  view: { k: number; x: number; y: number }; screenW: number;
}) {
  const L = levelFor(view.k, screenW);
  const cols = Math.ceil(L.w / TILE), rows = Math.ceil(L.h / TILE);
  // 视野在图上的归一化范围。舞台先 translate(%) 再 scale(k)，
  // 于是图上比例 f 落在屏幕 f·k + x/100 处，可见即 0 ≤ 该值 ≤ 1
  const fx0 = (-view.x / 100) / view.k, fx1 = (1 - view.x / 100) / view.k;
  const fy0 = (-view.y / 100) / view.k, fy1 = (1 - view.y / 100) / view.k;
  const pad = TILE / L.w;                       // 外扩一块，拖动时不至于现补
  const out: React.ReactElement[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x0 = (c * TILE) / L.w, x1 = Math.min((c + 1) * TILE, L.w) / L.w;
      const y0 = (r * TILE) / L.h, y1 = Math.min((r + 1) * TILE, L.h) / L.h;
      if (x1 < fx0 - pad || x0 > fx1 + pad || y1 < fy0 - pad || y0 > fy1 + pad) continue;
      out.push(
        // 文件名是 `${列}-${行}`（见 tools/slice-map-tiles.mjs 的 tx-ty），
        // 写成行-列会把整幅转置——第一版就是这样，图上出现了几道明暗错位的方块
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`${L.z}-${c}-${r}`} src={`${TILES}/z${L.z}/${c}-${r}.webp`} alt=""
          loading="eager" decoding="async"
          style={{ position: "absolute", left: `${x0 * 100}%`, top: `${y0 * 100}%`,
                   width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }} />,
      );
    }
  }
  return <div className="tiles">{out}</div>;
}

/**
 * 势力的城印。选席页与地图共用同一批画、同一套遮罩——
 * mask 的 id 是文档级的，所以只要页面上有那份 defs，哪儿都能引
 */
function SeatSigil({ color, id, kind }: { color: string; id: string; kind: string }) {
  const v = variantOf(id, kind);
  return (
    <svg className="sigil" viewBox="0 0 1 1" aria-hidden>
      <rect x="0" y="0" width="1" height="1" fill={color} mask={`url(#wash-${kind}-${v})`} />
      <image href={`${GLYPH}/${kind}-${v}-ink.png`} x="0" y="0" width="1" height="1" />
    </svg>
  );
}

/** 可上色面的遮罩。地图与选席页共用一份，故单独成一个组件挂在页面上 */
function WashDefs() {
  return (
    <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
      <defs>
        {WASHED.flatMap((kind) =>
          Array.from({ length: GLYPH_N[kind] ?? 1 }, (_, v) => (
            <mask key={`${kind}-${v}`} id={`wash-${kind}-${v}`} maskContentUnits="objectBoundingBox">
              <image href={`${GLYPH}/${kind}-${v}-wash.png`} x="0" y="0" width="1" height="1"
                preserveAspectRatio="none" />
            </mask>
          )))}
      </defs>
    </svg>
  );
}

/** 席位轮转出机器人画像。确定：同一局同一势力恒为同一画像 */
const PROFILE_KEYS = Object.keys(PROFILES) as Profile[];

export function PlayClient() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [terr, setTerr] = useState<{ meta: Territory["meta"]; idx: Uint8Array; order: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [seat, setSeat] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [flash, setFlash] = useState<{ mine: string[]; world: string[] }>({ mine: [], world: [] });
  const [focus, setFocus] = useState<string | null>(null);
  // 点城筛选。地图此前是纯装饰：要打南阳，得去右边面板展开征伐、
  // 在二十条一行文本里找「自X征南阳郡」。地图知道南阳在哪，面板不知道
  const [pinned, setPinned] = useState<string | null>(null);
  /** 指着哪个关津。它与郡的 focus 分开：两者常常挨着，共用一个状态会互相抢 */
  const [nodeTip, setNodeTip] = useState<MapNode | null>(null);
  const [onlyWinnable, setOnlyWinnable] = useState(false);
  // 本季与自己相关的易主。封令之后地图上什么都不动，你不知道刚才发生了什么——
  // 而全图一季平均易主 5.6 处，涉及自己的只有 0.4–1.2 处。
  // 全画等于把「什么都没动」换成「满屏都在闪」
  const [flips, setFlips] = useState<Array<{ id: string; gained: boolean; turn: number }>>([]);
  /** 载入时发现的旧存档。在选席页上给「继续上局」，而不是自动恢复——
      自动恢复会让「我想重开一局」变成一件要先找按钮的事 */
  const [resume, setResume] = useState<SavedGame | null>(null);
  /** 鼠标/键盘正指向的候选 key。用来在地图上画出「从哪打到哪」 */
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPrimer, setShowPrimer] = useState(false);

  // ── 模型执子 ──────────────────────────────────────────────────
  // 席位 → 模型 id。不在表里的势力仍由机器人执子。
  // 三十一家全用模型是不现实的：一季就是三十一次调用，等一分钟看一季
  const [modelOf, setModelOf] = useState<Record<string, string>>({});
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelPick, setModelPick] = useState(DEFAULT_MODEL);
  const [modelSeats, setModelSeats] = useState(0);
  const [thinking, setThinking] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // 逐次调用的记录。花了多少钱、哪一席没答上来、降到了哪一档，
  // 都从这里读——不留记录就只能看到「这季对手好像没动」
  const [records, setRecords] = useState<ModelTurnRecord[]>([]);
  const [since, setSince] = useState(0);
  // 各模型席位跨季的方略。模型自己写，下季原样回传——这是它唯一的记忆。
  // 没有它，模型每季都在从零重想，只能做一季就见效的事
  const [plans, setPlans] = useState<Record<string, string>>({});
  const [modelErr, setModelErr] = useState<string | null>(null);
  /**
   * 本局季数。默认取内容包的 16——那是**评测口径**（一局 16 次调用，
   * 48 局才付得起）。作为游戏它偏短：十六季刚把内政理顺就结束了，
   * 而史上 194 到三分天下用了二十六年。长局才够得着超/霸/王三档
   */
  const [seasons, setSeasons] = useState<number | null>(null);
  // 推理档必须是**显式**选择。不控这一项，各家默认给的测试时算力相差几十倍，
  // 比的就不是策略能力；而在对局界面里它还直接决定一季要等多久。
  // 默认「低」：一季等一分钟以内，且评测跑用的也是这一档，两边可比
  const [effort, setEffort] = useState<"low" | "medium" | "high">("low");

  /**
   * 把日志文本里的势力 id 换成中文名。
   *
   * 引擎写日志时手上没有显示名（resolve 不该依赖界面的东西），于是
   * 「自 南阳郡 取 京兆尹（原属 lijue）」这类文本里留着 id，由界面翻译。
   * 此前这个函数定义在封令回调**内部**，只有战报用得到——终局年表读的是
   * 同一批日志却没经过它，于是年表上写着「原属 lijue」「原属 shixie」。
   */
  const cnText = useCallback((text: string) =>
    text.replace(/[a-z]+/g, (m) => engineRef.current?.nameOf.get(m) ?? m), []);
  // 一百零五郡的沙盘不能只有「整幅可见」一档：中原一带郡治密集，
  // 不能放大就等于看不清
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // 高清底图按需加载：整幅可见时不必先下 671KB
  // 舞台在屏上有多宽。取哪一级瓦片全看它——同样放大六倍，
  // 27 寸屏要的像素是笔记本的两倍，写死一个数就必然有一边糊
  const wrapRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState({ w: 1200, h: 980 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stageW = box.w;
  /**
   * 铺满画框要几倍。
   *
   * 画心是 1815×1485 的定比，而画框现在占满一屏高——1 倍会在上下留白，
   * 屏幕越大留白越多。缩放的下限因此不是 1 而是这个数：
   * 「全图」也铺满，而不是缩成中间一小块
   */
  const minK = Math.max(1, (box.h / (box.w * (MAP.h / MAP.w))) || 1);

  /**
   * 这一次视角变化要不要缓动。
   *
   * 按加号、点候选把镜头移过去——那是「带我去那儿」，缓动读起来是移过去的。
   * 滚轮与拖动不行：每一帧都挂 280ms 缓动，手感像在拽橡皮筋
   */
  const [smooth, setSmooth] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // cnText 要在 engine 载入前后都可用，用 ref 取当前值而不进依赖数组
  const engineRef = useRef<Engine | null>(null);
  useEffect(() => { engineRef.current = engine; }, [engine]);

  // ── 载入 ────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [b, t] = await Promise.all([
          fetch("/game/runtime-194.json").then((r) => r.json() as Promise<Bundle>),
          fetch("/game/territory-grid.json").then((r) => r.json() as Promise<Territory>),
        ]);
        if (!alive) return;
        const P = loadParams(b.pack as never);
        const G = buildGraph(b.adjacency as never);
        const nameToId = new Map(b.commanderies.map((c) => [c.name, c.id]));
        const roster = buildRoster(
          b.officers as never,
          { officers: (b.officers as Array<{ id: string }>).map((o) => ({ id: o.id, available: true })) },
          nameToId,
        );
        const geo = buildGeography(b.commanderies, b.provinceSeats as never);
        const bin = atob(t.grid);
        const idx = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) idx[i] = bin.charCodeAt(i);
        setTerr({ meta: t.meta, idx, order: t.order });
        setEngine({
          P, G, roster, geo, pack: b.pack,
          colorOf: new Map(b.scenario.factions.map((f) => [f.id, f.color ?? "#7a7266"])),
          nameOf: new Map(b.scenario.factions.map((f) => [f.id, f.name])),
          lore: new Map(b.scenario.factions.map((f) =>
            [f.id, { courtesyName: f.courtesyName, situation: f.situation }])),
          points: b.commanderies,
          nodes: b.nodes ?? [],
          edges: b.adjacency.edges,
          data: {
            commanderyState: b.commanderyState as never,
            scenario: b.scenario as never,
            commanderies: b.commanderies,
            troopTypes: b.troopTypes as never,
            resources: b.resources as never,
          },
        });
        setResume(loadGame(packStamp(P.seasonsPerGame, b.commanderies.length, P.epochCount,
          (b.pack as { constants?: Record<string, unknown> }).constants)));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  // 每次状态推进就落盘。存的是 GameState 与席位，派生量一概不存——
  // 候选表、简报、镜头都能重算，存进去只会多一份会过期的副本
  useEffect(() => {
    if (!engine || !game || !seat) return;
    // 打完、被灭、归隐都没什么可继续的
    if (game.finished || game.factions[seat]?.eliminated
        || game.factions[seat]?.retired) { clearSave(); return; }
    saveGame({
      packStamp: packStamp(engine.P.seasonsPerGame, engine.points.length, engine.P.epochCount,
        (engine.pack as { constants?: Record<string, unknown> }).constants),
      seat, game, picked,
    });
  }, [engine, game, seat, picked]);

  // 模型列表按需拉。开局页一进来就拉等于替所有人付一次外部请求，
  // 而绝大多数人不会开这个面板
  const loadModels = useCallback(() => {
    if (models.length) return;
    fetch("/api/openrouter/models")
      .then((r) => r.json())
      .then((d: { data?: ModelRow[]; error?: string }) => {
        setModels(d.data ?? []);
        if (d.error) setModelErr(d.error);
        else if (!d.data?.length) setModelErr("模型列表为空 —— 多半是没配 OPENROUTER_API_KEY");
      })
      .catch((e: Error) => setModelErr(`取模型列表失败：${e.message}`));
  }, [models.length]);

  const start = useCallback((factionId: string) => {
    if (!engine) return;
    const s = createGame(engine.data, {
      seed: `play-${factionId}-${Math.floor(Date.now() / 1000)}`,
      roster: engine.roster, geo: engine.geo,
      seasons: seasons ?? engine.P.seasonsPerGame,
    }, engine.P);
    clearSave(); setResume(null);
    setSeat(factionId); setGame(s); setPicked([]); setFlash({ mine: [], world: [] }); setFlips([]);
    setRecords([]); setThinking({}); setSince(0); setPlans({});
    // 模型派给「除你之外郡数最多的 N 家」。派给最弱的几家没有意义：
    // 一郡小势力十六季里多半只在修城，看不出模型强弱
    setModelOf(Object.fromEntries(
      Object.values(s.factions)
        .filter((f) => f.id !== factionId && !f.eliminated)
        .sort((a, b) => b.startCommanderies - a.startCommanderies)
        .slice(0, modelSeats)
        .map((f) => [f.id, modelPick]),
    ));
    // 开局把镜头放到自己治所上，而不是让人先在全图里找自己
    const cap = s.factions[factionId]?.capital;
    const p = cap ? engine.points.find((c) => c.id === cap) : null;
    setView(p ? centerOn(p.longitude, p.latitude, Math.max(3.2, minK), MAP) : fitAll(minK));
  }, [engine, modelSeats, modelPick, seasons, minK]);

  const candidates: Candidate[] = useMemo(() => {
    if (!engine || !game || !seat) return [];
    return listActions(game, seat, engine.G, engine.P, undefined, engine.roster,
      (id) => engine.nameOf.get(id) ?? id, engine.geo);
  }, [engine, game, seat]);

  // 准入判据走引擎自己的 admit，不在界面另写一套。
  // 此前只判「令数够不够」，不认免费动作的次数上限（探 3 / 任命 5），
  // 也不认「同一郡每季至多 2 令」——实测按界面判据勾选，
  // 649 条里有 106 条（16%）被引擎静默丢弃，屏幕上零提示
  const adm = useMemo(() => {
    if (!engine || !game || !seat) return null;
    return admit(game, seat, picked, candidates, engine.G, engine.roster);
  }, [engine, game, seat, picked, candidates]);
  const spent = adm?.spent ?? 0;

  const submit = useCallback(async () => {
    if (!engine || !game || !seat || busy) return;
    setBusy(true);
    const orders: Order[] = admit(game, seat, picked, candidates,
      engine.G, engine.roster).orders;

    const ids = Object.keys(game.factions).sort();
    const alive = (f: string) => !game.factions[f].eliminated && !game.factions[f].retired;
    const byModel = ids.filter((f) => f !== seat && alive(f) && modelOf[f]);

    // 模型席位并发请求。逐个串行会让一季等上几分钟——
    // 五席并发时的墙钟时间等于最慢的那一席，而不是五席之和
    const deps = {
      client: new ProxyLlmClient(),
      pack: engine.pack, g: engine.G, P: engine.P,
      roster: engine.roster, geo: engine.geo,
      nameOf: (id: string) => engine.nameOf.get(id) ?? id,
    };
    setThinking(Object.fromEntries(byModel.map((f) => [f, "思考中"])));
    const done = await Promise.all(byModel.map(async (f) => {
      try {
        const { orders: os, record } = await modelDecide(game, f, since,
          { ...deps, model: modelOf[f], reasoning: { effort } }, plans[f] ?? null);
        // 答不上来的那一季不该把记忆抹掉，所以只在给出新方略时更新
        if (record.plan) setPlans((p) => ({ ...p, [f]: record.plan! }));
        setThinking((t) => ({ ...t,
          [f]: record.failure ? `失败：${record.failure}` : `${os.length} 令` }));
        return { f, os, record };
      } catch (e) {
        // 抛到这里的是代理层的错（没配密钥、网络断了）。
        // 这一席退回机器人，但**必须说出来**：静默退回会让人以为模型在下棋，
        // 而实际上他看到的是机器人的手笔
        setThinking((t) => ({ ...t, [f]: `失败：${(e as Error).message}` }));
        return { f, os: null, record: null };
      }
    }));
    for (const d of done) {
      if (d.record) setRecords((r) => [...r, d.record!]);
      if (d.os && d.os.length) orders.push(...d.os);
    }
    // 模型没给出任何令的席位也算「本季不下令」，与评测口径一致——
    // 不替它跑一遍机器人。替它兜底会把模型的失误洗掉，那就测不出东西了
    const modeled = new Set(byModel);

    for (const [i, f] of ids.entries()) {
      if (f === seat || modeled.has(f) || !alive(f)) continue;
      orders.push(...decide(game, f, engine.G, PROFILE_KEYS[i % PROFILE_KEYS.length],
        undefined, engine.roster, engine.P, engine.geo));
    }
    const before = game.log.length;
    const r = resolve(game, orders, engine.G, engine.P, engine.roster, engine.geo);
    // resolve 走的是深拷贝，所以逐郡比对 owner 是有效差分
    setFlips(Object.values(r.state.commanderies)
      .filter((c) => c.owner !== game.commanderies[c.id]?.owner)
      .filter((c) => c.owner === seat || game.commanderies[c.id]?.owner === seat)
      .map((c) => ({ id: c.id, gained: c.owner === seat, turn: r.state.turn })));
    // 一季全图能产生上百条事件，绝大多数是边地势力的补给消息。
    // 全铺出来等于把自己这一季的战况埋掉——只留我方的，与天下大事
    // 可见性由引擎定义（intel.ts 的 PUBLIC_EVENTS），不在这里另判一套——
    // 界面与模型观测若各判各的，人看到的和模型看到的就不是同一场战争
    const fresh = visibleLog(r.state, seat, before);
    // 我方与天下分栏。混在一起时，自己这一季打成什么样会被三十家的
    // 补给消息埋掉——那是最该第一眼看到的东西
    setFlash({
      mine: fresh.filter((e) => e.faction === seat).map((e) => cnText(e.text)),
      // 按重要性取，不按时间取。此前是 slice(-24)——取的是日志数组的尾部，
      // 谁被灭了、哪座城易主，完全看它在数组里的位置碰不碰运气。
      // 实测天下大事一季数十条，其中八成是 AI 之间的缔盟绝盟
      world: (() => {
        const RANK: Record<string, number> = {
          eliminated: 0, "siege-win": 1, "officer-captured": 2, retire: 2, epoch: 3,
        };
        const rows = fresh.filter((e) => e.faction !== seat && PUBLIC_EVENTS.has(e.kind));
        const isDip = (k: string) => k === "ally" || k === "ally-break";
        const big = rows.filter((e) => !isDip(e.kind))
          .sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9))
          .slice(0, 10)
          .map((e) => `${e.faction ? `${engine.nameOf.get(e.faction) ?? e.faction}：` : ""}${cnText(e.text)}`);
        // 外交折成一行：它占了八成条数，却极少影响本季的决策
        const dip = rows.filter((e) => isDip(e.kind));
        if (dip.length) {
          const form = dip.filter((e) => e.kind === "ally").length;
          big.push(`本季天下另有 ${form} 起结盟、${dip.length - form} 起绝盟`);
        }
        return big;
      })(),
    });
    setGame(r.state.finished ? r.state : refreshAp(r.state, engine.P));
    setPicked([]);
    setSince(r.state.log.length);
    setBusy(false);
  }, [engine, game, seat, candidates, picked, cnText, modelOf, since, busy, effort, plans]);

  // ── 疆域绘制 ────────────────────────────────────────────────────
  // 两道工序，仿传世舆图：先以低分辨率格网软填色域（放大时自带晕开的边），
  // 再在**不同势力**之间描墨线。只在势力之间描——同一方内部的郡界描出来
  // 就是一张网格纸，那正是「元素堆砌」的观感来源。
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !terr || !game || !engine) return;
    const { cols, rows, none } = terr.meta;
    const S = 5;                                        // 每格放大倍数
    cv.width = cols * S; cv.height = rows * S;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);

    const rgb = new Map<string, [number, number, number]>();
    for (const [id, hex] of engine.colorOf) rgb.set(id, hexRGB(hex));

    // 每格的归属势力
    const own = new Array<string | null>(cols * rows).fill(null);
    for (let i = 0; i < terr.idx.length; i += 1) {
      const k = terr.idx[i];
      if (k === none) continue;
      own[i] = game.commanderies[terr.order[k]]?.owner ?? null;
    }

    // 一、色域：先画在小画布上，再平滑放大，边缘自然晕开
    const pad = document.createElement("canvas");
    pad.width = cols; pad.height = rows;
    const pctx = pad.getContext("2d");
    if (!pctx) return;
    const img = pctx.createImageData(cols, rows);
    for (let i = 0; i < own.length; i += 1) {
      const o = i * 4;
      const f = own[i];
      if (!f) { img.data[o + 3] = 0; continue; }
      const c = rgb.get(f) ?? [122, 114, 102];
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
      // 疆域是注记不是主角：地形墨色要透得出来。三十一个势力彼此接壤，
      // 色块一重，整幅就退回「涂色地图」
      img.data[o + 3] = f === seat ? 104 : 54;
    }
    // 在小画布上先做一遍 JS 模糊，再平滑放大。
    // 不用 ctx.filter：Safari 桌面到 17.6 不支持、18 起默认关闭，
    // 那边看到的会是棱角分明的沃罗诺伊格子——正是这行想避免的观感
    blurRGBA(img.data, cols, rows, 1);
    blurRGBA(img.data, cols, rows, 1);
    pctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(pad, 0, 0, cv.width, cv.height);

    // 二、疆界墨线：只描不同势力之间的分界，同势力内部不描。
    // 每段中点按格坐标做确定性抖动后画成弧线——照直画格边，出来是一张
    // 棱角分明的沃罗诺伊图，看着像算出来的而不是画出来的。
    const wobble = (a: number, b: number) => {
      const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return (n - Math.floor(n) - 0.5) * S * 1.5;
    };
    const seg = (x1: number, y1: number, x2: number, y2: number, k: number) => {
      const mx = (x1 + x2) / 2 + wobble(k, 7.3);
      const my = (y1 + y2) / 2 + wobble(k, 19.1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(mx, my, x2, y2);
      ctx.stroke();
    };
    ctx.lineCap = "round";
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const f = own[i];
        if (!f) continue;
        const right = c + 1 < cols ? own[i + 1] : null;
        const down = r + 1 < rows ? own[i + cols] : null;
        const mine = f === seat;
        ctx.strokeStyle = mine ? "rgba(118, 44, 34, 0.82)" : "rgba(52, 45, 37, 0.38)";
        ctx.lineWidth = mine ? 2.4 : 1.2;
        if (right !== f) seg((c + 1) * S, r * S, (c + 1) * S, (r + 1) * S, i);
        if (down !== f) seg(c * S, (r + 1) * S, (c + 1) * S, (r + 1) * S, i + 0.5);
      }
    }
  }, [terr, game, engine, seat]);

  if (error) return <main className="play"><p className="play-error">载入失败：{error}</p></main>;
  if (!engine || !terr) return <main className="play"><p className="play-note">正在备沙盘…</p></main>;

  // ── 选席 ────────────────────────────────────────────────────────
  if (!game || !seat) {
    const probe = createGame(engine.data, { seed: "preview", roster: engine.roster, geo: engine.geo }, engine.P);
    const seats = Object.values(probe.factions)
      .filter((f) => !f.eliminated)
      .map((f) => ({ f, n: f.startCommanderies, st: standingOf(probe, engine.geo, f.id) }))
      .sort((a, b) => b.n - a.n);
    return (
      <main className="play">
        <header className="play-head">
          <h1>汉末沙盘</h1>
          <p>兴平元年·一九四{"\u3000"}择一席入局。
            <b>谁先一统天下谁赢</b>；打满 {seasons ?? engine.P.seasonsPerGame} 季仍未定于一，
            则按<b>相对开局的增量</b>定档——守成不得分，多控一州或多据一州治方入乙档。</p>
        </header>
        <details className="primer-fold">
          <summary>怎么玩<i>没玩过先看这个</i></summary>
          <Primer P={engine.P} />
        </details>

        {/* 局长。默认 16 季是评测口径，作为游戏偏短 */}
        <details className="primer-fold model-fold">
          <summary>这一局打多久<i>{seasons ?? engine.P.seasonsPerGame} 季</i></summary>
          <div className="model-setup">
            <p>默认 <b>{engine.P.seasonsPerGame} 季（四年）</b>是<b>评测口径</b>——
              一局十六次模型调用，四十八局才付得起，而定档按相对开局的增量判，
              四年里多拿一两个州是合理量级。</p>
            <p>作为游戏它偏短：刚把内政理顺、器械造好，局就结束了；
              史上从 194 到三分天下用了二十六年。长局才够得着
              <b>超 / 霸 / 王</b>三档——增量判据到甲就封顶，
              六十季里控了八个州判据照样只给甲，后半局每一次胜利都不再有回报。</p>
            <label>
              <span>局长</span>
              <select value={seasons ?? engine.P.seasonsPerGame}
                onChange={(e) => setSeasons(Number(e.target.value))}>
                <option value={16}>16 季 · 四年（评测口径，一局约十分钟）</option>
                <option value={32}>32 季 · 八年</option>
                <option value={64}>64 季 · 十六年（够打出霸业）</option>
                <option value={104}>104 季 · 廿六年（至三分天下）</option>
              </select>
            </label>
            <p className="warn-note">纪元时限按局长等分，所以长局的三个纪元也会拉长
              ——「早取无主之地」的时间价值不会因为局长而失效。</p>
          </div>
        </details>

        {/* 让对手由大模型执子。默认关（0 家）——一季就是 N 次调用，
            要等，也要花钱；这件事必须是显式选择，不能默认替人开销 */}
        <details className="primer-fold model-fold"
          onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) loadModels(); }}>
          <summary>让对手由大模型执子<i>{modelSeats ? `${modelSeats} 家` : "默认关"}</i></summary>
          <div className="model-setup">
            <p>选中的模型会替<b>除你之外郡数最多的 N 家</b>执子，其余仍由机器人。
              它读到的与你读到的是同一份观测（同样的迷雾、同样的候选），
              下的令也走同一道准入——所以它的胜负是可比的。</p>
            <label>
              <span>模型</span>
              <select value={modelPick} onChange={(e) => setModelPick(e.target.value)}>
                <option value={DEFAULT_MODEL}>{DEFAULT_MODEL}（免费，可先跑通）</option>
                {models.filter((m) => m.id !== DEFAULT_MODEL).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.structuredOutput ? "" : "（无结构化输出）"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>由模型执子的家数</span>
              <select value={modelSeats} onChange={(e) => setModelSeats(Number(e.target.value))}>
                {[0, 1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>{n === 0 ? "不用模型（全机器人）" : `最强的 ${n} 家`}</option>
                ))}
              </select>
            </label>
            <label>
              <span>推理档</span>
              <select value={effort}
                onChange={(e) => setEffort(e.target.value as "low" | "medium" | "high")}>
                <option value="low">低（一季等得起，与评测跑同档）</option>
                <option value="medium">中</option>
                <option value="high">高（更强，但一季可能等几分钟）</option>
              </select>
            </label>
            {modelSeats > 0 && (
              <p className="warn-note">一季要等这 {modelSeats} 家里最慢的那一个答完。
                付费模型按 token 计价，局内会实时报累计花费。</p>
            )}
            {modelErr && <p className="warn-note">{modelErr}</p>}
          </div>
        </details>
        {resume && (() => {
          // 显式给「继续 / 重开」，不自动恢复：自动恢复会让「我想重开一局」
          // 变成一件要先找按钮的事
          const f = resume.game.factions[resume.seat];
          const owned = Object.values(resume.game.commanderies)
            .filter((c) => c.owner === resume.seat).length;
          return (
            <div className="resume">
              <div>
                <b>上次那局还没打完</b>
                <span>{engine.nameOf.get(resume.seat) ?? resume.seat}
                  {"\u3000"}第 {resume.game.turn + 1}/{resume.game.seasonsPerGame ?? engine.P.seasonsPerGame} 季
                  {"\u3000"}{owned} 郡（开局 {f?.startCommanderies ?? "?"}）
                  {"\u3000"}{GRADE_CN[f?.bestGrade ?? "ding"]} 档</span>
              </div>
              <button onClick={() => {
                setSeat(resume.seat); setGame(resume.game); setPicked(resume.picked);
                setFlash({ mine: [], world: [] }); setFlips([]);
                // since 决定模型看到的战报从哪一条起。读档不重置它会从 0 起算，
                // 于是模型收到整局的日志——观测直接撑爆 token 预算
                setSince(resume.game.log.length); setRecords([]); setThinking({});
                const cap = resume.game.factions[resume.seat]?.capital;
                const p = cap ? engine.points.find((c) => c.id === cap) : null;
                setSmooth(true);
                setView(p ? centerOn(p.longitude, p.latitude, Math.max(3.2, minK), MAP) : fitAll(minK));
                setResume(null);
              }}>继续</button>
              <button className="ghost" onClick={() => { clearSave(); setResume(null); }}>
                弃掉，重开
              </button>
            </div>
          );
        })()}
        <WashDefs />
        <ul className="seat-grid">
          {seats.map(({ f, n, st }) => (
            <li key={f.id}>
              <button onClick={() => start(f.id)} style={{ "--c": engine.colorOf.get(f.id) } as React.CSSProperties}>
                {/* 城印：与图上是同一幅画、同一套色。选席页此前是一张纯表格，
                    与那张舆图之间没有任何视觉关系——点进去才知道自己接的是什么 */}
                <SeatSigil color={engine.colorOf.get(f.id) ?? "#7a7266"} id={f.id}
                  kind={st.zhouSeats > 0 ? "city-seat" : n >= 4 ? "city-large" : "city-small"} />
                <b>{engine.nameOf.get(f.id)}
                  {engine.lore.get(f.id)?.courtesyName && (
                    <i>字{engine.lore.get(f.id)!.courtesyName}</i>
                  )}
                </b>
                <span>{n} 郡{"\u3000"}{st.controlledZhou} 州{"\u3000"}州治 {st.zhouSeats}
                  {"\u3000"}治 {f.capital ?? "无"}</span>
                {/* 本年局势取自剧本，逐条有史料出处。开局先让人知道自己接的是什么烂摊子 */}
                {engine.lore.get(f.id)?.situation && (
                  <em>{engine.lore.get(f.id)!.situation}</em>
                )}
              </button>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const me = game.factions[seat];
  const standing = standingOf(game, engine.geo, seat);
  // 「离升档还差什么」——这一句比整段简报更该常驻。
  // 档位判的是相对开局的增量，不看绝对疆域
  const nextStep = standing.controlledZhou >= me.startZhou + 2 ? "已达甲档条件"
    : standing.controlledZhou > me.startZhou || standing.zhouSeats > me.startSeats
      ? `再多控 ${me.startZhou + 2 - standing.controlledZhou} 州 → 甲`
      : standing.commanderies > me.startCommanderies && standing.conquests > 0
        ? "多控一州或多据一州治 → 乙"
        : "郡数高于开局且至少一郡夺自他方 → 丙";

  // 城池与标注。标注在屏幕空间做贪心避让——冀州、兖州一带郡治密集，
  // 全部铺出来必然叠字，那正是「简略」的观感来源之一
  const marks = engine.points.map((c) => {
    const st = game.commanderies[c.id];
    if (!st) return null;
    const isSeat = engine.geo.zhouSeat.get(c.zhou) === c.id;
    const hh = c.households ?? 0;
    return {
      c, st, isSeat,
      x: (c.longitude - MAP.west) * MAP.ppd,
      y: (MAP.north - c.latitude) * MAP.ppd,
      mine: st.owner === seat,
      besieged: game.armies.some((a) => a.target === c.id),
      // 缩放律。此前是 1/√k：放大六倍，图元在**图上**只缩 2.45 倍，
      // 而屏幕放大了 6 倍——于是越拉越挤，京兆尹与左冯翊（图上只隔 16 像素）
      // 怎么拉都叠着。
      //
      // 现在 1/k^0.82：图上缩得比屏幕放得快，放大才真的把城分得开；
      // 屏上仍随 k^0.18 缓慢长大，「放大是为了看清」不落空。
      //   k=1   城印宽 48–83 像素（图上），与全图时相同
      //   k=6   宽 12–21，京兆尹与左冯翊已分开
      //   k=14  宽 6–11，辽西与辽东属国（隔 8 像素）也分得开
      base: (isSeat ? 36 : hh > 150000 ? 30 : hh > 60000 ? 25 : 21) / view.k ** 0.82,
    };
  }).filter((m): m is NonNullable<typeof m> => m !== null);

  // 州名题记：舆图必有的一层。缩得越小越该看见大区划，放大后让位给郡治
  const zhouMarks = [...engine.geo.zhouMembers].map(([z, ids]) => {
    const pts = engine.points.filter((p) => ids.includes(p.id));
    if (!pts.length) return null;
    const lon = pts.reduce((n, p) => n + p.longitude, 0) / pts.length;
    const lat = pts.reduce((n, p) => n + p.latitude, 0) / pts.length;
    return { z, x: (lon - MAP.west) * MAP.ppd, y: (MAP.north - lat) * MAP.ppd };
  }).filter((m): m is NonNullable<typeof m> => m !== null);

  const placed: Array<[number, number, number, number]> = [];
  const labels = [...marks]
    // 先放最该看见的：当前指向者 → 己方 → 州治 → 大城
    .sort((a, b) => Number(focus === b.c.id) - Number(focus === a.c.id)
      || Number(b.mine) - Number(a.mine)
      || Number(b.isSeat) - Number(a.isSeat) || b.base - a.base)
    // 放大后铺开全部郡名：整幅可见时只标己方与州治是为了不叠字，
    // 放大之后地方够了，还藏着就是白放大
    .filter((m) => view.k >= 2.2 || m.mine || m.isSeat || focus === m.c.id)
    .map((m) => {
      // 牌记比图元收得更狠一点：字在屏上只需**够读**，不需要跟着放大。
      // 1/k^0.88 意味着屏上按 k^0.12 长——十四倍下也只大三成半
      const size = (m.isSeat ? 25 : 21) / view.k ** 0.88;
      const w = m.c.name.length * size * 1.02, h = size * 1.3;
      const x = m.x - w / 2, y = m.y + m.base * 0.62 + 4 / view.k ** 0.88;
      const box: [number, number, number, number] = [x, y, w, h];
      const hit = placed.some(([px, py, pw, ph]) =>
        x < px + pw && x + w > px && y < py + ph && y + h > py);
      if (hit && focus !== m.c.id) return null;
      placed.push(box);
      return { id: m.c.id, name: m.c.name, x: m.x, y: y + size, size, w: w + 8 / view.k ** 0.88,
               hot: focus === m.c.id };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  // 出兵箭头：已勾选的用实线，正指向的用虚线。
  // 「自南阳郡征河南尹」——不熟地理的人根本不知道这两个郡在哪，
  // 候选表与地图此前完全没有联动，读到的只是两个地名
  const xy = (id: string) => {
    const p = engine.points.find((c) => c.id === id);
    return p ? { x: (p.longitude - MAP.west) * MAP.ppd, y: (MAP.north - p.latitude) * MAP.ppd }
             : null;
  };
  const arrows = [...new Set([...picked, hoverKey].filter((k): k is string => !!k))]
    .map((k) => {
      const c = candidates.find((x) => x.key === k);
      if (!c || c.action.type !== "campaign") return null;
      const a = xy(c.action.from), b = xy(c.action.target);
      if (!a || !b) return null;
      return { key: k, a, b, on: picked.includes(k),
               sortie: c.action.from === c.action.target };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  // ── 道路层：边的地形 ─────────────────────────────────────────────
  //
  // 引擎按边的 cost 算行军天数（日三十里），可图上此前一条路都没有：
  // 「自南阳征河南尹要走一季」这件事，看图的人无从验证，也看不出难在哪。
  // 232 条边全铺出来会盖住墨底，所以常态极淡，指到某郡时它那几条才提亮
  const roads = engine.edges.map((e, i) => {
    const a = xy(e.from), b = xy(e.to);
    if (!a || !b) return null;
    const st = EDGE_STYLE[e.terrain] ?? EDGE_STYLE.plain;
    const hub = pinned ?? focus;
    const hot = hub === e.from || hub === e.to;
    // 题记压在**离所指之郡六成远**处，不压在中点：中点全挤在枢纽附近，
    // 一个郡有五条边时五行字叠成一团。从所指那头往外量，它们自然扇开
    const near = hub === e.from ? a : b, far = hub === e.from ? b : a;
    return { key: `${e.from}-${e.to}-${i}`, a, b, st, hot, e,
             tx: near.x + (far.x - near.x) * 0.6, ty: near.y + (far.y - near.y) * 0.6,
             // 行军天数：cost × 每 cost 多少日。这个数就是候选标签里那句「道远」的来源
             days: Math.round(e.cost * engine.P.marchDayPerCost) };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  // ── 出图分级 ─────────────────────────────────────────────────────
  //
  // 三档，与瓦片那三级同呼吸：
  //   0 远观（k<1.6，z1）  一幅舆图：疆域、州名、城印。关津不出，道路极淡
  //   1 中观（k<3.2，z2）  关与港出（它们答「路通不通」），郡名铺开
  //   2 近观（k≥3.2，z3）  据点全出并标名，城画成城郭，道路提亮
  //
  // 分档的理由不是性能，是**一张图放不下**：一百零五座城各带三层檐、
  // 六十一处据点各带一个名，整幅可见时就是一层噪点。放大之后地方够了，
  // 还画同一个小印就是把它糊开
  const lod = view.k >= 3.2 ? 2 : view.k >= 1.6 ? 1 : 0;

  // ── 关津港仓：非郡治的战略据点 ────────────────────────────────────
  // 关隘 22、港口 12、渡口 9、谷道 7、古战场 7、粮仓 4。整幅可见时只画关与港
  // （它们是「路通不通」的答案），放大后铺开其余——否则六十一个印记压在墨底上
  // 就是一层噪点
  const nodeMarks = (lod === 0 ? [] : engine.nodes)
    .filter((n) => lod >= 2 || n.kind === "gate" || n.kind === "port")
    .map((n) => ({
      n, x: (n.longitude - MAP.west) * MAP.ppd, y: (MAP.north - n.latitude) * MAP.ppd,
      r: 12 / view.k ** 0.82,
    }));

  // ── 军团：在途的也要画 ───────────────────────────────────────────
  //
  // 此前只有围城的军团画了旗，在途的一支都没有：出征之后它在图上**隐身**几季，
  // 然后凭空出现在城下。而行军耗时正是围城那只钟的另一半——援军赶不赶得到，
  // 看的就是它现在走到哪了。位置按 marchLeft 在起兵郡与目标之间插值
  const troops = game.armies.map((a) => {
    const at = xy(a.at);
    if (!at) return null;
    const mine = a.faction === seat;
    if (a.marchLeft > 0 && a.target) {
      const from = xy(a.home), to = xy(a.target);
      if (!from || !to) return null;
      const edge = (engine.G.adj.get(a.home) ?? []).find((e) => e.to === a.target);
      const total = marchSeasons(edge?.cost ?? 1, a.gear !== "none", engine.P);
      // 走了几分之几。total 恒 ≥ marchLeft，两者相等即刚出发
      const t = total > 0 ? (total - a.marchLeft) / total : 1;
      // 出发那一季也要看得见已经动了，故给个起步量
      const f = 0.12 + t * 0.76;
      return { a, mine, marching: true as const,
               x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f,
               from, to };
    }
    if (a.target) return null;             // 城下的由围城旗那一层画
    return { a, mine, marching: false as const, x: at.x, y: at.y, from: null, to: null };
  }).filter((t): t is NonNullable<typeof t> => t !== null)
    // 己方画在上层：自己的兵被别人的旗压住是最不该发生的遮挡
    .sort((p, q) => Number(p.mine) - Number(q.mine));

  // ── 终局要用的三样：年表、名将去向、天下排名 ──────────────────────
  // 一局十六季，只报一个档位等于什么都没留下
  const BIG = new Set(["siege-win", "siege-lift", "siege-abort", "officer-captured",
    "besieged", "capital-lost", "field-win", "field-fail", "relief", "retire", "eliminated"]);
  const when = (t: number) => `${Math.floor(t / 4) + 194} · ${SEASON_CN[(t % 4) + 1]}`;
  // 连续同文合并。治所失守之后「全境政令不通」会逐季重复，
  // 一个第 9 季覆灭的局面里这一句能占掉年表的一半——那不是年表，是回声
  const chronicle: Array<{ when: string; text: string; from: number; to: number; n: number }> = [];
  for (const e of game.log) {
    if (e.faction !== seat || !BIG.has(e.kind)) continue;
    const text = cnText(e.text);
    const last = chronicle[chronicle.length - 1];
    // 只合并**相邻季**的同一句。跨季合并会让「194 秋—195 冬（×2 季）」
    // 读起来像连续六季，其实只是首末两次
    if (last && last.text === text && e.turn === last.to + 1) {
      last.to = e.turn; last.n += 1;
      continue;
    }
    chronicle.push({ when: "", text, from: e.turn, to: e.turn, n: 1 });
  }
  for (const c of chronicle) {
    c.when = c.n > 1 ? `${when(c.from)}—${when(c.to)}` : when(c.from);
  }
  const caught = { mine: [] as string[], theirs: [] as string[] };
  for (const e of game.log) {
    if (e.kind !== "officer-captured") continue;
    const names = (/ (.+?) 被俘$/.exec(e.text)?.[1] ?? "").split("、").filter(Boolean);
    (e.faction === seat ? caught.theirs : caught.mine).push(...names);
  }
  // 我方被俘只算真属于我的人：他方互相俘获与我无关
  caught.mine = caught.mine.filter((n) => {
    const o = [...engine.roster.byId.values()].find((x) => x.name === n);
    return o?.faction === seat;
  });
  const byLand = Object.values(game.factions)
    .map((f) => ({ id: f.id,
      n: Object.values(game.commanderies).filter((c) => c.owner === f.id).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || cmp(a.id, b.id));
  const rank = { at: Math.max(1, byLand.findIndex((x) => x.id === seat) + 1),
                 of: byLand.length };

  // 收尾的三种情形：十六季打满、被灭光、主动归隐。后两种此前不收尾，
  // 玩家得对着空候选把剩下的季数一季季点完
  const over = game.finished || me.eliminated || me.retired;
  // 下季要交的军费：全部兵力 × 每兵每季。金看不见就没法做「这季省着点」的决策
  const upkeep = Math.round(
    (Object.values(game.commanderies).filter((c) => c.owner === seat)
      .reduce((n, c) => n + c.garrison, 0)
     + game.armies.filter((a) => a.faction === seat).reduce((n, a) => n + a.troops, 0))
    * engine.P.goldUpkeepPerTroop);

  const brief = briefFor(game, engine.geo, seat, engine.G.adj, (id) => engine.nameOf.get(id) ?? id);

  const centerOnId = (id: string) => {
    const p = engine.points.find((c) => c.id === id);
    if (p) { setSmooth(true); setView(centerOn(p.longitude, p.latitude, Math.max(4.4, minK), MAP)); }
  };
  // 家底一览。被围与断供直接决定这一季能不能出兵，排在最前面
  const supplied = supplyReach(game, engine.G, seat);
  const myLands = Object.values(game.commanderies)
    .filter((c) => c.owner === seat)
    .map((c) => {
      const besieger = game.armies.find((a) => a.target === c.id && a.faction !== seat);
      const cut = !supplied.has(c.id);
      const officers = stationedAt(game, engine.roster, c.id);
      const note = besieger ? `被 ${engine.nameOf.get(besieger.faction) ?? besieger.faction} 围`
        : cut ? "补给断绝"
        : c.gear !== "none" ? `备${GEAR_LABEL[c.gear] ?? c.gear}`
        : "";
      return { c, officers, note, warn: !!besieger || cut };
    })
    .sort((a, b) => Number(b.warn) - Number(a.warn) || cmp(a.c.id, b.c.id));
  // 与选中的城相关的候选：起点、目标、施政地、集结地、刺探对象都算
  const touches = (c: Candidate, id: string) => {
    const a = c.action as Record<string, unknown>;
    if (a.at === id || a.target === id || a.from === id || a.through === id) return true;
    return Array.isArray(a.from) && (a.from as string[]).includes(id);
  };
  const shown = pinned ? candidates.filter((c) => touches(c, pinned)) : candidates;

  const byType = new Map<string, Candidate[]>();
  for (const c of shown) {
    const cls = c.key.split(":")[0];
    if (!byType.has(cls)) byType.set(cls, []);
    byType.get(cls)!.push(c);
  }
  // 征伐按「打不打得下」排：能破的在前，不破的沉底。
  // 吕布二十条征伐里十七条引擎已经算出「不破」，而他一季最多下三条——
  // 无序平铺等于让人逐条读到第七十个字才看见结论
  const RANK: Record<string, number> = { 破城: 0, 未知: 1, 不破: 2 };
  // 同一判词内，升州级档的排前面。实测 40.8% 的席·季里余量最大的那条
  // 并不是升档的那条——纯按余量排，值钱的那个会沉到十几行以下没人看见。
  // 那不是「选了容易的」，那是根本没看见有得选。
  // 丙档不参与排序：开局阶段几乎每次夺郡都升丙，参与了等于没参与
  const UPRANK: Record<string, number> = { jia: 0, yi: 1 };
  for (const list of byType.values()) {
    list.sort((a, b) => (RANK[a.forecast?.verdict ?? "未知"] ?? 1)
                      - (RANK[b.forecast?.verdict ?? "未知"] ?? 1)
                      || (UPRANK[a.gain?.upgrade ?? ""] ?? 9)
                       - (UPRANK[b.gain?.upgrade ?? ""] ?? 9)
                      || (b.forecast ? b.forecast.breachLo - b.forecast.holdHi : 0)
                       - (a.forecast ? a.forecast.breachLo - a.forecast.holdHi : 0)
                      || cmp(a.key, b.key));
  }

  return (
    <main className="play">
      <header className="play-head play-bar">
        {/* 局终之后 turn 已经推到 seasonsPerGame，再加一就成了「第 17/16 季」——
            而同一屏的终局块自己写着「16 季年表」，两个数字互相打架。夹住上限 */}
        <span className="era">{game.year} 年 · {SEASON_CN[game.season]}{"\u3000"}
          第 {Math.min(game.turn + 1, game.seasonsPerGame)}/{game.seasonsPerGame} 季{"\u3000"}
          纪元 {game.epoch}</span>
        <span className="who" style={{ "--c": engine.colorOf.get(seat) } as React.CSSProperties}>
          {engine.nameOf.get(seat)}
        </span>
        <span className="ap">令数 {me.ap - spent}/{me.ap}
          {engine.P.goldOn && <>{"\u3000"}国库 {Math.round(me.gold)} 金
            {upkeep > 0 && <i className="upkeep">（军费 {upkeep}）</i>}</>}
          {"\u3000"}现档 {GRADE_CN[me.bestGrade]}
          {/* 名器：朝廷在谁手里、自己有几个州牧号。这两件事改变的是「无主之郡
              归谁」，与令数、国库同属「这一季能做什么」那一类，故常驻状态栏 */}
          {me.governorships.length > 0 && <>{"\u3000"}
            <i className="titles">{me.governorships.join("·")}牧</i></>}
          {game.commanderies[engine.P.courtSeat]?.owner === seat
            ? <>{"\u3000"}<i className="titles">挟天子</i></>
            : <>{"\u3000"}<i className="titles dim">朝廷在 {
                engine.nameOf.get(game.commanderies[engine.P.courtSeat]?.owner ?? "") ?? "无主"
              }</i></>}</span>
        <button className="primer-btn" onClick={() => setShowPrimer((v) => !v)}
          aria-expanded={showPrimer}>规则</button>
      </header>

      {/* 模型执子状态条。三件事必须常驻：谁在由模型执子、这一季它答成什么样、
          到现在花了多少。看不到这些，就分不清「对手按兵不动」和「模型没答上来」 */}
      {Object.keys(modelOf).length > 0 && (
        <div className="model-bar">
          <b>模型执子</b>
          {Object.entries(modelOf).map(([f, m]) => {
            const st = thinking[f];
            const bad = st?.startsWith("失败");
            return (
              <span key={f} className={bad ? "seatbad" : busy && st === "思考中" ? "seatwait" : undefined}
                style={{ "--c": engine.colorOf.get(f) } as React.CSSProperties}
                title={`${m}${st ? `｜${st}` : ""}`}>
                {engine.nameOf.get(f) ?? f}
                {st && <i>{st.length > 26 ? `${st.slice(0, 26)}…` : st}</i>}
              </span>
            );
          })}
          {(() => {
            const price = new Map(models.map((m) => [m.id, m]));
            const spentUsd = records.reduce((a, r) => a + costOf(r, price), 0);
            const failed = records.filter((r) => r.failure).length;
            return (
              <em>
                {records.length} 次调用
                {spentUsd > 0 && `｜累计 $${spentUsd.toFixed(4)}`}
                {failed > 0 && `｜失败 ${failed}`}
              </em>
            );
          })()}
        </div>
      )}

      {showPrimer && (
        <div className="primer-sheet" role="dialog" aria-label="规则速览">
          <div>
            <button className="primer-close" onClick={() => setShowPrimer(false)}>关闭</button>
            <Primer P={engine.P} />
          </div>
        </div>
      )}
      <div className="play-body">
        {/* 遮罩定义挂在这儿，地图与图例都引它 */}
        <WashDefs />
        <section
          ref={wrapRef}
          className={`map-wrap${dragging || !smooth ? " dragging" : ""}`}
          onWheel={(e) => {
            setSmooth(false);
            const box = e.currentTarget.getBoundingClientRect();
            const px = (e.clientX - box.left) / box.width;
            const py = (e.clientY - box.top) / box.height;
            setView((v) => {
              const k = Math.min(K_MAX, Math.max(minK, v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
              // 以指针为锚点缩放，否则放大时目标会跑出视野
              const x = px - ((px - v.x / 100) * k) / v.k;
              const y = py - ((py - v.y / 100) * k) / v.k;
              const lim = (n: number) => Math.min(0, Math.max(-(k - 1), n));
              return { k, x: lim(x) * 100, y: lim(y) * 100 };
            });
          }}
          onPointerDown={(e) => {
            if (view.k <= 1) return;
            setSmooth(false);
            // 按下时**不**捕获指针。捕获会把后续事件全截走，城池的 click
            // 永远收不到——地图于是点不动，只能拖
            dragRef.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            // 移动超过阈值才算拖动，此时才捕获。阈值以内当作点击
            if (!dragging && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
            if (!dragging) {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(true);
            }
            const box = e.currentTarget.getBoundingClientRect();
            const lim = (n: number) => Math.min(0, Math.max(-(view.k - 1) * 100, n));
            setView((v) => ({
              ...v,
              x: lim(d.ox + ((e.clientX - d.x) / box.width) * 100),
              y: lim(d.oy + ((e.clientY - d.y) / box.height) * 100),
            }));
          }}
          onPointerUp={(e) => {
            if (dragging) e.currentTarget.releasePointerCapture?.(e.pointerId);
            dragRef.current = null;
            setDragging(false);
          }}
          style={{ cursor: view.k > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
        >
          <div className="map-stage"
            style={{ transform: `translate(${view.x}%, ${view.y}%) scale(${view.k})` }}>
          {/* 垫底的整图：瓦片逐块加载，没有它，缩放的那一瞬会露出空洞。
              只需最小的一档——细节由上面的瓦片给，@2x 那张 720KB 现在是白下的。
              套 next/image 只会多一层运行时开销，不换来任何优化 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BASE} alt="汉末地形" />
          <TileLayer view={view} screenW={stageW} />
          {/* 海波压在瓦片之上、疆域之下：它是底图的一部分，
              但疆域的色域要盖得住它 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="decor" src={DECOR} alt="" />
          <canvas ref={canvasRef} />
          <svg viewBox={`0 0 ${MAP.w} ${MAP.h}`}>
            <defs>
              <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {/* 道路：画在州名与城印之下。地形决定行军天数，指到某郡时它那几条提亮，
                并在路当中标上「山道 47 日」——「道远」这句候选标签的出处 */}
            {roads.map((r) => (
              <line key={r.key} className={`road lod${lod}${r.hot ? " hot" : ""}`}
                x1={r.a.x} y1={r.a.y} x2={r.b.x} y2={r.b.y}
                stroke={r.st.stroke} strokeDasharray={r.st.dash}
                strokeWidth={r.st.width * (r.hot ? 2.2 : 1) / view.k ** 0.82} />
            ))}
            {roads.filter((r) => r.hot).map((r) => (
              <text key={`d-${r.key}`} className="road-tip"
                x={r.tx} y={r.ty}
                textAnchor="middle" fontSize={19 / view.k ** 0.88}>
                {EDGE_CN[r.e.terrain] ?? r.e.terrain}
                {r.e.nodes.length ? `·${r.e.nodes[0].name}` : ""} {r.days} 日
              </text>
            ))}
            {/* 关津港仓：一字一印。关隘与港口整幅可见，其余放大后才铺开 */}
            {nodeMarks.map((m) => (
              <g key={m.n.id}
                onMouseEnter={() => setNodeTip(m.n)} onMouseLeave={() => setNodeTip(null)}>
                {/* 透明命中圆：图元本身只有十来像素，低于可点区域的最低尺寸 */}
                <circle cx={m.x} cy={m.y} r={m.r * 1.2} fill="transparent" />
                <NodeMark x={m.x} y={m.y} r={m.r} kind={m.n.kind} id={m.n.id} />
                {lod >= 2 && (
                  <text className="node-name" x={m.x} y={m.y + m.r * 1.9}
                    textAnchor="middle" fontSize={m.r * 0.9}>{m.n.name}</text>
                )}
              </g>
            ))}
            {view.k < 2.2 && zhouMarks.map((m) => (
              <text key={m.z} className="zhou" x={m.x} y={m.y} textAnchor="middle"
                fontSize={62 / view.k ** 0.82}>{m.z}</text>
            ))}
            {arrows.map((ar) => (ar.sortie ? (
              // 出城迎战：起点即目标，画一圈而不是一条线
              <circle key={ar.key} className={`sortie${ar.on ? " on" : ""}`}
                cx={ar.a.x} cy={ar.a.y} r={30 / view.k ** 0.82} />
            ) : (
              <line key={ar.key} className={`arrow${ar.on ? " on" : ""}`}
                x1={ar.a.x} y1={ar.a.y} x2={ar.b.x} y2={ar.b.y}
                strokeWidth={5 / view.k ** 0.82} markerEnd="url(#arrowhead)" />
            )))}
            {marks.map((m) => (
              <g key={m.c.id}
                className={`mark${m.mine ? " mine" : ""}${focus === m.c.id ? " focus" : ""}`
                  + `${pinned === m.c.id ? " pinned" : ""}`}
                onMouseEnter={() => setFocus(m.c.id)} onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus(m.c.id)} onBlur={() => setFocus(null)}
                onClick={() => setPinned((p) => (p === m.c.id ? null : m.c.id))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  setPinned((p) => (p === m.c.id ? null : m.c.id));
                }}
                tabIndex={0} role="button"
                aria-label={`${m.c.id}${m.mine ? "（我方）" : ""}`}>
                {/* 独立的透明命中圆：视觉上的城印只有十来像素，
                    远低于可点区域的最低尺寸 */}
                <circle cx={m.x} cy={m.y} r={Math.max(m.base * 0.9, 26 / view.k ** 0.88)}
                  fill="transparent" />
                <CityMark x={m.x} y={m.y} size={m.base * (focus === m.c.id ? 1.3 : 1)}
                  mine={m.mine} seat={m.isSeat} besieged={m.besieged} detail={lod >= 2}
                  at={m.c.id}
                  fill={m.st.owner ? engine.colorOf.get(m.st.owner) ?? "#7a7266" : null} />
              </g>
            ))}
            {/* 本季易主：得手画朱环，失守画墨环。key 带上季号，
                连续两季易主的同一郡才会重播 */}
            {flips.map((fl) => {
              const p = engine.points.find((c) => c.id === fl.id);
              if (!p) return null;
              const x = (p.longitude - MAP.west) * MAP.ppd;
              const y = (MAP.north - p.latitude) * MAP.ppd;
              return (
                <circle key={`${fl.turn}-${fl.id}`} className={`flip ${fl.gained ? "gain" : "loss"}`}
                  cx={x} cy={y} r={44 / view.k ** 0.82} />
              );
            })}
            {/* 军团：在途的画在路上，待命的画在驻地。
                在途的连一条虚线到目标——「这支兵冲着谁去」是最该一眼看出的事 */}
            {troops.map((t) => {
              const s2 = 26 / view.k ** 0.82;
              const col = engine.colorOf.get(t.a.faction) ?? "#7a7266";
              return (
                <g key={t.a.id}
                  className={`army${t.mine ? " mine" : ""}${t.marching ? " marching" : ""}`}>
                  {t.marching && t.from && t.to && (
                    <line className="march-path" x1={t.from.x} y1={t.from.y} x2={t.to.x} y2={t.to.y}
                      stroke={col} strokeWidth={2.4 / view.k ** 0.82} />
                  )}
                  <ArmyMark x={t.x} y={t.y} s={s2} color={col} marching={t.marching}
                    at={t.a.id} />
                  <text x={t.x} y={t.y + s2 * 0.98} textAnchor="middle" fontSize={s2 * 0.5}>
                    {(t.a.troops / 1000).toFixed(1)}千
                    {t.marching ? `·尚需 ${t.a.marchLeft} 季` : ""}
                  </text>
                </g>
              );
            })}
            {/* 围城旗：城下有谁、围了几季、多少人。只有一个虚线圈看不出这些，
                而这三样正是「要不要去救」的全部依据 */}
            {/* 在途的不算在城下：它这一季不结算攻城、不扣守方存粮，
                插一面围城旗在那儿，读图的人会以为城已经被围上了 */}
            {game.armies.filter((a) => a.target && a.marchLeft <= 0).map((a) => {
              const p = engine.points.find((c) => c.id === a.target);
              if (!p) return null;
              const x = (p.longitude - MAP.west) * MAP.ppd;
              const y = (MAP.north - p.latitude) * MAP.ppd;
              const s = 30 / view.k ** 0.82;
              const mine = a.faction === seat;
              return (
                // 城下的围军画营垒——与在途的行营是同一套画。此前这里是一面
                // 手画的三角小旗，与旁边的笔墨城印摆在一起就是两套语言
                <g key={a.id} className={`siege-camp${mine ? " mine" : ""}`}>
                  <ArmyMark x={x + s * 1.15} y={y + s * 0.28} s={s * 0.86}
                    color={engine.colorOf.get(a.faction) ?? "#7a7266"}
                    marching={false} at={a.id} />
                  <text x={x + s * 1.15} y={y + s * 0.86} textAnchor="middle" fontSize={s * 0.4}>
                    {a.siegeSeasons + 1}季·{(a.troops / 1000).toFixed(1)}千
                  </text>
                </g>
              );
            })}
            {labels.map((l) => (
              <g key={l.id} className={`tag${l.hot ? " hot" : ""}`}>
                {/* 牌记：地名压在纸签上，比裸字加描边干净，也更像舆图 */}
                <rect x={l.x - l.w / 2} y={l.y - l.size * 0.92} width={l.w} height={l.size * 1.24}
                  rx={2.5} />
                <text x={l.x} y={l.y} textAnchor="middle" fontSize={l.size}>{l.name}</text>
              </g>
            ))}
          </svg>
          </div>
          {/* 图题：古地图的图题不在固定角落，是写在图面构图里的一个墨线框。
              挂在屏幕固定层，随平移不动，像图例一样 */}
          <div className="cartouche" aria-hidden="true">
            <b>大漢輿地圖</b>
            <span>每方折地百里</span>
            <span>郡國山川縣邑名</span>
            {/* 竖排图题里三位阿拉伯数字会被拆成一列四行的「1 9 5 年」，
                把「大漢輿地圖／每方折地百里」那套古图调子直接打断。
                改用汉字纪年，与旁边三行同一种字 */}
            <span>{eraName(game.year)}</span>
          </div>

          {/* 压角章。考据上压角章在左下与引首章成对角，但左下已被郡国详情占用，
              且不做引首章就没有对角约束——「钤在下方一角」仍成立。
              朱色取 #a8322a 而非颜料色银朱 #f43e06：真实钤印是油性朱泥压在
              有纹理的纸上，明度饱和度都掉一档，直接用颜料色像荧光贴纸 */}
          <div className="seal-corner" aria-hidden="true">
            <svg viewBox="0 0 100 100">
              <defs>
                <filter id="seal-edge">
                  <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" />
                  <feDisplacementMap in="SourceGraphic" scale="1.6" />
                </filter>
              </defs>
              <g filter="url(#seal-edge)">
                <rect x="3" y="3" width="94" height="94" rx="2" />
                {/* 白文（阴文）：朱底挖空文字。四字印读序为右上→右下→左上→左下 */}
                <text x="72" y="40">漢</text>
                <text x="72" y="82">末</text>
                <text x="28" y="40">沙</text>
                <text x="28" y="82">盤</text>
              </g>
            </svg>
          </div>

          {/* 图例：关津港仓与军团的印记不写出来就是密码。收在一个角标里，
              点开才占地方——常驻会挤掉地图，而它只在头一两局需要看 */}
          <details className="legend">
            <summary>图例</summary>
            <ul>
              {/* 图例里的图元与图上是同一段代码画的：另画一份必然与地图分家。
                  每一对「图 + 名」用 nowrap 裹住，否则名字会被折到图的下一行 */}
              <li>
                <span>{legendGlyph("gate")}关隘</span>
                <span>{legendGlyph("pass")}谷道</span>
                <em>守 +0.55 · 行军 2.6 倍</em>
              </li>
              <li>
                <span>{legendGlyph("ford")}渡口</span>
                <span>{legendGlyph("port")}港口</span>
                <em>守 +0.35 · 行军 1.8 倍</em>
              </li>
              <li>
                <span>{legendGlyph("depot")}粮仓</span>
                <span>{legendGlyph("battlefield")}古战场</span>
              </li>
              <li>
                <span>{legendArmy(true)}行军中</span>
                <span>{legendArmy(false)}待命</span>
                <span><b className="flagg" />城下围城</span>
              </li>
              <li><em>细线是道路：实线平道、短划丘陵、点线山道、长短线水路、朱线关道。
                指到某郡，它那几条会提亮并标出行军日数</em></li>
            </ul>
          </details>

          <div className="zoom">
            <button onClick={() => { setSmooth(true); setView((v) => zoomAt(v, 1.4, minK)); }}>＋</button>
            <button onClick={() => { setSmooth(true); setView(fitAll(minK)); }}>全图</button>
            <button onClick={() => { setSmooth(true); setView((v) => zoomAt(v, 1 / 1.4, minK)); }}>－</button>
          </div>
          {/* 关津的悬停详情。它与郡的详情共用一个位置：两者不会同时指到 */}
          {nodeTip && !focus && (
            <div className="tip">
              <b>{nodeTip.name}</b>
              <span>{NODE_CN[nodeTip.kind] ?? nodeTip.kind}
                {nodeTip.at ? `\u3000近${nodeTip.at}` : ""}</span>
              {/* 数值取自内容包的 terrain 表，别在这里另写一份——两份必然漂移 */}
              <span>{nodeTip.kind === "port" || nodeTip.kind === "ford"
                ? "水道：守方 +0.35，行军 1.8 倍。无渡口则此路不通。"
                : nodeTip.kind === "gate" || nodeTip.kind === "pass"
                  ? "关隘：守方 +0.55，行军 2.6 倍，以寡当众。"
                  : nodeTip.kind === "depot" ? "屯粮之所。" : "古战场。"}</span>
            </div>
          )}
          {focus && game.commanderies[focus] && (
            <div className="tip">
              <b>{focus}</b>
              <span>{game.commanderies[focus].owner
                ? engine.nameOf.get(game.commanderies[focus].owner!) : "无主"}</span>
              {/* 悬停详情同样受迷雾约束。直接显示 garrison 真值，
                  等于把鼠标当成开天眼——刺探就白做了 */}
              <span>戍兵 {observedGarrison(game, seat, focus, engine.P).text}</span>
              {game.commanderies[focus].owner === seat ? (
                <>
                  <span>城防 {game.commanderies[focus].defense}{"\u3000"}产出 {game.commanderies[focus].yieldTier}
                    {"\u3000"}民心 {game.commanderies[focus].moraleTier}</span>
                  <span>{engine.P.units[game.commanderies[focus].unit]?.name}
                    {"\u3000"}器械 {{ none: "无", ram: "冲车", mound: "土山" }[game.commanderies[focus].gear]}
                    {(() => {
                      // 驻将名单：兵力上限由人数定，所以这是选郡时最该看见的一项
                      const os = stationedAt(game, engine.roster, focus);
                      return os.length
                        ? `${"\u3000"}驻将 ${os.map((o) => o.name).join("、")}`
                        : `${"\u3000"}无名将`;
                    })()}</span>
                </>
              ) : (
                <span>{engine.P.units[game.commanderies[focus].unit]?.name}
                  {"\u3000"}城防与内情不详</span>
              )}
            </div>
          )}
        </section>

        <aside className="panel">
          {/* 状态条常驻，逐州明细折叠。简报此前是 530px 的文字墙，
              占了面板 57% 的高度，而真正要操作的候选被挤到 200px 的窗口里 */}
          <div className="status">
            <b>{GRADE_CN[me.bestGrade]} 档</b>
            <span>{standing.commanderies} 郡（开局 {me.startCommanderies}）</span>
            <span>{standing.controlledZhou} 州
              {standing.zhouSeats > 0 ? `·州治 ${standing.zhouSeats}` : ""}</span>
            <em>{nextStep}</em>
          </div>
          <details className="brief-fold">
            <summary>逐州进度</summary>
            <pre className="brief">{brief}</pre>
          </details>

          {/* 我的郡国：十几个郡的家底，此前只能在地图上一个个点开看。
              兵力上限由驻将数定、产出由产出档定、被围与断供直接决定这一季
              能不能出兵——这几项摊在一张表里，比在地图上找快得多。
              点一行即定位地图并筛出该郡的候选 */}
          <details className="mine-fold">
            <summary>我的郡国<i>{myLands.length}</i></summary>
            <table className="lands">
              <thead>
                <tr><th>郡国</th><th>兵</th><th>产</th><th>心</th><th>防</th>
                  <th>阵</th><th>将</th><th>状况</th></tr>
              </thead>
              <tbody>
                {myLands.map((L) => (
                  <tr key={L.c.id} className={L.warn ? "warn" : undefined}
                    onClick={() => { setPinned(L.c.id); setFocus(L.c.id); centerOnId(L.c.id); }}>
                    <td>{L.c.id}</td>
                    <td>{L.c.garrison}</td>
                    <td>{L.c.yieldTier}</td>
                    <td>{L.c.moraleTier}</td>
                    <td>{L.c.defense}</td>
                    <td>{FORMATION_CN[L.c.formation]}</td>
                    <td>{L.officers.length ? L.officers.map((o) => o.name).join("、") : "—"}</td>
                    <td>{L.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          {(flash.mine.length > 0 || flash.world.length > 0) && (
            <div className="flash" role="status" aria-live="polite">
              {flash.mine.length > 0 && (
                <>
                  <h3>上季战报<i>我方</i></h3>
                  <ul className="mine">{flash.mine.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {flash.world.length > 0 && (
                <>
                  <h3>天下大事</h3>
                  <ul>{flash.world.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
            </div>
          )}

          {pinned && (
            <div className="pinned-bar">
              <b>{pinned}</b>
              <span>相关候选 {shown.length} 条</span>
              <button onClick={() => setPinned(null)}>看全部</button>
            </div>
          )}

          {over ? (
            <div className="over">
              {/* 出局与归隐也要在这里收尾。此前只认 game.finished：
                  一个第 8 季就被灭光的玩家，要对着「本季无可行之事」
                  再点八次「封令结算」才看得到结果——那不是结局，是罚站 */}
              {/* 统一是这局游戏真正的胜负，档位只是评测用的量尺——两者不能混为一谈。
                  此前这里只认「打满季数」，一个真把天下打下来的玩家看到的
                  也是「终局」两个字，赢了却不知道自己赢了 */}
              <h2>{game.winner === seat ? "一统天下"
                : game.winner ? `天下归${engine.nameOf.get(game.winner) ?? game.winner}`
                : me.eliminated ? "覆灭" : me.retired ? "归隐" : "终局"}
                {"\u3000"}{GRADE_CN[me.bestGrade]} 档{"\u3000"}
                <b>{GRADE_SCORE[me.bestGrade]} 分</b>
                {!me.eliminated && <u>天下第 {rank.at}/{rank.of}</u>}</h2>
              {game.winner === seat && (
                <p className="over-lead">控 {standing.controlledZhou} 州，
                  于 {game.year} 年 · {SEASON_CN[game.season]}（第 {game.turn}/{game.seasonsPerGame} 季）
                  戡定天下。汉末群雄至此而终。</p>
              )}
              {game.winner && game.winner !== seat && (
                <p className="over-lead">{engine.nameOf.get(game.winner) ?? game.winner}
                  于第 {game.turn}/{game.seasonsPerGame} 季戡定天下，本局提前结束。</p>
              )}
              {me.eliminated && (
                <p className="over-lead">尽失疆土，止于 {game.year} 年 · {SEASON_CN[game.season]}
                  （第 {game.turn}/{game.seasonsPerGame} 季）。
                  档位仍按本局曾达到过的最高档记——打下来过的，不因后来失守而作废。</p>
              )}
              {/* 只报一个档位等于不报。玩家要知道的是「我把局面推进了多少」，
                  以及「差一步的那一步是什么」——判据是州级的，而对局十六季
                  都在郡这一层做决定，不摊开写没人算得出来 */}
              <dl className="over-stat">
                <div><dt>郡国</dt><dd>{standing.commanderies}
                  <i>开局 {me.startCommanderies}</i></dd></div>
                <div><dt>控制州</dt><dd>{standing.controlledZhou}
                  <i>开局 {me.startZhou}</i></dd></div>
                <div><dt>州治</dt><dd>{standing.zhouSeats}
                  <i>开局 {me.startSeats}</i></dd></div>
                <div><dt>夺自他方</dt><dd>{standing.conquests}<i>郡</i></dd></div>
              </dl>
              <p>{endingGap(me, standing)}</p>
              {/* 年表：十六季不该只剩一个档位。哪一季拿下了什么、哪一季被围、
                  哪一季折了名将——这些是这一局唯一留得下来的东西 */}
              <details className="over-fold" open>
                <summary>{game.seasonsPerGame} 季年表<i>{chronicle.length} 事</i></summary>
                <ol className="chron">
                  {chronicle.map((e, i) => (
                    <li key={i}><b>{e.when}</b>
                      <span>{e.text}{e.n > 1 ? `（连 ${e.n} 季）` : ""}</span></li>
                  ))}
                  {!chronicle.length && <li><span>十六季平静无事。</span></li>}
                </ol>
              </details>

              {(caught.mine.length > 0 || caught.theirs.length > 0) && (
                <details className="over-fold">
                  <summary>名将去向<i>{caught.mine.length + caught.theirs.length} 人</i></summary>
                  <dl className="captives">
                    {caught.theirs.length > 0 && (
                      <div><dt>我所俘</dt><dd>{caught.theirs.join("、")}</dd></div>
                    )}
                    {caught.mine.length > 0 && (
                      <div><dt>我方被俘</dt><dd>{caught.mine.join("、")}</dd></div>
                    )}
                  </dl>
                </details>
              )}

              <p className="over-note">档位按本局曾达到过的最高档记，判的是相对开局的增量——
                守成不得分。天下排名按终局郡数，仅供参照，不进计分。</p>
              <div className="over-acts">
                <button onClick={() => { clearSave(); setGame(null); setSeat(null); }}>再来一局</button>
                <button className="ghost" onClick={() => {
                  // 把这一局抄成一段纯文本，方便贴出去。replay 尚未做界面，
                  // 但至少让人能把自己那一局带走
                  const lines = [
                    `汉末沙盘\u3000${engine.nameOf.get(seat) ?? seat}\u3000`
                      + `${GRADE_CN[me.bestGrade]}档 ${GRADE_SCORE[me.bestGrade]}分\u3000`
                      + `天下第 ${rank.at}/${rank.of}`,
                    `郡国 ${me.startCommanderies}→${standing.commanderies}\u3000`
                      + `控制州 ${me.startZhou}→${standing.controlledZhou}\u3000`
                      + `州治 ${me.startSeats}→${standing.zhouSeats}\u3000`
                      + `夺自他方 ${standing.conquests}`,
                    `seed ${game.seed}`,
                    "",
                    ...chronicle.map((e) => `${e.when}\u3000${e.text}${e.n > 1 ? `（连 ${e.n} 季）` : ""}`),
                  ];
                  navigator.clipboard?.writeText(lines.join("\n"));
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}>{copied ? "已复制" : "抄一份战绩"}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="acts">
                {[...byType].sort((a, b) => PANEL_ORDER.indexOf(a[0]) - PANEL_ORDER.indexOf(b[0]))
                  // 默认只展开救援（自家城被围，属急事且条数少）。
                  // 征伐曾默认展开，实测它一个面板就有 2128px 高而容器只有 522px——四屏。
                  // 后果是免费的刺探排在第五个面板，玩家得先滚过二十条「因为没探所以
                  // 全是未知」的候选才找得到那件最该先做的事。全折叠时六个面板连同条数
                  // 一屏可见，离任何一类都只有一次点击
                  .map(([cls, list]) => (
                  <details key={cls} open={cls === "relief"}>
                    <summary>
                      {TYPE_CN[cls] ?? cls}
                      <i>{cls === "campaign" && onlyWinnable
                        ? `${list.filter((c) => c.forecast?.verdict !== "不破").length}/${list.length}`
                        : list.length}</i>
                      {cls === "campaign" && list.some((c) => c.forecast?.verdict === "不破") && (
                        <button className="only-winnable"
                          onClick={(e) => { e.preventDefault(); setOnlyWinnable((v) => !v); }}>
                          {onlyWinnable ? "看全部" : "只看打得下的"}
                        </button>
                      )}
                    </summary>
                    {(cls === "campaign" && onlyWinnable
                        ? list.filter((c) => c.forecast?.verdict !== "不破")
                        : list
                      ).map((c) => {
                      const on = picked.includes(c.key);
                      // 能不能再选这一条：令数够，且在「已选那些之后」引擎仍认它
                      const why = on || !adm ? null
                        : c.cost > me.ap - spent ? `令数不足（余 ${me.ap - spent}，需 ${c.cost}）`
                        : validate(adm.state, { faction: seat, action: c.action },
                                   engine.G, undefined, engine.roster);
                      const afford = on || !why;
                      return (
                        <label key={c.key} className={`act${on ? " on" : ""}${afford ? "" : " off"}`}
                          title={why ?? undefined}
                          onMouseEnter={() => setHoverKey(c.key)}
                          onMouseLeave={() => setHoverKey((k) => (k === c.key ? null : k))}
                          onFocus={() => setHoverKey(c.key)}
                          onBlur={() => setHoverKey((k) => (k === c.key ? null : k))}>
                          <input type="checkbox" checked={on} disabled={!afford}
                            onChange={() => setPicked((p) =>
                              on ? p.filter((k) => k !== c.key) : [...p, c.key])} />
                          <span className="act-body">
                            <span className="act-head">
                              <b>{titleOf(c.action, (id) => engine.nameOf.get(id) ?? id,
                                (id) => engine.roster.byId.get(id)?.name ?? id)}</b>
                              {c.action.type === "campaign" && "strength" in c.action
                                && <i className="tier">{STRENGTH_CN[c.action.strength]}</i>}
                              {c.forecast && (
                                <em className={`verdict v-${
                                  c.forecast.verdict === "破城" ? "win"
                                  : c.forecast.verdict === "不破" ? "no" : "maybe"}`}>
                                  {c.forecast.verdict}
                                </em>
                              )}
                              {/* 判词答「打不打得赢」，这枚答「值不值得打」。
                                  两者常常不指向同一个目标，所以必须并排摆着，
                                  而不是把后者埋在灰色长句的末尾。丙档不标——
                                  开局阶段几乎每次夺郡都升丙，标了等于没标 */}
                              {(c.gain?.upgrade === "jia" || c.gain?.upgrade === "yi") && (
                                <em className="verdict v-gain">
                                  升{c.gain.upgrade === "jia" ? "甲" : "乙"}档
                                </em>
                              )}
                              {c.gain?.isSeat && <i className="tier">州治</i>}
                              {c.gain?.isCapital && <i className="tier t-cap">敌治所</i>}
                            </span>
                            {c.forecast && (
                              <span className="act-nums">
                                缺口 {c.forecast.breachLo === c.forecast.breachHi
                                  ? c.forecast.breachLo
                                  : `${c.forecast.breachLo}–${c.forecast.breachHi}`}
                                {"\u3000"}可防守 {c.forecast.holdLo === c.forecast.holdHi
                                  ? c.forecast.holdLo
                                  : `${c.forecast.holdLo}–${c.forecast.holdHi}`}
                                {c.forecast.fog === "tier" && <u>未探</u>}
                              </span>
                            )}
                            <span className="act-detail">{c.label}</span>
                          </span>
                          <b className="cost">
                            {why ? why.slice(0, 10) : c.cost === 0 ? "免费" : `${c.cost} 令`}
                          </b>
                        </label>
                      );
                    })}
                  </details>
                ))}
                {!candidates.length && <p className="play-note">本季无可行之事。</p>}
              </div>
              <button className="go" onClick={submit} disabled={!picked.length || busy}>
                {busy
                  ? <>模型思考中 · {Object.values(thinking).filter((x) => x === "思考中").length} 席未答</>
                  : <>封令结算 · {picked.length} 条 · 耗 {spent}/{me.ap} 令</>}
                {!busy && picked.length > 0 && spent < me.ap
                  && <i>尚余 {me.ap - spent} 令，只结转 {engine.P.carryCap}</i>}
              </button>
            </>
          )}

        </aside>
      </div>
    </main>
  );
}
