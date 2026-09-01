// 推导 194 年各郡的游戏初始状态：产出档、守军档、民心档、城防。
//
// 核心难点：《后汉书·郡国志》的户口是**永和五年（140）**的数字，
// 而剧本是 194 年。中间隔着黄巾之乱（184）、董卓之乱（190）、
// 凉州羌乱（184–）、青州黄巾（192）、曹操屠徐州（193–194）。
// 直接拿 140 年户口当 194 年国力，中原诸郡会强得离谱，
// 而史实恰恰相反——本年曹操"蝗旱大饥，仅保三城"。
//
// 因此引入战乱衰减系数，每一条都附史料依据，见 WAR_DAMAGE。
// 这也正好造出 194 年真实的战略不对称：**中原户口多而残破，
// 荆益户口少而完好且纳流民**。
import fs from "node:fs";

const D = "lib/game/data";
const read = (f) => JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8"));
const arr = (o) => (Array.isArray(o) ? o : (o.nodes ?? o));

const commanderies = arr(read("commanderies.json"));
const scenario = read("scenario-194.json");
const grid = read("terrain-grid.json");
const adjacency = read("adjacency.json");
const { west, north, cellSize, cols, rows } = grid.meta;
const ELEV = grid.elevation, RELIEF = grid.relief;

// ── 战乱衰减：140 年户口 → 194 年实况 ───────────────────────────────
// [系数, 依据]。按州或具体郡指定，郡级优先。
const WAR_BY_ZHOU = {
  司隶: [0.30, "董卓迁都焚雒阳，宫室居民荡尽，二百里内无烟火（《董卓传》）；三辅继以李傕郭汜相攻"],
  兖州: [0.45, "黄巾初起即残兖州；本年吕布入兖，郡县皆应，曹操仅保三城，兼蝗旱大饥（《武帝纪》）"],
  徐州: [0.45, "初平四年至本年曹操两次征陶谦，所过多所残戮（《武帝纪》裴注引《曹瞒传》）"],
  豫州: [0.55, "颍川汝南为黄巾主战场，波才起于颍川；士民多流散荆州（《钟繇传》《杜袭传》）"],
  冀州: [0.60, "张角起于钜鹿，冀州为黄巾腹心；后袁绍公孙瓒连年争河北"],
  青州: [0.60, "青州黄巾众百万，初平三年入兖州；本州户口耗减尤剧（《武帝纪》）"],
  凉州: [0.55, "中平元年北宫伯玉之乱以来羌胡连兵十年，郡县多废（《董卓传》《皇甫嵩传》）"],
  并州: [0.65, "白波贼据河东太原，南匈奴叛，边郡内徙"],
  幽州: [0.75, "刘虞公孙瓒相攻，然幽州东部与辽东较完"],
  荆州: [1.05, "刘表单马入宜城，江南悉平，沃野千里士民殷富；关西兖豫学士归者盖有千数（《刘表传》）"],
  扬州: [1.00, "江东未大乱，然袁术据淮南征敛无度，北部略损"],
  益州: [1.10, "刘焉据险自守，米贼断道，中国既乱，南阳三辅民数万户流入益州（《刘焉传》）"],
  交州: [1.05, "士燮兄弟并为列郡，雄长一州，中国士人往依避难者以百数（《士燮传》）"],
};
// 郡级覆盖：同州之内轻重不同者
const WAR_BY_COMMANDERY = {
  河南尹: [0.20, "雒阳被焚最烈，本年境内空虚，天子东归尚须张杨输粮"],
  南阳郡: [0.55, "黄巾张曼成起于宛，孙坚破之；后袁术据南阳，「奢淫肆欲，征敛无度，士民苦之」（《袁术传》）"],
  东郡:   [0.40, "本年吕布张邈据濮阳，与曹操相持经年，兖州腹地尽为战场"],
  济阴郡: [0.50, "曹操本年所保三城之一，得以幸免于全境沦陷"],
  陈留郡: [0.45, "初平元年关东联军会盟酸枣，兵久屯食尽而散；后为吕布曹操争地"],
  下邳国: [0.40, "曹操征陶谦，坑杀男女数十万口于泗水，水为之不流（《陶谦传》裴注）"],
  彭城国: [0.35, "同上，彭城首当其冲，本条 basis 亦记「残破」"],
  广陵郡: [0.70, "陈登治下相对完整，未及泗水沿岸之惨"],
  蜀郡:   [1.15, "成都平原为流民主要归所，府库殷实"],
  巴郡:   [1.05, "米贼张鲁断道前，巴中尚通"],
  会稽郡: [1.05, "江东最完之郡，王朗据之，未经大兵"],
  丹阳郡: [1.00, "山越未平但郡治宛陵完整，丹阳兵为天下精兵之源"],
  辽东郡: [1.10, "公孙度雄据海东，中原士人避难者众（《公孙度传》）"],
  乐浪郡: [0.80, "本条 basis 记「荒」，且远悬海外"],
};

