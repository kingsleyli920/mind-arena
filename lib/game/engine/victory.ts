// 胜负判据（MERS R39–R43）。
//
// 引擎首版用「郡国数相对开局的倍数」代替了包里写的州级判据，
// 于是出现两处与设计直接冲突的后果：
//   1. 丙档在第一季自动成立——开局即等于开局，保底档白送，
//      而包里明写「存续本身不得分」
//   2. 「控制州数 / 州治」完全没进结算，扩张的方向性无从体现：
//      占十个散郡与占一整州同分
//
// 此处按内容包重新实现。全部阈值来自包，判定所需的州与州治来自数据层。
import type { CommanderyId, FactionId, GameState, Grade } from "./types.ts";

export interface Geography {
  /** 郡 → 州 */
  zhouOf: Map<CommanderyId, string>;
  /** 州 → 其下全部郡 */
  zhouMembers: Map<string, CommanderyId[]>;
  /** 州 → 州治所在郡 */
  zhouSeat: Map<string, CommanderyId>;
}

export function buildGeography(
  commanderies: Array<{ id: string; zhou: string }>,
  seats: { seats: Array<{ zhou: string; commandery: string }> },
): Geography {
  const zhouOf = new Map<CommanderyId, string>();
  const zhouMembers = new Map<string, CommanderyId[]>();
  for (const c of [...commanderies].sort((a, b) => a.id.localeCompare(b.id))) {
    zhouOf.set(c.id, c.zhou);
    if (!zhouMembers.has(c.zhou)) zhouMembers.set(c.zhou, []);
    zhouMembers.get(c.zhou)!.push(c.id);
  }
  const zhouSeat = new Map<string, CommanderyId>();
  for (const s of seats.seats) zhouSeat.set(s.zhou, s.commandery);
  return { zhouOf, zhouMembers, zhouSeat };
}

export interface Standing {
  commanderies: number;
  /** 控制的州数：拥有该州过半郡国 */
  controlledZhou: number;
  /** 在手的州治数 */
  zhouSeats: number;
  /** 本局夺自他方（非无主）的郡国数 */
  conquests: number;
  /** 控制的州名，写进战报供模型看方向 */
  zhouNames: string[];
}

export function standingOf(s: GameState, geo: Geography, f: FactionId): Standing {
  let commanderies = 0;
  const ownedInZhou = new Map<string, number>();
  for (const c of Object.values(s.commanderies)) {
    if (c.owner !== f) continue;
    commanderies += 1;
    const z = geo.zhouOf.get(c.id);
    if (z) ownedInZhou.set(z, (ownedInZhou.get(z) ?? 0) + 1);
  }
  const zhouNames: string[] = [];
  for (const [z, n] of [...ownedInZhou].sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = geo.zhouMembers.get(z)?.length ?? 0;
    if (total > 0 && n * 2 > total) zhouNames.push(z);
  }
  let zhouSeats = 0;
  for (const [, seat] of [...geo.zhouSeat].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (s.commanderies[seat]?.owner === f) zhouSeats += 1;
  }
  return {
    commanderies,
    controlledZhou: zhouNames.length,
    zhouSeats,
    conquests: s.factions[f]?.conquests ?? 0,
    zhouNames,
  };
}

export interface StartStanding {
  commanderies: number; controlledZhou: number; zhouSeats: number;
}

/**
 * 按内容包的四档判据定档。顺序即优先级，先命中先取。
 *
 * 判的是**相对开局的增量**，不是绝对位置。按绝对数判时，
 * 刘璋开局即据益州过半与州治、吕布开局即据兖州过半与州治，两席 40/40 白拿乙档
 * ——吕布其中还有 16 局是被灭的。实测开局郡数与得分的相关系数因此升到 0.89，
 * 逼近「得分完全由开局决定」的红线。评测要测的是模型把局面推进了多少，
 * 不是它被发到了什么牌。
 */
export function gradeOf(st: Standing, start: StartStanding): Grade {
  const zhouGain = st.controlledZhou - start.controlledZhou;
  const seatGain = st.zhouSeats - start.zhouSeats;
  if (zhouGain >= 2 || (zhouGain >= 1 && seatGain >= 2)) return "jia";
  if (zhouGain >= 1 || seatGain >= 1) return "yi";
  // 「不低于开局」在第一季就自动成立，等于白送保底档。必须是「高于」，
  // 且至少一郡夺自他方——只捡无主之地不算进攻
  if (st.commanderies > start.commanderies && st.conquests >= 1) return "bing";
  return "ding";
}

export const GRADE_RANK: Record<Grade, number> = { ding: 0, bing: 1, yi: 2, jia: 3 };
