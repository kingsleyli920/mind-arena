/**
 * 「日志里哪一串字是势力 id」——按**已知的那批 id** 认，不按「一串小写字母」认。
 *
 * 引擎写日志时手上没有显示名（resolve 不该依赖界面的东西），所以
 * 「自 南阳郡 取 京兆尹（原属 lijue）」这类文本里留着 id，由界面翻译。
 * 原先的写法是 `text.replace(/[a-z]+/g, …)`：扫出每一串小写字母，拿去查表，
 * 查不到就原样放回。今天的中文界面里这样做碰不出事——日志里除了 id 几乎没有
 * 别的小写字母。
 *
 * 但它的前提是「一串小写字母就是 id」，而这个前提**界面一说英文就没了**：
 * 那时每行文字里的每个英文单词都会被拿去查一次表，撞上任何一个 id 就被换成
 * 一个人名——不报错，只是读起来莫名其妙。
 *
 * **今天还没有撞**：两个剧本的 31 + 20 个 id 里没有一个是英文常用词，最短的是
 * `lubu`、`sunce`。所以这不是在修一个正在出错的 bug，是在拆掉那个前提——
 * 它是 docs/I18N-PLAN.md 阶段 0 点名要先清掉的地基之一，而等到界面真说了英文
 * 再来查这种事，症状会是「某一句话里混进了一个人名」，没人会想到是这里。
 *
 * 改成从 id 集合现编一条交替正则，长的在前（避免 `liu` 先吃掉 `liubiao`），
 * 并要求前后不是字母数字（`lijue` 不该在 `lijuexyz` 里命中）。
 * 正则按 Map 缓存：一局之内 id 集合不变，没必要每行日志重编一次。
 */
const cache = new WeakMap<Map<string, string>, RegExp>();

/** 正则元字符。id 现在都是纯小写字母，但别指望它永远是 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function idRe(names: Map<string, string>): RegExp {
  const hit = cache.get(names);
  if (hit) { hit.lastIndex = 0; return hit; }
  const ids = [...names.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  // 一个 id 都没有时给一条永不命中的正则，别回退成 /[a-z]+/
  const re = ids.length
    ? new RegExp(`(?<![0-9A-Za-z])(?:${ids.map(esc).join("|")})(?![0-9A-Za-z])`, "g")
    : /(?!)/g;
  cache.set(names, re);
  return re;
}
