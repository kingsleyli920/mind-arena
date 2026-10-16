// 构建公元 200 年（建安五年）剧本的势力归属数据。
//
// 时间切片：取建安五年正月（公元 200 年 2 月前后）。
//   选此切片的原因：官渡尚未开打而对峙已成，一年内的要角全在场——
//   袁绍去岁三月灭公孙瓒据河北四州，曹操去岁十一月收张绣、四月定河内，
//   刘备去岁末杀车胄据徐州（曹操本年正月即自将东征，二月破之），
//   孙策破刘勋、降华歆已尽有江东（四月丙午遇刺），
//   张羡以长沙、零陵、桂阳三郡叛刘表应曹操而方在围中。
//   若把切片推到年中，刘备已走、孙策已死、颜良文丑已没，势力图就残了。
//
//   卒于本年而活过本切片者，在 officers.json 里逐人补了 deathMonth 与出处：
//   颜良、文丑（四月）、淳于琼、沮授（十月乌巢）、田丰（官渡败后）、
//   孙策（四月丙午）、郑玄（六月）、于吉、张羡。详见 tools/lib/officer-slice.mjs。
//
// 史料依据（均为公有领域古籍）：
//   《三国志》魏书·武帝纪 / 袁绍传 / 张绣传 / 钟繇传 / 臧霸传 / 陈登（陈矫传）/
//     二公孙陶四张传 / 张鲁传 / 刘二牧传 / 刘表传 / 阎柔传，
//     蜀书·先主传 / 关羽传，
//     吴书·孙破虏讨逆传 / 孙贲传 / 刘繇太史慈士燮传，
//     裴注引《英雄记》《典略》《献帝传》《九州春秋》
//   《后汉书》献帝纪 / 袁绍刘表列传 / 郑玄传 / 南匈奴列传 / 乌桓鲜卑列传 / 郡国志
//   《资治通鉴》卷六十三（建安五年）
//
// 口径约定与 194 剧本完全一致（control / certainty 三档两档，basis 必填），
// 见 tools/build-scenario-194.mjs 的同名说明。
//
// 与 194 剧本的一处口径差异，特此写明：
//   凉州河西四郡（武威、张掖、酒泉、敦煌）与安定，194 年记在李傕名下
//   （持朝廷者的名义），本年改记无主。理由是朝廷已东迁至许，相隔数千里，
//   而河西诸郡此时由郡人推行长史事、太守卒官而府无丞（《张既传》注引《魏略》
//   记敦煌「太守马艾卒官，府又无丞」，功曹张恭行长史事）。
//   仍记在许都名下会凭空给曹操五个郡，把官渡前的强弱写反。
//
// 反复运行结果一致：无网络、无随机、无时间依赖。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "lib/game/data/commanderies.json");
const OUT = path.join(ROOT, "lib/game/data/scenario-200.json");

