// 把一份录像 JSON 打成一个自足的网页播放器。
//
// 「更好读」这件事，表格做不到——48 季 × 105 郡 × 三十家，
// 任何表格都只能给出切片。地图能一眼看出谁在涨谁在缩，时间轴能直接跳到破城那一季。
//
// 页面必须**自足**：Artifact 的 CSP 只放行 cdnjs 上的 script，
// 图片、CSS、fetch 全被挡。所以底图内联成 data URI、栅格内联成 base64 字符串常量、
// 录像内联成 JS 对象。仓库里两处现成的渲染代码都是 fetch 的，抄的时候要改掉。
//
// 用法：
//   npm run match -- --agent=bot:purpose --seasons=48 --replay=/tmp/r.json --out=/tmp/r.md
//   node --experimental-strip-types tools/build-replay-page.mjs --in=/tmp/r.json --out=/tmp/r.html
import fs from "node:fs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const IN = arg("in", "");
const OUT = arg("out", "replay.html");
const TITLE = arg("title", "");
if (!IN) { console.error("要 --in=<录像 json>"); process.exit(2); }

const replay = JSON.parse(fs.readFileSync(IN, "utf8"));
const terr = JSON.parse(fs.readFileSync("public/game/territory-grid.json", "utf8"));
const base = fs.readFileSync("public/game/map/play-base.webp");

// 郡序必须与录像的 dict.com 逐位相同，否则整幅疆域错位而且看不出来。
// 这是本文件唯一一处「静默画错」的入口，所以在这里硬拦
if (JSON.stringify(terr.order) !== JSON.stringify(replay.dict.com)) {
  console.error("✗ territory-grid 的 order 与录像的 dict.com 不一致——疆域会整体错位");
  process.exit(1);
}

const seasonCn = ["", "春", "夏", "秋", "冬"];
const gradeCn = ["丁", "丙", "乙", "甲", "超", "霸", "王"];
const m = replay.meta;
const name = TITLE || `${m.seatName ?? m.seat} · ${m.seed}`;

