// 群雄沙盘（/game）的标注数据：郡国、据点、州名，以及**某个剧本的势力归属**。
//
//   node tools/build-map-labels.mjs        → map-labels.json（194）
//   node tools/build-map-labels.mjs 200    → map-labels-200.json
//
// 从 render-terrain-map.mjs 里拆出来的。原先它嵌在渲染地形底图那一步里，
// 而那一步要 283MB 的 DEM、跑几分钟——于是「换个剧本重算一遍势力归属」
// 这件本该一秒钟的事，代价是重烤整张图。底图与剧本无关，本就不该绑在一起。
//
// 底图尺寸**从瓦片清单读**，不在这里算。
//
// render-terrain-map.mjs 的每经度像素是 `PPD ?? 140`，而实际烤这张图时传的是 440
//（14520 / 33 经度 = 440）。我第一版在这里写死 440 猜对了，但那只是猜对——
// 换个 PPD 重烤一次，标注就会整体偏移，而且不会报错，只会歪。
// 清单是底图自己写下的事实，读它。
import fs from "node:fs";

export const GEO = { W_DEG: 94, E_DEG: 127, S_DEG: 16, N_DEG: 43 };
const MANIFEST = "public/game/map/tiles/manifest.json";
export function baseSize() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`没有 ${MANIFEST}——底图尺寸只能从它读，不能猜（先跑 npm run map:tiles）`);
  }
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (!m.baseWidth || !m.baseHeight) throw new Error(`${MANIFEST} 里没有 baseWidth/baseHeight`);
  return { W: m.baseWidth, H: m.baseHeight };
}

export function buildLabels(year = "194") {
  const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  const commanderies = read("lib/game/data/commanderies.json");
  const nodes = read("lib/game/data/strategic-nodes.json");
  const scenario = read(`lib/game/data/scenario-${year}.json`);

  const labels = [];
  for (const c of commanderies) {
    const own = scenario?.ownership?.[c.name];
    const pop = c.population ?? 0;
    labels.push({
      id: c.name, kind: "commandery", name: c.name.replace(/[郡国]$/, ""), fullName: c.name,
      lon: c.longitude, lat: c.latitude, zhou: c.zhou, seat: c.seat,
      modernReference: c.modernReference, counties: c.counties, population: c.population,
      // rank 决定在哪一级缩放开始显示：0 最先出现
      rank: pop > 1_500_000 ? 0 : pop > 800_000 ? 1 : pop > 300_000 ? 2 : 3,
      factionId: own?.factionId ?? null, factionName: own?.factionName ?? null,
      control: own?.control ?? null, basis: own?.basis ?? null,
    });
  }
  for (const n of nodes?.nodes ?? []) {
    labels.push({
      id: n.id, kind: n.kind, name: n.name, fullName: n.name,
      lon: n.longitude, lat: n.latitude,
      modernReference: n.modernReference, note: n.historicalNote,
      nearestCommandery: n.nearestCommandery, certainty: n.certainty,
      // 关隘比渡口重要，先显示
      rank: n.kind === "gate" ? 2 : n.kind === "pass" ? 3 : n.kind === "depot" ? 3 : 4,
    });
  }
  const zhouPts = {};
  for (const c of commanderies) (zhouPts[c.zhou] ??= []).push([c.longitude, c.latitude]);
  const zhou = Object.entries(zhouPts).map(([name, pts]) => ({
    name,
    lon: pts.reduce((a, p) => a + p[0], 0) / pts.length,
    lat: pts.reduce((a, p) => a + p[1], 0) / pts.length,
  }));

  const size = baseSize();
  return {
    geo: { west: GEO.W_DEG, east: GEO.E_DEG, south: GEO.S_DEG, north: GEO.N_DEG },
    baseWidth: size.W, baseHeight: size.H,
    era: scenario?.meta?.label ?? null,
    scenario: String(year),
    factions: (scenario?.factions ?? []).map((f) =>
      ({ id: f.id, name: f.name, color: f.color, seat: f.seat, situation: f.situation })),
    zhou, labels,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const year = process.argv[2] ?? "194";
  const out = buildLabels(year);
  const path = `public/game/data/map-labels${year === "194" ? "" : `-${year}`}.json`;
  fs.mkdirSync("public/game/data", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(out));
  const byRank = {};
  for (const l of out.labels) byRank[l.rank] = (byRank[l.rank] ?? 0) + 1;
  console.log(`${out.era}　标注 ${out.labels.length} 条（分级 `
    + `${Object.entries(byRank).sort().map(([k, v]) => `${k}:${v}`).join(" ")}）`
    + `+ ${out.zhou.length} 州 + ${out.factions.length} 势力 → ${path}`);
}