// ── 势力清单 ────────────────────────────────────────────────────────────────
// 颜色沿用 194 剧本已钉死的那一套（同一势力同一色），新增者另取；
// 改色后须跑 tools/check-palette.mjs 复核接壤势力的色差。
//
// governorship 仍只记**朝廷所授**的州牧号，自领自立者不记。本年有四家：
//   曹操  建安元年都许，自领司隶校尉、录尚书事（《武帝纪》），名器皆出其手；
//         兖州牧本为州吏所推，都许后名位一并出于朝命，故记兖州
//   袁绍  建安元年曹操以大将军让绍，绍为大将军、兼督冀青幽并四州（《武帝纪》
//         《袁绍传》）——这是本年唯一一个由朝廷明授而又名实相副的河北名分
//   刘表  初平元年诏拜荆州刺史，后为镇南将军、荆州牧
//   刘璋  诏书以为监军使者领益州牧
// 与 194 年只有刘表、刘璋二家有号相比，本年的名分已被两强各取其一——
// 这正是官渡之争的另一面。
const FACTIONS = [
  { id: "caocao", name: "曹操", courtesyName: "孟德", seat: "颍川郡", governorship: "兖州",
    color: "#2f6fd8",
    situation: "建安元年迎天子都许，挟朝命以令诸侯；去岁四月斩眭固定河内、十一月纳张绣之降，南北两面既安，乃北屯官渡与袁绍相拒。本年正月董承衣带诏事泄夷三族，旋即自将东征刘备——粮少兵寡而必须先解徐州这个背刺。" },
  { id: "yuanshao", name: "袁绍", courtesyName: "本初", seat: "魏郡", governorship: "冀州",
    color: "#e0b422",
    situation: "大将军、兼督冀青幽并四州。去岁三月拔易京灭公孙瓒，尽有河北，众数十万；简精卒十万、骑万匹将以攻许。惟沮授谏持久、田丰谏勿轻进皆不见用，郭图审配与之异议，内已不和。" },
  { id: "liubei", name: "刘备", courtesyName: "玄德", seat: "下邳国",
    color: "#1f9e52",
    situation: "去岁奉命截袁术于徐，因杀车胄据下邳，留关羽行下邳太守事而身屯小沛；东海昌豨叛应之，郡县多归附，遣使与袁绍连和。本年正月曹操自将东征，二月而散——这是他起兵以来离一块根本之地最近、也丢得最快的一次。" },
  { id: "liubiao", name: "刘表", courtesyName: "景升", seat: "南郡", governorship: "荆州",
    color: "#17a8a0",
    situation: "以荆州牧治襄阳，地方数千里带甲十余万。袁绍求援则许而不至，曹操亦不助，取保境观变之策；而长沙张羡挟三郡叛应许都，连年围之不下，南方未宁，北顾不得。" },
  { id: "zhangxian", name: "张羡（长沙三郡）", courtesyName: null, seat: "长沙郡",
    color: "#c2213f",
    situation: "长沙太守，先后历桂阳、零陵，甚得江湘间心而性屈强不服刘表；用桓阶之谋举长沙、零陵、桂阳三郡叛表，遣使诣曹公。表围之连年不下，而羡病死在即——荆南这一叛是刘表在官渡年间动弹不得的直接原因。" },
  { id: "sunce", name: "孙策", courtesyName: "伯符", seat: "吴郡",
    color: "#ef7420",
    situation: "讨逆将军、吴侯。去岁破庐江刘勋于皖、降豫章华歆，江东六郡略定；闻曹袁相拒于官渡，阴欲袭许迎天子，部署未发。本年四月丙午为故吴郡太守许贡客所刺——江东之业由此转手于其弟。" },
  { id: "liuzhang", name: "刘璋", courtesyName: "季玉", seat: "蜀郡", governorship: "益州",
    color: "#8cc32a",
    situation: "监军使者领益州牧。北与张鲁绝而遣庞羲御之，内则赵韪阴结州中大姓谋反——《英雄记》系其举兵于本年，确月失载。险塞自守，于中原之争不预一词。" },
  { id: "zhanglu", name: "张鲁", courtesyName: "公祺", seat: "汉中郡",
    color: "#8b4bd8",
    situation: "以五斗米道据汉中，置义舍行鬼道，民夷信向；与刘璋世仇，而巴中賨人杜濩、朴胡等摇摆其间。不奉成都之令，亦不涉关东之争。" },
  { id: "mateng", name: "马腾", courtesyName: "寿成", seat: "右扶风",
    color: "#e0409a",
    situation: "屯槐里，与韩遂时合时离，尝以子相质而复相攻。曹操遣钟繇镇长安持节督关中诸军，腾受其抚而未附；关中诸将各拥部曲，官渡之际两不相助。" },
  { id: "hansui", name: "韩遂", courtesyName: "文约", seat: "金城郡",
    color: "#68894d",
    situation: "据金城二十年，凉州之乱自北宫伯玉以来皆有其名。与马腾分据陇右，钟繇书至则受之，兵不出函谷一步。" },
  { id: "songjian", name: "宋建", courtesyName: null, seat: "陇西郡",
    color: "#08a9ff",
    situation: "据枹罕自号河首平汉王，改元置百官，割据河湟三十余年，中原不能问——至建安十九年方为夏侯渊所灭。" },
  { id: "gongsundu", name: "公孙度", courtesyName: "升济", seat: "辽东郡",
    color: "#f5b784",
    situation: "自立为辽东侯、平州牧，东伐高句丽、西击乌丸，越海据东莱诸县置营州刺史。中原方争而海东自王，曹操表为武威将军、永宁乡侯，度曰「我王辽东，何永宁也」，藏印绶于武库。" },
  { id: "shixie", name: "士燮", courtesyName: "威彦", seat: "交趾郡",
    color: "#e2b8d5",
    situation: "交趾太守数十年，表诸弟壹领合浦、䵋领九真、武领南海，士氏雄长岭南；而汉所遣交州刺史张津治苍梧，与之分权。中国士人避难往依者以百数。" },
  { id: "wuhuan", name: "乌桓（蹋顿、苏仆延、乌延）", courtesyName: null, seat: "辽西郡",
    color: "#a6618a",
    situation: "蹋顿总辽西、辽东属国、右北平三部，强盛不下丘力居。袁绍破公孙瓒时数得其助，矫制赐三部单于印绶、以家人子为己女妻之——河北之众，胡骑居其一。" },
  { id: "xianbei", name: "鲜卑诸部", courtesyName: null, seat: "云中郡",
    color: "#95d4ae",
    situation: "檀石槐死后诸部分立，步度根、轲比能尚未坐大；缘边郡县久废，五原、云中、定襄、朔方皆其游牧之地。" },
  { id: "xiongnu", name: "南匈奴（呼厨泉、去卑）", courtesyName: null, seat: "西河郡",
    color: "#9466c1",
    situation: "于夫罗卒，弟呼厨泉立，单于庭自美稷南徙平阳；右贤王去卑领其众处河东、西河之间，受许都羁縻而部落自治。" },
  { id: "qianghu", name: "羌胡（氐羌、卢水胡）", courtesyName: null, seat: "武都郡",
    color: "#b05d27",
    situation: "白马氐阿贵、杨千万等据武都，先零、烧当诸种散处北地；凉州郡县多虚设，汉家号令不出陇山。" },
  { id: "nanzhongyi", name: "南中夷帅与大姓", courtesyName: null, seat: "永昌郡",
    color: "#21d7f7",
    situation: "益州郡、永昌郡去成都数千里，夷帅与吕、雍等大姓分据，蜀中号令仅止于奉正朔、贡方物。" },
  { id: "zhangyan", name: "黑山张燕", courtesyName: null, seat: "常山国",
    color: "#6ade70",
    situation: "众号百万，出没常山、赵郡、中山、上党诸山谷，与袁绍相攻十年不能下；闻曹袁相持，遣使诣许求助——至建安十年方率众降曹。" },
  { id: "wuzhu", name: "无主", courtesyName: null, seat: null,
    color: "#a8a29a",
    situation: "郡府残破或长吏不立，境内无一方能持续征发赋役，多为数方缓冲、流民与坞壁自保之地。" },
];

