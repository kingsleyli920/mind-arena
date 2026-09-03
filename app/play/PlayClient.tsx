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
import { admit } from "@/lib/arena/seat/admit.ts";
import { GRADE_SCORE } from "@/lib/arena/scoring.ts";
import { save as saveGame, load as loadGame, clear as clearSave, packStamp,
  type SavedGame } from "@/lib/game/save.ts";
import { loadParams, type EngineParams } from "@/lib/game/engine/params.ts";
import { createGame, refreshAp } from "@/lib/game/engine/setup.ts";
import { resolve, supplyReach } from "@/lib/game/engine/resolve.ts";
import { buildGeography, briefFor, standingOf, GRADE_CN, type Geography }
  from "@/lib/game/engine/victory.ts";
import type { Action, Candidate, GameState, Order } from "@/lib/game/engine/types.ts";

const BASE = "/game/map/play-base.webp";
// 放大后换高清一档。只有一张 1815 的话，k=6 是把它插值放大六倍，
// 越拉越糊——而底图本来就有 7260 的细节可用
const BASE_2X = "/game/map/play-base@2x.webp";
const HD_AT = 1.8;
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
    case "appoint": return `调 ${officerOf(a.officer)} 驻 ${a.at}`;
    case "scout": return `刺探 ${a.at}`;
    case "ally": return a.act === "form" ? `与${nameOf(a.to)}缔盟` : `与${nameOf(a.to)}绝盟`;
    case "passage": return `许${nameOf(a.to)}借道`;
    case "retire": return "归隐";
    default: return "";
  }
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

const PANEL_ORDER = ["relief", "withdraw", "campaign", "muster", "govern",
                     "appoint", "scout", "ally", "passage", "retire"];

const TYPE_CN: Record<string, string> = {
  campaign: "征伐", relief: "赴援", withdraw: "撤围", muster: "集结",
  govern: "内政", appoint: "调任", scout: "刺探", ally: "外交",
  passage: "借道", retire: "归隐",
};

type Bundle = {
  scenario: { factions: Array<{ id: string; name: string; color?: string; seat?: string;
                               courtesyName?: string; situation?: string }> };
  commanderyState: unknown; commanderies: Array<{ id: string; name: string; zhou: string;
    longitude: number; latitude: number }>;
  adjacency: unknown; troopTypes: unknown; provinceSeats: unknown;
  officers: unknown[]; pack: unknown;
};
type Territory = {
  meta: { west: number; north: number; cellSize: number; cols: number; rows: number; none: number };
  order: string[]; grid: string;
};

type MapPoint = {
  id: string; name: string; zhou: string;
  longitude: number; latitude: number;
  households?: number | null; population?: number | null;
};

/**
 * 势力色提纯。剧本给的三十一种颜色都是土色系（配合墨底地图取的），
 * 彼此难分，需要拉开。
 *
 * 提纯幅度是配着底图定的：底图改成纸底后平均明度从 0.61 升到 0.81，
 * 而疆域是正片叠底，输出正比于底图亮度——同样的系数在新底图上会过冲成
 * 糖果色。故从 s×2.2 收到 s×1.5，亮度上限相应抬高。
 */
function vivid(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  let l = (max + min) / 2;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  s = Math.min(1, s * 1.5 + 0.10);
  l = Math.min(0.74, Math.max(0.46, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h * 6) % 6;
  const [rr, gg, bb] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)];
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
 * 以视野中心为锚点缩放。按 (0,0) 缩放的话，每按一次加号都往左上角跑，
 * 想看的地方反而离开视野。
 */
