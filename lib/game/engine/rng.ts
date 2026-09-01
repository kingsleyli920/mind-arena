// 确定性随机源。
//
// MERS R33：全局唯一随机是开局的可招募在野名单，其余一切判定按
//   H(seed, 年, 季, 势力, 事件类, 序号)
// 派生。这条规则的要害不在"可复现"，而在**与裁决顺序无关**——
// 若随机数来自一条全局序列，那么谁先被结算就会拿到不同的数，
// 同一批命令换个顺序结算结果就变，R6 的「裁决顺序不影响任何结果」
// 立刻失守，逐位重放也就无从谈起。
//
// 因此这里不提供任何有状态的 next()。每次取数都必须把完整坐标传进来。

/** FNV-1a 64 位（用两个 32 位半字模拟，避免 BigInt 的性能与序列化开销） */
function fnv1a(input: string): [number, number] {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c + i) & 0xff; h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return [h1 >>> 0, h2 >>> 0];
}

/** 事件坐标。缺任何一维都可能让两次不同判定撞同一个数 */
export interface RollKey {
  seed: string;
  year: number;
  season: number;
  /** 势力 id；与势力无关的全局事件用 "*" */
  faction: string;
  /** 事件类别，如 "field" | "siege" | "defect" | "recruit" */
  event: string;
  /** 同一事件类在同一时点的序号，从 0 起 */
  seq: number;
}

/**
 * 用长度前缀而非分隔符拼接。
 * 简单用 "|" 分隔会碰撞：faction="a" event="b|c" 与 faction="a|b" event="c"
 * 拼出同一个串，两个不同事件因而共用同一个随机数——这种潜伏错误
 * 到后期几乎无法排查。长度前缀在构造上就排除了这种可能。
 */
function part(s: string): string {
  return `${s.length}:${s}`;
}
export function keyString(k: RollKey): string {
  return part(k.seed) + part(String(k.year)) + part(String(k.season))
       + part(k.faction) + part(k.event) + part(String(k.seq));
}

/** 返回 [0,1) 的确定性实数 */
export function roll(k: RollKey): number {
  const [a, b] = fnv1a(keyString(k));
  // 拼成 53 位以内的整数再归一，避免只用 32 位导致的粒度过粗
  return (a * 2097152 + (b >>> 11)) / 9007199254740992;
}

/** 返回 [0, n) 的确定性整数 */
export function rollInt(k: RollKey, n: number): number {
  return Math.floor(roll(k) * n) % n;
}

/**
 * 确定性洗牌。用于开局在野名单这类需要打乱顺序的场合。
 * Fisher–Yates，每一步的随机数都带自己的 seq，因此结果只取决于 key 与输入顺序。
 */
export function shuffle<T>(items: readonly T[], k: Omit<RollKey, "seq">): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rollInt({ ...k, seq: i }, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
