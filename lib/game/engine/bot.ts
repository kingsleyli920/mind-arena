import { OrderBudget } from "./order-budget.ts";
// 确定性规则 AI。
//
// decide / pick 保留五种评测画像；decideForPlay 在此基础上处理玩家长局的经济与调度。
// 评测画像的约束：
//   1. 完全确定 —— 同一状态必出同一决策，否则自对局的结论不可复现
//   2. 策略画像必须真的不同 —— 若"苟活流"和"进攻流"打出同样的结果，
//      要么是机器人没区分开，要么是玩法本身分不出高下。两者都必须查明
import { upkeepFor } from "./economy.ts";
import { listActions, frontDistances, reinforcesFront, type Graph, type Rules, DEFAULT_RULES } from "./actions.ts";
import type { EngineParams } from "./params.ts";
import { stationedAt, retinueAt, troopCap, type Roster } from "./officers.ts";
import type { Geography } from "./victory.ts";
import type { FactionId, GameState, Order } from "./types.ts";
import { observedGarrison } from "./intel.ts";
import { cmp } from "./cmp.ts";

export type Profile = "turtle" | "balanced" | "aggressive" | "opportunist" | "purpose";

export const PROFILES: Record<Profile, string> = {
  turtle:      "苟活流：只内政不出兵，验证「存续本身不得分」是否真的成立",
  balanced:    "均衡流：先安内后攘外，兵力比 ≥1.4 才打",
  aggressive:  "进攻流：兵力比 ≥1.1 就打，内政只在民心告急时做",
  opportunist: "投机流：只打最弱的邻居，且优先无主之地",
  purpose:     "目的流：认候选上的 gain——打能凑成一整州、能夺州治与治所的那个，而不是最好打的那个",
};

/**
 * 各画像对每类动作的偏好权重。数值本身无量纲，只用于排序。
 *
 * **appoint 的权重是当年「调任免费」时定的**（均衡流 8，高于内政的 6）。
 * 调任改为「调动已在任者收 1 令」之后，同样的优先级会把本该用于内政与征伐的
 * 令挤掉：实测均分从 179 掉到 157、非苟活极差从 39.3 掉到 21.3。
 * 免费动作排在前面无所谓（它不占预算），收费之后就必须重排。
 */
// 劝降（submit）权重给得高：它只在对方已近覆亡时才出现（≤2 郡且被碾压 6 倍），
// 门槛本身就是稀缺性，不必再靠权重压。一次成功抵得上打好几季。
//
// 改阵（array）的权重刻意压低。同 seed 100 局实测三档：
//   权重 0（不认这条令）      非苟活极差 40.0  曹操出局 47%  ρ 0.60
//   权重 5/3/1/2             非苟活极差 45.3  曹操出局 45%  ρ 0.60  ← 用这档
//   权重 9/6/3/5             非苟活极差 28.7  曹操出局 30%  ρ 0.37
// 给高了各画像都无脑改阵，策略差异被抹平——极差掉三分之一。
// 「一条几乎总是对的动作」正是评测最不需要的东西
const WEIGHTS: Record<Profile, Record<string, number>> = {
  turtle:      { submit: 9, suade: 6, array: 5, govern: 10, build: 8, scout: 3, ally: 6, muster: 0, campaign: -100, passage: 2, retire: 0, appoint: 5, withdraw: 11, invest: 6 },
  balanced:    { submit: 9, suade: 6, array: 3, govern: 6, build: 5, scout: 4, ally: 4, muster: 5, campaign: 7, passage: 2, retire: 0, appoint: 4, withdraw: 3, invest: 5 },
  aggressive:  { submit: 9, suade: 6, array: 1, govern: 2, build: 2, scout: 5, ally: 1, muster: 8, campaign: 12, passage: 1, retire: 0, appoint: 5, withdraw: 0, invest: 3 },
  opportunist: { submit: 9, suade: 6, array: 2, govern: 4, build: 4, scout: 6, ally: 5, muster: 4, campaign: 9, passage: 2, retire: 0, appoint: 4, withdraw: 5, invest: 5 },
  // 与均衡流同底，差别全在下面读 gain 的那几行——
  // 这样两者同场对打时，分差可归因于「看不看目的」，而不是权重表调得不一样
  purpose:     { submit: 9, suade: 6, array: 3, govern: 6, build: 5, scout: 4, ally: 4, muster: 5, campaign: 7, passage: 2, retire: 0, appoint: 4, withdraw: 3, invest: 5 },
};

