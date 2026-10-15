import type { GameState, CommanderyId, FactionId } from "./types.ts";
import type { EngineParams } from "./params.ts";
import type { Graph } from "./actions.ts";

/**
 * 这座城本季是不是被**有效围困**。
 *
 * 判据不是「有没有敌军指着它」，是围城军兵力够不够。此前不问兵力，
 * 于是一支六百人的军团就能把两万守军的大郡产出锁死，代价只有一次首攻折损——
 * 顿兵封锁比攻城划算得多，而那正是这套规则最不想鼓励的打法。
 *
 * 比值取野战的相持比 0.8：那是这个引擎里既有的「打不动但缠得住」的刻度。
 * 比的是**裸守军**，不含地形守备加成——守方的地利用在打，不该再用来抗饿。
 */
export function besiegedBy(s: GameState, id: CommanderyId, byOthersThan: FactionId | null,
                    P: EngineParams, g?: Graph): boolean {
  const c = s.commanderies[id];
  if (!c) return false;
  let force = 0;
  const who = new Map<FactionId, number>();
  for (const a of s.armies) {
    if (a.target !== id || a.marchLeft > 0) continue;   // 还在路上的不算围
    if (byOthersThan !== null && a.faction === byOthersThan) continue;
    force += a.troops;
    who.set(a.faction, (who.get(a.faction) ?? 0) + a.troops);
  }
  if (force === 0) return false;
  if (force >= c.garrison * P.siegeGripRatio) return true;
  // 合围：兵力不够，但这座城的邻郡半数以上已在围城方手中——四面都是他的地，
  // 城里出不来、外面进不去，不必再问他带了多少人。
  // 只看兵力比是错的：首攻失手折 35%，于是本来与守军相当的部队打完就掉到 0.65 倍，
  // 围不住了，守方一兵不损、存粮不减，僵在那儿。实测 33% 的围城军卡在这一条
  if (!g || !P.siegeEncircle) return false;
  const nbs = (g.adj.get(id) ?? []).map((e) => s.commanderies[e.to]).filter((x) => !!x);
  if (!nbs.length) return false;
  for (const [f] of who) {
    const held = nbs.filter((n) => n.owner === f).length;
    if (held * 2 > nbs.length) return true;
  }
  return false;
}