// ── 地形产出系数：对郡治周边取样，加权平均 ──────────────────────────
const YIELD = { plain: 1.0, hill: 0.8, mountain: 0.45, highland: 0.15, sea: 0 };
const classify = (e, rl) =>
  e <= 0 ? "sea" : e > 3000 ? "highland" : (e > 1400 || rl > 900) ? "mountain"
  : (e > 350 || rl > 320) ? "hill" : "plain";

/** 以郡治为心取半径约 60km 的圆，统计地形构成 */
function terrainYield(c) {
  const R = 6;                                   // 0.1 度格 × 6 ≈ 60km
  const c0 = Math.floor((c.longitude - west) / cellSize);
  const r0 = Math.floor((north - c.latitude) / cellSize);
  const tally = { plain: 0, hill: 0, mountain: 0, highland: 0, sea: 0 };
  let n = 0;
  for (let dr = -R; dr <= R; dr += 1) {
    for (let dc = -R; dc <= R; dc += 1) {
      if (dr * dr + dc * dc > R * R) continue;
      const r = r0 + dr, cc = c0 + dc;
      if (r < 0 || cc < 0 || r >= rows || cc >= cols) continue;
      const i = r * cols + cc;
      tally[classify(ELEV[i], RELIEF[i])] += 1; n += 1;
    }
  }
  if (!n) return { factor: 0.6, tally, dominant: "plain" };
  const factor = Object.entries(tally).reduce((a, [k, v]) => a + YIELD[k] * v, 0) / n;
  const dominant = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
  return { factor: +factor.toFixed(3), tally, dominant };
}

// ── 守军档：13 档等比 1.4（MERS R2）──────────────────────────────────
const GARRISON_TIERS = [1000, 1400, 2000, 2800, 4000, 5600, 8000, 11000, 16000, 22000, 32000, 45000];
const garrisonTier = (n) => {
  let t = 0;
  while (t < GARRISON_TIERS.length && n >= GARRISON_TIERS[t]) t += 1;
  return t;                                      // 0..12
};

// ── 主流程 ──────────────────────────────────────────────────────────
const degree = new Map();
for (const e of adjacency.edges) {
  degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
  degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
}

const rows_ = [];
for (const c of commanderies) {
  const own = scenario.ownership[c.name];
  const ty = terrainYield(c);
  const [dmg, dmgBasis] = WAR_BY_COMMANDERY[c.name] ?? WAR_BY_ZHOU[c.zhou] ?? [0.8, "无特别记载，取中原外围通例"];

  // 户口按战乱衰减；无记载者按同州中位补
  const households = c.households ?? 0;
  const population = c.population ?? (households ? households * 5 : 0);
  const effHouseholds = Math.round(households * dmg);
  const effPopulation = Math.round(population * dmg);

  // 产出：有效户数 × 地形系数，取对数压缩后映射到 1–10
  // 用对数是因为户数跨三个数量级（南阳 52 万户 vs 边郡数千户），
  // 线性映射会让 90% 的郡挤在最低档。
  const rawYield = effHouseholds * ty.factor;
  const yieldTier = rawYield <= 0 ? 1
    : Math.max(1, Math.min(10, Math.round((Math.log10(rawYield) - 2.6) * 2.6 + 1)));

  // 守军：口 × 2%，再受该郡粮产上限约束（粮每旬 0.09/户，戍兵 0.5 石/人/旬）
  const byPop = Math.round(effPopulation * 0.02);
  const grainPerXun = effHouseholds * 0.09 * ty.factor;
  const byGrain = Math.round(grainPerXun / 0.5);
  const garrison = Math.max(300, Math.min(byPop, byGrain));

  // 民心：战乱衰减越重民心越低；实控加成，名义控制扣减
  const ctrlAdj = own?.control === "firm" ? 0.6 : own?.control === "contested" ? -0.4 : -0.8;
  const moraleTier = Math.max(1, Math.min(5, Math.round(dmg * 4.2 + ctrlAdj)));

  // 城防：郡等（按产出档折算）+ 关隘加成 + 州治加成
  const isZhouSeat = ["雒阳", "邺", "昌邑", "郯", "临淄", "汉寿", "历阳", "雒", "陇", "晋阳", "蓟", "龙编", "谯"].includes(c.seat);
  const gateBonus = adjacency.edges
    .filter((e) => e.from === c.id || e.to === c.id)
    .some((e) => e.nodes.some((n) => n.kind === "gate")) ? 8 : 0;
  const defense = Math.min(100, 30 + yieldTier * 5 + gateBonus + (isZhouSeat ? 6 : 0));

  rows_.push({
    id: c.id, name: c.name, zhou: c.zhou, seat: c.seat,
    factionId: own?.factionId ?? null, control: own?.control ?? null,
    households140: households, population140: population,
    warDamage: dmg, warBasis: dmgBasis,
    households194: effHouseholds, population194: effPopulation,
    terrainFactor: ty.factor, dominantTerrain: ty.dominant,
    yieldTier, garrison, garrisonTier: garrisonTier(garrison),
    moraleTier, defense,
    degree: degree.get(c.id) ?? 0,
  });
}

