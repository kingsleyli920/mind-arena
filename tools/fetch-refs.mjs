// 下载皴法提取所需的公有领域山水画（约 26MB），存到 refs/（已在 .gitignore 外，请勿提交）。
// 全部取自 Wikimedia Commons，授权为 Public domain 或 CC0。
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.REF_DIR ?? "refs";
const WORKS = [
  { title: "宋李唐萬壑松風圖 軸.png",                                          slug: "litang-wanhesongfeng" },
  { title: "富春山居圖(無用師卷).jpg",                                          slug: "huanggongwang-fuchun" },
  { title: "Fan Kuan - Travelers Among Mountains and Streams - Google Art Project.jpg", slug: "fankuan-xishanxinglv" },
  { title: "Guo Xi - Early Spring (large).jpg",                                slug: "guoxi-zaochun" },
];
const UA = "MindArena-research/1.0 (https://github.com/; contact via project owner)";

await fs.promises.mkdir(OUT, { recursive: true });
for (const w of WORKS) {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.search = new URLSearchParams({ action: "query", format: "json", titles: `File:${w.title}`, prop: "imageinfo", iiprop: "url|size|extmetadata" });
  const meta = await (await fetch(api, { headers: { "User-Agent": UA } })).json();
  const page = Object.values(meta.query.pages)[0];
  const info = page.imageinfo?.[0];
  if (!info) { console.error(`✗ ${w.slug}: 未找到`); continue; }
  const license = info.extmetadata?.LicenseShortName?.value ?? "?";
  const ext = path.extname(new URL(info.url).pathname) || ".jpg";
  const dest = path.join(OUT, w.slug + ext);
  if (fs.existsSync(dest) && fs.statSync(dest).size === info.size) { console.log(`· ${w.slug}${ext} 已存在，跳过`); continue; }
  const buf = Buffer.from(await (await fetch(info.url, { headers: { "User-Agent": UA } })).arrayBuffer());
  await fs.promises.writeFile(dest, buf);
  console.log(`✓ ${w.slug}${ext}  ${info.width}×${info.height}  ${(buf.length/1048576).toFixed(1)}MB  [${license}]`);
}
