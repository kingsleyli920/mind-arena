[中文](README.md) · [English](README.en.md)

# Mind Arena · 汉末沙盘

**A Three Kingdoms grand-strategy game on the 194 CE map, where every faction can
be driven by a human, a rule-based bot, or a separately chosen AI model.** The same
engine and decision protocol back both play and model evaluation. The game and its
interface are in Chinese.

---

The first year of Xingping (兴平元年, 194 CE): thirty-one factions, one hundred and
five commanderies (郡). Every one of them can be played by you, by the built-in bot,
or by **an AI model you pick for that faction alone** — all of them issue the same
orders and travel the same resolution path.

There is a second scenario: **Jian'an 5 · the eve of Guandu** (建安五年·官渡前夕, the
first month of 200 CE, twenty factions). Yuan Shao (袁绍) already holds the four
provinces north of the Yellow River; Cao Cao (曹操), holding the Emperor, is encamped
at Guandu (官渡); Liu Bei (刘备) has just killed Che Zhou (车胄) and taken Xiapi (下邳);
Sun Ce (孙策) holds the whole of the Jiangdong and will be assassinated in the fourth
month; and Zhang Xian (张羡) has raised the three commanderies of Changsha (长沙),
Lingling (零陵) and Guiyang (桂阳) in revolt against Liu Biao (刘表). You switch between
them on the seat-selection page.

This is both a game you can actually play and a rig for **evaluating LLMs through
play**: hand the same position to different models and watch how each one issues its
orders, how it corrects itself across seasons, and what it makes of the hand it was
dealt over sixteen seasons.

![The board mid-game: Chenliu under siege, with relief and campaign candidates in the right column](docs/images/play.webp)

<sub>Mid-game. The top bar warns 「陈留郡被围」(Chenliu commandery is under siege);
on the map each army carries its faction's character, and passes and fords carry an
ownership colour ring; the right column holds the candidates the engine pre-filtered,
each one tagged with a strength ratio or a breach forecast.</sub>

| Power map (full) | Seat selection |
| --- | --- |
| ![Power map](docs/images/power-map.webp) | ![Seat selection](docs/images/seats.webp) |
| Zoom out for the shape of the realm: territory colour blocks, faction names, province names as watermarks, no city sigils | Thirty-one factions, each with a historical biography and an opening position |

## Run it (zero configuration)

```bash
git clone <repo> && cd mind-arena
npm install
npm run dev          # open http://localhost:3000/play
```

**No environment variables, no database, no cloud account.** Every opponent is a
built-in bot by default; starting a game, playing it, saving and resuming all happen
locally, and none of it costs a cent. The map, the city sigils and the officer data
all ship with the repo (about 22 MB) — clone it and it runs.

Requires Node.js `>=22.13.0`.

## Put a real LLM behind one of the factions (optional)

```bash
cp .env.local.example .env.local   # fill in your own OPENROUTER_API_KEY
npm run dev
```

In the game setup you pick a model for any faction individually; the rest can still
be bots or yourself. The key is read only by the server route and **never reaches the
browser as a `NEXT_PUBLIC_*` variable**; `.env.local` is in `.gitignore`, and the repo
contains nothing but a placeholder example.

The browser runs the **same** `modelDecide` as the evaluation tooling — the same
observation, the same admission layer, the same set of failure categories.
`/api/openrouter/chat` is nothing but a server-side proxy.

Each game has a decision-count quota and a per-call output cap (reasoning included).
If the quota will not cover every model seat at the start of a season, the game pauses
first and asks whether you want to top it up by 16 or hand the seat to a bot. **That
is a gate on request count, not on money** — the panel shows the spend the provider
reports, and flags the calls whose cost is unknown.

When a model fails, that seat **issues no orders**, the failure is recorded explicitly,
and auto-advance stops. It never quietly falls back to a bot.

## Terms

The Chinese terms of art, since they run through everything below and through the UI:

| Chinese | English | What it is |
| --- | --- | --- |
| 郡 | commandery | The atomic territorial unit. 105 of them; the map's pieces |
| 州 | province | The grouping above a commandery; victory is counted in provinces |
| 令 | order | One command issued in one season; each season has an order budget |
| 民心 | morale | A commandery's popular sentiment; a direct input to submission odds |
| 守军 | garrison | Troops stationed in a commandery |
| 产出档 | yield tier | The band a commandery's output falls into |
| 据点 | stronghold | A pass, valley road, ford, port or granary — ownable, defensible, attackable |
| 代价场 | cost field | The per-cell traversal cost raster that decides what is passable and who borders whom |

## How to play

Take a seat, or pick **pure spectator** and let every faction act on its own. Each
season you tick off a few orders from the candidates the engine offers, seal them,
resolve, and read the report.

- **Winning**: control 11 provinces, or be the last effective faction standing. A
  player game has **no season limit**; you can pause, save and resume at any point.
  (Evaluation uses a different setting: a fixed 16 seasons, graded on the increment
  relative to the opening position.)
