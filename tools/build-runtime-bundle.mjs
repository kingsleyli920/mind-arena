// 浏览器端引擎所需的最小数据包。
//
// 引擎本身是纯函数，可以直接跑在客户端；但 lib/game/data 有 3.7MB，
// 单 officers.json 就 1MB——把全量数据塞进包里，玩家为了看一局要先下载
// 一堆本局用不到的东西（生卒年考订、renown 依据、锚点对照表）。
// 这里只留引擎真正读取的字段。
import fs from "node:fs";
import { cmp } from "../lib/game/engine/cmp.ts";

const read = (f) => JSON.parse(fs.readFileSync(`lib/game/data/${f}`, "utf8"));

// 剧本由年份选。默认 194——`node tools/build-runtime-bundle.mjs 200` 出另一份。
const YEAR = Number(process.argv[2] ?? 194);

const commanderies = read("commanderies.json");
const scenario = read(`scenario-${YEAR}.json`);
const availability = read(`officer-availability-${YEAR}.json`);
// 在任表是按「年 + 月」算的（建安五年正月与岁末差着颜良文丑沮授淳于琼孙策），
// 而它与剧本是两个文件、两次生成。切片对不上就等于名册错了一整台戏，
// 所以在这里钉死——这正是本仓库「四方对账」里最容易漏的那一方
if (availability.year !== scenario.meta.year || availability.month !== scenario.meta.month) {
  throw new Error(
    `在任表的切片是 ${availability.year} 年 ${availability.month} 月，`
    + `而剧本是 ${scenario.meta.year} 年 ${scenario.meta.month} 月——`
    + `重跑 node tools/build-officer-availability.mjs ${scenario.meta.year} ${scenario.meta.month}`);
}
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
  scenario,                              // 含各方本年局势，选席界面要用
  commanderyState: read(`commandery-state${YEAR === 194 ? "" : `-${YEAR}`}.json`),
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
  provinceSeats: read(`province-seats-${YEAR}.json`),
  // 名册与登场判定合成一张表，省掉一次交叉引用
  officers,
  // 规则包一份，剧本多份。包里有三处是**剧本事实**而非规则——天子所在之郡、
  // 据此写成的授官前置条件、以及剧本标签。它们原本写死在 pack-194.json 里，
  // 于是一份规则包只配得上一个剧本。这里按剧本申报的 courtSeat 改写，
  // 规则数值一个不动（指纹只取数字，这三处都是字符串）。
  pack: (() => {
    const pack = JSON.parse(fs.readFileSync("lib/game/content/pack-194.json", "utf8"));
    const seat = scenario.meta.courtSeat;
    if (!seat) throw new Error(`scenario-${YEAR}.json 的 meta 没有 courtSeat——天子在哪个郡是剧本必须申报的`);
    if (!commanderies.some((c) => c.name === seat)) {
      throw new Error(`courtSeat「${seat}」不是 commanderies.json 里的郡国`);
    }
    pack.scenario = scenario.meta.label;
    pack.constants["名器"]["朝廷所在"] = seat;
    const invest = pack.actions.find((a) => a.id === "invest");
    if (!invest) throw new Error("规则包里找不到授官令（invest）");
    invest.preconditions[0] = `须据${seat}（朝廷所在）`;
    return pack;
  })(),
};

fs.mkdirSync("public/game", { recursive: true });
const out = `public/game/runtime-${YEAR}.json`;
fs.writeFileSync(out, JSON.stringify(bundle));
// 剧本目录：扫一遍 lib/game/data/scenario-*.json，供选席页列出可玩的剧本。
// 每建一份包都重扫全量，省得目录与实际有的包对不上
{
  const list = fs.readdirSync("lib/game/data")
    .map((f) => /^scenario-(\d+)\.json$/.exec(f))
    .filter(Boolean)
    .map((m) => ({ id: m[1], meta: JSON.parse(fs.readFileSync(`lib/game/data/${m[0]}`, "utf8")).meta }))
    .filter((x) => fs.existsSync(`public/game/runtime-${x.id}.json`))
    .map((x) => ({
      id: x.id, year: x.meta.year, era: x.meta.era, label: x.meta.label,
      factions: x.meta.factionCount, commanderies: x.meta.commanderyCount,
      // 选席页只要一句话，完整的切片说明留在 scenario-*.json 里
      blurb: String(x.meta.note).split("。")[0] + "。",
    }))
    .sort((a, b) => a.year - b.year);
  fs.writeFileSync("public/game/scenarios.json", JSON.stringify({
    _note: "可玩剧本目录，由 tools/build-runtime-bundle.mjs 扫出，勿手改。",
    scenarios: list,
  }, null, 1));
  console.log(`  剧本目录 ${list.map((x) => `${x.id}(${x.era})`).join(" ")}`);
}
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`→ ${out}  ${kb}KB`);
console.log(`  郡国 ${bundle.commanderies.length}  势力 ${bundle.scenario.factions.length}`
  + `  边 ${bundle.adjacency.edges.length}  武将 ${officers.length}`);
