export type HistoricalPlaceKind =
  | "province-seat"
  | "commandery-seat"
  | "county-seat"
  | "settlement"
  | "village"
  | "stronghold"
  | "gate"
  | "port"
  | "crossing"
  | "battlefield";

export type HistoricalCertainty = "attested" | "located-approx" | "scenario-inferred" | "game-abstract";

export interface HistoricalPlace {
  id: string;
  name: string;
  kind: HistoricalPlaceKind;
  province: string;
  commandery: string;
  modernReference: string;
  longitude: number;
  latitude: number;
  rank: 1 | 2 | 3;
  operational: boolean;
  certainty: HistoricalCertainty;
  historicalNote: string;
  sourceIds: string[];
}

export interface HistoricalRegionLabel {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
}

export interface HistoricalRoute {
  from: string;
  to: string;
  terrain: "官道" | "平原" | "山道" | "关隘" | "大河";
  routeName?: string;
}

export const HISTORICAL_MAP_SOURCES = {
  naturalEarthRelief: {
    label: "Natural Earth I · 1:50m shaded relief",
    url: "https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-1/",
    use: "公共领域自然地理底层；裁切到中国范围后进行原创宣纸与水墨调色，不含现代边界和标签",
  },
  easternHan189: {
    label: "Eastern Han in 189 AD",
    url: "https://commons.wikimedia.org/wiki/File:Eastern_Han_in_189_AD.png",
    use: "州域与汉末地理关系的现代重建参考（CC BY 3.0），不直接充当 194 年势力图",
  },
  rtk8RegionalMap: {
    label: "ROMANCE OF THE THREE KINGDOMS 8 Remake · Full/Regional Map",
    url: "https://www.koeitecmoamerica.com/manual/rtk8-remake/en/6100.html",
    use: "主要城市层级与区域分组的游戏设计参照，不复制地图或美术",
  },
  rtk14LandStructure: {
    label: "ROMANCE OF THE THREE KINGDOMS XIV · Land Structure",
    url: "https://www.koeitecmoamerica.com/manual/rtk14/en/3100.html",
    use: "城市、关隘、港口作为区域控制核心的规则参照",
  },
  wikidata: {
    label: "Wikidata historical places",
    url: "https://www.wikidata.org/",
    use: "地点别名、现代对应与坐标的 CC0 校对来源；本原型中的坐标仍按战略尺度近似",
  },
} as const;

const sources = ["rtk8RegionalMap", "wikidata"];

const place = (
  id: string,
  name: string,
  province: string,
  commandery: string,
  modernReference: string,
  longitude: number,
  latitude: number,
  rank: 1 | 2 | 3 = 2,
  kind: HistoricalPlaceKind = "commandery-seat",
  historicalNote = "汉末郡国治所的战略尺度近似位置",
  operational = true,
  certainty: HistoricalCertainty = "located-approx",
  sourceIds: string[] = sources,
): HistoricalPlace => ({
  id, name, province, commandery, modernReference, longitude, latitude, rank, kind,
  historicalNote, operational, certainty, sourceIds,
});

/**
 * The 51-city backbone follows the official RTK8 Remake regional-map inventory.
 * Coordinates are modern-reference approximations for strategic display, not claims of
 * excavated wall-centre precision. Smaller nodes below it carry their own certainty flags.
 */