- **The map**: one hundred and five commanderies, one map shared by both scenarios.
  Zoomed out it is a power map;
  zoomed to 4× it is a board — cities, roads, the passes and fords along those roads,
  troops walking the roads, sieges you can actually read. The ground colour is painted
  from the **traversal cost field**: dark is hard going, black is impassable, and the
  passes and fords are the gaps in the wall.
- **Strongholds**: passes, valley roads, fords, ports and granaries all have owners,
  and can be taken, held and attacked. The bonus for holding a choke point goes to
  whoever holds it — take the pass and the defender no longer has the pass's advantage.
- **Troop transfers**: between adjacent commanderies of your own you can move garrison
  troops toward the front, up to half the starting garrison out of any one commandery
  per season.
- The seat-selection page has a "how to play"; the in-game top bar has "rules". They
  are the same document.

Progress lives in `localStorage`: pending ticks, controller assignments, the AI's
cross-season plans, rejected orders, decision records and the quota already spent.
**A change to the rule pack or the save format refuses the save outright; there is no
silent migration** — an old save read in quietly would keep running under the new
rules and be wrong without making a sound.

## A few design decisions

These are where this project differs from a normal Three Kingdoms game, and why it can
be used to evaluate models at all.

- **The model answers multiple choice, not fill-in-the-blank.** The engine pre-filters
  the candidates that are actually feasible and the model picks them by key. Without
  that, the action space explodes and what you end up measuring is who guesses the
  format best.
- **The map is a cost field, not a picture.** "Who can attack whom" is computed from
  terrain — a simultaneous Dijkstra from all 105 administrative seats, and territories
  that meet are neighbours. Nobody drew those lines in advance.
- **Rules are data.** Every combat and resolution constant lives in
  `lib/game/content/pack-194.json`; a missing entry is a startup error. Change one
  number and it has to move in four places at once — the engine, the rules digest the
  model reads, the observation, and the interface. Tests pin that down.
- **The freeze gate.** The rule numbers have a fingerprint; a change must bump the
  version, record a "what changed / why / consequences" entry, and re-run the free
  baseline. It has already caught three real problems, including one where the version
  number was bumped but the record was not.
- **Validate with the free thing first.** Any gameplay change runs bot self-play first
  (`npm run selfplay`, four acceptance gates); only after that does it get to touch a
  model.

## Current limits

Stated up front, so you don't assume it is already solved:

- **Whether a model can be corrected is still an open question.** The decision review
  feeds "what you ordered, which order was dropped, and why", along with the actual
  outcome, back into the next season. One [six-decision receipt
  trial](docs/DECISION-CORRECTION-2026-09-28.en.md) cost $0.01073: Flash-Lite
  recognised that the administrative seat had moved, Nano still confused targets with
  orders, and both sides dropped three orders each. [A follow-up
  round](docs/DECISION-GUIDANCE-2026-09-29.en.md) stopped Nano from repeating a false
  target; the other planning and ordering errors were unchanged.
- **The factions are unbalanced, and the cause has been traced.** 24 games in
  unification mode: 20 unified naturally (19–50 seasons, median 30), **all of them Yuan
  Shao (袁绍)**; the remaining 4 ran the full 64 seasons undecided, and 3 of those still
  had Yuan Shao in the lead. Four things were changed in response (the fortified-city
  threshold, recurring coalitions, the cost of digesting a captured commandery, and
  four shapes of order-budget curve) and **all four failed** — none of them was the
  binding constraint. The quantity that actually matters is fixed at the opening: Cao
  Cao (曹操) has 21.86× his own strength next to him, Yuan Shao only 1.57×. A global
  knob cannot move a **ratio between seats**. The sixteen-season evaluation is
  unaffected (opening commandery count ↔ territory gain, ρ = −0.13: starting big is no
  advantage). The whole trail is in
  [docs/BALANCE-2026-10-16.en.md](docs/BALANCE-2026-10-16.en.md).
- [A model comparison on fixed positions](docs/DECISION-COMPARISON-2026-09-28.en.md)
  compared nano, Flash-Lite and mini across nine decisions: mini had fewer orders
  thrown out by validation, but plan consistency is still unsolved. **That is not a
  win-rate ranking.**
