// 标签避让的两条原语。
//
// 抽出来是因为同一个「两个矩形相不相交」在 PlayClient 里被写了三遍
// （牌记、路题记、关津名），三处各自展开成一行四个比较——写错一个不等号
// 不会报错，只会让某一类标签悄悄不避让。实测关津那一类此前根本没接进来：
// 同一屏上十四对标签互相压着，全是关津。
//
// 纯几何，不碰 React，可直接测。

/** 屏幕空间的矩形：[x, y, 宽, 高]，y 轴向下 */
export type Box = [number, number, number, number];

/** 两个矩形是否相交。边贴边不算相交 */
export function overlaps(a: Box, b: Box): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2]
      && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/**
 * 按给定的几档候选位置放一个标签，返回第一个不与已占位相交的档；
 * 全撞则返回 null——挤到无处可放时，少一个名字远好过多一团糊字。
 *
 * 命中时**就地**把该档推进 placed：避让是贪心的，后来者要看见先来者。
 */
export function fitLabel(placed: Box[], slots: Box[]): Box | null {
  for (const box of slots) {
    if (placed.some((p) => overlaps(box, p))) continue;
    placed.push(box);
    return box;
  }
  return null;
}

/**
 * 一串文字的宽度估算。
 *
 * 中日韩字宽约 1em，数字、空格、拉丁字母约 0.55em。一刀切 0.62 会低估
 * 中文串——实测「关道·潼关 41 日」因此仍压在左冯翊的城印上。
 *
 * 一等宽的范围比原先的 \u4e00-\u9fff 宽一点：全角标点（〇「」·、全角括号）
 * 排出来也是一个字宽，牌记与题记里都有。
 */
const FULL_WIDTH = /[\u3000-\u9fff\uff00-\uffef\u00b7]/;
export function textWidth(text: string, size: number): number {
  return [...text].reduce(
    (n, ch) => n + size * (FULL_WIDTH.test(ch) ? 1 : 0.55), 0);
}
