/**
 * 郡国物产：定各郡能建哪些**特殊建筑**的判据。
 *
 * 为什么要有出处：这个仓库每一份数据都带判据——兵种（troop-types.json 每条有
 * basis）、郡治（《郡国志》体例「凡县名先书者，郡所治也」）、邻接（沿边采样地形
 * 网格定档）。物产没有理由例外，否则「哪个郡值得抢」就成了我拍的。
 *
 * 四类物产，判据各不相同，强弱要说清：
 *
 *   铁　《续汉书·郡国志》县下明文「有铁」。这是记铁官的定式，**逐条可核**，
 *       最硬的一类。25 郡。
 *   盐　三源：池盐取《郡国志》明文「有盐池」（河东，即解池）；井盐取蜀郡、
 *       犍为（四川盆地井盐核心区，史有明载）；海盐按治所距海岸线取，
 *       与项目定水军「距干流 ≤79km」同一套方法。
 *       《汉书·地理志》记天下 36 盐官分布 27 郡，而《郡国志》只录「中兴以来
 *       郡县改异」故不载——所以这一类是**地理推定**，不是明文。
 *   马　边郡六牧师苑：陇西、天水（东汉改汉阳）、安定、北地、上郡、西河。
 *       出《汉书·百官公卿表》；《汉仪注》记「牧师诸苑三十六所，分布北边西边」。
 *   屯　通邻郡之道半数以上为平原者可屯田。与兵种「半数以上为山险关隘 → 弓弩」
 *       同一套判据形状。曹操建安元年许下屯田，《置屯田令》曰「定国之术，
 *       在于强兵足食」，其前提是荒芜的可耕之地——平原正是。
 *
 * 缺口必须写在数据里：郡国志县下注文详略极不均，「有铁」没写不等于没有铁。
 * 本表的正确读法是「**有据可依的所在**」，不是「全图分布」。
 *
 *   node tools/build-resources.mjs          抽取并打印
 *   node tools/build-resources.mjs --write  写入 lib/game/data/resources.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "lib/game/data", f), "utf8"));
const RAW = read("junguozhi-raw.json");
const COMS = read("commanderies.json");
const HYDRO = read("hydrology.json");
const ADJ = read("adjacency.json");

// ── 与 parse-junguozhi.mjs 同一套郡界识别 ──────────────────────────────
const D = "[零一二三四五六七八九十百千万]";
const NAME = /^(?:.{1,3}(?:郡|尹)|.{1,3}国|右扶风|左冯翊|.{2,5}属国)$/;
const NOT_COMMANDERY = new Set(["侯国", "父国", "公国", "龟兹属国"]);
const split = [];
for (const juan of RAW) for (const p of juan.paras) split.push(p);

const textOf = new Map();
{
  let cur = null;
  for (let i = 0; i < split.length; i += 1) {
    const p = split[i];
    if (NAME.test(p) && !NOT_COMMANDERY.has(p)) {
      const win = [1, 2, 3].map((k) => split[i + k] || "").join("‖");
      if (new RegExp(`^(${D}+)城`).test(win) || new RegExp(`户(${D}+)`).test(win)
          || p.endsWith("属国")) { cur = p; textOf.set(cur, []); continue; }
    }
    if (cur) textOf.get(cur).push(p);
  }
}

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const km = (a, b, c, d) => {
  const dLat = rad(c - a), dLon = rad(d - b);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
/** 治所到海岸线的最近距离。与项目定水军「距干流」同一种度量 */
const SEA_KM = 80;
function seaDist(lat, lon) {
  let best = Infinity;
  for (const line of HYDRO.coastline) for (const [plon, plat] of line) {
    const d = km(lat, lon, plat, plon);
    if (d < best) best = d;
  }
  return best;
}

/** 六牧师苑。天水郡东汉改称汉阳郡 */
const HORSE = new Map([
  ["陇西郡", "边郡六牧师苑之一（《汉书·百官公卿表》）"],
  ["汉阳郡", "即西汉天水郡，边郡六牧师苑之一（《汉书·百官公卿表》）"],
  ["安定郡", "边郡六牧师苑之一；北地、安定诸苑有堵苑、白马苑"],
  ["北地郡", "边郡六牧师苑之一；归德有堵苑、白马苑"],
  ["上郡", "边郡六牧师苑之一"],
  ["西河郡", "边郡六牧师苑之一；鸿门有天封苑"],
]);
/** 井盐核心区 */
const WELL_SALT = new Map([
  ["蜀郡", "蜀中井盐，临邛盐井最著"],
  ["犍为郡", "犍为井盐，汉世置盐官"],
]);