/**
 * 目的流读 gain 的权重。数值来自同世界配对 A/B（同 seed、只有一个席位换用该策略、
 * 360 组）：24/20/16 得 +4.2±4.2，48/40/32 得 +11.4±4.2，再放宽升档之战的
 * 出兵门槛得 +17.2±5.7。
 *
 * 对照组是这组数字的立身之本：同等量级、同等稀疏度但挂在产出档/城防/民心上，
 * 实测 −6.4±5.9。两者相差 23.6 分远超噪声——涨分来自「信息挂在记分函数上」，
 * 不是「随便加个权重都能涨」。
 */
const GAIN_W = { jia: 48, yi: 40, seizeZhou: 48, seat: 40, capital: 32 };

/**
 * 出兵门槛，单位是「缺口余量」= 我方最少缺口 − 敌方最多可防守。
 * 大于 0 表示无论浮动与迷雾怎么走都破得了城。
 *
 * 此前这里是「兵力比」，从 label 里抠正则拿。两处都是错的：
 * 比值与引擎判胜负用的量没有关系（实测比 4.35 打不下、比 2.26 能破城），
 * 而从 label 抠正则意味着标签一改就静默读错。现在读 Candidate.forecast。
 */
const MIN_MARGIN: Record<Profile, number> = {
  turtle: Infinity, balanced: 0, aggressive: -2, opportunist: -1, purpose: 0,
};

/**
 * 为一个势力挑本季的命令。
 * 不含任何随机——同一 state 必得同一结果，自对局才可复现。
 */
export function decide(
  s: GameState, f: FactionId, g: Graph, profile: Profile, rules: Rules = DEFAULT_RULES,
  roster: Roster | null, P: EngineParams, geo: Geography | null = null,
): Order[] {
  return pick(s, f, g, profile, rules, roster, P, geo).orders;
}

/** 玩家对局使用统一导向策略；评测的五种固定画像保持原口径。 */
export function decideForPlay(
  s: GameState, f: FactionId, g: Graph, rules: Rules = DEFAULT_RULES,
  roster: Roster | null, P: EngineParams, geo: Geography | null = null,
): Order[] {
  return decideInner(s, f, g, "purpose", rules, roster, P, geo, true).orders;
}

/**
 * 同上，但把选中的**候选 key** 一并给出。
 *
 * 评测要拿机器人当基线，就必须让它走与模型完全相同的那条路：
 * picks → admit() → orders。否则机器人绕过准入层，illegalRate 与
 * 令数用率两列对它是空的，而那两列正是用来判「模型有没有在乱下令」的。
 * 没有同场基线，模型拿到的 200 分说明不了任何事。
 */
export function pick(
  s: GameState, f: FactionId, g: Graph, profile: Profile, rules: Rules = DEFAULT_RULES,
  roster: Roster | null, P: EngineParams, geo: Geography | null = null,
): { orders: Order[]; picks: string[] } {
  return decideInner(s, f, g, profile, rules, roster, P, geo);
}