// ── 郡国归属 ────────────────────────────────────────────────────────────────
// [factionId, control, certainty, basis]
const OWN = {
  // ═══ 司隶 7 ═══
  河南尹: ["caocao", "contested", "attested",
    "建安元年天子东归，曹操迎都许，河南入其版图（《武帝纪》）。然雒阳为董卓所焚，宫室居民荡尽，天子过此尚须张杨输粮；本年河南尹北临大河与袁绍相望，户口与郡府俱未复，故记争夺。"],
  河内郡: ["caocao", "contested", "attested",
    "建安四年眭固杀杨丑，欲北附袁绍，曹操遣史涣、曹仁渡河击破之，斩固，河内遂定（《武帝纪》建安四年四月）。惟郡北接袁绍之上党、魏郡，正当官渡对峙的西翼，控制未可言固。"],
  河东郡: ["caocao", "nominal", "disputed",
    "河东太守王邑为汉廷所署，奉许都正朔；而郡北平阳一带为南匈奴呼厨泉、去卑部所居，白波旧部亦未尽散。高干、郭援入河东与杜畿代邑，《杜畿传》并系于建安七年，不属本年。以太守论属许都名义，以实控论郡北不在其手，故标争议。"],
  弘农郡: ["caocao", "contested", "attested",
    "段煨为安南将军屯华阴（属弘农），建安三年与裴茂等击破李傕，传首许都，奉朝命而自将部曲（《后汉书·董卓传》）。弘农当关中与许都之间孔道，名隶许而兵在煨，故记争夺。煨至建安十四年方卒。"],
  京兆尹: ["caocao", "nominal", "attested",
    "建安三年曹操遣钟繇以侍中守司隶校尉、持节督关中诸军，镇长安（《三国志·钟繇传》）。繇至，为书与马腾、韩遂等陈祸福，各遣子入侍——所恃者书与名分，非兵也。三辅实控在关中诸将，故记名义。"],
  左冯翊: ["caocao", "nominal", "disputed",
    "三辅残破，冯翊诸县为关中诸将与郑甘、张晟等部曲所据，钟繇所督止于名义。本年冯翊守相史无明文，故标争议。"],
  右扶风: ["mateng", "contested", "attested",
    "《马超传》注引《典略》：建安之初，国家纲纪殆弛，使马腾、韩遂还凉州，「腾屯槐里」——槐里属右扶风。腾受钟繇之抚而部曲自将，与韩遂时合时离，郡境控制随之游移。"],

  // ═══ 豫州 6 ═══
  颍川郡: ["caocao", "firm", "attested",
    "建安元年九月迁都于许（属颍川），为天子所在、曹操根本（《武帝纪》）。本年屯田积谷已数年，是官渡之役的后方。"],
  汝南郡: ["caocao", "contested", "attested",
    "汝南为汝南袁氏本郡，黄巾余部刘辟、龚都等拥众屯聚，坞壁林立。《武帝纪》建安五年记绍遣刘备将兵至汝南，「贼共都等应之」——本年七月之事，可见正月时曹操于此已非尽有。"],
  梁国: ["caocao", "firm", "attested",
    "梁国居许都东北，袁术既死、吕布既灭，本年无他方兵锋及此，为曹操腹地。"],
  沛国: ["liubei", "contested", "attested",
    "《先主传》：备杀徐州刺史车胄，「留关羽守下邳行太守事，身还小沛」。小沛属沛国，为刘备本年屯兵之地；而郡境西接许都，曹操本年正月即自将东征，故记争夺。"],
  陈国: ["caocao", "firm", "attested",
    "建安二年袁术求粮于陈，国相骆俊拒之，术遣张闿刺杀陈王宠与俊，陈国遂亡（《后汉书·孝明八王传》）。术败死后其地入曹操，本年无他属。"],
  鲁国: ["caocao", "contested", "attested",
    "鲁国北接泰山，臧霸、孙观等青徐豪帅出没其间。曹操既以霸为琅邪相而割青徐委之（《臧霸传》），鲁国名隶许都而征发不能遍及，故记争夺。"],

  // ═══ 冀州 9 ═══
  魏郡: ["yuanshao", "firm", "attested",
    "袁绍大将军治邺（魏郡），为河北根本。本年简精卒十万、骑万匹将以攻许，辎重悉出于此。"],
  钜鹿郡: ["yuanshao", "firm", "attested",
    "界桥之战后钜鹿久入袁绍，公孙瓒既灭，河北腹地更无战事。"],
  常山国: ["zhangyan", "contested", "attested",
    "《三国志·张燕传》：燕众出没常山、赵郡、中山、上党、河内诸山谷，与袁绍相攻十余年。本年燕遣使诣许求助曹操，受拜平北将军——常山山地不入邺城版籍，至建安十年燕率众降方止。"],
  中山国: ["yuanshao", "contested", "attested",
    "公孙瓒既灭，中山归邺；惟西境太行山谷为黑山军出没之地，与常山同。"],
  安平国: ["yuanshao", "firm", "attested",
    "安平居冀州腹心，信都为袁绍屯粮聚兵之地，本年无警。"],
  河闲国: ["yuanshao", "firm", "attested",
    "建安四年易京既拔，河间北面之患尽去，全郡安帖。"],
  清河国: ["yuanshao", "firm", "attested",
    "甘陵（清河）为冀州东出青州之要道，袁谭自此赴青，本年为其转输之地。"],
  赵国: ["yuanshao", "contested", "attested",
    "邯郸一带属袁绍，西境山谷为黑山军所据，与常山情形相同。"],
  勃海郡: ["yuanshao", "firm", "attested",
    "袁绍以勃海太守起兵，公孙瓒既灭，勃海为冀州东北门户，本年稳固在握。"],

  // ═══ 兖州 8 ═══
  陈留郡: ["caocao", "firm", "attested",
    "吕布既灭，陈留复为兖州腹地；郡当官渡之西南，为曹操屯粮转输所经。"],
  东郡: ["caocao", "firm", "attested",
    "白马、延津俱在东郡界，为本年河南岸防线所系（《武帝纪》建安五年二月绍遣颜良攻东郡太守刘延于白马）。郡在曹操手中，而郡北即袁绍。"],
  东平国: ["caocao", "firm", "attested",
    "兴平二年曹操破薛兰、李封复东平，自此为其腹地，本年无他属。"],
  任城国: ["caocao", "firm", "attested",
    "任城为兖州小国，吕布既灭，随兖州诸郡归曹操。"],
  泰山郡: ["caocao", "contested", "attested",
    "《臧霸传》：建安三年吕布败，霸等降，太祖以霸为琅邪相，吴敦利城、尹礼东莞、孙观北海、观兄康城阳，「割青、徐二州，委之於霸」。泰山为诸帅起家之地，名隶许都而郡境自专，故记争夺。"],
  济北国: ["caocao", "firm", "attested",
    "济北在兖州东北，吕布既灭后无他方兵锋，为曹操腹地。"],
  山阳郡: ["caocao", "firm", "attested",
    "昌邑为兖州刺史旧治，兴平二年曹操破薛兰、李封复得山阳，本年安帖。"],
  济阴郡: ["caocao", "firm", "attested",
    "鄄城属济阴，兴平中曹操赖此三城不亡，本年为其腹地。"],

  // ═══ 徐州 5 ═══
  东海郡: ["liubei", "contested", "attested",
    "《武帝纪》建安五年：「东海昌豨叛为备」。豨本泰山群盗之一，据东海而应刘备，郡境遂非曹操所有；郯为徐州刺史旧治，而本年州府已随车胄之死而废。"],
  琅邪国: ["caocao", "nominal", "attested",
    "臧霸为琅邪相（曹操所署），「割青、徐二州，委之於霸」（《臧霸传》）。霸奉许都而自领部曲，官渡之际数以精兵入青州，故曹操得专事绍——名在许而实在霸，故记名义。"],
  彭城国: ["caocao", "firm", "attested",
    "吕布既灭，彭城归曹操；郡虽经曹操两征陶谦之残破，本年无他方据之。"],
  广陵郡: ["caocao", "firm", "attested",
    "陈登为广陵太守，治射阳，有威信于江淮；孙策遣军渡江攻之，登破其众于匡琦（《陈矫传》注引《先贤行状》）。郡为曹操东南屏障。"],
  下邳国: ["liubei", "firm", "attested",
    "《先主传》：备既杀车胄，「留关羽守下邳行太守事」。下邳为徐州腹地重镇，是刘备本年实际征发之地。"],

  // ═══ 青州 6 ═══
  济南国: ["yuanshao", "firm", "attested",
    "袁绍以长子谭为青州刺史，建安初逐田楷、攻孔融，尽有青州（《袁绍传》注引《九州春秋》）。济南为其南面重地。"],
  平原郡: ["yuanshao", "firm", "attested",
    "平原自建安初入袁谭之手，为青州与冀州相连之地。"],
  乐安国: ["yuanshao", "firm", "attested",
    "乐安为袁谭所置守相之地，居青州腹心，本年无他方据之。"],
  北海国: ["yuanshao", "contested", "disputed",
    "《臧霸传》记曹操以孙观为北海相；而袁谭自建安初攻走孔融、据有青州。两家各有所署，界线与年份俱失载，故记袁谭所有而标争议。"],
  东莱郡: ["gongsundu", "contested", "disputed",
    "公孙度越海收东莱诸县，置营州刺史（《三国志·公孙度传》），度至建安九年方卒，本年其事仍在；而郡内陆诸县属青州袁谭。其事无确年，故标争议。"],
  齐国: ["yuanshao", "firm", "attested",
    "临淄为青州名都，袁谭既据青州，齐国随之，本年无战事。"],

  // ═══ 荆州 7 ═══
  南阳郡: ["caocao", "contested", "attested",
    "《武帝纪》建安四年十一月：「张绣率众降，封列侯」。南阳遂入许都版图，绣以扬武将军从征官渡。然郡经袁术诛求、张绣连年之战，宗贼坞壁未尽，南接刘表，故记争夺。"],
  南郡: ["liubiao", "firm", "attested",
    "刘表以荆州牧治襄阳（属南郡），为其根本；蔡、蒯诸族居之，本年无警。"],
  江夏郡: ["liubiao", "firm", "attested",
    "江夏太守黄祖为刘表股肱，屯沙羡扼江路，与孙氏世仇——初平三年射杀孙坚即在此郡界。"],
  零陵郡: ["zhangxian", "contested", "attested",
    "《桓阶传》：长沙太守张羡率零陵、桂阳三郡叛刘表，遣使诣曹公，「表遣兵攻羡，连年不下」。零陵既应羡而又在表之兵锋下，故记争夺。"],
  桂阳郡: ["zhangxian", "contested", "attested",
    "与零陵同为张羡所举三郡之一；羡先后历桂阳、零陵太守，甚得江湘间心，故三郡并应。"],
  武陵郡: ["liubiao", "nominal", "attested",
    "武陵名隶荆州，郡内五溪蛮种落自治，刘表只能羁縻，赋役不能遍及。"],
  长沙郡: ["zhangxian", "firm", "attested",
    "张羡为长沙太守，以桓阶之谋举三郡叛表应许都，治临湘而被围连年。本年正月犹在围中，病死在即（《桓阶传》《后汉书·刘表传》）。"],

  // ═══ 扬州 6 ═══
  九江郡: ["wuzhu", "contested", "disputed",
    "建安四年袁术呕血死于江亭，淮南无主；雷绪、陈兰、梅成等江淮豪帅各拥部曲屯聚其间。曹操表刘馥为扬州刺史、单马造合肥空城而立州治，《刘馥传》系于建安五年而不著月——本年正月尚无一方郡府，故记无主并标争议。"],
  丹阳郡: ["sunce", "firm", "attested",
    "孙策舅吴景为丹阳太守，治宛陵；丹阳兵为天下精兵之源，是孙氏立国之本。"],
  庐江郡: ["sunce", "contested", "attested",
    "建安四年孙策破庐江太守刘勋于皖，尽得其众，以李术为庐江太守（《孙讨逆传》）。惟郡北江淮之间豪帅未附，与九江同为缓冲，故记争夺。"],
  会稽郡: ["sunce", "firm", "attested",
    "建安元年孙策破王朗，自领会稽太守，治山阴；本年山越虽未尽平而郡府稳立。"],
  吴郡: ["sunce", "firm", "attested",
    "孙策既破严白虎等宗帅，吴郡归其所有；本年四月为故吴郡太守许贡之客所刺，即在此郡。"],
  豫章郡: ["sunce", "firm", "attested",
    "建安四年十二月豫章太守华歆举郡降，孙策以兄子贲领豫章、辅领庐陵（《孙贲传》《华歆传》）。江东六郡至此略定。"],

  // ═══ 益州 12 ═══
  汉中郡: ["zhanglu", "firm", "attested",
    "张鲁以鬼道教民，置义舍、自号师君，断绝斜谷阁道（《三国志·张鲁传》）。与刘璋世仇而中原不能问，巴汉自成一国。"],
  巴郡: ["liuzhang", "contested", "attested",
    "刘璋以庞羲御张鲁于巴（后分巴西、巴东），为蜀中东北门户；而賨人杜濩、朴胡等据巴中山地，摇摆于璋、鲁之间，郡北边界随之动摇。"],
  广汉郡: ["liuzhang", "firm", "attested",
    "广汉为成都北面藩屏，刘焉旧治绵竹在此，本年为刘璋腹地。"],
  蜀郡: ["liuzhang", "firm", "attested",
    "成都为益州牧治所，府库殷实，流民所归；刘璋嗣位已六年，蜀郡为其根本。"],
  犍为郡: ["liuzhang", "contested", "disputed",
    "《刘二牧传》注引《英雄记》记赵韪率众反刘璋在建安五年，韪本为璋所亲任而阴结州中大姓，蜀中郡县多应之，至建安六年方平。确月失载，本年正月是否已发不可考，故记刘璋所有而标争议。"],
  牂牁郡: ["liuzhang", "nominal", "attested",
    "牂牁为南中三郡之一，郡府在故且兰，实由夷帅与朱提、建宁大姓分领，成都之令止于奉正朔、贡方物。"],
  越巂郡: ["liuzhang", "nominal", "attested",
    "越巂邛都叟夷种落众多，郡守常不能制，赋役多不上计。"],
  益州郡: ["nanzhongyi", "contested", "attested",
    "益州郡（滇池）夷多汉少，雍氏等大姓与夷帅世居其地，去成都数千里，刘璋唯有名义。"],
  永昌郡: ["nanzhongyi", "nominal", "attested",
    "永昌为汉土最西之郡，治不韦，哀牢夷与吕氏等大姓自治，道里绝远，南中诸郡中最不受州府节制。"],
  广汉属国: ["liuzhang", "nominal", "attested",
    "广汉属国治阴平道，氐羌杂居，汉制以夷治夷；名隶刘璋而当汉中入陇之路，张鲁势力亦可及。"],
  蜀郡属国: ["liuzhang", "nominal", "attested",
    "蜀郡属国治汉嘉，为邛笮夷道所出，羁縻而已。"],
  犍为属国: ["liuzhang", "nominal", "attested",
    "犍为属国治朱提，当南中入蜀之孔道，大姓与夷帅分领，州府唯羁縻。"],

  // ═══ 凉州 12 ═══
  陇西郡: ["songjian", "contested", "disputed",
    "宋建据枹罕（属陇西）自号河首平汉王，改元置百官三十余年（《武帝纪》建安十九年夏侯渊斩建）。郡治狄道一带是否尚有汉家长吏，本年史无明文，故标争议。"],
  汉阳郡: ["mateng", "contested", "attested",
    "汉阳（天水）当陇右之冲，马腾、韩遂部曲往来其间；钟繇镇长安所抚者即此诸将，郡境控制随其分合而动。"],
  武都郡: ["qianghu", "firm", "attested",
    "白马氐阿贵、杨千万等据武都，汉郡县名存实亡（《张既传》《杨阜传》所记氐王即此诸部之后）。"],
  金城郡: ["hansui", "firm", "attested",
    "韩遂据金城自中平以来二十年，为凉州诸军之首，本年受钟繇之抚而兵不东出。"],
  安定郡: ["wuzhu", "nominal", "disputed",
    "安定当泾水上游，汉阳、北地之间，郡县久经羌乱而内徙。本年守相史无明文，关中诸将与羌胡各有部曲出入，无一方能持续征发，故记无主并标争议。"],
  北地郡: ["qianghu", "contested", "attested",
    "北地郡县自永初以来屡经内徙，先零、烧当诸种散处其地，汉家治所已非旧处。"],
  武威郡: ["wuzhu", "nominal", "disputed",
    "朝廷东迁至许，相去数千里，河西四郡遂自为治。本年武威守相无明文（张猛杀邯郸商事在建安中而年份有争议），故记无主。此条与 194 剧本记在李傕（持朝廷者）名下不同，说明见本文件开头。"],
  张掖郡: ["wuzhu", "nominal", "disputed",
    "与武威同，河西诸郡本年各自保聚，许都名义不能及，故记无主。"],
  酒泉郡: ["wuzhu", "nominal", "disputed",
    "与武威同。酒泉黄华、张掖张进之乱在建安末黄初初，不属本年；本年郡中唯豪右自守。"],
  敦煌郡: ["wuzhu", "nominal", "disputed",
    "《张既传》注引《魏略》记敦煌「太守马艾卒官，府又无丞」，郡人推功曹张恭行长史事——汉末敦煌郡府之虚如此。本年中原方争，玉门以西更非许都所能问，故记无主。"],
  张掖属国: ["qianghu", "firm", "attested",
    "张掖属国为卢水胡所居，汉制属国以夷治夷，本年与河西诸郡同为自治。"],
  张掖居延属国: ["wuzhu", "nominal", "disputed",
    "居延孤悬塞外，本年汉家长吏有无失载，故记无主。"],

  // ═══ 并州 9 ═══
  上党郡: ["yuanshao", "contested", "attested",
    "袁绍以外甥高干为并州刺史（《武帝纪》建安九年「高干以并州降」，可证其久据）。惟上党诸山谷为黑山张燕出没之地（《张燕传》），郡境不能尽有，故记争夺。"],
  太原郡: ["yuanshao", "contested", "attested",
    "晋阳为并州治所，高干据之；而郡北接匈奴、西邻黑山，本年控制未固。"],
  上郡: ["xiongnu", "contested", "attested",
    "上郡自永和以来内徙，塞内为南匈奴诸部所居；右贤王去卑领其众处河东、西河之间，上郡在其游牧之内。"],
  西河郡: ["xiongnu", "firm", "attested",
    "南匈奴单于庭本在西河美稷，于夫罗卒后呼厨泉立，南徙平阳；西河塞内诸部仍为其所领（《后汉书·南匈奴列传》）。"],
  五原郡: ["xianbei", "nominal", "attested",
    "五原自汉末内徙，郡县久废，为鲜卑诸部游牧之地。"],
  云中郡: ["xianbei", "nominal", "attested",
    "云中与五原同，汉家郡治早移，塞内为鲜卑所有。"],
  定襄郡: ["xianbei", "nominal", "attested",
    "定襄自永和中内徙西河，郡治久废而名存实亡；塞内为鲜卑诸部所居，汉家长吏无闻。"],
  雁门郡: ["xianbei", "contested", "attested",
    "雁门当句注之险，为并州北面门户；汉家尚有郡县而鲜卑入寇不绝，故记争夺。"],
  朔方郡: ["xianbei", "nominal", "attested",
    "朔方远在河套，汉末久废，为鲜卑与杂胡所居。"],

  // ═══ 幽州 11 ═══
  涿郡: ["yuanshao", "firm", "attested",
    "建安四年三月袁绍拔易京、斩公孙瓒，尽有幽州之地（《武帝纪》《公孙瓒传》）。涿郡当幽冀之交，为其南面要道。"],
  广阳郡: ["yuanshao", "firm", "attested",
    "蓟为幽州治所，公孙瓒既灭，袁绍以子熙为幽州刺史领之。"],
  代郡: ["yuanshao", "contested", "attested",
    "代郡当幽并之交，塞外乌桓、鲜卑出入；袁绍虽有其地而边境不靖，故记争夺。"],
  上谷郡: ["yuanshao", "contested", "attested",
    "上谷北接塞外，难楼部乌桓居其境；袁绍矫制赐三部单于印绶以羁縻之，郡境名有而实不能专。"],
  渔阳郡: ["caocao", "nominal", "attested",
    "《武帝纪》建安四年：「鲜于辅将其众奉王命。以辅为建忠将军，督幽州六郡。」辅为刘虞旧部、渔阳人，本年奉许都正朔而处袁绍肘腋之间；所督六郡是名分而非实土，故记名义。官渡既胜，辅率众诣曹操于邺。"],
  右北平郡: ["wuhuan", "contested", "attested",
    "乌延部乌桓居右北平，自号汗鲁王；汉家郡县名存实亡，与袁绍互为表里。"],
  辽西郡: ["wuhuan", "firm", "attested",
    "蹋顿代丘力居总三部，居辽西；袁绍破公孙瓒数得其助，矫制赐其单于印绶（《三国志·乌丸传》）。"],
  辽东郡: ["gongsundu", "firm", "attested",
    "公孙度自立为辽东侯、平州牧，分辽东为辽西、中辽二郡置太守，东伐高句丽、西击乌丸，绝不奉中原号令。"],
  玄菟郡: ["gongsundu", "firm", "attested",
    "度本玄菟小吏，起家于此；既据辽东，玄菟随之。"],
  乐浪郡: ["gongsundu", "firm", "attested",
    "乐浪远在海东，公孙氏世有之，至其孙渊灭乃入魏（分屯有县以南为带方郡在公孙康时，不属本年）。"],
  辽东属国: ["wuhuan", "firm", "attested",
    "辽东属国为苏仆延部乌桓所居，自号峭王，与蹋顿相表里。"],

  // ═══ 交州 7 ═══
  南海郡: ["shixie", "contested", "disputed",
    "士燮表弟武领南海太守（《三国志·士燮传》）；而交州刺史张津治苍梧，南海当其肘腋，两家分权。授职确年失载，故标争议。"],
  苍梧郡: ["wuzhu", "contested", "disputed",
    "汉遣张津为交州刺史，治苍梧广信；津好鬼神、数以兵攻刘表而不克，建安八年为其将区景所杀（《士燮传》《薛综传》）。本年津虽在而孤悬岭表，与士氏分权，郡归属两说，故记无主并标争议。"],
  郁林郡: ["wuzhu", "nominal", "disputed",
    "郁林居岭表腹地，本年守相失载，士氏与交州刺史皆未实领，故记无主。"],
  合浦郡: ["shixie", "firm", "attested",
    "士燮表弟壹领合浦太守（《士燮传》），为士氏四郡之一。"],
  交趾郡: ["shixie", "firm", "attested",
    "士燮为交趾太守数十年，治龙编；中国士人避难往依者以百数，出入鸣钟磬、具威仪，南越之盛未有。"],
  九真郡: ["shixie", "firm", "attested",
    "士燮表弟䵋领九真太守（《士燮传》），为士氏四郡之一。"],
  日南郡: ["wuzhu", "nominal", "disputed",
    "日南为汉土最南之郡，道里绝远，本年守相失载，故记无主。"],
};

