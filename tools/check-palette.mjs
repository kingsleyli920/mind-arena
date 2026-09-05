/**
 * 势力配色把关。
 *
 * 由来：原配色是配水墨底图取的土色系，三十一家挤在赭石到花青那一小块色域里，
 * 提纯后仍有 32 对势力 ΔE<18——吕布和李傕郭汜在图上几乎同色。渲染端的
 * vivid() 补不了这个，提纯只能拉开已有的间距，造不出本来没有的间距。
 * 所以颜色改在数据层（tools/build-scenario-194.mjs），由本脚本把关。
 *
 *   node tools/check-palette.mjs            复核现有配色，不达标则退出码 1
 *   node tools/check-palette.mjs --arrange  重排一版并打印（锚色不动）
 *
 * 判据（CIE76 ΔE，够用：这里只需要「一眼能否分开」的量级，不需要 ΔE2000 的精度）：
 *   · 任意两家           ΔE ≥ 20
 *   · 起始接壤的两家     ΔE ≥ 30   —— 挨着的更容易看串
 *   · 每家              L*∈[40,82]、C*≤90
 *
 * 这两个界不是拍的：势力名是「本色文字 + 近白描边」画的，填色铺在纸底 #EDEEEA 上，
 * 所以太浅两头都糊，L*≤82。彩度界取自实测——纯绿/纯红/纯蓝这类荧光色 C*∈[105,134]，
 * 而要放行的传统设色（吕布橙 76、张鲁紫 83、曹操蓝 62）都在 83 以下，90 落在空档里。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_ANY = 20, MIN_NBR = 30, L_LO = 40, L_HI = 82, C_HI = 90;

const un = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
const hsl2rgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h * 6) % 2) - 1)), m = l - c / 2;
  const seg = ((Math.floor(h * 6) % 6) + 6) % 6;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return [Math.round((t[0] + m) * 255), Math.round((t[1] + m) * 255), Math.round((t[2] + m) * 255)];
};
function lab(rgb) {
  const f = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [r, g, b] = rgb.map(f);
  let X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const q = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = q(X); Y = q(Y); Z = q(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const chroma = (rgb) => { const L = lab(rgb); return Math.hypot(L[1], L[2]); };

/** 《三国志》一路的传统设色，钉死不参与重排 */
export const ANCHOR = {
  caocao: "#2f6fd8",     // 曹魏 蓝
  liubei: "#1f9e52",     // 蜀汉 绿
  yuanshao: "#e0b422",   // 袁绍 黄
  lubu: "#ef7420",       // 吕布 橙
  lijue: "#c2213f",      // 董卓余部 绛
  liubiao: "#17a8a0",    // 刘表 青
  zhanglu: "#8b4bd8",    // 张鲁 紫
  mateng: "#e0409a",     // 马腾 洋红
  gongsunzan: "#86bde8", // 白马将军 浅蓝
  yuanshu: "#a8801e",    // 袁术 土金
  liuzhang: "#8cc32a",   // 刘璋 黄绿
  wuzhu: "#a8a29a",      // 无主 灰：唯一允许的低饱和
};

const sc = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/game/data/scenario-194.json"), "utf8"));
const adj = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/game/data/adjacency.json"), "utf8"));
const ids = sc.factions.map((f) => f.id);
const nameOf = Object.fromEntries(sc.factions.map((f) => [f.id, f.name]));
const ownerOf = Object.fromEntries(Object.entries(sc.ownership).map(([c, o]) => [c, o.factionId]));

/** 起始就接壤的势力对。无主不计——它是灰的，且四处都挨着 */
const neighbor = new Set();
for (const e of adj.edges) {
  const a = ownerOf[e.from], b = ownerOf[e.to];
  if (a && b && a !== b && a !== "wuzhu" && b !== "wuzhu") neighbor.add([a, b].sort().join("|"));
}
const isNbr = (x, y) => neighbor.has([x, y].sort().join("|"));