export const HISTORICAL_PLACES: HistoricalPlace[] = [
  // 西北：凉州、雍州、司隶
  place("wuwei", "武威", "凉州", "武威郡", "甘肃武威", 102.64, 37.93, 2),
  place("xiping", "西平", "凉州", "西平郡", "青海西宁一带", 101.78, 36.62, 2),
  place("tianshui", "天水", "凉州", "汉阳郡", "甘肃天水", 105.72, 34.58, 2),
  place("changan", "长安", "司隶", "京兆尹", "陕西西安汉长安城遗址", 108.86, 34.36, 1, "province-seat", "东汉末年天子与关中政权的核心"),
  place("hongnong", "弘农", "司隶", "弘农郡", "河南灵宝一带", 110.87, 34.52, 2),
  place("luoyang", "洛阳", "司隶", "河南尹", "河南偃师汉魏洛阳城遗址", 112.64, 34.72, 1, "province-seat", "东汉旧都；194 年经历兵乱后的政治象征"),

  // 益州与南中
  place("wudu", "武都", "益州", "武都郡", "甘肃成县、西和一带", 105.72, 33.75, 2),
  place("hanzhong", "汉中", "益州", "汉中郡", "陕西汉中盆地", 107.03, 33.07, 1, "commandery-seat", "秦岭与巴山之间的入蜀咽喉"),
  place("zitong", "梓潼", "益州", "梓潼郡", "四川梓潼", 105.16, 31.64, 2),
  place("chengdu", "成都", "益州", "蜀郡", "四川成都", 104.07, 30.67, 1, "province-seat", "益州州治与成都平原中心"),
  place("jiangzhou", "江州", "益州", "巴郡", "重庆主城一带", 106.55, 29.56, 2),
  place("yongan", "永安", "益州", "巴东郡", "重庆奉节一带", 109.46, 31.02, 2),
  place("yongchang", "永昌", "益州", "永昌郡", "云南保山一带", 99.17, 25.11, 2),
  place("jianning", "建宁", "益州", "建宁郡", "云南曲靖一带", 103.80, 25.49, 2),
  place("yunnan", "云南", "益州", "云南郡", "云南姚安一带", 101.24, 25.51, 2),

  // 河北：幽、并、冀
  place("shangdang", "上党", "并州", "上党郡", "山西长治一带", 113.12, 36.20, 2),
  place("jinyang", "晋阳", "并州", "太原郡", "山西太原晋源一带", 112.48, 37.75, 1, "province-seat"),
  place("ji", "蓟", "幽州", "广阳郡", "北京蓟城遗址范围", 116.37, 39.88, 1, "province-seat"),
  place("beiping", "北平", "幽州", "右北平郡", "河北唐山北部一带", 118.18, 39.63, 2),
  place("xiangping", "襄平", "幽州", "辽东郡", "辽宁辽阳", 123.24, 41.27, 2),
  place("nanpi", "南皮", "冀州", "渤海郡", "河北南皮", 116.71, 38.04, 2),
  place("pingyuan", "平原", "青州", "平原郡", "山东平原", 116.45, 37.17, 2),
  place("ye", "邺", "冀州", "魏郡", "河北临漳邺城遗址", 114.62, 36.34, 1, "province-seat", "袁绍经营河北的重要中心"),

  // 中原：兖、豫、徐、青
  place("chenliu", "陈留", "兖州", "陈留郡", "河南开封陈留一带", 114.35, 34.79, 1),
  place("puyang", "濮阳", "兖州", "东郡", "河南濮阳", 115.03, 35.76, 1),
  place("beihai", "北海", "青州", "北海国", "山东寿光一带", 118.73, 36.88, 2),
  place("jinan", "济南", "青州", "济南国", "山东章丘一带", 117.53, 36.72, 2),
  place("qiao", "谯", "豫州", "沛国", "安徽亳州", 115.78, 33.87, 2, "county-seat", "曹操故里与豫州北部节点"),
  place("xuxian", "许县", "豫州", "颍川郡", "河南许昌", 113.85, 34.04, 1, "county-seat", "196 年后迎献帝而成为许都；194 年仍称许县"),
  place("runan", "汝南", "豫州", "汝南郡", "河南上蔡一带", 114.26, 33.26, 2),
  place("xiaopei", "小沛", "豫州", "沛国", "江苏沛县", 116.94, 34.72, 2, "county-seat"),
  place("xiapi", "下邳", "徐州", "下邳国", "江苏睢宁、邳州一带", 117.95, 34.31, 1, "province-seat"),

  // 荆楚
  place("wan", "宛", "荆州", "南阳郡", "河南南阳", 112.53, 32.99, 1),
  place("shangyong", "上庸", "荆州", "上庸郡", "湖北竹山一带", 110.23, 32.23, 2),
  place("xiangyang", "襄阳", "荆州", "南郡北部", "湖北襄阳", 112.14, 32.01, 1, "province-seat", "荆襄北门与汉水要冲"),
  place("xinye", "新野", "荆州", "南阳郡", "河南新野", 112.36, 32.52, 3, "county-seat"),
  place("jiangxia", "江夏", "荆州", "江夏郡", "湖北武汉及其周边", 114.31, 30.59, 1),
  place("jiangling", "江陵", "荆州", "南郡", "湖北荆州", 112.42, 30.35, 1, "province-seat"),
  place("wuling", "武陵", "荆州", "武陵郡", "湖南常德", 111.69, 29.04, 2),
  place("changsha", "长沙", "荆州", "长沙郡", "湖南长沙", 112.94, 28.23, 1),
  place("guiyang", "桂阳", "荆州", "桂阳郡", "湖南郴州", 113.01, 25.77, 2),
  place("lingling", "零陵", "荆州", "零陵郡", "湖南永州", 111.61, 26.42, 2),

  // 淮南、江东、交州
  place("shouchun", "寿春", "扬州", "九江郡", "安徽寿县", 116.79, 32.57, 1, "province-seat"),
  place("guangling", "广陵", "徐州", "广陵郡", "江苏扬州", 119.42, 32.39, 2),
  place("lujiang", "庐江", "扬州", "庐江郡", "安徽舒城一带", 117.10, 31.50, 2),
  place("moling", "秣陵", "扬州", "丹阳郡", "江苏南京", 118.80, 32.06, 1, "county-seat", "194 年仍称秣陵；孙权时期后称建业"),
  place("wu", "吴", "扬州", "吴郡", "江苏苏州", 120.59, 31.30, 1),
  place("kuaiji", "会稽", "扬州", "会稽郡", "浙江绍兴", 120.58, 30.00, 1),
  place("poyang", "鄱阳", "扬州", "豫章郡", "江西鄱阳", 116.70, 29.00, 2, "county-seat"),
  place("chaisang", "柴桑", "扬州", "豫章郡", "江西九江", 115.99, 29.71, 2, "county-seat"),
  place("jiaozhi", "交趾", "交州", "交趾郡", "越南河内及北部平原", 105.85, 21.03, 1, "province-seat"),

  // 关隘、港口、渡口和可辨识小据点：缩放后显示。
  place("hulao", "虎牢关", "司隶", "河南尹", "河南荥阳汜水一带", 113.18, 34.82, 2, "gate", "洛阳东面的著名关隘；按战略尺度标注", true, "located-approx", ["rtk14LandStructure", "wikidata"]),
  place("hangu", "函谷关", "司隶", "弘农郡", "河南新安汉函谷关遗址", 112.06, 34.72, 2, "gate", "汉代东移后的函谷关位置", true, "attested", ["easternHan189", "wikidata"]),
  place("tongguan", "潼关", "司隶", "弘农郡", "陕西潼关", 110.24, 34.55, 2, "gate", "东汉末年逐渐取代函谷关的关中东门；194 剧本属时间压缩", true, "scenario-inferred", ["rtk14LandStructure", "wikidata"]),
  place("wuguan", "武关", "司隶", "弘农郡", "陕西丹凤东南", 110.56, 33.52, 2, "gate", "关中通往南阳的山道关口"),
  place("sanguan", "散关", "雍州", "扶风郡", "陕西宝鸡西南", 106.99, 34.24, 3, "gate", "关中西南通道"),
  place("yangping", "阳平关", "益州", "汉中郡", "陕西勉县西部一带", 106.58, 33.15, 2, "gate", "汉中西口要塞", true, "located-approx", ["rtk14LandStructure", "wikidata"]),
  place("jianmen", "剑门", "益州", "蜀郡北部", "四川剑阁", 105.52, 32.22, 2, "gate", "剑阁栈道防线；具体关城形制随年代变化", true, "located-approx"),
  place("jiameng", "葭萌", "益州", "广汉郡", "四川广元昭化一带", 105.82, 32.32, 3, "gate", "蜀道北段的重要县城与关口", true, "located-approx"),
  place("guandu", "官渡", "兖州", "陈留郡", "河南中牟东北一带", 114.02, 34.82, 3, "crossing", "黄河南岸渡口与 200 年官渡战场", true, "located-approx"),
  place("baima", "白马", "兖州", "东郡", "河南滑县东北一带", 114.65, 35.58, 3, "crossing", "黄河渡口与白马之战地点", true, "located-approx"),
  place("yanjin", "延津", "兖州", "陈留郡", "河南延津北部", 114.20, 35.16, 3, "crossing", "黄河南岸渡口", true, "located-approx"),
  place("xiakou", "夏口", "荆州", "江夏郡", "湖北武汉汉口一带", 114.29, 30.60, 2, "port", "汉水入江处的水陆枢纽", true, "located-approx"),
  place("hukou", "湖口", "扬州", "豫章郡", "江西湖口", 116.22, 29.73, 3, "port", "鄱阳湖入长江口", true, "located-approx"),
  place("jiangjin", "江津", "荆州", "南郡", "湖北荆州江南渡口一带", 112.38, 30.25, 3, "port", "江陵附近的长江津渡", true, "located-approx"),
  place("hanjin", "汉津", "荆州", "南郡", "湖北荆门沙洋一带", 112.52, 30.70, 3, "port", "汉水下游津渡", true, "located-approx"),
  place("ruxu", "濡须口", "扬州", "庐江郡", "安徽无为东南一带", 117.92, 31.14, 2, "port", "濡须水入长江的军事港口", true, "located-approx"),
  place("niuzhu", "牛渚", "扬州", "丹阳郡", "安徽马鞍山采石矶一带", 118.47, 31.66, 2, "port", "长江重要渡口与水军据点", true, "located-approx"),
  place("jiangdu", "江都", "徐州", "广陵郡", "江苏扬州东部", 119.57, 32.43, 3, "port", "江淮水路节点", true, "located-approx"),
  place("zhuo", "涿县", "幽州", "涿郡", "河北涿州", 115.97, 39.49, 3, "county-seat", "刘备故里所在县", false, "located-approx"),
  place("longzhong", "隆中", "荆州", "南阳郡", "湖北襄阳隆中", 111.99, 32.00, 3, "settlement", "诸葛亮躬耕地的传统对应点；194 年仅作聚落注记", false, "located-approx"),
  place("bowang", "博望", "荆州", "南阳郡", "河南方城博望一带", 112.82, 33.13, 3, "settlement", "宛城—新野道路上的县级节点", false, "located-approx"),
  place("fancheng", "樊城", "荆州", "南郡北部", "湖北襄阳樊城", 112.13, 32.05, 3, "county-seat", "汉水北岸城塞", false, "located-approx"),
  place("changban", "长坂", "荆州", "南郡", "湖北当阳一带", 111.79, 30.82, 3, "battlefield", "208 年长坂坡事件地点；作为道路节点标注", false, "located-approx"),
  place("maicheng", "麦城", "荆州", "南郡", "湖北当阳东南一带", 111.92, 30.72, 3, "settlement", "关羽败走麦城的传统对应点", false, "located-approx"),
  place("wulin", "乌林", "荆州", "南郡", "湖北洪湖长江北岸一带", 113.68, 29.84, 3, "port", "赤壁战役北岸水军营地", false, "located-approx"),
  place("chibi", "赤壁", "荆州", "长沙郡北部", "湖北赤壁长江南岸一带", 113.63, 29.72, 3, "battlefield", "208 年赤壁战场的常见定位之一", false, "located-approx"),
  place("wuzhangyuan", "五丈原", "雍州", "扶风郡", "陕西岐山五丈原", 107.62, 34.26, 3, "battlefield", "234 年诸葛亮北伐终点；作为关中道路地标", false, "attested"),
  place("hefei", "合肥", "扬州", "九江郡", "安徽合肥", 117.23, 31.82, 3, "county-seat", "淮南东部城塞，后为魏吴争夺焦点", false, "located-approx"),

  // 更细的县、堡、村寨与水陆节点：作为近景地图对象，不进入首版季度结算图。
  place("lintao", "临洮", "凉州", "陇西郡", "甘肃岷县一带", 103.86, 35.38, 3, "county-seat", "陇西南缘县治与羌道节点", false, "located-approx"),
  place("chencang", "陈仓", "雍州", "扶风郡", "陕西宝鸡陈仓一带", 107.22, 34.37, 3, "stronghold", "渭水西端的仓城与关中门户", false, "located-approx"),
  place("fuping", "富平", "雍州", "左冯翊", "陕西富平一带", 109.15, 34.75, 3, "county-seat", "长安东北的县级补给节点", false, "located-approx"),
  place("chenggao", "成皋", "司隶", "河南尹", "河南荥阳汜水附近", 113.16, 34.78, 3, "gate", "洛阳东出控制荥阳盆地的险要城塞", false, "located-approx"),
  place("aocang", "敖仓", "司隶", "河南尹", "河南荥阳北部敖山一带", 113.45, 34.92, 3, "stronghold", "楚汉以来著名粮仓，汉末仍具粮道象征意义", false, "located-approx"),
  place("xingyang", "荥阳", "司隶", "河南尹", "河南荥阳", 113.38, 34.79, 3, "county-seat", "成皋、敖仓与虎牢之间的交通节点", false, "located-approx"),
  place("suanzao", "酸枣", "兖州", "陈留郡", "河南延津西南一带", 114.67, 35.18, 3, "stronghold", "关东联军会盟的传统对应区域", false, "located-approx"),
  place("yangwu", "阳武", "兖州", "陈留郡", "河南原阳一带", 113.95, 34.92, 3, "county-seat", "黄河南岸道路上的县治", false, "located-approx"),
  place("xutian", "许田", "豫州", "颍川郡", "河南许昌东南一带", 113.90, 33.95, 3, "village", "许县近郊田猎与屯田空间的玩法注记", false, "game-abstract"),

  place("lou_sang", "楼桑村", "幽州", "涿郡", "河北涿州附近的传统对应地", 116.02, 39.51, 3, "village", "刘备故里传说中的村落节点", false, "located-approx"),
  place("yijing", "易京", "幽州", "涿郡", "河北雄县、霸州一带", 116.04, 39.10, 3, "stronghold", "公孙瓒经营的高楼堡垒群", false, "located-approx"),
  place("jieqiao", "界桥", "冀州", "安平国", "河北威县、广宗一带", 115.30, 37.25, 3, "battlefield", "袁绍与公孙瓒交战的传统定位区", false, "located-approx"),
  place("liyang", "黎阳", "冀州", "魏郡", "河南浚县一带", 114.55, 35.67, 3, "crossing", "黄河北岸仓城与津渡", false, "located-approx"),
  place("chaoge", "朝歌", "冀州", "河内郡东缘", "河南淇县", 114.20, 35.62, 3, "county-seat", "太行东麓通往邺城的道路节点", false, "located-approx"),
  place("linzi", "临淄", "青州", "齐国", "山东淄博临淄", 118.31, 36.82, 3, "county-seat", "齐地故都与青州腹地节点", false, "attested"),
  place("changguo", "昌国", "青州", "齐国", "山东淄博东部一带", 118.46, 36.67, 3, "stronghold", "临淄以东的县城与山口据点", false, "located-approx"),

  place("jiyang", "棘阳", "荆州", "南阳郡", "河南新野北部一带", 112.70, 33.00, 3, "county-seat", "宛城通往新野的道路县治", false, "located-approx"),
  place("zhangling", "章陵", "荆州", "南阳郡", "湖北枣阳一带", 112.08, 32.17, 3, "county-seat", "汉室宗亲故里与荆襄北部节点", false, "located-approx"),
  place("yicheng", "宜城", "荆州", "南郡", "湖北宜城", 112.25, 31.72, 3, "county-seat", "襄阳南下江陵道路上的县治", false, "located-approx"),
  place("dangyang", "当阳", "荆州", "南郡", "湖北当阳", 111.79, 30.82, 3, "county-seat", "江陵北面的陆路节点", false, "located-approx"),
  place("huarong", "华容", "荆州", "南郡", "湖北监利、石首一带", 112.58, 29.52, 3, "village", "江汉平原南缘的湖泽道路节点", false, "located-approx"),
  place("youjiang", "油江口", "荆州", "南郡", "湖北公安县长江沿岸", 112.20, 29.86, 3, "port", "江陵南侧的长江水军与渡运节点", false, "located-approx"),

  place("mianzhu", "绵竹", "益州", "广汉郡", "四川德阳绵竹", 104.22, 31.34, 3, "county-seat", "成都平原北缘县城", false, "located-approx"),
  place("luocheng", "雒城", "益州", "广汉郡", "四川广汉一带", 104.28, 30.99, 3, "stronghold", "成都北面的坚城与广汉郡治节点", false, "located-approx"),
  place("baishui", "白水关", "益州", "广汉郡", "四川广元青川一带", 105.75, 32.49, 3, "gate", "阴平与葭萌之间的蜀道关口", false, "located-approx"),
  place("baxi", "巴西", "益州", "巴西郡", "四川阆中一带", 106.08, 31.35, 3, "commandery-seat", "嘉陵江中游的郡治与粮运节点", false, "located-approx"),
  place("linjiang", "临江", "益州", "巴郡", "重庆忠县一带", 108.03, 30.30, 3, "port", "巴郡长江水路中继港", false, "located-approx"),

  place("qu_a", "曲阿", "扬州", "丹阳郡", "江苏丹阳", 119.57, 31.99, 3, "county-seat", "孙策经营江东早期的重要县城", false, "located-approx"),
  place("dantu", "丹徒", "扬州", "丹阳郡", "江苏镇江", 119.44, 32.20, 3, "port", "长江下游南岸津渡", false, "located-approx"),
  place("fuchun", "富春", "扬州", "吴郡", "浙江富阳", 119.95, 30.05, 3, "county-seat", "钱塘江上游县治与孙氏故里", false, "located-approx"),
  place("qiantang", "钱塘", "扬州", "吴郡", "浙江杭州", 120.20, 30.25, 3, "port", "钱塘江口的县城与水运节点", false, "located-approx"),
  place("yuzhang", "豫章", "扬州", "豫章郡", "江西南昌", 115.85, 28.68, 2, "commandery-seat", "赣江流域的郡治与江南腹地中心", false, "located-approx"),
  place("haihun", "海昏", "扬州", "豫章郡", "江西南昌北部、鄱阳湖西岸", 115.79, 29.16, 3, "village", "鄱阳湖西岸聚落与水路节点", false, "located-approx"),
  place("shiting", "石亭", "扬州", "庐江郡", "安徽潜山、桐城一带", 116.87, 30.97, 3, "stronghold", "皖西丘陵与江淮道路的寨堡节点", false, "located-approx"),

  place("cangwu", "苍梧", "交州", "苍梧郡", "广西梧州", 111.28, 23.48, 2, "commandery-seat", "西江水系的交州东部郡治", false, "located-approx"),
  place("panyu", "番禺", "交州", "南海郡", "广东广州", 113.26, 23.13, 2, "port", "南海郡治与珠江口港城", false, "located-approx"),
  place("hepu", "合浦", "交州", "合浦郡", "广西北海、合浦一带", 109.12, 21.49, 3, "port", "海上交通与珠玑贸易节点", false, "located-approx"),
];