function zoomAt(v: { k: number; x: number; y: number }, mul: number) {
  const k = Math.min(6, Math.max(1, v.k * mul));
  const lim = (n: number) => Math.min(0, Math.max(-(k - 1) * 100, n));
  // 视野中心在图上的归一化位置，缩放前后保持不变
  const cx = (0.5 - v.x / 100) / v.k;
  const cy = (0.5 - v.y / 100) / v.k;
  return { k, x: lim((0.5 - cx * k) * 100), y: lim((0.5 - cy * k) * 100) };
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
 * 这里按等级画不同的城：州治是重城带旌旗，大郡是双阙，寻常郡是单垣。
 * 无主之城不填色，只留墨廓。
 */
function CityMark({ x, y, size, fill, mine, seat: isSeat, besieged }: {
  x: number; y: number; size: number; fill: string | null;
  mine: boolean; seat: boolean; besieged: boolean;
}) {
  const w = size, h = size * 0.78;
  const l = x - w / 2, r = x + w / 2, b = y + h / 2, tp = y - h / 2;
  const notch = w / 7;
  // 垛口：城头三个凹口
  const crown = [
    `M ${l} ${b}`, `L ${l} ${tp + notch}`,
    `L ${l + notch} ${tp + notch}`, `L ${l + notch} ${tp}`,
    `L ${l + notch * 2.2} ${tp}`, `L ${l + notch * 2.2} ${tp + notch}`,
    `L ${r - notch * 2.2} ${tp + notch}`, `L ${r - notch * 2.2} ${tp}`,
    `L ${r - notch} ${tp}`, `L ${r - notch} ${tp + notch}`,
    `L ${r} ${tp + notch}`, `L ${r} ${b}`, "Z",
  ].join(" ");
  return (
    <g className="city">
      {/* 纸色衬底：城印落在斑驳的地形上，没有衬底就糊成一团 */}
      <ellipse cx={x} cy={y + h * 0.06} rx={w * 0.82} ry={h * 0.86} className="city-halo" />
      {besieged && (
        <circle cx={x} cy={y} r={w * 1.15} className="siege-ring" />
      )}
      <path d={crown} fill={fill ?? "rgba(252,249,242,0.9)"}
        stroke="#2b251e" strokeWidth={size * (mine ? 0.105 : 0.068)} strokeLinejoin="miter" />
      {/* 城门 */}
      <path d={`M ${x - notch * 0.8} ${b} L ${x - notch * 0.8} ${y + h * 0.06}
                 A ${notch * 0.8} ${notch * 0.8} 0 0 1 ${x + notch * 0.8} ${y + h * 0.06}
                 L ${x + notch * 0.8} ${b} Z`}
        fill="#332d25" opacity={0.72} />
      {isSeat && (
        <>
          {/* 州治：城上立旗 */}
          <line x1={x} y1={tp} x2={x} y2={tp - h * 0.62} stroke="#332d25" strokeWidth={size * 0.06} />
          <path d={`M ${x} ${tp - h * 0.62} L ${x + w * 0.42} ${tp - h * 0.44}
                     L ${x} ${tp - h * 0.26} Z`} fill="#8c3b2f" />
        </>
      )}
    </g>
  );
}

interface Engine {
  P: EngineParams; G: Graph; roster: Roster; geo: Geography;
  colorOf: Map<string, string>; nameOf: Map<string, string>;
  lore: Map<string, { courtesyName?: string; situation?: string }>;
  data: Parameters<typeof createGame>[0];
  /** 画点用的经纬度。SetupData 里的 commanderies 只声明 id/name */
  points: MapPoint[];
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
  const [hdReady, setHdReady] = useState(false);
  useEffect(() => {
    if (view.k < HD_AT || hdReady) return;
    const im = new Image();
    im.onload = () => setHdReady(true);
    im.src = BASE_2X;
  }, [view.k, hdReady]);
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
          P, G, roster, geo,
          colorOf: new Map(b.scenario.factions.map((f) => [f.id, f.color ?? "#7a7266"])),
          nameOf: new Map(b.scenario.factions.map((f) => [f.id, f.name])),
          lore: new Map(b.scenario.factions.map((f) =>
            [f.id, { courtesyName: f.courtesyName, situation: f.situation }])),
          points: b.commanderies,
          data: {
            commanderyState: b.commanderyState as never,
            scenario: b.scenario as never,
            commanderies: b.commanderies,
            troopTypes: b.troopTypes as never,
          },
        });
        setResume(loadGame(packStamp(P.seasonsPerGame, b.commanderies.length, P.epochCount)));
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
    if (game.finished) { clearSave(); return; }   // 打完了就没什么可继续的
    saveGame({
      packStamp: packStamp(engine.P.seasonsPerGame, engine.points.length, engine.P.epochCount),
      seat, game, picked,
    });
  }, [engine, game, seat, picked]);

  const start = useCallback((factionId: string) => {
    if (!engine) return;
    const s = createGame(engine.data, {
      seed: `play-${factionId}-${Math.floor(Date.now() / 1000)}`,
      roster: engine.roster, geo: engine.geo,
    }, engine.P);
    clearSave(); setResume(null);
    setSeat(factionId); setGame(s); setPicked([]); setFlash({ mine: [], world: [] }); setFlips([]);
    // 开局把镜头放到自己治所上，而不是让人先在全图里找自己
    const cap = s.factions[factionId]?.capital;
    const p = cap ? engine.points.find((c) => c.id === cap) : null;
    setView(p ? centerOn(p.longitude, p.latitude, 2.4, MAP) : { k: 1, x: 0, y: 0 });
  }, [engine]);

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

  const submit = useCallback(() => {
    if (!engine || !game || !seat) return;
    const orders: Order[] = admit(game, seat, picked, candidates,
      engine.G, engine.roster).orders;

    const ids = Object.keys(game.factions).sort();
    for (const [i, f] of ids.entries()) {
      if (f === seat) continue;
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
  }, [engine, game, seat, candidates, picked, cnText]);

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
    for (const [id, hex] of engine.colorOf) rgb.set(id, vivid(hex));

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
          <p>兴平元年·一九四{"\u3000"}择一席入局。十六季后按<b>相对开局的增量</b>定档——
            守成不得分，多控一州或多据一州治方入乙档。</p>
        </header>
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
                  {"\u3000"}第 {resume.game.turn + 1}/{engine.P.seasonsPerGame} 季
                  {"\u3000"}{owned} 郡（开局 {f?.startCommanderies ?? "?"}）
                  {"\u3000"}{GRADE_CN[f?.bestGrade ?? "ding"]} 档</span>
              </div>
              <button onClick={() => {
                setSeat(resume.seat); setGame(resume.game); setPicked(resume.picked);
                setFlash({ mine: [], world: [] }); setFlips([]);
                const cap = resume.game.factions[resume.seat]?.capital;
                const p = cap ? engine.points.find((c) => c.id === cap) : null;
                setView(p ? centerOn(p.longitude, p.latitude, 2.4, MAP) : { k: 1, x: 0, y: 0 });
                setResume(null);
              }}>继续</button>
              <button className="ghost" onClick={() => { clearSave(); setResume(null); }}>
                弃掉，重开
              </button>
            </div>
          );
        })()}
        <ul className="seat-grid">
          {seats.map(({ f, n, st }) => (
            <li key={f.id}>
              <button onClick={() => start(f.id)} style={{ "--c": engine.colorOf.get(f.id) } as React.CSSProperties}>
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
      // 按缩放的平方根衰减。完全跟着放大会成巨幅贴纸，完全屏幕恒定又
      // 让「放大是为了看清」落空——取半衰：放大三倍，图元长到约 1.7 倍
      base: (isSeat ? 36 : hh > 150000 ? 30 : hh > 60000 ? 25 : 21) / Math.sqrt(view.k),
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
      const size = (m.isSeat ? 25 : 21) / Math.sqrt(view.k);
      const w = m.c.name.length * size * 1.02, h = size * 1.3;
      const x = m.x - w / 2, y = m.y + m.base * 0.62 + 4 / Math.sqrt(view.k);
      const box: [number, number, number, number] = [x, y, w, h];
      const hit = placed.some(([px, py, pw, ph]) =>
        x < px + pw && x + w > px && y < py + ph && y + h > py);
      if (hit && focus !== m.c.id) return null;
      placed.push(box);
      return { id: m.c.id, name: m.c.name, x: m.x, y: y + size, size, w: w + 8 / Math.sqrt(view.k),
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

  // ── 终局要用的三样：年表、名将去向、天下排名 ──────────────────────
  // 一局十六季，只报一个档位等于什么都没留下
  const BIG = new Set(["siege-win", "siege-lift", "siege-abort", "officer-captured",
    "besieged", "capital-lost", "field-win", "field-fail", "relief", "retire", "eliminated"]);
  const chronicle = game.log
    .filter((e) => e.faction === seat && BIG.has(e.kind))
    .map((e) => ({
      // SEASON_CN 是 1-based（["", "春", "夏", "秋", "冬"]），而 turn 从 0 起。
      // 直接取 turn % 4 会整体差一季，年表上每条都错标
      when: `${Math.floor(e.turn / 4) + 194} · ${SEASON_CN[(e.turn % 4) + 1]}`,
      text: cnText(e.text),
    }));
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
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  const rank = { at: Math.max(1, byLand.findIndex((x) => x.id === seat) + 1),
                 of: byLand.length };

  const brief = briefFor(game, engine.geo, seat, engine.G.adj, (id) => engine.nameOf.get(id) ?? id);

  const centerOnId = (id: string) => {
    const p = engine.points.find((c) => c.id === id);
    if (p) setView(centerOn(p.longitude, p.latitude, 3.2, MAP));
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
    .sort((a, b) => Number(b.warn) - Number(a.warn) || a.c.id.localeCompare(b.c.id));
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
                      || a.key.localeCompare(b.key));
  }

  return (
    <main className="play">
      <header className="play-head play-bar">
        <span className="era">{game.year} 年 · {SEASON_CN[game.season]}{"\u3000"}第 {game.turn + 1}/16 季{"\u3000"}
          纪元 {game.epoch}</span>
        <span className="who" style={{ "--c": engine.colorOf.get(seat) } as React.CSSProperties}>
          {engine.nameOf.get(seat)}
        </span>
        <span className="ap">令数 {me.ap - spent}/{me.ap}{"\u3000"}现档 {GRADE_CN[me.bestGrade]}</span>
      </header>

      <div className="play-body">
        <section
          className="map-wrap"
          onWheel={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const px = (e.clientX - box.left) / box.width;
            const py = (e.clientY - box.top) / box.height;
            setView((v) => {
              const k = Math.min(6, Math.max(1, v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
              // 以指针为锚点缩放，否则放大时目标会跑出视野
              const x = px - ((px - v.x / 100) * k) / v.k;
              const y = py - ((py - v.y / 100) * k) / v.k;
              const lim = (n: number) => Math.min(0, Math.max(-(k - 1), n));
              return { k, x: lim(x) * 100, y: lim(y) * 100 };
            });
          }}
          onPointerDown={(e) => {
            if (view.k <= 1) return;
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
          {/* 本地静态底图，尺寸固定且已压成 webp；套 next/image 只会多一层
              运行时开销与配置，不换来任何优化 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hdReady && view.k >= HD_AT ? BASE_2X : BASE} alt="汉末地形" />
          <canvas ref={canvasRef} />
          <svg viewBox={`0 0 ${MAP.w} ${MAP.h}`}>
            <defs>
              <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {view.k < 2.2 && zhouMarks.map((m) => (
              <text key={m.z} className="zhou" x={m.x} y={m.y} textAnchor="middle"
                fontSize={62 / Math.sqrt(view.k)}>{m.z}</text>
            ))}
            {arrows.map((ar) => (ar.sortie ? (
              // 出城迎战：起点即目标，画一圈而不是一条线
              <circle key={ar.key} className={`sortie${ar.on ? " on" : ""}`}
                cx={ar.a.x} cy={ar.a.y} r={30 / Math.sqrt(view.k)} />
            ) : (
              <line key={ar.key} className={`arrow${ar.on ? " on" : ""}`}
                x1={ar.a.x} y1={ar.a.y} x2={ar.b.x} y2={ar.b.y}
                strokeWidth={5 / Math.sqrt(view.k)} markerEnd="url(#arrowhead)" />
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
                <circle cx={m.x} cy={m.y} r={Math.max(m.base * 0.9, 26 / Math.sqrt(view.k))}
                  fill="transparent" />
                <CityMark x={m.x} y={m.y} size={m.base * (focus === m.c.id ? 1.3 : 1)}
                  mine={m.mine} seat={m.isSeat} besieged={m.besieged}
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
                  cx={x} cy={y} r={44 / Math.sqrt(view.k)} />
              );
            })}
            {/* 围城旗：城下有谁、围了几季、多少人。只有一个虚线圈看不出这些，
                而这三样正是「要不要去救」的全部依据 */}
            {game.armies.filter((a) => a.target).map((a) => {
              const p = engine.points.find((c) => c.id === a.target);
              if (!p) return null;
              const x = (p.longitude - MAP.west) * MAP.ppd;
              const y = (MAP.north - p.latitude) * MAP.ppd;
              const s = 30 / Math.sqrt(view.k);
              const mine = a.faction === seat;
              return (
                <g key={a.id} className="siege-flag" transform={`translate(${x + s * 0.75} ${y - s * 0.5})`}>
                  <line x1={0} y1={0} x2={0} y2={-s * 1.15} stroke="#2b251e"
                    strokeWidth={s * 0.055} />
                  <path d={`M 0 ${-s * 1.15} L ${s * 0.78} ${-s * 0.92} L 0 ${-s * 0.7} Z`}
                    fill={engine.colorOf.get(a.faction) ?? "#7a7266"}
                    stroke="#2b251e" strokeWidth={s * 0.04} />
                  <text x={s * 0.16} y={-s * 0.2} fontSize={s * 0.4}
                    className={mine ? "mine" : undefined}>
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
            <span>{game.year === 194 ? "興平元年" : `${game.year} 年`}</span>
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

          <div className="zoom">
            <button onClick={() => setView((v) => zoomAt(v, 1.4))}>＋</button>
            <button onClick={() => setView({ k: 1, x: 0, y: 0 })}>全图</button>
            <button onClick={() => setView((v) => zoomAt(v, 1 / 1.4))}>－</button>
          </div>
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
                  <th>将</th><th>状况</th></tr>
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

          {game.finished ? (
            <div className="over">
              <h2>终局{"\u3000"}{GRADE_CN[me.bestGrade]} 档{"\u3000"}
                <b>{GRADE_SCORE[me.bestGrade]} 分</b>
                <u>天下第 {rank.at}/{rank.of}</u></h2>
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
                <summary>十六季年表<i>{chronicle.length} 事</i></summary>
                <ol className="chron">
                  {chronicle.map((e, i) => (
                    <li key={i}><b>{e.when}</b><span>{e.text}</span></li>
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
                    ...chronicle.map((e) => `${e.when}\u3000${e.text}`),
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
              <button className="go" onClick={submit} disabled={!picked.length}>
                封令结算 · {picked.length} 条 · 耗 {spent}/{me.ap} 令
                {picked.length > 0 && spent < me.ap
                  && <i>尚余 {me.ap - spent} 令，只结转 {engine.P.carryCap}</i>}
              </button>
            </>
          )}

        </aside>
      </div>
    </main>
  );
}
