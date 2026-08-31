# 适合 AI 代理决策的大战略机制调研

调研日期：2026-08-31
范围：商业大战略/4X 游戏机制拆解 + 学界多智能体战略基准评测方法
目的：为 mind-arena（多个 LLM 各执一方同场对局的竞技场）确定玩法设计原则

> **读这份文档的正确姿势**：第 1–7 节是证据，第 8 节是结论。
> 如果只想拿走可执行的东西，直接跳到 **§8 十二条设计原则**，每条都标了来源和落地做法。

---

## 0. 来源分级说明

本文引用的东西分四类，混淆它们会导致设计错误：

| 标记 | 含义 | 示例 |
| --- | --- | --- |
| **【史实】** | 有传世文献或考古依据 | 《后汉书·郡国志》的郡国户口；虎牢关东汉时称成皋关 |
| **【演义】** | 《三国演义》等小说创作 | 汜水关与虎牢关分作两处；单挑定胜负；借东风 |
| **【游戏原创】** | 某作品的设计发明，不是史料 | 光荣的武将五维数值；EU4 的"侵略性扩张"点数；HOI4 的"计划加成 30% 上限" |
| **【学术】** | 论文/基准的实测结论 | SPIN-Bench 关于动作空间与准确率相关性的发现 |

**可借鉴的是【游戏原创】里的*机制思路*，不可复制的是它们的*具体数值表与美术表达*。**
本文提到的所有百分比、上限值（如 HOI4 的 2%/天、30% 上限）都是拿来说明"这类机制长什么样"，
不是建议照抄。三国题材本身不受版权保护，光荣/CA 的具体数值平衡表和美术受保护。

---

## 1. 问题一：哪些机制天然适合"周期性提交高层决策"的代理

### 1.1 判据

一个机制适合 LLM 代理，当且仅当它同时满足：

1. **一次决策覆盖多个时间单位**——下完命令后世界能自己跑一段
2. **动作可枚举**——合法选项是有限集合，不是连续空间
3. **决策与执行分离**——模型给意图，引擎给执行
4. **反馈周期 > 1 回合**——决策的好坏不在下一秒揭晓，需要预判

### 1.2 逐个机制拆解

#### A. Diplomacy 的 WEGO（同时密封下令 + 确定性裁决）— 最强参照

