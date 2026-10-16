// 一个剧本的全套运行时对象：规则、通行图、名册、州治、初始数据。
//
// 这段代码此前在 eval-run / melee / match-log / obs-budget / war-tempo / selfplay
// 六个工具里各抄了一遍，而它们问的是同一个问题。抄六份的代价在加第二个剧本时
// 显出来了：天子所在之郡与武将归属都要**按剧本年解析**，而解析发生在打包时
//（见 tools/build-runtime-bundle.mjs）。继续各读各的散件，就会拿兴平元年的
// 归属去跑建安五年——孙策那一家一个武将都没有，而没有任何东西会报错。
//
// 所以一律读**运行时数据包**，与浏览器吃的是同一份。
import fs from "node:fs";
import { buildGraph } from "../../lib/game/engine/actions.ts";
import { buildRoster } from "../../lib/game/engine/officers.ts";
import { buildGeography } from "../../lib/game/engine/victory.ts";
import { loadParams } from "../../lib/game/engine/params.ts";

/**
 * 轮换席位：每局给这几家换一遍画像，避免「画像与开局绑定」混淆结论。
 *
 * 这是**精选**名单不是「最大的几家」：曹操 194 年只有一个郡，之所以在里面
 * 正因为那是最难的席位，验收闸 D 的「一郡开局不必然出局」就钉在他身上。
 * 换剧本必须另选：袁术死于建安四年、吕布灭于建安三年，照搬会得到空席位。
 */
export const SEAT_SETS = {
  // 最强 / 最难 / 两家据险自守 / 两家中等
  194: ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu"],
  // 官渡两强 + 夹在曹操腹地的刘备 + 江东 + 益州 + 汉中。
  //
  // **刘表不在内，是测出来的**：他三郡顶四条战线，60 局出局 35 局、45 局落
  // 丁档，得分接近随机。换过四个候选各 30 局（张羡 2/30、张鲁 5/30、
  // 公孙度 9/30、士燮 3/30 而 29 局丁档），取张鲁：档位最居中，且他一郡开局，
  // 于是「一郡开局不必然出局」那道判据在本剧本也有了着落。
  200: ["caocao", "yuanshao", "liubei", "sunce", "zhanglu", "liuzhang"],
};

/**
 * 随机抽席位的池子。塞外诸部（鲜卑、乌桓、南匈奴、羌胡）与南中夷帅据的是
 * 名存实亡的边郡，产出极低、无路可扩，抽到等于抽到一张废签，故不入池。
 *
 * **不要手抄这张表。** 此前 melee 与 match-log 各抄了一份，两份里都把
 * 马腾写成 `maten`、陆康写成 `luking`，而 match-log 又按「势力是否存在」
 * 静默过滤——于是这两家从来没被抽到过，二十个名额实际只有十七个能用，
 * 一声不响。下面的 seatsFor() 会校验每个 id 都在剧本里，拼错即报错退出。
 */
export const POOLS = {
  194: ["caocao", "yuanshao", "liubiao", "liuzhang", "yuanshu", "lubu",
        "liubei", "gongsunzan", "lijue", "gongsundu", "shixie", "zhangyang",
        "zhanglu", "mateng", "hansui", "kongrong", "wanglang", "liuyao", "lukang"],
  200: ["caocao", "yuanshao", "liubiao", "liuzhang", "liubei", "sunce",
        "zhangxian", "gongsundu", "shixie", "zhanglu", "mateng", "hansui", "songjian"],
};

/** 取某剧本的席位名单，并校验每个 id 都真的在该剧本里 */
export function seatsFor(world, table, what) {
  const list = table[world.scenario];
  if (!list) {
    console.error(`没有 ${world.scenario} 剧本的${what}——加剧本时要在 tools/lib/world.mjs 里补一份，`
      + "理由写在注释里。照搬别年的名单会得到空席位和一份虚假的报告。");
    process.exit(1);
  }
  const live = new Set(world.B.scenario.factions.map((f) => f.id));
  const bad = list.filter((f) => !live.has(f));
  if (bad.length) {
    console.error(`${world.scenario} 剧本的${what}里有不存在的势力：${bad.join("、")}`
      + " —— 多半是 id 拼错了（实测撞过 maten/mateng、luking/lukang）");
    process.exit(1);
  }
  return list;
}

/** SCENARIO=200 选剧本，默认兴平元年 */
export function loadWorld(scenario = process.env.SCENARIO ?? "194") {
  const path = `public/game/runtime-${scenario}.json`;
  if (!fs.existsSync(path)) {
    console.error(`没有 ${path} —— 先跑 node tools/build-runtime-bundle.mjs ${scenario}`);
    process.exit(1);
  }
  const B = JSON.parse(fs.readFileSync(path, "utf8"));
  const nameToId = new Map(B.commanderies.map((c) => [c.name, c.id]));
  return {
    scenario,
    B,
    pack: B.pack,
    P: loadParams(B.pack),
    G: buildGraph(B.adjacency),
    // 包里的名册已按在任表裁过，这里不再二次过滤
    ROSTER: buildRoster(B.officers,
      { officers: B.officers.map((o) => ({ id: o.id, available: true })) }, nameToId),
    GEO: buildGeography(B.commanderies, B.provinceSeats),
    DATA: {
      commanderyState: B.commanderyState,
      scenario: B.scenario,
      commanderies: B.commanderies,
      troopTypes: B.troopTypes,
      resources: B.resources,
    },
    NAME: Object.fromEntries(B.scenario.factions.map((f) => [f.id, f.name])),
  };
}