const commanderies = JSON.parse(fs.readFileSync(SRC, "utf8"));
const names = commanderies.map((c) => c.name);
const factionById = new Map(FACTIONS.map((f) => [f.id, f]));

const errors = [];
const ownKeys = Object.keys(OWN);
const missing = names.filter((n) => !(n in OWN));
const extra = ownKeys.filter((k) => !names.includes(k));
if (missing.length) errors.push(`缺失 ${missing.length} 个郡国：${missing.join("、")}`);
if (extra.length) errors.push(`多出 ${extra.length} 个键：${extra.join("、")}`);

const CONTROL = new Set(["firm", "contested", "nominal"]);
const CERTAINTY = new Set(["attested", "disputed"]);
const ownership = {};
for (const name of names) {
  const row = OWN[name];
  if (!row) continue;
  const [factionId, control, certainty, basis] = row;
  const f = factionById.get(factionId);
  if (!f) errors.push(`${name}: 未知势力 id ${factionId}`);
  if (!CONTROL.has(control)) errors.push(`${name}: 非法 control ${control}`);
  if (!CERTAINTY.has(certainty)) errors.push(`${name}: 非法 certainty ${certainty}`);
  if (!basis || basis.length < 20) errors.push(`${name}: basis 过短`);
  ownership[name] = { factionId, factionName: f ? f.name : null, control, certainty, basis };
}

