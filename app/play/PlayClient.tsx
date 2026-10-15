"use client";

// 对局界面。
//
// 引擎是纯函数，直接跑在客户端：同一 seed 与同一命令必得同一结果，
// 服务端与浏览器算出来是一样的，不必为了「权威结算」多绕一层。
//
// 疆域不烤进底图。底图是中性地形（tools/render-terrain-map.mjs FACTIONS=0），
// 归属由 territory-grid 逐格查表后按当前局势实时着色——烤进去的疆域
// 一开打就不对了。
import type { TerritoryGrid as Territory } from "@/lib/game/territory.ts";
import { upkeepFor } from "@/lib/game/engine/economy.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fitLabel, textWidth, type Box } from "./label-fit.ts";
import { buildGraph, listActions, POLICY_CN, type Graph }
  from "@/lib/game/engine/actions.ts";
import { buildRoster, stationedAt, type Roster } from "@/lib/game/engine/officers.ts";
import { observedGarrison, observedFormation, visibleLog, PUBLIC_EVENTS }
  from "@/lib/game/engine/intel.ts";
import { FORMATION_CN } from "@/lib/game/engine/combat.ts";
import { admit } from "@/lib/arena/seat/admit.ts";
import { type ModelTurnRecord } from "@/lib/arena/seat/model-seat.ts";
import { ProxyLlmClient } from "@/lib/arena/llm/proxy-client.ts";
import { SessionPanel } from "./SessionPanel.tsx";
import { MatchSetup, type ModelRow } from "./MatchSetup.tsx";
import { advanceSeason, budgetMessage, modelSeats, newSession } from "@/lib/game/session.ts";
import { GRADE_SCORE } from "@/lib/arena/scoring.ts";
import { Primer } from "./Primer.tsx";
import { PANEL_ORDER, TYPE_CN } from "./panels.ts";
import { nextGrade } from "./grade-gap.ts";
import { factionAbbr } from "./faction-abbr.ts";
import { save as saveGame, load as loadGame, clear as clearSave, packStamp,
  type SavedGame } from "@/lib/game/save.ts";
import { loadParams, marchSeasons, provCapOf, type EngineParams }
  from "@/lib/game/engine/params.ts";
import { createGame } from "@/lib/game/engine/setup.ts";
import { supplyReach } from "@/lib/game/engine/resolve.ts";
import { buildGeography, briefFor, standingOf, GRADE_CN, GRADE_RANK, GRADE_CUTS, ABS_CUTS,
         type Geography }
  from "@/lib/game/engine/victory.ts";
import type { Action, Candidate, GameState, Grade } from "@/lib/game/engine/types.ts";
import { cmp } from "@/lib/game/engine/cmp";

/**
 * 瓦片金字塔。tools/slice-map-tiles.mjs 切的五级
 * （z0 908×743 → z4 14520×11880，512 见方，webp），
 * 而对局页此前一直只贴那张 1815 的整图——放大到六倍看的仍是同一张图放大六倍。
 *
 * z4 是这一轮新渲的：缩放上限提到 14 之后，7260 那一级在八倍上就糊了。
 * 底图按 PPD=440 重渲（14520×11880，180MB 的源图不入库，跑 npm run map:base4x 重生成）
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
  { z: 4, w: 14520, h: 11880 },
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
const WALL = "/game/map/wall.webp";
/**
 * 林。
 *
 * 起因是一句反问：「森林是森林……其他三国游戏呢？」——查下来《三国志11》
 * 的地形（平原/森林/砂地/水面）是**游戏设计的地形**而非卫星数据，而它的
 * 画法恰恰是水墨。所以「水墨」与「山是山、林是林」不是二选一，是同一件事。
 * 我此前答成了二选一，那是错的。
 *
 * 数据取 Natural Earth II（公有领域，理想化自然植被、几乎不含人类影响——
 * 对公元 194 年比现代土地覆盖更合适）。只画林与疏林，山地高原留给皴笔
 */
const FOREST = "/game/map/forest.webp";
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
    case "transfer": return `自${a.from} 调兵至 ${a.to}`;
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

/** 一次调用的花费（美元）。价格是每 token 的字符串，缓存命中部分仍按入参计价 */
function costOf(r: ModelTurnRecord, price: Map<string, ModelRow>): number {
  if (r.usage?.cost != null) return r.usage.cost;
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
 * 判据是州级的（多据一州治 / 多控一整州 / 多控两州），而整局十六季都在郡这一层
 * 做决定。只报一个「丁档」，玩家算不出自己离下一档差多少，也就无从改进——
 * 那正是十六季之后最该回答的问题。数字全部现算，与 victory.ts 的 gradeOf 同源。
 */
function endingGap(
  me: { bestGrade: string; startCommanderies: number; startZhou: number; startSeats: number },
  st: { commanderies: number; controlledZhou: number; zhouSeats: number; conquests: number },
): string {
  const zhouGain = st.controlledZhou - me.startZhou;
  const seatGain = st.zhouSeats - me.startSeats;
  const n = nextGrade(zhouGain, seatGain);
  if (me.bestGrade === "ba" || me.bestGrade === "wang") {
    return `已至${GRADE_CN[me.bestGrade]}档——判的是绝对疆域，与开局无关。`;
  }
  if (n.grade) {
    // 档位是**全程最高**的棘轮，而这里的差距按**终局**状态算。两者会背离：
    // 本局摸到过乙档、后来又把那个州治丢了，于是「乙档」与「距乙档」并排出现。
    // 那不是矛盾，是这一局真实发生过的事——但必须说出来，不然读着像 bug。
    // 实测就撞见过：终局「乙 档 200 分」下面跟着「距乙档：再多控 1 州」
    const fellBack = GRADE_RANK[n.grade] <= GRADE_RANK[me.bestGrade as Grade];
    return (fellBack
      ? `本局曾达${GRADE_CN[me.bestGrade as Grade]}档，终局时已跌回——`
        + `档位按曾达到的最高档记，故仍作${GRADE_CN[me.bestGrade as Grade]}。`
        + `此刻距${GRADE_CN[n.grade]}档：`
      : `距${GRADE_CN[n.grade]}档：`)
      + `再多控 ${n.needZhou} 州，或再多据 ${n.needSeat} 个州治（一个州治算半个州）。`
      + `现控 ${st.controlledZhou} 州（开局 ${me.startZhou}）、`
      + `据 ${st.zhouSeats} 个州治（开局 ${me.startSeats}）。`;
  }
  if (me.bestGrade === "chao") {
    return `已至超档。再往上是霸（控 ${ABS_CUTS.ba} 州）与王（控 ${ABS_CUTS.wang} 州），`
      + "判绝对疆域，与开局无关。";
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
    crossings: string[]; nodes: Array<{ id: string; name: string; kind: string }> }> };
  nodes: MapNode[];
  hydrology: { coastline: Array<Array<[number, number]>>;
               rivers: Array<{ name: string; points: Array<[number, number]> }> };
  troopTypes: unknown; resources: unknown; provinceSeats: unknown;
  officers: unknown[]; pack: unknown;
};


/** 实走路径：在高程栅格上算出的折线，经过挂在该边上的关。见 tools/route-roads.mjs */
type RoadFile = { step: number; roads: Array<{
  from: string; to: string; terrain: string; via?: string[]; straight?: boolean;
  pts: Array<[number, number]>;
}> };

/** 关津港仓：非郡治的战略据点。图上画得出「这条路上卡着什么」全靠它 */
type MapNode = {
  id: string; name: string; kind: string;
  longitude: number; latitude: number; at: string | null;
};

type MapPoint = {
  id: string; name: string; zhou: string;
  /** 治所名。邺、邯郸、濮阳——城印底下的牌记写的是它，不是郡名 */
  seat?: string | null;
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
      {besieged && (() => {
        const rr = w * 0.52;
        return (
          <circle className="siege-ring" cx={x} cy={y - w * 0.3} r={rr}
            strokeWidth={rr * 0.1}
            strokeDasharray={`${(rr * 0.52).toFixed(2)} ${(rr * 0.44).toFixed(2)}`} />
        );
      })()}
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
  "b-office": 1, "b-granary": 1, "b-market": 1, "b-drill": 1,
  "b-ironworks": 1, "b-saltern": 1, "b-stud": 1, "b-farmstead": 1,
  "u-infantry": 1, "u-cavalry": 1, "u-archer": 1, "u-navy": 1,
  "g-ram": 1, "g-mound": 1,
  "f-scale": 1, "f-wings": 1, "f-square": 1,
};
/** 兵种与器械的中文。军团上那两个小标全靠它 */
const UNIT_CN2: Record<string, string> = {
  infantry: "步卒", cavalry: "骑兵", archer: "弓弩", navy: "水军",
};
const GEAR_CN2: Record<string, string> = { ram: "冲车", mound: "土山" };
/**
 * 阵型。三阵现在各有实属性（鱼鳞攻、鹤翼速、方圆耐围），不画出来就只能翻表格。
 *
 * **受迷雾约束**：自家的看真值，他家的要刺探过或结了盟才看得见——
 * 与观测里的 observedFormation 同一条规矩，否则鼠标一悬就等于开天眼
 */
const FORM_TIP: Record<string, string> = {
  scale: "鱼鳞：攻城 +1 缺口、守城 −1 可防守",
  wings: "鹤翼：行军少一季、攻城 −1 缺口",
  square: "方圆：城中存粮 +1 季",
};
/**
 * 物产 → 它能建的那座建筑。
 *
 * 未建的物产就画那座建筑的**虚影**：一眼看出「这个郡有铁，但铁官还没修」。
 * 不必另画一套物产图元，而且这正是它在玩法里的意义——物产是建筑的前提
 */
const RES_BUILD: Record<string, string> = {
  iron: "ironworks", salt: "saltern", horse: "stud", tuntian: "farmstead",
};
const RESOURCE_CN2: Record<string, string> = {
  iron: "铁", salt: "盐", horse: "牧苑", tuntian: "可垦之地",
};
/**
 * 建筑：引擎里每郡至多三座、八种各有实数（官府加令、仓廪加存粮、市产金 1.3 倍、
 * 校场增兵 1.6 倍、铁官治械半价、盐场每季 70 金、马苑统兵 1.25 倍、屯田军费半价），
 * 而图上此前**一座都不画**。近观档在城下摆一排。
 *
 * 只画自家的：他家城里建了什么，观测里本来就看不到（迷雾），
 * 画出来等于开天眼
 */
const BUILD_CN2: Record<string, string> = {
  office: "官府", granary: "仓廪", market: "市", drill: "校场",
  ironworks: "铁官", saltern: "盐场", stud: "马苑", farmstead: "屯田",
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
function ArmyMark({ x, y, s, color, marching, at, unit, gear }: {
  x: number; y: number; s: number; color: string; marching: boolean;
  /** 军团 id：同一支军团一路上是同一顶帐 */
  at: string;
  /** 兵种。野战有相克，图上一眼看得出这支打不打得过那支 */
  unit?: string;
  /** 攻城器械。它决定攻城那一击，也决定行军慢一季 */
  gear?: string;
}) {
  const kind = marching ? "tent" : "camp";
  const id = `${kind}-${variantOf(at, kind)}`;
  const w = s * 2.4;
  const l = x - w / 2, t = y - w * GLYPH_BASE;
  const badge = w * 0.52;
  return (
    <g>
      <rect x={l} y={t} width={w} height={w} fill={color}
        mask={`url(#wash-${id})`} opacity={0.9} />
      <image href={`${GLYPH}/${id}-ink.png`} x={l} y={t} width={w} height={w} />
      {/* 兵种在帐左、器械在帐右。引擎里这两样都有，图上此前一律画同一顶帐 */}
      {unit && UNIT_CN2[unit] && (
        <g><title>{UNIT_CN2[unit]}</title>
          <image href={`${GLYPH}/u-${unit}-0-ink.png`}
            x={l - badge * 0.72} y={y - badge * 0.92} width={badge} height={badge} />
        </g>
      )}
      {gear && gear !== "none" && GEAR_CN2[gear] && (
        <g><title>{GEAR_CN2[gear]}</title>
          <image href={`${GLYPH}/g-${gear}-0-ink.png`}
            x={l + w - badge * 0.28} y={y - badge * 0.92} width={badge} height={badge} />
        </g>
      )}
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
/**
 * 边的画法。**一律实线**——虚线在这张图上是灾难。
 *
 * 原本丘陵是 9 5、山道是 3 6、水路是 13 4 3 4。问题是底图的山脉皴笔本身
 * 就是一地短墨点，与这些短划形状几乎一样；再叠上细波浪的郡国界，
 * 三套细线混在一起，眼睛分不出哪根是路。用户的原话是「压根看不懂」。
 *
 * 改成实线之后，地形只靠**颜色与粗细**区分：平道最细最淡，关道最粗最深
 *（关道正是要一眼看出来的那一类），水路走青色。虚线省下的那点信息量，
 * 远不抵它制造的噪声。
 */
const EDGE_STYLE: Record<string, { stroke: string; dash: string; width: number }> = {
  plain:    { stroke: "#8a7c62", dash: "", width: 1.3 },
  hill:     { stroke: "#7b6c4a", dash: "", width: 1.5 },
  mountain: { stroke: "#5d5443", dash: "", width: 1.7 },
  river:    { stroke: "#5b7f93", dash: "", width: 1.9 },
  gate:     { stroke: "#7a3b32", dash: "", width: 2.3 },
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
  /** 边 → 实走折线（经纬度）。离线在高程栅格上算，取不到就退回城心直连 */
  roads: Map<string, Array<[number, number]>>;
  /** 水系。线在任意倍数下重画，不跟着底图一起糊 */
  water: Bundle["hydrology"];
}

/** 图例里的小图与地图上的是同一段代码画的——另画一份必然与地图分家 */
const legendGlyph = (kind: string) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`${GLYPH}/${kind}-0-ink.png`} alt="" width={24} height={24} />
);
/** 图例里的单幅小图（建筑、兵种、器械都只有一幅） */
const legendPlain = (id: string) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`${GLYPH}/${id}-0-ink.png`} alt="" width={22} height={22} />
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

