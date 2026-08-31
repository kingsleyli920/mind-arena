// 开发用水系：Natural Earth 主干 + 黄河东汉故道人工复原
import fs from "node:fs";
const S="/private/tmp/claude-501/-Users-kingsley-projects-mind-arena/4b36ddea-9dda-4576-9434-0619c8631613/scratchpad";
const B={w:94,e:127,s:16,n:43};
const g=JSON.parse(fs.readFileSync(S+"/ne_rivers.geojson","utf8"));

// 汉末战略相关的主要水系（Natural Earth 名称 → 汉代名）
const WANT={Yangtze:"长江",Han:"汉水",Huai:"淮水",Wei:"渭水",Fen:"汾水",
  Xiang:"湘水",Gan:"赣水",Min:"岷江",Jialing:"嘉陵江",Wu:"乌江",Yalu:"鸭绿江",
  Liao:"辽水",Sanggan:"㶟水",Yi:"沂水",Si:"泗水",Xi:"西江",Bei:"北江",Dong:"东江",Yuan:"沅水",Zi:"资水"};
const inBox=(p)=>p[0]>=B.w&&p[0]<=B.e&&p[1]>=B.s&&p[1]<=B.n;
const lines=[];
for(const f of g.features){
  const n=f.properties.name||f.properties.name_en||"";
  const key=Object.keys(WANT).find(k=>n===k||n.startsWith(k+" ")||n.includes(k));
  if(!key) continue;
  const geoms=f.geometry.type==="MultiLineString"?f.geometry.coordinates:[f.geometry.coordinates];
  for(const seg of geoms){
    const pts=seg.filter(inBox);
    if(pts.length>=3) lines.push({id:key.toLowerCase(),name:WANT[key],historical:false,points:pts.map(p=>[+p[0].toFixed(3),+p[1].toFixed(3)])});
  }
}

// 黄河东汉故道（王景治河，公元 69–70 年）。自荥阳以下向东北，
// 经今濮阳、聊城、德州以东，在今山东利津附近入渤海。
// 与今日河道（经济南、东营入海）不同，与北宋后夺淮入海更完全不同。
// 依据：《后汉书·王景传》记载治渠筑堤自荥阳东至千乘海口；千乘故城在今山东高青东北，
// 河口在今利津一带。上游（河套至龙门至潼关）汉末与今差异不大，沿用 Natural Earth 走向。
const YELLOW_HAN=[
 [106.9,37.5],[107.9,39.2],[109.3,40.3],[110.6,40.4],[111.4,40.2],[111.2,39.3],[110.8,38.2],
 [110.5,37.2],[110.4,36.2],[110.5,35.5],[110.3,34.8],[110.9,34.7],[111.8,34.8],[112.6,34.9],
 [113.4,34.9],   // 荥阳、敖仓 —— 东汉故道自此东北行
 [114.0,35.2],[114.55,35.67],[115.03,35.9],[115.6,36.2],[116.0,36.5],[116.2,36.9],
 [116.4,37.3],[117.0,37.4],[117.6,37.5],[118.1,37.6],[118.35,37.75],[118.75,37.9]  // 利津入海
];
lines.push({id:"huanghe",name:"黄河",historical:true,
  note:"东汉故道（王景治河后）。荥阳以下东北行，经濮阳、聊城、德州以东，利津入渤海；与现代河道及北宋后夺淮入海路线均不同。",
  points:YELLOW_HAN});

// Natural Earth 里名为 Huang 的现代河道剔除，避免与故道并存
const out=lines.filter(l=>l.id!=="huang");

const fords=[
 {id:"mengjin",name:"孟津",river:"黄河",longitude:112.44,latitude:34.83},
 {id:"baima",name:"白马津",river:"黄河",longitude:114.65,latitude:35.60},
 {id:"yanjin",name:"延津",river:"黄河",longitude:114.20,latitude:35.30},
 {id:"guandu",name:"官渡",river:"黄河",longitude:114.02,latitude:34.82},
 {id:"liyang",name:"黎阳津",river:"黄河",longitude:114.55,latitude:35.67},
 {id:"puban",name:"蒲坂津",river:"黄河",longitude:110.33,latitude:34.85},
 {id:"xiakou",name:"夏口",river:"长江",longitude:114.29,latitude:30.60},
 {id:"niuzhu",name:"牛渚",river:"长江",longitude:118.47,latitude:31.66},
 {id:"ruxu",name:"濡须口",river:"长江",longitude:117.92,latitude:31.14},
 {id:"hukou",name:"湖口",river:"长江",longitude:116.22,latitude:29.73},
 {id:"jiangjin",name:"江津",river:"长江",longitude:112.38,latitude:30.25},
];
fs.writeFileSync(S+"/hydrology-dev.json",JSON.stringify({
  meta:{...B,license:"Natural Earth (public domain) + 黄河东汉故道人工复原",dev:true},
  rivers:out,fords},null,1));
const byName={};for(const l of out)byName[l.name]=(byName[l.name]||0)+l.points.length;
console.log("水系:",Object.entries(byName).map(([k,v])=>`${k}${v}点`).join(" "));
const h=out.find(l=>l.id==="huanghe");
console.log(`黄河入海口 ${h.points.at(-1)} —— 应在利津附近 (约 118.3E, 37.8N)`);
