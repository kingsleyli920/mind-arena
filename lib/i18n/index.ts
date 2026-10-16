// 界面文案目录。中文是源，英文是平行本——与 docs 那边同一条规矩。
//
// 三个决定，都写在这里，因为它们都有过别的选法：
//
// **一、key 用结构化英文，不用中文原文。** 拿原文当 key 看着省事（不用起名），
// 但原文一改 key 就飘，而改原文正是最常发生的事；届时英文那份会静静地停在旧 key
// 上，退回中文显示，没人会发现。这与 docs 那边的漂移戳是同一个问题，
// 那边用哈希拦，这边用「key 不随文字变」拦。
//
// **二、语序靠命名参数，不靠拼接。** `t("army.take", { from, to })` 而不是
// `"自" + from + "取" + to`。中文「自 A 取 B」与英文 "took B from A" 的语序不同，
// 拼接是把语序焊死在代码里——docs/I18N-PLAN.md 第二节数过，引擎里有约 95 处这种
// 拼接点，是整件事最贵的一项。阶段 1 先把这一层用起来，阶段 3 才有地方落。
//
// **三、模型路径一个字都不走这里。** 观测、提示词、候选 key 永远是中文：
// 换了语言，模型读的规则与它挑的候选一起变，新旧榜不可比。
// tests/model-locale.test.mjs 盯着这条，这里只是复述。
import { zh } from "./zh.ts";
import { en } from "./en.ts";

export type Locale = "zh" | "en";
export const LOCALES: readonly Locale[] = ["zh", "en"];
export const DEFAULT_LOCALE: Locale = "zh";

/** 目录是扁平的 `a.b.c` → 文案。扁平是为了闸好写：两份 key 集合直接比 */
export type Dict = Record<string, string>;
export const DICTS: Record<Locale, Dict> = { zh, en };

/** `<html lang>` 要用的值 */
export const HTML_LANG: Record<Locale, string> = { zh: "zh-CN", en: "en" };

const HOLE = /\{(\w+)\}/g;

/** 一条文案里用到的参数名。闸拿它比两份目录的参数是否一致 */
export const holesIn = (s: string) => [...s.matchAll(HOLE)].map((m) => m[1]).sort();

export type Params = Record<string, string | number>;

/**
 * 取一条文案。
 *
 * 缺 key 时**返回 key 本身**而不是抛错：一个没译的按钮上显示 `board.col.usd`
 * 很难看，但比整页白屏好，而且难看正是让人去补的理由。闸会在测试里先拦住它，
 * 所以线上不该见到。
 */
export function translate(locale: Locale, key: string, params?: Params): string {
  const d = DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
  const raw = d[key] ?? DICTS[DEFAULT_LOCALE][key];
  if (raw === undefined) return key;
  if (!params) return raw;
  return raw.replace(HOLE, (m, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : m);
}

/** 绑定了语言的取文案函数。组件里拿到的是这个 */
export type T = (key: string, params?: Params) => string;
export const makeT = (locale: Locale): T => (key, params) => translate(locale, key, params);

/** 路径前缀。`/` 与 `/board` 有真路由（要被英文搜索到），英文版在 `/en` 下 */
export const withLocale = (locale: Locale, path: string) =>
  locale === DEFAULT_LOCALE ? path : `/${locale}${path === "/" ? "" : path}`;

/** 从路径认语言。`/en`、`/en/board` 是英文，其余是中文 */
export const localeFromPath = (path: string): Locale =>
  /^\/en(\/|$)/.test(path) ? "en" : "zh";
