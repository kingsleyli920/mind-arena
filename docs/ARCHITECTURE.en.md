[中文](ARCHITECTURE.md) · [English](ARCHITECTURE.en.md)

# Mind Arena architecture

Mind Arena is a web-based Three Kingdoms strategy game that doubles as an arena for
comparing large language models. The game itself has to stand up — strategic depth,
historical texture, playability; model-versus-model is a use of it, not a substitute
for it.

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| App | React 19 + vinext (Next.js on Vite) | Deployed to Cloudflare Workers |
| Map rendering | `/play` uses DOM / Canvas / SVG, `/game` uses PixiJS v8 | Multi-level base tiles, labels as a live UI layer |
| Engine | Pure TypeScript functions | Five stages: observe / listActions / validate / resolve / replay |
| Content | JSON content pack | Rules are data; see below |
| Data build | Node + sharp scripts | `tools/`, all re-runnable |

**A superseded decision**: early documents stated "Godot 4.7 is the primary play
surface; the campaign map must not be rendered with DOM/SVG". The current entry point
for play is React `/play`; the earlier PixiJS viewer is kept at `/game`.

## Rules are data

The game content — actions, numeric constants, terrain, unit types, aptitudes, victory
criteria — all lives in `lib/game/content/*.json`, and the engine only executes what
the data says.

This is not just configurability. **The same definition drives the engine and, via
`toRulesDigest()`, generates the rules section of the model's prompt.** If the rules
were hard-coded in TS, a second document would have to be written for the model to
read, and two documents drift apart as they are iterated on — what the model computes
no longer matches what the engine resolves, and the evaluation stops meaning anything.

`lib/game/content/schema.ts` provides the type contract, the validator and the digest
generator. The validator intercepts design errors rather than malicious input: an
action with no cost (it would be spammed infinitely), more than 4 tiers (the model
cannot trade them off), a description that is too short (the model does not know when
to use it), a unit-counter reference to a unit type that does not exist.

### Four-way reconciliation

Drift does not raise an error; it just shows one party a fake set of rules. So four
things get laid side by side at intervals: **what the content pack says × the state
inside the engine × what the observation gives the model × what the interface gives the
human**. Every difference that comes out of that gets turned into a gate
(tests/engine.test.mjs):

| Gate | What it catches |
|---|---|
| No numeric constant in the pack may go unread | The pack says something the engine does not read — **that is lying to the model**. It once caught "the ironworks keeps siege engines in standing supply" when the engine in fact only lowered the tier by one |
| No pricing may exist in two places | Order-budget pricing is written both in the pack and in `DEFAULT_RULES`; they agree for now, but nothing stops them diverging |
| Provisions cap: candidate and resolution use the same number | Candidates used `provisionsCap` and resolution used `provCapOf`, so a city with a granary could never be filled |
| The commandery table must line up with the observation's `mine` section | The model can see provisions / siege engines / unit types / buildings and the human cannot — the two are fighting different wars |
| The variant table for map symbols must match what actually renders | Referencing an image that does not exist does not error in SVG; it just leaves a hole |
| The rules digest must contain no developer asides | Keys like "why / lesson / cost" are written for humans; in the prompt they amount to teaching the model how to think |

The way into a reconciliation is "which side has it and which side does not", not "is
the number right" — a wrong number gets caught by a test, and **an absence does not**.

## Data layer

`lib/game/data/`, all JSON, all regenerable by scripts under `tools/`:

