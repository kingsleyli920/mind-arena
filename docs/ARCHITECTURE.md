# Mind Arena 架构

Mind Arena 是一个网页三国战略游戏，同时用作比较不同大语言模型的竞技场。
游戏本身要成立——策略深度、历史质感、可玩性；模型对战是它的用法，不是它的替代品。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 应用 | React 19 + vinext（Vite 上的 Next.js） | 部署到 Cloudflare Workers |
| 地图渲染 | PixiJS v8 + 多级瓦片 | 底图离线渲染成瓦片，标注为实时 UI 层 |
| 引擎 | TypeScript 纯函数 | observe / listActions / validate / resolve / replay 五段式 |
| 内容 | JSON 内容包 | 规则即数据，见下 |
| 数据构建 | Node + sharp 脚本 | `tools/`，全部可重复运行 |

**已作废的决策**：早期文档写「Godot 4.7 为主要游玩表面，不得用 DOM/SVG 渲染战役地图」。
实际选型是 React + PixiJS，理由见 `RESEARCH-2026-08-31.md` 第七节。

## 规则即数据

游戏内容——动作、数值常数、地形、兵种、适性、胜负判据——全部写在
`lib/game/content/*.json`，引擎只按数据执行。

这不只是可配置性。**同一份定义既驱动引擎，又通过 `toRulesDigest()` 生成
模型提示词里的规则说明。** 若规则硬编码在 TS 中，就必须另写一份给模型看的
文档，两份随迭代必然漂移——模型算出来的和引擎结算的对不上，评测即失效。

`lib/game/content/schema.ts` 提供类型契约、校验器与摘要生成。
校验器拦截的是设计错误而非恶意输入：动作无代价（会被无限刷）、
档位超过 4 个（模型难权衡）、说明过短（模型不知何时该用）、兵种相克引用不存在的兵种。

## 数据层

`lib/game/data/`，全部为 JSON，全部可由 `tools/` 下的脚本重新生成：

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `commanderies.json` | 105 郡国：郡治、户口、属县、坐标、可信度 | 《后汉书·郡国志》原文解析 |
| `officers.json` | 578 名武将：字、籍贯、生卒、194 年归属、史料出处 | 《三国志》《后汉书》列传 |
| `scenario-194.json` | 31 势力对 105 郡国的归属，每条带史料依据 | 史料考订 |
| `strategic-nodes.json` | 61 个关隘、道、渡口、港口、仓城、古战场 | 史料考订 |
| `hydrology.json` | 水系，黄河为东汉故道（王景治河后） | Natural Earth + 历史河道复原 |
| `terrain-grid.json` | 330×270 网格的高程、起伏、地形分类 | AWS Terrain Tiles |
| `junguozhi-raw.json` | 《郡国志》原文 1013 段 | ctext.org，公有领域 |

## 地图管线

```
tools/fetch-dem.mjs        AWS 高程瓦片 → refs/dem-raster.raw（不入库，可重下）
tools/fetch-refs.mjs       公有领域山水画 → refs/（不入库）
tools/extract-cun.mjs      从山水画提取皴法墨迹 → public/game/ink/
tools/render-terrain-map.mjs  晕渲 + 设色 + 皴法 + 势力疆域 + 水系 → 底图 PNG
                              另导出 public/game/data/map-labels.json（标注数据）
tools/slice-map-tiles.mjs  底图 → 512px webp 四级瓦片
```

底图 7260×5940，瓦片 244 张共 11MB。**标注不烤进底图**——烤进去就在所有缩放级别
固定大小固定密度，洛阳周边八个关津必然重叠。标注是 PixiJS 屏幕空间实时绘制，
按缩放分级、贪心避让。

## 对局协议

模型只在「意图层」决策，执行交给确定性求解器：

1. `observe` — 分层观测，硬 token 预算，规则摘要走 KV 缓存不重发
2. `listActions` — 引擎预筛出具体候选，模型做选择题而非自由填参
3. `validate` — 拒绝非法动作，模型不能改写事实
4. `resolve` — 确定性裁决。**唯一随机源是开局种子**，
   所有判定按 `H(seed, 年, 季, 势力, 事件类, 序号)` 派生，与裁决顺序无关，可逐位重放
5. `replay` — 追加式事件时间线

裁决必须确定：裁判若有方差，选手的优劣就被淹没了。
（反面参照：HiStrategy 用 LLM 做世界模拟，见 `research/GAMEPLAY-MOD-ECOSYSTEM.md`）

## 授权边界

- 不复用光荣或任何商业游戏的美术、数值表、地图、UI
- 地形来自公有领域高程数据；皴法墨迹提取自公有领域中国山水画
- 史料（《后汉书》《三国志》）为公有领域
- CHGIS / 复旦 TGAZ 为 CC BY-NC，仅用于坐标校对，不打包进产品