export const REGION_LABELS: HistoricalRegionLabel[] = [
  { id: "liang", name: "凉州", longitude: 101.8, latitude: 38.6 },
  { id: "yong", name: "雍州", longitude: 107.4, latitude: 35.8 },
  { id: "sili", name: "司隶", longitude: 111.5, latitude: 34.8 },
  { id: "yi", name: "益州", longitude: 104.5, latitude: 29.2 },
  { id: "you", name: "幽州", longitude: 119.0, latitude: 40.5 },
  { id: "bing", name: "并州", longitude: 111.5, latitude: 38.1 },
  { id: "ji", name: "冀州", longitude: 115.3, latitude: 37.0 },
  { id: "qing", name: "青州", longitude: 118.8, latitude: 36.3 },
  { id: "yan", name: "兖州", longitude: 115.2, latitude: 35.0 },
  { id: "yu", name: "豫州", longitude: 113.9, latitude: 33.4 },
  { id: "xu", name: "徐州", longitude: 118.4, latitude: 34.0 },
  { id: "jing", name: "荆州", longitude: 112.4, latitude: 29.0 },
  { id: "yang", name: "扬州", longitude: 118.6, latitude: 29.8 },
  { id: "jiao", name: "交州", longitude: 106.4, latitude: 22.0 },
];

