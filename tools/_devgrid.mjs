// 开发用地形网格：低分辨率真实高程，仅供渲染器调试，正式网格由 build-terrain-grid.mjs 产出
import fs from "node:fs";
import sharp from "sharp";
const SCR="/private/tmp/claude-501/-Users-kingsley-projects-mind-arena/4b36ddea-9dda-4576-9434-0619c8631613/scratchpad";
const W=94,E=127,S=16,N=43,CELL=0.1,COLS=330,ROWS=270;
const Z=6;
const lon2tx=(lon,z)=>Math.floor((lon+180)/360*(1<<z));
const lat2ty=(lat,z)=>{const r=lat*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*(1<<z));};
const tx0=lon2tx(W,Z),tx1=lon2tx(E,Z),ty0=lat2ty(N,Z),ty1=lat2ty(S,Z);
console.log(`z=${Z} 瓦片 x ${tx0}..${tx1}  y ${ty0}..${ty1}  共 ${(tx1-tx0+1)*(ty1-ty0+1)} 张`);
await fs.promises.mkdir(`${SCR}/dem`,{recursive:true});
const tiles=new Map();
const jobs=[];
for(let x=tx0;x<=tx1;x++)for(let y=ty0;y<=ty1;y++)jobs.push([x,y]);
let done=0;
await Promise.all(Array.from({length:6},async()=>{
  while(jobs.length){
    const [x,y]=jobs.shift();
    const p=`${SCR}/dem/${Z}-${x}-${y}.png`;
    if(!fs.existsSync(p)){
      const r=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`,{headers:{"User-Agent":"MindArena-dev/1.0"}});
      if(!r.ok){console.error(`✗ ${Z}/${x}/${y} ${r.status}`);continue;}
      await fs.promises.writeFile(p,Buffer.from(await r.arrayBuffer()));
    }
    const {data}=await sharp(p).removeAlpha().raw().toBuffer({resolveWithObject:true});
    tiles.set(`${x},${y}`,data); done++;
  }
}));
console.log(`已载入 ${done} 张瓦片`);
// 采样到网格
const elev=new Int16Array(COLS*ROWS);
const TS=256, n=1<<Z;
for(let row=0;row<ROWS;row++){
  const lat=N-(row+0.5)*CELL;
  const rad=lat*Math.PI/180;
  const gy=(1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*n;
  const ty=Math.floor(gy), py=Math.min(TS-1,Math.floor((gy-ty)*TS));
  for(let col=0;col<COLS;col++){
    const lon=W+(col+0.5)*CELL;
    const gx=(lon+180)/360*n;
    const tx=Math.floor(gx), px=Math.min(TS-1,Math.floor((gx-tx)*TS));
    const t=tiles.get(`${tx},${ty}`);
    if(!t){elev[row*COLS+col]=-32768;continue;}
    const o=(py*TS+px)*3;
    elev[row*COLS+col]=Math.round(t[o]*256+t[o+1]+t[o+2]/256-32768);
  }
}
// 起伏度 + 分类
const relief=new Int16Array(COLS*ROWS);
for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
  let mn=1e9,mx=-1e9;
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
    const rr=r+dr,cc=c+dc; if(rr<0||cc<0||rr>=ROWS||cc>=COLS)continue;
    const v=elev[rr*COLS+cc]; if(v<mn)mn=v; if(v>mx)mx=v;
  }
  relief[r*COLS+c]=Math.max(0,mx-mn);
}
const CODE={sea:"~",lake:"o",plain:".",hill:"h",mountain:"M",highland:"^"};
const t=new Array(COLS*ROWS).fill(".");
for(let i=0;i<COLS*ROWS;i++){
  const e=elev[i],rl=relief[i];
  if(e<=0) t[i]="~";
  else if(e>3000) t[i]="^";
  else if(e>1400||rl>900) t[i]="M";
  else if(e>350||rl>320) t[i]="h";
  else t[i]=".";
}
// 内陆水体：从边界 flood fill 标真海，其余 ~ 改 lake
const seen=new Uint8Array(COLS*ROWS); const st=[];
for(let c=0;c<COLS;c++){st.push(c);st.push((ROWS-1)*COLS+c);}
for(let r=0;r<ROWS;r++){st.push(r*COLS);st.push(r*COLS+COLS-1);}
while(st.length){const i=st.pop(); if(seen[i]||t[i]!=="~")continue; seen[i]=1;
  const r=(i/COLS)|0,c=i%COLS;
  if(c>0)st.push(i-1); if(c<COLS-1)st.push(i+1); if(r>0)st.push(i-COLS); if(r<ROWS-1)st.push(i+COLS);}
for(let i=0;i<COLS*ROWS;i++) if(t[i]==="~"&&!seen[i]) t[i]="o";

const out={meta:{west:W,east:E,south:S,north:N,cellSize:CELL,cols:COLS,rows:ROWS,zoom:Z,dev:true},
  legend:CODE,terrain:t.join(""),elevation:Array.from(elev),relief:Array.from(relief)};
fs.writeFileSync(`${SCR}/terrain-grid-dev.json`,JSON.stringify(out));
const cnt={};for(const ch of t)cnt[ch]=(cnt[ch]||0)+1;
console.log("地形占比:",Object.entries(cnt).map(([k,v])=>`${k} ${(v/t.length*100).toFixed(1)}%`).join("  "));
const at=(lon,lat)=>t[Math.floor((N-lat)/CELL)*COLS+Math.floor((lon-W)/CELL)];
console.log(`抽查 黄海(120,36)=${at(120,36)}  四川盆地(104.5,30.5)=${at(104.5,30.5)}  秦岭(107.5,33.8)=${at(107.5,33.8)}  华北平原(115,36)=${at(115,36)}  青藏东缘(95,32)=${at(95,32)}`);
