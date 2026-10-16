// 文案里的强调标记：目录里写 `**这样**`。
//
// **解析在这里，渲染在 rich.tsx。** 拆开不是洁癖：`node --test
// --experimental-strip-types` 不认 .tsx（JSX 不会被剥掉，报
// ERR_UNKNOWN_FILE_EXTENSION），于是只要解析和 JSX 待在同一个文件里，
// 这段逻辑就测不了。而它正是会悄悄出错的那部分——落单一个 `**`，
// 页面上多出两个星号，没有任何东西会报错。
//
// 为什么不把 `<b>` 直接写进文案：那样目录里就混进了 HTML，译者得懂标签，
// 而且哪天要换成别的元素就得改两种语言的每一条。
//
// 为什么不用「留一个 {b} 洞、强调那截单独一条 key」（本仓库先用过这招）：
// 一段话里强调两处以上就得留两个洞、两条 key，而中英的强调**位置和数量本来就
// 不一样**——中文「前后两份榜就**不可比**」，英文的强调落在句末。
//
// 刻意只支持这一种标记。目录不是富文本编辑器：链接、列表、换行都该由组件决定，
// 一旦这里开始支持 `[]()`，文案里就会长出布局。
const MARK = /\*\*([^*]+)\*\*/g;

export type Seg = { text: string; bold: boolean };

/** `a**b**c` → [a, **b**, c]。没有标记时只有一段 */
export function splitMarks(text: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

/** 文案里有几处强调。闸拿它比两种语言——数量可以不同，但「全都没了」多半是漏译 */
export const marksIn = (s: string) => [...s.matchAll(MARK)].length;

/** `**` 是不是成对。落单不报错，只在页面上多出两个星号 */
export const marksBalanced = (s: string) => (s.split("**").length - 1) % 2 === 0;
