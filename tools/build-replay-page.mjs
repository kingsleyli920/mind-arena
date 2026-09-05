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

const page = `<title>${esc(name)}\u3000战局回放</title>
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
  border:1px solid var(--rule);overflow:hidden}
.mapbox img,.mapbox canvas,.mapbox svg{position:absolute;inset:0;width:100%;height:100%}
.mapbox img{object-fit:cover}
.mapbox svg{overflow:visible}
.hit{fill:transparent;cursor:pointer}
.hit:hover ~ .dot{opacity:1}
.dot{fill:none;stroke:#2B2622;stroke-width:3;opacity:.5;pointer-events:none}
.sel{fill:none;stroke:var(--indigo);stroke-width:7;opacity:.95;pointer-events:none}
.dot.mine{stroke:var(--seal);stroke-width:5;opacity:.95}
.lab{font-family:var(--sans);font-size:19px;fill:#22201C;paint-order:stroke;
  stroke:rgba(245,244,238,.85);stroke-width:5;stroke-linejoin:round}
.army{font-family:var(--mono);font-size:20px;font-weight:600}
.armybg{stroke:rgba(247,246,240,.92);stroke-width:5}
.march{stroke-width:4;opacity:.55;stroke-dasharray:14 9;fill:none}
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

/** 提纯势力色。原色是配水墨底图取的土色系，直接用则三十一家彼此难分。
 *  与 app/play/PlayClient.tsx 的 vivid() 同一套系数 */
function vivid(hex){
  const n = parseInt(hex.replace("#",""),16);
  const r=((n>>16)&255)/255, g=((n>>8)&255)/255, b=(n&255)/255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  let h=0;
  if(d){ if(mx===r) h=((g-b)/d+(g<b?6:0))/6; else if(mx===g) h=((b-r)/d+2)/6; else h=((r-g)/d+4)/6; }
  let l=(mx+mn)/2, s=d===0?0:d/(1-Math.abs(2*l-1));
  s=Math.min(1,s*1.5+0.10); l=Math.min(0.74,Math.max(0.46,l));
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs(((h*6)%2)-1)), m=l-c/2;
  const seg=Math.floor(h*6)%6;
  const t=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][seg];
  return [Math.round((t[0]+m)*255),Math.round((t[1]+m)*255),Math.round((t[2]+m)*255)];
}
const RGB = D.facColor.map(vivid);

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
  const set=new Set([...cnt].filter(([,v])=>v>=3).map(([k])=>k));
  for(const k of HILITE) if(cnt.get(k)) set.add(k);
  return { set, cnt };
}
const MINOR=[185,178,162];

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
    const maj=MAJOR.has(f);
    const c = maj ? (RGB[f]||[122,114,102]) : MINOR;
    d[o]=c[0]; d[o+1]=c[1]; d[o+2]=c[2];
    d[o+3] = HILITE.has(f) ? 168 : maj ? 138 : 60;
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
    // 热区比可见的点大得多——105 个郡挤在一张图上，5px 的点点不中
    parts.push('<circle class="hit" data-i="'+i+'" cx="'+x+'" cy="'+y+'" r="17"><title>'
      +D.name[i]+'</title></circle>');
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
    const e=byAt.get(a[2]) || { n:0, troops:0, facs:new Map(), targets:new Set() };
    e.n++; e.troops+=a[1];
    e.facs.set(a[0], (e.facs.get(a[0])||0)+a[1]);
    if(a[3]>=0) e.targets.add(a[3]);
    byAt.set(a[2], e);
  }
  // 行军/围城线先画，压在徽标底下
  for(const [at,e] of byAt) for(const t of e.targets){
    const [x1,y1]=D.xy[at], [x2,y2]=D.xy[t];
    const top=[...e.facs].sort((a,b)=>b[1]-a[1])[0][0];
    parts.push('<path class="march" stroke="'+D.facColor[top]+'" d="M'+x1+' '+y1+'L'+x2+' '+y2+'"/>');
  }
  for(const [at,e] of byAt){
    const [x,y]=D.xy[at];
    const top=[...e.facs].sort((a,b)=>b[1]-a[1])[0][0];
    const txt='▲'+kilo(e.troops)+(e.n>1?' ×'+e.n:'');
    parts.push('<text class="army armybg" x="'+x+'" y="'+(y-16)+'" text-anchor="middle">'+txt+'</text>');
    parts.push('<text class="army" x="'+x+'" y="'+(y-16)+'" text-anchor="middle" fill="'
      +(MAJOR.has(top)?D.facColor[top]:"#5C564B")+'">'+txt+'</text>');
  }

  // ── 势力名标在**疆域重心**上 ──────────────────────────
  //
  // 此前标在各家治所上，而曹操（济阴）、吕布（山阳）、袁绍（魏郡）的治所
  // 本来就挨在一起，三个名字必然叠成一团；靠边的（乌桓、鲜卑）还会被画布裁掉。
  // 重心把标签推到各自地块的中间，天然散开。
  // 再加两道：**收进画布**、**竖直方向去重叠**（按重心 y 排序，压上就往下推）
  const anchors=[];
  for(const [k,st] of Object.entries(f.fac)){
    const fi2=+k;
    if(!MAJOR.has(fi2) || !st || st[8]) continue;
    let sx=0, sy=0, n=0;
    for(let i=0;i<f.own.length;i++) if(f.own[i]===fi2){ sx+=D.xy[i][0]; sy+=D.xy[i][1]; n++; }
    if(!n) continue;
    // 字宽实算：26px 下一个汉字约占 26px，拉丁与标点约占一半。
    // 按 length×0.62 估会把「吕布（张邈、陈宫）」算窄一半，去重叠就形同虚设
    const nm=D.facName[fi2];
    let w=0; for(const ch of nm) w += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 26 : 13;
    anchors.push({ fi:fi2, x:Math.min(1815-w/2-14, Math.max(w/2+14, sx/n)),
                   y:Math.min(1455, Math.max(34, sy/n)), w, txt:esc(D.facName[fi2]) });
  }
  // 去重叠要**多轮**：一轮按序推，推下去的那个可能又压住下一个。
  // 四轮之后 194 年春（所有势力都还在、最挤的一帧）实测撞不出来
  anchors.sort((a,b)=>a.y-b.y);
  for(let pass=0;pass<4;pass++){
    let moved=false;
    for(let i=1;i<anchors.length;i++) for(let j=0;j<i;j++){
      const a=anchors[j], b=anchors[i];
      if(Math.abs(a.x-b.x) < (a.w+b.w)/2 && Math.abs(b.y-a.y) < 40){
        b.y = a.y+40; moved=true;
      }
    }
    anchors.sort((a,b)=>a.y-b.y);
    if(!moved) break;
  }
  for(const a of anchors) a.y=Math.min(1455, Math.max(34, a.y));
  for(const a of anchors){
    parts.push('<text class="facname" x="'+a.x.toFixed(1)+'" y="'+a.y.toFixed(1)
      +'" text-anchor="middle" fill="'+D.facColor[a.fi]+'">'+a.txt+'</text>');
  }

  // 地名**只标本季易主的那几个**。
  //
  // 此前把本方全部郡都标上，实测袁绍十一郡挤在河北，钜鹿国压常山国、
  // 常山国压安平国，29 个标签撞出 6 处重叠。而「这是哪个郡」点一下就有
  // （每个郡都带 <title>，热区 17px），易主才是非标不可的那一类
  if(prev) for(let i=0;i<f.own.length;i++){
    if(f.own[i]===prev.own[i]) continue;
    const [x,y]=D.xy[i];
    parts.push('<text class="lab" x="'+x+'" y="'+(y+26)+'" text-anchor="middle">'+D.name[i]+'</text>');
  }
  ov.innerHTML=parts.join("");

  // 图例：这一帧的主要势力，按郡数降序。没有它，颜色说明不了任何事
  $("legend").innerHTML=[...cnt].filter(([k])=>MAJOR.has(k)).sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>'<span><i style="background:'+D.facColor[k]+'"></i>'
      +'<b'+(HILITE.has(k)?' style="text-decoration:underline"':'')+'>'+esc(D.facName[k])+'</b>'
      +'<em>'+v+' 郡</em></span>').join("")
    + '<span class="minor"><i></i><em>其余 '+([...cnt].length-[...cnt].filter(([k])=>MAJOR.has(k)).length)+' 家小势力</em></span>';
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
  if(bg.length) shown.push(["fold",-1,"本季他方另有 "+bg.length+" 处断供 / 治所失守 / 军费不继"]);
  $("ev").innerHTML = shown.length
    ? shown.slice(0,30).map(e=>'<li class="'+(HOT.has(e[0])?"hot":"")+(HILITE.has(e[1])?" me":"")+'">'
        +esc(cn(e[2]))+'</li>').join("") + (shown.length>30?'<li class="empty">…另有 '+(shown.length-30)+' 条</li>':"")
    : '<li class="empty">本季无事</li>';

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
    if(st.reason) h+='<div class="say"><b>本季意图</b>'+esc(cn(st.reason))+'</div>';
    if(st.plan) h+='<div class="say"><b>跨季方略</b>'+esc(cn(st.plan))+'</div>';
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
  let ch=0; for(let k=0;k<b.length;k++) if(a[k]!==b[k] && (a[k]===ME||b[k]===ME)) ch++;
  if(ch) marks.push('<div class="mark" style="left:'+(i/(N-1)*100)+'%" title="第 '+(i+1)+' 季"></div>');
}
$("marks").innerHTML=marks.join("");

const scrub=$("scrub");
scrub.max=N-1;
scrub.addEventListener("input",()=>paint(+scrub.value));
let timer=null;
$("play").addEventListener("click",()=>{
  if(timer){ clearInterval(timer); timer=null; $("play").textContent="▶ 播放"; return; }
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
