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
import { buildGraph, listActions, type Graph } from "@/lib/game/engine/actions.ts";
import { decide, PROFILES, type Profile } from "@/lib/game/engine/bot.ts";
import { buildRoster, type Roster } from "@/lib/game/engine/officers.ts";
import { observedGarrison, visibleLog, PUBLIC_EVENTS } from "@/lib/game/engine/intel.ts";
import { loadParams, type EngineParams } from "@/lib/game/engine/params.ts";
import { createGame, refreshAp } from "@/lib/game/engine/setup.ts";
import { resolve } from "@/lib/game/engine/resolve.ts";
import { buildGeography, briefFor, standingOf, GRADE_CN, type Geography }
  from "@/lib/game/engine/victory.ts";
import type { Candidate, GameState, Order } from "@/lib/game/engine/types.ts";

const BASE = "/game/map/play-base.webp";
// 放大后换高清一档。只有一张 1815 的话，k=6 是把它插值放大六倍，
// 越拉越糊——而底图本来就有 7260 的细节可用
const BASE_2X = "/game/map/play-base@2x.webp";
const HD_AT = 1.8;
const SEASON_CN = ["", "春", "夏", "秋", "冬"];
const TYPE_CN: Record<string, string> = {
  campaign: "征伐", relief: "赴援", withdraw: "撤围", muster: "集结",
  govern: "内政", appoint: "任命", scout: "刺探", ally: "外交",
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
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  const start = useCallback((factionId: string) => {
    if (!engine) return;
    const s = createGame(engine.data, {
      seed: `play-${factionId}-${Math.floor(Date.now() / 1000)}`,
      roster: engine.roster, geo: engine.geo,
    }, engine.P);
    setSeat(factionId); setGame(s); setPicked([]); setFlash({ mine: [], world: [] });
    // 开局把镜头放到自己治所上，而不是让人先在全图里找自己
    const cap = s.factions[factionId]?.capital;
    const p = cap ? engine.points.find((c) => c.id === cap) : null;
    setView(p ? centerOn(p.longitude, p.latitude, 2.4, MAP) : { k: 1, x: 0, y: 0 });
  }, [engine]);

  const candidates: Candidate[] = useMemo(() => {
    if (!engine || !game || !seat) return [];
    return listActions(game, seat, engine.G, engine.P, undefined, engine.roster,
      (id) => engine.nameOf.get(id) ?? id);
  }, [engine, game, seat]);

  const spent = useMemo(() => {
    const map = new Map(candidates.map((c) => [c.key, c]));
    return picked.reduce((n, k) => n + (map.get(k)?.cost ?? 0), 0);
  }, [candidates, picked]);

  const submit = useCallback(() => {
    if (!engine || !game || !seat) return;
    const byKey = new Map(candidates.map((c) => [c.key, c]));
    const orders: Order[] = picked
      .map((k) => byKey.get(k))
      .filter((c): c is Candidate => Boolean(c))
      .map((c) => ({ faction: seat, action: c.action }));

    const ids = Object.keys(game.factions).sort();
    for (const [i, f] of ids.entries()) {
      if (f === seat) continue;
      orders.push(...decide(game, f, engine.G, PROFILE_KEYS[i % PROFILE_KEYS.length],
        undefined, engine.roster, engine.P));
    }
    const before = game.log.length;
    const r = resolve(game, orders, engine.G, engine.P, engine.roster, engine.geo);
    // 一季全图能产生上百条事件，绝大多数是边地势力的补给消息。
    // 全铺出来等于把自己这一季的战况埋掉——只留我方的，与天下大事
    // 可见性由引擎定义（intel.ts 的 PUBLIC_EVENTS），不在这里另判一套——
    // 界面与模型观测若各判各的，人看到的和模型看到的就不是同一场战争
    const cn = (text: string) => text.replace(/[a-z]+/g, (m) => engine.nameOf.get(m) ?? m);
    const fresh = visibleLog(r.state, seat, before);
    // 我方与天下分栏。混在一起时，自己这一季打成什么样会被三十家的
    // 补给消息埋掉——那是最该第一眼看到的东西
    setFlash({
      mine: fresh.filter((e) => e.faction === seat).map((e) => cn(e.text)),
      world: fresh.filter((e) => e.faction !== seat && PUBLIC_EVENTS.has(e.kind))
        .map((e) => `${e.faction ? `${engine.nameOf.get(e.faction) ?? e.faction}：` : ""}${cn(e.text)}`),
    });
    setGame(r.state.finished ? r.state : refreshAp(r.state, engine.P));
    setPicked([]);
  }, [engine, game, seat, candidates, picked]);

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
  const brief = briefFor(game, engine.geo, seat, engine.G.adj, (id) => engine.nameOf.get(id) ?? id);
  const byType = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const cls = c.key.split(":")[0];
    if (!byType.has(cls)) byType.set(cls, []);
    byType.get(cls)!.push(c);
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
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
            setDragging(true);
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            const box = e.currentTarget.getBoundingClientRect();
            const lim = (n: number) => Math.min(0, Math.max(-(view.k - 1) * 100, n));
            setView((v) => ({
              ...v,
              x: lim(d.ox + ((e.clientX - d.x) / box.width) * 100),
              y: lim(d.oy + ((e.clientY - d.y) / box.height) * 100),
            }));
          }}
          onPointerUp={() => { dragRef.current = null; setDragging(false); }}
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
            {view.k < 2.2 && zhouMarks.map((m) => (
              <text key={m.z} className="zhou" x={m.x} y={m.y} textAnchor="middle"
                fontSize={62 / Math.sqrt(view.k)}>{m.z}</text>
            ))}
            {marks.map((m) => (
              <g key={m.c.id}
                className={`mark${m.mine ? " mine" : ""}${focus === m.c.id ? " focus" : ""}`}
                onMouseEnter={() => setFocus(m.c.id)} onMouseLeave={() => setFocus(null)}>
                <CityMark x={m.x} y={m.y} size={m.base * (focus === m.c.id ? 1.3 : 1)}
                  mine={m.mine} seat={m.isSeat} besieged={m.besieged}
                  fill={m.st.owner ? engine.colorOf.get(m.st.owner) ?? "#7a7266" : null} />
              </g>
            ))}
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
                    {game.commanderies[focus].governor
                      && `${"\u3000"}太守 ${engine.roster.byId.get(game.commanderies[focus].governor!)?.name}`}</span>
                </>
              ) : (
                <span>{engine.P.units[game.commanderies[focus].unit]?.name}
                  {"\u3000"}城防与内情不详</span>
              )}
            </div>
          )}
        </section>

        <aside className="panel">
          <pre className="brief">{brief}</pre>

          {game.finished ? (
            <div className="over">
              <h2>终局{"\u3000"}{GRADE_CN[me.bestGrade]} 档</h2>
              <p>十六季既尽。档位按本局曾达到过的最高档记。</p>
              <button onClick={() => { setGame(null); setSeat(null); }}>再来一局</button>
            </div>
          ) : (
            <>
              <div className="acts">
                {[...byType].sort((a, b) => a[0].localeCompare(b[0])).map(([cls, list]) => (
                  <details key={cls} open={cls === "campaign" || cls === "relief"}>
                    <summary>{TYPE_CN[cls] ?? cls}<i>{list.length}</i></summary>
                    {list.map((c) => {
                      const on = picked.includes(c.key);
                      const afford = on || c.cost <= me.ap - spent;
                      return (
                        <label key={c.key} className={`act${on ? " on" : ""}${afford ? "" : " off"}`}>
                          <input type="checkbox" checked={on} disabled={!afford}
                            onChange={() => setPicked((p) =>
                              on ? p.filter((k) => k !== c.key) : [...p, c.key])} />
                          <span>{c.label}</span>
                          <b>{c.cost === 0 ? "免费" : `${c.cost} 令`}</b>
                        </label>
                      );
                    })}
                  </details>
                ))}
                {!candidates.length && <p className="play-note">本季无可行之事。</p>}
              </div>
              <button className="go" onClick={submit}>
                封令结算（已选 {picked.length} 条，耗 {spent} 令）
              </button>
            </>
          )}

          {(flash.mine.length > 0 || flash.world.length > 0) && (
            <div className="flash">
              {flash.mine.length > 0 && (
                <>
                  <h3>上季战报<i>我方</i></h3>
                  <ul className="mine">{flash.mine.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {flash.world.length > 0 && (
                <>
                  <h3>天下大事</h3>
                  <ul>{flash.world.slice(-24).map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