- The county is not a unit of play; the map's atom is the commandery.
- There is no loyalty model; officers do not defect on their own.
- Two scenarios (194, the first year of Xingping; 200, the fifth year of Jian'an), and
  only one map between them. **In bot self-play on Jian'an 5, 6 of 8 games unify and
  the winner is still Yuan Shao**, while a bot playing Cao Cao is usually eliminated —
  he opens with twenty-four commanderies and 147,000 troops, but with eleven fronts to
  Yuan Shao's six, neighbourhood pressure 2.73 against 1.24. Historically Cao Cao was
  the side that won by a hair — and **a model playing Cao Cao does win**: on **three
  seeds chosen in advance**, `glm-5.3-flash` **unified the realm 3/3** and
  `deepseek-v4-flash` **2/3** (the third reached Chao, first of the survivors), while
  **five bot profiles went 0/15** across three seeds (13–25 commanderies). Two models,
  different labs and providers, $1.49 charged across those six games.
  **But that sentence means much less than it sounds.** The gap turns out not to be in
  play style but in **a gate**: demanding a faction's surrender (which absorbs it whole)
  requires 15 cities captured and 6 provinces held, and clearing it starts a snowball.
  Both models cleared it at **30–32 commanderies** (seasons 29–46); the bot peaks at
  **26** in season 16 and shrinks from there, and five profiles across fifteen games never
  cleared it once. Through thirty seasons the troop counts are nearly identical (226k vs
  228k at season 32). Lower the gate to "8 / 2" and the same bot **unifies the realm** on
  one of the seeds. So what the experiment measures is **"can you reach thirty
  commanderies before season thirty"**, not "who plays better". The sixteen-season
  evaluation is unaffected — the gate has never fired within sixteen seasons. See points
  39 and 40 of [docs/EVAL.en.md](docs/EVAL.en.md).
  Under the sixteen-season evaluation setting the four gates pass
  4/4 (opening commandery count ↔ score, ρ = 0.31). **The Liu Biao seat is eliminated
  in 35 of 60 games and finishes in Grade D (丁) in 45 of them** — his three
  commanderies hold four fronts (Cao Cao to the north, Zhang Xian to the south, Sun Ce
  to the east, Liu Zhang (刘璋) to the west), neighbourhood pressure 13.96, and his
  score is close to random, so he is **not in the evaluation rotation**. His place goes
  to Zhang Lu (张鲁), who also opens with a single commandery (eliminated 23% of the
  time, grades spread across four tiers), which gives the "opening with one commandery
  does not mean certain elimination" criterion something to stand on in this scenario
  too. Liu Biao is still playable; he is just not used as a yardstick.
- Desktop only.

## Development and evaluation

```bash
npm test          # regression tests: engine, model client, session, doc and rule gates
npm run lint
npm run typecheck
npm run selfplay  # bot self-play + four acceptance gates (free)
npm run playtest  # three 64-season long games, down the same advance path the browser uses (free)
npm run golden    # golden replay: is what the model sees byte-identical (free, 2s)
```

Evaluation tooling (these really do call models, and need the key above):

| Command | What it does |
| --- | --- |
| `npm run eval` | Runs N games for one agent |
| `npm run eval:suite` | Runs several agents over the same batch of seeds and produces a leaderboard |
| `npm run eval:dissect` | Takes one run apart: by seat, by action mix, by dropped orders, by order-budget utilisation |
| `npm run models` | Provider research before opening a leaderboard: price per 48 games, whether structured output is supported, measured throughput |
| `npm run build:board` | Compresses results into the leaderboard the `/board` page wants; **refuses to mix agents with different rule fingerprints** |
| `npm run verdict` | Checks that the coarse ruler (grades) and the continuous ruler (province progress) agree |
| `npm run obs:budget` | Per-seat observation token gate (exit code 1 if exceeded) |

[docs/EVAL.en.md](docs/EVAL.en.md) records what constrains this evaluation setup —
including **the two ways a leaderboard quietly turns into a lie**.
[docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md) covers the decision protocol and the
fairness model.

## Regenerating the map (most people will never need this)

The repo **already ships the finished product**: 941 tiles, 55 city sigils, the
traversal cost field, and the road and territory rasters — about 22 MB, usable
straight out of a clone. Only someone who wants to change the map itself needs any of
the below.

```
refs/dem-raster.raw  (283 MB, not in the repo, download it yourself)
  → npm run map:base4x → han-terrain-4x.png (172 MB, intermediate, not in the repo)
      → npm run map:tiles → public/game/map/tiles/    ← this is what runs
      → npm run map:play  → public/game/map/play-base.webp
```

Those two large files are **deliberately kept out of the repo**:
`han-terrain-4x.png` is 172 MB on its own, over GitHub's 100 MB per-file limit, so the
repo simply could not be pushed with it — and the runtime does not read a single byte
of it. The elevation comes from
[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (terrarium, public
domain), and the extent taken is recorded in `refs/dem-raster.json`.

`npm run map:all` runs the whole chain. Two more are independent of the terrain:
`npm run map:cost` recomputes the traversal cost field (which decides what is passable
and how much a pass is worth holding), and `npm run map:cost:report` prints its
acceptance report.

## License and data provenance

The code is released under [MIT](LICENSE).

The historical and geographic data bundled here is all **public domain or open data** —
classical texts such as *Records of the Three Kingdoms* (三国志), *Book of the Later
Han* (后汉书) and the *Treatise on Commanderies and Kingdoms* in the *Continued Book of
Han* (续汉书·郡国志); elevation from AWS Terrain Tiles; coastlines and waterways from
Natural Earth. Commandery seats and stronghold coordinates were derived by reverse
lookup from modern place names, each one annotated with a certainty and a source
citation.

The project **deliberately avoids datasets carrying a non-commercial clause**: CHGIS /
Fudan TGAZ are CC BY-NC, used only during research to cross-check coordinates, with no
data bundled in. Item-by-item provenance is in [NOTICE.en.md](NOTICE.en.md).

Current rule pack 2.6.0, save format 12; old saves require starting a new game.

<!-- translated-from: README.md@fb27fe4b9a6f -->
