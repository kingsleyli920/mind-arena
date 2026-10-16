// 一份榜还作不作数：拿它跑的那版规则，比当前引擎的。
//
// 判据用**指纹**，不用版本号。这不是偏好，是 content/fingerprint.ts 开头那段
// 论证的直接后果：版本号是人写的标签，两个方向都会错——只升版本没动数值，
// 它把「其实一样」判成不可比；改了数值忘了升版本，它又把「其实不一样」判成可比。
// 榜里早就盖了 packFingerprint，而 /board 页一度拿 packVersion 在比，
// 用的正是它自己的模块说不该用的那把尺。旧榜没盖指纹（后加的），那时才退回版本号。
import { ruleFingerprint } from "../game/content/fingerprint.ts";

export type BoardStamp = {
  packVersion: string;
  packFingerprint?: string | null;
};

type LogEntry = { 版本?: string };

/**
 * 内容包的改动记载。**中文键名留在这里**，不散到界面上去。
 *
 * 包里的键本来就是中文（见 docs/I18N-PLAN.md 第三节：id 留在中文），而界面代码
 * 一旦直接写 `pack._frozen["改动记载"]`，「界面里不许有裸中文」那条棘轮就分不清
 * 这是没译的文案还是数据键——于是要么给它开白名单（闸从此松一寸），
 * 要么把键收到懂它的模块里（这里）。选后者。
 */
export const changeLogOf = (pack: { _frozen?: Record<string, unknown> }): LogEntry[] =>
  (pack._frozen?.["改动记载"] as LogEntry[] | undefined) ?? [];

/** "2.6.0" → 2006000，可比大小。段数不足或非数字按 0 计 */
export const verNum = (v: string) =>
  v.split(".").map(Number).reduce((a, n) => a * 1000 + (Number.isFinite(n) ? n : 0), 0);

/**
 * 榜之后升过哪几版。
 *
 * 不能写成「在改动记载里找到榜的版本，再往后数」：**榜可能比记载的第一条还老**。
 * 实测现挂的那份跑在 0.2.0/1.0.0 下，而改动记载是从 1.1.0 才逐版记的，
 * 按「找到再往后数」会得出「其间升过 0 版」——恰好在最该说话的时候闭嘴。
 *
 * 榜也可能同时跑在几版上（"0.2.0/1.0.0"），取**最新的那个**：
 * 比它还新的才算「其间」。
 */
export function versionsSince(stamp: BoardStamp, log: LogEntry[]): string[] {
  const parts = stamp.packVersion.split("/").filter(Boolean);
  if (!parts.length) return [];
  const boardVer = Math.max(...parts.map(verNum));
  return log.map((e) => e["版本"] ?? "").filter((v) => v && verNum(v) > boardVer);
}

export function boardStale(stamp: BoardStamp, pack: { version: string }): boolean {
  const fp = stamp.packFingerprint ?? null;
  return fp ? fp !== ruleFingerprint(pack).hash : stamp.packVersion !== pack.version;
}