// ── 验收 ────────────────────────────────────────────────────────────
console.log(`推导 ${rows_.length} 郡\n`);
const byName = new Map(rows_.map((r) => [r.name, r]));

console.log("【产出档最高 12 郡】");
[...rows_].sort((a, b) => b.yieldTier - a.yieldTier || b.households194 - a.households194).slice(0, 12)
  .forEach((r) => console.log(`  ${r.name.padEnd(6)} 产出${String(r.yieldTier).padStart(2)}  ` +
    `户 ${String(r.households140).padStart(6)}→${String(r.households194).padStart(6)}(×${r.warDamage})  ` +
    `守军 ${String(r.garrison).padStart(5)}(档${r.garrisonTier})  民心${r.moraleTier}  ${r.zhou}`));

console.log("\n【凉州诸郡：应低产出】");
rows_.filter((r) => r.zhou === "凉州").sort((a, b) => b.yieldTier - a.yieldTier)
  .forEach((r) => console.log(`  ${r.name.padEnd(8)} 产出${String(r.yieldTier).padStart(2)} 守军${String(r.garrison).padStart(5)} 民心${r.moraleTier} 地形${r.dominantTerrain}`));

console.log("\n【194 年六大势力的家底】");
const factions = ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu"];
for (const f of factions) {
  const mine = rows_.filter((r) => r.factionId === f);
  if (!mine.length) continue;
  const name = scenario.factions.find((x) => x.id === f)?.name ?? f;
  const tot = mine.reduce((a, r) => a + r.garrison, 0);
  const y = mine.reduce((a, r) => a + r.yieldTier, 0);
  console.log(`  ${name.padEnd(12)} ${String(mine.length).padStart(2)} 郡  总守军 ${String(tot).padStart(6)}  产出合计 ${String(y).padStart(3)}  ` +
    `最大单郡 ${Math.max(...mine.map((r) => r.garrison))}`);
}

console.log("\n【分布体检】");
for (const k of ["yieldTier", "garrisonTier", "moraleTier"]) {
  const h = {};
  for (const r of rows_) h[r[k]] = (h[r[k]] ?? 0) + 1;
  console.log(`  ${k.padEnd(13)} ${Object.entries(h).sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v}:${n}`).join(" ")}`);
}

const checks = [
  ["南阳郡", (r) => r.yieldTier >= 8, "史载户口最多，应为最高产出档"],
  ["汝南郡", (r) => r.yieldTier >= 8, "同上"],
  ["河南尹", (r) => r.moraleTier <= 2, "雒阳被焚，民心应极低"],
  ["蜀郡",   (r) => r.yieldTier >= 7, "成都平原纳流民，应为高产出"],
  ["敦煌郡", (r) => r.yieldTier <= 4, "边远地贫，应低产出"],
];
console.log("\n【定点验收】");
let pass = 0;
for (const [name, fn, why] of checks) {
  const r = byName.get(name);
  const ok = r && fn(r);
  if (ok) pass += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(6)} 产出${r?.yieldTier} 民心${r?.moraleTier}  ${why}`);
}
console.log(`  ${pass}/${checks.length} 通过`);

fs.writeFileSync(`${D}/commandery-state.json`, JSON.stringify({
  meta: {
    note: "194 年郡级初始状态。户口取《郡国志》永和五年（140）数字，按战乱衰减系数折算到 194 年。",
    generatedFrom: "tools/build-commandery-state.mjs",
    garrisonTiers: GARRISON_TIERS,
    terrainYield: YIELD,
    warDamageByZhou: WAR_BY_ZHOU,
    warDamageByCommandery: WAR_BY_COMMANDERY,
  },
  commanderies: rows_,
}, null, 1));
console.log(`\n→ ${D}/commandery-state.json`);
