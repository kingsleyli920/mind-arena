// 中文目录。**中文是源**——英文那份（en.ts）照着它译，key 由这里定。
//
// 分块与 docs/I18N-PLAN.md 的迁移顺序一致，一块迁完就能交付给读者：
//   home.*  落地页          lab.*   对局实验室（落地页内）
//   board.* 排行榜          primer.* 怎么玩
//   play.*  对局页外壳
//
// 留在中文、不进这份目录的：候选表、战报、规则摘要——那些是引擎实时拼的
//（docs/I18N-PLAN.md 阶段 3），而且其中一部分**永远不翻**（模型提示词、观测）。
import type { Dict } from "./index.ts";

export const zh: Dict = {
  // ── 通用 ────────────────────────────────────────────────────────
  "site.name": "Mind Arena",
  "site.sub": "智弈场",
  "site.title": "Mind Arena · 智弈场",
  "site.desc": "让多个 AI 模型在可复现的轻量游戏中对战，也让玩家亲自向模型发起挑战。",
  "nav.aria": "主要导航",
  "nav.home.aria": "Mind Arena 首页",
  "nav.games": "游戏",
  "nav.board": "排行榜",
  "nav.protocol": "协议",
  "nav.roadmap": "路线图",
  "chip.local": "本地原型",
  "lang.switch": "English",

  // ── 落地页 ──────────────────────────────────────────────────────
  "home.kicker": "AI GAME LAB · MODEL VS MODEL · HUMAN VS MODEL",
  "home.title.1": "让模型下场，",
  "home.title.2": "不只回答问题。",
  "home.lede": "一套为 AI 对局设计的轻量游戏平台。统一接入多个模型，"
    + "用可复现的规则、完整回放和决策证据，观察它们如何真正做选择。",
  "home.cta.play": "入局对弈",
  "home.cta.map": "查阅沙盘",
  "home.cta.protocol": "查看对战协议",
  "home.stat.models": "计划接入模型",
  "home.stat.games": "轻量游戏类型",
  "home.stat.protocol": "共享对战协议",

  "home.roster.aria": "计划模型阵容",
  "home.roster.measured": "实测 · {games} 局",
  "home.roster.foot": "榜分 = 档位分 + 档内进度。最强的机器人基线 {baseline}。",
  "home.roster.more": "看完整排行榜与置信区间",

  "home.protocol.kicker": "ONE SHARED CONTRACT",
  "home.protocol.title.1": "模型只负责决策，",
  "home.protocol.title.2": "规则引擎负责事实。",
  "home.protocol.observe": "接收同一版本的结构化局势",
  "home.protocol.decide": "在相同时间与调用预算内下令",
  "home.protocol.resolve": "由确定性引擎校验并统一结算",
  "home.protocol.replay": "保留决策、结果和完整证据",

  "home.lab.kicker": "REPUTATION BEFORE REVENUE",
  "home.lab.title.1": "不是公布胜负，",
  "home.lab.title.2": "而是公开证据。",
  "home.lab.spec": "统一观察、决策、校验和结算格式，让其他开发者能接入自己的 Agent。",
  "home.lab.replay": "每场对局保留种子、动作、无效决策、状态哈希和完整时间线。",
  "home.lab.card": "同时报告胜率、成本、延迟、非法动作率和稳定性，而不是只截一张榜单。",
  "home.lab.adapters": "游戏核心与模型供应商解耦，未来可以开源协议、SDK 和基础适配器。",

  "home.foot.proto": "Mind Arena · local prototype",
  "home.foot.first": "First match: 群雄沙盘",

  // ── 对局实验室（落地页内的四个模块与配置台）────────────────────
  "lab.kicker": "GAME MODULES",
  "lab.title": "一套平台，四种战场",
  "lab.lede": "首发只把“群雄沙盘”做深；其余游戏复用模型、回放、排行榜和验证能力。",

  "lab.game.01.title": "群雄沙盘",
  "lab.game.01.desc": "六路模型经营城池、调度粮草、缔结盟约，在同一张天下图上争夺最终话语权。",
  "lab.game.01.status": "首发原型",
  "lab.game.01.window": "每回合一次",
  "lab.game.02.title": "塔防生存",
  "lab.game.02.desc": "模型在固定决策窗口配置防线，规则引擎持续推进战场并记录每次判断。",
  "lab.game.02.status": "规则预研",
  "lab.game.02.window": "每 12 秒一次",
  "lab.game.03.title": "足球教练",
  "lab.game.03.desc": "阵型、换人、节奏与临场事件共同构成一场可复盘的模型教练对决。",
  "lab.game.03.status": "概念排期",
  "lab.game.03.window": "比赛阶段切换",
  "lab.game.04.title": "篮球战术",
  "lab.game.04.desc": "以回合和球权为最小单位，让模型安排轮换、战术与最后一攻。",
  "lab.game.04.status": "概念排期",
  "lab.game.04.window": "每个球权一次",

  // 模块图标是**字形**，不是文案：汉字在英文版里也照用，
  // 放进目录只是为了让「哪天要换」有地方换，而不必再改组件
  "lab.game.01.symbol": "将",
  "lab.game.02.symbol": "塔",
  "lab.game.03.symbol": "⚽",
  "lab.game.04.symbol": "24",

  "lab.card.inspect.aria": "查看{title}规划",
  "lab.card.configure": "配置首场对局",
  "lab.card.roadmap": "查看模块规划",

  "lab.fact.window": "决策窗口",
  "lab.fact.truth": "规则真相",
  "lab.fact.truth.v": "确定性引擎",
  "lab.fact.replay": "回放格式",

  "lab.form.aria": "{title}对局配置",
  "lab.notice.title": "保留在共享协议路线图中",
  "lab.notice.body": "先验证“群雄沙盘”的 Agent 对战闭环，再复用同一套模型适配器、回放和评测系统。",
  "lab.notice.back": "返回首发原型",

  "lab.mode.legend": "对战方式",
  "lab.mode.mvm": "模型 vs 模型",
  "lab.mode.hvm": "玩家 vs 模型",
  "lab.seat.a": "席位 A",
  "lab.seat.b": "席位 B",
  "lab.seat.a.aria": "席位 A 模型",
  "lab.seat.b.aria": "席位 B 模型",
  "lab.style.legend": "实验模式",
  "lab.style.benchmark": "公平基准",
  "lab.style.persona": "人格娱乐",
  "lab.seed": "确定性种子",
  "lab.submit": "生成本地对局配置",
  "lab.note": "{status}。这里先预配两席；进入沙盘后可为六个主要势力分别绑定任意 OpenRouter 文本模型。",

  "lab.models.loading": "正在读取 OpenRouter 模型目录…",
  "lab.models.ok": "{count} 个文本模型 · {auth}",
  "lab.models.auth.yes": "API 已配置",
  "lab.models.auth.no": "待配置 server-only key",
  "lab.models.fail": "模型目录暂不可用 · 已显示常用回退选项",

  "lab.prepared.same": "相同局势 / 相同动作预算",
  "lab.prepared.replay": "决策、校验与结算全部进入回放",
  "lab.prepared.launch": "进入可玩沙盘",

  // ── 排行榜 ──────────────────────────────────────────────────────
  "board.title": "汉末沙盘 · 排行榜",
  "board.era.fallback": "兴平元年 · 群雄割据",
  "board.stale.lead": "这份榜已经过期。",
  "board.stale.from": "它是在内容包 {version}",
  "board.stale.fp": "（指纹 {fp}）",
  "board.stale.now": "下跑出来的，而当前引擎是 {version}（指纹 {fp}）。",
  "board.stale.since": "其间升过 {n} 版：{list}。",
  "board.stale.tail": "下面的分数不对应任何一局现在能打出来的棋",
  "board.stale.tail2": "，仅作历史留存，不可与新结果比较。",
  "board.sub": "{arms} 个对局方 × {games} 局，同一批开局种子、同一批对手、席位轮换，每局 {seasons} 季。规则包 {version}",
  "board.sub.spend": "。实扣合计 ${usd}。",

  "board.col.who": "对局方",
  "board.col.board": "榜分",
  "board.col.delta": "对基线 ±95%",
  "board.col.cont": "州进度",
  "board.col.growth": "疆域倍数",
  "board.col.elim": "灭亡",
  "board.col.illegal": "非法率",
  "board.col.usd": "每局实扣",
  "board.col.dist": "档位分布",
  "board.tag.bot": "机器人",
  "board.tag.base": "基线",
  "board.tag.nosig": "置信区间盖过零，分不开",
  "board.blank": "空手 {pct}%",
  "board.blank.tip": "{blank}/{turns} 席·季有候选而一条令未挑——这一列在非法率与榜分里都看不出来",

  "board.rulers.h": "三把尺",
  "board.rulers.board": "档位分 + 档内的连续进度。排名用它。档位仍是头号指标——低一档永远压不过高一档。",
  "board.rulers.cont": "每州按「我方郡数 ÷ 过半所需」计、封顶 1，再加半个州治，取相对开局的增量。连续，最灵敏，但**分不开两个机器人**：它们疆域几乎一样，差别在挑值钱的郡过线——那正是档位在量而它看不见的。",
  "board.rulers.growth": "终局郡数 ÷ 开局郡数。最直观，但不入排名：占郡多不等于成势。",
  "board.rulers.table": "对基线的配对差",
  "board.rulers.grade": "档位分",
  "board.rulers.verdict": "三把尺给出",
  "board.rulers.verdict.same": "完全相同的名次",
  "board.rulers.verdict.tail": "最弱的那个在最粗的尺（档位分）上没过显著线——那是它的效应小，不是尺子瞎：三把尺的方向与名次都一致。",

  "board.seats.h": "按席位",
  "board.seats.note": "强席与弱席混在一个均分里，正是「模型是不是普遍地差」这个问题被答错的地方。下表是各席位的郡数增量（括号内为灭亡数）。",

  "board.history.h": "历史",
  "board.history.note": "规则数值一改，前后两份榜就**不可比**。所以历史不是一条线，是分代的：同一代（规则数值的指纹相同）之内可以连起来看，跨代之间只能各读各的。",
  "board.history.era": "规则代",
  "board.history.now": "当前（已冻结）",
  "board.history.dead": "已废",
  "board.history.col.board": "榜",
  "board.history.col.date": "日期",
  "board.history.col.git": "提交",
  "board.history.dim": "更早的几份榜不在这里，原因有二：一是它们的各臂跑在**不同代**的规则上（当时边跑边改），那种榜内部就不可比；二是有的目录里躺着同一次跑的几份快照，那是工作目录不是榜。两种情况都会被产出工具当场拒掉。",

  "board.caveats.h": "读这份榜之前",
  "board.caveat.ci.b": "没有区间的名次不是名次。",
  "board.caveat.ci": "「对基线 ±95%」里带 · 的那几行，置信区间盖过零，意思是**分不开**，不是「略胜」。",
  "board.caveat.n.b": "48 局是分辨力下界。",
  "board.caveat.n": "实测 20 分左右的真实差距需要 ≥48 局才超出区间；局数更少的跑可以验管道、看非法率，但名次不可当结论。",
  "board.caveat.illegal.b": "非法率不是「答错题」。",
  "board.caveat.illegal": "它是「单看每条都合法、合起来超了本季令数」那一类，会被准入层丢掉。丢掉的令等于没下。",
  "board.caveat.ver.b": "跨版本的榜不能并排读。",
  "board.caveat.ver": "规则数值一改，新旧榜就不可比——页面顶上那个包版本与提交号就是为这件事留的。",
  "board.caveat.skew.b": "本榜的一处例外：",
  "board.caveat.usd.b": "钱是实扣，不是估算。",
  "board.caveat.usd": "价目表在重推理模型上会低估十倍——实测过一个模型估 $1.61、实扣 $16.64。",
  "board.foot.play": "自己下场",
  "board.foot.map": "看地图",
  "board.back": "首页",
  "board.zhonly": "沙盘本身目前只有中文：规则摘要、候选表与战报由引擎实时拼出，那一层还没有英文（也有一部分永远不会有——模型读的那一份必须留在中文，否则新旧排行榜不可比）。",

  // ── 规则速览（对局页的「怎么玩」）──────────────────────────────
  // 所有数字从 EngineParams 取，作为 {参数} 填进来——**不在文案里抄第二份**，
  // 否则内容包一改，这一页说的就是三个月前的规则
  "primer.win.h": "怎么算赢",
  "primer.win.lead": "十六季之后按**相对开局的增量**定档，**守成不得分**——守着祖业到底也是丁档。",
  "primer.win.jia": "多控 2 州，或多控 1 州且多据 2 个州治",
  "primer.win.yi": "多控 1 州，或多据 1 个州治",
  "primer.win.bing": "郡数高于开局，且至少一郡是从他方手里夺来的",
  "primer.win.ding": "以上都没做到",
  "primer.win.note": "「控制一州」＝拥有该州过半郡国。所以占十个散郡不如凑齐一个州——侧栏的「逐州进度」逐州写着还差几郡。",

  "primer.ap.h": "一季能做多少事",
  "primer.ap.lead": "每季按疆域给令数，季末最多结转 {carry} 令，多的作废。同一郡每季至多 {per} 令。",
  "primer.ap.campaign": "征伐 / 赴援",
  "primer.ap.normal": "内政 / 集结 / 外交 / 借道",
  "primer.ap.scout": "刺探",
  "primer.ap.scout.v": "**免费**，每季 {n} 次",
  "primer.ap.appoint": "调任",
  "primer.ap.appoint.v": "首次就任**免费**（每季 {n} 次），调动已在任者 **{ap} 令**",
  "primer.ap.unit": "**{n} 令**",

  "primer.siege.h": "攻城看的是缺口，不是兵力比",
  "primer.siege.lead": "兵力比不直接决定胜负。引擎把「我方战力 ÷ 敌方战力」查表折成**缺口数**，再与守方的**可防守数**比——**缺口严格大于可防守才破城**。",
  "primer.siege.hold": "可防守数 ＝ {base} ＋ 城防/{per} ＋ 守军规模档 ＋ 守将加成。所以「修城」不是白做的，而一座空城再多兵也未必守得住。",
  "primer.siege.gear": "器械（冲车、土山）直接加缺口，关隘处减半；武力 ≥ {might} 的主将阵前摧锋，也加缺口。缺口是小整数，加一个就相当于多带三成兵。",
  "primer.siege.floor": "但这些加成**撕不开原本不存在的口子**：兵力比够不着阶梯最低一档时，缺口恒为 0。器械和阵型只放大既有的优势。",
  "primer.siege.rung": "比 {ratio} 起开 {n} 个缺口",

  "primer.form.h": "阵型：一个缺口能翻转将近一半的攻城",
  "primer.form.lead": "阵型是**郡**的属性，不是出兵时才选：**出兵按起兵郡的阵，守城按被攻郡的阵**。三阵循环相克——**鱼鳞克鹤翼、鹤翼克方圆、方圆克鱼鳞**，克制方多 {n} 个缺口，被克方少 {n} 个。",
  "primer.form.why": "为什么是加缺口而不是加战力：破城判据是粗整数阶梯，一个 ±20% 的乘数常常一个缺口都改不了。而实测「缺口 − 可防守」的余量有**43.1% 落在 0 或 1**——±1 个缺口能翻转将近一半的攻城。",
  "primer.form.fog": "敌方阵型与城防同级：**刺探过才看得见**。看不见时预告会把三种可能都算进区间，判词因此变宽——这正是刺探新买到的东西。**改阵**是一条独立的令，引擎只在「当面之敌的阵正克本郡」时把它列进候选，并指明改成哪一阵可反克。",

  "primer.fog.h": "你看到的敌情是有误差的",
  "primer.fog.own": "自家",
  "primer.fog.own.v": "真值",
  "primer.fog.scouted": "已探",
  "primer.fog.scouted.v": "带 ±{pct}% 误差的点估计，有效 {seasons} 季",
  "primer.fog.unseen": "未探",
  "primer.fog.unseen.v": "只知道落在第几档（共 {tiers} 档，每档相差 {ratio} 倍）",
  "primer.fog.ally": "盟友通报",
  "primer.fog.ally.v": "盟友给的也只到「已探」级，不是真值",
  "primer.fog.note": "刺探免费。未探时城防（20–100）与守将加成都不明，判词多半是「未知」——那不是引擎算不出来，是你还没看清。",

  "primer.officer.h": "武将不是装饰",
  "primer.officer.lead": "武将驻在郡里。出征时该郡武将随军，至多 {cap} 人：主将全额加成，副将按 {weight} 折算。",
  "primer.officer.cap": "**出征兵力上限 ＝ 随军武将数 × {per}**。一个没有名将的郡，纵有十万戍兵也只出得动一支偏师——「我的郡国」那张表里「将」这一列是空的，就是这个意思。",
  "primer.officer.captive": "破城时**城内武将尽数被俘**，本局不再出场。名将镇要地是有代价的赌注。",

  "primer.suade.h": "破城之后：招降",
  "primer.suade.captive": "破城时**城内武将尽数被俘**——不只是守将一人。名将镇要地因此是真赌注。",
  "primer.suade.rate": "攻方可在此后 {window} 季内下**招降**令把人招过来，过期不可招。成功率 ＝ {base} − 五维均值 × {per}＋（控其籍贯郡再加 {home}）：寻常之将三成半上下，**五维均值 90 的名将只有半成**。打赢不等于白捡一个关羽。",
  "primer.suade.fail": "招降不成，**其人不屈，永久离场**；无论成败都要花掉这一令。武将定出兵兵力上限（随军人数 × {per}），所以「招人」与「修城」争的是同一季的令。",

  "primer.supply.h": "粮道与盟约",
  "primer.supply.lead": "每季末从治所出发算连通分量。不通的郡**产出归零**，在外的军团**下季溃散**——所以「绕后断粮」是真战术，而治所一失全境断供。",
  "primer.supply.ally": "盟约给的是情报与借道，**不是不可攻**。可以打盟友，但那即是背盟：全境民心 −{morale}，且 {ban} 季内不得再缔盟。盟约到期自动回落中立，不算背盟。",

  "primer.sim.h": "同时裁决",
  "primer.sim.lead": "所有人的令同时结算，顺序不影响结果。你出兵攻城时，别人可能同一季也围了上去——那时打的是野战，不是攻城。候选表能预告的都预告了，但「同一季撞车」谁都预测不到，对双方一样。",
  // 档位名。**中文那份必须逐字等于引擎的 GRADE_CN**（闸在 tests/i18n.test.mjs），
  // 它才是 id；这里是显示名。两者今天相同，意义在于英文那份可以不同
  "grade.ding": "丁",
  "grade.bing": "丙",
  "grade.yi": "乙",
  "grade.jia": "甲",
  "grade.chao": "超",
  "grade.ba": "霸",
  "grade.wang": "王",
};
