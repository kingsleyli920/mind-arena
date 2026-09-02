// 各郡的主力兵种。
//
// 内容包定义了步卒/骑兵/弓弩/水军四种，引擎却零引用——兵种是纯装饰。
// 接法选「兵种是郡的属性、不可更改」而非「募兵时选兵种」：
// 后者要在每个郡的内政候选上再乘四，违背 R13「模型做选择题」；
// 前者则把兵种变成争夺特定郡国的理由——想要骑兵就得打边郡，
// 想要水军就得拿沿江郡，与「在野武将按籍贯征辟」是同一种设计。
//
// 判据（先命中先用）：
//   1. 治所距长江水系（江、汉、淮、湘、赣）干流在本郡幅员之内，
//      或与邻郡之间隔着这些水系的渡口                      → 水军
//   2. 缘边诸州（凉、并、幽）                        → 骑兵
//   3. 通往邻郡之路半数以上是山地或关隘              → 弓弩
//   4. 其余                                          → 步卒
//
// 水军判据只取江汉淮水系，不含黄河：黄河诸津是渡口而非水战场，
// 若把黄河算进去，河南尹（雒阳）会被判成水军强郡，显然不合。
// 首版只按邻接图的 river 边判，因水系边只有 11 条而严重失真——
// 吴郡判成步卒、河南尹判成水军。改为水系几何求距为主、渡口为辅。
// 「幅员」不拍脑袋：相邻郡治间距中位数 158km，取其半 79km 为一郡自治所
// 向外的大致辐辏半径。
import fs from "node:fs";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));
const commanderies = read("commanderies.json");
const hydrology = read("hydrology.json");
const adjacency = read("adjacency.json");

// 缘边产马之州。《后汉书·西羌传》《乌桓鲜卑列传》所记诸边郡皆在其中
const HORSE_ZHOU = new Set(["凉州", "并州", "幽州"]);
const NAVY_RIVERS = new Set(["长江", "淮水", "汉水", "湘水", "赣水"]);
// 相邻郡治间距的中位数之半：一郡自治所向外的大致辐辏半径
const NAVY_KM = 79;

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]) * Math.cos(rad((a[1] + b[1]) / 2));
  return R * Math.hypot(dLat, dLon);
};

const rivers = hydrology.rivers.filter((r) => NAVY_RIVERS.has(r.name));
const nearestRiver = (lon, lat) => {
  let best = null;
  for (const r of rivers) {
    for (const p of r.points) {
      const d = dist([lon, lat], p);
      if (!best || d < best.km) best = { name: r.name, km: d };
    }
  }
  return best;
};

// 渡口佐证：与邻郡之间隔着这几条水系的，同样通舟师
const byFord = new Map();
for (const e of adjacency.edges) {
  const rs = (e.crossings ?? []).filter((r) => NAVY_RIVERS.has(r));
  if (!rs.length) continue;
  for (const id of [e.from, e.to]) {
    if (!byFord.has(id)) byFord.set(id, new Set());
    for (const r of rs) byFord.get(id).add(r);
  }
}

const byTerrain = new Map();
for (const e of adjacency.edges) {
  for (const id of [e.from, e.to]) {
    if (!byTerrain.has(id)) byTerrain.set(id, []);
    byTerrain.get(id).push(e.terrain);
  }
}

const out = commanderies.map((c) => {
  const near = nearestRiver(c.longitude, c.latitude);
  const ford = byFord.get(c.id);
  if (ford?.size) {
    return { id: c.id, unit: "navy",
             basis: `与邻郡隔${[...ford].sort().join("、")}，有津渡通舟师` };
  }
  if (near && near.km <= NAVY_KM) {
    return { id: c.id, unit: "navy",
             basis: `治所距${near.name}干流约 ${Math.round(near.km)} km，习水战` };
  }
  if (HORSE_ZHOU.has(c.zhou)) {
    return { id: c.id, unit: "cavalry", basis: `${c.zhou}缘边，畜牧之地，出骑` };
  }
  // 据险而射：山险之地车骑不得驰，其兵长于弓弩。
  // 《汉书·晁错传》「险道倾仄，且驰且射，中国之骑弗与也」言其地利；
  // 巴郡板楯、丹阳山越皆以劲弩闻
  const roads = byTerrain.get(c.id) ?? [];
  const rough = roads.filter((x) => x === "mountain" || x === "gate").length;
  if (roads.length && rough * 2 >= roads.length) {
    return { id: c.id, unit: "archer",
             basis: `通邻郡之道 ${roads.length} 条中 ${rough} 条为山险关隘，车骑不得驰，长于弓弩` };
  }
  return { id: c.id, unit: "infantry",
           basis: near ? `内郡，距最近干流（${near.name}）${Math.round(near.km)} km，道路平易，以步卒为主`
                       : "内郡，不缘边，以步卒为主" };
});

const tally = out.reduce((m, x) => ((m[x.unit] = (m[x.unit] ?? 0) + 1), m), {});
fs.writeFileSync("lib/game/data/troop-types.json", JSON.stringify({
  _note: "各郡主力兵种。判据见 tools/build-troop-types.mjs，每条带出处。"
       + "兵种不可更改，是争夺特定郡国的理由之一。",
  rule: `隔江汉淮湘赣有津渡、或治所距其干流 ≤${NAVY_KM}km → 水军；凉并幽缘边 → 骑兵；`
       + "通邻郡之道半数以上为山险关隘 → 弓弩；其余 → 步卒。"
       + "黄河不计——其诸津是渡口而非水战场，否则雒阳会被判成水军强郡",
  commanderies: out,
}, null, 1) + "\n");
console.log("→ lib/game/data/troop-types.json", JSON.stringify(tally));
