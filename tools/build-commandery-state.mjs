// 推导某个剧本年份各郡的游戏初始状态：产出档、守军档、民心档、城防。
//
//   node tools/build-commandery-state.mjs        → 194（兴平元年）
//   node tools/build-commandery-state.mjs 200    → 200（建安五年）
//
// 核心难点：《后汉书·郡国志》的户口是**永和五年（140）**的数字，
// 而剧本在五六十年之后。中间隔着黄巾之乱（184）、董卓之乱（190）、
// 凉州羌乱（184–）、青州黄巾（192）、曹操屠徐州（193–194）。
// 直接拿 140 年户口当剧本年国力，中原诸郡会强得离谱，
// 而史实恰恰相反——194 年曹操"蝗旱大饥，仅保三城"。
//
// 因此引入战乱衰减系数，每一条都附史料依据，见 WAR。
// 这也正好造出真实的战略不对称：194 年**中原户口多而残破，荆益户口少而完好**；
// 到 200 年则屯田已行、吕布已灭、河北已并，衰减表整体重写了一遍——
// 两份表的差额本身就是这六年的史事，逐条附依据。
import fs from "node:fs";

const YEAR = Number(process.argv[2] ?? 194);

const D = "lib/game/data";
const read = (f) => JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8"));
const arr = (o) => (Array.isArray(o) ? o : (o.nodes ?? o));

const commanderies = arr(read("commanderies.json"));
const scenario = read(`scenario-${YEAR}.json`);
const grid = read("terrain-grid.json");
const adjacency = read("adjacency.json");
const { west, north, cellSize, cols, rows } = grid.meta;
const ELEV = grid.elevation, RELIEF = grid.relief;

