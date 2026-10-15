# Mind Arena · 汉末沙盘

A Three Kingdoms grand-strategy game on the 194 CE warlord map, where every
faction can be driven by a human, a rule-based bot, or a separately chosen AI
model. The same engine and decision protocol back both play and model evaluation.

游戏与全部界面为中文；文档亦为中文。

## 跑起来（零配置）

```bash
git clone <repo> && cd mind-arena
npm install
npm run dev          # 打开 http://localhost:3000/play
```

**不需要任何环境变量、不需要数据库、不需要云账号。** 所有对手默认是内置机器人，
开一局、玩一局、读档续盘全部在本地完成，一分钱不花。地图、城印、武将数据都已
随仓库发布（约 17 MB），clone 下来即可用。

需要 Node.js `>=22.13.0`。

## 想让某一方由真的大模型执子（可选）

```bash
cp .env.local.example .env.local   # 填入你自己的 OPENROUTER_API_KEY
npm run dev
```

密钥只被服务端路由读取，**不会以 `NEXT_PUBLIC_*` 的形式进到浏览器**。
在开局配置里给任意势力单独选一个模型即可，别的势力仍可以是机器人或你自己。
默认模型是免费档，但可用性取决于供应方。

`.env.local` 已在 `.gitignore` 里；仓库里只有 `.env.local.example`，它只有占位符。

## Current focus

- strategic orders: territory, officers, supply, armies, construction and diplomacy
- independent controllers and cross-season plans for each AI faction
- playable and observable matches using the same rules
- deterministic bot playtests before spending on model experiments

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the match protocol,
fairness modes, MVP boundaries, and open-source path. The researched historical
and game-design baseline is in
[docs/research/THREE_KINGDOMS_RESEARCH.md](docs/research/THREE_KINGDOMS_RESEARCH.md).
How to run an evaluation — and the measured constraints that bound it — is in
[docs/EVAL.md](docs/EVAL.md).

## Useful Commands

玩游戏只需要 `npm run dev`。下面其余的都是开发与评测用的。

- `npm run dev`: start local development
- `npm run build`: verify the production build
- `npm run typecheck`: check TypeScript without emitting files
- `npm run types:worker`: regenerate Cloudflare runtime types from the build's
  Wrangler config; run `npm run build` first when refreshing these types
- `npm test`: run engine, model-client and session regression tests
- `npm run lint`: run static checks
- `npm run selfplay`: bot-only self-play plus the four gameplay acceptance gates
- `npm run playtest`: three 64-season bot matches through the browser's session
  logic, with zero model calls; optional output path: `npm run playtest -- /tmp/playtest.json`
- `npm run obs:budget`: per-seat observation token gate (exits 1 when over)
- `npm run eval`: run one agent (bot / stub / model) over N games
- `npm run eval:suite`: run several agents over the same seeds and print a leaderboard
- `npm run eval:dissect`: split one run open — by seat, action mix, dropped orders, AP usage
- `npm run build:board`: compress a board's results into `public/game/leaderboard.json`
  for the `/board` page. Refuses to mix arms whose rule fingerprints differ.
- `npm run verdict`: check whether the coarse ruler (grades) and the continuous one
  (territory progress) agree — same sign, same ranking, and the coarse one sensitive
  enough on the strongest entrant.
- `npm run models`: survey candidate opponents before opening a board — price per 48
  games, whether any provider supports structured outputs, measured p50 throughput,
  and which provider to pin. Reads pricing and endpoint stats only; costs nothing.

## Playing it

Run `npm run dev` and open `/play`. Matches continue until unification. Assign
each faction a bot, a model, or the single human seat. Models may differ by
faction. All opponents default to bots, so opening and playing a bot match
costs nothing.

Choose **纯观战** to let every faction act automatically. Switch the observed
faction, advance one season, or start/pause automatic advancement. The map uses
the observed faction's intelligence; changing perspective never changes its
controller. Pausing lets an already-started season finish. Player bots use a
unification-oriented policy; the five fixed benchmark profiles remain separate.

Model decisions have a per-match allowance and a per-request output ceiling
(including reasoning). Each decision makes at most two upstream attempts. A
season pauses before calling any model if the allowance cannot cover all its
active model seats. You can explicitly add 16 decisions or continue with bots.
These are request limits, **not a dollar cap**. The panel shows reported charges
and flags decisions whose costs are unknown. A failed model issues no orders,
is recorded visibly, and stops automatic advancement.

There is no season limit in player matches. Controlling 11 provinces or being
the last active faction wins. Test budgets pause an unfinished game; fixed-length
benchmark matches retain their separate season-limit mode. Progress grades remain
available throughout the match.
Adjacent friendly cities can transfer garrison troops toward the front. Transfers
reserve both cities' order capacity and cannot relay received troops again in the
same season. At seven controlled provinces, a faction can also seek submission
from an adjacent faction with at most half its territory, even if that faction
has more than eight commanderies. Submission remains probabilistic, with a
two-season refusal cooldown. Humans, bots and models share these rules.
The seat-select page has a rules primer (怎么玩); the in-game header has the same
panel behind 规则.

