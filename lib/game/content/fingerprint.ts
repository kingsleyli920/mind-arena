// 胜负数值的指纹：把内容包里所有影响胜负判定的**数字**连同路径取一个稳定的和。
//
// 为什么不用版本号：版本号是人写的标签，会滞后。实测撞过一次——一份榜的
// 五个臂里，三个跑在 0.2.0、两个跑在 1.0.0，而那次提交只改了版本号与冻结
// 标记，规则数值一个没动（git diff：12 增 1 删，全是元数据）。
// 拿版本号当判据，会把「其实一样」判成「不可比」；反过来，若有人改了数值
// 而忘了升版本号，版本号又会把「其实不一样」判成「可比」——两个方向都错。
//
// 只取数字，不取文字：常数分组里大半是说明与依据，改一句措辞不该让闸响。
// 判据的 test 串另有对账（tests/engine.test.mjs 比 GRADE_CUTS）。
export function ruleFingerprint(pack: unknown): { count: number; hash: string } {
  const nums: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "number") { nums.push(`${path}=${v}`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") {
      for (const k of Object.keys(v as object).sort()) {
        walk((v as Record<string, unknown>)[k], `${path}.${k}`);
      }
    }
  };
  const p = pack as Record<string, unknown>;
  for (const k of ["constants", "actions", "victory", "terrain", "units", "skills"]) walk(p[k], k);
  // 定档门槛在包里是**字符串**（"zhouScore >= 1"），只取数字会漏掉它——
  // 而那正是这道闸最该拦的东西。实测漏过一次：改门槛前后两份榜的指纹相同，
  // 于是一份旧规则的榜被判成「可以和新榜并排读」。
  // 只从 victory[].test 里抠数字：说明文字里也有数字，但那些改措辞就会变
  for (const v of (p.victory as Array<Record<string, unknown>> | undefined) ?? []) {
    const test = typeof v.test === "string" ? v.test : "";
    for (const m of test.matchAll(/-?\d+(?:\.\d+)?/g)) nums.push(`victory.${v.id}.test=${m[0]}`);
  }
  nums.sort();
  // 不引第三方哈希：这里要的是「变了没有」，一个稳定的和就够
  let h = 0n;
  for (const s of nums) for (const ch of s) h = (h * 131n + BigInt(ch.codePointAt(0)!)) % (2n ** 61n - 1n);
  return { count: nums.length, hash: h.toString(36) };
}
