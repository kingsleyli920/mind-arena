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
.dot{fill:none;stroke:#2B2622;stroke-width:3;opacity:.5}
.dot.mine{stroke:var(--seal);stroke-width:5;opacity:.95}
.lab{font-family:var(--sans);font-size:19px;fill:#22201C;paint-order:stroke;
  stroke:rgba(245,244,238,.85);stroke-width:5;stroke-linejoin:round}
.army{font-family:var(--mono);font-size:17px;font-weight:600}
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
.ord{font-size:12px;font-family:var(--mono);color:var(--ink2);line-height:1.7}
.ord .x{color:var(--faint);text-decoration:line-through}
.say{font-size:12.5px;color:var(--ink2);border-left:2px solid var(--indigo);padding:7px 0 7px 12px;margin:6px 0 0}
.say b{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--faint);font-weight:500;margin-bottom:3px}
.empty{color:var(--faint);font-size:12.5px}
.pick{background:var(--sunk);border:1px solid var(--rule);padding:11px 13px;font-size:12.5px;margin-top:6px}
.pick h3{margin:0 0 6px;font-size:13.5px;font-weight:600}
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

function drawMap(fi){
  const O = F[fi].own;
  for (let i=0;i<CELL.length;i++){ const k=CELL[i]; own[i] = k===NONE ? -1 : O[k]; }
  const d = img.data;
  for (let i=0;i<own.length;i++){
    const o=i*4, f=own[i];
    if (f < 0){ d[o+3]=0; continue; }              // −1 = 无主，透明
    const c=RGB[f]||[122,114,102];
    d[o]=c[0]; d[o+1]=c[1]; d[o+2]=c[2];
    // 疆域是注记不是主角，地形墨色要透得出来
    d[o+3] = HILITE.has(f) ? 108 : 52;
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
    ctx.strokeStyle = mine ? "rgba(118,44,34,.82)" : "rgba(52,45,37,.34)";
    ctx.lineWidth = mine ? 2.4 : 1.2;
    if(right!==f) segline((c+1)*S, r*S, (c+1)*S, (r+1)*S, i, wob);
    if(down!==f)  segline(c*S, (r+1)*S, (c+1)*S, (r+1)*S, i+0.5, wob);
  }
}
function segline(x1,y1,x2,y2,k,wob){
  ctx.beginPath(); ctx.moveTo(x1,y1);
  ctx.quadraticCurveTo((x1+x2)/2+wob(k,7.3),(y1+y2)/2+wob(k,19.1),x2,y2);
  ctx.stroke();
}

const ov = document.getElementById("ov");
function drawOverlay(fi){
  const f=F[fi], prev = fi>0 ? F[fi-1] : null;
  const parts=[];
  // 本季易主的郡：画一圈朱砂，这是一眼要看到的东西
  if(prev) for(let i=0;i<f.own.length;i++) if(f.own[i]!==prev.own[i]){
    const [x,y]=D.xy[i];
    parts.push('<circle class="flip" cx="'+x+'" cy="'+y+'" r="26"/>');
  }
  for(let i=0;i<f.own.length;i++){
    const [x,y]=D.xy[i];
    const mine=HILITE.has(f.own[i]);
    parts.push('<circle class="dot'+(mine?" mine":"")+'" cx="'+x+'" cy="'+y+'" r="'+(mine?7:5)+'"/>');
  }
  // 军团：同一郡上叠多支时按序号做确定性角度偏移，否则互相盖住
  const at=new Map();
  for(const a of f.armies){
    if(a[2]<0) continue;
    const n=at.get(a[2])||0; at.set(a[2],n+1);
    const [x,y]=D.xy[a[2]];
    const ang=(n*2.399), rr=n?22:0;
    parts.push('<text class="army" x="'+(x+Math.cos(ang)*rr)+'" y="'+(y-14+Math.sin(ang)*rr)
      +'" text-anchor="middle" fill="'+D.facColor[a[0]]+'" stroke="rgba(245,244,238,.9)" stroke-width="4" paint-order="stroke">▲'
      + (a[1]>=1000 ? Math.round(a[1]/100)/10+"k" : a[1]) + '</text>');
  }
  // 地名只标本方的与本季易主的——105 个全标会糊成一片
  for(let i=0;i<f.own.length;i++){
    const flipped = prev && f.own[i]!==prev.own[i];
    if(!HILITE.has(f.own[i]) && !flipped) continue;
    const [x,y]=D.xy[i];
    parts.push('<text class="lab" x="'+x+'" y="'+(y+30)+'" text-anchor="middle">'+D.name[i]+'</text>');
  }
  ov.innerHTML=parts.join("");
}

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
          +'<br>'+(st?st[6]+' <em>州</em>\u3000'+GRADE[st[4]]+' <em>档</em>':'—')+'</span></div>';
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

  // 结算
  const ev=f.ev;
  $("ev").innerHTML = ev.length
    ? ev.slice(0,40).map(e=>'<li class="'+(HOT.has(e[0])?"hot":"")+(e[1]===ME?" me":"")+'">'
        +esc(e[2])+'</li>').join("") + (ev.length>40?'<li class="empty">…另有 '+(ev.length-40)+' 条</li>':"")
    : '<li class="empty">本季无事</li>';

  // 命令
  const mineOrd=f.orders.filter(o=>o[0]===ME);
  $("ordTitle").textContent = "本季命令\u3000"+f.orders.length+" 条（我方 "+mineOrd.length+"）";
  const seat=f.seat;
  let html = mineOrd.length
    ? mineOrd.map(o=>'· '+TYPE[o[1]]+(o[2]>=0?" "+D.name[o[2]]:"")).join("<br>")
    : '<span class="empty">我方本季未下令</span>';
  if(seat && seat.dropped.length)
    html += '<br>'+seat.dropped.map(d=>'<span class="x">✗ '+esc(d[0])+'</span>\u3000'+esc(WHY[d[1]]||d[1])).join("<br>");
  $("ord").innerHTML=html;

  let say="";
  if(seat&&seat.reason) say+='<div class="say"><b>本季意图</b>'+esc(seat.reason)+'</div>';
  if(seat&&seat.plan) say+='<div class="say"><b>跨季方略</b>'+esc(seat.plan)+'</div>';
  $("detail").innerHTML=say;
}
function row(k,v){ return "<dt>"+k+"</dt><dd>"+v+"</dd>"; }
function esc(s){ return String(s).replace(/[&<>]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
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
