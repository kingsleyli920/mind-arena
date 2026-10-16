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
};