Progress is saved to `localStorage`, including pending human picks, controller
assignments, AI plans, rejected orders, decision records and used allowance.
Model calls reserve and save allowance before requests are sent. Reloading
offers 继续 / 弃掉重开 and resumes paused. An interrupted in-flight season
returns to the last settled state; its reserved allowance remains spent, and
its responses may be unavailable. A save is
dropped when the pack or state shape changes rather than migrated — the engine is
still moving, and silently loading a stale save gives you a board whose rules no
longer match.

AI plans now keep an objective, preparation, withdrawal conditions and an AI-written
review across seasons. The panel shows that judgment alongside actual territory
and treasury changes from the engine. Shared admission reserves money, troops and order capacity before execution.

## Current limits

The [plan and order review](docs/DECISION-REVIEW-2026-09-28.md) now flags target
ownership and stale plan status, shows accepted and rejected commands, and feeds
the receipt into the next decision. These checks do not guarantee that a model
will correct its strategy. Version 11 saves remain compatible.

A [six-decision receipt test](docs/DECISION-CORRECTION-2026-09-28.md) cost $0.01073.
Flash-Lite recognized the relocated capital with the receipt, but Nano still
confused targets and orders. Both conditions dropped three orders; reliable
strategy correction remains unresolved.

When a prior attack target is now owned and not under siege, the next model input
retires that old plan and asks for a new objective. A one-decision [follow-up](docs/DECISION-GUIDANCE-2026-09-29.md)
stopped Nano repeating the false target claim, while other plan and order errors
remained. The original plan stays in the match record.

The latest [fixed-position model comparison](docs/DECISION-COMPARISON-2026-09-28.md)
compares nano, Flash-Lite and mini in nine decisions. Mini lost fewer orders to
validation, but plan consistency remains unresolved; this is not a win-rate ranking.

For the latest season-review fixes, model checks and faction comparisons, see
[the review report](docs/STRATEGY-REVIEW-2026-09-28.md). Shared order validation
and structured plans are covered in [the plan report](docs/STRATEGY-PLANS-2026-09-28.md).
The earlier [completion report](docs/STRATEGY-FINISH-2026-09-28.md) covers the 2.2 rules.
The earlier [strategy validation report](docs/STRATEGY-VALIDATION-2026-09-28.md)
records the stalemates that led to these changes.

- **Model speed and availability vary.** Each faction has its own model selector.
  The browser runs the same `modelDecide` the eval harness runs — same observation,
  same admission, same failure buckets — with `/api/openrouter/chat` acting as a
  server-side `LlmClient` proxy so the key never reaches the browser. Needs
  `OPENROUTER_API_KEY` in `.env.local`. The default model is free, subject to
  provider availability. Requests time out after 90 seconds per attempt;
  browser requests never expand the selected output ceiling. Failures never silently fall back to the bot —
  that seat simply issues no orders, and the status bar says why.
- Counties (县) are not a play unit; the map's atom is the commandery (郡).
- No loyalty model. Officers do not defect on their own. Captured officers can
  be recruited within two seasons; whole-faction submission also transfers officers.
- One scenario only (194 兴平元年). It has been audited across eight dimensions
  (ownership, officer availability, province seats, population/garrison
  derivation, adjacency, cross-file consistency, seat playability) with every
  finding adversarially re-checked; see the `剧本核对` commit for what that found
  and fixed. `tools/build-adjacency.mjs` now fails rather than writing a map that
  drops a required corridor.
- Desktop only.

Evaluation tooling (`npm run eval`, `npm run eval:suite`) does drive real models
and needs the key above. See [docs/EVAL.md](docs/EVAL.md) for the measured
constraints that bound it — including the two ways a leaderboard can silently
become a lie.

The current pack is 2.3.0 and save format is 11; older saves require a new match.

## 重新生成地图（可选，大多数人用不到）

仓库里**已经带了成品地图**：941 块瓦片、55 个城印、通行代价场、道路与
疆域栅格，合计约 17 MB，clone 下来直接能用。只有想改地图本身的人才需要下面这些。

`npm run map:all` 会从高程数据重新渲染整条链：

```
refs/dem-raster.raw  (283 MB，不入库，需自行下载)
  → npm run map:base4x → han-terrain-4x.png (172 MB，中间产物，不入库)
      → npm run map:tiles → public/game/map/tiles/    ← 运行时用这个
      → npm run map:play  → public/game/map/play-base.webp
```

那两个大文件**刻意不入库**：`han-terrain-4x.png` 单个 172 MB，超过 GitHub
单文件 100 MB 的上限，带着它仓库根本推不上去；而运行时一个字节都用不到它。

高程数据来自 [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
（terrarium 格式，公有领域），`refs/dem-raster.json` 里记着取的是哪个范围。

另有两条独立于地形的：`npm run map:cost` 重算通行代价场（决定哪儿走得通、
关隘扼守多少价值），`npm run map:cost:report` 打印它的验收报告。

## 许可证与数据出处

代码按 [MIT](LICENSE) 发布。

打包进来的史料与地理数据全部是**公有领域或开放数据**——《三国志》《后汉书》
《续汉书·郡国志》等古籍，AWS Terrain Tiles 的高程，Natural Earth 的海岸线与
水系。郡治与据点坐标由现代地名反查得出，逐条标注了 certainty 与史料依据。

项目**刻意回避了带非商业条款的数据集**：CHGIS / 复旦 TGAZ 是 CC BY-NC，
只在研究阶段用来校对过坐标，没有任何数据打包进来。详见 [LICENSE](LICENSE)。
