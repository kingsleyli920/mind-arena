import fs from "node:fs";

const CN = { 零:0, 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
function num(s) {
  if (!s) return null;
  let total = 0, sec = 0, n = 0;
  for (const c of s) {
    if (CN[c] !== undefined) n = CN[c];
    else if (c === "十") { sec += (n || 1) * 10; n = 0; }
    else if (c === "百") { sec += (n || 1) * 100; n = 0; }
    else if (c === "千") { sec += (n || 1) * 1000; n = 0; }
    else if (c === "万") { total += (sec + n) * 10000; sec = 0; n = 0; }
    else return null;
  }
  return total + sec + n;
}

// 1. 合并被 ctext 截断的户口行
const paras = [];
for (const { paras: ps } of JSON.parse(fs.readFileSync("lib/game/data/junguozhi-raw.json", "utf8"))) {
  for (const p of ps) {
    const i = paras.length - 1;
    // ctext 会把「二十/六城，户…」这类数字截断成两段，先粘回去
    if (i >= 0 && /^[零一二三四五六七八九十百]*城/.test(p) && /^[零一二三四五六七八九十百]+$/.test(paras[i])) paras[i] += p;
    else if (i >= 0 && /^城/.test(p) && /[一二三四五六七八九十百]$/.test(paras[i])) paras[i] += p;
    else paras.push(p);
  }
}

// 2. 拆开「州末汇总行。下一州首郡」粘连的段
const SUMMARY = /^(右(?:司隶校尉部|.{2}刺史部)，郡.*?[一二三四五六七八九十百]+。)(.+)$/;
const split = [];
for (const p of paras) {
  const m = p.match(SUMMARY);
  if (m) { split.push(m[1]); split.push(m[2]); } else split.push(p);
}

const D = "[零一二三四五六七八九十百千万]";
const NAME = /^(?:.{1,3}(?:郡|尹)|.{1,3}国|右扶风|左冯翊|.{2,5}属国)$/;
// 注文碎片，以及不单列为郡国的属国都尉（龟兹属国隶上郡）
const NOT_COMMANDERY = new Set(["侯国", "父国", "公国", "龟兹属国"]);
const ZHOU = ["司隶","豫州","冀州","兖州","徐州","青州","荆州","扬州","益州","凉州","并州","幽州","交州"];

let zi = 0;
const rows = [];
for (let i = 0; i < split.length; i += 1) {
  const p = split[i];
  if (/^右(司隶校尉部|.{2}刺史部)，郡/.test(p)) { zi += 1; continue; }
  if (!NAME.test(p) || NOT_COMMANDERY.has(p)) continue;

  const win = [1,2,3].map((k) => split[i+k] || "").join("‖");
  const cm = win.match(new RegExp(`^(${D}+)城`));
  const hm = win.match(new RegExp(`户(${D}+)`));
  const pm = win.match(new RegExp(`口(${D}+)`));
  // 属国即使缺户口也收；其余需有城数或户数，以排除「侯国」「父国」等注文碎片
  if (!cm && !hm && !p.endsWith("属国")) continue;

  // 郡治 = 城数/户口之后第一个县名（《郡国志》体例：凡县名先书者，郡所治也）
  let seat = null;
  for (let k = 1; k <= 5 && !seat; k += 1) {
    const c = split[i+k];
    if (!c) break;
    const tail = c.replace(new RegExp(`^${D}+城(，(永和五年)?户${D}+)?(，口${D}+)?。?`), "");
    const cand = (tail || c).split(/[。，]/)[0];
    if (cand && cand !== c.split(/[。，]/)[0] && cand.length <= 3) { seat = cand; break; }
    if (cand && cand.length <= 3 && !/城|户|口/.test(cand) && !/^雒阳[东西南北]/.test(cand)) seat = cand;
  }

  rows.push({
    zhou: ZHOU[zi] ?? "?", name: p,
    counties: cm ? num(cm[1]) : null,
    households: hm ? num(hm[1]) : null,
    population: pm ? num(pm[1]) : null,
    seat,
  });
}

const EXPECT = { 司隶:7, 豫州:6, 冀州:9, 兖州:8, 徐州:5, 青州:6, 荆州:7, 扬州:6, 益州:12, 凉州:12, 并州:9, 幽州:11, 交州:7 };
console.log("州     郡国   城     户         口");
let ok = true;
for (const z of ZHOU) {
  const rs = rows.filter((r) => r.zhou === z);
  if (rs.length !== EXPECT[z]) ok = false;
  console.log(`${z.padEnd(4)} ${rs.length === EXPECT[z] ? "✓" : "✗"} ${String(rs.length).padStart(2)}/${EXPECT[z]} ${String(rs.reduce((a,r)=>a+(r.counties||0),0)).padStart(5)} ${String(rs.reduce((a,r)=>a+(r.households||0),0)).padStart(9)} ${String(rs.reduce((a,r)=>a+(r.population||0),0)).padStart(10)}`);
}
const t = rows.reduce((a,r)=>({c:a.c+(r.counties||0), h:a.h+(r.households||0), p:a.p+(r.population||0)}), {c:0,h:0,p:0});
console.log(`\n解析 ${rows.length} 郡国 / ${t.c} 县 / 户 ${t.h.toLocaleString()} / 口 ${t.p.toLocaleString()}`);
console.log(`原文 105 郡国 / 1180 县 / 户 9,698,630 / 口 49,150,220`);
console.log(ok ? "✓ 十三州郡国数全部吻合原文汇总行" : "✗ 仍有州不符");
console.log("缺郡治:", rows.filter(r=>!r.seat).map(r=>r.name).join(" ") || "无");
fs.writeFileSync("lib/game/data/commanderies-raw.json", JSON.stringify(rows, null, 1));