const road = (from: string, to: string, terrain: HistoricalRoute["terrain"] = "官道", routeName?: string): HistoricalRoute => ({ from, to, terrain, routeName });

export const HISTORICAL_ROUTES: HistoricalRoute[] = [
  road("xiping", "wuwei", "山道"), road("wuwei", "tianshui", "山道"), road("tianshui", "sanguan", "山道", "陇右道"),
  road("sanguan", "changan", "关隘"), road("changan", "tongguan", "关隘"), road("tongguan", "hongnong", "关隘"),
  road("hongnong", "hangu", "关隘"), road("hangu", "luoyang", "关隘"), road("luoyang", "hulao", "关隘"), road("hulao", "chenliu"),
  road("changan", "wuguan", "山道"), road("wuguan", "wan", "关隘"), road("changan", "wuzhangyuan"), road("wuzhangyuan", "tianshui", "山道"),
  road("tianshui", "wudu", "山道"), road("wudu", "yangping", "山道"), road("yangping", "hanzhong", "关隘"),
  road("hanzhong", "jiameng", "山道"), road("jiameng", "jianmen", "关隘"), road("jianmen", "zitong", "关隘"), road("zitong", "chengdu"),
  road("chengdu", "jiangzhou"), road("jiangzhou", "yongan", "大河", "长江水道"), road("yongan", "jiangling", "大河", "三峡水道"),
  road("chengdu", "yunnan", "山道"), road("yunnan", "yongchang", "山道"), road("yunnan", "jianning", "山道"), road("jianning", "jiaozhi", "山道"),

  road("xiangping", "beiping"), road("beiping", "ji"), road("ji", "zhuo"), road("zhuo", "nanpi"), road("beiping", "nanpi"),
  road("jinyang", "shangdang", "山道"), road("shangdang", "ye", "山道"), road("jinyang", "ye", "山道"),
  road("nanpi", "ye"), road("nanpi", "pingyuan"), road("pingyuan", "jinan"), road("jinan", "beihai"), road("pingyuan", "puyang"), road("ye", "puyang"),
  road("ye", "baima"), road("baima", "puyang", "大河"), road("baima", "yanjin"), road("yanjin", "guandu"), road("guandu", "chenliu"),
  road("puyang", "chenliu"), road("chenliu", "xuxian"), road("chenliu", "luoyang"), road("chenliu", "qiao"),
  road("qiao", "xiaopei"), road("xiaopei", "xiapi"), road("xiapi", "guangling"), road("beihai", "xiapi"),
  road("xuxian", "runan"), road("runan", "shouchun"), road("qiao", "shouchun"), road("xuxian", "wan"),

  road("wan", "bowang"), road("bowang", "xinye"), road("xinye", "xiangyang"), road("xiangyang", "fancheng", "大河"),
  road("xiangyang", "shangyong", "山道"), road("shangyong", "hanzhong", "山道"), road("xiangyang", "hanjin", "大河"),
  road("hanjin", "changban"), road("changban", "maicheng"), road("maicheng", "jiangling"), road("jiangling", "jiangjin", "大河"),
  road("jiangjin", "wuling", "大河"), road("wuling", "lingling"), road("wuling", "changsha"), road("lingling", "guiyang", "山道"), road("guiyang", "changsha"),
  road("xiangyang", "jiangxia"), road("jiangxia", "xiakou", "大河"), road("xiakou", "wulin", "大河"), road("wulin", "chibi", "大河"), road("chibi", "changsha", "大河"),
  road("jiangling", "wulin", "大河"), road("jiangxia", "shouchun"), road("jiangxia", "lujiang", "大河"),

  road("shouchun", "hefei"), road("hefei", "lujiang"), road("shouchun", "guangling"), road("guangling", "jiangdu", "大河"), road("jiangdu", "moling", "大河"),
  road("lujiang", "ruxu"), road("ruxu", "niuzhu", "大河"), road("niuzhu", "moling", "大河"), road("moling", "wu"), road("wu", "kuaiji"),
  road("lujiang", "chaisang"), road("chaisang", "hukou", "大河"), road("hukou", "poyang", "大河"), road("poyang", "kuaiji", "山道"), road("chaisang", "jiangxia", "大河"),
];