/** 各郡通邻郡之道的地形构成 */
const terrainOf = new Map();
for (const e of ADJ.edges) {
  for (const side of [e.from, e.to]) {
    if (!terrainOf.has(side)) terrainOf.set(side, []);
    terrainOf.get(side).push(e.terrain);
  }
}

const out = [];
for (const c of COMS) {
  const body = (textOf.get(c.name) ?? []).join("");
  const res = {};

  const iron = [...body.matchAll(/有铁/g)];
  if (iron.length) {
    const at = iron[0].index ?? 0;
    res.iron = { basis: `《郡国志》明文：…${body.slice(Math.max(0, at - 10), at + 12)}…`,
                 strength: "明文" };
  }

  if (/盐池/.test(body)) {
    res.salt = { basis: "《郡国志》明文「有盐池」（解池）", strength: "明文", kind: "池盐" };
  } else if (WELL_SALT.has(c.name)) {
    res.salt = { basis: WELL_SALT.get(c.name), strength: "史载", kind: "井盐" };
  } else {
    const d = seaDist(c.latitude, c.longitude);
    if (d <= SEA_KM) {
      res.salt = { basis: `治所距海岸约 ${Math.round(d)} km，濒海可煮盐`,
                   strength: "地理推定", kind: "海盐" };
    }
  }

  if (HORSE.has(c.name)) res.horse = { basis: HORSE.get(c.name), strength: "史载" };

  const ts = terrainOf.get(c.name) ?? [];
  const plain = ts.filter((t) => t === "plain").length;
  if (ts.length && plain * 2 > ts.length) {
    res.tuntian = { basis: `通邻郡之道 ${ts.length} 条中 ${plain} 条为平原，地可垦`,
                    strength: "地理推定" };
  }

  if (Object.keys(res).length) out.push({ id: c.name, zhou: c.zhou, ...res });
}

const tally = {};
for (const r of out) for (const k of ["iron", "salt", "horse", "tuntian"]) if (r[k]) tally[k] = (tally[k] ?? 0) + 1;
console.log(`郡国 ${COMS.length}，有物产的 ${out.length} 个`);
console.log("按类：", JSON.stringify(tally), `（占比 铁 ${(tally.iron / COMS.length * 100).toFixed(0)}%`
  + `　盐 ${(tally.salt / COMS.length * 100).toFixed(0)}%`
  + `　马 ${(tally.horse / COMS.length * 100).toFixed(0)}%`
  + `　屯 ${(tally.tuntian / COMS.length * 100).toFixed(0)}%）`);
for (const [k, cn] of [["iron", "铁"], ["salt", "盐"], ["horse", "马"], ["tuntian", "屯田"]]) {
  const has = out.filter((x) => x[k]);
  const byZhou = {};
  for (const x of has) byZhou[x.zhou] = (byZhou[x.zhou] ?? 0) + 1;
  console.log(`\n【${cn}】${has.length} 郡　按州：${JSON.stringify(byZhou)}`);
  for (const x of has.slice(0, 6)) console.log(`   ${x.id.padEnd(6)} ${x[k].strength}　${x[k].basis.slice(0, 44)}`);
  if (has.length > 6) console.log(`   …另 ${has.length - 6} 郡`);
}

if (process.argv.includes("--write")) {
  const dst = path.join(ROOT, "lib/game/data/resources.json");
  fs.writeFileSync(dst, JSON.stringify({
    _note: "郡国物产，定各郡能建哪些特殊建筑。由 tools/build-resources.mjs 生成，勿手改。"
         + "每条带 strength：明文（《郡国志》县下直书）／史载（他籍明载）／地理推定（按坐标或道路地形算）。"
         + "缺口要说清：郡国志县下注文详略极不均，「有铁」没写不等于没有铁，"
         + "故本表是「有据可依的所在」，不是「全图分布」。",
    seaKm: SEA_KM,
    commanderies: out,
  }, null, 1) + "\n");
  console.log(`\n→ ${dst}`);
}