function decideInner(
  s: GameState, f: FactionId, g: Graph, profile: Profile, rules: Rules = DEFAULT_RULES,
  roster: Roster | null, P: EngineParams,
  /** 地理。目的流没有它就退化成均衡流——候选上不会有 gain 可读 */
  geo: Geography | null = null,
  campaignPlay = false,
): { orders: Order[]; picks: string[] } {
  // 「出兵后余兵低到什么程度算把城送出去」由规则推导，不拍系数：
  // 邻敌最多带走自己八成守军，而破开「城防 30 以上 + 基数」的两档可防守
  // 需要兵力比 2.0，故余兵低于邻敌的 0.8/2.0 即一击可破。
  // 拿这个数去拟合出局率会得到 0.35，但那是对着指标调参，包一改就不成立了。
  const maxStrength = Math.max(...Object.values(P.strengthRatio));
  const breachTwo = P.breachLadder.find(([, n]) => n === 3)?.[0] ?? 2;
  const safeRatio = maxStrength / breachTwo;
  const cands = listActions(s, f, g, P, rules, roster, undefined, geo);
  if (!cands.length) return { orders: [], picks: [] };
  const w = WEIGHTS[profile];
  const minMargin = MIN_MARGIN[profile];

  const upkeep = upkeepFor(s, f, P);
  const distances = campaignPlay ? frontDistances(s, g, f) : new Map<string, number>();
  const cashTight = P.goldOn && s.factions[f].gold < upkeep * 2;
  const scored = cands.map((c) => {
    let score = w[c.action.type] ?? 0;
    // 外交这一层试过按「对象是谁、缔来干什么」打分，**量到更差，已退回**。
    //
    // 起因是实录里一处看得见的空转：刘繇第 1 季与四家缔盟、第 2 季把四家全绝，
    // 八条令白扔。加了两条判据（缔盟只对接壤方有价值；绝盟只在真要打他时才做）：
    //   硬禁版   曹操出局 38%→51%  非苟活极差 40.7→24.7
    //   软惩罚版 曹操出局 38%→50%  非苟活极差 40.7→24.0
    // 两版都把最难的席位推过 50% 的判据线，并把画像分差砍掉四成，
    // 画像次序也翻转（机会流反超均衡流）。
    //
    // 推测是「不为开战而绝盟」那条硬禁的连带：盟约会挡住进攻，一旦缔了就退不出来，
    // 于是各家互相锁死、弱者被围观至死。空转确实是浪费，
    // 但这个修法的代价远大于它省下的那几条令
    // 救援必须先判：它的 label 里没有「比 X」，若落进下面的通用征伐闸门，
    // ratioOf 取到 0 而被当成「打不动」直接弃掉——实测 608 条救援候选无一被采纳
    if (c.key.startsWith("relief:")) {
      // 丢城的代价高于野战失利，除苟活流外都应优先出兵解围。
      //
      // 判据读 c.field（野战预告），不再自己拿「兵力比 ≥0.9」估。
      // 那个比值与引擎判胜负用的量不是一回事——野战比的是
      // 兵力 × 武将加成 × 兵种系数。实测按兵力比判的结果是：
      // 62% 的野战在战力比 <0.8 时发起、直接大败，五次里输四次。
      // 这与征伐早就修过的那个错误是同一个（见 forecast.ts 开头）
      const ff = c.field;
      if (!ff) return { c, score: -1e9 };
      if (profile === "turtle" && ff.verdict !== "可解围") return { c, score: -1e9 };
      if (ff.verdict === "解不了") return { c, score: -1e9 };   // 送人头不叫救援
      // 区间下界才是保守估计：上界赢下界输的仗，本质是赌浮动
      return { c, score: 14 + Math.min(8, (ff.ratioLo - 1) * 6) };
    }
    if (c.action.type === "campaign") {
      // 掏空老巢是所有画像共有的死法，不是某一流派的风格问题。
      // 四个画像都该有这条常识，否则测出来的不是策略差异，而是同一个失误——
      // 实测投机流曹操因此 10/10 全灭
      const target = c.action.target;
      const from = s.commanderies[c.action.from];
      const m = /城中余 (\d+) 人/.exec(c.label);
      const left = campaignPlay && c.mobilization ? c.mobilization.left
        : m ? Number(m[1]) : from?.garrison ?? 0;
      const threat = Math.max(0, ...(g.adj.get(c.action.from) ?? [])
        .filter((e) => s.commanderies[e.to]?.owner && s.commanderies[e.to].owner !== f
          && (!campaignPlay || e.to !== target))
        .map((e) => campaignPlay ? observedGarrison(s, f, e.to, P).value : s.commanderies[e.to].garrison));
      if (!campaignPlay && threat > 0 && left < threat * safeRatio) return { c, score: -1e9 };

      // 城下有第三方围城军时，这一令结算的是野战——按 c.field 判，
      // 而不是按攻城的缺口数。此前这里只是「没有 forecast 就弃掉」，
      // 而 forecast 其实还在（且描述的是打不成的那场仗）
      if (c.field) {
        if (c.field.verdict === "解不了") return { c, score: -1e9 };
        if (profile === "turtle") return { c, score: -1e9 };
        return { c, score: score + Math.min(10, (c.field.ratioLo - 1) * 6) };
      }
      const fc = c.forecast;
      if (!fc) return { c, score: -1e9 };                    // 城下有兵，另一套判定
      // 缺口余量：最少能开的缺口 − 最多要面对的可防守数
      const margin = fc.breachLo - fc.holdHi;
      // 目的流为「取下即升档」之战放宽一档门槛。这是有下行的赌注而非免费保命项：
      // 实测把配对增益从 +11.4 抬到 +17.2 的同时，吕布的出局从 36/60 抬到 44/60
      const gate = profile === "purpose" && c.gain?.upgrade ? minMargin - 2 : minMargin;
      // 达不到该画像的出兵门槛就直接弃掉，而不是给低分——
      // 给低分会让它在无仗可打时仍被选中，那是「被迫送死」而非策略
      const canBesiege = campaignPlay && typeof c.project?.seasons === "number";
      if (margin < gate && !canBesiege) return { c, score: -1e9 };
      if (canBesiege && margin < gate) score += 18 - (c.project?.seasons ?? 0) * 2;
      else score += (margin - minMargin) * 4 + (fc.verdict === "破城" ? 6 : 0);
      // 迷雾里的仗要打折：未探时城防与守将不明，区间宽得多
      if (fc.fog === "tier") score -= 3;
      // 投机流额外偏好无主之地：不树敌，扩张最快
      if (profile === "opportunist" && !s.commanderies[c.action.target]?.owner) score += 8;
      // 倾国投入风险高，只在余量确实够时选
      if (c.action.strength === "allout") score += margin >= minMargin + 1 ? 3 : -5;
      // 目的流认「打赢了值什么」。读结构化的 c.gain，不从 label 抠正则——
      // 这个文件里已经为此栽过一次，标签一改就静默读错。
      //
      // 试过把 gain 的**阶跃改成斜坡**：目的流只在「这一取即凑够半州」时给 +48，
      // 差三郡与差一郡在评分上完全一样，于是贪心评分永远不为一个州做前两步。
      // 实测收官时 24 局有 9 个州卡在「差 2 郡」、差 1 郡的只有 2 个，
      // 看着正是这个病。加 ZHOU_SLOPE / needAfter 之后（同 seed 48 局，
      // 基线目的流 158.3，两者同底所以配对方差小、CI 只有 ±8~12）：
      //   斜率 12  152.1（−6±9）   斜率 24  154.2（−4±8）
      //   斜率 48  156.3（−2±11）  斜率 96 与 200 都是 152.1（−6±12）
      // 没有一档过线，且非单调——斜率再大也只是逼近目的流，压不过它。
      // 「铺路」这件事贪心评分吃不到：铺到一半被人打断，前两步就白走了，
      // 而要判断会不会被打断，得预判两三季之后的敌情
      if (profile === "purpose" && c.gain) {
        const gn = c.gain;
        if (gn.upgrade === "jia") score += GAIN_W.jia;
        else if (gn.upgrade === "yi") score += GAIN_W.yi;
        // 这一取即凑够该州过半。与升乙档高度重合，重合本身就是要强调的
        if (gn.needBefore > 0 && gn.needAfter <= 0) score += GAIN_W.seizeZhou;
        if (gn.isSeat) score += GAIN_W.seat;
        // 治所一失全境断供，实测 66.8% 随即被灭，是全图杠杆最高的一击
        if (gn.isCapital) score += GAIN_W.capital;
      }
    }
    // 试过「集结只往临敌处集」——候选层试过并退回过一次，
    // 教训写着「改在候选层会抹平画像差异，要改就改在权重上」，于是改到了这里。
    // **更差，而且是灾难性的**（同 seed 48 局，基线目的流 158.3）：
    //   前线权重 ±4    102.1（−56±31）  出局 5/48 → 22/48
    //   前线权重 ±8    100.0（−58±30）  出局 23/48
    //   前线权重 ±14   100.0（−58±30）  出局 25/48
    // 换个层改并不能救一个本身就错的主意。原因这次看清楚了：集结从每个来源郡
    // 抽走五成戍兵，而「集结地公开可见，期间被攻破则整体失败」——
    // 在边境集结等于把前线守军抽空、再把集结地公示给对手。
    // 这条规则本身就在惩罚「在边境囤兵」，前线优先是逆着规则走
    // 共讨：打霸者是联军的正事。只绝盟不给理由的话联军等于没做——
    // 实测袁绍在 21 郡触发共讨，之后照样长到 34 郡，那八家结了盟却谁也没去打他。
    // 加权不宜过大：它是一个倾向，不是命令，否则所有画像都会变成同一种打法
    if (c.action.type === "campaign") {
      const owner = s.commanderies[c.action.target]?.owner;
      if (owner && owner !== f && s.factions[owner]?.coalitionAgainst) score += 5;
    }
    if (c.action.type === "build") {
      // 特殊建筑加分：它们**别处建不得**，而通用的哪个郡都能建。
      // 一个有铁之郡把三个位子填满通用建筑，那块铁就永远浪费了——
      // 而位子只有三个（constants.建筑.每郡上限），先来后到是不可逆的
      const special = ["ironworks", "saltern", "stud", "farmstead"];
      if (special.includes(c.action.kind)) score += 4;
    }
    if (c.action.type === "invest") {
      // 机器人只自授。「把名分送给别人换他去那个方向发力」是一步需要读局势的棋，
      // 基线不做——基线要能被模型超过，不是要替模型下棋
      if (c.action.to !== f) score -= 20;
      // 按**这个号真能收几郡**加分，不按「授官是件大事」加分。
      // 系数不是拍的，是拿这个画像自己给一郡开的价换算的：征伐花 2 令换 1 郡，
      // 故一郡值 campaign/2；传檄要等 swaySeasons 季且中途可能被人抢先，
      // 再打对折。苟活流的 campaign 是 −100（它根本不用这条价），退回 6
      else {
        const perCommandery = (w.campaign > 0 ? w.campaign : 6) / 2;
        score += perCommandery * Math.min(c.sway?.commanderies ?? 0, 4) * 0.5;
      }
    }
    if (c.action.type === "withdraw") {
      // 此前是 `/已围 (\d+) 季，余 (\d+) 人/` 的正则 + 「季数×2 + 残兵少加 4」。
      // 那既违反本文件自己立的规矩（bot.ts 开头与 types.ts 都明写「不从 label 抠正则」，
      // forecast 就是为此而生），又让撤围成了一条关于**经过了多久**的令——
      // 从不问围城是不是快赢了。实测 61 次撤围里 20 次撤的是本季必破的城。
      //
      // 改读结构化字段。三档，判据来自引擎自己的递推而不是季数：
      //   本季即破      → 绝不撤（这一击就在阶段七，而撤围在阶段五，撤了就白围）
      //   上限内可破    → 压住撤意，且这座城越值钱压得越狠
      //   上限内破不了  → 照旧按「围得越久、残兵越少越该收」加分
      const n = c.project ? c.project.seasons : undefined;
      if (n === 0) score -= 100;                              // 这一击就在阶段七，撤了就白围
      else if (typeof n === "number") score -= 6 + (c.gain?.upgrade ? 6 : 0);
      // 上限内破不了，或前瞻算不出来：该收兵。+8 是对着旧打分的量级定的——
      // 旧式「季数×2 + (余兵<3000 ? 4 : 0)」对一支已围 2 季、残兵不多的军团正好给 8 分。
      // 削到 4 实测破城 496→461：军团赖在啃不动的城下，别处就少了这些兵
      else score += 8;
    }
    if (c.action.type === "appoint") {
      // 读结构化的 c.post，不从 label 抠「临敌」两个字。
      //
      // **零将之郡必须补人是常识，不是流派偏好**：出征兵力上限 = 驻将数 ×
      // 每将统兵，一个零将的临敌郡纵有十万戍兵也只出得动一支偏师，
      // 攻守两侧还都拿不到五维加成。此前这里只按「临敌」±3 分，
      // 于是四个画像同样地不会补人——测出来的不是策略差异，是同一个失误
      // 只表达画像偏好：进攻流优先把人放到临敌郡，苟活流优先后方。
      //
      // 试过在这里加「零将之郡优先补人」——理由看着很硬（兵力上限 =
      // 驻将数 × 每将统兵，零将的郡纵有十万戍兵也只出得动一支偏师）。
      // 但实测那不是常识而是一种打法：四个画像同时照做之后，出局率从 13%
      // 冲到 45%，画像排序翻转，ρ 从 0.49 涨到 0.66。把某一种打法塞进
      // 所有画像，测出来的就不再是策略差异——这正是「掏空老巢」那条注释
      // 说的反面：那条是所有画像共有的死法，这条不是。
      // 「该往哪补将」留给模型去答，那本来就是新增的那个决策
      const front = c.post?.front ?? false;
      score += profile === "turtle" ? (front ? 0 : 3) : (front ? 3 : 0);
      // 试过压低**付费调动**（占目的流全部令数开销的 45%，看着像空转）。
      // 两个版本都实测更差，已退回：
      //   全部付费调动 −6      158.3 → 141.7，出局 5/48 → 12/48，临敌零将 37% → 50%
      //   只压「往已有人的郡」  158.3 → 143.8，出局 5/48 → 8/48
      // 那 45% 不是浪费，是在买军力上限：出征兵力上限 = 驻将数 × 每将统兵，
      // 往已有两人的郡再加一人，等于给这个方向的进攻加 9000 兵的天花板。
      // 顺带买到守将加成。国库因此闲着 2368 金是真的，但它不是调任造成的
      // 编制这一层**刻意不给机器人打分**。试了三种写法都是净负收益：
      //   铺开（零将之郡优先补人）  目的流 216.7 → 177.5，反输均衡流 39 分
      //   集中（把前线郡补到上限）  目的流 181.7，仍输均衡流 14 分
      //   塞给全部画像             出局率 13% → 45%，画像排序翻转
      // 也就是说「该把关羽调到哪」不是一条打分规则抓得住的决策：
      // 它要预判两三季之后从哪个方向打，而贪心评分只看当下。
      //
      // 这恰恰是评测想要的东西——一个记分函数上有价值、而简单启发式吃不到的
      // 决策面。留着 c.post 给模型读，机器人这边只表达画像偏好，
      // 不假装自己会用。真会不会用，等接上模型再量。
    }
    if (c.action.type === "govern") {
      const at = s.commanderies[(c.action as { at: string }).at];
      if (at && at.moraleTier <= 2) score += 5;            // 民心告急优先
    }
    if (campaignPlay) {
      const a = c.action;
      // 统一导向基线不主动归隐；外交留给有明确共同目标的策略。
      if (a.type === "retire" || a.type === "ally") return { c, score: -1e9 };
      if (a.type === "campaign" && c.gain && c.gain.needBefore > 0) score += 30 / c.gain.needBefore;
      if (a.type === "muster") {
        const src = s.commanderies[a.at];
        const cap = roster ? troopCap(retinueAt(s, roster, a.at, P), P)
          * (src.buildings.includes("stud") ? P.studTroopMul : 1) : Infinity;
        const hasFront = (g.adj.get(a.at) ?? []).some((e) => s.commanderies[e.to]?.owner !== f);
        // 内陆待命军无移动命令；已经到统兵上限时再抽调也不能增加出征兵力。
        if (!hasFront || src.garrison * P.strengthRatio.allout >= cap
            || s.armies.some((army) => army.faction === f && army.at === a.at && !army.target)) {
          return { c, score: -1e9 };
        }
      }
      // 先保住收入，避免把全部令数花在调将后常年欠饷。
      if (cashTight && a.type === "govern" && ["farm", "soothe"].includes(a.policy)) score += 18;
      if (a.type === "build" && a.kind === "farmstead") score += cashTight ? 18 : 5;
      if (a.type === "appoint" && c.post?.front) score += 10;
      if (a.type === "submit") score += 40;
      if (a.type === "transfer") score = distances.get(a.to) === 0 ? 16 : 10;
      // 缺治所时全境断供，应先恢复行政中枢。
      if (a.type === "relocate" && s.commanderies[s.factions[f].capital ?? ""]?.owner !== f) score += 30;
    }
    return { c, score };
  })
    .filter((x) => x.score > -1e8)
    // 同分时按 key 排序，保证确定性
    .sort((a, b) => b.score - a.score || cmp(a.c.key, b.c.key));

  // 按令数预算贪心取，免费动作不占预算但受 freeUses 限制
  const orders: Order[] = [];
  const picks: string[] = [];
  const reservation = new OrderBudget(s, g, roster, P, rules, geo);
  const stationCounts = new Map<string, number>();
  if (campaignPlay && roster) for (const c of Object.values(s.commanderies)) {
    if (c.owner === f) stationCounts.set(c.id, stationedAt(s, roster, c.id).length);
  }
  for (const { c } of scored) {
    const a = c.action;
    if (campaignPlay && a.type === "appoint") {
      const have = stationCounts.get(a.at) ?? 0;
      if (have >= P.retinueCap) continue;
      if (c.post?.from) {
        const improves = reinforcesFront(s, g, f, c.post.from, a.at,
          stationCounts.get(c.post.from) ?? 0, have);
        if (!improves && (stationCounts.get(c.post.from) ?? 0) <= have + 1) continue;
        if ((stationCounts.get(c.post.from) ?? 0) <= 0) continue;
      }
    }
    if (reservation.take({ faction: f, action: a })) continue;
    if (campaignPlay) {
      if (a.type === "appoint") {
        stationCounts.set(a.at, (stationCounts.get(a.at) ?? 0) + 1);
        if (c.post?.from) stationCounts.set(c.post.from, (stationCounts.get(c.post.from) ?? 0) - 1);
      }
    }
    orders.push({ faction: f, action: a });
    picks.push(c.key);
  }
  return { orders, picks };
}