const page = `<meta charset="utf-8">
<title>${esc(name)}\u3000战局回放</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{
  --paper:#EDEEEA; --panel:#F6F7F4; --sunk:#E1E4DE; --ink:#1A1E1C; --ink2:#3E4744;
  --muted:#65706B; --faint:#8D9791; --rule:#C7CEC7; --soft:#DBE0D9;
  --seal:#A6342A; --jade:#3F6E58; --indigo:#2A5570;
  --sans:"IBM Plex Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#121614; --panel:#1A201D; --sunk:#0C100E; --ink:#E5E9E4; --ink2:#BEC7C1;
  --muted:#8B958F; --faint:#68736D; --rule:#2A322E; --soft:#212824;
  --seal:#DE7A6C; --jade:#7FB49A; --indigo:#7DAFCE;
}}
:root[data-theme="dark"]{
  --paper:#121614; --panel:#1A201D; --sunk:#0C100E; --ink:#E5E9E4; --ink2:#BEC7C1;
  --muted:#8B958F; --faint:#68736D; --rule:#2A322E; --soft:#212824;
  --seal:#DE7A6C; --jade:#7FB49A; --indigo:#7DAFCE;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.6}
.app{display:grid;grid-template-columns:minmax(0,1fr) 372px;gap:0;min-height:100vh}
@media(max-width:1000px){.app{grid-template-columns:1fr}}

/* 地图 */
.stage{position:relative;padding:20px 0 0 24px;min-width:0}
.mapbox{position:relative;width:100%;aspect-ratio:1815/1485;background:var(--sunk);
  border:1px solid var(--rule);overflow:hidden;
  /* 进度条是主控件，不能被地图挤出首屏——留出页首、图例、时间轴的高度 */
  max-height:calc(100vh - 216px);margin-inline:auto}
.mapbox img,.mapbox canvas,.mapbox svg{position:absolute;inset:0;width:100%;height:100%}
.mapbox img{object-fit:cover}
.mapbox svg{overflow:visible}
.hit{fill:transparent;cursor:pointer}
.hit:focus-visible{outline:2px solid var(--indigo);outline-offset:0}
.dot{fill:none;stroke:#2B2622;stroke-width:3;opacity:.5;pointer-events:none}
.sel{fill:none;stroke:var(--indigo);stroke-width:7;opacity:.95;pointer-events:none}
.dot.mine{stroke:var(--seal);stroke-width:5;opacity:.95}
.lab{font-family:var(--sans);font-size:19px;fill:#22201C;paint-order:stroke;
  stroke:rgba(245,244,238,.85);stroke-width:5;stroke-linejoin:round}
.army{font-family:var(--mono);font-size:20px;font-weight:600}
.armybg{stroke:rgba(247,246,240,.92);stroke-width:5}
.march{stroke-width:4;opacity:.55;stroke-dasharray:14 9;fill:none}
/* 在途：更细、更疏、更淡——一眼看出这支还在路上 */
.onroad{stroke-width:2;opacity:.35;stroke-dasharray:4 12;fill:none}
.facname{font-family:var(--sans);font-size:26px;font-weight:600;paint-order:stroke;
  stroke:rgba(246,245,239,.9);stroke-width:6;stroke-linejoin:round;letter-spacing:.04em}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;padding:12px 0 0;font-size:12.5px}
.legend span{display:flex;align-items:center;gap:6px;white-space:nowrap}
.legend i{width:12px;height:12px;border-radius:2px;flex:none;border:1px solid rgba(0,0,0,.18)}
.legend b{font-weight:600}
.legend em{font-style:normal;font-family:var(--mono);font-size:11px;color:var(--muted)}
.legend .minor i{background:#B9B2A2}
.flip{fill:none;stroke:var(--seal);stroke-width:6;opacity:.9}

/* 头 */
.head{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;padding:0 0 12px}
.head h1{margin:0;font-size:19px;font-weight:600;letter-spacing:.01em}
.head .when{font-family:var(--mono);font-size:22px;font-weight:500;font-variant-numeric:tabular-nums}
.head .sub{font-family:var(--mono);font-size:11.5px;color:var(--muted);letter-spacing:.04em}

/* 时间轴 */
.time{padding:14px 0 22px;display:flex;align-items:center;gap:14px}
.time button{font-family:var(--mono);font-size:13px;background:var(--panel);color:var(--ink);
  border:1px solid var(--rule);padding:6px 13px;cursor:pointer;border-radius:2px}
.time button:hover{background:var(--sunk)}
.track{position:relative;flex:1;height:34px}
.track input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:2}
.rail{position:absolute;left:0;right:0;top:15px;height:4px;background:var(--sunk);border-radius:2px}
.fill{position:absolute;left:0;top:15px;height:4px;background:var(--indigo);border-radius:2px}
.mark{position:absolute;top:8px;width:2px;height:18px;background:var(--seal);opacity:.55}
.knob{position:absolute;top:9px;width:3px;height:16px;background:var(--ink);transform:translateX(-1px)}
.tlab{font-family:var(--mono);font-size:11.5px;color:var(--muted);white-space:nowrap}

/* 侧栏 */
.side{border-left:1px solid var(--rule);background:var(--panel);padding:20px 22px 60px;
  max-height:100vh;overflow-y:auto}
@media(max-width:1000px){.side{max-height:none;border-left:none;border-top:1px solid var(--rule)}}
.side h2{margin:26px 0 8px;font-family:var(--mono);font-size:10.5px;letter-spacing:.15em;
  text-transform:uppercase;color:var(--faint);font-weight:500}
.side h2:first-child{margin-top:0}
.vs{margin-bottom:6px}
.vs .row{display:flex;align-items:baseline;gap:8px;padding:6px 0;border-bottom:1px solid var(--soft)}
.vs .row:last-child{border-bottom:none}
.vs .sw{width:9px;height:9px;flex:none;border-radius:1px;transform:translateY(-1px)}
.vs .who{flex:1;min-width:0}
.vs .who b{display:block;font-size:13px;font-weight:600}
.vs .who span{font-family:var(--mono);font-size:10.5px;color:var(--muted);
  display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vs .stat{font-family:var(--mono);font-size:12.5px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.vs .stat em{font-style:normal;color:var(--muted);font-size:11px}
.vs .dead{opacity:.45}
.mine{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:12.5px;margin-bottom:4px}
.mine dt{color:var(--muted)}
.mine dd{margin:0;font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right}
.rank{font-size:12.5px}
.rank div{display:flex;align-items:center;gap:8px;padding:2.5px 0}
.rank .sw{width:9px;height:9px;flex:none;border-radius:1px}
.rank .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rank .n{font-family:var(--mono);font-variant-numeric:tabular-nums}
.rank .d{font-family:var(--mono);font-size:11px;width:26px;text-align:right}
.rank .up{color:var(--jade)} .rank .dn{color:var(--seal)}
.rank .me{font-weight:600}
ul.ev{margin:0;padding:0;list-style:none;font-size:12.5px;line-height:1.55}
ul.ev li{padding:4px 0 4px 11px;border-left:2px solid var(--soft);margin-bottom:3px;color:var(--ink2)}
ul.ev li.hot{border-left-color:var(--seal);color:var(--ink)}
ul.ev li.me{border-left-color:var(--indigo)}
.ord{font-size:12px;color:var(--ink2)}
.seatblk{padding:10px 0 12px;border-bottom:1px solid var(--soft)}
.seatblk:last-child{border-bottom:none}
.seatblk h4{margin:0 0 5px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:7px}
.seatblk h4 i{width:9px;height:9px;border-radius:2px;flex:none}
.seatblk h4 em{font-style:normal;font-family:var(--mono);font-size:10px;color:var(--muted)}
.seatblk h4 span{margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--faint)}
.ordlist{font-family:var(--mono);line-height:1.65}
.ord .x{color:var(--faint);text-decoration:line-through}
.say{font-size:12.5px;color:var(--ink2);border-left:2px solid var(--indigo);padding:7px 0 7px 12px;margin:6px 0 0}
.say b{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--faint);font-weight:500;margin-bottom:3px}
.empty{color:var(--faint);font-size:12.5px}
.pick{background:var(--sunk);border:1px solid var(--rule);padding:11px 13px;font-size:12.5px;margin-top:6px}
.pick h3{margin:0 0 6px;font-size:13.5px;font-weight:600;display:flex;align-items:baseline;gap:8px}
.pick h3 em{font-style:normal;font-family:var(--mono);font-size:10.5px;color:var(--muted);letter-spacing:.06em}
.pick .cut{color:var(--seal);font-weight:600}
.pick button{float:right;font-family:var(--mono);font-size:11px;background:none;border:none;
  color:var(--muted);cursor:pointer;padding:0}
.pick dl{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;margin:0;font-size:12px}
.pick dt{color:var(--muted)} .pick dd{margin:0;font-family:var(--mono);text-align:right}
:focus-visible{outline:2px solid var(--indigo);outline-offset:2px}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="app">
  <div class="stage">
    <div class="head">
      <h1>${esc(name)}</h1>
      <span class="when" id="when"></span>
      <span class="sub" id="sub"></span>
    </div>
    <div class="mapbox">
      <img id="basemap" alt="">
      <canvas id="cv" width="1815" height="1485"></canvas>
      <svg id="ov" viewBox="0 0 1815 1485" aria-label="战局地图"></svg>
    </div>
    <div class="legend" id="legend"></div>
    <div class="time">
      <button id="play" type="button">▶ 播放</button>
      <div class="track">
        <div class="rail"></div><div class="fill" id="fill"></div>
        <div id="marks"></div><div class="knob" id="knob"></div>
        <input id="scrub" type="range" min="0" value="0" step="1" aria-label="第几季">
      </div>
      <span class="tlab" id="tlab"></span>
    </div>
  </div>

  <aside class="side">
    <div id="detailBox"></div>
    <h2 id="vsTitle" hidden>对阵</h2>
    <div class="vs" id="vs" hidden></div>
    <h2 id="mineTitle"></h2>
    <dl class="mine" id="mine"></dl>
    <h2>天下</h2>
    <div class="rank" id="rank"></div>
    <h2>本季结算</h2>
    <ul class="ev" id="ev"></ul>
    <h2 id="ordTitle">本季命令</h2>
    <div class="ord" id="ord"></div>
    <div id="detail"></div>
  </aside>
</div>

<script id="GRID" type="application/json">${JSON.stringify({ meta: terr.meta, grid: terr.grid })}</script>
<script id="REPLAY" type="application/json">${JSON.stringify(replay).replace(/</g, "\\u003c")}</script>
<script>
const GRID = JSON.parse(document.getElementById("GRID").textContent);
const R = JSON.parse(document.getElementById("REPLAY").textContent);
document.getElementById("basemap").src = "data:image/webp;base64,${base.toString("base64")}";

const D = R.dict, F = R.frames, N = F.length;
const SEASON = ${JSON.stringify(seasonCn)};
const GRADE = ${JSON.stringify(gradeCn)};
const ME = D.fac.indexOf(R.meta.seat);
// 混战有多个模型席位。只高亮一席就看不出对抗——地图上每一家都要描粗，
// 侧栏顶上直接摆一张对阵表：谁执哪一家、现在几郡几州、什么档
const SEATS = R.meta.seats || {};
const PLAYERS = Object.entries(SEATS).map(([f, m]) => ({ i: D.fac.indexOf(f), model: m }))
  .filter((p) => p.i >= 0);
const HILITE = new Set(PLAYERS.length ? PLAYERS.map((p) => p.i) : [ME]);
const COLS = GRID.meta.cols, ROWS = GRID.meta.rows, NONE = GRID.meta.none;
const S = 1815 / COLS;

// 栅格：base64 → 每格一个郡下标
const bin = atob(GRID.grid);
const CELL = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) CELL[i] = bin.charCodeAt(i);

/** 剧本给的就是最终显示色（见 tools/build-scenario-194.mjs 的配色注释），直接拆 RGB。
 *  这里原先有个 vivid() 跟 PlayClient 共用一套提纯系数，已一并去掉。 */
const hexRGB=(hex)=>{const n=parseInt(hex.replace("#",""),16);
  return [(n>>16)&255,(n>>8)&255,n&255];};
const RGB = D.facColor.map(hexRGB);

/** 逐通道方框模糊。**不用 ctx.filter**：Safari 桌面到 17.6 不支持、18 起默认关闭，
 *  那边会看到棱角分明的沃罗诺伊格子 */
function blur(d,w,h,r){
  const tmp=new Uint8ClampedArray(d.length), win=r*2+1;
  for(let c=0;c<4;c++){
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      let a=0; for(let k=-r;k<=r;k++){ const xx=Math.min(w-1,Math.max(0,x+k)); a+=d[(y*w+xx)*4+c]; }
      tmp[(y*w+x)*4+c]=a/win;
    }
    for(let x=0;x<w;x++) for(let y=0;y<h;y++){
      let a=0; for(let k=-r;k<=r;k++){ const yy=Math.min(h-1,Math.max(0,y+k)); a+=tmp[(yy*w+x)*4+c]; }
      d[(y*w+x)*4+c]=a/win;
    }
  }
}

const cv = document.getElementById("cv"), ctx = cv.getContext("2d");
const pad = document.createElement("canvas");
pad.width = COLS; pad.height = ROWS;
const pctx = pad.getContext("2d");
const img = pctx.createImageData(COLS, ROWS);
const own = new Int16Array(COLS * ROWS);

/** 这一帧算「主要势力」的那几家：≥3 郡，外加全部模型席位。
 *  三十一家一起上色只会糊成一片——《三国志》那种地图看得清，
 *  正是因为它只给几个大势力上重色，其余一概淡处理 */
function majorsOf(fi){
  const cnt=new Map();
  for(const o of F[fi].own) if(o>=0) cnt.set(o,(cnt.get(o)||0)+1);
  const set=new Set([...cnt].filter(([k])=>MAJOR_ONCE.has(k)).map(([k])=>k));
  for(const k of HILITE) if(cnt.get(k)) set.add(k);
  return { set, cnt };
}
/**
 * 「算不算主要势力」要**逐势力一次定死**，不能逐帧重判。
 *
 * 逐帧判的后果：张鲁在 1~4 郡之间来回，过 3 郡就上紫色、掉到 2 郡就变回淡土色，
 * 在地图上看就是「紫色没了、又出来、又没了」——用户据此以为势力复活了。
 * 改成：**只要它在这一局里曾经到过门槛，整局都用自己的颜色。**
 * 颜色是身份，不是当前规模；规模已经由面积和图例上的郡数表达了
 */
const MAJOR_ONCE=(()=>{
  const peak=new Map();
  for(const f of F){ const c=new Map();
    for(const o of f.own) if(o>=0) c.set(o,(c.get(o)||0)+1);
    for(const [k,v] of c) peak.set(k, Math.max(peak.get(k)||0, v)); }
  return new Set([...peak].filter(([,v])=>v>=3).map(([k])=>k));
})();
// 浓淡只表示份量，不表示身份：每家都用自己的颜色。
// 这里曾把「峰值不到 3 郡」的十几家一律涂成同一个淡土色 [185,178,162]，
// 那是给旧配色打的补丁——三十一家土色系本就难分，索性并档保住大势力的辨识度。
// 代价是十四家共用一色，曹操开局一郡也会被涂成通用土色。配色在数据层排开之后
// 这条既无必要又正好制造了「不同势力同色」，去掉。

function drawMap(fi){
  const O = F[fi].own;
  const { set: MAJOR } = majorsOf(fi);
  for (let i=0;i<CELL.length;i++){ const k=CELL[i]; own[i] = k===NONE ? -1 : O[k]; }
  const d = img.data;
  for (let i=0;i<own.length;i++){
    const o=i*4, f=own[i];
    if (f < 0){ d[o+3]=0; continue; }              // −1 = 无主，透明
    // 主要势力用自己的浓色，其余统一淡土色。
    // 此前一律 52/255，三十一家土色系全糊在一起，截图上根本分不出敌我
    const c = RGB[f] || [122,114,102];
    d[o]=c[0]; d[o+1]=c[1]; d[o+2]=c[2];
    // 小势力反而要更实一点才看得见：地盘小，淡下去就没了
    d[o+3] = HILITE.has(f) ? 178 : MAJOR.has(f) ? 148 : 132;
  }
  blur(d,COLS,ROWS,1); blur(d,COLS,ROWS,1);
  pctx.putImageData(img,0,0);
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality="high";
  ctx.drawImage(pad,0,0,cv.width,cv.height);

  // 疆界墨线：只描不同势力之间，同势力内部不描。中点按格坐标确定性抖动，
  // 照直画格边出来是棱角分明的沃罗诺伊图，看着像算出来的而不是画出来的
  const wob=(a,b)=>{ const n=Math.sin(a*127.1+b*311.7)*43758.5453; return (n-Math.floor(n)-0.5)*S*1.5; };
  ctx.lineCap="round";
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const i=r*COLS+c, f=own[i];
    if(f<0) continue;
    const right = c+1<COLS ? own[i+1] : -1;
    const down  = r+1<ROWS ? own[i+COLS] : -1;
    const mine = HILITE.has(f);
    ctx.strokeStyle = mine ? "rgba(112,38,28,.88)" : MAJOR.has(f) ? "rgba(46,40,33,.5)" : "rgba(52,45,37,.26)";
    ctx.lineWidth = mine ? 2.8 : MAJOR.has(f) ? 1.5 : 1;
    if(right!==f) segline((c+1)*S, r*S, (c+1)*S, (r+1)*S, i, wob);
    if(down!==f)  segline(c*S, (r+1)*S, (c+1)*S, (r+1)*S, i+0.5, wob);
  }
}
function segline(x1,y1,x2,y2,k,wob){
  ctx.beginPath(); ctx.moveTo(x1,y1);
  ctx.quadraticCurveTo((x1+x2)/2+wob(k,7.3),(y1+y2)/2+wob(k,19.1),x2,y2);
  ctx.stroke();
}

/** 当前点开的郡，−1 为没点 */
let SEL=-1;
const ov = document.getElementById("ov");
function drawOverlay(fi){
  const f=F[fi], prev = fi>0 ? F[fi-1] : null;
  const { set: MAJOR, cnt } = majorsOf(fi);
  const parts=[];

  // 本季易主的郡：一圈朱砂，这是一眼要看到的东西
  if(prev) for(let i=0;i<f.own.length;i++) if(f.own[i]!==prev.own[i]){
    const [x,y]=D.xy[i];
    parts.push('<circle class="flip" cx="'+x+'" cy="'+y+'" r="26"/>');
  }
  for(let i=0;i<f.own.length;i++){
    const [x,y]=D.xy[i];
    const mine=HILITE.has(f.own[i]);
    if(i===SEL) parts.push('<circle class="sel" cx="'+x+'" cy="'+y+'" r="20"/>');
    parts.push('<circle class="dot'+(mine?" mine":"")+'" cx="'+x+'" cy="'+y+'" r="'+(mine?7:5)+'"/>');
  }

  // ── 军团：**按郡聚合成一个徽标**，不逐支画 ──────────────────
  //
  // 逐支画会堆成一坨：实测一局末季 154 支军团只落在 8 个地方，
  // 单点最多 30 支。此前那段按角度偏移的写法半径固定 22，
  // 第 2 支之后全落在同一个圈上，二十支叠出来就是一团糊字。
  // 一个点就给一个数：合计兵力 + 支数；同点多家则按兵力最多的那家上色
  const byAt=new Map();
  for(const a of f.armies){
    if(a[2]<0) continue;
    const e=byAt.get(a[2]) || { n:0, troops:0, facs:new Map(), targets:new Set(), marching:new Set() };
    e.n++; e.troops+=a[1];
    e.facs.set(a[0], (e.facs.get(a[0])||0)+a[1]);
    // 在途与已抵达分开画：还在路上的用虚线细箭，围住的用实线。
    // 不分的话一支刚出发的远征军看起来就像已经围住了城
    if(a[3]>=0) (a[5]>0 ? e.marching : e.targets).add(a[3]);
    byAt.set(a[2], e);
  }
  // 行军/围城线先画，压在徽标底下
  for(const [at,e] of byAt){
    const top=[...e.facs].sort((a,b)=>b[1]-a[1])[0][0];
    const [x1,y1]=D.xy[at];
    for(const t of e.targets){
      const [x2,y2]=D.xy[t];
      parts.push('<path class="march" stroke="'+D.facColor[top]+'" d="M'+x1+' '+y1+'L'+x2+' '+y2+'"/>');
    }
    for(const t of e.marching){
      const [x2,y2]=D.xy[t];
      parts.push('<path class="onroad" stroke="'+D.facColor[top]+'" d="M'+x1+' '+y1+'L'+x2+' '+y2+'"/>');
    }
  }
  // 徽标不直接画，先收集——它要与势力名一起参与去重叠。
  // **变量名不能叫 marks**：模块顶层已经有一个 marks 是时间轴的锚点数组，
  // 撞上之后这里会往那个数组里塞标签对象，两边同时坏掉且不报错
  const labels=[];
  for(const [at,e] of byAt){
    const [x,y]=D.xy[at];
    const top=[...e.facs].sort((a,b)=>b[1]-a[1])[0][0];
    const txt='▲'+kilo(e.troops)+(e.n>1?' ×'+e.n:'');
    // 字宽实算。按 length×11 估会把「▲5.1k ×2」算窄三成，去重叠就漏
    let aw=0; for(const ch of txt) aw += /[▲×]/.test(ch) ? 20 : 12;
    labels.push({ kind:"army", x, y:y-16, y0:y-16, w:aw, txt,
                  fill:D.facColor[top] });
  }

  // ── 势力名标在**疆域重心**上 ──────────────────────────
  //
  // 此前标在各家治所上，而曹操（济阴）、吕布（山阳）、袁绍（魏郡）的治所
  // 本来就挨在一起，三个名字必然叠成一团；靠边的（乌桓、鲜卑）还会被画布裁掉。
  // 重心把标签推到各自地块的中间，天然散开。
  // 再加两道：**收进画布**、**竖直方向去重叠**（与军团徽标一起，见下）
  for(const [k,st] of Object.entries(f.fac)){
    const fi2=+k;
    if(!MAJOR.has(fi2) || !st || st[8]) continue;
    // 标在**最大连通块**的重心上，不是全部疆域的重心。
    // 张鲁一块在汉中、一块在云中，全域重心落在中间的无人区，看着像标错了地方。
    // 飞地多的时候更明显——而这一局飞地本来就不少
    const mine=[]; for(let i=0;i<f.own.length;i++) if(f.own[i]===fi2) mine.push(i);
    if(!mine.length) continue;
    const set=new Set(mine); let best=[];
    const seen=new Set();
    for(const start of mine){
      if(seen.has(start)) continue;
      const comp=[start]; seen.add(start);
      for(let q=0;q<comp.length;q++)
        for(const nb of (D.adj?.[comp[q]]||[]))
          if(set.has(nb)&&!seen.has(nb)){ seen.add(nb); comp.push(nb); }
      if(comp.length>best.length) best=comp;
    }
    let sx=0, sy=0, n=best.length;
    for(const i of best){ sx+=D.xy[i][0]; sy+=D.xy[i][1]; }
    // 字宽实算：26px 下一个汉字约占 26px，拉丁与标点约占一半。
    // 按 length×0.62 估会把「吕布（张邈、陈宫）」算窄一半，去重叠就形同虚设
    const nm=D.facName[fi2];
    let w=0; for(const ch of nm) w += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 26 : 13;
    // 记下自家郡的纵向跨度：去重叠时不许把名字推出这个范围，
    // 否则小势力的名字会飘到别人地盘上（实测 298 个样本里 4 个飘出去了）
    let lo=1e9, hi=-1e9;
    for(const i of best){ lo=Math.min(lo,D.xy[i][1]); hi=Math.max(hi,D.xy[i][1]); }
    labels.push({ kind:"fac", fill:D.facColor[fi2],
                 x:Math.min(1815-w/2-14, Math.max(w/2+14, sx/n)),
                 y:Math.min(1455, Math.max(34, sy/n)), y0:sy/n, w, txt:esc(D.facName[fi2]),
                 lo:lo-52, hi:hi+52 });
  }
  // 先按锚点画出去，**画完再量**——见下面的 deoverlap()。
  // 估字宽这条路走不通：试过 length×0.62、按中日韩字符实算，
  // 每一版都还剩两到四处碰撞，因为字体的实际步进、描边宽度、
  // 甚至同一个字在不同字重下的宽度都不是能算准的。SVG 有 getBBox()，
  // 直接量真实包围盒就没有估的问题
  for(const m of labels){
    const y=Math.min(1455, Math.max(34, m.y)).toFixed(1), x=m.x.toFixed(1);
    if(m.kind==="army"){
      parts.push('<text class="army armybg" data-y0="'+m.y0.toFixed(1)+'" x="'+x+'" y="'+y+'" text-anchor="middle">'+m.txt+'</text>');
      parts.push('<text class="army" data-y0="'+m.y0.toFixed(1)+'" x="'+x+'" y="'+y+'" text-anchor="middle" fill="'+m.fill+'">'+m.txt+'</text>');
    } else {
      parts.push('<text class="facname" data-lo="'+(m.lo??-1e9).toFixed(0)+'" data-hi="'
        +(m.hi??1e9).toFixed(0)+'" x="'+x+'" y="'+y+'" text-anchor="middle" fill="'+m.fill+'">'+m.txt+'</text>');
    }
  }
  // 热区**最后画**，否则被后画的地名、徽标、势力名盖住——SVG 没有 z-index，
  // 谁后画谁在上。实测每帧有 12~19 个郡点不开或点开的是隔壁郡
  for(let i=0;i<f.own.length;i++){
    const [x,y]=D.xy[i];
    parts.push('<circle class="hit" data-i="'+i+'" cx="'+x+'" cy="'+y+'" r="17"'
      +' tabindex="0" role="button" aria-label="'+D.name[i]+'"><title>'+D.name[i]+'</title></circle>');
  }
  ov.innerHTML=parts.join("");
  deoverlap();

  // 图例：这一帧在场的每一家，按郡数降序。没有它，颜色说明不了任何事。
  // 原先只列「主要势力」、其余折叠成一句「其余 N 家小势力」，那正好把十几家的身份一起抹掉
  $("legend").innerHTML=[...cnt].sort((a,b)=>b[1]-a[1]||a[0]-b[0])
    .map(([k,v])=>'<span><i style="background:'+D.facColor[k]+'"></i>'
      +'<b'+(HILITE.has(k)?' style="text-decoration:underline"':'')+'>'+esc(D.facName[k])+'</b>'
      +'<em>'+v+' 郡</em></span>').join("");
}
/**
 * 画完再量的去重叠。
 *
 * 估字宽那条路试过三版（length×0.62、按中日韩字符实算、再按字体步进调），
 * 每一版都还剩两到四处碰撞：字体的实际步进、描边宽度、标点的全半角
 * 都不是算得准的。SVG 的 getBBox() 给的是**真实包围盒**，量出来就没有估的问题。
 *
 * 只在竖直方向推。军团徽标锚在具体的郡上，漂太远就指错地方，给 ±46 的上限
 *（超了就改推压在它上面的那一个）；势力名标的是一片地的重心，本来没有精确锚点。
 */
function deoverlap(){
  const items=[];
  for(const el of ov.querySelectorAll(".facname,.army")){
    if(el.classList.contains("armybg")) continue;
    const bb=el.getBBox();
    const army=el.classList.contains("army");
    // **存真实包围盒，不存「中心 + 高度」。** y 属性是**基线**不是中心，
    // 而基线在盒子里的位置随字号变：势力名实测盒高 54、徽标只有 15，
    // 拿基线当中心去比，两者的误差差出二十多个单位——各帧稳定漏判两三处
    items.push({ el, bg: army ? el.previousElementSibling : null, army,
                 lo:+(el.dataset.lo ?? -1e9), hi:+(el.dataset.hi ?? 1e9),
                 y:+el.getAttribute("y"), dy:0,
                 l:bb.x, r:bb.x+bb.width, t:bb.y, b:bb.y+bb.height,
                 y0: army ? +el.dataset.y0 : null });
  }
  if(items.length<2) return;
  const hits=(a,b)=>a.l < b.r+2 && b.l < a.r+2
                 && a.t+a.dy < b.b+b.dy+4 && b.t+b.dy < a.b+a.dy+4;

  // 分两步。第一步只在徽标之间推（它们锚在具体的郡上，±46 的漂移上限）；
  // 第二步固定徽标，只挪势力名——势力名标的是一片地的重心，没有精确锚点。
  const army=items.filter((x)=>x.army), fac=items.filter((x)=>!x.army);
  army.sort((a,b)=>a.t-b.t);
  for(let pass=0;pass<6;pass++){
    let moved=false;
    for(let i=1;i<army.length;i++) for(let j=0;j<i;j++){
      const a=army[j], b=army[i];
      if(!hits(a,b)) continue;
      const want=(a.b+a.dy+4)-b.t;                  // 把 b 推到 a 下面
      if(Math.abs(want)<=46){ b.dy=want; moved=true; }
    }
    army.sort((a,b)=>(a.t+a.dy)-(b.t+b.dy));
    if(!moved) break;
  }
  // 势力名向外扫描找最近的空位。「跳到刚好让开」在上下各有障碍时会来回弹
  const placed=[...army];
  for(const f of fac){
    let best=0;
    // 分三档放宽：先只在自家郡的纵向跨度内找（各留 52 的余量），
    // 找不到再放到 ±110，还找不到才不限。
    //
    // 两头都要顾：给到 ±260 且不限范围时，小势力的名字会被推出自己的地盘
    // 标到别人头上（实测 298 个样本里 4 个）；而只许在 ±52 内找，
    // 挤的时候又解不开（32 帧剩 3 处碰撞）。分档之后两个都归零
    let ok=false;
    for(const slack of [52, 110, 1e9]){
      for(let d=0;d<=160 && !ok;d+=6){
        const cand = d===0 ? [0] : [-d, d];
        for(const dy of cand){
          const y=f.y+dy;
          if(y<34||y>1455||y<f.lo-(slack-52)||y>f.hi+(slack-52)) continue;
          f.dy=dy;
          if(!placed.some((o)=>hits(f,o))){ best=dy; ok=true; break; }
        }
      }
      if(ok) break;
    }
    f.dy=best;
    placed.push(f);
  }
  for(const it of items){
    const y=Math.min(1455, Math.max(34, it.y+it.dy)).toFixed(1);
    it.el.setAttribute("y", y);
    if(it.bg) it.bg.setAttribute("y", y);
  }
}
function kilo(n){ return n>=10000 ? (n/1000).toFixed(0)+"k" : n>=1000 ? (n/1000).toFixed(1)+"k" : String(n); }

const $=(id)=>document.getElementById(id);
const num=(n)=>n.toLocaleString("en-US");

function paint(fi){
  const f=F[fi], prev = fi>0 ? F[fi-1] : null;
  drawMap(fi); drawOverlay(fi);
  $("when").textContent = f.y+" 年 · "+SEASON[f.s];
  $("sub").textContent = "第 "+(fi+1)+"/"+N+" 季\u3000纪元 "+f.epoch;
  $("tlab").textContent = (fi+1)+" / "+N;
  $("scrub").value=fi;
  $("fill").style.width = (fi/(N-1)*100)+"%";
  $("knob").style.left = (fi/(N-1)*100)+"%";

  // 对阵：混战才显示。按郡数排，死掉的压暗
  if(PLAYERS.length>1){
    // 档位写成「历史最高/终局」两个。只写终局，曹操这种「中途摸到乙档、
    // 最后一郡不剩」的会显示成丁，与终局表对不上；只写历史最高则看不出崩盘
    $("vsTitle").hidden=false; $("vs").hidden=false;
    const cnt0=new Map();
    for(const o of f.own) if(o>=0) cnt0.set(o,(cnt0.get(o)||0)+1);
    const pc0=new Map();
    if(prev) for(const o of prev.own) if(o>=0) pc0.set(o,(pc0.get(o)||0)+1);
    $("vs").innerHTML=PLAYERS.slice().sort((a,b)=>(cnt0.get(b.i)||0)-(cnt0.get(a.i)||0))
      .map(p=>{
        const st=f.fac[p.i], n=cnt0.get(p.i)||0, d=n-(pc0.get(p.i)||0);
        const dead=st&&st[8];
        return '<div class="row'+(dead?" dead":"")+'">'
          +'<span class="sw" style="background:'+D.facColor[p.i]+'"></span>'
          +'<span class="who"><b>'+esc(D.facName[p.i])+'</b><span>'+esc(p.model.split("/").pop())+'</span></span>'
          +'<span class="stat">'+n+' <em>郡</em>'+(d?' '+(d>0?"+":"")+d:"")
          +'<br>'+(st?st[6]+' <em>州</em>\u3000'+GRADE[st[3]]+'/'+GRADE[st[4]]+' <em>档</em>':'—')+'</span></div>';
      }).join("");
  }

  // 我方
  const me=f.fac[ME];
  $("mineTitle").textContent = (D.facName[ME]||"—")+"\u3000"+(me&&me[8]?"已覆亡":"");
  if(me){
    const dn = prev&&prev.fac[ME] ? me[5]-prev.fac[ME][5] : 0;
    $("mine").innerHTML =
      row("郡数", me[5]+(dn?" ("+(dn>0?"+":"")+dn+")":"")) +
      row("控州 / 州治", me[6]+" / "+me[7]) +
      row("历史最高档 / 终局档", GRADE[me[3]]+" / "+GRADE[me[4]]) +
      row("国库", num(me[1])+" 金") + row("本季令数", me[2]) +
      row("补给断绝", f.cut.filter(i=>f.own[i]===ME).length+" 郡");
  } else $("mine").innerHTML="";

  // 天下：按郡数排，只留前十
  const cnt=new Map();
  for(const o of f.own) if(o>=0) cnt.set(o,(cnt.get(o)||0)+1);
  const pc=new Map();
  if(prev) for(const o of prev.own) if(o>=0) pc.set(o,(pc.get(o)||0)+1);
  $("rank").innerHTML=[...cnt].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>{
    const d=v-(pc.get(k)||0);
    return '<div><span class="sw" style="background:'+D.facColor[k]+'"></span>'
      +'<span class="nm'+(k===ME?" me":"")+'">'+esc(D.facName[k])+'</span>'
      +'<span class="n">'+v+'</span>'
      +'<span class="d '+(d>0?"up":d<0?"dn":"")+'">'+(d?(d>0?"+":"")+d:"")+'</span></div>';
  }).join("");

  // 结算。**别家的断供与军费不继折成一行**——那是背景噪声：
  // 一局里断供 224 条、军费不继 73 条，全铺出来每季二十行，
  // 而真正要看的破城、被俘、治所失守会被埋在里面。本方的一条不折
  // capital-lost 是**每季重复的状态提示**不是事件：实测同一批势力
  // 连着三十季每季各报一条「治所已失，全境政令不通」，一季 4~6 条。
  // 本方那条是决定性的（袁绍卡在十一郡就是因为魏郡丢了），别家的是背景
  const BG=new Set(["supply-cut","supply-cut-scatter","unpaid",
                    "capital-lost","capital-lost-scatter"]);
  const shown=[], bg=[];
  for(const e of f.ev){
    if(BG.has(e[0]) && !HILITE.has(e[1])) bg.push(e); else shown.push(e);
  }
  // **先按要紧程度排，再截。** 此前是原序硬截 30 行，而破城、被俘这些
  // 排在日志后半段——实测前十六季一条战况都看不到，「这一季谁打了谁」答不上来。
  // 折叠那一行也曾被一起截掉，现在单独留在最后
  const rank=(e)=>HOT.has(e[0])?0:HILITE.has(e[1])?1:2;
  shown.sort((a,b)=>rank(a)-rank(b));
  const CAP=26, head=shown.slice(0,CAP), rest=shown.length-head.length;
  $("ev").innerHTML = (shown.length
    ? head.map(e=>'<li class="'+(HOT.has(e[0])?"hot":"")+(HILITE.has(e[1])?" me":"")+'">'
        +esc(cn(e[2]))+'</li>').join("") + (rest>0?'<li class="empty">…另有 '+rest+' 条</li>':"")
    : '<li class="empty">本季无事</li>')
    + (bg.length?'<li class="empty">本季他方另有 '+bg.length+' 处断供 / 治所失守 / 军费不继</li>':"");

  // 命令与想法：**每个模型席位各一段**。混战两家对打，只显示一边读不出对抗
  // f.seat 是旧格式（只录一席）。已经录好的那些不必重跑，兼容一下
  const seats = f.seats || (f.seat ? [f.seat] : []);
  $("ordTitle").textContent = "本季命令与想法\u3000全场 "+f.orders.length+" 条";
  const blocks = seats.length ? seats : [{ faction: ME, picks: [], dropped: [], reason: null, plan: null }];
  $("ord").innerHTML = blocks.map((st)=>{
    const ord=f.orders.filter(o=>o[0]===st.faction);
    let h='<div class="seatblk"><h4><i style="background:'+(D.facColor[st.faction]||"#888")+'"></i>'
      +esc(D.facName[st.faction]||"—")
      +(SEATS[D.fac[st.faction]] ? '<em>'+esc(SEATS[D.fac[st.faction]].split("/").pop())+'</em>' : '')
      +'<span>'+ord.length+' 条</span></h4>';
    h += ord.length
      ? '<div class="ordlist">'+ord.map(o=>'· '+TYPE[o[1]]+(o[2]>=0?" "+D.name[o[2]]:"")).join("<br>")+'</div>'
      : '<div class="ordlist empty">本季未下令</div>';
    if(st.dropped && st.dropped.length)
      h += '<div class="ordlist">'+st.dropped.map(d=>'<span class="x">✗ '+esc(d[0])+'</span>\u3000'
        +esc(WHY[d[1]]||d[1])).join("<br>")+'</div>';
    // 覆亡之后不再显示意图与方略。此前曹操第 15 季就没了，
    // 命令栏还在逐字重复它第 14 季写的方略，一直重复到第 32 季
    const dead = f.fac[st.faction] && f.fac[st.faction][8];
    if(dead) h+='<div class="say"><b>已覆亡</b>本季无决策</div>';
    else {
      if(st.reason) h+='<div class="say"><b>本季意图</b>'+esc(cn(st.reason))+'</div>';
      if(st.plan) h+='<div class="say"><b>跨季方略</b>'+esc(cn(st.plan))+'</div>';
    }
    return h+'</div>';
  }).join("");
  $("detail").innerHTML="";
  paintDetail(fi);
}

const FORM_CN=["鱼鳞","鹤翼","方圆"];
function paintDetail(fi){
  if(SEL<0){ $("detailBox").innerHTML=""; return; }
  const f=F[fi], prev=fi>0?F[fi-1]:null, i=SEL;
  const o=f.own[i], cut=f.cut.includes(i);
  const d=(k)=>prev ? f[k][i]-prev[k][i] : 0;
  const dd=(k)=>{ const v=d(k); return v ? ' <em>'+(v>0?"+":"")+v+'</em>' : ''; };
  const flipped = prev && prev.own[i]!==o;
  $("detailBox").innerHTML='<div class="pick">'
    +'<button type="button" id="closeDetail">✕</button>'
    +'<h3>'+esc(D.name[i])+' <em>'+esc(D.zhou[i])+'</em></h3>'
    +'<dl>'
    +'<dt>归属</dt><dd>'+(o<0?"无主":esc(D.facName[o]))+(flipped?' <em>本季易主</em>':'')+'</dd>'
    +'<dt>守军档</dt><dd>'+f.gt[i]+' / 9'+dd("gt")+'</dd>'
    +'<dt>城防</dt><dd>'+f.def[i]+dd("def")+'</dd>'
    +'<dt>产出档 / 民心档</dt><dd>'+f.yld[i]+' / '+f.mor[i]+'</dd>'
    +'<dt>阵型</dt><dd>'+(FORM_CN[f.fm[i]]||"—")+'</dd>'
    +'<dt>太守政治</dt><dd>'+(f.gov[i]||"—")+'</dd>'
    +'<dt>补给</dt><dd'+(cut?' class="cut"':'')+'>'+(cut?"断绝":"通")+'</dd>'
    +'</dl></div>';
  $("closeDetail").onclick=()=>{ SEL=-1; paint(+$("scrub").value); };
}
ov.addEventListener("click",(e)=>{
  const t=e.target.closest(".hit");
  if(!t) return;
  const i=+t.dataset.i;
  SEL = (SEL===i) ? -1 : i;
  paint(+$("scrub").value);
});
function row(k,v){ return "<dt>"+k+"</dt><dd>"+v+"</dd>"; }
function esc(s){ return String(s).replace(/[&<>]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
/** 引擎日志里有些地方留着原始势力 id（「原属 yuanshao」），换成中文名。
 *  tools/match-log.mjs 早有同一个 cn()，播放器这边没抄 */
const ID2NAME = new Map(D.fac.map((id,i)=>[id, D.facName[i]]));
// 这一行**在外层模板字符串里**：写 \\b 会被吃成退格符，页面拿到的就不是单词边界了
const RE_ID = new RegExp("\\\\b(" + D.fac.filter(x=>/^[a-z][a-z0-9_]*$/.test(x)).join("|") + ")\\\\b","g");
function cn(t){ return String(t).replace(RE_ID,(m)=>ID2NAME.get(m)||m); }
const HOT=new Set(["siege-win","capital-lost","eliminated","unify","submit","epoch"]);
const TYPE={campaign:"征伐",govern:"治",appoint:"调任",scout:"探",muster:"集结",array:"阵",
  ally:"盟",submit:"劝降",suade:"招降",passage:"借道",withdraw:"撤围",relief:"赴援",retire:"归隐"};
const WHY={"unknown-key":"候选表里没有","duplicate":"重复","over-budget":"令数不够","rejected":"引擎校验不过","mojibake":"编码已复原"};

// 时间轴上标出**本方疆域变动**的那几季——48 季不给锚点就只能一格格拖。
// 试过标「全场有破城」，48 季里 47 季都中，等于没标：三十家同场，
// 每季总有人在破谁的城。锚点要对着这一局的叙事主线，不是对着噪声
const marks=[];
for(let i=1;i<N;i++){
  const a=F[i-1].own, b=F[i].own;
  // 盯的是**全部模型席位**的疆域变动，不是第一席。
  // 混战里第一席可能早早出局——104 季那局曹操第 4 季就没了，
  // 只盯它整条时间轴上只剩两个锚点，等于没有
  let ch=0; for(let k=0;k<b.length;k++)
    if(a[k]!==b[k] && (HILITE.has(a[k])||HILITE.has(b[k]))) ch++;
  if(ch) marks.push('<div class="mark" style="left:'+(i/(N-1)*100)+'%" title="第 '+(i+1)+' 季 · '+ch+' 郡易主"></div>');
}
$("marks").innerHTML=marks.join("");

const scrub=$("scrub");
scrub.max=N-1;
scrub.addEventListener("input",()=>paint(+scrub.value));
let timer=null;
$("play").addEventListener("click",()=>{
  if(timer){ clearInterval(timer); timer=null; $("play").textContent="▶ 播放"; return; }
  // 停在末季再按播放：从头放，而不是闪一下就弹回来
  if(+scrub.value>=N-1) paint(0);
  $("play").textContent="❚❚ 暂停";
  timer=setInterval(()=>{
    const v=+scrub.value;
    if(v>=N-1){ clearInterval(timer); timer=null; $("play").textContent="▶ 播放"; return; }
    paint(v+1);
  },1100);
});
addEventListener("keydown",(e)=>{
  if(e.key==="ArrowRight"||e.key==="ArrowLeft"){
    e.preventDefault();
    paint(Math.min(N-1,Math.max(0,+scrub.value+(e.key==="ArrowRight"?1:-1))));
  }
});
paint(0);
</script>
`;

fs.writeFileSync(OUT, page);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`→ ${OUT}\u3000${replay.frames.length} 帧\u3000${kb} KB`);

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
