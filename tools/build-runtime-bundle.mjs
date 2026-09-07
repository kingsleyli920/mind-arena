// 浏览器端引擎所需的最小数据包。
//
// 引擎本身是纯函数，可以直接跑在客户端；但 lib/game/data 有 3.7MB，
// 单 officers.json 就 1MB——把全量数据塞进包里，玩家为了看一局要先下载
// 一堆本局用不到的东西（生卒年考订、renown 依据、锚点对照表）。
// 这里只留引擎真正读取的字段。
import fs from "node:fs";
import { cmp } from "../lib/game/engine/cmp.ts";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));

const commanderies = read("commanderies.json");
const availability = read("officer-availability-194.json");
const ok = new Set(availability.officers.filter((x) => x.available).map((x) => x.id));

const officers = read("officers.json")
  .filter((o) => ok.has(o.id))
  .filter((o) => ["leadership", "might", "intellect", "politics", "charisma"]
    .every((k) => typeof o[k] === "number"))
  .map((o) => ({
    id: o.id, name: o.name,
    commandery: o.commandery ?? null,
    affiliation194: o.affiliation194 ?? null,
    leadership: o.leadership, might: o.might, intellect: o.intellect,
    politics: o.politics, charisma: o.charisma,
    aptitudes: o.aptitudes ?? [],
  }))
  .sort((a, b) => cmp(a.id, b.id));

const bundle = {
  _note: "浏览器端引擎的最小数据包，由 tools/build-runtime-bundle.mjs 生成，勿手改。"
       + "史料判据与考订过程留在 lib/game/data 的全量文件里。",
  scenario: read("scenario-194.json"),   // 含各方本年局势，选席界面要用
  commanderyState: read("commandery-state.json"),
  commanderies: commanderies.map((c) => ({
    id: c.id, name: c.name, zhou: c.zhou, seat: c.seat,
    longitude: c.longitude, latitude: c.latitude,
    households: c.households, population: c.population,
  })),
  adjacency: read("adjacency.json"),
  /**
   * 水系。**只带点，不带考据**——出处、别名、串接方法留在全量文件里。
   *
   * 为什么运行时要它：线是矢量的，可它此前只存在于烤好的底图里。
   * 底图再大也有个头（z4 是 14520，Retina 屏放到十四倍仍要拉伸 2.3 倍），
   * 而糊起来最扎眼的正是线——河岸、海岸这种一笔下去的边。
   * 带上这 4473 个点（约 90KB），线就能在任意倍数下重画一遍，永远是实的
   */
  hydrology: (() => {
    const h = read("hydrology.json");
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    return {
      coastline: h.coastline.map((seg) => seg.map(([lon, lat]) => [r4(lon), r4(lat)])),
      rivers: h.rivers.map((r) => ({
        name: r.name,
        points: r.points.map(([lon, lat]) => [r4(lon), r4(lat)]),
      })),
    };
  })(),
  // 关津港仓：图上画得出「这条路上卡着什么」，靠的是这 61 个据点的经纬度。
  // 只带画图要用的字段——史料出处、别名、今地对照留在 lib/game/data 的全量文件里，
  // 那些是给人考订用的，不必让每个浏览器都下一遍
  nodes: read("strategic-nodes.json").nodes.map((n) => ({
    id: n.id, name: n.name, kind: n.kind,
    longitude: n.longitude, latitude: n.latitude,
    at: n.nearestCommandery ?? null,
  })),
  troopTypes: read("troop-types.json"), resources: read("resources.json"),
  provinceSeats: read("province-seats-194.json"),
  // 名册与登场判定合成一张表，省掉一次交叉引用
  officers,
  pack: JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8")),
};

fs.mkdirSync("public/game", { recursive: true });
const out = "public/game/runtime-194.json";
fs.writeFileSync(out, JSON.stringify(bundle));
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`→ ${out}  ${kb}KB`);
console.log(`  郡国 ${bundle.commanderies.length}  势力 ${bundle.scenario.factions.length}`
  + `  边 ${bundle.adjacency.edges.length}  武将 ${officers.length}`);
