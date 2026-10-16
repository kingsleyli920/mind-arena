"use client";

// 汉末沙盘查看器：PixiJS v8 + 多级瓦片底图 + 实时标注层。
//
// 底图（地形晕渲、势力疆域、水系）切成 512px 瓦片按视口加载。
// 标注（郡国、关隘、渡口、州名）**不烤进底图**——烤进去就在所有缩放级别
// 固定大小固定密度，洛阳周边八个关津挤在 1.5 经度内必然重叠，且放大也不会
// 变松。《三国志》系列同样把地名放在 UI 层。这里标注是屏幕恒定字号，
// 按缩放分级显示，每次视口变化在屏幕空间做贪心避让。

import type { TerritoryGrid } from "@/lib/game/territory.ts";
import { useEffect, useRef, useState } from "react";
import type { Container, Graphics, Sprite, Text } from "pixi.js";
import { KIND_CN } from "@/lib/game/engine/actions.ts";

type Level = { z: number; width: number; height: number; cols: number; rows: number };
type Manifest = {
  tileSize: number; baseWidth: number; baseHeight: number; format?: string;
  levels: Level[]; geo: { west: number; east: number; south: number; north: number };
};
type Label = {
  id: string; kind: string; name: string; fullName: string;
  lon: number; lat: number; rank: number;
  zhou?: string; seat?: string; modernReference?: string;
  counties?: number | null; population?: number | null;
  factionId?: string | null; factionName?: string | null;
  control?: string | null; basis?: string | null;
  note?: string; nearestCommandery?: string; certainty?: string;
};
type Faction = { id: string; name: string; color?: string; seat?: string; situation?: string };
type LabelData = {
  geo: { west: number; east: number; south: number; north: number };
  baseWidth: number; baseHeight: number;
  /** 剧本名，由 tools/build-map-labels.mjs 从剧本的 meta.label 带出来 */
  era?: string | null;
  factions: Faction[];
  zhou: Array<{ name: string; lon: number; lat: number }>;
  labels: Label[];
};

const TILES = "/game/map/tiles";
const FONT = '"Songti SC", "STSong", "Source Han Serif SC", serif';

/** 每一档缩放放行到第几级标注。数越大显示越多，超出该级即隐藏。 */
function rankBudget(scale: number, fit: number): number {
  const z = scale / fit;                       // 相对「整幅可见」的倍数
  if (z < 1.35) return 1;
  if (z < 2.2) return 2;
  if (z < 3.6) return 3;
  return 4;
}

/**
 * 据点名从引擎的 KIND_CN 来，这里只补一个它没有的 `commandery`。
 *
 * 原先这里自己写了一份，而且**抄歪了三个值**：地图上管谷道叫「道」、港叫「港口」、
 * 仓叫「仓城」，而候选表、战报、以及模型读到的候选标签里是「谷道/港/仓」。
 * 同一个东西，产品里两个名字，两边都跑得好好的——对局页还有第三个（「粮仓」）。
 */
const KIND_LABEL: Record<string, string> = { commandery: "郡国", ...KIND_CN };

/**
 * 这一页画的是地图，而势力归属那一层是**某个剧本的**。地图两个剧本共用，
 * 叠在上面的色块与右栏的势力表不共用——原先整页写死兴平元年，加了建安五年
 * 之后，页头说「两剧本共用此图」而右栏仍只列 194 的三十一家，自相矛盾。
 * 与 /play 同一个口径：?scenario= 决定读哪一份标注，默认兴平元年。
 */
const SCENARIO = (() => {
  if (typeof window === "undefined") return "194";
  const v = new URLSearchParams(window.location.search).get("scenario");
  return v && /^\d{3,4}$/.test(v) ? v : "194";
})();