const used = new Set(Object.values(ownership).map((o) => o.factionId));
for (const f of FACTIONS) if (!used.has(f.id)) errors.push(`势力 ${f.id} 未据有任何郡国`);

// 州牧号所指之州必须存在于郡国表里，否则「传檄而定」指向一个空州
const zhou = new Set(commanderies.map((c) => c.zhou));
for (const f of FACTIONS) {
  if (f.governorship && !zhou.has(f.governorship)) errors.push(`${f.id} 的州牧号指向未知州 ${f.governorship}`);
}
// 一州一牧
const seen = new Map();
for (const f of FACTIONS) {
  if (!f.governorship) continue;
  if (seen.has(f.governorship)) errors.push(`${f.governorship} 牧号被 ${seen.get(f.governorship)} 与 ${f.id} 两家持有`);
  seen.set(f.governorship, f.id);
}

if (errors.length) {
  console.error("校验失败：");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

const scenario = {
  meta: {
    year: 200,
    month: 1,
    era: "建安五年",
    label: "建安五年·官渡前夕",
    courtSeat: "颍川郡",
    courtBasis:
      "建安元年九月迁都于许（属颍川郡），天子在焉；曹操自领司隶校尉、录尚书事，"
      + "朝命悉出其手（《三国志·魏书·武帝纪》）。故以颍川郡之主为持朝廷者。",
    note:
      "官渡前夕剧本。时间切片取建安五年正月（公元 200 年 2 月前后）："
      + "袁绍去岁三月拔易京灭公孙瓒，大将军兼督冀青幽并四州，简精卒十万将以攻许；"
      + "曹操去岁四月定河内、十一月纳张绣之降，北屯官渡，本年正月董承事泄、"
      + "旋自将东征刘备。刘备去岁末杀车胄据下邳，本年二月即为曹操所破；"
      + "孙策已尽有江东，本年四月遇刺；张羡举长沙、零陵、桂阳三郡叛刘表而方在围中。"
      + "切片若推到年中，刘备已走、孙策已死、颜良文丑已没，势力图便残了。"
      + "归属分实控与名义两层：control=nominal 者多为授官、奉正朔或羁縻，无实际军政控制。"
      + "史料缺载或年份本身有争议者标 certainty=disputed，分歧写在 basis 内。"
      + "郡国名称与建置取《后汉书·郡国志》，与 commanderies.json 严格对齐（105 个）——"
      + "本年实际已有分郡之事（公孙度分辽东、刘璋分巴郡），为与 194 剧本共用一张通行图而不另立新郡，"
      + "此为**刻意的简化**，已在相关 basis 内注明。"
      + "凉州河西四郡与安定，194 剧本记在持朝廷者（李傕）名下，本年改记无主——"
      + "朝廷已东迁至许，相去数千里，而河西此时郡府多虚；仍记在许都名下会凭空给曹操五个郡，"
      + "把官渡前的强弱写反。",
    source:
      "《三国志》《后汉书》《资治通鉴》卷六十三（皆公有领域）；郡国建置据《续汉书·郡国志》。",
    factionCount: FACTIONS.length,
    commanderyCount: names.length,
  },
  factions: FACTIONS,
  ownership,
};

fs.writeFileSync(OUT, JSON.stringify(scenario, null, 2) + "\n");

const a = new Set(Object.keys(ownership));
const b = new Set(names);
const equal = a.size === b.size && [...a].every((k) => b.has(k));
console.log(`ownership 键数 = ${a.size}，commanderies name 数 = ${b.size}`);
console.log(`键集合相等：${equal ? "是 ✓" : "否 ✗"}`);

const tally = new Map();
for (const o of Object.values(ownership)) tally.set(o.factionId, (tally.get(o.factionId) || 0) + 1);
console.log("\n势力占郡数（降序）：");
for (const [id, n] of [...tally].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${String(n).padStart(3)}  ${id.padEnd(12)} ${factionById.get(id).name}`);
}
const byControl = {}, byCert = {};
for (const o of Object.values(ownership)) {
  byControl[o.control] = (byControl[o.control] || 0) + 1;
  byCert[o.certainty] = (byCert[o.certainty] || 0) + 1;
}
console.log("\ncontrol：", JSON.stringify(byControl), " certainty：", JSON.stringify(byCert));
console.log(`\n已写出 ${OUT}`);
if (!equal) process.exit(1);
