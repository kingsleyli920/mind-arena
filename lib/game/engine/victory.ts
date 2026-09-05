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
import { cmp } from "./cmp.ts";

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
  for (const c of [...commanderies].sort((a, b) => cmp(a.id, b.id))) {
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
  for (const [z, n] of [...ownedInZhou].sort((a, b) => cmp(a[0], b[0]))) {
    const total = geo.zhouMembers.get(z)?.length ?? 0;
    if (total > 0 && n * 2 > total) zhouNames.push(z);
  }
  let zhouSeats = 0;
  for (const [, seat] of [...geo.zhouSeat].sort((a, b) => cmp(a[0], b[0]))) {
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

/**
 * **连续的州进度**：每个州按「我方郡数 ÷ 过半所需」计，封顶 1，全图求和。
 *
 * 定档看的是控了几个州，而「控住」本身是一道台阶——过半那一郡值一整档，
 * 前面几郡一分不值。于是每局的配对差只能取 0 或 ±100，噪声天然压过信号，
 * 48 局的下限正是被这道台阶逼出来的。
 *
 * 这个量把台阶摊成斜坡，且**长在定档判据自己的轴上**：
 * 一个郡值多少取决于它在哪个州（徐州五郡，过半要三，一郡值 1/3；
 * 益州十二郡，过半要七，一郡值 1/7），控住之后再多拿一分不值——
 * 与「第五个散郡值 0 分，凑成半州的那一个郡值一整档」是同一条规则的连续版。
 *
 * 拿郡数增量当细分做不到这一点：目的流拿分更高而占郡更少（−0.4 郡），
 * 因为它挑的是值钱的郡不是多的郡。郡数不是目标函数，州才是。
 */
export function zhouEquiv(
  s: { commanderies: Record<CommanderyId, { owner: FactionId | null }> },
  geo: Geography, f: FactionId,
): number {
  let sum = 0;
  for (const members of geo.zhouMembers.values()) {
    const half = Math.floor(members.length / 2) + 1;
    let mine = 0;
    for (const id of members) if (s.commanderies[id]?.owner === f) mine += 1;
    sum += Math.min(1, mine / half);
  }
  return sum;
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
/**
 * 本局的纪元时限。
 *
 * 包里的「纪元时限 6」是配着 16 季局定的（3 纪元 × 6 季 ≈ 18 ≥ 16）。
 * 长局若照搬，三个纪元十八季就走完，此后四十几季全泡在末纪元里，
 * 「早取无主之地的时间价值」这条设计意图也就没了。按局长等分。
 */
export function epochLimitFor(
  s: { seasonsPerGame: number }, P: { epochCount: number; epochLimit: number },
): number {
  return Math.max(P.epochLimit, Math.ceil(s.seasonsPerGame / P.epochCount));
}

export function gradeOf(st: Standing, start: StartStanding): Grade {
  const zhouGain = st.controlledZhou - start.controlledZhou;
  const seatGain = st.zhouSeats - start.zhouSeats;
  // 甲以上两档判**绝对**疆域，不判增量。
  //
  // 增量判据在短局里是对的：四年里多拿一两个州就是本事，且它中和了开局强弱。
  // 但它到甲档就封顶了——六十季的长局里控了八个州，判据照样只给甲，
  // 于是后半局的每一次胜利都不再有回报，长局等于没有目标。
  // 十三州过半即霸，十一州即王：这两条与开局无关，谁做到都算数
  if (st.controlledZhou >= 11) return "wang";
  if (st.controlledZhou >= 7) return "ba";
  if (zhouGain >= 4) return "chao";
  if (zhouGain >= 2 || (zhouGain >= 1 && seatGain >= 2)) return "jia";
  if (zhouGain >= 1 || seatGain >= 1) return "yi";
  // 「不低于开局」在第一季就自动成立，等于白送保底档。必须是「高于」，
  // 且至少一郡夺自他方——只捡无主之地不算进攻
  if (st.commanderies > start.commanderies && st.conquests >= 1) return "bing";
  return "ding";
}

export const GRADE_RANK: Record<Grade, number> =
  { ding: 0, bing: 1, yi: 2, jia: 3, chao: 4, ba: 5, wang: 6 };
/** 档位的中文名。jia/yi/bing/ding 是固定的音写，不是可调数值，故不入内容包 */
export const GRADE_CN: Record<Grade, string> =
  { jia: "甲", yi: "乙", bing: "丙", ding: "丁", chao: "超", ba: "霸", wang: "王" };

/**
 * 反事实定档：此刻若取下 target，本势力能到哪一档。
 *
 * 候选表把「这仗能不能打赢」算到了小数点后——forecast 给出缺口区间、
 * 可防守区间、三值判词——却一个字不提**「打赢了值什么」**。
 * 而记分函数是州级的：第五个散郡值 0 分，凑成半州的那一个郡值一整档。
 * 这道阶梯此前对模型完全不可见：brief 讲州、候选讲郡，中间的
 * 「这个郡属于哪个州」在观测里根本没有。于是模型能做的唯一判断是
 * 「哪个目标最好打」，那不是决策，是排序。
 *
 * 与现档比的是 bestGrade（历史最高档）而非当前实位——记分取的就是最高档，
 * 已经拿到手的乙档再拿一次值 0 分。
 *
 * 纯函数：不改状态、不进 RNG，与 forecast 同性质，不影响 R6 / R33。
 */
export function gradeIfTaken(
  s: GameState, geo: Geography, f: FactionId, target: CommanderyId,
): { st: Standing; grade: Grade } | null {
  const fs_ = s.factions[f];
  const tgt = s.commanderies[target];
  if (!fs_ || !tgt || tgt.owner === f) return null;
  const st = standingOf(s, geo, f);
  const z = geo.zhouOf.get(target);
  const zhouNames = [...st.zhouNames];
  if (z && !zhouNames.includes(z)) {
    const members = geo.zhouMembers.get(z) ?? [];
    let mine = 0;
    for (const id of members) if (s.commanderies[id]?.owner === f) mine += 1;
    if (members.length > 0 && (mine + 1) * 2 > members.length) zhouNames.push(z);
  }
  const next: Standing = {
    commanderies: st.commanderies + 1,
    controlledZhou: zhouNames.length,
    zhouSeats: st.zhouSeats + (z && geo.zhouSeat.get(z) === target ? 1 : 0),
    // 只捡无主之地不算「夺自他方」，与 gradeOf 的丙档判据同源
    conquests: st.conquests + (tgt.owner ? 1 : 0),
    zhouNames,
  };
  const start = {
    commanderies: fs_.startCommanderies,
    controlledZhou: fs_.startZhou,
    zhouSeats: fs_.startSeats,
  };
  return { st: next, grade: gradeOf(next, start) };
}

/**
 * 给模型看的态势简报。
 *
 * 候选标签只讲单个目标的攻防，讲不出「往哪个方向打才算数」。
 * 而档位判据是州级的——吕布开局据兖州，豫州六郡里有三个无主，
 * 占到四郡即多控一州升乙档；贪心地打最近最弱的目标则永远停在丁档。
 * 若不把这层信息摆出来，胜负判据对模型就是不可见的，评测测的将是猜谜。
 */
export function briefFor(
  s: GameState, geo: Geography, f: FactionId,
  adj?: Map<CommanderyId, Array<{ to: CommanderyId }>>,
  nameOf?: (id: FactionId) => string,
): string {
  const who = (id: FactionId) => nameOf?.(id) ?? id;
  const st = standingOf(s, geo, f);
  const fs_ = s.factions[f];
  if (!fs_) return "";
  const lines: string[] = [];
  lines.push(
    `【态势】直辖 ${st.commanderies} 郡（开局 ${fs_.startCommanderies}），`
    + `控制 ${st.controlledZhou} 州（开局 ${fs_.startZhou}）${st.zhouNames.length ? `：${st.zhouNames.join("、")}` : ""}，`
    + `据州治 ${st.zhouSeats} 个（开局 ${fs_.startSeats}），夺自他方 ${st.conquests} 郡`,
  );
  // 只报**现档**。升档条件那三句是逐季不变的常量，规则摘要里
  // 「怎么算赢」一节已经逐字写过一遍——每季再发一遍，16 季白花八百多 tok，
  // 而观测峰值只剩三百 tok 余量
  lines.push(`【档位】现为${GRADE_CN[fs_.bestGrade]}档`);

  // 逐州列出差多少，这是「往哪打」的直接依据。
  // 只列够得着的州——把交州、并州这类隔着半个天下的地方也铺出来，
  // 是在用无关信息稀释真正的选择
  const reachable = new Set<string>();
  if (adj) {
    for (const c of Object.values(s.commanderies)) {
      if (c.owner !== f) continue;
      const z = geo.zhouOf.get(c.id);
      if (z) reachable.add(z);
      for (const e of adj.get(c.id) ?? []) {
        const nz = geo.zhouOf.get(e.to);
        if (nz) reachable.add(nz);
      }
    }
  }
  const rows: string[] = [];
  for (const [z, members] of [...geo.zhouMembers].sort((a, b) => cmp(a[0], b[0]))) {
    let mine = 0, vacant = 0;
    const others = new Map<FactionId, number>();
    for (const id of members) {
      const o = s.commanderies[id]?.owner;
      if (o === f) mine += 1;
      else if (!o) vacant += 1;
      else others.set(o, (others.get(o) ?? 0) + 1);
    }
    if (adj && !reachable.has(z)) continue;                   // 够不着的州不列
    // 此前还有一条「我 0 郡且无空地就不列」。它恰好把**够得着、但整州都在
    // 他方手里**的州全部滤掉了——而那正是最值钱的扩张方向：
    // 一个五郡全归吕布的徐州，模型在简报里一个字都看不到，
    // 「再取 N 郡即控制」这句唯一说明「要打多少」的话也就没有了。
    // 够不着的仍然不列（reachable 那条还在），列的都是打得着的
    if (!adj && mine === 0 && vacant === 0) continue;
    const need = Math.floor(members.length / 2) + 1 - mine;
    const seat = geo.zhouSeat.get(z);
    const seatWho = seat ? s.commanderies[seat]?.owner ?? "无主" : "?";
    rows.push(
      `  ${z}：共 ${members.length} 郡，我 ${mine}，无主 ${vacant}`
      + `${others.size ? `，他方 ${[...others].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${who(k)} ${v}`).join("、")}` : ""}`
      + `｜${need <= 0 ? "已控制" : `再取 ${need} 郡即控制`}`
      + `｜州治 ${seat}（${seatWho === f ? "在我手" : seatWho === "无主" ? "无主" : who(seatWho)}）`,
    );
  }
  if (rows.length) lines.push("【各州】", ...rows);
  return lines.join("\n");
}
