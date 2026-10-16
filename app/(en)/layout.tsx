import type { Metadata } from "next";
// 英文根布局。与 (zh)/layout.tsx 是同一棵树的另一种语言，差别只在 lang 与元数据。
// 为什么要两个根布局，见 (zh)/layout.tsx 开头。
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { DICTS, HTML_LANG } from "@/lib/i18n";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: DICTS.en["site.title"],
  description: DICTS.en["site.desc"],
  alternates: { canonical: "/en", languages: { "zh-CN": "/", en: "/en" } },
};

export default function EnLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={HTML_LANG.en}>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