export function audit(colorOf) {
  const bad = [];
  for (const id of ids) {
    const L = lab(un(colorOf[id])), C = chroma(un(colorOf[id]));
    if (L[0] < L_LO || L[0] > L_HI) bad.push(`${nameOf[id]} 明度 L*=${L[0].toFixed(0)} 越界[${L_LO},${L_HI}]`);
    if (C > C_HI) bad.push(`${nameOf[id]} 彩度 C*=${C.toFixed(0)} 过 ${C_HI}，会刺眼`);
  }
  let mnAny = Infinity, mnAnyP = null, mnNbr = Infinity, mnNbrP = null;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const [x, y] = [ids[i], ids[j]];
    const d = dE(un(colorOf[x]), un(colorOf[y]));
    if (d < mnAny) { mnAny = d; mnAnyP = [x, y]; }
    if (isNbr(x, y) && d < mnNbr) { mnNbr = d; mnNbrP = [x, y]; }
    if (d < MIN_ANY) bad.push(`ΔE=${d.toFixed(1)} 过近：${nameOf[x]} ⨯ ${nameOf[y]}`);
    else if (isNbr(x, y) && d < MIN_NBR) bad.push(`ΔE=${d.toFixed(1)} 接壤仍近：${nameOf[x]} ⨯ ${nameOf[y]}`);
  }
  return { bad, mnAny, mnAnyP, mnNbr, mnNbrP };
}

/** 贪心 + 局部改良：最大化最小色差，接壤对按 1.35 倍折算后再参与比较 */
function arrange() {
  const cand = [];
  for (let hi = 0; hi < 120; hi++) for (let si = 0; si <= 10; si++) for (let li = 0; li <= 12; li++) {
    const c = hsl2rgb(hi / 120, 0.28 + si * 0.072, 0.42 + li * 0.032);
    const L = lab(c);
    if (L[0] < L_LO + 2 || L[0] > L_HI - 2 || Math.hypot(L[1], L[2]) > C_HI - 4) continue;
    cand.push(c);
  }
  const W = (a, b) => (isNbr(a, b) ? 1 / 1.35 : 1);
  const chosen = new Map();
  for (const [id, h] of Object.entries(ANCHOR)) if (ids.includes(id)) chosen.set(id, un(h));
  const score = (id, c, skip) => {
    let d = Infinity;
    for (const [jd, w] of chosen) { if (jd === id || jd === skip) continue; d = Math.min(d, dE(c, w) * W(id, jd)); }
    return d;
  };
  for (const id of ids.filter((i) => !chosen.has(i))) {
    let best = null, bd = -1;
    for (const c of cand) { const d = score(id, c); if (d > bd) { bd = d; best = c; } }
    chosen.set(id, best);
  }
  for (let pass = 0; pass < 800; pass++) {
    let worst = null, wd = Infinity;
    for (const [id, v] of chosen) {
      if (ANCHOR[id]) continue;
      const d = score(id, v, id); if (d < wd) { wd = d; worst = id; }
    }
    if (!worst) break;
    let best = null, bd = wd;
    for (const c of cand) { const d = score(worst, c, worst); if (d > bd) { bd = d; best = c; } }
    if (!best) break;
    chosen.set(worst, best);
  }
  return Object.fromEntries([...chosen].map(([k, v]) => [k, hex(v)]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--arrange")) {
    const p = arrange();
    for (const id of ids) console.log(`  ${p[id]}  ${id.padEnd(12)} ${nameOf[id]}`);
    console.log("\n把上表填回 tools/build-scenario-194.mjs 的 FACTIONS，再跑该生成器。");
  } else {
    const colorOf = Object.fromEntries(sc.factions.map((f) => [f.id, f.color]));
    const r = audit(colorOf);
    console.log(`势力 ${ids.length} 家，起始接壤 ${neighbor.size} 对`);
    console.log(`最小色差 ΔE=${r.mnAny.toFixed(1)}（${nameOf[r.mnAnyP[0]]} ⨯ ${nameOf[r.mnAnyP[1]]}）门槛 ${MIN_ANY}`);
    console.log(`接壤最小 ΔE=${r.mnNbr.toFixed(1)}（${nameOf[r.mnNbrP[0]]} ⨯ ${nameOf[r.mnNbrP[1]]}）门槛 ${MIN_NBR}`);
    if (r.bad.length) { console.error("\n不达标：\n  " + r.bad.join("\n  ")); process.exit(1); }
    console.log("配色达标 ✓");
  }
}