export function InkMapViewer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("正在载入沙盘…");
  const [hover, setHover] = useState<Label | null>(null);
  const [scaleLabel, setScaleLabel] = useState("");
  const [shown, setShown] = useState("");
  const [factions, setFactions] = useState<Array<Faction & { count: number }>>([]);
  // 旧的标注文件没有 era（是加第二个剧本那天才带上的），退回原值
  const [era, setEra] = useState("兴平元年");
  const [picked, setPicked] = useState<string | null>(null);
  // Pixi 循环里读的是 ref，避免每次选中都重建整个应用
  const pickedRef = useRef<string | null>(null);
  const relayoutRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const PIXI = await import("pixi.js");
      const [manifest, data] = await Promise.all([
        fetch(`${TILES}/manifest.json`).then((r) => r.json() as Promise<Manifest>),
        fetch(`/game/data/map-labels${SCENARIO === "194" ? "" : `-${SCENARIO}`}.json`)
          .then((r) => r.json() as Promise<LabelData>),
      ]);
      if (disposed) return;
      const host = hostRef.current;
      if (!host) return;

      const app = new PIXI.Application();
      await app.init({
        resizeTo: host, background: "#171410", antialias: true,
        resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true,
      });
      if (disposed) { app.destroy(true); return; }
      host.appendChild(app.canvas);

      const world = new PIXI.Container();        // 底图：随缩放变换
      const terr = new PIXI.Container();         // 疆域：随缩放变换，压在底图之上
      const overlay = new PIXI.Container();      // 标注：屏幕空间，不随缩放
      app.stage.addChild(world, terr, overlay);

      const { baseWidth, baseHeight, tileSize, levels, geo } = manifest;
      const EXT = manifest.format ?? "png";
      const topZ = levels.length - 1;

      const fitScale = () => Math.min(app.screen.width / baseWidth, app.screen.height / baseHeight);
      let scale = fitScale();
      let minScale = fitScale() * 0.92;
      const maxScale = 1.0;                      // 底图 1:1 即上限，再放大只是插值模糊
      let tx = (app.screen.width - baseWidth * scale) / 2;
      let ty = (app.screen.height - baseHeight * scale) / 2;

      const clamp = () => {
        scale = Math.min(maxScale, Math.max(minScale, scale));
        const w = baseWidth * scale, h = baseHeight * scale;
        tx = w <= app.screen.width ? (app.screen.width - w) / 2 : Math.min(0, Math.max(app.screen.width - w, tx));
        ty = h <= app.screen.height ? (app.screen.height - h) / 2 : Math.min(0, Math.max(app.screen.height - h, ty));
      };

      // ── 瓦片按需加载 ────────────────────────────────────────────────
      const live = new Map<string, Sprite>();
      let currentZ = -1;
      const pickLevel = () => {
        for (let z = 0; z <= topZ; z += 1) if (scale <= (levels[z].width / baseWidth) * 1.35) return z;
        return topZ;
      };
      async function syncTiles() {
        const z = pickLevel();
        const lv = levels[z];
        const k = baseWidth / lv.width;
        if (z !== currentZ) {
          for (const [key, sp] of live) { sp?.destroy(); live.delete(key); }
          world.removeChildren();
          currentZ = z;
        }
        const pad = tileSize * k;
        const cx0 = Math.max(0, Math.floor(((-tx / scale) - pad) / (tileSize * k)));
        const cx1 = Math.min(lv.cols - 1, Math.floor((((-tx + app.screen.width) / scale) + pad) / (tileSize * k)));
        const cy0 = Math.max(0, Math.floor(((-ty / scale) - pad) / (tileSize * k)));
        const cy1 = Math.min(lv.rows - 1, Math.floor((((-ty + app.screen.height) / scale) + pad) / (tileSize * k)));
        const need = new Set<string>();
        for (let j = cy0; j <= cy1; j += 1) for (let i = cx0; i <= cx1; i += 1) need.add(`${z}/${i}-${j}`);
        for (const [key, sp] of live) if (!need.has(key)) { sp?.destroy(); live.delete(key); }
        for (const key of need) {
          if (live.has(key)) continue;
          live.set(key, null as unknown as Sprite);
          const [ix, iy] = key.split("/")[1].split("-").map(Number);
          try {
            const tex = await PIXI.Assets.load(`${TILES}/z${z}/${ix}-${iy}.${EXT}`);
            if (disposed || currentZ !== z) { live.delete(key); continue; }
            const sp = new PIXI.Sprite(tex);
            sp.x = ix * tileSize * k; sp.y = iy * tileSize * k;
            sp.width = tex.width * k; sp.height = tex.height * k;
            world.addChild(sp);
            live.set(key, sp);
          } catch { live.delete(key); }
        }
      }

      // ── 疆域层 ──────────────────────────────────────────────────────
      // 底图改成中性地形后（势力色不再烤进栅格），这一页就看不出谁占哪儿了，
      // 而「群雄沙盘」正是为这个而存在。用与 /play 同一份 territory-grid 补上，
      // 两页共用一条疆域真相——此前底图是地形加权 chamfer、前端是欧氏最近邻，
      // 两套并存迟早对不上。
      try {
        const tg = await fetch("/game/territory-grid.json").then((r) => r.json() as Promise<TerritoryGrid>);
        const { cols, rows, none } = tg.meta;
        const bin = atob(tg.grid);
        const cv = document.createElement("canvas");
        cv.width = cols; cv.height = rows;
        const ctx = cv.getContext("2d");
        if (ctx) {
          const img = ctx.createImageData(cols, rows);
          const owner = new Map(data.labels
            .filter((l) => l.kind === "commandery")
            .map((l) => [l.id, l.factionId ?? null]));
          const rgbOf = new Map<string, [number, number, number]>();
          for (const f of data.factions) {
            const m = /^#?([0-9a-f]{6})$/i.exec(f.color ?? "");
            const n = m ? parseInt(m[1], 16) : 0x7a7266;
            rgbOf.set(f.id, [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
          }
          const order = tg.order;
          for (let i = 0; i < bin.length; i += 1) {
            const k = bin.charCodeAt(i);
            const o = i * 4;
            if (k === none) { img.data[o + 3] = 0; continue; }
            const f = owner.get(order[k]);
            if (!f || f === "wuzhu") { img.data[o + 3] = 0; continue; }
            const c = rgbOf.get(f) ?? [122, 114, 102];
            img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
            img.data[o + 3] = 96;
          }
          ctx.putImageData(img, 0, 0);
          const sp = new PIXI.Sprite(PIXI.Texture.from(cv));
          sp.width = baseWidth; sp.height = baseHeight;
          sp.blendMode = "multiply";
          terr.addChild(sp);
        }
      } catch { /* 疆域层缺失不影响看地形 */ }

      // ── 标注层：一次建好，之后只切换可见性与位置 ────────────────────
      const lon2wx = (lon: number) => ((lon - geo.west) / (geo.east - geo.west)) * baseWidth;
      const lat2wy = (lat: number) => ((geo.north - lat) / (geo.north - geo.south)) * baseHeight;
      const factionColor = new Map(data.factions.map((f) => [f.id, f.color ?? "#4a4235"]));
      {
        const cnt = new Map<string, number>();
        for (const l of data.labels) {
          if (l.kind === "commandery" && l.factionId) cnt.set(l.factionId, (cnt.get(l.factionId) ?? 0) + 1);
        }
        setEra(data.era ?? "兴平元年");
        setFactions(data.factions
          .map((f) => ({ ...f, count: cnt.get(f.id) ?? 0 }))
          .sort((a, b) => b.count - a.count));
      }

      // 州名压在最底，先加入
      const zhouTexts = data.zhou.map((z) => {
        const t = new PIXI.Text({
          text: z.name.split("").join(" "),
          style: { fontFamily: FONT, fontSize: 40, fill: 0x3a3126, letterSpacing: 2 },
        });
        t.alpha = 0.17; t.anchor.set(0.5);
        overlay.addChild(t);
        return { t, z };
      });

      type Entry = { d: Label; box: Container; txt: Text; ring: Graphics };
      const entries: Entry[] = [];
      // 先按级别、同级按人口降序 —— 决定避让时谁优先占位
      const sorted = [...data.labels].sort((a, b) =>
        a.rank - b.rank || (b.population ?? 0) - (a.population ?? 0));

      for (const d of sorted) {
        const box = new PIXI.Container();
        const isCity = d.kind === "commandery";
        const big = d.rank <= 1;
        const s = isCity ? (big ? 6.5 : 5) : 4.2;
        const col = d.factionId ? (factionColor.get(d.factionId) ?? "#4a4235") : "#4a4235";

        const ring = new PIXI.Graphics();          // 选中势力时的高亮环
        ring.circle(0, 0, s * 2.6).stroke({ width: 2.2, color: 0xf5e6b8, alpha: 0.95 });
        ring.visible = false;

        const g = new PIXI.Graphics();
        if (isCity) {
          if (big) g.rect(-s * 1.5, -s * 1.5, s * 3, s * 3).stroke({ width: 1.2, color: 0x241f18 });
          g.rect(-s, -s, s * 2, s * 2).fill(0xf2ead2).stroke({ width: 1.6, color: 0x241f18 });
          g.rect(-s * 0.46, -s * 0.46, s * 0.92, s * 0.92).fill(col);
        } else if (d.kind === "gate" || d.kind === "pass") {
          g.poly([-s, s * 0.8, 0, -s, s, s * 0.8]).fill(0xf2ead2).stroke({ width: 1.4, color: 0x5a3320 });
        } else {
          g.circle(0, 0, s * 0.8).fill(0xf2ead2).stroke({ width: 1.4, color: 0x2c4a52 });
        }

        const size = isCity ? (big ? 17 : 14) : 11.5;
        const txt = new PIXI.Text({
          text: d.name,
          style: {
            fontFamily: FONT, fontSize: size,
            fill: isCity ? 0x1c1811 : (d.kind === "ford" || d.kind === "port" ? 0x2c4a52 : 0x5a3320),
            stroke: { color: 0xf4ecd6, width: 3.4, join: "round" },
          },
        });
        txt.resolution = Math.min(2, window.devicePixelRatio || 1);

        box.addChild(ring, g, txt);
        box.eventMode = "static";
        box.cursor = "pointer";
        box.on("pointerover", () => setHover(d));
        box.on("pointerout", () => setHover((h) => (h?.id === d.id ? null : h)));
        box.visible = false;
        overlay.addChild(box);
        entries.push({ d, box, txt, ring });
      }

      /** 视口变化时重排：分级过滤 → 视口裁剪 → 屏幕空间贪心避让 */
      function layoutLabels() {
        const sel = pickedRef.current;
        const budget = rankBudget(scale, fitScale());
        const SW = app.screen.width, SH = app.screen.height;
        const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
        let visible = 0;

        // 州名先排，占位后城名再让 —— 州名是分区题记，不该被城名挤掉
        for (const { t, z } of zhouTexts) {
          t.x = lon2wx(z.lon) * scale + tx;
          t.y = lat2wy(z.lat) * scale + ty;
          const on = budget <= 2 && t.x > -60 && t.x < SW + 60 && t.y > -50 && t.y < SH + 50;
          if (!on) { t.visible = false; continue; }
          const w = t.width, h = t.height;
          const bx = t.x - w / 2, by = t.y - h / 2;
          if (boxes.some((b) => bx < b.x + b.w && bx + w > b.x && by < b.y + b.h && by + h > b.y)) {
            t.visible = false; continue;
          }
          boxes.push({ x: bx, y: by, w, h });
          t.visible = true;
        }

        // 选中势力的郡国优先占位，其余随后
        const order = sel == null ? entries
          : [...entries].sort((a, b) =>
              Number(b.d.factionId === sel) - Number(a.d.factionId === sel));
        for (const e of order) {
          const mine = sel != null && e.d.factionId === sel;
          // 选中势力时，其郡国无视分级一律显示，其余按常规分级
          if (!mine && e.d.rank > budget) { e.box.visible = false; continue; }
          const sx = lon2wx(e.d.lon) * scale + tx;
          const sy = lat2wy(e.d.lat) * scale + ty;
          if (sx < -60 || sx > SW + 60 || sy < -40 || sy > SH + 40) { e.box.visible = false; continue; }

          const w = e.txt.width, h = e.txt.height;
          const gap = e.d.kind === "commandery" ? 9 : 7;
          // 四个候选方位：右、左、上、下
          const cands: Array<[number, number]> = [
            [gap, -h / 2], [-gap - w, -h / 2], [-w / 2, -gap - h], [-w / 2, gap],
          ];
          let placed: [number, number] | null = null;
          for (const [ox, oy] of cands) {
            const bx = sx + ox, by = sy + oy;
            if (!boxes.some((b) => bx < b.x + b.w && bx + w > b.x && by < b.y + b.h && by + h > b.y)) {
              placed = [ox, oy]; boxes.push({ x: bx, y: by, w, h }); break;
            }
          }
          // 四面皆挤则文字暂不显示，放大后自然让出空间。
          // 但选中势力的高亮环不依赖文字排布 —— 环只标位置，不占版面，
          // 否则选中方有一半疆域看不出来。
          if (!placed) {
            if (!mine) { e.box.visible = false; continue; }
            e.box.visible = true; e.box.alpha = 1;
            e.ring.visible = true; e.txt.visible = false;
            e.box.x = sx; e.box.y = sy;
            boxes.push({ x: sx - 8, y: sy - 8, w: 16, h: 16 });
            visible += 1;
            continue;
          }

          e.box.visible = true;
          e.txt.visible = true;
          e.box.alpha = sel == null || mine ? 1 : 0.32;
          e.ring.visible = mine;
          e.box.x = sx; e.box.y = sy;
          e.txt.x = placed[0]; e.txt.y = placed[1];
          // 符号自身也占位，避免别人的文字压住城郭
          boxes.push({ x: sx - 8, y: sy - 8, w: 16, h: 16 });
          visible += 1;
        }
        setShown(` · ${visible}/${entries.length}`);
      }

      const apply = () => {
        clamp();
        world.position.set(tx, ty);
        world.scale.set(scale);
        terr.position.set(tx, ty);
        terr.scale.set(scale);
        setScaleLabel(`${Math.round(scale * 100)}%`);
        layoutLabels();
        void syncTiles();
      };

      // ── 交互 ────────────────────────────────────────────────────────
      let dragging = false, lastX = 0, lastY = 0;
      const canvas = app.canvas;
      const onDown = (e: PointerEvent) => {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing";
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        tx += e.clientX - lastX; ty += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        apply();
      };
      const onUp = (e: PointerEvent) => {
        dragging = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
        canvas.style.cursor = "grab";
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const wx = (px - tx) / scale, wy = (py - ty) / scale;
        scale *= Math.exp(-e.deltaY * 0.0016);
        clamp();
        tx = px - wx * scale; ty = py - wy * scale;
        apply();
      };
      canvas.style.cursor = "grab";
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });

      const ro = new ResizeObserver(() => {
        if (!host.clientWidth || !host.clientHeight) return;
        app.renderer.resize(host.clientWidth, host.clientHeight);
        minScale = fitScale() * 0.92;
        apply();
      });
      ro.observe(host);

      relayoutRef.current = () => { layoutLabels(); };
      apply();
      setStatus("");

      cleanup = () => {
        ro.disconnect();
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("wheel", onWheel);
        app.destroy(true, { children: true });
      };
    })().catch((err: Error) => setStatus(`载入失败：${err.message}`));

    return () => { disposed = true; cleanup(); };
  }, []);

  return (
    <div className="ink-map-shell">
      <div ref={hostRef} className="ink-map-host" />
      {status ? <div className="ink-map-status">{status}</div> : null}
      <div className="ink-map-scale">{scaleLabel}<span className="shown">{shown}</span></div>
      {hover ? (
        <div className="ink-map-card">
          <h3>{hover.fullName}<span className="kind">{KIND_LABEL[hover.kind] ?? hover.kind}</span></h3>
          <p className="card-sub">
            {[hover.zhou, hover.seat ? `治${hover.seat}` : null, hover.modernReference ? `今${hover.modernReference}` : null]
              .filter(Boolean).join(" · ")}
          </p>
          <dl>
            {hover.factionName ? (
              <div><dt>{era}</dt><dd>{hover.factionName}
                <span className="ctrl">
                  {hover.control === "firm" ? "实控" : hover.control === "contested" ? "争夺中" : "名义"}
                </span></dd></div>
            ) : null}
            {hover.counties != null ? <div><dt>属县</dt><dd>{hover.counties}</dd></div> : null}
            {hover.population != null ? (
              <div><dt>永和五年口</dt><dd>{hover.population.toLocaleString()}</dd></div>
            ) : null}
            {hover.nearestCommandery ? <div><dt>所属</dt><dd>{hover.nearestCommandery}</dd></div> : null}
          </dl>
          {hover.basis || hover.note ? <p className="card-basis">{hover.basis ?? hover.note}</p> : null}
        </div>
      ) : null}
      <div className="ink-map-hint">拖动平移 · 滚轮缩放 · 放大显示更多关津</div>
      <aside className="faction-panel">
        <header>
          {era} · {factions.length} 势力
          {picked ? <button type="button" onClick={() => { setPicked(null); pickedRef.current = null; relayoutRef.current(); }}>取消</button> : null}
        </header>
        <ul>
          {factions.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className={picked === f.id ? "on" : ""}
                onClick={() => {
                  const next = picked === f.id ? null : f.id;
                  setPicked(next); pickedRef.current = next; relayoutRef.current();
                }}
              >
                <i style={{ background: f.color ?? "#4a4235" }} />
                <span className="fname">{f.name}</span>
                <em>{f.count}</em>
              </button>
              {picked === f.id && f.situation ? <p className="fsit">{f.situation}</p> : null}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