export function PlayClient() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [terr, setTerr] = useState<{ meta: Territory["meta"]; idx: Uint8Array; order: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [seat, setSeat] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  /** delta：本季各家郡数增减。由结算前后的归属对比算出，不从战报文字里抠——
      「原属 X」那种解析一旦措辞改了就悄悄失效 */
  const [flash, setFlash] = useState<{
    mine: string[]; world: string[]; delta: Record<string, number>;
    /** 上一季在哪儿打过。地点取事件的 at 字段——不从战报文字里抠 */
    battles: Array<{ id: string; kind: string; mine: boolean }>;
  }>({ mine: [], world: [], delta: {}, battles: [] });
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

  // 顶栏钉在顶上，画心钉在顶栏之下——而顶栏在窄屏会折行。把实测高度写成
  // CSS 变量，画心的 top 与高度都由它算，写死一个值会让画心底边被切掉。
  //
  // 用**回调 ref** 而不是 useRef + useEffect([])：顶栏要等选完席位才挂载，
  // 而 [] 的 effect 在首次挂载时就跑完了，那一刻 ref 还是 null，
  // 于是变量永远不写（实测 --bar-h 为空，全靠 CSS 里的回退值凑巧对上）
  const barObs = useRef<ResizeObserver | null>(null);
  const barRef = useCallback((el: HTMLElement | null) => {
    barObs.current?.disconnect();
    barObs.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--bar-h", `${el.offsetHeight}px`);
    });
    ro.observe(el);
    barObs.current = ro;
  }, []);
  /** 图例里的开关：常驻只画自家接出去的路，想看全网时打开 */
  const [allRoads, setAllRoads] = useState(false);
  /** 指到哪支军团。兵种、器械、主将、去向这些都在悬停详情里说 */
  const [armyTip, setArmyTip] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPrimer, setShowPrimer] = useState(false);

  // ── 模型执子 ──────────────────────────────────────────────────
  // 席位 → 模型 id。不在表里的势力仍由机器人执子。
  // 三十一家全用模型是不现实的：一季就是三十一次调用，等一分钟看一季
  const [session, setSession] = useState(() => newSession());
  const { modelOf, records } = session;
  const spectator = session.human === null;
  const [autoPlay, setAutoPlay] = useState(false);
  const advancing = useRef(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [thinking, setThinking] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [modelErr, setModelErr] = useState<string | null>(null);
  /**
   * 本局季数。默认取内容包的 16——那是**评测口径**（一局 16 次调用，
   * 48 局才付得起）。作为游戏它偏短：十六季刚把内政理顺就结束了，
   * 而史上 194 到三分天下用了二十六年。长局才够得着超/霸/王三档
   */


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
  const [box, setBox] = useState({ w: 1200, h: 980 });
  const roRef = useRef<ResizeObserver | null>(null);
  /**
   * 用**回调 ref** 挂观察者，不用 useEffect + []。
   *
   * 那样写的话，effect 在选席页就跑了一次——那时地图还没渲染、ref 是 null，
   * 于是直接 return，而依赖是空数组，再也不会重跑。box 就一直停在初始值
   * 1200×980，实际画框是 1181×821。后果两处：
   *   矢量层的变换按 1200 算，与底图错开约 16 像素（静止探针量出来的）
   *   minK（铺满画框的倍数）按 980 算，「全图」并没有真的铺满
   */
  const wrapRef = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    roRef.current = ro;
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
  /**
   * 展卷：把右边那栏收起来，画心占满整屏。
   *
   * 屏幕越大越需要它——同样一块屏，看图时不该有三分之一让给候选表。
   * 收起来不是关掉：令数、档位、结算都还在顶栏，展开一次就回来
   */
  const [unrolled, setUnrolled] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // cnText 要在 engine 载入前后都可用，用 ref 取当前值而不进依赖数组
  const engineRef = useRef<Engine | null>(null);
  useEffect(() => { engineRef.current = engine; }, [engine]);

  // ── 载入 ────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [b, t, rd] = await Promise.all([
          fetch("/game/runtime-194.json").then((r) => r.json() as Promise<Bundle>),
          fetch("/game/territory-grid.json").then((r) => r.json() as Promise<Territory>),
          // 实走路径。取不到就退回城心直连（旧行为），不让一份缺失的附加数据
          // 把整张图拖垮——它是「更好看」，不是「能不能玩」
          fetch("/game/roads.json").then((r) => (r.ok ? r.json() : null))
            .catch(() => null) as Promise<RoadFile | null>,
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
          // 键取「两端郡名」而非边序号：路由是离线烤的，边表若增删一条，
          // 按序号对齐会整体错位而没人察觉
          roads: new Map((rd?.roads ?? []).map((r) => [`${r.from}\u0000${r.to}`, r.pts])),
          water: b.hydrology ?? { coastline: [], rivers: [] },
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

  const persist = useCallback((nextGame: GameState, nextSession = session) => {
    if (!engine || !seat) return false;
    return saveGame({
      packStamp: packStamp(engine.P.seasonsPerGame, engine.points.length, engine.P.epochCount,
        (engine.pack as { constants?: Record<string, unknown> }).constants),
      seat, game: nextGame, picked, session: nextSession,
    });
  }, [engine, seat, picked, session]);

  useEffect(() => {
    if (!game || !seat) return;
    const timer = window.setTimeout(() => {
      if (!persist(game)) setTurnError("本地存档写入失败；模型调用已受阻，请检查浏览器存储空间。");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [game, seat, persist]);

  // 模型列表按需拉。开局页一进来就拉等于替所有人付一次外部请求，
  // 而绝大多数人不会开这个面板
  const loadModels = useCallback(() => {
    if (models.length) return;
    fetch("/api/openrouter/models")
      .then((r) => r.json() as Promise<{ data?: ModelRow[]; error?: string }>)
      .then((d) => {
        setModels(d.data ?? []);
        if (d.error) setModelErr(d.error);
        else if (!d.data?.length) setModelErr("模型列表为空 —— 多半是没配 OPENROUTER_API_KEY");
      })
      .catch((e: Error) => setModelErr(`取模型列表失败：${e.message}`));
  }, [models.length]);

  const start = useCallback(() => {
    const factionId = session.human ?? "caocao";
    if (!engine) return;
    const s = createGame(engine.data, {
      seed: `play-${factionId}-${Math.floor(Date.now() / 1000)}`,
      roster: engine.roster, geo: engine.geo,
      // 传通行图才建得起据点表：据点归它所在之郡的主人，
      // 而「在哪条边上、算哪个郡境内」只有通行图知道
      graph: engine.G,
      seasons: 64, // 沿用原64季局的纪元节奏，统一局不会在此季终止。
      endCondition: "unification",
    }, engine.P);
    clearSave(); setResume(null);
    setSeat(factionId); setGame(s); setPicked([]); setFlash({ mine: [], world: [], delta: {}, battles: [] }); setFlips([]);
    setSession({ ...session, callsUsed: 0, plans: {}, drops: {}, records: [], since: 0 });
    setThinking({}); setAutoPlay(false); setTurnError(null); setPinned(null);
    // 开局把镜头放到自己治所上，而不是让人先在全图里找自己
    const cap = s.factions[factionId]?.capital;
    const p = cap ? engine.points.find((c) => c.id === cap) : null;
    setView(p ? centerOn(p.longitude, p.latitude, Math.max(4, minK), MAP) : fitAll(minK));
  }, [engine, session, minK]);

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
    return admit(game, seat, picked, candidates, engine.G, engine.roster, undefined, engine.P);
  }, [engine, game, seat, picked, candidates]);
  const spent = adm?.spent ?? 0;

  const submit = useCallback(async () => {
    if (!engine || !game || !seat || advancing.current || game.finished) return;
    const budget = budgetMessage(game, session);
    if (budget) { setAutoPlay(false); setTurnError(budget); return; }
    advancing.current = true;
    setBusy(true); setTurnError(null);
    const modeled = modelSeats(game, session);
    setThinking(Object.fromEntries(modeled.map((f) => [f, "思考中"])));
    try {
      const humanOrders = spectator ? [] : admit(game, seat, picked, candidates,
        engine.G, engine.roster, undefined, engine.P).orders;
      const result = await advanceSeason(game, session, humanOrders, {
        client: new ProxyLlmClient(), pack: engine.pack, g: engine.G, P: engine.P,
        roster: engine.roster, geo: engine.geo,
        nameOf: (id) => engine.nameOf.get(id) ?? id,
      }, (reserved) => {
        if (modeled.length && !persist(game, reserved)) throw new Error("无法保存调用额度，本季未调用模型。");
        setSession(reserved);
      }, (f, record) => {
        setThinking((t) => ({ ...t, [f]: record.failure ? `失败：${record.failure}` : `${record.admission.admitted.length} 令` }));
      });
      const r = { state: result.game };
      setSession(result.session);
      if (result.session.records.slice(session.records.length).some((record) => record.failure)) {
        setAutoPlay(false);
        setTurnError("本季有模型未能下令，已暂停自动推进。可查看决策记录后手动继续。");
      }
      const before = game.log.length;
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
      // 各家本季的郡数增减：与 setFlips 同一套口径（结算前后归属对比），
      // 只是不限于己方
      const delta: Record<string, number> = {};
      for (const c of Object.values(r.state.commanderies)) {
        const was = game.commanderies[c.id]?.owner ?? null;
        if (c.owner === was) continue;
        if (c.owner) delta[c.owner] = (delta[c.owner] ?? 0) + 1;
        if (was) delta[was] = (delta[was] ?? 0) - 1;
      }
      // 上一季的战事所在。只收「打过」的那几类：破城由易主的朱墨环画，
      // 这里画的是**打了但城没换手**的那些——强攻未克、野战、被围、解围。
      // 图上此前只看得见结果（谁的地盘变了），看不见过程（哪儿在打）
      const FIGHT = new Set(["siege-hold", "field-win", "field-fail", "besieged",
                             "siege-lift", "relief"]);
      const seenAt = new Set<string>();
      const battles: Array<{ id: string; kind: string; mine: boolean }> = [];
      for (const e of fresh) {
        if (!e.at || !FIGHT.has(e.kind) || seenAt.has(e.at)) continue;
        seenAt.add(e.at);
        battles.push({ id: e.at, kind: e.kind, mine: e.faction === seat });
      }
      setFlash({
        delta, battles,
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
      setGame(r.state);
      setPicked([]);
      if (r.state.finished) setAutoPlay(false);
    } catch (e) {
      setTurnError(e instanceof Error ? e.message : String(e));
      setAutoPlay(false);
    } finally {
      advancing.current = false;
      setBusy(false);
    }
  }, [engine, game, seat, candidates, picked, cnText, session, spectator, persist]);

  useEffect(() => {
    if (!autoPlay || busy || !spectator || !game || game.finished) return;
    const timer = window.setTimeout(() => { void submit(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [autoPlay, busy, spectator, game, submit]);

  // ── 疆域绘制 ────────────────────────────────────────────────────
  // 两道工序，仿传世舆图：先以低分辨率格网软填色域（放大时自带晕开的边），
  // 再在**不同势力**之间描墨线。只在势力之间描——同一方内部的郡界描出来
  // 就是一张网格纸，那正是「元素堆砌」的观感来源。
  // 近观档：疆域色让一档、不再糊边。挂 view.k 会每帧重画，故只认这个布尔量
  const near = view.k >= 3.2;
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
      // 色块一重，整幅就退回「涂色地图」。
      // 近观时再让一档：格网是 0.1°（图上 5.5 像素）的，放大八倍后一格就有
      // 四十八个屏幕像素，那片色成了糊在地形上的一层雾——凑近看要看见地，
      // 归属交给城印与那道墨界
      img.data[o + 3] = Math.round((f === seat ? 104 : 54) * (near ? 0.55 : 1));
    }
    // 在小画布上先做一遍 JS 模糊，再平滑放大。
    // 不用 ctx.filter：Safari 桌面到 17.6 不支持、18 起默认关闭，
    // 那边看到的会是棱角分明的沃罗诺伊格子——正是这行想避免的观感。
    // 近观时不糊：那两遍模糊在格网上是 ±2 格，放大八倍就是一百个屏幕像素的雾
    if (!near) {
      blurRGBA(img.data, cols, rows, 1);
      blurRGBA(img.data, cols, rows, 1);
    }
    pctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(pad, 0, 0, cv.width, cv.height);

    // 疆界墨线不在这儿画了——它是**线**，而线不必是像素。
    // 格网是 0.1°（图上 5.5 像素），画进这块画布再放到十四倍，一格就是
    // 七十七个屏幕像素，那道界成了一排积木。移到 SVG 里按矢量描，见下面 borders
  }, [terr, game, engine, seat, near]);

  // ── 疆界：矢量描，不进画布 ───────────────────────────────────────
  //
  // 这道界此前画在那块低分辨率画布上：格网 0.1°（图上 5.5 像素），放到十四倍
  // 一格就是七十七个屏幕像素——界成了一排红积木，比山糊得还扎眼。
  // 而它是**线**：把格边接成折线、按同一套确定性抖动画成弧，
  // 两条 path（己方一条、他方一条）就够，任意倍数都是实的。
  //
  // 抖动函数与原来逐字相同：照直画格边出来是棱角分明的沃罗诺伊图，
  // 看着像算出来的而不是画出来的
  const borders = useMemo(() => {
    if (!terr || !game) return { mine: "", other: "" };
    const { cols, rows, none } = terr.meta;
    const own = new Array<string | null>(cols * rows).fill(null);
    for (let i = 0; i < terr.idx.length; i += 1) {
      const k = terr.idx[i];
      if (k === none) continue;
      own[i] = game.commanderies[terr.order[k]]?.owner ?? null;
    }
    // 格坐标 → 图上坐标。territory-grid 与地图同一套等距圆柱投影
    const cell = (terr.meta as { cellSize?: number }).cellSize ?? 0.1;
    const gx = (c: number) => ((terr.meta.west + c * cell) - MAP.west) * MAP.ppd;
    const gy = (r: number) => (MAP.north - (terr.meta.north - r * cell)) * MAP.ppd;
    const W_CELL = cell * MAP.ppd;                      // 一格在图上多宽
    const wobble = (a: number, b: number) => {
      const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      // 抖幅照旧：原来是 (rand−0.5)·S·1.5，S 是一格 5 像素，即 ±0.75 格。
      // 第一版只给了 ±0.3 格，界画出来是一条规整的阶梯——那正是这个抖动要避开的
      return (n - Math.floor(n) - 0.5) * W_CELL * 1.5;
    };
    const d = { mine: "", other: "" };
    const put = (into: "mine" | "other",
                 x1: number, y1: number, x2: number, y2: number, k: number) => {
      const mx = (x1 + x2) / 2 + wobble(k, 7.3);
      const my = (y1 + y2) / 2 + wobble(k, 19.1);
      d[into] += `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} `
               + `${x2.toFixed(1)} ${y2.toFixed(1)}`;
    };
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const f = own[i];
        if (!f) continue;
        const into = f === seat ? "mine" : "other";
        if ((c + 1 < cols ? own[i + 1] : null) !== f) {
          put(into, gx(c + 1), gy(r), gx(c + 1), gy(r + 1), i);
        }
        if ((r + 1 < rows ? own[i + cols] : null) !== f) {
          put(into, gx(c), gy(r + 1), gx(c + 1), gy(r + 1), i + 0.5);
        }
      }
    }
    return d;
  }, [terr, game, seat]);

  /**
   * 郡国界：每个郡国自己管多大一片。
   *
   * 疆域那条界只描**不同势力之间**，于是同属一家的几个郡在图上连成一片，
   * 「泰山郡到底管到哪」看不出来。而这正是这套游戏的基本单位——玩家下的
   * 每一条令都以郡国为单位。
   *
   * 与疆域界不同，**这条界是不变的**：郡国的范围由郡治做最近邻定死，
   * 与谁占着它无关。所以只依赖 terr，不跟着局势重算——它有近万段路径，
   * 每季重算一遍纯属浪费。
   *
   * 抖动的种子与疆域界错开：两条界若抖成同一条曲线，重叠处会显得像描重了。
   */
  const junBorders = useMemo(() => {
    if (!terr) return "";
    const { cols, rows, none } = terr.meta;
    const cell = (terr.meta as { cellSize?: number }).cellSize ?? 0.1;
    const gx = (c: number) => ((terr.meta.west + c * cell) - MAP.west) * MAP.ppd;
    const gy = (r: number) => (MAP.north - (terr.meta.north - r * cell)) * MAP.ppd;
    const W_CELL = cell * MAP.ppd;
    const wob = (a: number, b: number) => {
      const n = Math.sin(a * 271.3 + b * 419.7) * 26571.1231;
      return (n - Math.floor(n) - 0.5) * W_CELL * 1.1;
    };
    let d = "";
    const put = (x1: number, y1: number, x2: number, y2: number, k: number) => {
      const mx = (x1 + x2) / 2 + wob(k, 3.7);
      const my = (y1 + y2) / 2 + wob(k, 11.9);
      d += `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} `
         + `${x2.toFixed(1)} ${y2.toFixed(1)}`;
    };
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const k = terr.idx[i];
        if (k === none) continue;
        // 只在**两侧都是陆地且分属不同郡国**处描线。与海的交界由海岸线负责，
        // 在这里再描一遍就是把海岸描重了
        if (c + 1 < cols && terr.idx[i + 1] !== none && terr.idx[i + 1] !== k) {
          put(gx(c + 1), gy(r), gx(c + 1), gy(r + 1), i);
        }
        if (r + 1 < rows && terr.idx[i + cols] !== none && terr.idx[i + cols] !== k) {
          put(gx(c), gy(r + 1), gx(c + 1), gy(r + 1), i + 0.5);
        }
      }
    }
    return d;
  }, [terr]);

  /**
   * 每个郡辖境里**最宽的一条横行**：区域名写在哪、放不放得下。
   *
   * 郡不是城。魏郡是十五个县那一片，城叫邺；赵国五个县，城叫邯郸。
   * 此前图上只有一枚城印、底下一块牌记写着「魏郡」——把一整个省画成了
   * 一座城，还把城的名字写错了。名字数据一直是对的（105 个郡的治所名
   * 全有，且没有一个与郡名相同），错的是画法。
   *
   * 所以：城印底下的牌记写**治所名**，郡名写进**辖境的阴影里**。
   *
   * 位置不取重心——L 形与新月形的郡（沿河、环山的都是）重心会落在境外。
   * 取「最宽的一条横行」的中点：横排的字要的正是横向的空间，
   * 而这条行的长度同时就是**能不能写下**的答案。放不下就不写，
   * 这条规则自带 LOD——整幅可见时只有大郡有名，放大后小郡自己长出来。
   */
  const junBand = useMemo(() => {
    if (!terr) return null;
    const { cols, rows, none } = terr.meta;
    const cell = (terr.meta as { cellSize?: number }).cellSize ?? 0.1;
    type Band = { x: number; y: number; w: number; r: number };
    const runs = new Map<string, Band[]>();
    for (let r = 0; r < rows; r += 1) {
      let c = 0;
      while (c < cols) {
        const k = terr.idx[r * cols + c];
        if (k === none) { c += 1; continue; }
        let e = c;
        while (e + 1 < cols && terr.idx[r * cols + e + 1] === k) e += 1;
        const len = e - c + 1;
        const id = terr.order[k];
        if (id) {
          if (!runs.has(id)) runs.set(id, []);
          runs.get(id)!.push({
            x: ((terr.meta.west + (c + len / 2) * cell) - MAP.west) * MAP.ppd,
            y: (MAP.north - (terr.meta.north - (r + 0.5) * cell)) * MAP.ppd,
            w: len * cell * MAP.ppd, r,
          });
        }
        c = e + 1;
      }
    }
    // 每郡留**三条**最宽的行，且彼此至少隔三行——只留一条的话，
    // 那一条常常正压在自己的城印上（实测魏郡与赵国最宽行同为 16 格，
    // 赵国写得出来、魏郡写不出来，差别就在城印压住了唯一那个落点）
    const out = new Map<string, Band[]>();
    for (const [id, list] of runs) {
      const sorted = list.sort((a, b) => b.w - a.w || a.r - b.r);
      const keep: Band[] = [];
      for (const b of sorted) {
        if (keep.length >= 3) break;
        if (keep.some((x) => Math.abs(x.r - b.r) < 3)) continue;
        keep.push(b);
      }
      out.set(id, keep);
    }
    return out;
  }, [terr]);

  /**
   * 势力图那一档要写的名字：每一家的**版图**里最宽的一条横行。
   *
   * 势力图上不画城印（那个倍数上 232 条边里 127 条摆不下棋子），
   * 于是「这片橙的是谁」就没人答了——疆域色块能分出彼此，分不出是谁家。
   * 三十一家共用三十一种土色，靠色卡认人是认不出来的。
   *
   * 与郡名同一套办法（最宽横行、写不下就不写），但聚合的是**当季归属**，
   * 所以它随打随变：袁绍吞了一郡，冀州那片字就跟着长一点。
   */
  const factionBand = useMemo(() => {
    if (!terr || !game) return null;
    const { cols, rows, none } = terr.meta;
    const cell = (terr.meta as { cellSize?: number }).cellSize ?? 0.1;
    type Band = { x: number; y: number; w: number; r: number };
    const runs = new Map<string, Band[]>();
    for (let r = 0; r < rows; r += 1) {
      let c = 0;
      while (c < cols) {
        const k = terr.idx[r * cols + c];
        const f = k === none ? null : game.commanderies[terr.order[k]]?.owner ?? null;
        if (!f) { c += 1; continue; }
        let e = c;
        while (e + 1 < cols) {
          const k2 = terr.idx[r * cols + e + 1];
          const f2 = k2 === none ? null : game.commanderies[terr.order[k2]]?.owner ?? null;
          if (f2 !== f) break;
          e += 1;
        }
        const len = e - c + 1;
        if (!runs.has(f)) runs.set(f, []);
        runs.get(f)!.push({
          x: ((terr.meta.west + (c + len / 2) * cell) - MAP.west) * MAP.ppd,
          y: (MAP.north - (terr.meta.north - (r + 0.5) * cell)) * MAP.ppd,
          w: len * cell * MAP.ppd, r,
        });
        c = e + 1;
      }
    }
    // 留四条最宽的行，彼此隔六行以上。只留一条时它常常正落在州名上——
    // 一家的版图重心与它所据之州的重心本来就在同一处，实测刘表、吕布、
    // 曹操因此全被「荆州」「兖州」挡掉
    const out = new Map<string, Band[]>();
    for (const [f, list] of runs) {
      const sorted = list.sort((a, b) => b.w - a.w || a.r - b.r);
      const keep: Band[] = [];
      for (const b of sorted) {
        if (keep.length >= 4) break;
        if (keep.some((x) => Math.abs(x.r - b.r) < 6)) continue;
        keep.push(b);
      }
      out.set(f, keep);
    }
    return out;
  }, [terr, game]);

  /**
   * 指到（或钉住）某郡时，把它的**辖境**整块点亮。
   *
   * 郡国界常驻着，但极淡——一百零五圈轮廓若都画得清楚，图就成了网格纸。
   * 而「泰山郡管多大一片」这个问题，靠一圈淡线是读不出来的，得整块亮起来。
   *
   * 只算当前这一个郡：走一遍网格挑出属于它的格子，按行合并成横条
   *（相邻同行的格子并成一条，路径能小一个量级）。一个郡约几百格，
   * 每次指过去重算一遍也不贵——比预先算好一百零五块省得多。
   */
  const focusArea = useMemo((): { fill: string; line: string } => {
    // 不在这里看 lod：这个 memo 写在 lod 之前，读它会 ReferenceError
    //（这个组件里同类的顺序坑已经栽过两次）。档位判断放到渲染处
    const id = pinned ?? focus;
    if (!terr || !id) return { fill: "", line: "" };
    const k = terr.order.indexOf(id);
    if (k < 0) return { fill: "", line: "" };
    const { cols, rows } = terr.meta;
    const cell = (terr.meta as { cellSize?: number }).cellSize ?? 0.1;
    const gx = (c: number) => ((terr.meta.west + c * cell) - MAP.west) * MAP.ppd;
    const gy = (r: number) => (MAP.north - (terr.meta.north - r * cell)) * MAP.ppd;
    // 填充按行合并成横条（路径小一个量级），轮廓另走一遍只取**外边**——
    // 横条拼出来的路径不能描边：条与条之间的内部线会一起被描出来。
    //
    // 轮廓要与常驻的郡国界**用同一套抖动**，否则一条是手绘曲线、一条是方格
    // 阶梯，叠在一起像描歪了。种子的取法照抄 junBorders：右边取本格序号，
    // 下边取本格序号 +0.5；而左边就是左邻的右边、上边就是上邻的下边
    const W_CELL = cell * MAP.ppd;
    const wob = (a: number, b: number) => {
      const n = Math.sin(a * 271.3 + b * 419.7) * 26571.1231;
      return (n - Math.floor(n) - 0.5) * W_CELL * 1.1;
    };
    const seg = (x1: number, y1: number, x2: number, y2: number, key: number) => {
      const mx = (x1 + x2) / 2 + wob(key, 3.7);
      const my = (y1 + y2) / 2 + wob(key, 11.9);
      return `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} `
           + `${x2.toFixed(1)} ${y2.toFixed(1)}`;
    };
    let fill = "", line = "";
    const at = (r: number, c: number) =>
      (r < 0 || c < 0 || r >= rows || c >= cols) ? -1 : terr.idx[r * cols + c];
    for (let r = 0; r < rows; r += 1) {
      let run = -1;
      for (let c = 0; c <= cols; c += 1) {
        const on = c < cols && terr.idx[r * cols + c] === k;
        if (on && run < 0) run = c;
        if (!on && run >= 0) {
          fill += `M${gx(run).toFixed(1)} ${gy(r).toFixed(1)}`
                + `H${gx(c).toFixed(1)}V${gy(r + 1).toFixed(1)}`
                + `H${gx(run).toFixed(1)}Z`;
          run = -1;
        }
        if (!on || c >= cols) continue;
        // 四邻里不属于本郡的那一侧才是外边
        const i = r * cols + c;
        if (at(r, c - 1) !== k) line += seg(gx(c), gy(r), gx(c), gy(r + 1), i - 1);
        if (at(r, c + 1) !== k) line += seg(gx(c + 1), gy(r), gx(c + 1), gy(r + 1), i);
        if (at(r - 1, c) !== k) line += seg(gx(c), gy(r), gx(c + 1), gy(r), i - cols + 0.5);
        if (at(r + 1, c) !== k) line += seg(gx(c), gy(r + 1), gx(c + 1), gy(r + 1), i + 0.5);
      }
    }
    return { fill, line };
  }, [terr, pinned, focus]);

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
  /**
   * 三档，各答一个问题。此前三档答的是同一个问题，只是画得大小不同——
   * 于是「整幅可见」那一屏在假装自己是棋盘：它画了 105 枚城印、军团、
   * 围城圈，而那个倍数上**只有 45% 的相邻城对摆得下一枚棋子**
   *（232 条边里 127 条摆不下，最近的阳乐—昌辽只隔 7.4 px）。
   *
   *   0　势力图（k < 2）　　答「天下大势」：疆域色块、州名、势力名、军团小点。
   *                        不画城印、不画路、不画围城——那个倍数上它们只是噪点
   *   1　棋盘　（2 ≤ k < 6）答「这一仗怎么打」：城、路、路上的关津据点、
   *                        走在路上的部队、看得懂的围城。**进对局默认落在这一档**
   *   2　细部　（k ≥ 6）　 答「这座城什么底子」：建筑、物产、阵型
   *
   * 4 倍这个点不是拍脑袋：那时 97% 的相邻城对摆得下部队，一屏 440 km
   * 恰好一个州，而屏上 221 px/度仍在 DEM 源数据的 364 px/度之内——
   * 三条约束在同一个倍数上对齐。
   */
  const lod = view.k >= 6 ? 2 : view.k >= 2 ? 1 : 0;

  // ── 水：线在任意倍数下重画 ───────────────────────────────────────
  //
  // 瓦片金字塔总有个头：z4 是 14520，Retina 屏放到十四倍仍要拉伸 2.3 倍。
  // 再切一级要 700MB 的源图与两千八百块瓦片，而下一次还要再翻一倍——
  // 拿像素追分辨率是追不完的。
  //
  // 但**糊起来最扎眼的是线**（河岸、海岸这种一笔下去的边），而线本来就不必是
  // 像素：水系是矢量数据，4473 个点、90KB，在这儿按当前倍数重画一遍就永远是实的。
  // 底图那份仍在下面垫着——两份出自同一份数据、同一套投影，叠在一起是同一条河。
  //
  // 河宽照抄底图那条水力几何式（w ∝ Q^0.5，下游渐阔），两份才对得齐：
  // 见 tools/render-terrain-map.mjs 的「水系」一节
  const water = useMemo(() => {
    if (!engine || lod < 2) return null;
    const RIVER_W: Record<string, number> = {
    黄河: 1.0, 长江: 1.0, 淮水: 0.62, 汉水: 0.62, 渭水: 0.55, 济水: 0.5,
    "珠江（西江）": 0.62, 辽水: 0.42, 湘水: 0.45, 赣水: 0.45, 泗水: 0.42,
  };
    const toPath = (pts: Array<[number, number]>) => {
    let d = "";
    for (let i = 0; i < pts.length; i += 1) {
      const x = (pts[i][0] - MAP.west) * MAP.ppd, y = (MAP.north - pts[i][1]) * MAP.ppd;
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  };
    // 近观才画：整幅可见时底图那份已经够，两份叠着只会把河描粗
    return {
      coast: engine.water.coastline.filter((s2) => s2.length > 1).map(toPath),
    // 一条河拆成若干段，每段照它在全程的位置取宽——一笔到底画不出下游渐阔
    rivers: engine.water.rivers.flatMap((r) => {
      const w0 = RIVER_W[r.name] ?? 0.34;
      const n = r.points.length;
      const STEP = 6;
      const out: Array<{ d: string; w: number }> = [];
      for (let i = 0; i + 1 < n; i += STEP) {
        const seg = r.points.slice(i, Math.min(n, i + STEP + 1));
        if (seg.length < 2) continue;
        const u = (i + seg.length / 2) / n;
        // 底图那边是**半宽** half = w0 · PPD · 0.03 · (0.35 + u^0.8 · 1.6)，
        // PPD = 55，故全宽 = w0 · 3.3 · (…)。第一版把它当半宽又乘了 1.7/2.1，
        // 渭水画出来是一条四十像素宽的青带
        out.push({ d: toPath(seg), w: w0 * 3.3 * (0.35 + u ** 0.8 * 1.6) });
      }
      return out;
    }),
    };
    // 只认 engine 与档位：此前它在渲染体里，每次重绘都要把 4473 个点重拼一遍，
    // 实测缩放时九分位帧 116ms、最慢 129ms——一步一顿
  }, [engine, lod]);

  // 几何与悬停无关，单独算一次。此前整个 roads 挂在 focus 上，
  // 于是每悬停一次就把 232 条边连同它们的 JSX 全重建一遍
  /**
   * 道路。**从关上穿过去，而不是城心直连**。
   *
   * 此前每条边画成一条直线，而关津画在它们各自的真实坐标上——于是关不在
   * 路上。汉中往蜀地那一带最明显：阳平、白水、葭萌、剑门四关悬在直线旁边，
   * 看图的人有理由问「这几个关卡在这起什么作用」。关的意义是扼守必经之路，
   * 而它没长在路上，就什么也扼不住。
   *
   * 数据本来就够：每条边的 nodes 记着它经过哪些关（引擎判地形加成也用这份），
   * 而每个关在 nodes 表里有真实经纬度。这里把两者接上——按在 a→b 上的投影
   * 排序，串成折线。于是「自汉中征广汉属国要过阳平关、白水关」这件事，
   * 图上看得见，而且与引擎判的是同一件事。
   */
  const roadGeom = useMemo(() => (engine ? engine.edges.map((e, i) => {
    const p = (id: string) => {
      const q = engine.points.find((c) => c.id === id);
      return q ? { x: (q.longitude - MAP.west) * MAP.ppd, y: (MAP.north - q.latitude) * MAP.ppd } : null;
    };
    const a = p(e.from), b = p(e.to);
    if (!a || !b) return null;
    // 有实走路径就用它——那是在高程栅格上按最小代价算出来的，会自己找河谷。
    // 没有（数据缺失、或这条边新加而路由没重跑）就退回下面那套「串关的折线」
    const baked = engine.roads.get(`${e.from}\u0000${e.to}`)
      ?? engine.roads.get(`${e.to}\u0000${e.from}`);
    if (baked && baked.length >= 2) {
      const pts = baked.map(([lo, la]) => ({ x: (lo - MAP.west) * MAP.ppd,
                                             y: (MAP.north - la) * MAP.ppd }));
      // 折线走成圆角：每段取中点，拐点作控制点。原始折线是格点序列，
      // 直接连会有一格一格的棱角
      let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let k = 1; k < pts.length - 1; k += 1) {
        const cur = pts[k], nxt = pts[k + 1];
        d += `Q${cur.x.toFixed(1)} ${cur.y.toFixed(1)} `
           + `${((cur.x + nxt.x) / 2).toFixed(1)} ${((cur.y + nxt.y) / 2).toFixed(1)}`;
      }
      const last = pts[pts.length - 1];
      d += `L${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
      return { key: `${e.from}-${e.to}-${i}`, a, b, d, via: (e.nodes ?? []).length,
               st: EDGE_STYLE[e.terrain] ?? EDGE_STYLE.plain, e,
               days: Math.round(e.cost * engine.P.marchDayPerCost) };
    }
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    // 边上的关，按在 a→b 上的投影排序。投影落在两端之外的不串进来——
    // 同一个关可能挂在好几条边上（阳平关就挂着两条），拿它当另一条路的
    // 拐点会把路拉出图外
    const via = (e.nodes ?? [])
      .map((nd: { id: string }) => engine.nodes.find((x) => x.id === nd.id))
      .filter((n): n is MapNode => !!n)
      .map((n) => {
        const x = (n.longitude - MAP.west) * MAP.ppd, y = (MAP.north - n.latitude) * MAP.ppd;
        return { x, y, t: ((x - a.x) * dx + (y - a.y) * dy) / len2 };
      })
      .filter((v) => v.t > 0.04 && v.t < 0.96)
      .sort((u, v) => u.t - v.t);
    // 折线走成圆角：拐点处用二次贝塞尔过渡，免得关口出现硬折角。
    // 没有关的边照旧是一条直线
    const pts = [a, ...via, b];
    let d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}`;
    if (pts.length === 2) d += `L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    else {
      for (let k = 1; k < pts.length - 1; k += 1) {
        const cur = pts[k], nxt = pts[k + 1];
        const mx = (cur.x + nxt.x) / 2, my = (cur.y + nxt.y) / 2;
        d += `Q${cur.x.toFixed(1)} ${cur.y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
      }
      d += `L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    return { key: `${e.from}-${e.to}-${i}`, a, b, d, via: via.length,
             st: EDGE_STYLE[e.terrain] ?? EDGE_STYLE.plain, e,
             // 行军天数：cost × 每 cost 多少日。这个数就是候选标签里那句「道远」的来源
             days: Math.round(e.cost * engine.P.marchDayPerCost) };
  }).filter((r): r is NonNullable<typeof r> => r !== null) : []), [engine]);

  /**
   * 不随悬停变的三层，缓存成现成的 JSX。
   *
   * 它们与「指着谁」毫无关系：focus 一变就把水系 671×2 条、道路 232 条、
   * 关津 61 处、疆界 2 条全部重新建元素再交给 React diff，纯属白干。
   *
   * （当初动手是因为量到「悬停一座城要 1797ms 才出帧」，那个数是假的——
   *   自动化浏览器把 rAF 限到了 1Hz。缓存本身仍然该做，只是它省的不是 1.8 秒）
   */
  const waterEls = useMemo(() => (water && (
    <g className="water">
      {water.coast.map((d, i) => <path key={`c${i}`} className="coast" d={d} />)}
      {water.rivers.map((r, i) => (
        <g key={`r${i}`}>
          <path className="river-ink" d={r.d} strokeWidth={r.w} />
          <path className="river-fill" d={r.d} strokeWidth={r.w * 0.5} />
        </g>
      ))}
    </g>
  )), [water]);

  /**
   * 常驻只画**与你有关**的路。
   *
   * 232 条路全铺出来，而任何一季你只关心其中六到十条——于是每条路都在跟别的
   * 路抢注意力，谁也读不出来。这不是「用线条代替道路」的毛病（真实地图上路
   * 本来就是线），是把整张公路网当底纹铺了。
   *
   * 「与你有关」= 自家郡国接出去的边。指到某郡时它那几条另有 hot 层提亮，
   * 不在这里管。想看全网的按图例里那个开关。
   */
  const roadShown = useMemo(() => {
    // **这一段跑在 game 的空值守卫之前**（hooks 不能写在早退之后）。
    // 这个组件里同类的顺序坑已经栽过四次了，每次都是 500——所以这里显式判空
    if (allRoads || !game || !seat) return roadGeom;
    const mine = new Set(Object.values(game.commanderies)
      .filter((c) => c.owner === seat).map((c) => c.id));
    // 己方之路，**外加一圈邻居之间的路**。
    //
    // 原先只留「至少一头是自己的」那些，七个郡只剩三十条，图上大片空白，
    // 而关津就坐在那些没画出来的路上——于是它们看着像浮在荒地里的孤点。
    // 「黎阳仓没被线连通到」正是这么来的：它离最近的路只有 0.7 km，
    // 只是那条路没画。
    //
    // 棋盘这一档要答「这一仗怎么打」，那就得看见敌人从哪条路来——
    // 邻郡之间的横向连接同样是答案的一部分。
    const near = new Set(mine);
    for (const r of roadGeom) {
      if (mine.has(r.e.from)) near.add(r.e.to);
      if (mine.has(r.e.to)) near.add(r.e.from);
    }
    return roadGeom.filter((r) => near.has(r.e.from) && near.has(r.e.to));
  }, [roadGeom, allRoads, game, seat]);

  const roadEls = useMemo(() => (lod === 0 ? null : (
    <g className="roads">
      {/* 衬边先铺一层：所有路的淡色宽笔画完，再画本色窄笔。
          分两遍是因为若逐条「衬边+本色」地画，后一条的衬边会盖住前一条的路面 */}
      {roadShown.map((r) => (
        <path key={`c-${r.key}`} className={`road-casing lod${lod}`} d={r.d}
          strokeWidth={(r.st.width + 2.2) / view.k ** 0.82} />
      ))}
      {roadShown.map((r) => (
        <path key={r.key} className={`road lod${lod}`} d={r.d} fill="none"
          stroke={r.st.stroke} strokeDasharray={r.st.dash}
          strokeWidth={r.st.width / view.k ** 0.82} />
      ))}
    </g>
  )), [roadShown, lod, view.k]);

  // ── 关津港仓：非郡治的战略据点 ────────────────────────────────────
  // 关隘 22、港口 12、渡口 9、谷道 7、古战场 7、粮仓 4。整幅可见时只画关与港
  // （它们是「路通不通」的答案），放大后铺开其余——否则六十一个印记压在墨底上
  // 就是一层噪点
  // 关津港仓在**棋盘档就要出全**：它们是路上的据点，是「这一仗怎么打」的一部分，
  // 不是放大后才看的细部。势力图那一档一个都不出
  //
  // **只画活着的据点。** 判准是用户定的那一条：凡是画上去的，都得能被占、
  // 被打、被守，或者能解释前三者。
  //
  //   不在任何一条路上的（阳关、徐闻、侯官、敖仓、郿坞）——走不到，等于不存在
  //   古战场七个——扼守价值实测全是 0，堵死也没人绕路；12 局 5493 场野战
  //     没有一场发生在它们旁边。它们是「这里打过一仗」，不是「这里能打一仗」。
  //     数据留着（史料是好的），图上不画
  const nodeMarks = useMemo(() => (lod === 0 || !engine ? [] : engine.nodes)
    .filter((n) => n.kind !== "battlefield" && engine?.G.sites.has(n.id))
    .map((n) => ({
      n, x: (n.longitude - MAP.west) * MAP.ppd, y: (MAP.north - n.latitude) * MAP.ppd,
      r: 12 / view.k ** 0.82,
    })), [engine, lod, view.k]);

  /** 这个据点此刻在谁手里。图上、悬停详情、候选标签三处共用 */
  const holdOwner = useCallback(
    (id: string) => game?.holds?.[id]?.owner ?? null, [game]);

  const nodeEls = useMemo(() => (
    <g className="nodes">
      {nodeMarks.map((m) => (
        <g key={m.n.id}
          onMouseEnter={() => setNodeTip(m.n)} onMouseLeave={() => setNodeTip(null)}>
          {/* 透明命中圆：图元本身只有十来像素，低于可点区域的最低尺寸。
              必须带 mark 类——整张 svg 是 pointer-events:none（不然它会
              吞掉拖动），只有 .mark 重新打开。少这个类，上面那两个
              onMouseEnter 就是永远不触发的死代码，关津的悬停详情根本出不来 */}
          <circle className="mark" cx={m.x} cy={m.y} r={m.r * 1.2} fill="transparent" />
          <NodeMark x={m.x} y={m.y} r={m.r} kind={m.n.kind} id={m.n.id} />
          {/* 归属环：据点有主之后，「这个关在谁手里」是图上第一等的信息——
              它决定从这条路打过去守方还有没有关隘之利 */}
          {holdOwner(m.n.id) && (
            <circle className="hold-ring" cx={m.x} cy={m.y} r={m.r * 1.15}
              stroke={engine?.colorOf.get(holdOwner(m.n.id)!) ?? "#7a7266"}
              strokeWidth={m.r * 0.28} fill="none" />
          )}
          {/* 名字不在这儿画：它要跟郡名、路题记共用同一张避让表，
              而那张表要等城印的位置定了才建得起来。见 nodeLabels */}
        </g>
      ))}
    </g>
  ), [nodeMarks, holdOwner, engine?.colorOf]);

  const borderEls = useMemo(() => (
    <>
      {/* 郡国界画在最底下、最细最淡：它是底纹，不是主角。
          远观档（整幅可见）不画——一百零五圈轮廓铺满全图就是一层噪点，
          而那一档要答的是「天下大势」，不是「泰山郡管到哪」 */}
      {/* 指到某郡时它的辖境整块点亮。画在界线之下、疆域之上 */}
      {lod >= 1 && focusArea.fill && (
        <>
          <path className="jun-area" d={focusArea.fill} />
          <path className="jun-area-line" d={focusArea.line}
            strokeWidth={1.6 / [1, 2.4, 8][lod] ** 0.82} />
        </>
      )}
      {lod >= 1 && (
        // 虚线的间隔也要按档位缩：dasharray 走的是用户单位，而这一层挂着
        // 缩放变换——不缩的话放大六倍后虚线变成「12 像素实、30 像素虚」，
        // 稀到看不见。除以同一个系数，屏幕上的虚线长度才恒定
        <path className="border jun" d={junBorders}
          strokeWidth={0.9 / [1, 2.4, 8][lod] ** 0.82}
          strokeDasharray={`${2.2 / [1, 2.4, 8][lod] ** 0.82} `
            + `${3.4 / [1, 2.4, 8][lod] ** 0.82}`} />
      )}
      <path className="border other" d={borders.other}
        strokeWidth={1.2 / [1, 2.4, 8][lod] ** 0.82} />
      <path className="border mine" d={borders.mine}
        strokeWidth={2.4 / [1, 2.4, 8][lod] ** 0.82} />
    </>
  ), [borders, junBorders, focusArea, lod]);

  if (error) return <main className="play"><p className="play-error">载入失败：{error}</p></main>;
  if (!engine || !terr) return <main className="play"><p className="play-note">正在备沙盘…</p></main>;

  // ── 选席 ────────────────────────────────────────────────────────
  if (!game || !seat) {
    const probe = createGame(engine.data, { seed: "preview", roster: engine.roster,
      geo: engine.geo, graph: engine.G }, engine.P);
    const seats = Object.values(probe.factions)
      .filter((f) => !f.eliminated)
      .map((f) => ({ f, n: f.startCommanderies, st: standingOf(probe, engine.geo, f.id) }))
      .sort((a, b) => b.n - a.n);
    return (
      <main className="play">
        <header className="play-head">
          <h1>汉末沙盘</h1>
          <p>兴平元年·一九四{"\u3000"}择一席入局。
            <b>谁先一统天下谁赢</b>。控制 {engine.P.unifyZhou} 州，或成为最后一个有效势力，即可统一。
            对局没有季数上限，可随时暂停、存档后继续。</p>
        </header>
        <details className="primer-fold">
          <summary>怎么玩<i>没玩过先看这个</i></summary>
          <Primer P={engine.P} />
        </details>

        <details className="primer-fold model-fold">
          <summary>这一局打多久<i>直到统一</i></summary>
          <div className="model-setup">
            <p>天下尚未统一，对局就继续。你可以暂停观战、保存进度，下次接着玩。</p>
            <p>AI 模型达到调用额度时会暂停；增加额度或切换机器人后可以继续，不会按季数判定胜负。</p>
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
                <b>{resume.game.finished ? "查看上局结果" : "继续上次对局"}</b>
                <span>{resume.session.human === null ? "观战 · " : ""}{engine.nameOf.get(resume.seat) ?? resume.seat}
                  {"\u3000"}第 {resume.game.finished ? resume.game.turn : resume.game.turn + 1} 季
                  {"\u3000"}{owned} 郡（开局 {f?.startCommanderies ?? "?"}）
                  {"\u3000"}{GRADE_CN[f?.bestGrade ?? "ding"]} 档</span>
              </div>
              <button onClick={() => {
                setSeat(resume.seat); setGame(resume.game); setPicked(resume.picked);
                setFlash({ mine: [], world: [], delta: {}, battles: [] }); setFlips([]);
                // since 决定模型看到的战报从哪一条起。读档不重置它会从 0 起算，
                // 于是模型收到整局的日志——观测直接撑爆 token 预算
                setSession(resume.session); setThinking({}); setAutoPlay(false); setTurnError(null);
                const cap = resume.game.factions[resume.seat]?.capital;
                const p = cap ? engine.points.find((c) => c.id === cap) : null;
                setSmooth(true);
                setView(p ? centerOn(p.longitude, p.latitude, Math.max(4, minK), MAP) : fitAll(minK));
                setResume(null);
              }}>继续</button>
              <button className="ghost" onClick={() => { clearSave(); setResume(null); }}>
                弃掉，重开
              </button>
            </div>
          );
        })()}
        <MatchSetup session={session} onChange={setSession}
          seats={seats.map(({ f, n }) => ({ id: f.id, name: engine.nameOf.get(f.id) ?? f.id, lands: n }))}
          models={models} onLoadModels={loadModels} error={modelErr}
          onStart={start} />
        <WashDefs />
        <h2 className="seat-heading">势力背景 · 点击选择你要执掌的一方</h2>
        <ul className="seat-grid">
          {seats.map(({ f, n, st }) => (
            <li key={f.id}>
              <button onClick={() => {
                const modelOf = { ...session.modelOf }; delete modelOf[f.id];
                setSession({ ...session, human: f.id, modelOf });
              }} aria-pressed={session.human === f.id} style={{ "--c": engine.colorOf.get(f.id) } as React.CSSProperties}>
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
  const step = nextGrade(standing.controlledZhou - me.startZhou,
                         standing.zhouSeats - me.startSeats);
  const nextStep = step.grade
    ? (step.score < GRADE_CUTS.yi
        && !(standing.commanderies > me.startCommanderies && standing.conquests > 0)
        ? "郡数高于开局且至少一郡夺自他方 → 丙"
        : `再多控 ${step.needZhou} 州，或多据 ${step.needSeat} 个州治 → ${GRADE_CN[step.grade]}`)
    : `已达超档；再往上判绝对疆域（控 ${ABS_CUTS.ba} 州为霸）`;

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

  // ── 城印避让 ────────────────────────────────────────────────────
  //
  // 缩放律改对之后，放大能把城分开了；缩小时仍分不开——那不是缩放律的问题，
  // 是地上本来就挤：京兆尹与左冯翊隔 16 像素、辽西与辽东属国隔 8，
  // 而整幅可见时城印有 48–83 像素宽，画多少层都必然叠。
  //
  // 按牌记那套办法办：重要的先放（己方 → 州治 → 大城），叠上去的这一季
  // 让位——但**不是不画**，让位者留一枚小点，「这儿有个郡」与点击区都还在。
  // 放大到彼此不再相碰，它们自己就回来了
  const placedMarks: Array<[number, number, number]> = [];
  const ranked = [...marks].sort((a, b) =>
    Number(focus === b.c.id) - Number(focus === a.c.id)
    || Number(pinned === b.c.id) - Number(pinned === a.c.id)
    || Number(b.mine) - Number(a.mine)
    || Number(b.isSeat) - Number(a.isSeat)
    || b.base - a.base || cmp(a.c.id, b.c.id));
  const hidden = new Set<string>();
  for (const m of ranked) {
    const r = m.base * 1.05;                       // 城印半径（含笔锋外溢）
    if (placedMarks.some(([px, py, pr]) => Math.hypot(px - m.x, py - m.y) < (pr + r) * 0.62)) {
      hidden.add(m.c.id);
      continue;
    }
    placedMarks.push([m.x, m.y, r]);
  }

  // 州名题记：舆图必有的一层。缩得越小越该看见大区划，放大后让位给郡治
  const zhouMarks = [...engine.geo.zhouMembers].map(([z, ids]) => {
    const pts = engine.points.filter((p) => ids.includes(p.id));
    if (!pts.length) return null;
    const lon = pts.reduce((n, p) => n + p.longitude, 0) / pts.length;
    const lat = pts.reduce((n, p) => n + p.latitude, 0) / pts.length;
    return { z, x: (lon - MAP.west) * MAP.ppd, y: (MAP.north - lat) * MAP.ppd };
  }).filter((m): m is NonNullable<typeof m> => m !== null);

  // 避让表先把**城印本身**占上：此前只放牌记，于是路的题记会压在城墙上
  // （实测悬停京兆尹时「关道·潼关 41 日」正压在城楼上）。
  // 城印是画面上最实的一块，谁都不该压它
  const placed: Box[] = marks
    .filter((m) => lod === 0 || !hidden.has(m.c.id))
    .map((m) => {
      // 势力图那一档画的是一枚小点（半径 0.2×base），就只该占一枚小点。
      // 此前不分档位一律按整枚城印占位，于是那一档的避让表里躺着 105 个
      // **画都没画的**城印——势力名被它们挡得只剩 8 个，而且全是边疆大郡
      if (lod === 0) {
        const r = m.base * 0.2;
        return [m.x - r, m.y - r, r * 2, r * 2] as Box;
      }
      const w = m.base * 2.3;
      return [m.x - w / 2, m.y - w * GLYPH_BASE, w, w] as Box;
    });
  const labels = [...marks]
    // 先放最该看见的：当前指向者 → 己方 → 州治 → 大城
    .sort((a, b) => Number(focus === b.c.id) - Number(focus === a.c.id)
      || Number(b.mine) - Number(a.mine)
      || Number(b.isSeat) - Number(a.isSeat) || b.base - a.base)
    // 放大后铺开全部郡名：整幅可见时只标己方与州治是为了不叠字，
    // 放大之后地方够了，还藏着就是白放大
    .filter((m) => !hidden.has(m.c.id) || focus === m.c.id)
    // 势力图那一档一个城名都不出：那一屏答的是「谁大谁小」，
    // 城名是棋盘档的事。指到的那个仍然要出——指哪儿就得答哪儿
    .filter((m) => lod >= 1 || focus === m.c.id)
    .filter((m) => view.k >= 2.2 || m.mine || m.isSeat || focus === m.c.id)
    .map((m) => {
      // 牌记比图元收得更狠一点：字在屏上只需**够读**，不需要跟着放大。
      // 1/k^0.88 意味着屏上按 k^0.12 长——十四倍下也只大三成半
      const size = (m.isSeat ? 25 : 21) / view.k ** 0.88;
      // 牌记写的是**城**的名字——邺、邯郸、濮阳，不是它所在的郡。
      // 这枚城印画的就是那座城；郡名另写在辖境里（见 junBand）
      const nm = m.c.seat || m.c.name;
      const w = textWidth(nm, size) + size * 0.1, h = size * 1.3;
      // 城下有建筑时牌记往下让一档，否则字压在屋顶上
      const nBuild = lod >= 2 && m.mine ? m.st.buildings.length : 0;
      const nRes = lod >= 2
        ? m.st.resources.filter((r) => RES_BUILD[r]
            && !m.st.buildings.includes(RES_BUILD[r] as never)).length : 0;
      // 城下每多一行（建筑、物产虚影），牌记就再往下让一档
      const rows = (nBuild ? 1 : 0) + (nRes ? 1 : 0);
      const x = m.x - w / 2;
      const y = m.y + m.base * (0.62 + rows * 0.5) + 4 / view.k ** 0.88;
      const box: Box = [x, y, w, h];
      if (!fitLabel(placed, [box]) && focus !== m.c.id) return null;
      return { id: m.c.id, name: nm, x: m.x, y: y + size, size, w: w + 8 / view.k ** 0.88,
               hot: focus === m.c.id };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  // ── 关津的名字也进同一张避让表 ───────────────────────────────────
  //
  // 此前它们完全不参与避让，各自在自己的图元正下方硬画。实测同一屏上
  // 十四对标签互相压着，**全是关津**：白马津/黎阳津、延津/棘津、
  // 孟津/小平津、剑门关/葭萌关、赤壁/乌林，以及关津压郡名
  // （虎牢关压河内郡、敖仓压河内郡、伊阙关与轘辕关一起压河南尹）。
  //
  // 成对出现不是巧合：黄河四津彼此不过数十里，本来就该挨着——
  // 地理没错，错的是一律画在正下方，那两个名字必然重合。
  //
  // 排在牌记之后、路题记之前：郡名比关名重要，关名比「丘陵 3 日」重要。
  // 先把关津的**图元**占进表里，免得名字落到别的关的图上
  for (const m of nodeMarks) {
    placed.push([m.x - m.r, m.y - m.r, m.r * 2, m.r * 2]);
  }
  const nodeLabels = (lod < 1 ? [] : nodeMarks).map((m) => {
    const size = m.r * 0.9;
    // 估宽再加一丝余量：字面外还有 3px 的纸色描边，而且实际字距比 1em 略宽——
    // 实测「剑门关／葭萌关」按净字宽算恰好错开 0.7 单位，画出来仍蹭在一起
    const w = textWidth(m.n.name, size) + size * 0.3, h = size * 1.45;
    // 撞上了换一档：下、上、右、左。四档都撞就不发这一条——
    // 挤到无处可放时，少一个名字远好过多一团糊字。放大后地方够了它们自己就回来
    const slots: Array<[number, number]> = [
      [0, m.r * 1.9], [0, -m.r * 1.5], [m.r * 1.7, m.r * 0.4], [-m.r * 1.7, m.r * 0.4],
    ];
    for (const [dx, dy] of slots) {
      const box: Box = [m.x + dx - w / 2, m.y + dy - h * 0.8, w, h];
      if (!fitLabel(placed, [box])) continue;
      return { id: m.n.id, name: m.n.name, x: m.x + dx, y: m.y + dy, size };
    }
    return null;
  }).filter((l): l is NonNullable<typeof l> => l !== null);

  // ── 郡名：写进辖境的阴影里 ──────────────────────────────────────
  //
  // 字号由那条最宽行的宽度定：写不下就不写。所以整幅可见时只有南阳、
  // 汝南这样的大郡有名，放大之后小郡自己长出来——与牌记、关津同一套 LOD。
  //
  // 指到／钉住的那个郡例外：它的辖境正整块亮着，名字必须跟上，
  // 不然「我指的这一片是谁」还是答不出来。
  const bandOf = junBand;                       // 收进局部常量，闭包里 TS 才收得住
  const junNames = (lod < 1 || !bandOf ? [] : marks).map((m) => {
    const bands = bandOf?.get(m.c.id);
    if (!bands?.length) return null;
    const hot = focus === m.c.id || pinned === m.c.id;
    // 字号由**最宽**那条行定（占它七成），三条落点共用同一个字号：
    // 换落点是为了躲开城印，不是为了把字写小
    const fit = (bands[0].w * 0.7) / Math.max(1, m.c.name.length);
    const size = Math.min(fit, 34 / view.k ** 0.88);
    // 小于这个就读不出来了，不如不写
    if (!hot && size < 13 / view.k ** 0.88) return null;
    const w = textWidth(m.c.name, size), h = size * 1.3;
    const slots: Box[] = bands.map((b) => [b.x - w / 2, b.y - h * 0.7, w, h]);
    const got = fitLabel(placed, slots);
    if (!got && !hot) return null;
    const b = got ? bands[slots.findIndex((x) => x === got)] : bands[0];
    return { id: m.c.id, name: m.c.name, x: b.x, y: b.y + size * 0.32, size, hot };
  }).filter((l): l is NonNullable<typeof l> => l !== null);

  // 势力名：只在势力图那一档写。棋盘档有城印与郡名答归属，再写一层就是叠字
  const factionNames = (lod !== 0 || !factionBand ? [] : [...factionBand])
    // 自己永远先放，其余按版图大小——挤的时候该让位的是小势力。
    // 「我在哪」是这一屏最不能答不出来的问题
    .sort((a, b) => Number(b[0] === seat) - Number(a[0] === seat)
      || (b[1][0]?.w ?? 0) - (a[1][0]?.w ?? 0))
    .map(([f, bands]) => {
      if (!bands.length) return null;
      const nm = engine.nameOf.get(f) ?? f;
      // 势力名可以很长（「吕布（张邈、陈宫）」），题记只取姓名那一段
      const short = nm.split("（")[0];
      const fit = (bands[0].w * 0.78) / Math.max(1, short.length);
      const size = Math.min(fit, 46 / view.k ** 0.88);
      if (size < 11 / view.k ** 0.88) return null;
      const w = textWidth(short, size), h = size * 1.3;
      const slots: Box[] = bands.map((b) => [b.x - w / 2, b.y - h * 0.7, w, h]);
      const got = fitLabel(placed, slots);
      if (!got && f !== seat) return null;
      const b = got ? bands[slots.findIndex((x) => x === got)] : bands[0];
      return { f, name: short, x: b.x, y: b.y + size * 0.32, size, mine: f === seat };
    }).filter((l): l is NonNullable<typeof l> => l !== null);

  // 州名当**背景水印**：大、极淡、不参与避让，画在所有东西之下。
  //
  // 试过让它进避让表，两个方向都不对：州名先占位则自家的名字被压在自家
  // 所据之州上（吕布压「兖州」、严白虎压「徐州」）；势力名先占位则十三个州
  // 只剩三个写得出——而州是计分单位，「多控一整州入甲」，它不能没有。
  //
  // 两者本来就不该抢：一个是大字淡墨的地界题记，一个是实墨的人名。
  // 舆图上这两层历来就是叠着的，叠得对就读得开。
  const zhouShown = (lod !== 0 ? [] : zhouMarks).map((m) => (
    { z: m.z, x: m.x, y: m.y, size: 58 / view.k ** 0.82 }));

  /** 郡 → 图上坐标。道路、箭头、军团都要它 */
  const xy = (id: string) => {
    const p = engine.points.find((c) => c.id === id);
    return p ? { x: (p.longitude - MAP.west) * MAP.ppd, y: (MAP.north - p.latitude) * MAP.ppd }
             : null;
  };

  // ── 道路层：边的地形 ─────────────────────────────────────────────
  //
  // 引擎按边的 cost 算行军天数（日三十里），可图上此前一条路都没有：
  // 「自南阳征河南尹要走一季」这件事，看图的人无从验证，也看不出难在哪。
  // 232 条边全铺出来会盖住墨底，所以常态极淡，指到某郡时它那几条才提亮
  const hub = pinned ?? focus;
  const roads = roadGeom.map((r) => {
    const hot = hub === r.e.from || hub === r.e.to;
    const near = hub === r.e.from ? r.a : r.b, far = hub === r.e.from ? r.b : r.a;
    return { ...r, hot, near, far };
  });

  // ── 路的题记也要避让 ─────────────────────────────────────────────
  //
  // 它此前按「边长的六成」摆：放大十四倍后那个点早跑到屏外，或正好压在别人的
  // 名字上。实测钉住京兆尹时五条题记有四条与牌记或围城营垒的字相压
  // （「关道·武关 80 日」压在「京兆尹」上、「丘陵 3 日」压在「左冯翊」上）。
  //
  // 改成：从所指之郡往外量一段**屏幕距离**，撞上了就再往外挪一档，
  // 三档都撞就不发这一条——与牌记同一套办法，且它们共用同一张已占位表
  const roadTips = roads.filter((r) => r.hot).map((r) => {
    const size = 19 / view.k ** 0.88;
    const text = `${EDGE_CN[r.e.terrain] ?? r.e.terrain}`
      + `${r.e.nodes.length ? `·${r.e.nodes[0].name}` : ""} ${r.days} 日`;
    // 宽度按字宽分别估：中日韩字宽约 1em，数字与空格约 0.55em。
    // 一刀切 0.62 会低估中文串的宽度，避让就漏判——实测「关道·潼关 41 日」
    // 因此仍压在左冯翊的城印上
    const w = textWidth(text, size);
    const h = size * 1.2;
    const seg = Math.hypot(r.far.x - r.near.x, r.far.y - r.near.y) || 1;
    // 从**城印外沿**往外量，不用固定像素：城印宽 2.3×base，而 base 随倍数缩，
    // 固定像素在十四倍下第一档就落在自己城墙里（实测五条题记一条都发不出来）
    const hubW = (marks.find((m) => m.c.id === hub)?.base ?? 24) * 2.3;
    for (const out of [hubW * 1.4, hubW * 2.2, hubW * 3.2]) {
      const t = Math.min(0.62, out / seg);
      const x = r.near.x + (r.far.x - r.near.x) * t;
      const y = r.near.y + (r.far.y - r.near.y) * t;
      const box: Box = [x - w / 2, y - h / 2, w, h];
      if (!fitLabel(placed, [box])) continue;
      return { key: r.key, x, y, size, text };
    }
    return null;
  }).filter((t): t is NonNullable<typeof t> => t !== null);

  // 出兵箭头：已勾选的用实线，正指向的用虚线。
  // 「自南阳郡征河南尹」——不熟地理的人根本不知道这两个郡在哪，
  // 候选表与地图此前完全没有联动，读到的只是两个地名
  const arrows = [...new Set([...picked, hoverKey].filter((k): k is string => !!k))]
    .map((k) => {
      const c = candidates.find((x) => x.key === k);
      if (!c || c.action.type !== "campaign") return null;
      // 收进一个局部常量再用：动作联合里加了 seize（也带 from）之后，
      // 在闭包里反复写 c.action.from 会让 TS 的收窄失效——报的是
      // 「govern 上没有 from」，看着像别处的错
      const act = c.action;
      const a = xy(act.from), b = xy(act.target);
      if (!a || !b) return null;
      // 预览也要走真正的路。军团已经沿路走了，而「出兵之前看它会走哪条」
      // 还是一条直线——那正是最该看清路线的时候：它要过哪些关、绕多远
      const r = roadGeom.find((x) =>
        (x.e.from === act.from && x.e.to === act.target)
        || (x.e.to === act.from && x.e.from === act.target));
      return { key: k, a, b, d: r?.d ?? null, on: picked.includes(k),
               sortie: act.from === act.target };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  // ── 军团：在途的也要画 ───────────────────────────────────────────
  //
  // 此前只有围城的军团画了旗，在途的一支都没有：出征之后它在图上**隐身**几季，
  // 然后凭空出现在城下。而行军耗时正是围城那只钟的另一半——援军赶不赶得到，
  // 看的就是它现在走到哪了。位置按 marchLeft 在起兵郡与目标之间插值
  /**
   * 沿实走路径取 f 处的点，并顺带给出该处的走向。
   *
   * 军团此前是在两城之间做**直线插值**——路已经会拐了，兵还在走直线，
   * 于是「在途的那支兵」常常悬在山脊上。改成按弧长沿折线走：
   * f=0.5 是真的走了一半路程，不是「在两城连线的中点」。
   */
  const alongRoad = (fromId: string, toId: string, f: number) => {
    const pts = engine.roads.get(`${fromId}\u0000${toId}`)
      ?? engine.roads.get(`${toId}\u0000${fromId}`)?.slice().reverse();
    const A = xy(fromId), B = xy(toId);
    if (!pts || pts.length < 2 || !A || !B) {
      if (!A || !B) return null;
      return { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f,
               ang: Math.atan2(B.y - A.y, B.x - A.x) };
    }
    const P = pts.map(([lo, la]) => ({ x: (lo - MAP.west) * MAP.ppd,
                                       y: (MAP.north - la) * MAP.ppd }));
    // 折线是按 from→to 存的；若这条边是反向取的，上面已经 reverse 过
    const segs: number[] = [];
    let total = 0;
    for (let i = 0; i + 1 < P.length; i += 1) {
      const d = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y);
      segs.push(d); total += d;
    }
    let want = total * Math.max(0, Math.min(1, f));
    for (let i = 0; i < segs.length; i += 1) {
      if (want <= segs[i] || i === segs.length - 1) {
        const t = segs[i] > 0 ? want / segs[i] : 0;
        return {
          x: P[i].x + (P[i + 1].x - P[i].x) * t,
          y: P[i].y + (P[i + 1].y - P[i].y) * t,
          ang: Math.atan2(P[i + 1].y - P[i].y, P[i + 1].x - P[i].x),
        };
      }
      want -= segs[i];
    }
    return { x: P[P.length - 1].x, y: P[P.length - 1].y, ang: 0 };
  };

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
      // 沿真正的路走，不再在两城之间插直线
      const p = alongRoad(a.home, a.target, f);
      if (!p) return null;
      return { a, mine, marching: true as const, x: p.x, y: p.y, from, to };
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
  // 合并时把数字抹掉再比。「山阳郡 被围，本季无产出（存粮尚可支 4 季）」
  // 逐季只有那个数在变，逐字比对合并不了——实测一份 22 条的年表里
  // 有 4 条是同一件事的四个存粮读数，占了近两成。
  // 合并后显示**最后一次**的文本：那是这段围城结束时的状态，比首次的有用
  const same = (a: string, b: string) => a.replace(/\d+/g, "#") === b.replace(/\d+/g, "#");
  for (const e of game.log) {
    if (e.faction !== seat || !BIG.has(e.kind)) continue;
    const text = cnText(e.text);
    const last = chronicle[chronicle.length - 1];
    // 只合并**相邻季**的同一句。跨季合并会让「194 秋—195 冬（×2 季）」
    // 读起来像连续六季，其实只是首末两次
    if (last && same(last.text, text) && e.turn === last.to + 1) {
      last.to = e.turn; last.n += 1; last.text = text;
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

  // 天下统一结束整局；玩家覆灭或归隐后可转为观战。
  const over = game.finished || (!spectator && (me.eliminated || me.retired));
  // 当前兵力的军费包含屯田减免，和模型观测、结算使用同一公式。
  const upkeep = upkeepFor(game, seat, engine.P);

  const brief = briefFor(game, engine.geo, seat, engine.G.adj, (id) => engine.nameOf.get(id) ?? id);

  const centerOnId = (id: string) => {
    const p = engine.points.find((c) => c.id === id);
    if (p) { setSmooth(true); setView(centerOn(p.longitude, p.latitude, Math.max(5.2, minK), MAP)); }
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
  /**
   * 天下形势：谁在涨。
   *
   * 战报里每季十二行「X 自 A 取 B」，信息都在，格局看不出来——读完只知道
   * 天下很乱，不知道谁在赢。实测自己玩了一局：吕布连吞我三郡、袁绍在北边
   * 连下四郡，而这两件事和「士燮取日南郡」在战报里是同一个分量。
   *
   * 只列前八家与自己。郡数是唯一算得准的公开量（易主是公开事件），
   * 兵力与国库是不可见的，不能列——列了就是在给玩家假情报。
   */
  const powers = (() => {
    const now: Record<string, number> = {};
    for (const c of Object.values(game.commanderies)) {
      if (c.owner) now[c.owner] = (now[c.owner] ?? 0) + 1;
    }
    // 郡数增减取结算前后归属的差值，不从事件文本反推。
    const delta = flash.delta;
    const rows = Object.entries(now)
      .filter(([f]) => !game.factions[f]?.eliminated)
      .map(([f, n]) => ({ f, n, d: delta[f] ?? 0, mine: f === seat }))
      .sort((a, b) => b.n - a.n || cmp(a.f, b.f));
    const top = rows.slice(0, 8);
    // 自己没进前八也要在，否则这张表对玩家没用
    if (!top.some((r) => r.mine)) {
      const me2 = rows.find((r) => r.mine);
      if (me2) top.push(me2);
    }
    return top;
  })();

  /**
   * 不耗令的候选还剩多少。
   *
   * 刺探与调任的 cost 是 0——它们不占本季令数，下了纯赚。而界面上此前
   * 没有任何地方说这件事：新玩家看到「令数 6/6」就以为一切都要算计着花，
   * 于是开局既不探也不调，全境「未探」、预告全是「未知」。
   *
   * 这不是猜的：48 局的榜上机器人每席·季用 3.31 次调任、模型只用 1.32，
   * 而机器人赢在把免费的那部分用满（docs/EVAL.md 第 24 条）。人比模型
   * 更容易漏掉它——模型至少读得到候选表里的 cost。
   */
  const freeLeft = candidates.filter((c) => {
    if (c.cost !== 0 || picked.includes(c.key)) return false;
    // **还要真的下得了**。免费不等于无限：刺探有本季配额（战报里那句
    // 「scout 本季免费次数已用尽」就是它）。不走这一步的话，配额用完之后
    // 提示条还在说「还有 2 条不耗令的候选」——那是在骗玩家去点一条必被拒的令。
    // 判据与卡片上的禁用态同源（同一个 validate、同一个 adm.state）
    if (!adm) return true;
    return !adm.check(c.action);
  });

  /**
   * 危局：势力级的、会持续多季的坏状态。
   *
   * 「家底一览」里已经逐郡标了被围与断供，但**治所失守是势力级的**——
   * 它让全境无产出，而界面上此前没有任何地方说这件事。实测自己玩了一局：
   * 治所被吕布夺走后连着四季颗粒无收，战报里每季重复同一句话，
   * 而唯一的出路「迁治」躺在征伐那一栏的第 N 条里，一次都没被注意到。
   *
   * 所以危局条不只报警，还要把出路一起给出来——引擎已经列了迁治候选，
   * 这里只是把它顶到眼前。
   */
  const crisis = (() => {
    const cap = me.capital;
    const capLost = !cap || game.commanderies[cap]?.owner !== seat;
    const besieged = myLands.filter((l) => l.note.endsWith("围"));
    const cut = myLands.filter((l) => l.note === "补给断绝");
    const fix = candidates.find((c) => c.key.startsWith("relocate:"));
    if (!myLands.length) return null;
    if (capLost) {
      return {
        level: "grave" as const,
        text: `治所${cap ? ` ${cap}` : ""}已失，全境政令不通——本季无产出。`,
        fix: fix ? { key: fix.key, label: `迁治于 ${fix.key.split(":")[1]}` } : null,
        hint: fix ? "迁治下季生效，选连得回最多郡国的那一处。" : "已无可迁之处。",
      };
    }
    if (besieged.length) {
      return {
        level: "warn" as const,
        text: `${besieged.map((l) => l.c.id).join("、")} 被围——围城之郡无产出，`
          + "守军逐季折损。",
        fix: null,
        hint: "从邻郡发兵解围，或出城迎战；候选在「征伐」一栏。",
      };
    }
    if (cut.length) {
      return {
        level: "warn" as const,
        text: `${cut.map((l) => l.c.id).join("、")} 补给断绝——与治所之间的通路被切断。`,
        fix: null,
        hint: "补给按己方郡国的连通算：夺回中间那一郡即可复通。",
      };
    }
    return null;
  })();

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
      <header className="play-head play-bar" ref={barRef}>
        <span className="era">{game.year} 年 · {SEASON_CN[game.season]}{"\u3000"}
          第 {game.finished ? game.turn : game.turn + 1} 季{"\u3000"}
          纪元 {game.epoch}</span>
        <span className="who" style={{ "--c": engine.colorOf.get(seat) } as React.CSSProperties}>
          {spectator ? "观战 · " : ""}{engine.nameOf.get(seat)}
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

      {/* 危局条。治所失守这类势力级的坏状态会持续好几季，而战报每季重复
          同一句话——那是回声不是信息。常驻一条，并把出路一起给出来 */}
      {/* 没有危局时，提示还剩多少不耗令的候选。两者不并排——
          真出了危局，别的都不要紧 */}
      {!spectator && !crisis && freeLeft.length > 0 && (
        <div className="crisis tip" role="status">
          <b>提示</b>
          <span>
            还有 {freeLeft.length} 条<b className="inline">不耗令</b>的候选
            {/* 按**候选 key 的前缀**取中文名，不按动作类型——
                relief 与 withdraw 不是动作类型，是引擎派生的键（见 panels.ts） */}
            （{[...new Set(freeLeft.map((c) => TYPE_CN[c.key.split(":")[0]] ?? c.key.split(":")[0]))]
              .join("、")}）
            ——它们不占本季令数。
          </span>
          {/* 这一句只在第一季说。逐季重复就是回声——治所失守那条战报
              每季重播同一句话，正是我要避开的毛病 */}
          {game.turn === 0 && <i>开局全境未探，攻城预告只会是「未知」；刺探不要钱。</i>}
        </div>
      )}
      {!spectator && crisis && (
        <div className={`crisis ${crisis.level}`} role="status">
          <b>{crisis.level === "grave" ? "危局" : "警"}</b>
          <span>{crisis.text}</span>
          {crisis.fix && (
            <button type="button" className="crisis-fix"
              onClick={() => {
                setPicked((p) => (p.includes(crisis.fix!.key) ? p : [...p, crisis.fix!.key]));
                setHoverKey(crisis.fix!.key);
              }}>
              {crisis.fix.label}
            </button>
          )}
          <i>{crisis.hint}</i>
        </div>
      )}

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
                {records.length} 条已结算决策
                {spentUsd > 0 && `｜已记录费用约 $${spentUsd.toFixed(4)}`}
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
      <div className={`play-body${unrolled ? " unrolled" : ""}`}>
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
          {/* 林画在海波云气之下：它是底纹里最底的一层 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="decor forest" src={FOREST} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="decor" src={DECOR} alt="" />
          {/* 墙：过不去的地界。规则改成「山是墙、江是墙、关是墙上的口子」之后，
              这件事必须在图上读得出来——底图把山画得好看，却答不了
              「大军能不能从这儿过」。棋盘档才出：势力图那一档看的是形势不是路 */}
          {lod >= 1 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="decor wall" src={WALL} alt="" />
          )}
          <canvas ref={canvasRef} />
          </div>
          {/*
           * 矢量层单独一屏大，内部用一个 <g> 做与 stage 相同的平移缩放。
           *
           * 跟着 stage 一起放大的话，十四倍下这一层是 16531×13526 CSS 像素，
           * 而看得见的永远只有一屏。搬出来之后画的就只有看得见的那块。
           *
           * 内部变换要与 stage 逐像素对齐：stage 宽 = 画框宽 W，图上 1815 单位铺满它，
           * 故一图上单位 = W/1815 CSS 像素，再乘缩放倍数；平移则是 view.x% 换算成像素
           */}
          <div className="map-vec">
          {/* 不给 viewBox：viewBox 的比例与元素比例一旦不一致，默认的
              preserveAspectRatio 会把整层等比缩放再居中，矢量层就与底图错开
              （实测横向偏差 −73/−56/−24 像素，随位置变——那是缩放不一致的特征）。
              不给 viewBox 时用户单位就是 CSS 像素，下面的变换直接落在屏幕坐标上 */}
          <svg>
            <g transform={`translate(${(view.x / 100) * box.w} `
              + `${(view.y / 100) * (box.w * MAP.h / MAP.w)}) `
              + `scale(${(box.w / MAP.w) * view.k})`}>
            <defs>
              <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {/* 疆界：己方朱、他方墨。两条 path，任意倍数都是实的。
                笔宽按**档位**给，不按倍数连续变：改一次 strokeWidth，浏览器就要把
                这三千多段曲线的笔画几何重算一遍。三档够用，且只在过档时改一次 */}
            {borderEls}
            {/* 水：河心提亮 + 两岸落墨，与底图同一套画法。只在近观档出——
                整幅可见时底图那份已经够 */}
            {waterEls}
            {/* 道路：画在州名与城印之下。地形决定行军天数，指到某郡时它那几条提亮，
                并在路当中标上「山道 47 日」——「道远」这句候选标签的出处 */}
            {roadEls}
            {/* 提亮的那几条单独画在上面：把 hot 塞进上面那 232 条里，
                等于每悬停一次就重建一遍整层 */}
            {roads.filter((r) => r.hot).map((r) => (
              <path key={`h-${r.key}`} className={`road lod${lod} hot`} d={r.d} fill="none"
                stroke={r.st.stroke} strokeDasharray={r.st.dash}
                strokeWidth={r.st.width * 2.2 / view.k ** 0.82} />
            ))}
            {roadTips.map((t) => (
              <text key={`d-${t.key}`} className="road-tip" x={t.x} y={t.y}
                textAnchor="middle" fontSize={t.size}>{t.text}</text>
            ))}
            {/* 郡名题记：写在辖境里，是**区域**的名字，不是城的名字。
                画在城印与关津之前——它是底层的地名，不该压住上面的符号 */}
            {/* 州名水印：画在最底下。它是地界题记，不是标签 */}
            {zhouShown.map((m) => (
              <text key={m.z} className="zhou" x={m.x} y={m.y} textAnchor="middle"
                fontSize={m.size}>{m.z}</text>
            ))}
            {/* 势力名：势力图那一档的主角。不画城印之后，「这片橙的是谁」
                得由它来答——三十一家共用三十一种土色，靠色卡是认不出人的 */}
            {factionNames.map((l) => (
              <text key={`fn-${l.f}`} className={`faction-name${l.mine ? " mine" : ""}`}
                x={l.x} y={l.y} textAnchor="middle" fontSize={l.size}>{l.name}</text>
            ))}
            {junNames.map((l) => (
              <text key={`jn-${l.id}`} className={`jun-name${l.hot ? " hot" : ""}`}
                x={l.x} y={l.y} textAnchor="middle" fontSize={l.size}>{l.name}</text>
            ))}
            {/* 关津港仓：各有形制。关隘与港口整幅可见，其余放大后才铺开 */}
            {nodeEls}
            {nodeLabels.map((l) => (
              <text key={`nn-${l.id}`} className="node-name" x={l.x} y={l.y}
                textAnchor="middle" fontSize={l.size}>{l.name}</text>
            ))}

            {arrows.map((ar) => (ar.sortie ? (
              // 出城迎战：起点即目标，画一圈而不是一条线
              <circle key={ar.key} className={`sortie${ar.on ? " on" : ""}`}
                cx={ar.a.x} cy={ar.a.y} r={30 / view.k ** 0.82} />
            ) : ar.d ? (
              <path key={ar.key} className={`arrow${ar.on ? " on" : ""}`} d={ar.d} fill="none"
                strokeWidth={5 / view.k ** 0.82} markerEnd="url(#arrowhead)" />
            ) : (
              // 没有实走路径（数据缺失）才退回直线
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
                {/* 城下一排建筑。只画自家的，且只在近观档：
                    他家城里建了什么，观测里本来就看不到 */}
                {/* 阵型：城左上一枚，受迷雾约束（他家的须刺探过） */}
                {lod >= 2 && !hidden.has(m.c.id) && (() => {
                  const f = observedFormation(game, seat, m.c.id);
                  if (!f) return null;
                  const fs2 = m.base * 0.66;
                  return (
                    <g className="form-mark">
                      <title>{FORM_TIP[f]}</title>
                      <image href={`${GLYPH}/f-${f}-0-ink.png`}
                        x={m.x - m.base * 1.15 - fs2 / 2} y={m.y - m.base * 1.5}
                        width={fs2} height={fs2} />
                    </g>
                  );
                })()}
                {/* 物产：画成那座建筑的**虚影**——「这个郡有铁，但铁官还没修」。
                    物产是常量、不随迷雾变（候选标签里本来就写「有铁」），
                    所以他家的也画。已建的那座不再重复画虚影 */}
                {lod >= 2 && !hidden.has(m.c.id) && m.st.resources
                  .filter((r) => RES_BUILD[r] && !m.st.buildings.includes(RES_BUILD[r] as never))
                  .map((r, i, all) => {
                    const bs = m.base * 0.8;
                    const bx = m.x + (i - (all.length - 1) / 2) * bs * 0.92;
                    const dy = m.mine && m.st.buildings.length ? m.base * 1.06 : m.base * 0.06;
                    return (
                      <g key={`r-${r}`} className="res-ghost">
                        <title>{`有${RESOURCE_CN2[r] ?? r}（未建）`}</title>
                        <image href={`${GLYPH}/b-${RES_BUILD[r]}-0-ink.png`}
                          x={bx - bs / 2} y={m.y + dy} width={bs} height={bs} />
                      </g>
                    );
                  })}
                {lod >= 2 && m.mine && !hidden.has(m.c.id) && m.st.buildings.map((b, i, all) => {
                  // 一座指甲盖大就白画了：第一版 0.62×base，图上只是两个小点。
                  // 放到 0.95×base，牌记那边也跟着往下让（见 labels 的 y）
                  const bs = m.base * 0.95;
                  const bx = m.x + (i - (all.length - 1) / 2) * bs * 0.92;
                  return (
                    <g key={b}>
                      <title>{BUILD_CN2[b] ?? b}</title>
                      <image href={`${GLYPH}/b-${b}-0-ink.png`}
                        x={bx - bs / 2} y={m.y + m.base * 0.06} width={bs} height={bs} />
                    </g>
                  );
                })}
                {lod === 0 || hidden.has(m.c.id) ? (
                  // 让位者与势力图那一档：一枚小点。位置还在、点得到、归属看得见。
                  //
                  // 势力图上不画城印是这一档的立身之本：1 倍时 232 条边里有 127 条
                  // 摆不下一枚棋子，105 枚城印铺上去必然互相压住，读出来的是一团
                  // 而不是形势。那一屏该答的是「谁大谁小、谁挨着谁」，疆域色块已经答了
                  <circle className="dot" cx={m.x} cy={m.y} r={m.base * 0.2}
                    fill={m.st.owner ? engine.colorOf.get(m.st.owner) ?? "#7a7266" : "#efe9dc"} />
                ) : (
                  <CityMark x={m.x} y={m.y} size={m.base * (focus === m.c.id ? 1.3 : 1)}
                    mine={m.mine} seat={m.isSeat} besieged={m.besieged} detail={lod >= 2}
                    at={m.c.id}
                    fill={m.st.owner ? engine.colorOf.get(m.st.owner) ?? "#7a7266" : null} />
                )}
              </g>
            ))}
            {/* 上一季打过的地方：交叉两笔。破城由下面的朱墨环画，这里画的是
                **打了但城没换手**的——强攻未克、野战、被围、解围。
                图上此前只看得见结果（谁的地盘变了），看不见过程（哪儿在打） */}
            {flash.battles.map((b) => {
              const p2 = engine.points.find((c) => c.id === b.id);
              if (!p2) return null;
              const x = (p2.longitude - MAP.west) * MAP.ppd;
              const y = (MAP.north - p2.latitude) * MAP.ppd;
              const s3 = 17 / view.k ** 0.82;
              return (
                <g key={`b-${b.id}`} className={`battle${b.mine ? " mine" : ""}`}>
                  <path d={`M${x - s3} ${y - s3}L${x + s3} ${y + s3}`}
                    strokeWidth={2.6 / view.k ** 0.82} />
                  <path d={`M${x + s3} ${y - s3}L${x - s3} ${y + s3}`}
                    strokeWidth={2.6 / view.k ** 0.82} />
                </g>
              );
            })}
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
            {/* 军团：一枚小圆点，势力色，指上去出详情。
                此前是一顶帐 + 兵种徽 + 器械徽 + 一行字，四样东西挤在十几像素里，
                放大后才勉强读得出——而「这支兵是谁的、在哪、往哪去」本来只需要
                一个点就够。兵种、器械、主将这些移进悬停详情，那里有地方好好写。
                行军中的把它**走的那条路**整条提亮：一眼看出这支兵冲着谁去 */}
            {troops.map((t) => {
              const col = engine.colorOf.get(t.a.faction) ?? "#7a7266";
              // 点的大小随兵力，但压得很扁——五百人与两万人都得看得见，
              // 而图上不该出现一个盖住半座城的圆
              const rr = (7 + Math.min(9, Math.log10(Math.max(100, t.a.troops)) * 2.2))
                / view.k ** 0.82;
              const road = t.marching && t.a.target ? roadGeom.find((r) =>
                (r.e.from === t.a.home && r.e.to === t.a.target)
                || (r.e.to === t.a.home && r.e.from === t.a.target)) : null;
              return (
                <g key={t.a.id}
                  className={`army${t.mine ? " mine" : ""}${t.marching ? " marching" : ""}`}
                  onMouseEnter={() => setArmyTip(t.a.id)}
                  onMouseLeave={() => setArmyTip((k) => (k === t.a.id ? null : k))}>
                  {road && (
                    <path className="march-path" d={road.d} fill="none"
                      stroke={col} strokeWidth={2.6 / view.k ** 0.82} />
                  )}
                  {/* 命中圆：点本身只有十来像素，低于可点区域的最低尺寸。
                      必须带 mark 类——整张 svg 是 pointer-events:none */}
                  <circle className="mark" cx={t.x} cy={t.y} r={rr * 1.9} fill="transparent" />
                  <circle className="army-dot" cx={t.x} cy={t.y} r={rr} fill={col} />
                  {/* 圆点上写势力的一字缩写。颜色分不清三十一家，一个字就够；
                      而「在不在动」由下面那圈虚环表达，不必再写「留／行」 */}
                  <text className="army-abbr" x={t.x} y={t.y + rr * 0.36}
                    textAnchor="middle" fontSize={rr * 1.12}>
                    {factionAbbr(engine.nameOf.get(t.a.faction) ?? t.a.faction)}
                  </text>
                  {/* 在途的加一圈虚环：静止与移动要一眼分得开 */}
                  {t.marching && (
                    <circle className="army-ring" cx={t.x} cy={t.y} r={rr * 1.55}
                      strokeWidth={1.4 / view.k ** 0.82}
                      strokeDasharray={`${2.6 / view.k ** 0.82} ${2.6 / view.k ** 0.82}`} />
                  )}
                  {/* 「还要几季到」只给自己的在途军团标出来。
                      改成圆点时把这一行也一并去掉了，那是丢东西——援军赶不赶得到
                      是围城那只钟的另一半，它不该藏在悬停详情里。
                      他方的不标：那是免费情报 */}
                  {t.marching && t.mine && lod >= 1 && (
                    <text className="army-eta" x={t.x} y={t.y - rr * 2.1}
                      textAnchor="middle" fontSize={rr * 1.15}>
                      尚需 {t.a.marchLeft} 季
                    </text>
                  )}
                </g>
              );
            })}
            {/* 围城旗：城下有谁、围了几季、多少人。只有一个虚线圈看不出这些，
                而这三样正是「要不要去救」的全部依据 */}
            {/* 在途的不算在城下：它这一季不结算攻城、不扣守方存粮，
                插一面围城旗在那儿，读图的人会以为城已经被围上了 */}
            {(lod === 0 ? [] : game.armies.filter((a) => a.target && a.marchLeft <= 0)).map((a) => {
              const p = engine.points.find((c) => c.id === a.target);
              if (!p) return null;
              const x = (p.longitude - MAP.west) * MAP.ppd;
              const y = (MAP.north - p.latitude) * MAP.ppd;
              const s = 30 / view.k ** 0.82;
              const mine = a.faction === seat;
              // 营垒与那行字的位置：从城印中心往东推出进度环的半径再加一点。
              // 摆在东侧而不是正下方，是为了避开城名那块牌记（它在城的正下方）
              const cwA = (marks.find((m) => m.c.id === a.target)?.base ?? 24) * 2.3;
              const campX = x + cwA * 0.52 * 1.3 + s * 0.95;
              const campY = y - cwA * 0.3;
              return (
                // 城下的围军画营垒——与在途的行营是同一套画。此前这里是一面
                // 手画的三角小旗，与旁边的笔墨城印摆在一起就是两套语言
                // 营垒要摆在城印**之外**：城印半宽约 (24..41)/k^0.82，而 s 是
                // 30/k^0.82，1.15s 正好压在城墙上——图上是围军蹲在城里。
                // 往东北挪到 2.1s，字再压在营垒下面，避开城名那块牌记（它在城的正下方）
                <g key={a.id} className={`siege-camp${mine ? " mine" : ""}`}>
                  {/* 围城进度环。围城是这局里最长的一条时间线，而图上此前只有
                      一个圈——「还能撑多久」只能去战报里数季数。
                      画的是**守方的钟**：存粮还剩几成。己方的城看得见真值；
                      他方的城看不见存粮，那就只画已围了几季（一季一格），
                      不编一个自己不知道的数出来 */}
                  {(() => {
                    const tgt = game.commanderies[a.target!];
                    if (!tgt) return null;
                    // 圆心取**城印的中心**，不是郡的锚点。
                    //
                    // 被围的城上此前画着两个圈：城印里一个朱红虚线圈（绕城印，
                    // 心在 y − 0.3w），军团层这一个褐色进度环（绕锚点，心在 y）。
                    // 两个圆心差着 0.7 个城印宽，于是一实一虚交叠成一团，
                    // 城墙还被从中间切开——实测那正是围城处「看不懂」的来源。
                    // 现在同心，且这一环走在虚线圈之外，读起来是「圈外一道钟」
                    const cw = (marks.find((m) => m.c.id === a.target)?.base ?? 24) * 2.3;
                    const cy = y - cw * 0.3;
                    const rr = cw * 0.52 * 1.3;
                    const own = tgt.owner === seat;
                    const cap = Math.max(1, provCapOf(tgt, engine.P));
                    // 己方城：存粮剩余比例。他方城：已围季数占上限的比例
                    const frac = own
                      ? Math.max(0, Math.min(1, tgt.provisions / cap))
                      : Math.max(0, Math.min(1, 1 - a.siegeSeasons / Math.max(1, engine.P.siegeMaxSeasons)));
                    const A = -Math.PI / 2, B = A + Math.PI * 2 * frac;
                    const large = frac > 0.5 ? 1 : 0;
                    const px = (t: number) => x + Math.cos(t) * rr;
                    const py = (t: number) => cy + Math.sin(t) * rr;
                    return (
                      <>
                        <circle className="siege-track" cx={x} cy={cy} r={rr}
                          strokeWidth={3.2 / view.k ** 0.82} />
                        {frac > 0.001 && (
                          <path className={`siege-gauge${frac <= 0.26 ? " urgent" : ""}`}
                            d={`M${px(A).toFixed(1)} ${py(A).toFixed(1)}`
                              + `A${rr.toFixed(1)} ${rr.toFixed(1)} 0 ${large} 1 `
                              + `${px(B).toFixed(1)} ${py(B).toFixed(1)}`}
                            strokeWidth={3.2 / view.k ** 0.82} />
                        )}
                      </>
                    );
                  })()}
                  {/* 营垒摆在进度环**之外**。此前按 2.1s 摆，而环是 1.35s——
                      营垒正好骑在环上；现在按环半径推出去，无论城印多大都不相压 */}
                  <ArmyMark x={campX} y={campY - s * 0.25} s={s * 0.86}
                    color={engine.colorOf.get(a.faction) ?? "#7a7266"}
                    marching={false} at={a.id}
                    unit={lod >= 1 ? a.unit : undefined} gear={lod >= 1 ? a.gear : undefined} />
                  <text x={campX} y={campY + s * 0.42} textAnchor="middle" fontSize={s * 0.4}>
                    {a.siegeSeasons + 1}季·{(a.troops / 1000).toFixed(1)}千
                    {/* 存粮只在**自己的城**被围时报：他方城的存粮看不见，
                        报出来就是免费情报 */}
                    {game.commanderies[a.target!]?.owner === seat
                      ? `·粮 ${game.commanderies[a.target!].provisions}` : ""}
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
            </g>
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
              {/* 地色那一层要先解释：图上最要紧的一件事就是「哪儿过得去」 */}
              <li className="terrain-key">
                <span><i style={{ background: "rgba(62,54,45,0)" }} />好走</span>
                <span><i style={{ background: "rgba(62,54,45,0.34)" }} />难行</span>
                <span><i style={{ background: "rgba(58,50,42,0.82)" }} />过不去</span>
                <span><i style={{ background: "rgba(58,92,116,0.66)" }} />大江</span>
                <em>地色由通行代价场画出：越深越难走。关渡就设在深色的豁口上</em>
              </li>
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
                <span>{legendArmy(false)}待命／城下围城</span>
              </li>
              <li>
                {/* 兵种贴在帐左、器械贴在帐右。野战有相克，看图就能判胜负 */}
                <span>{legendPlain("u-infantry")}步卒</span>
                <span>{legendPlain("u-cavalry")}骑兵</span>
                <span>{legendPlain("u-archer")}弓弩</span>
                <span>{legendPlain("u-navy")}水军</span>
              </li>
              <li>
                <span>{legendPlain("g-ram")}冲车</span>
                <span>{legendPlain("g-mound")}土山</span>
                <em>攻城更易，但行军慢一季</em>
              </li>
              <li>
                <span>{legendPlain("b-office")}官府</span>
                <span>{legendPlain("b-granary")}仓廪</span>
                <span>{legendPlain("b-market")}市</span>
                <span>{legendPlain("b-drill")}校场</span>
              </li>
              <li>
                <span>{legendPlain("b-ironworks")}铁官</span>
                <span>{legendPlain("b-saltern")}盐场</span>
                <span>{legendPlain("b-stud")}马苑</span>
                <span>{legendPlain("b-farmstead")}屯田</span>
              </li>
              {/* JSX 里不吃 markdown：这行原来写成 **淡影**，图例上露出一对星号 */}
              <li>
                <span>{legendPlain("f-scale")}鱼鳞</span>
                <span>{legendPlain("f-wings")}鹤翼</span>
                <span>{legendPlain("f-square")}方圆</span>
                <em>攻／速／耐围，画在城左上</em>
              </li>
              <li><em>阵型受迷雾约束：自家的看得见，他家的要刺探过或结了盟。
                相克成环——鱼鳞克鹤翼、鹤翼克方圆、方圆克鱼鳞，克之 +1 缺口</em></li>
              <li><em>建筑画在城下（只画自家的）。<b>淡影</b>是「有这个物产、
                但那座还没修」——铁官须有铁、盐场须有盐、马苑须有牧苑、屯田须可垦</em></li>
              <li>
                <label className="legend-toggle">
                  <input type="checkbox" checked={allRoads}
                    onChange={(e) => setAllRoads(e.target.checked)} />
                  画出全部 232 条道路
                </label>
                <em>常驻只画<b>自家郡国接出去的</b>那些——全网铺开时每条路都在跟
                  别的路抢注意力，谁也读不出来。指到某郡，它那几条照样会提亮</em>
              </li>
              <li><em>道路一律实线，按<b>颜色与粗细</b>分：平道最细最淡、丘陵、山道、
                水路走青、<b>关道最粗最深</b>。路是在高程上算出来的实走路径，
                会沿河谷绕开山脊，并从挂在它上面的关穿过去。
                指到某郡，它那几条会提亮并标出行军日数</em></li>
              <li><em>成片的墨点是<b>林</b>（南方多、北方少），取自公有领域的
                理想化自然植被——那是「几乎无人类影响」的一版，比现代地表更近汉末。
                山地高原不叠树点，那里留给皴笔</em></li>
            </ul>
          </details>

          <div className="zoom">
            <button onClick={() => setUnrolled((v) => !v)}
              title={unrolled ? "收卷：把候选表放回来" : "展卷：画心占满整屏"}>
              {unrolled ? "收卷" : "展卷"}
            </button>
            <button onClick={() => { setSmooth(true); setView((v) => zoomAt(v, 1.4, minK)); }}>＋</button>
            <button onClick={() => { setSmooth(true); setView(fitAll(minK)); }}>全图</button>
            <button onClick={() => { setSmooth(true); setView((v) => zoomAt(v, 1 / 1.4, minK)); }}>－</button>
          </div>
          {/* 军团的悬停详情。圆点上只留「谁的、在哪」，其余全在这里说——
              兵种、器械、主将、去向、还要几季。图上挤四样徽记，读者反而
              什么都读不出 */}
          {armyTip && (() => {
            const a = game.armies.find((x) => x.id === armyTip);
            if (!a) return null;
            const who = engine.nameOf.get(a.faction) ?? a.faction;
            const lead = a.retinue.map((o) => engine.roster.byId.get(o)?.name ?? o);
            const mine = a.faction === seat;
            return (
              <div className="tip">
                <b style={{ "--c": engine.colorOf.get(a.faction) } as React.CSSProperties}
                  className="army-who">{who}{mine ? "（你）" : ""}</b>
                <span>{a.marchLeft > 0 && a.target
                  ? `自 ${a.home} 往 ${a.target}——尚需 ${a.marchLeft} 季`
                  : a.target ? `围 ${a.target}` : `驻 ${a.at}`}</span>
                {/* 兵力对他方是**观测值**，不能直报真值——图上别处都按迷雾报带，
                    这里独报真值就成了免费情报 */}
                <span>{mine ? `${Math.round(a.troops)} 人`
                  : (() => { const o = observedGarrison(game, seat, a.at, engine.P);
                      return o.scouted || o.own ? `约 ${Math.round(o.value)} 人`
                        : `${Math.round(o.lo)}–${Math.round(o.hi)} 人（未探）`; })()}
                  {"\u3000"}{UNIT_CN2[a.unit] ?? a.unit}
                  {a.gear && a.gear !== "none" ? `\u3000${GEAR_LABEL[a.gear] ?? a.gear}` : ""}</span>
                {lead.length > 0 && <span>{lead.join("、")}</span>}
              </div>
            );
          })()}
          {/* 关津的悬停详情。它与郡的详情共用一个位置：两者不会同时指到 */}
          {nodeTip && !focus && !armyTip && (
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
          <SessionPanel game={game} session={session}
            onChange={(next) => { setSession(next); setAutoPlay(false); setTurnError(null); }}
            names={engine.nameOf} seat={seat} busy={busy} autoPlay={autoPlay}
            onAutoPlay={setAutoPlay} onAdvance={() => { void submit(); }} error={turnError}
            onView={(id) => {
              setSeat(id); setPicked([]); setPinned(null); setFocus(null);
              setFlash({ mine: [], world: [], delta: {}, battles: [] });
              const cap = game.factions[id]?.capital;
              if (cap) centerOnId(cap);
            }} />
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
            <summary>{spectator ? "所观势力郡国" : "我的郡国"}<i>{myLands.length}</i></summary>
            <table className="lands">
              <thead>
                {/* 与观测的 mine 段对账加出来的四列：粮、种、械、建。
                    模型这四样都看得见，而人只看得见兵产心防阵将——
                    「人和模型看的不是同一场战争」在这张表上就是四个字段的差 */}
                <tr><th>郡国</th><th>兵</th><th>种</th><th>产</th><th>心</th><th>防</th>
                  <th>粮</th><th>阵</th><th>械</th><th>将</th><th>建</th><th>状况</th></tr>
              </thead>
              <tbody>
                {myLands.map((L) => (
                  <tr key={L.c.id} className={L.warn ? "warn" : undefined}
                    onClick={() => { setPinned(L.c.id); setFocus(L.c.id); centerOnId(L.c.id); }}>
                    <td>{L.c.id}</td>
                    <td>{L.c.garrison}</td>
                    <td>{UNIT_CN2[L.c.unit] ?? L.c.unit}</td>
                    <td>{L.c.yieldTier}</td>
                    <td>{L.c.moraleTier}</td>
                    <td>{L.c.defense}</td>
                    {/* 存粮是围城那只钟：被围时每季 −1，归零则不战自下。
                        满仓写「满」，免得一列数字里看不出哪个是危的 */}
                    <td className={L.c.provisions <= 1 ? "warn-cell" : undefined}>
                      {L.c.provisions >= provCapOf(L.c, engine.P) ? "满" : L.c.provisions}
                    </td>
                    <td>{FORMATION_CN[L.c.formation]}</td>
                    <td>{GEAR_CN2[L.c.gear] ?? "—"}</td>
                    <td>{L.officers.length ? L.officers.map((o) => o.name).join("、") : "—"}</td>
                    <td>{L.c.buildings.length
                      ? L.c.buildings.map((b) => BUILD_CN2[b] ?? b).join("·") : "—"}</td>
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
                  <h3>上季战报<i>{spectator ? "上季观察势力" : "我方"}</i></h3>
                  <ul className="mine">{flash.mine.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {flash.world.length > 0 && (
                <>
                  <h3>天下大事</h3>
                  <ul>{flash.world.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {/* 天下形势。上面十几行「X 自 A 取 B」是事件，这里是格局——
                  只有郡数：那是唯一算得准的公开量，兵力与国库不可见，
                  列出来就是给玩家假情报 */}
              {powers.length > 1 && (
                <>
                  <h3>天下形势<i>郡数</i></h3>
                  <ol className="powers">
                    {powers.map((p) => (
                      <li key={p.f} className={p.mine ? "me" : ""}>
                        <span className="pn"
                          style={{ "--c": engine.colorOf.get(p.f) } as React.CSSProperties}>
                          {engine.nameOf.get(p.f) ?? p.f}
                        </span>
                        <b>{p.n}</b>
                        {p.d !== 0 && (
                          <i className={p.d > 0 ? "up" : "down"}>
                            {p.d > 0 ? `+${p.d}` : p.d}
                          </i>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}

          {/* 本局年表。此前它只在终局出现，对局中只有「上季战报」——
              中途想问「我什么时候丢的山阳郡」「这场围城围了几季了」，
              无从查起，而错过的那一屏就永远没了。
              年表本来就每季在算（chronicle），只是被关在终局块里。
              默认折叠：它是「要查的时候才看」的东西，不该跟本季战报抢地方 */}
          {!over && chronicle.length > 0 && (
            <details className="chron-fold">
              <summary>本局年表<i>{chronicle.length} 事</i></summary>
              <ol className="chron">
                {chronicle.slice().reverse().map((e, i) => (
                  <li key={i}>
                    <b>{e.when}</b>
                    <span>{e.text}{e.n > 1 ? `（连 ${e.n} 季）` : ""}</span>
                  </li>
                ))}
              </ol>
            </details>
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
                  于 {game.year} 年 · {SEASON_CN[game.season]}（第 {game.turn} 季）
                  戡定天下。汉末群雄至此而终。</p>
              )}
              {game.winner && game.winner !== seat && (
                <p className="over-lead">{engine.nameOf.get(game.winner) ?? game.winner}
                  于第 {game.turn} 季戡定天下，本局结束。</p>
              )}
              {me.eliminated && (
                <p className="over-lead">尽失疆土，止于 {game.year} 年 · {SEASON_CN[game.season]}
                  （第 {game.turn} 季）。
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
                <summary>{game.turn} 季年表<i>{chronicle.length} 事</i></summary>
                <ol className="chron">
                  {chronicle.map((e, i) => (
                    <li key={i}><b>{e.when}</b>
                      <span>{e.text}{e.n > 1 ? `（连 ${e.n} 季）` : ""}</span></li>
                  ))}
                  {!chronicle.length && <li><span>尚无大事记。</span></li>}
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
                {!game.finished && !spectator && <button onClick={() => {
                  setSession({ ...session, human: null }); setPicked([]);
                }}>转为观战</button>}
                <button onClick={() => { clearSave(); setResume(null); setGame(null); setSeat(null); setAutoPlay(false); setTurnError(null); }}>再来一局</button>
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
          ) : spectator ? (
            <div className="observer-note">
              <p>当前观察：{engine.nameOf.get(seat)}。地图与情报按此势力视角显示，所有势力由各自的控制者下令。</p>
              <p>可在上方逐季推进或自动观战；切换观察势力不改变控制权。</p>
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
                        : adm.check(c.action);
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
                            {/* 标签是**给模型的**一整句，界面上原样摊出来就是一堵墙：
                                徽章已经说过的（缺口/可防守、升某档、倾国）在里面又重复
                                一遍，真正有用的（出多少兵、敌守军、地形守将、倾巢）
                                挤在同一行里读不出来。

                                这里只做**显示层的分段**：按 ｜ 切开、丢掉徽章已说过的段、
                                把倾巢挑出来当警示。不抠数值——这个文件反复写着
                                「谁也不许从 label 抠正则」，那条禁令针对的是抠错了会
                                静默读错的数；按分隔符切分最坏只是显示得难看，不会读错。

                                ** 是给模型读的强调（如「**天下共讨之**」），要剥掉 */}
                            {(() => {
                              // ｜ 与 ； 都是标签里的天然分隔：前者分「面向」，
                              // 后者分同一面向下的几件事（出兵／敌情／地形守将）
                              const segs = c.label.replace(/\*\*/g, "").split(/[｜；]/)
                                .map((x) => x.trim()).filter(Boolean);
                              // 首段是对这条令的复述（「自X征Y（倾国）：…」），
                              // 冒号前那截与标题、兵力徽章重复，去掉
                              if (segs[0]) segs[0] = segs[0].replace(/^[^：]{0,40}：/, "");
                              const dup = /^缺口.*可防守|^取下即升|^先野战/;
                              const keep = segs.filter((x) => x && !dup.test(x));
                              return (
                                <span className="act-detail">
                                  {keep.map((x, i) => (
                                    <span key={i}
                                      className={/^倾巢|^⚠|背盟|共讨/.test(x) ? "seg warn" : "seg"}>
                                      {x}
                                    </span>
                                  ))}
                                </span>
                              );
                            })()}
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
              <button className="go" onClick={submit} disabled={busy || Boolean(budgetMessage(game, session))}>
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