export const MAP_VIEWBOX = { x: 0, y: 0, width: 1000, height: 620 } as const;
const CHINA_BOUNDS = { west: 73.5, east: 135, north: 53.6, south: 18.2 } as const;

export function projectLongitudeLatitude(longitude: number, latitude: number) {
  const absoluteX = ((longitude - CHINA_BOUNDS.west) / (CHINA_BOUNDS.east - CHINA_BOUNDS.west)) * 1000;
  const absoluteY = ((CHINA_BOUNDS.north - latitude) / (CHINA_BOUNDS.north - CHINA_BOUNDS.south)) * 620;
  return {
    x: ((absoluteX - MAP_VIEWBOX.x) / MAP_VIEWBOX.width) * 100,
    y: ((absoluteY - MAP_VIEWBOX.y) / MAP_VIEWBOX.height) * 100,
  };
}

export function getHistoricalPlace(id: string) {
  return HISTORICAL_PLACES.find((candidate) => candidate.id === id);
}

export const RIVER_PATHS = [
  { id: "yellow", name: "黄河", points: [[101.8, 35.0], [104.3, 36.0], [106.8, 37.0], [109.2, 37.6], [111.3, 35.1], [113.4, 34.9], [115.1, 35.3], [116.5, 37.0], [118.8, 37.6]] },
  { id: "yangtze", name: "长江", points: [[104.1, 29.6], [106.6, 29.6], [109.5, 30.5], [112.4, 30.3], [114.3, 30.6], [116.0, 29.7], [118.8, 31.3], [121.5, 31.2]] },
  { id: "han", name: "汉水", points: [[107.0, 33.1], [109.0, 32.7], [111.0, 32.2], [112.1, 32.0], [114.3, 30.6]] },
  { id: "huai", name: "淮水", points: [[113.0, 32.4], [115.0, 32.6], [116.8, 32.5], [119.1, 33.1]] },
] as const;
