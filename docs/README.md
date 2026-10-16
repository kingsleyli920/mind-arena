[中文](README.md) · [English](README.en.md)

# 文档索引

## 当前有效

| 文档 | 内容 |
| --- | --- |
| `ARCHITECTURE.md` | 技术栈、数据层、地图管线、对局协议、授权边界 |
| `GAMEPLAY-DESIGN-V2-DELTA.md` | **玩法方案的当前版本**。含 MERS v0.1 一页纸规则集（43 条） |
| `PLAN.md` | **开发计划**。现状盘点、里程碑、依赖顺序、验收标准 |
| `EVAL.md` | **评测怎么跑**。四条实测硬约束：48 局下界、bot 基线、降级档位与推理占比、harness 失败与模型失败分开 |
| `RESEARCH-2026-08-31.md` | 地图与美术的调研与决策记录，含三次返工的原因 |
| `I18N-PLAN.md` | **界面双语化的代价账**。为什么给模型看的那一层必须留在中文 |

除 `I18N-PLAN.md`（写给维护者，只有中文）之外，本页与下面三节的每一份
都有英文平行本 `*.en.md`，顶上互挂切换链接。中文是源；中文一改，
`tests/bilingual-drift.test.mjs` 会点名哪几份英文过期。`npm run docs:stamp`
列出待补的，`node tools/doc-stamp.mjs docs/XX.md` 打印译完后该贴的那行戳——
**只打印不代改**：能一键盖戳的话，这道闸就退化成一个红了就按掉的闹钟。
另有 `tests/docs-index.test.mjs` 钉住本页：docs/ 下每一份都要在这里出现。

## 武将数据的推导口径

数值不是拍出来的。这三份记着怎么从史料推到五维，以及哪些约束不许破。

| 文档 | 内容 |
| --- | --- |
| `OFFICER-ANCHORS.md` | **五维锚点体系**。五道锚点阶梯、长尾分布、推导规则、十五条交叉约束 |
| `OFFICER-ANCHORS-FEMALE.md` | 女性人物的锚点梯队与 C15 上限争议（王异那条留在 `proposals.P1`） |
| `OFFICER-RENOWN.md` | 知名度分级：`historicalWeight` 与 `renown` 怎么定，以及它钳制哪些上限 |

## 实测报告（按日期）

每一份都是一次改动的前后对照，**负面结果照记**。结论若被后来的实测推翻，
会在新报告里写明，旧报告保持原始数据不动。

| 文档 | 记的是什么 |
| --- | --- |
| `BALANCE-2026-10-16.md` | **袁绍一家独占：四次改动全部失败，以及失败的原因。** 邻里压力这个量，以及我中途错判地利的那一次 |
| `UNIFICATION-2026-09-28.md` | 统一终局与机器人首轮优化。两组各六个种子跑到 256 季，统一 0/6 |
| `STRATEGY-VALIDATION-2026-09-28.md` | 长期战略验证 |
| `STRATEGY-REVIEW-2026-09-28.md` | 复盘事实与势力差异诊断 |
| `STRATEGY-PLANS-2026-09-28.md` | 战略计划与命令的一致性验收 |
| `STRATEGY-FINISH-2026-09-28.md` | 战略收尾与验收 |
| `PLAYTEST-2026-09-28.md` | 逐势力 AI 与战略长局验收 |
| `PLAN-CONSISTENCY-2026-09-29.md` | 跨季计划状态与实际战果的对账 |

## 模型决策的实测（会真的调模型）

| 文档 | 记的是什么 |
| --- | --- |
| `DECISION-COMPARISON-2026-09-28.md` | 固定局面下 nano / Flash-Lite / mini 共九次决策的对照。**那不是胜率排名** |
| `DECISION-CORRECTION-2026-09-28.md` | 命令收据喂回去之后，模型能不能自己纠错。六次决策花了 $0.01073 |
| `DECISION-GUIDANCE-2026-09-29.md` | 战略决策时间线与命令的对应 |
| `DECISION-REVIEW-2026-09-28.md` | 计划与命令的核对 |
| `BACKUP-ORDERS-2026-09-29.md` | AI 的首选命令被拒后，备选补位接得上接不上 |

## 调研存档（`research/`）

两轮共 9 份横向调研，约 1.1MB。已收敛的结论进了「当前有效」那几份，
这里保留全文备查。

| 文档 | 覆盖 |
| --- | --- |
| `GAMEPLAY-RTK-SERIES.md` | 光荣《三国志》本传 8/9/10/11/13/14 逐代对比 |
| `GAMEPLAY-KOEI-WIDE.md` | 霸王的大陆、英杰传线、战记、大战、Empires、信长之野望 |
| `GAMEPLAY-CN-INDIE.md` | 《创造三国志》正身考、汉末霸业、中华三国志、国产老作品 |
| `GAMEPLAY-OTHER-SANGUO.md` | 群英传、全战三国、率土/战略版、三国杀、开源项目 |
| `GAMEPLAY-SLG-MOBILE.md` | 率土like 赛道的赛季制与防退化机制 |
| `GAMEPLAY-WESTERN-ANALOG.md` | Oriental Empires、Paradox、Total War、多人不对称桌游 |
| `GAMEPLAY-MINIMALISM.md` | 极简规则如何产生深策略；O(10²) 动作集下的八条手法 |
| `GAMEPLAY-MOD-ECOSYSTEM.md` | MOD 生态反映的原作痛点；**已有的 LLM 三国项目先例** |
| `GAMEPLAY-AI-FRIENDLY.md` | 大战略中适合 AI 代理的机制，12 条原则 |
| `OFFICER-STATS-DESIGN.md` | 武将属性的可复现推导方法论 |
| `OFFICERS-AUDIT.md` | 578 武将数据的史实校验报告 |
| `PIXI-RENDERING.md` | PixiJS v8 用法查证 |
| `THREE_KINGDOMS_RESEARCH.md` | 最早的历史与玩法基线（部分已被后续推翻） |

### 已作废

| 文档 | 为何作废 |
| --- | --- |
| `GAMEPLAY-DESIGN-v1-superseded.md` | 首轮方案。对抗审查判定 7 条致命问题，V2-DELTA 已重写 |
| `GAMEPLAY-REVIEW-v1.md` | 对首轮方案的对抗审查。结论已并入 V2-DELTA，保留以备追溯 |