| File | Contents | Source |
| --- | --- | --- |
| `commanderies.json` | 105 commanderies: seat, households, subordinate counties, coordinates, certainty | Parsed from the text of the *Treatise on Commanderies and Kingdoms* in the *Book of the Later Han* (后汉书·郡国志) |
| `officers.json` | 808 officers: courtesy name, native place, birth/death, 194 allegiance, source citation; filtered by availability at game start | Biographies in *Records of the Three Kingdoms* (三国志) and the *Book of the Later Han* (后汉书) |
| `scenario-194.json` | The allegiance of 105 commanderies across 31 factions, each with a source citation | Source scholarship |
| `strategic-nodes.json` | 61 passes, roads, fords, ports, granary cities and historic battlefields | Source scholarship |
| `hydrology.json` | Waterways, with the Yellow River on its Eastern Han course (after Wang Jing's works) | Natural Earth + historical channel reconstruction |
| `terrain-grid.json` | Elevation, relief and terrain classification on a 330×270 grid | AWS Terrain Tiles |
| `junguozhi-raw.json` | 1013 passages of the *Treatise on Commanderies and Kingdoms* (郡国志) source text | ctext.org, public domain |

## Map pipeline

```
tools/fetch-dem.mjs           AWS elevation tiles → refs/dem-raster.raw (not in repo, re-downloadable)
tools/fetch-refs.mjs          public-domain landscape paintings → refs/ (not in repo)
tools/extract-cun.mjs         extract cun texture-stroke ink from the paintings → public/game/ink/
tools/make-paper.mjs          tileable xuan-paper texture → paper.png
tools/shrink-ui-paper.mjs     the same paper compressed to [228,255] for the interface → ui-paper.webp
tools/render-terrain-map.mjs  hillshade + colour wash + cun strokes + waterways → base map PNG (PPD=440, 14520×11880)
                              also exports public/game/data/map-labels.json (label data)
tools/slice-map-tiles.mjs     base map → five levels of 512px webp tiles (z0 908 → z4 14520)
tools/make-play-base.mjs      base map → a single 1815 backing image (no holes before the tiles arrive)
tools/render-map-decor.mjs    sea waves and cloud vapour (reads the same elevation to find sea) → decor.webp
tools/render-map-glyphs.mjs   city walls, passes/fords/ports/granaries, field camps → glyphs/ (several per class)
tools/build-territory-grid.mjs 0.1° grid: which commandery each cell belongs to → territory-grid.json
```

The base map is 14520×11880; the tiles number 940 and total 13MB.

### Which layer uses pixels and which uses vectors

There is exactly one criterion: **lines are vector, washes are pixels.** A raster
pyramid always has a ceiling — z4 sits on a 1181-logical-pixel frame, so at fourteen
times it is still being stretched 2.28×; cutting one more level would take a 700MB
source image and twenty-eight hundred tiles, and the level after that would double
again. But what stretching makes ugliest is the *lines* (riverbanks, borders — the
kind of edge laid down in a single stroke), not the gradient wash. Hence:

| Layer | Form | Why |
|---|---|---|
| Hillshading, cun strokes, colour wash | Tiles (z1–z4) | It is a **wash**; stretching does not show. Also it is computed per pixel from optical depth, which a browser cannot run |
| Territory colour fields | Canvas (0.1° grid) | A wash. At the close tier the edges stay sharp, and the colour yields to 55% so the terrain shows through |
| Border ink lines | Two SVG paths | Lines. A 3265-segment, 147KB `d` string, solid at any magnification |
| Waterways (rivers, coastline) | SVG path | Lines. 4473 points, 90KB, river widths copied from the same hydraulic-geometry formula as the base map |
| Roads | SVG line | Lines. 232 edges, stroked differently by terrain |
| City walls / passes and fords / armies | PNG sprites + mask tinting | **Paintings**. Rendered offline with brush.mjs, several per class, chosen by hashing the name |
| Cartouches and inscriptions | SVG text | Greedy collision avoidance in screen space |

Labels are not baked into the base map — baked in, they would be fixed in size and
density at every zoom level, and the eight passes and fords around Luoyang (洛阳) would
necessarily overlap.

### Zoom tiers

Three tiers, breathing in step with the tile levels: far (k<1.6) shows only territory,
province names and city sigils; middle (<3.2) brings out passes and ports and spreads
the commandery names; close (≥3.2) brings out every stronghold with its name, draws
cities as walled cities, and brightens waterways and roads.

The reason for tiers is not performance, it is that **one image cannot hold it all**.

Symbols scale by 1/k^0.82: they shrink on the map faster than the screen magnifies, so
zooming in genuinely separates cities that sit on top of each other (Jingzhao (京兆尹)
and Zuo Pingyi (左冯翊) are only 16 pixels apart on the map). Zooming out falls back on
greedy collision avoidance, and whichever label yields leaves a small dot behind.

### Measurements

- While zooming, the median frame is 8.3ms and the 90th percentile 10ms; crossing a
  tile level costs one 60–120ms decode stall, which happens three times across the
  whole zoom range and is mostly covered by the 280ms camera easing.
- The borders' `strokeWidth` once varied continuously with magnification, which made
  the browser recompute the stroke geometry of over three thousand curves on every
  change; it was changed to three values keyed to the zoom tier.
- Hover and idle both show 0 longtasks, and 0.3ms of forced layout.

**Validate the ruler before measuring with it.** An automated browser will throttle
rAF to 1Hz (when the window is occluded, or headless), and at that point every
rAF-based measurement reports phantoms like "1000ms per frame" or "1.8 seconds to
hover" — this repo misjudged that twice before switching to
`PerformanceObserver('longtask')` plus synchronous forced layout. Measure a run of
idle frame intervals first: a tidy 1000ms is throttling, not stutter.

### Why the vector layer is not inside .map-stage

The picture proper (tiles, sea waves, territory canvas) hangs on a stage magnified by
`transform: scale(k)`; if the vector layer hung there too, at fourteen times it would
be a thing 16531×13526 CSS pixels across, of which only one screen is visible. Instead
it fills the frame on its own and does the same translate-and-scale internally with a
single `<g>`, and is **given no viewBox** (when the viewBox ratio and the element ratio
disagree, the default preserveAspectRatio scales the whole layer and centres it, which
puts the vector layer out of register with the base map; measured horizontal deviations
were −73/−56/−24 pixels, varying with position).

Alignment relies on `box` (the measured frame size). It had been stuck at its initial
value of 1200×980 the whole time: the observer was attached inside `useEffect + []`,
and that effect ran back on the seat-selection page, when the map had not rendered yet
and the ref was null. After switching to a callback ref, the idle probe's alignment
deviation is 0/0.

## Match protocol

The model only decides at the "intent" layer; execution is handed to a deterministic
solver:

1. `observe` — layered observation and candidates, with the rules digest in a stable
   system prefix; caching depends on the provider
2. `listActions` — the engine pre-filters concrete candidates, so the model answers
   multiple choice rather than filling in free parameters
3. `validate` — rejects illegal actions; the model cannot rewrite facts
4. `resolve` — deterministic adjudication. **The only source of randomness is the
   opening seed**, and every roll is derived from `H(seed, year, season, faction,
   event class, index)`, independent of resolution order and replayable bit for bit
5. `replay` — an append-only event timeline

Adjudication has to be deterministic: if the referee has variance, the difference
between the players is drowned in it. (As a counter-example, HiStrategy uses an LLM for
world simulation; see `research/GAMEPLAY-MOD-ECOSYSTEM.md` (Chinese))

### End of game, and the test budget

`GameState.endCondition` distinguishes `unification` from `season-limit`. The player
interface only enables unification games; the default in the engine's `createGame` is
still fixed length, for compatibility with the existing evaluation. The unification
criterion remains control of 11 provinces, or being the only effective faction left.
In a unification game `seasonsPerGame` only feeds the epoch pacing; player games keep
the original 64-season pacing. The model's observation has `clock.totalTurns` as
`null`. Test tooling limits the loop count explicitly and records
`test-budget-paused`, without modifying the game's `finished`.

The player-facing bot goes through `decideForPlay`: built on the purpose flow, it
prioritises a strained treasury, avoids shuffling officers back and forth, avoids
moving the same officer repeatedly, and avoids over-budget construction, and it raises
the priority of moving the seat when the administrative seat falls. `decide` / `pick`
retain the original five evaluation profiles. `economy.ts` provides a single source for
military expenditure including the tuntian (屯田) reduction, shared by resolution, the
player interface, the model observation and the bots.

### Play sessions

`lib/game/session.ts` manages the `PlaySession` and the per-season advance. `human` is
the player's seat; when it is empty the game is pure spectating. `modelOf` is the
per-faction model assignment, and the remaining factions are controlled by the rule
bots. The viewing perspective is independent of the controller and does not affect who
issues orders.

Each model seat holds its own strategy plan and last season's dropped-order feedback.
The call quota is reserved and persisted before the request; the model's response goes
through the same admission layer and is then handed to `resolve` alongside the player's
and the bots' commands. The log cursor stops at the end of the previous season's
resolution, so the report of what just happened only arrives next season.

`save.ts` version 11 saves the game and the session; a refresh restores to a paused
state. The browser proxy caps request count, output and timeout; the CLI evaluation can
still set its own budget explicitly. A failure visible in the interface is never
replaced by a bot's commands. Long games and limited-model acceptance are in
`PLAYTEST-2026-09-28.en.md`.

### 2.2 Strategic wrap-up

`transfer` moves troops between two adjacent commanderies of one's own, and costs each
side one commandery order. Resolution first deducts all departing troops, then moves
them into their destinations together; troops received in the same season cannot be
forwarded again. Candidates only list routes moving toward the border; humans, bots and
models share the same candidates and the same validation.

`submissionTerms` centralises the thresholds for submission. After controlling 7
provinces, a faction whose territory is twice a neighbouring enemy's may attempt to
persuade it to submit, no longer bound by the early restriction of at most 8
commanderies on the enemy's side; the attempt still rolls against morale, the strength
differential and the seed, with a two-season cooldown after a refusal. Submission
transfers armies, prisoners, officers awaiting appointment and the treasury, and
cancels the old faction's remaining commands.

Siege lookahead and siege resolution share the same blockade criterion, and after
losses provisions are deducted against the surviving garrison; a scouted target not yet
reached uses the observed upper bound on troops and a full-granary estimate, and cannot
read hidden remaining provisions. The forecast states the conditions for next season's
reinforcement, and does not account for the defender's reaction, marching, or unpaid
wages. When military funds are short, automatic replenishment is restricted first, so
newly recruited garrison troops do not crowd out the wages of the existing army.

Acceptance and known limitations are in [this round's completion
report](STRATEGY-FINISH-2026-09-28.en.md).

### 2.3 Command reservation and cross-season plans

`OrderBudget` in `engine/order-budget.ts` is shared by the player's candidate preview,
model admission, the bots and real resolution. It holds the commands already adopted
this season and reserves allowance, treasury and building slots, checking for conflicts
between campaigns from the same origin, duplicate targets, officer reassignments,
lifting a siege versus reinforcing it, and troop transfers versus sorties.
`allocateTransfers` is shared by the capacity pre-check and real transfer allocation.
Whether a command is legal and whether a battle can be won are handled separately.

`strategy-plan.ts` defines the structured plan, parsing that remains compatible with
historical free-text plans, formatting, and factual feedback. `observe` passes last
season's plan, this season's visible facts and the reports to the model; `session`
saves the returned plan, and an invalid plan keeps the old value. `StrategyPlanView`
displays the plan in the session panel and keeps the AI's judgments separate from the
facts.

prompt version 1.18.0, observation 1.4.0, pack 2.3.0, save 11. The JSON Schema keeps a
candidate enum, and the app's parsing controls command count and field length, to avoid
a complex schema being rejected by a provider. The bounded-scenario tool is
`tools/strategy-cases.mjs`, free of model cost by default; results and limitations are
in [strategy-plan acceptance](STRATEGY-PLANS-2026-09-28.en.md).

### Reviewing the facts of resolution

`engine/season-outcome.ts` compares the state at the start and end of a season and
records each side's net commandery gains and losses and treasury change; `resolve`
writes it into `GameState.lastOutcome`. `outcomeFor` returns only the summary for a
given seat and only for the season just past; `observe.report.changes` and
`SeasonReviewView` share it, so losing a city cannot be truncated away by the
realm-wide report. The administrative seat's name is kept separate from
`seat.capitalHeld`, making it explicit whether the seat is still held.

`modelDecide` reuses an identical review text prompt and keeps the response, adding no
extra model calls. This is verifiable feedback and prompting, not a complete factual
audit of a natural-language plan. Validation and limitations are in [review facts and
faction diagnosis](STRATEGY-REVIEW-2026-09-28.en.md).

`game/decision-review.ts` generates, in one place, both the factual prompt at decision
time and the receipt for command admission, written into the optional
`ModelTurnRecord.review`. `session` takes the previous season's record for the same
seat, and `observe.decisionLastSeason` re-checks the seat and season number before
returning to the model the keys that were adopted, the reasons for rejection, and the
prompts; where there is a receipt it replaces the old dropped-order summary. A change
in target ownership, or in the target or the attack/defend direction, only triggers a
prompt — it does not alter the AI's own text or the engine's adjudication.
`DecisionReviewView` shows the record next to the actual resolution summary, making it
explicit that adoption is not the same as the action succeeding. The new fields do not
change GameState, and old version-11 saves remain valid; the protocol is prompt 1.19.0
/ observation 1.5.0.

Follow-up on 2026-09-29: prompt 1.21.0 / observation 1.6.0. `planReset` is generated
from current public facts only when the old plan was an attack, the target now belongs
to the player, and it is not under siege; the next season's request sets the old `plan`
to null, while the old plan remains in the session record. A defensive target, or one
under siege, is not reset. See [the measurements](DECISION-GUIDANCE-2026-09-29.en.md).
Free replay and live-page evidence are in [plan and command
cross-check](DECISION-REVIEW-2026-09-28.en.md).

## Licensing boundaries

- No art, stat tables, maps or UI reused from Koei or any commercial game
- Terrain comes from public-domain elevation data; the cun ink strokes are extracted
  from public-domain Chinese landscape paintings
- The historical sources (*Book of the Later Han* (后汉书), *Records of the Three
  Kingdoms* (三国志)) are public domain
- CHGIS / Fudan TGAZ are CC BY-NC, used only for coordinate cross-checking and not
  bundled into the product

<!-- translated-from: ARCHITECTURE.md@d2eaa76d8687 -->