《Diplomacy》（Calhamer, 1959）：7 个大国、34 个补给中心、占 18 个即单独获胜，
可全体同意和局。**全程无骰子、无卡牌**，命令秘密提交、同时揭示、按规则确定性裁决
（[Wikibooks Diplomacy/Rules](https://en.wikibooks.org/wiki/Diplomacy/Rules)、
[playdiplomacy 规则](https://www.playdiplomacy.com/help.php?sub_page=Game_Rules)）。

为什么这是 LLM 竞技场的黄金结构：

- **没有先后手偏置**。IGOUGO（轮流行动）里，座次本身是优势，基准评测必须做座位轮换去偏。
  WEGO 从机制上消掉了这一项噪声。
- **天然并行**。N 个模型可以同时调用，一轮墙钟时间 = 最慢的那个模型，不是 N 倍。
- **动作集极小**。每个单位只有 Hold / Move / Support / Convoy 四类，目标限于邻接省份。
- **抗"看见别人出招再反应"**。围殴需要协调，而协调只能靠谈判——这恰恰是要测的能力。

社群对 WEGO 有一条重要判断：
> WEGO 在**抽象层级高、命令偏概括**时体验最好；在需要给具体个体下具体动作的细粒度游戏里
> 反而令人沮丧（[rpgcodex WEGO vs IGOUGO 讨论](https://rpgcodex.net/forums/threads/turn-based-debate-wego-vs-igougo.151914/)）。

这条对本项目直接适用：**WEGO + 高抽象命令 = 对味；WEGO + 逐城逐将微操 = 灾难。**

#### B. HOI4 的作战计划（意图 → AI 执行）【游戏原创】

《Hearts of Iron IV》的 Battle Plan 系统：玩家在地图上画**战线（Front Line）**、
**攻势线（Offensive Line）**、**箭头突击（Spearhead）**、**回退线（Fallback Line）**、
**区域防御（Area Defense）**、**登陆（Naval Invasion）**、**空降（Paradrop）**，
然后按执行键，AI 接管师级调度（[HOI4 Wiki: Battle plan](https://hoi4.paradoxwikis.com/Battle_plan)）。

机制要点（数值仅作示意，**不要照抄**）：
- 部队静止且已分配到攻势计划时，计划加成每天累积约 2%，上限约 30%
- 每 1% 计划加成给约 1% 攻击与突破
- 计划由 AI 执行时衰减慢，玩家手动插手则衰减快——**从规则上惩罚微操**
- 部队推进到中间目标后**自动暂停**，等玩家重新激活下一阶段

**这是"高层意图 + 自动执行 + 阶段性中断"的教科书实现**，几乎可以整套搬到 LLM 场景：
模型画一条战略意图，引擎跑若干回合，撞到预设中断条件才回来问模型。

需要诚实说明的是：HOI4 社群对该系统的实际效果评价两极。常见做法是
"步兵交给计划、装甲手动微操"，因为 AI 不会读战线找弱点
（[Paradox 论坛讨论](https://forum.paradoxplaza.com/forum/threads/battle-plans-versus-micromanagement.1502272/)）。
**教训：如果手动微操能显著跑赢计划执行，玩家（和模型）就会去微操。**
对本项目而言，必须把手动微操这条路**直接删掉**，而不是靠惩罚来劝退。

#### C. Total War 的两层结构与自动战斗【游戏原创】

Total War 系列把游戏切成两个完全独立的层：战役地图（回合制大战略）与实时战术战斗。
玩家可以选择亲自打，也可以**自动结算**
（[Total War Wiki: Battle](https://totalwar.fandom.com/wiki/Battle_(Total_War:_Three_Kingdoms))）。

对本项目的启示是"反面 + 正面"各一半：
- **正面**：两层分离是对的，战略层的决策粒度可以完全独立于战斗层。
- **反面**：只要"亲自打"能赢更多，两层就不等价，自动结算就变成了次优选项。
  **LLM 竞技场只应该有自动结算这一层**，且它必须是**确定性**的（见 §5）。

#### D. Stellaris 的星区 / EU4 的属国：委托层【游戏原创】

把领土交给 AI 总督/属国管理，玩家只设方针。这是原生的"我不想管这 80 个郡"的解法。
本项目 105 个郡国的规模下，**没有委托层是不可能玩的**——见 §8 原则 2 与原则 5。

#### E. CK3 的阴谋（Scheme）：一次决策，长周期累积【游戏原创】

CK3 的谋杀、拉拢、伪造把柄等阴谋：发起时做一次决策（选目标、选帮手），
之后按月累积成功率，成功/暴露/失败是随时间揭晓的
（[CK3 Intrigue 指南](https://ckstrategyhub.com/strategy/intrigue-guide/)）。
把柄（Hook）分弱/强，强把柄可反复使用，能强推封臣契约变更而不吃暴政惩罚。

**结构极其适合代理**：一次高层决策 → 多回合自动推进 → 到点给结果。
而且"把柄"是一种**可序列化的社交筹码**：它是状态里的一个布尔/枚举字段，
不是模糊的人情。本项目的"人质、婚姻、举孝廉、印绶、把柄"都能这样建模。

#### F. Civ VI 的政策卡与 Eureka：离散槽位选择【游戏原创】

政策卡按军事/经济/外交/通配分槽位插拔；科技/市政有"尤里卡/鼓舞"触发条件，
达成给约 40% 的进度折扣（[Civ6 Wiki: Inspiration](https://civilization.fandom.com/wiki/Inspiration_(Civ6))）。

对代理友好的点：
- **槽位是天然的可枚举动作集**（k 个槽 × m 张卡，组合但可约束）
- **尤里卡是"预告的奖励"**——它把长期规划变成可被模型看见的近期目标，
  这正是 SAGA 论文里"时间有界、可度量的子目标"要解决的问题（§7.3）

### 1.3 汇总表

| 机制 | 出处（哪一代/哪个系统） | 一次决策覆盖 | 动作集规模 | 适配度 |
| --- | --- | --- | --- | --- |
| 同时密封下令 + 确定性裁决 | Diplomacy board game | 1 回合，全部单位 | 每单位 ~4 类 × 邻接数 | ★★★★★ |
| 战线/攻势线委托执行 | HOI4 Battle Plan | 多回合直到中断 | 7 类计划 × 目标区域 | ★★★★★ |
| 自动战斗结算 | Total War 全系列 | 单次会战 | 打/不打 | ★★★★☆ |
| 星区/属国委托 | Stellaris Sectors / EU4 Subjects | 长期 | 方针枚举 | ★★★★☆ |
| 阴谋（长周期累积） | CK3 Schemes/Hooks | 数回合到数十回合 | 阴谋类型 × 目标 | ★★★★☆ |
| 政策槽位 | Civ VI Policy Cards | 到下次换政体 | 槽位 × 可用卡 | ★★★★☆ |
| 侵略性扩张与联盟 | EU4 AE/Coalition | 持续衰减 | 无直接动作（是约束） | ★★★★☆ |
| 战役目标树 | HOI4 National Focus | 约 70 天/项 | 树上可选节点 | ★★★☆☆ |

---

## 2. 问题二：哪些机制会逼出微操，不适合 LLM

### 2.1 微操检测判据

一个机制会逼出微操，如果满足下列任一条：

1. **动作频率与胜率强相关**——手快就是赢，AlphaStar 之所以要限 APM 正因为此
2. **同一决策需要在同一回合内重复几十次**——80 座城的生产队列
3. **最优解依赖连续量的精确调节**——把税率从 37% 调到 38%
4. **执行质量 > 决策质量**——同样的战略意图，操作好坏能决定胜负

### 2.2 具体反例

#### A. RTS 单位控制（StarCraft II）

DeepMind 为了让 AlphaStar 公平，必须给它加两道枷锁
（[AlphaStar Nature 版博客](https://deepmind.google/blog/alphastar-grandmaster-level-in-starcraft-ii-using-multi-agent-reinforcement-learning/)）：

- **相机接口**：只能看屏幕内信息，动作目标限于可视区
- **动作率上限**：每 5 秒最多 22 次 agent 动作（一次 agent 动作 = 选择+技能+目标，
  在游戏内 APM 计数器上最多算 3 次）

早期版本没有相机限制、动作率更宽松，被批评为"赢在手速不是赢在策略"
（[Alex Irpan 的复盘](https://www.alexirpan.com/2019/02/22/alphastar.html)）。

**结论：任何需要给 agent 加 APM 上限才能公平的机制，都不该出现在 LLM 竞技场里。**
判断方法很简单——如果你需要限制"每回合最多提交多少条命令"来保证公平，
说明这个机制本身在奖励操作量而不是奖励推理。

#### B. Civ 系的单位逐格移动

CivRealm【学术】把 Freeciv 的动作空间拆成五类：单位、城市、政体、科技、外交。
其中单位动作占绝对大头——**52 种可控单位类型**，很多单位动作还要在地图上指定目标
（[CivRealm 论文](https://arxiv.org/html/2401.10568v1)）。
为了让 LLM 能处理，他们的 BaseLang 基线不得不把观测压缩成**以单位为中心的 5×5 视野**，
Mastaba 则用**金字塔视图把 15×15 区域压成 9 块**。

即便如此，论文估计整局的状态空间从 10^15 涨到 10^650，动作空间从 10^4 涨到 10^166。
**这是"把不适合的机制硬塞给 LLM"的成本。**

#### C. 城市/内政的逐项管理

Civ 的生产队列、EU4 的建筑队列、HOI4 的生产线，本质是**同一决策重复 N 次**。
N 小的时候有趣，N 大的时候是税。本项目 105 个郡国，N = 105，直接出局。

#### D. Total War 的实时战斗层

见 §1.2C。不是"能不能"的问题，是"不该有"的问题。

#### E. 需要精确数值调节的滑条

EU4 的税率/军事分配、HOI4 的贸易与装备转产。
连续量对 LLM 是双重问题：既不可枚举，模型的算术又不可靠。
**要么改成离散档位（低/中/高），要么直接删掉。**

### 2.3 结论：一条硬规则

> **凡是"同一类决策在一个回合内需要做超过 5 次"的机制，
> 必须要么合并成一条策略性命令，要么交给确定性引擎自动处理。**

---

## 3. 问题三：不完全信息如何设计才能既有博弈深度又可序列化

### 3.1 关键区分：三种"雾"

多数游戏把"不完全信息"等同于"地图黑区"，这是最不适合序列化的一种。
应当区分：

| 类型 | 定义 | 序列化难度 | 博弈深度 | 代表作 |
| --- | --- | --- | --- | --- |
| **棋盘雾**（state fog） | 看不到对方的位置/兵力 | 高（要维护每方独立视图） | 中 | Civ、RTS |
| **意图雾**（intent fog） | 棋盘全公开，但不知道对方这回合下什么命令、许诺是否算数 | **极低**（无需额外状态） | **极高** | Diplomacy |
| **结果雾**（outcome fog） | 知道所有信息，但结算随机 | 低 | **负**（见 §5） | Risk |

**Diplomacy 的设计是这条轴上的最优点**：棋盘对所有人完全公开，
不完全信息全部集中在"这一回合别人写了什么命令"和"私聊里的承诺是真是假"上。
所以它的状态序列化非常廉价——一张公开棋盘 + 每方自己的私聊记录。

Hanabi【学术】走的是另一个极端但同样成功：信息严重不对称（看不见自己的牌），
但**整个状态极小**（一副 50 张牌），推理负担全在"别人为什么给我这个提示"上
（[The Hanabi Challenge, Bard et al., 2019](https://arxiv.org/abs/1902.00506v1)）。
论文明确说，Hanabi 把"对他人信念与意图的推理"推到了前台，这是围棋和扑克不涉及的维度。

**共同规律：状态小 + 信念空间大 = 对 LLM 最友好的不完全信息。**
反过来，状态大 + 信念空间小（例如巨大的地图黑区）纯粹是记账负担。

### 3.2 棋盘雾如果一定要有，怎么做才可序列化

如果本项目还是要保留侦察/情报的乐趣（三国题材里"细作"是重要元素），
推荐用**时效 + 精度分级**代替"能见/不能见"的布尔黑区：

```jsonc
// 给某一方的郡国观测（示意）
{
  "id": "南阳郡",
  "owner": "刘表",              // 归属：公开，永远准确
  "troops": { "band": "2万-4万", "asOf": "195年春", "staleness": 3 },
  //          ↑ 区间不是精确值      ↑ 情报时间戳     ↑ 过时了几个回合
  "granary": { "band": "充足", "asOf": "194年冬", "staleness": 5 },
  "intent": null                // 意图永远不可观测，只能靠谈判与推断
}
```

这样做的好处：
- **可序列化**：每方的观测就是同一张表的不同投影，不需要维护平行世界
- **可复盘**：能精确算出"某方在做决策时相信什么"，这是评测"信息不完全下决策质量"的前提
- **可判定**：能算出"谁的猜测更接近真相"，变成一个独立的能力指标
- **token 友好**：区间 + 时间戳比精确数值更短，且强制模型做区间推理

### 3.3 状态压缩的两个已验证做法【学术】

**做法一：金字塔式空间压缩**（CivRealm / Mastaba）
把 15×15 的格子区域压成 9 个方向块，只保留聚合信息。

**做法二：语义场景图代替坐标**（SAGA, 2026）
[SAGA 论文](https://arxiv.org/html/2606.29932v1) 识别出 LLM 长程规划的五种失败模式，
第一种就叫 **Scene Blindness**——"原始瓦片坐标缺乏关系语义，agent 在空间上迷失方向"。
他们的解法是每回合构建带类型的关系边图，用自然语言描述每个单位的邻域，
**距离离散成三档，方位显式给出**，且只发给相关的控制器。

消融实验数字很说明问题：去掉场景图，最终得分掉 25%；去掉工具化查询掉 49%；
去掉内层反馈循环掉 26%。

**对本项目**：现有 `commanderies.json`（105 郡国带经纬度）和 `terrain-grid.json`
（330×270 网格）**绝不能直接喂给模型**。要预计算成关系图：
郡国邻接、经由哪个战略节点（`strategic-nodes.json` 里的 61 个关隘/渡口/仓城）、
三档距离、方位、地形类别。坐标留给渲染层，模型只看关系。

---

## 4. 问题四：多方博弈中如何避免"围殴领先者"导致的退化

### 4.1 先把问题说准：两种不同的东西

- **策略性联合**：多方为了不输而联合压制领先者。**这是正确的博弈，不该消除。**
  桌游设计界把它叫"社会性平衡"，是最有效的追赶机制之一
  （[BGG: 富者愈富问题解法合集](https://boardgamegeek.com/geeklist/204332/a-compendium-of-solutions-to-the-rich-gets-richer)）。
- **结构性退化**：只要一方数值领先就被无条件围殴，导致最优策略变成"永远做第二名"，
  或者末位玩家成为 kingmaker 决定谁赢。**这是要消除的。**

对一个 **LLM 基准** 来说这个区分尤其重要：如果围殴是无成本的、自动触发的，
那么"识别领先者"这个几乎零难度的任务就主导了结果，
基准测的是"会不会数数"而不是"会不会谋略"。

### 4.2 已验证的四类解法

#### 解法一：绝对胜利阈值，而非相对排名

Diplomacy 的解法：18/34 补给中心（约 53%）单独获胜，且**允许全体同意和局**。
这意味着：
- 领先者不是靠"比第二名多"获胜，而是靠"越过绝对线"
- 被围殴到过不了线时，结局是**和局而非输**——所以领先者有动机接受和局，
  围殴方也有动机在拿下和局后停手
- **没有 kingmaker**：末位玩家没法"把胜利送给某人"，只能影响"有没有人达成 solo"

代价要如实说明：Diplomacy 的实际现象就是"17 中心的人会被全场按住"，
高水平局里和局率很高。这不是 bug，是这套阈值设计的已知均衡。

#### 解法二：结盟必须付出可见成本，且成本随时间衰减

EU4 的侵略性扩张（AE）/联盟系统【游戏原创】：吞并领土积累 AE，
AE 高到一定程度周边国触发联盟围攻；AE 会随时间自然衰减；
在远离本土、异教异文化地区扩张产生的 AE 更低；
用附庸代替直接吞并产生的 AE 更低
（[EU4 社群讨论](https://steamcommunity.com/app/236850/discussions/0/2741975115079174399/)）。

三条可迁移的思路：
1. **围殴有窗口期**：AE 会衰减，忍一忍围攻就散了 → 领先者有"降温"这个战略选项
2. **扩张方式影响仇恨**：吞并 vs 附庸 vs 结盟 → 给模型提供"低仇恨扩张"的推理空间
3. **地理与文化折扣**：远处/异质的扩张更安全 → 不是所有领先都同等招恨

在三国语境下，AE 的对应物是现成的：**"名分"与"人望"**。
奉天子讨不臣的兼并【史实上曹操的政治操作】仇恨低，
擅杀朝廷命官、屠城的仇恨高。这一层是史料支持的，不是硬造的机制。

#### 解法三：非对称/部分隐藏的胜利条件

Root、COIN 系列等游戏给每方**互斥的胜利路径**和**独有的计分规则**
（[Meeples Corner: 非对称桌游](https://meeplescorner.net/blogs/boardgame-glossary/what-is-an-asymmetric-board-game)）。
Ankh-Morpork、Argent 等则给**秘密胜利条件**，别人必须靠推断来阻止你
（[BGDF: 非对称胜利条件讨论](https://www.bgdf.com/forum/game-creation/new-game-ideas/asymmetric-win-conditions)）。

效果：**"谁在领先"本身变成一个需要推理的问题**。
对 LLM 竞技场，这直接把"围殴"从零成本操作变成了一项需要情报和推断能力的操作——
正是我们想测的东西。

**具体做法建议**：每方开局抽 2–3 个**私有战略目标**（如"据有河北四州"、
"三年内不失一郡"、"迎奉天子"、"与两家结盟且皆未背盟"），
公开分数只反映领土与人口，私有目标占总分的一部分。
公开榜单存在但不完整——足够让模型有目标感，又不足以精确锁定第一名。

#### 解法四：让"围殴"本身变成可量化的指标而非噪声

DSGBench【学术】给 Diplomacy 定义了一组过程指标：
**联盟一致性系数（CCC）、双边互动率（BIR）、联盟稳定率（ASR）、联盟持续时长（AD）、
胜利强度（WS）**（[DSGBench 论文](https://arxiv.org/html/2503.06047v2)）。

这意味着围殴不必被"消除"，而应被**测量**：
一个模型能否组织起有效的反霸联盟、能否维持它、能否在联盟里不被出卖，
本身就是要评的能力。

### 4.3 反面警示：SPIN-Bench 的发现【学术】

[SPIN-Bench](https://arxiv.org/html/2503.12349v2) 有一个反直觉的结论：
**引入谈判后，o1 的各类命令表现反而下降**，补给中心增长显著变差。
论文把它归因于"延展推理链与实时结盟的认知开销之间的张力"。
Hanabi 部分也显示玩家数增加时性能下降（o1 从 2 人局 16.4 分掉到 5 人局 14.2 分），
且没有模型达到人类分布的第一四分位。

**对本项目的含义**：势力数量不是越多越好。
3 方以上确实带来多边博弈，但每多一方，模型的推理负担超线性增长。
**建议 5–7 方由模型控制，其余势力由确定性规则驱动**（见 §8 原则 12）。

---

## 5. 问题五：让推理质量而非运气主导结果

### 5.1 核心工具：输入随机 vs 输出随机

游戏设计界的标准区分（Geoff Engelstein / Mark Brown 等）：

- **输入随机（input randomness）**：随机发生在玩家决策**之前**，玩家看到结果再决策。
  例：Civ 的地图生成、Puerto Rico 的明置板块、开局手牌。
- **输出随机（output randomness）**：随机注入在决策**之后**，介于决策与结果之间。
  例：Risk 的掷骰战斗、Memoir '44 的战斗骰。

主流判断：**输入随机支持策略，输出随机破坏策略规划**
（[Board Game Design Course: 两种随机性](https://boardgamedesigncourse.com/the-2-types-of-randomness/)、
[Game Developer: Randomness and Game Design](https://www.gamedeveloper.com/design/randomness-and-game-design)）。

Richard Garfield 的补充值得记住：他认为"运气 vs 技巧"的二分是误导的，
**技巧的回报取决于游戏里有多少运气，但一个主要由运气决定的游戏仍可包含巨量技巧**
（[Board Game Design Lab 访谈](https://boardgamedesignlab.com/luck-vs-skill-with-richard-garfield/)）。
关键不是"消灭运气"，而是**让运气不掩盖单局内的技巧差**。

### 5.2 随机性该放在哪 / 不该放在哪

| 位置 | 放不放 | 理由 |
| --- | --- | --- |
| 开局势力分配（谁执哪一方） | **放**（且要轮换） | 输入随机；同时是去座位偏置的必要手段 |
| 每回合的天时/灾异事件（先公布再决策） | **放** | 输入随机；制造"同一局面不同应对"的可比较场景 |
| 情报的时效与精度（见 §3.2） | **放** | 输入随机；制造信息不完全的深度 |
| 人才出仕/招揽是否成功 | **有条件放** | 若在决策前先公布可招揽名单则是输入随机；若"投了才知道"则是输出随机 |
| **战斗结算** | **不放** | 输出随机的最典型形态；直接掩盖战略判断 |
| **命令是否执行成功** | **不放** | 会让"我的推理对不对"变成无法复盘的问题 |
| **谈判是否被接受** | **不放** | 应由对方模型决定，不该由骰子决定 |

Diplomacy 全程无随机，仍然是深度极高的多方博弈——这证明**战略游戏并不需要输出随机**。

### 5.3 如果战斗必须有不确定性，怎么给

不确定性可以来自**信息不完全**而非骰子：

- 攻方不知道守方的确切兵力（只有区间与时效，见 §3.2）
- 攻方不知道守方是否已收到援军（那是守方上回合的命令）
- 结算公式本身**完全确定且公开**，把公式写进给模型的规则说明里

这样"打得赢打不赢"的不确定性是**认识论上的**（我不知道），
不是**本体论上的**（骰子说了算）。
前者奖励侦察与推断，后者奖励祈祷。

### 5.4 方差控制：让区分度真的出得来【学术】

即便机制本身无输出随机，单局结果的方差仍然很大。已验证的做法：

| 做法 | 来源 | 说明 |
| --- | --- | --- |
| **席位轮换** | [MINDGAMES](https://arxiv.org/pdf/2605.29512) | agent 在各个位置间轮换以控制位置优势 |
| **TrueSkill 而非 Elo** | MINDGAMES；lmgame-Bench | TrueSkill 支持一局多人，能处理非二元结果 |
| **多轮随机配对取中位数** | lmgame-Bench 类做法 | 多次随机遍历对局表，取最终评分的中位数 |
| **prompt 标准化** | [lmgame-Bench](https://www.emergentmind.com/topics/lmgame-bench) | 模型对细微 prompt 变化高度敏感，不标准化就测不准 |
| **提供 harness（感知/记忆/推理脚手架）** | lmgame-Bench | **没有 harness 时几乎所有模型都聚集在随机水平附近**，加了才拉开差距 |

最后一条尤其重要，值得单独强调：

> lmgame-Bench 的结论是，直接把 RGB 帧喂给模型（哪怕是多模态模型）表现很差，
> 问题出在物体识别与场景解析，不是推理。加上把输入转成符号化文本的**感知模块**、
> 维持跨回合上下文的**记忆脚手架**、以及鼓励先思后动的**推理脚手架**之后，
> o3 / o1 / Gemini-2.5-pro / Claude-3.7 等才与基线拉开有意义的差距。

**对本项目**：mind-arena 的核心工程价值不在于"做一个三国游戏"，
而在于**做一个好的 harness**。游戏规则是次要的，状态如何呈现给模型才是第一位的。

---

## 6. 问题六：现成的多智能体战略基准与可借鉴的评测方法

### 6.1 环境与基准一览

| 基准 | 环境 | 评测方法要点 | 可借鉴 | 不可照搬 |
| --- | --- | --- | --- | --- |
| [**CivRealm**](https://arxiv.org/html/2401.10568v1) (ICLR'24) | Freeciv-web，server-proxy-client 架构 | 16 维统计（人口/经济/生产/科技/军力/领土…）+ 综合分；10 类**小游戏**各 10000 个实例，回合上限 5/10/15 | **小游戏做单项能力探针**；proxy 协议架构 | 全局动作空间（52 种单位）过大 |
| [**SAGA**](https://arxiv.org/html/2606.29932v1) (2026) | CivRealm 之上的 LLM 多智能体框架 | 最终文明分 60.7±14.0 vs 基线 47.8±20.3；消融实验 | 五种失败模式清单；场景图；工具化拉取；K=6 双时标反馈 | 具体 agent 分工 |
| [**DSGBench**](https://arxiv.org/html/2503.06047v2) (2025) | SC2 / Civ / 街霸III / Diplomacy / 狼人杀 / 西洋陆战棋 | 五维能力 + 每游戏专属过程指标 | **过程指标体系**（尤其 Diplomacy 的 CCC/BIR/ASR/AD/WS） | 六游戏拼盘结构 |
| [**SPIN-Bench**](https://arxiv.org/html/2503.12349v2) (2025) | PDDL 规划 + 棋类 + Hanabi + Diplomacy | 1280+ PDDL 任务；N 步前瞻分；对手为求解器 | 关于动作空间/agent 数量/谈判负面影响的定量结论 | — |
| [**lmgame-Bench**](https://www.emergentmind.com/topics/lmgame-bench) | 多款经典游戏 | harness（感知/记忆/推理）+ prompt 标准化 + 污染干预（实体遮蔽、改写、去元数据） | **harness 三件套**；数据污染防护 | — |
| [**MINDGAMES**](https://arxiv.org/pdf/2605.29512) (2026) | Avalon/Codenames/Hanabi/Mafia/Werewolf 直播竞技场 | TrueSkill + 席位轮换 + 多局 | **直播竞技场 + TrueSkill + 席位轮换**，与本项目定位最接近 | 游戏选型（纯社交推理） |
| [**Werewolf Arena**](https://arxiv.org/abs/2407.13943) (Google, 2024) | 狼人杀 8 人（1 预言家/1 医生/2 狼/4 民） | **竞价发言**（模型出价决定谁说话）；锦标赛式 | 竞价发言机制——解决"多方谈判谁先说"的公平问题 | 局规模太小 |
| [**Hanabi Challenge**](https://arxiv.org/abs/1902.00506v1) (2019) | Hanabi 2–5 人 | 自play + ad-hoc teamplay 两条赛道 | **合作型不完全信息 + 极小状态**的设计范式 | 纯合作 |
| [**Melting Pot**](https://github.com/google-deepmind/meltingpot) (DeepMind) | 50+ 多智能体基质，256+ 测试场景 | **focal population 对 background population** 的泛化评测 | **对手泛化**思路：训练时没见过的对手 | MARL 训练范式 |
| [**AI_Diplomacy**](https://github.com/GoodStartLabs/AI_Diplomacy) (Every, 2025) | 全谈判 Diplomacy，LLM 对局直播 | 15 场，单场 1–36 小时 | **完整工程实现**，见 §7.2 | 无正式统计方法 |
| [**Cicero**](https://ai.meta.com/blog/cicero-ai-negotiates-persuades-and-cooperates-with-people/) (Meta, Science 2022) | 全谈判 Diplomacy | webDiplomacy 匿名联赛；得分超人类均值 2 倍，多局玩家中前 10% | **意图条件化对话**；人机文本判别器过滤 | 2.7B 专用模型 + piKL 规划器 |

### 6.2 最该抄的三件事

**1. 过程指标，不只看胜率**（DSGBench）

只有胜率的话，一局 = 一个 bit，统计功效极低。DSGBench 给每个游戏定义了
一整套过程指标。对本项目应至少包含：

- **无效动作率（IAR）/ 落地准确率（GA）**：提交的命令有多少通不过 schema 或规则校验。
  这是最轻量的可靠性信号，也是模型间差距最先显现的地方。
- **守约率 / 背叛率**：AI_Diplomacy 的做法是**比对谈判承诺与实际下达的命令**来自动检测背叛。
- **联盟稳定率、联盟持续时长、双边互动率**
- **情报准确度**：模型在决策时对敌方兵力的估计与真实值的偏差（本项目 §3.2 的设计使这可算）
- **计划兑现度**：模型声明的多回合意图，实际执行了几回合

**2. TrueSkill + 席位轮换 + 多局中位数**（MINDGAMES / lmgame-Bench）

一局多人、非二元结果，Elo 不适用。

**3. 数据污染防护**（lmgame-Bench）

这一条对三国题材是**严重风险**：所有模型都读过《三国演义》和大量三国游戏攻略。
模型可能不是在推理，而是在回忆"曹操该打吕布"。缓解手段：

- 反事实开局（把 194 年的归属打乱后重新分配）
- 势力改名/去名（"甲方据兖州"而非"曹操据兖州"）作为对照组
- 至少跑一组**去三国化的同构地图**，比较分数差 —— 差得多说明测的是记忆不是推理

### 6.3 Cicero 值得单独说的一点：意图条件化对话

Cicero 的关键工程手段是：**用自动标注把训练数据里的每条消息与其对应的计划动作关联起来**，
推理时就可以"给定我打算做 X，生成一条讨论 X 的消息"。

这条思路可以反过来用在**评测**上：
既然消息可以被计划条件化，那么**消息与实际命令的一致性就可以被自动测量**。
本项目应当把"谈判发言"和"提交命令"设计成两个独立通道，
让引擎能自动比对两者，产出守约率指标。

---

## 7. 问题七：局长、决策点数量、单次信息量的业界经验值

### 7.1 各基准的实测数字【学术】

| 环境 | 一局的交互轮次 | 来源 |
| --- | --- | --- |
| 街霸 III | 24 | DSGBench |
| 狼人杀 | 32 | DSGBench |
| **Diplomacy** | **60** | DSGBench |
| Civilization | 141 | DSGBench |
| StarCraft II | 450 | DSGBench |
| 西洋陆战棋（Stratego） | 1270 | DSGBench |
| Civ VI（人类，标准速度） | 500 回合 | [Civ6 Wiki: Speed](https://civilization.fandom.com/wiki/Speed_(Civ6)) |
| Freeciv 全局（CivRealm） | 数小时到数天 | CivRealm |
| AI_Diplomacy 实测 | 单场 1–36 小时墙钟 | Every |

**Diplomacy 的 60 轮是个非常有参考价值的锚点**：多方博弈 + 谈判 + 长程规划，
60 轮足够展开也不至于失控。

### 7.2 单次决策的信息量【学术 + 工程】

来自 [AI_Diplomacy](https://github.com/GoodStartLabs/AI_Diplomacy) 的实际配置：

- `--max_tokens` 默认 **8000**（每次调用的输出上限）
- 给模型的私有日记（diary）只保留**最近 40 条**
- **每 2 游戏年**用一个小模型（Gemini Flash）自动摘要合并，防止上下文溢出
- 每个阶段的谈判轮数可配置，示例是 **0–3 轮**
- 合法命令从引擎给的 possible orders 里选，**不是自由生成**；BFS 寻路辅助生成候选

来自 [SAGA](https://arxiv.org/html/2606.29932v1) 的关键阈值：

- **Context Overflow 失败模式的触发线：整包状态倾倒超过每回合 15,000 token**
- 内层反馈循环周期 **K = 6 回合**：每 6 回合压缩一次行动日志并重设子目标
- 采用工具化拉取（`query_city_metrics` / `query_army_roster` / `query_tech_status`）后，
  输出 token 降 27%（109k vs 149k）

### 7.3 对本项目的推荐值

综合上述，给 mind-arena 的建议区间（**这是推导值，不是实测值，需要上线后用真实对局校准**）：

| 参数 | 建议值 | 依据 |
| --- | --- | --- |
| 一局回合数 | **48–60**（季为回合 → 12–15 年；194 年春起，到 208 年冬正好 60 季） | Diplomacy 60 轮；史料上 194→208 是一个完整的叙事弧 |
| 模型控制的势力数 | **5–7** | Diplomacy 7 家；SPIN-Bench 显示 agent 数增加会拖垮推理 |
| 需要**全量**调用模型的回合 | **每年 1 次 = 12–15 次**，其余回合走持续命令 | 解耦决策频率与调用成本（见 §8 原则 4） |
| 每次决策提交的命令数 | **3–6 条** | §2.3 的"5 次"硬规则 |
| 每次调用的观测预算 | **≤ 6,000 token**（硬上限 8,000） | SAGA 的 15k 溢出线取一半以下作安全边界 |
| 每次调用的输出预算 | **≤ 4,000 token** | AI_Diplomacy 默认 8000 的一半 |
| 谈判轮数 | 每年 **1–2 轮**，每轮每方最多 N-1 条私信 + 1 条公开声明 | AI_Diplomacy 的 0–3 轮 |
| 记忆压缩周期 | **每 3 年**（≈12 回合）压缩一次 | SAGA 的 K=6 放宽到本项目的回合尺度 |
| 单局总调用数（估算） | 5 势力 × 15 年 × (1 决策 + 2 谈判) ≈ **225 次** | — |

按 225 次调用 × 平均 8k in / 3k out 估算，单局约 1.8M input token + 0.7M output token。
这是可以承受的量级，且是本设计相对"每季全量调用"（900 次）省下来的 4 倍。

---

## 8. 结论：为本项目设计玩法时应遵循的十二条原则

> 每条格式：**原则 → 来源 → 理由 → 在 mind-arena 里的具体做法**

### 原则 1 — 回合骨架用 WEGO：同时密封下令，确定性同时裁决

- **来源**：Diplomacy 规则（命令秘密提交、同时揭示、确定性裁决，全程无骰子）
- **理由**：① 消除座次偏置这一整类噪声；② N 个模型可并行调用，墙钟时间不随势力数线性增长；
  ③ "看见别人出招再反应"这条捷径被堵死，围殴必须通过谈判达成——而谈判正是要测的能力
- **做法**：一个回合 = 谈判阶段（若干轮消息）→ 密封下令阶段 → 裁决阶段 → 结果广播。
  裁决器是纯函数 `(state, orders[]) → state'`，无副作用、可重放、可单测。

### 原则 2 — 决策一律停在"意图层"，执行交给确定性求解器；不提供任何微操通道

- **来源**：HOI4 Battle Plan（画战线，AI 执行，玩家插手反而衰减更快）；
  Total War 自动战斗；AlphaStar 必须限 22 动作/5 秒才公平
- **理由**：需要限制动作频率才能保证公平的机制，本质是在奖励操作量而非推理。
  HOI4 的反面教训是：只要手动微操能跑赢委托执行，玩家就一定去微操——
  所以不能靠惩罚劝退，必须**根本不提供这条路**
- **做法**：命令的最小粒度是"军团 → 战略目标"，不是"部队 → 格子"。
  行军路径由引擎按 `strategic-nodes.json` 的关隘/渡口图寻路。
  会战只有自动结算，没有战术层。城池的日常内政由方针驱动，不逐郡下令。

### 原则 3 — 合法动作集必须显式枚举后随观测一起给出，规模控制在 O(10)–O(10²)

- **来源**：SPIN-Bench 发现"准确率与**总状态-动作空间**的相关性强于与平均合法动作数的相关性"；
  AI_Diplomacy 让模型从引擎给出的 possible orders 里选而非自由生成
- **理由**：① 不枚举就无法校验，无法校验就无法公平比较；② 动作空间是区分度的直接杀手，
  CivRealm 的 10^166 动作空间就是反面教材
- **做法**：每次 observe 返回 `legalActions: Action[]`，每个 action 带稳定 id。
  decide 只允许返回 id 列表 + 理由文本。validate 拒绝任何不在集合里的 id，
  并把 **IAR（无效动作率）** 记入评测指标。
  命令类型控制在 8–12 种（如：出兵、屯田、征募、安民、结盟、遣使、离间、招贤、迁治、修城、纳质、请封）。

### 原则 4 — 持续命令 + 中断驱动重决策，把决策频率与调用成本解耦

- **来源**：HOI4 计划推进到中间目标后自动暂停等待重新激活；SAGA 的 K=6 回合子目标刷新
- **理由**：竞技场的成本瓶颈是调用次数。让世界在两次调用之间跑若干回合，
  同时保证"出大事了会回来问"，是唯一能兼顾局长与成本的结构
- **做法**：命令带 `duration`（持续到条件满足或 N 回合）。
  引擎维护一张**中断条件表**：本方城池失守 / 盟友背盟 / 敌军进入本方战略节点 /
  粮草低于阈值 / 重大历史事件触发 / 达成中间目标。
  命中任一条则提前唤醒该方模型；否则按固定周期（建议每年一次）唤醒。
  **中断条件表必须公开写进规则说明**，让模型能预判自己何时会被唤醒。

### 原则 5 — 观测用"拉取式 + 分层摘要"，设硬性 token 预算，绝不整包倾倒状态

- **来源**：SAGA 的 Context Overflow 失败模式（>15k token/回合）；
  其 Tool-Augmented Strategic Pipeline 消融显示去掉工具化查询掉 49%；
  CivRealm/Mastaba 的金字塔视图
- **理由**：105 个郡国 × 完整属性 = 几万 token，模型读都读不完，
  且注意力会被无关信息稀释
- **做法**：三层观测。
  ① **战略摘要层**（默认推送，≤1500 token）：13 州的势力分布、本方总览、
  各方公开实力排名、当前事件、上回合结果。
  ② **战区层**（默认推送本方相邻战区，≤2500 token）：郡国级归属与区间化情报。
  ③ **明细层**（按需拉取）：`queryCommandery(id)`、`queryArmy(id)`、
  `queryRelation(a,b)`、`queryNode(id)`。
  给模型的工具调用配额（如每次决策最多 8 次查询），配额本身也是被测的能力
  （会不会查、查什么、是不是乱查）。

### 原则 6 — 空间信息给关系图，不给坐标；距离分档，方位显式

- **来源**：SAGA 的 Map-Semantic Scene Graph（去掉后得分掉 25%），
  明确批评"原始瓦片坐标缺乏关系语义"
- **理由**：LLM 的空间推理弱，经纬度和 330×270 网格索引对它几乎是噪声。
  而本项目已有的 `strategic-nodes.json`（61 个关隘/道/渡口/港口/仓城/古战场）
  天生就是关系图的边
- **做法**：离线预计算 `adjacency.json`：郡国邻接对 → 经由哪个战略节点、
  地形类别（取自 `terrain-grid.json`）、距离档位（近/中/远三档）、方位（八方位）、
  是否跨河（取自 `hydrology.json`）。
  模型看到的是"南阳 —(经武关道·山道·中距离·西北)→ 京兆尹"，
  而不是 `(112.5, 33.0) → (108.9, 34.3)`。
  **坐标只留给 PixiJS 渲染层。**

### 原则 7 — 随机性只放在决策之前；战斗结算与命令执行必须完全确定

- **来源**：输入随机 vs 输出随机的设计学区分（Engelstein 等）；
  Garfield 关于"技巧回报取决于运气多少"的论述；Diplomacy 全程无骰子仍有极高深度
- **理由**：本项目的第一目标是"更强的推理稳定转化为更好的结果"。
  输出随机是直接对抗这个目标的
- **做法**：
  - **允许**：开局势力分配（且强制轮换）、每回合先公布再决策的天时/灾异、
    情报的时效与精度（§3.2）、可招揽人才名单的刷新
  - **禁止**：战斗掷骰、命令执行失败判定、谈判被随机拒绝、计略随机成功
  - 战斗公式**完全确定且写进规则说明**发给模型。不确定性来自"我不知道对方多少兵"，
    不来自"骰子怎么滚"

### 原则 8 — 不完全信息集中在"意图层"；棋盘雾用时效 + 精度分级表达

- **来源**：Diplomacy（棋盘全公开，信息不对称全在私聊与命令上）；
  Hanabi（状态极小但信念空间极大）
- **理由**：意图雾的序列化成本近乎为零，博弈深度却最高；
  而地图黑区序列化成本高、深度中等，性价比最差。
  时效+精度的表达还带来一个额外好处：**能算出模型决策时相信什么**，
  从而把"信息不完全下的决策质量"变成可测量的指标
- **做法**：
  - 郡国归属、州级势力版图、公开的结盟与宣战：**永远公开且准确**
  - 兵力、粮储、民心：给**区间 + 情报时间戳 + 过时回合数**，不给精确值
  - 本方自己的一切：精确
  - 各方的**当回合命令与私下承诺**：完全不可观测
  - 派遣细作/斥候是一条命令，效果是刷新某郡的情报时间戳并收窄区间

### 原则 9 — 谈判与下令分成两个独立通道，承诺格式化到可被机器校验

- **来源**：Cicero 的意图条件化对话（用计划标注消息，从而能"给定计划生成消息"）；
  AI_Diplomacy 通过比对谈判内容与实际命令来自动检测背叛
- **理由**：如果承诺只存在于自由文本里，外交能力就只能靠人工阅读来评价，无法规模化。
  把承诺结构化之后，守约率/背叛率/联盟稳定率全部可以自动算
- **做法**：消息 = 自由文本 + 可选的**结构化承诺**数组：
  ```jsonc
  { "type": "non_aggression", "target": "sun", "untilTurn": 12 }
  { "type": "joint_attack",   "target": "yuan", "onTurn": 8, "myForce": "≥2万" }
  { "type": "cede",           "commandery": "南阳", "onTurn": 10 }
  ```
  引擎在结算后自动比对承诺与实际命令，产出 **守约率 / 主动背叛次数 / 被背叛次数**。
  自由文本仍然保留（那是说服力的载体），但**评分只认结构化部分**。
  另外借鉴 Werewolf Arena 的**竞价发言**：公开声明阶段用出价决定发言顺序，
  解决多方谈判"谁先说"的公平问题。

### 原则 10 — 胜利条件：绝对阈值 + 多条路径 + 部分隐藏 + 允许和局

- **来源**：Diplomacy 的 18/34 绝对阈值与全体同意和局；
  Root / COIN 系列的非对称互斥胜利条件；Ankh-Morpork / Argent 的秘密胜利条件
- **理由**：① 绝对阈值消除 kingmaker——末位方无法"把胜利送给某人"，只能影响"有没有人达线"；
  ② 允许和局给了领先方"降温"的动机和围殴方"收手"的动机；
  ③ 部分隐藏使"谁在领先"本身成为需要推理的问题，
  把围殴从零成本操作变成需要情报能力的操作
- **做法**：
  - **公开主线**：控制 105 郡国中的 55 个（约 52%，对齐 Diplomacy 的 18/34 ≈ 53%）
    且持有 ≥3 个都级战略节点 → 单独获胜
  - **私有目标**：每方开局抽 2–3 个私有战略目标（据有某州、迎奉天子、
    三年不失一郡、与两家结盟且皆未背盟、控制某几处仓城…），占总分的一部分
  - **公开榜单只显示领土与人口**，不显示私有目标进度
  - **和局**：60 回合结束无人达线，按公开分 + 私有目标分排名，
    第一名记"优势和局"而非"胜利"，评分权重低于单独获胜
  - **可选**：允许存活方在任意时刻发起"共尊天子"的全体和局提案

### 原则 11 — 围殴要有成本、有窗口期、有折扣，并且被当作指标测量而非被消除

- **来源**：EU4 的侵略性扩张（随时间衰减、附庸比吞并更低、远距离/异文化更低）与联盟系统；
  DSGBench 的 CCC / BIR / ASR / AD 指标；BGG 关于"社会性平衡是有效追赶机制"的共识
- **理由**：策略性联合是正确的博弈，不该消除；要消除的是**无成本、自动触发**的结构性退化。
  给围殴加上成本和衰减，就把它从"会数数就行"变成"需要谋略与外交"
- **做法**：
  - 三国语境下 AE 的对应物是**"名分"与"人望"**【史实上曹操"奉天子以令不臣"是真实的政治操作，
    非演义】：奉诏讨伐产生的仇恨低，擅杀朝廷命官、屠城产生的仇恨高
  - 名分损耗**随时间自然衰减**——领先方有"停手降温"这个战略选项
  - 结盟需要付出**真实资源**（质子、粮草、割让、联姻），不是免费点击
  - 联盟有**明确到期回合**，续约要重新谈
  - CCC / ASR / AD / 守约率 全部计入评分维度

### 原则 12 — 评测：过程指标 + 席位轮换 + TrueSkill + 多局中位数 + 污染防护

- **来源**：DSGBench 的多维过程指标；MINDGAMES 的 TrueSkill + 席位轮换；
  lmgame-Bench 的 prompt 标准化与污染干预（实体遮蔽/改写/去元数据），
  以及"无 harness 时所有模型都聚集在随机水平"的结论；
  Melting Pot 的 focal / background population 泛化评测
- **理由**：单看胜率，一局 = 1 bit，统计功效太低；
  且三国题材的**数据污染风险极高**——所有模型都读过演义和攻略，
  可能是在回忆而不是推理
- **做法**：
  - **评分维度**：胜负（TrueSkill）+ IAR/落地准确率 + 守约率/背叛率 +
    联盟稳定率 + 情报准确度（估计值与真实值的偏差）+ 计划兑现度 +
    资源效率 + 单位决策成本（token/回合）
  - **席位轮换**：同一批模型跑 N 局，每局轮换势力分配，保证每个模型在每个势力上都跑过
  - **多局中位数**：多次随机遍历对局表，取评分中位数而非均值
  - **prompt 标准化**：所有模型用完全相同的 system prompt 与观测格式，禁止针对性调优
  - **污染对照组**：至少跑一组**去三国化**的同构对局
    （势力改名为"甲乙丙丁"、地名改为编号、地形与邻接关系不变）。
    有名版与无名版分差过大 → 说明测的是记忆不是推理，这个分差本身就是一个有价值的指标
  - **对手泛化**（借 Melting Pot 思路）：除了模型互打，
    再跑一组"模型 vs 一批固定的规则型 AI"，检验是否只在特定对手风格下有效

---

## 9. 与现有资产的对应关系

| 已有文件 | 在新玩法里的角色 | 需要新增的加工 |
| --- | --- | --- |
| `lib/game/data/commanderies.json`（105 郡国，含户口/属县/坐标） | **资源层**：户口决定征募上限与赋税基数；属县数决定内政容量 | 需要按 13 州聚合出**战略摘要层**；户口需要归一化成区间档位 |
| `lib/game/data/scenario-194.json`（31 势力归属，每条带史料依据） | **开局**。31 势力中选 5–7 家由模型控制 | 其余 24+ 家需要一套**确定性规则驱动**的行为（不调模型）；需要"去三国化"变体用于污染对照 |
| `lib/game/data/strategic-nodes.json`（61 个关隘/道/渡口/港口/仓城/古战场，含 `capturable`） | **行军图的边与关键点**。这是原则 6 的核心资产 | 需要生成郡国 ↔ 节点 ↔ 郡国 的邻接图 |
| `lib/game/data/hydrology.json`（水系，黄河东汉故道） | 邻接边的"跨河"标记；水路行军 | 只需提取跨河判定，**不要把原始折线给模型** |
| `lib/game/data/terrain-grid.json`（330×270 高程/起伏/地形分类） | 邻接边的地形档位与行军成本 | 只需按边采样出地形类别，**绝不整包给模型** |
| `public/game/map/tiles/`、`map-labels.json` | 纯渲染 | 与模型观测完全无关 |
| `lib/game/strategy.ts`（现有 322 行） | **推翻**。4 个动作、每季一命令、20 回合、18 个写死武将、一行公式定城池归属，与上述原则几乎条条冲突 | 重写为 observe/decide/validate/resolve/replay 五段式纯函数管线 |

---

## 10. 不确定与待验证

诚实标注：

1. **§7.3 的推荐值全部是推导值，不是实测值。** 48–60 回合、每年 1 次全量调用、
   6000 token 观测预算，都是从其他基准的数字外推的。上线后必须用真实对局校准。
2. **SPIN-Bench 的具体百分比我只拿到二手摘要**（通过 PDF 摘取），
   o1 的 Hanabi 分数（2 人 16.4 / 5 人 14.2）、PDDL 准确率（58.59% vs GPT-4o 8.75%）
   这些数字建议在引用前回原文核对。
3. **"55/105 郡国"这个阈值是我按 Diplomacy 的 18/34 比例套出来的**，
   没有任何实证支持。105 个郡国的分布远不如 Diplomacy 的 34 个补给中心均匀
   （河南尹 100 万口 vs 边郡数万口），可能需要**按户口加权**而不是按数量计。
   这个必须做仿真验证。
4. **原则 10 的"部分隐藏胜利条件"与本项目"可复盘"的目标有张力**：
   隐藏信息越多，第三方观众越难判断谁下得好。需要设计"赛后全揭示"的复盘视图。
5. **原则 11 的"名分"机制是否真能抑制退化，未经验证。** EU4 的 AE 系统在人类玩家手里
   经常被"提前结盟大国"绕过。LLM 是否会发现同样的绕法，只能实测。
6. **`scenario-194.json` 里 31 势力的强弱差距极大**（李傕挟天子据三辅 vs 士燮保交州一隅）。
   如果直接用作开局，席位轮换也未必能抹平——可能需要一个"平衡开局"变体
   用于评测，"史实开局"变体用于观赏。
7. **谈判是否会像 SPIN-Bench 发现的那样反而拖垮战略表现**，在本项目的规则下是未知的。
   建议第一版就做 A/B：同一批模型，有谈判 vs 无谈判，看分数与方差如何变化。
8. **Every 的 AI Diplomacy 文章我没能拿到工程细节**（原文主要讲模型性格，
   engineering 细节在 GitHub 仓库里）。§7.2 的数字来自仓库 README 的二手摘取，
   建议直接读源码核实。

---

## 参考来源

**学术基准**
- [CivRealm: A Learning and Reasoning Odyssey in Civilization for Decision-Making Agents (ICLR 2024)](https://arxiv.org/html/2401.10568v1)
- [SAGA: Scene-Aware, Goal-Evolving Agents for Long-Horizon CivRealm Strategy Planning (2026)](https://arxiv.org/html/2606.29932v1)
- [DSGBench: A Diverse Strategic Game Benchmark for Evaluating LLM-based Agents (2025)](https://arxiv.org/html/2503.06047v2)
- [SPIN-Bench: How Well Do LLMs Plan Strategically and Reason Socially? (2025)](https://arxiv.org/html/2503.12349v2)
- [MINDGAMES: A Live Arena for Evaluating Social and Strategic Reasoning in Multi-Agent LLMs (2026)](https://arxiv.org/pdf/2605.29512)
- [lmgame-Bench: LLM Evaluation in Games](https://www.emergentmind.com/topics/lmgame-bench)
- [Werewolf Arena: A Case Study in LLM Evaluation via Social Deduction (Google, 2024)](https://arxiv.org/abs/2407.13943)
- [The Hanabi Challenge: A New Frontier for AI Research (Bard et al., 2019)](https://arxiv.org/abs/1902.00506v1)
- [Melting Pot: an evaluation suite for multi-agent reinforcement learning (DeepMind)](https://github.com/google-deepmind/meltingpot)
- [Democratizing Diplomacy: A Harness for Evaluating Any LLM on Full-Press Diplomacy (2025)](https://arxiv.org/pdf/2508.07485)
- [GameBench: Evaluating Strategic Reasoning Abilities of LLM Agents (2024)](https://arxiv.org/html/2406.06613v1)

**AI 系统**
- [CICERO: An AI agent that negotiates, persuades, and cooperates with people (Meta AI, 2022)](https://ai.meta.com/blog/cicero-ai-negotiates-persuades-and-cooperates-with-people/)
- [Human-level play in the game of Diplomacy (Science, 2022)](https://www.science.org/doi/10.1126/science.ade9097)
- [AlphaStar: Grandmaster level in StarCraft II (DeepMind)](https://deepmind.google/blog/alphastar-grandmaster-level-in-starcraft-ii-using-multi-agent-reinforcement-learning/)
- [An Overdue Post on AlphaStar（对 APM/相机接口的批评）](https://www.alexirpan.com/2019/02/22/alphastar.html)
- [AI Diplomacy 开源实现（GoodStartLabs / Every）](https://github.com/GoodStartLabs/AI_Diplomacy)
- [We Made Top AI Models Compete in a Game of Diplomacy (Every, 2025)](https://every.to/p/diplomacy)

**游戏机制**
- [Diplomacy 规则（Wikibooks）](https://en.wikibooks.org/wiki/Diplomacy/Rules) /
  [playdiplomacy 规则](https://www.playdiplomacy.com/help.php?sub_page=Game_Rules)
- [Hearts of Iron 4 Wiki: Battle plan](https://hoi4.paradoxwikis.com/Battle_plan)
- [Paradox 论坛：Battle Plans versus Micromanagement](https://forum.paradoxplaza.com/forum/threads/battle-plans-versus-micromanagement.1502272/)
- [Total War Wiki: Battle（自动结算）](https://totalwar.fandom.com/wiki/Battle_(Total_War:_Three_Kingdoms))
- [EU4 社群：如何管理侵略性扩张](https://steamcommunity.com/app/236850/discussions/0/2741975115079174399/)
- [CK3 Intrigue 指南（Schemes / Hooks / Secrets）](https://ckstrategyhub.com/strategy/intrigue-guide/)
- [Civ6 Wiki: Inspiration](https://civilization.fandom.com/wiki/Inspiration_(Civ6)) /
  [Civ6 Wiki: Speed](https://civilization.fandom.com/wiki/Speed_(Civ6))
- [rpgcodex: Turn Based Debate — WEGO vs IGOUGO](https://rpgcodex.net/forums/threads/turn-based-debate-wego-vs-igougo.151914/)

**设计理论**
- [Game Developer: Randomness and Game Design](https://www.gamedeveloper.com/design/randomness-and-game-design)
- [Board Game Design Course: 输入随机与输出随机](https://boardgamedesigncourse.com/the-2-types-of-randomness/)
- [Board Game Design Lab: Luck vs Skill with Richard Garfield](https://boardgamedesignlab.com/luck-vs-skill-with-richard-garfield/)
- [BGG: 富者愈富 / 领跑者失控问题的解法合集](https://boardgamegeek.com/geeklist/204332/a-compendium-of-solutions-to-the-rich-gets-richer)
- [Games Precipice: Late Game Structures — Objectives & Victory Conditions](https://www.gamesprecipice.com/objectives/)
- [BGDF: 非对称胜利条件](https://www.bgdf.com/forum/game-creation/new-game-ideas/asymmetric-win-conditions)
