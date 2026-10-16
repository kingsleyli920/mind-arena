import type { Metadata } from "next";
// 中文根布局。
//
// `<html lang>` 只能由**根**布局写，而一份应用只有一个根——于是「/ 是中文、
// /en 是英文」这件事在单根布局下做不出来：客户端改 document.lang 是改在
// 首屏之后的，读屏软件与爬虫拿到的仍是 zh-CN。
//
// Next 的办法是**路由组各带一个根布局**：`(zh)` 与 `(en)` 不出现在 URL 里，
// 但各自是一棵完整的树。代价是 app/ 下不能再有 layout.tsx，所有路由都得进组。
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { DICTS, HTML_LANG } from "@/lib/i18n";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: DICTS.zh["site.title"],
  description: DICTS.zh["site.desc"],
  alternates: { canonical: "/", languages: { "zh-CN": "/", en: "/en" } },
};

export default function ZhLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={HTML_LANG.zh}>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
