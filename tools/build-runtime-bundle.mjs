// 浏览器端引擎所需的最小数据包。
//
// 引擎本身是纯函数，可以直接跑在客户端；但 lib/game/data 有 3.7MB，
// 单 officers.json 就 1MB——把全量数据塞进包里，玩家为了看一局要先下载
// 一堆本局用不到的东西（生卒年考订、renown 依据、锚点对照表）。
// 这里只留引擎真正读取的字段。
import fs from "node:fs";

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
  .sort((a, b) => a.id.localeCompare(b.id));

const bundle = {
  _note: "浏览器端引擎的最小数据包，由 tools/build-runtime-bundle.mjs 生成，勿手改。"
       + "史料判据与考订过程留在 lib/game/data 的全量文件里。",
  scenario: read("scenario-194.json"),
  commanderyState: read("commandery-state.json"),
  commanderies: commanderies.map((c) => ({
    id: c.id, name: c.name, zhou: c.zhou, seat: c.seat,
    longitude: c.longitude, latitude: c.latitude,
    households: c.households, population: c.population,
  })),
  adjacency: read("adjacency.json"),
  troopTypes: read("troop-types.json"),
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