// ── 战乱衰减：140 年户口 → 剧本年实况 ──────────────────────────────
// [系数, 依据]。按州或具体郡指定，郡级优先。每个剧本年一份表。
//
// 两份表的差额就是 194→200 这六年：许下屯田、吕布覆灭、易京之围、
// 袁术饿死于江亭、孙策平江东、张绣降而南阳再残、张羡举三郡叛表。
// 改一个系数就等于改一条史论，所以逐条附依据。
const WAR = {
  194: {
    byZhou: {
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
    },
    byCommandery: {
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
    },
  },
  200: {
    byZhou: {
      司隶: [0.28, "雒阳自焚毁十年未复；关中则「顷遭荒乱，人民流入荆州者十万余家」（《卫觊传》），钟繇镇长安后招怀流民方有微复"],
      兖州: [0.60, "建安元年用枣祗、韩浩议兴屯田，「数年中所在积粟，仓廪皆满」（《武帝纪》）；吕布既灭，兖州复为腹地"],
      徐州: [0.40, "建安三年曹操围下邳，决泗、沂二水以灌城（《武帝纪》），徐州较兴平年间更残"],
      豫州: [0.62, "屯田首行于许下，募民得谷百万斛（《武帝纪》《任峻传》）；惟汝南黄巾余部未附"],
      冀州: [0.78, "袁绍治河北十年，户口最殷。曹操破邺后「案户籍，可得三十万众，故为大州也」（《崔琰传》）——以《郡国志》冀州口五百九十三万计，欲得三十万众则编户须存六成以上"],
      青州: [0.60, "青州黄巾之祸最烈，袁谭据之四年，《九州春秋》讥其「掠夺无遗」；然比之兴平年间谭与田楷交兵之际，州境已定"],
      凉州: [0.50, "羌胡连兵未已，郡县多废；钟繇所抚止于诸将，不及编户"],
      并州: [0.60, "高干据并州而匈奴、黑山出入其间，边郡内徙如故"],
      幽州: [0.70, "刘虞公孙瓒相攻以来至建安四年易京之围，幽州南部连年为战场，较兴平年间更损"],
      荆州: [1.05, "刘表保境十年，地方数千里带甲十余万，关西兖豫学士归者千数（《刘表传》）"],
      扬州: [0.85, "袁术据淮南「荒侈滋甚……士卒冻馁，江淮间空尽，人民相食」（《袁术传》），术死而淮南无主"],
      益州: [1.15, "刘璋承父业险塞自守，中原流民入蜀者不绝"],
      交州: [1.05, "士燮兄弟并为列郡，中国士人往依避难者以百数（《士燮传》）"],
    },
    byCommandery: {
      河南尹: [0.18, "建安元年天子还雒阳，「宫室烧尽，百官披荆棘依墙壁间」（《后汉书·献帝纪》），旋迁许，河南益空"],
      京兆尹: [0.30, "三辅自李傕郭汜相攻以来残破，建安三年钟繇至，招怀流民而户口未复"],
      左冯翊: [0.28, "与京兆同残，而冯翊更当羌胡、郑甘张晟诸部出入之地"],
      右扶风: [0.30, "马腾屯槐里，关中诸将各拥部曲，编户不入郡籍"],
      颍川郡: [0.70, "许下屯田首行之地，「募民屯田许下，得谷百万斛」（《武帝纪》建安元年）"],
      汝南郡: [0.35, "《武帝纪》建安五年「汝南贼刘辟等叛曹公应绍」，《李通传》记郡中贼帅林立，通以阳安都尉讨之。汝南户四十万为天下第二，而本年赋役多不入——郡大不等于可征发"],
      南阳郡: [0.32, "建安二年至四年曹操与张绣三战于宛、穰、湖阳；绣降在去岁十一月，部曲随之北上官渡，而南部诸县复在刘表兵势之下。户五十二万为天下第一，所余者不及三成"],
      东郡:   [0.55, "吕布既灭，屯田渐复；惟白马、延津在其境，本年为两军对垒之地"],
      陈留郡: [0.60, "吕布既灭后复为腹地，屯田所及"],
      济阴郡: [0.65, "鄄城为曹操旧治，屯田所及，兖州诸郡中最完"],
      下邳国: [0.30, "建安三年决泗、沂灌下邳以破吕布，城坏郡残（《武帝纪》《吕布传》）"],
      彭城国: [0.35, "曹操征陶谦坑杀之惨未复，至本年仍残"],
      广陵郡: [0.65, "陈登治射阳有威信，然孙策遣军渡江来攻，郡境不靖"],
      魏郡:   [0.85, "邺为袁绍大将军治所，河北根本，十年无兵革"],
      陈国:   [0.55, "建安二年袁术求粮于陈，遣张闿杀陈王宠与国相骆俊并取其粮（《后汉书·孝明八王传》），「乱中安土」之局自此而破"],
      常山国: [0.55, "黑山张燕出没常山山谷十余年，与袁绍相攻不能下（《张燕传》）"],
      中山国: [0.60, "西境太行山谷同为黑山出没之地"],
      九江郡: [0.35, "袁术据寿春征敛无度，术死于江亭而淮南无主，雷绪陈兰等豪帅屯聚（《袁术传》《刘馥传》）"],
      庐江郡: [0.55, "建安四年孙策破刘勋于皖，徙其部曲而郡北江淮未附"],
      会稽郡: [1.00, "建安元年孙策破王朗自领太守，山越未尽平而郡府稳立"],
      吴郡:   [0.95, "严白虎等宗帅既破，而许贡旧部犹在——本年四月策即遇刺于此"],
      丹阳郡: [1.00, "宛陵郡府完整，丹阳兵为天下精兵之源"],
      豫章郡: [1.00, "建安四年华歆举郡降，南昌未经大兵"],
      南郡:   [1.20, "襄阳为刘表治所。关中「人民流入荆州者十万余家」（《卫觊传》），关西兖豫学士归者盖有千数（《后汉书·刘表传》），所归在南郡、南阳一带；本年荆南三郡叛，兵力益集于襄阳"],
      江夏郡: [1.15, "黄祖为刘表股肱，屯沙羡以扼江路，舟师甚盛——孙氏三世攻之（坚死于此，策、权屡攻）至建安十三年乃下"],
      长沙郡: [0.80, "张羡举三郡叛刘表，表遣兵攻之连年不下（《桓阶传》），临湘方在围中"],
      零陵郡: [0.85, "随张羡叛表，为刘表兵锋所及"],
      桂阳郡: [0.85, "同零陵"],
      汉中郡: [1.10, "张鲁以鬼道教民，置义舍，「民夷便乐之」，关西民从子午谷奔之者数万家（《张鲁传》）"],
      巴郡:   [1.00, "刘璋遣庞羲御张鲁于巴，賨人摇摆其间，郡北不靖"],
      蜀郡:   [1.20, "成都平原为流民所归，府库殷实，刘璋嗣位六年无大兵"],
      辽东郡: [1.15, "公孙度自王海东，东伐高句丽西击乌丸，中原士人避难者益众（《公孙度传》）"],
      乐浪郡: [0.80, "远悬海东，本条 basis 记「荒」"],
    },
  },
};
const WAR_BY_ZHOU = WAR[YEAR]?.byZhou;
const WAR_BY_COMMANDERY = WAR[YEAR]?.byCommandery;
if (!WAR_BY_ZHOU) {
  console.error(`没有 ${YEAR} 年的战乱衰减表。加一个剧本年就要新写一份——`
    + "沿用别年的系数等于说这些年什么都没发生。");
  process.exit(1);
}

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
    // 折算到剧本年的有效户口。键名不带年份——加一个剧本年不该让读者
    // 再去记一个新键名；年份在 meta.year 里
    householdsEff: effHouseholds, populationEff: effPopulation,
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
[...rows_].sort((a, b) => b.yieldTier - a.yieldTier || b.householdsEff - a.householdsEff).slice(0, 12)
  .forEach((r) => console.log(`  ${r.name.padEnd(6)} 产出${String(r.yieldTier).padStart(2)}  ` +
    `户 ${String(r.households140).padStart(6)}→${String(r.householdsEff).padStart(6)}(×${r.warDamage})  ` +
    `守军 ${String(r.garrison).padStart(5)}(档${r.garrisonTier})  民心${r.moraleTier}  ${r.zhou}`));

console.log("\n【凉州诸郡：应低产出】");
rows_.filter((r) => r.zhou === "凉州").sort((a, b) => b.yieldTier - a.yieldTier)
  .forEach((r) => console.log(`  ${r.name.padEnd(8)} 产出${String(r.yieldTier).padStart(2)} 守军${String(r.garrison).padStart(5)} 民心${r.moraleTier} 地形${r.dominantTerrain}`));

console.log(`\n【${YEAR} 年各家的家底（占郡最多的八家）】`);
const factions = [...new Set(rows_.map((r) => r.factionId).filter(Boolean))]
  .map((f) => [f, rows_.filter((r) => r.factionId === f).length])
  .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f]) => f);
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

const OUT = `${D}/commandery-state${YEAR === 194 ? "" : `-${YEAR}`}.json`;
fs.writeFileSync(OUT, JSON.stringify({
  meta: {
    year: YEAR,
    note: `${YEAR} 年郡级初始状态。户口取《郡国志》永和五年（140）数字，按战乱衰减系数折算到 ${YEAR} 年。`,
    generatedFrom: "tools/build-commandery-state.mjs",
    garrisonTiers: GARRISON_TIERS,
    terrainYield: YIELD,
    warDamageByZhou: WAR_BY_ZHOU,
    warDamageByCommandery: WAR_BY_COMMANDERY,
  },
  commanderies: rows_,
}, null, 1));
console.log(`\n→ ${OUT}`);
