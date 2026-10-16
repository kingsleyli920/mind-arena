[中文](PLAN.md) · [English](PLAN.en.md)

# Development plan

Based on MERS v0.1 (43 rules) in `GAMEPLAY-DESIGN-V2-DELTA.en.md`.

## Where things stand

**Done**

| Item | Status |
| --- | --- |
| Map | Terrain hillshading base map 7260×5940, 244 webp tiles, PixiJS viewer with drag and zoom, real-time label collision avoidance, faction panel |
| Historical data | 105 commanderies, 578 officers, 31 factions, 61 passes and fords, hydrology, 330×270 terrain grid |
| Content-layer architecture | Type contracts, validators, rule-summary generation (engine and prompt share one definition) |
| Gameplay design | MERS v0.1, converged from two rounds of research plus one adversarial review |

**Not done**: the engine, model integration, the match and spectator UI, the eval.

**Two data gaps** — MERS depends on them directly, and they gate everything:

- **R1 adjacency graph**: edges between commanderies, the terrain tier on each edge, pass attachment. Right now there are only points, no edges.
- **R2 commandery-level initial state**: yield tier 1–10, garrison tier across 13 tiers, morale tier 1–5. Right now there are only historical household figures, no game numbers.
- **R29–R31 officer stats**: 5 tiers on each of three stats, 1–2 aptitude tags, three loyalty tiers. Right now there are only historical fields.

The adversarial review listed this as fatal problem G2: "there is no commandery-level initial-state data at all, and no rule for generating it".

---

## M0 · Filling in the data

The precondition for everything. All three items must be **reproducible** — the same sources and the same rules, run by anyone, must give the same result.
Scoring by gut feel is not allowed.

### M0.1 Adjacency graph ✅ done

`tools/build-adjacency.mjs` → `lib/game/data/adjacency.json`
223 edges, average degree 4.25, a single connected component, 10/10 historical arteries passing acceptance.

Generated as a traversal graph from 105 commandery seats + 61 passes and fords.

- Delaunay triangulation gives the candidate edges (the review verified this: 305 edges, average degree 5.81, inside a reasonable range)
- Sample each edge's terrain tier from the terrain grid (plain / hills / mountain / pass / great river / marsh)
- River-crossing test: intersects a trunk channel in `hydrology.json` with no ford → impassable
- Pass attachment: whichever edge a pass or ford falls on is the edge it controls
- Prune spurious adjacencies across the sea or across the Tibetan Plateau

**Acceptance**: all ten historical arteries pass. Along the way we found that half the pairs in the first acceptance list were themselves wrong
— Jianmen is north of Guanghan Commandery, not at the gate of Shu Commandery; Ruxukou is between Jiujiang and Danyang, not Lujiang;
Guandu is at Zhongmou, west of Chenliu. The list has been corrected against the sources.

Three pitfalls hit along the way, all now written into the script's comments:
1. **River-crossing test**: if the river mouth is within 35km of an endpoint, the river runs past the city wall (the Han River skirting Nanzheng,
   the Yangtze skirting Jiangling) and is not a barrier. The first version marked all of these impassable and wrongly cut 54 edges.
2. **Pass attachment**: a 45km radius lets one pass attach in every direction (Hulao Pass was at one point attached to Henan–Shangdang,
   whereas going from Luoyang to Shangdang means crossing the Taihang via Tianjing Pass). Changed to best-match exclusive attachment, at most 2 edges per pass.
3. **Delaunay drops edges**: planar triangulation drops historically direct links because of how it picks diagonals.
   The fix is to generate edges from passes and fords in the other direction — the existence of a pass is itself proof that "there is a road here".

### M0.2 Commandery-level initial state ✅ done

`tools/build-commandery-state.mjs` → `lib/game/data/commandery-state-194.json`
5/5 spot checks passing.

**Key finding: the household figures in 《郡国志》 (the *Treatise on Commanderies and Kingdoms*) are the numbers for the fifth year of Yonghe (永和五年, 140), while the scenario is set in 194.**
In between lie the Yellow Turban rebellion (184), the Dong Zhuo disorder (190), the Qiang revolt in Liangzhou, the Qingzhou Yellow Turbans,
and Cao Cao's massacre in Xuzhou. Using the figures directly would make the Central Plains commanderies absurdly strong, when historically the opposite is true —
in this very year Cao Cao 「蝗旱大饥，仅保三城」 (locusts and drought, famine; he held only three cities).

So a war-damage attenuation coefficient is introduced, specified at both the province and the commandery level, **each one carrying its source citation**:
Sili ×0.30 (Luoyang burned, no cooking smoke within two hundred li), Yan and Xu ×0.45, Yuzhou ×0.55,
Jingzhou ×1.05, Yizhou ×1.10 (tens of thousands of households from Nanyang and the Three Adjuncts flowed into Yizhou), Jiaozhou ×1.05.
This also produces exactly the real strategic asymmetry of 194: **the Central Plains have many households but are wrecked,
Jing and Yi have fewer households but are intact and are absorbing refugees**.

**Cross-validation with no tuning** (troop strength is computed naturally as households × attenuation × 2%, not fitted):
- Liu Biao 107,189 troops ↔ 《刘表传》 (his biography): 「地方数千里，带甲十余万」 (a territory of several thousand li, a hundred thousand and more under arms)
- Yuan Shao 99,644 troops ↔ Guandu: 「简精卒十万，骑万匹」 (a hundred thousand picked infantry, ten thousand horse)

Derived from households, terrain and historical standing, with the rules hard-coded in the script and no hand-tuned values.

- Yield tier: household count + terrain yield coefficient → 1–10
- Garrison tier: the smaller of (population × 2%) and the commandery's grain ceiling → 13 tiers in a 1.4 geometric ladder
- Morale tier: whether that commandery saw fighting in 194 (inferable from `basis` and `control` in `scenario-194.json`) → 1–5
- City defence: `30 + 郡等 × 5`
- Unclaimed commanderies: garrison tier moves with yield tier (MERS R3)

**Acceptance**: Nanyang and Runan yield 8 (top tier), Henan morale 1 (Luoyang burned),
Shu Commandery yield 8 (absorbing refugees), Dunhuang yield 1, the Liangzhou commanderies yield 1–4. All pass.

**Open question**: Cao Cao starts with only Jiyin, one commandery, 6576 troops, while Lü Bu has six commanderies and 26,011 troops.
That matches history (in this year he held only Juancheng, Fan and Dong'e), but as a playable seat it is extremely harsh.
MERS scores by "the increment over the starting position", which in theory makes this fair,
but the self-play phase must watch closely for whether the Cao Cao seat is inevitably eliminated.

### M0.3 Officer stats

Derived from the historical fields by the reproducible rules in `research/OFFICER-STATS-DESIGN.md`, not by impression.

- Three stats (command / strategy / administration), 5 tiers each: derived from the `roles` tags, `prominence`, and the records of battle merit, counsel and governance in the biographies
- 1–2 aptitude tags: mountain / naval / siege / defence / civil administration / diplomacy, derived from place of origin and deeds
- Three loyalty tiers: secure / doubtful / at risk, derived from the stability of the 194 allegiance

**Acceptance**: Guan Yu and Zhang Fei must be top-tier in command; Zhuge Liang is 14 at this point and should have no stats at all (not yet in office);
Gan Ning and Sun Ce must have the naval aptitude.

### M0.4 Content pack rewritten to MERS ✅ done

`lib/game/content/pack-194.json` v0.2.0, rule summary 2189 tokens (budget 6000).

- **Everything costs 1 order**, campaigns 2. Differential pricing deleted — three independent research rounds reached the same conclusion:
  differential pricing tempts the model to compute prices rather than compute position.
- **Candidate pre-filtering**: action parameters are no longer free-form; the engine generates 5–15 concrete candidates from the preconditions
- 8 action templates: campaign / muster / govern / appoint / ally / passage / scout / retire
- Win conditions changed to the four grades A/B/C/D, with **C as the floor grade, obtainable only by attacking**,
  and D meaning 「存续本身不得分」 (mere survival scores nothing) — survival as a separate bonus is, mathematically, paying out for zero change

**Patched a hole in MERS**: R11 says appointment / reassignment / observation are free, and R12 only caps "2 orders per commandery per season".
But "scout" does not occupy a commandery slot, so a model could scout all 105 commanderies of the map in a single season.
A per-season count cap has been added (3 scouts, 5 appointments) and is enforced in the schema validator:
any action with `ap === 0` must declare `freeUses`.

---

## How complete the engine actually is (an honest inventory)

The four M2 acceptance checks pass, and what they check is **that the rule skeleton does not regress**; that conclusion holds up.
But this is a long way from "the game is finished", and none of the gaps below have been addressed.

**Fixed**
- ~~Engine constants hard-coded, content pack not read at all~~ → `lib/game/engine/params.ts`
  pulls every combat and resolution constant back into `pack-194.json`; if any one is missing, startup errors out.
  Drift-prevention tests were added too: set a threshold unreachable, zero out the troop tiers, change the match length and the wall-repair effect,
  and the engine's behaviour must follow, or the test fails.
  This was the most dangerous one — previously the model computed with the formulas in the pack while the engine resolved with a different set, and the eval would fail silently.

- ~~Officers not wired in~~ → `lib/game/engine/officers.ts`
  The wiring is **the grand administrator leads the troops**: one officer is simultaneously that commandery's commanding officer, defending officer and administrator.
  No picking a commander each time troops go out — that would make the candidate set target × troop tier × available officers,
  over a thousand entries for Yuan Shao's twenty-six officers across thirteen commanderies, violating R13 ("the model answers multiple-choice questions").
  Command feeds combat power and the defensible count, might feeds the breach count against walls, politics feeds yield, charisma feeds morale,
  and aptitudes take effect according to terrain and attack-or-defence; when the walls fall the defending officer is captured and does not appear again this match.
  Unaffiliated officers can only be recruited once you control their home commandery — take Changshan and you can use Zhao Yun.
  The availability test was lifted into the data layer (`officer-availability-194.json`), each entry carrying its source criterion:
  653 of the 808 people have no birth or death dates, and if the engine implicitly guessed "probably present",
  Ding Feng (d. 271), Dong Yun and others who were still children would turn up in 194.
  Measured: Cao Cao's mean final commandery count 1.18 → 2.73 (command 97 really does do something).

  At the same time this fixed an ordering side effect in candidate truncation: previously `totalCap` cut by alphabetical key order,
  `scout` sorts last alphabetically, and a large faction like Yuan Shao with excess candidates would **lose the entire scouting category**.
  Changed to round-robin truncation by category.

- ~~Armies were hollow, marches instantaneous, sieges had no process~~ → armies became entities
  Taking a city is no longer decided in one blow: the first season is an **assault** (losing costs 35% casualties), and if it fails it turns into a **blockade**,
  with the army staying under the walls, breaches accumulating season by season, city defence degrading season by season, and the defender losing 25% per season to severed provisions.
  Three seasons without taking it and the provisions run out, so the siege is lifted. Only now do these exist:
  **relief** (a neighbouring commandery comes to help and fights the besieging army in the field), **sallying out** (a besieged commandery fights with the city at its back —
  for a faction with only one commandery, if even this is forbidden, being besieged means certain death; Cao Cao did exactly this, breaking out at Puyang in 194),
  **besiege Wei to rescue Zhao** (take the enemy's empty ground while his army is stuck under strong walls),
  and **cutting the supply line from behind** (a besieging army whose rear corridor is cut falls apart).
  `muster` is no longer dead data either: a mustered army waits at its garrison station and marches out as a full formation on campaign.

  Three real defects were fixed along the way:
  1. **A besieged commandery kept producing and reinforcing** — the garrison healing back season by season cancelled the accumulated breaches,
     the blockade could never make progress, and "keeping up the siege" only burned the attacker's troops. Changed so that being besieged cuts production.
  2. **Candidate truncation bucketed by `action.type`** — relief and ordinary campaigns are both `campaign`,
     the `relief:` key name sorted later and was cut in whole batches; measured, not one of 530 relief candidates was ever adopted,
     which left besieged factions with no counter at all. Changed to bucket by candidate category (key prefix).
  3. **The content pack declared "the only source of randomness is the roster of unaffiliated officers recruitable at the start", and it was never implemented** —
     seed only affected a ±8% combat-power wobble, and with only four tiers of breach ladder it could hardly swing a result, so seed was a dead letter.
     Now the unaffiliated roster is drawn by seed at the proportions written in the pack: the same scenario with a different seed gives you different available talent.

- ~~Win conditions were a simplified version~~ → `lib/game/engine/victory.ts` + `province-seats-194.json`
  Changed to province-level criteria: number of provinces controlled (holding more than half the commanderies of that province), provincial seats, and whether taken from another party.
  Wiring this up immediately exposed two problems, both now fixed:
  1. **Grade C was automatically satisfied in season 1** — "commandery count not below the start" is true at the very moment of the start,
     so the floor grade was a freebie, in direct conflict with the pack's explicit 「存续本身不得分」.
     Changed to "above the start" plus "at least one commandery taken from another party": picking up unclaimed land only does not count as attacking.
  2. **Judging by absolute province count rewards the starting position** — Liu Zhang starts already holding more than half of Yizhou plus the provincial seat,
     Lü Bu starts already holding more than half of Yanzhou plus the provincial seat, and the two seats collected grade B 40/40 for free,
     16 of Lü Bu's being matches in which he was destroyed. ρ (starting commandery count ↔ score) rose to 0.89 as a result,
     closing in on the red line of "score is entirely determined by the start". After switching to **the increment over the starting position**, ρ = −0.09,
     and the turtling style scores exactly 0.

  The pass clause was also deleted from the original criteria: of the map's 227 edges only 31 contain a pass and only 15 of those cross a province border,
  while Yan, Xu, Qing, Yang and Jiao have none at all — under the original criteria the southeastern seats could not even reach the floor grade.
  Passes keep their mechanical role (defender bonus, siege engines halved, corridor cut when they change hands).

- ~~Troop types unimplemented, siege engines unobtainable~~ → `troop-types.json` + the internal-affairs policy 「治械」 (ordnance works)
  Troop type is implemented as **a property of the commandery, not changeable**, rather than "choose a troop type when recruiting": the latter would multiply
  every commandery's internal-affairs candidates by four, violating R13; the former makes troop type a reason to fight over particular commanderies —
  want cavalry and you have to take the frontier commanderies of Liang, Bing and You; want a navy and you have to take the riverside commanderies, exactly as with "recruit unaffiliated officers by place of origin".
  The production criteria each carry a historical-geographic basis: along the Yangtze, Han, Huai, Xiang and Gan, a ford or an administrative seat within the span → navy
  (the Yellow River does not count, or Luoyang would be classed as a strong naval commandery); the frontier of Liang, Bing and You → cavalry;
  more than half the roads to neighbouring commanderies being mountain defiles or passes → crossbows; everything else → infantry.
  "Span" is not plucked from the air: the median distance between adjacent commandery seats is 158km, so half of that is 79km.
  Siege engines were changed to be built up tier by tier through the internal-affairs policy 「治械」 and consumed on campaign — in the first version they were a free option at campaign time,
  handing every assault free breaches at no cost.

- Added a **situation brief**, `briefFor()`: candidate labels only talk about attack and defence against a single target, and cannot say
  "which direction is worth attacking". But the grade criteria are province-level — Lü Bu starts holding Yanzhou,
  three of Yuzhou's six commanderies are unclaimed, and taking four of them means one more province controlled and a jump to grade A; greedily hitting the nearest weakest target
  leaves him stuck at grade D forever (in self-play Lü Bu measured grade D in 39 of 40 matches).
  Without putting this layer on the table, the win conditions are invisible to the model, and the eval would be testing riddle-solving.

- ~~Epochs had no effect~~ → dual trigger advancement + unclaimed commanderies steadily hardening with the epoch
  Epochs are no longer counted by fixed season number — that way they are just a calendar, unrelated to how you play. Changed to the dual trigger written in the pack:
  6 seasons elapsed in the current epoch, or some faction reaching this epoch's target grade (epoch one → C, epoch two → B), whichever comes first.
  The effect is that unclaimed commanderies' garrisons grow each season (epoch two 8%, epoch three 15%),
  giving "take the unclaimed land early" a time value: if unclaimed land were always the same price, timing a grab would not be a decision at all,
  and the model could just max out internal affairs indefinitely before expanding.

- ~~No match interface~~ → `app/play/`
  The engine is pure functions and runs straight in the browser: the same seed and the same commands must give the same result,
  the server and the client compute the same thing, and there is no need for an extra layer of "authoritative resolution".
  Pick a seat → read the situation brief each season, tick candidates, seal the orders and resolve → bots play the other seats → battle report.
  Data comes from the 232KB slim bundle generated by `tools/build-runtime-bundle.mjs`,
  not the 3.7MB full dataset (birth-and-death-date research, renown bases and anchor comparison tables do not need to be shipped).

  The map is not "base image + little dots":
  - Territory is not baked into the base image (bake it in and it is wrong the moment fighting starts). A neutral terrain base image + `territory-grid`
    looked up cell by cell, coloured live according to that season's ownership, with the colour field soft-filled and ink lines drawn only **between different factions** —
    drawing them inside a faction too would turn it into graph paper. Each border segment is deterministically jittered by cell coordinate into an arc;
    drawing the cell edges straight gives a hard-cornered Voronoi diagram that looks computed rather than drawn.
  - Faction colours are purified: the thirty-one colours the scenario supplies are all earth tones, and multiply-blended over equally earthy terrain they are hard to tell apart.
    Pull up the saturation, pull down the lightness, leave the hue alone.
  - Cities are drawn as different cities by rank: a provincial seat is a major walled city with a banner, a large commandery gets twin gate-towers, an ordinary commandery a single wall, and an unclaimed city
    only an ink outline. Dots show neither rank nor ownership; they just mark a position.
  - Place names sit on paper tags (牌记, cartouches), with greedy collision avoidance where they crowd; province names are set as large inscriptions and yield to the commandery seats at higher zoom.
  - Wheel zoom, click-and-drag pan. A sand table of a hundred and five commanderies cannot have only one "whole thing visible" setting.

- ~~The base map was a hillshaded elevation map~~ → changed to a coloured-ink map
  Two root causes; everything else is derived from them:
  1. **Every land pixel was filled by a continuous "elevation → colour" mapping, so the reserved-white ratio was 0.**
     A nine-step green → ochre → grey-white colour ramp plus per-pixel DEM hillshading is the definition of a hypsometric tinted relief map.
     Changed to paper tone as the ground, terrain rendered in ink (wash + ridge hatching + *cun* texture strokes), colour only as an extremely faint glaze, and white left at the heights.
     Measured S 0.239 → 0.143, V 0.611 → 0.807, reserved white within ±24 of paper tone 0% → 23.4%.
  2. **All the ink was a pixel-level quantity, so the ink was noise, not brushwork.** Ridge hatching placed single points,
     ink-step jitter used `hash(x,y)`, cultivated land used `fbm(x/2.6)`, shorelines were a constant 1px — all pixel
     constants rather than PPD-relative quantities, which at 55 px/degree is salt-and-pepper noise and at 220 px/degree disappears outright
     (the same code produced 35233 ridge points vs 3830). All of it converted to PPD-derived values,
     and ridge hatching changed to short strokes running along the ridge instead of single points.

  And several more:
  - **The match base map is now rendered at PPD=220 and lanczos-downsampled to 1815**, no longer emitted directly at 55 px/degree.
    The DEM is z=9 (about 364 px/degree); at 55 px/degree it was point-sampled at 6.6×,
    and the ridges were aliased away before they ever reached the Horn operator.
  - **The sea ripples were originally bathymetric contours**: `sin(seaDist/k)` tiled over the whole sea is just the equidistance field drawn as-is,
    putting a ring of concentric circles around every reef. Changed to draw only a near-shore band, with jitter amplitude scaled by PPD and long arcs left open.
  - **The centre of gravity of the ink moved back from the southwest to the Central Plains**: measured ink coverage was 26.4% in the Hengduan–Tibetan region and 2.2% on the North China Plain,
    a factor of twelve, while all one hundred and five commanderies are in the east — the visual centre of gravity was the exact inverse of the informational one.
    Ink and *cun* strokes now attenuate by "distance to the nearest commandery seat".
  - **Hydrology changed to light-ink double lines**: ink laid along both banks of a great river, pale water colour in the channel, widening downstream by w ∝ Q^0.5.
    A bright blue hairline is the signature of a GIS vector layer.
  - The front end's `vivid()` and the territory alpha were recalibrated for the new base map: base-map lightness rose by thirty percent and territory is
    multiply-blended, so the old coefficients would overshoot into candy colours.
  - `ctx.filter` is dead code on Safari (desktop does not support it through 17.6, and 18 onward has it off by default),
    so it was changed to a JS box blur run on the 330×270 ownership raster.
  - Added the `npm run map:*` script family: before this, how `play-base.webp` got generated lived only in
    somebody's shell history.
  - Emit two base-map sizes (1815 / 3630) and switch to the high-resolution one when zoomed in. With only a single 1815,
    k=6 means interpolating it up sixfold, blurrier the further you go, when the base map has 7260 of detail available in the first place.
  - City sigils and place names attenuate by the **square root** of zoom: scaling fully with zoom makes them giant stickers,
    and keeping them screen-constant defeats "zooming in to see detail". Past 2.2× zoom, all commandery names are laid out.
  - Zoom anchors on the centre of the viewport (it used to anchor on (0,0), so every press of the plus key drifted toward the upper left);
    after picking a seat the camera drops straight onto your own administrative seat.

- ~~*Cun* strokes were isotropic stamps cropped from old paintings~~ → `tools/brush.mjs` procedural brushwork
  One stroke = a curve with a width profile + a lateral ink-density profile + *feibai* dry-brush lanes + jittered stroke edges,
  all accumulated into a Float32 optical depth field, resolved at the end by a single `alpha = 1 - exp(-kD)`.

  The reason for switching tracks is measurement, not preference:
  - **The old stamp layer was a net negative contribution**. The finished image with stamps had coherence 0.226, actually lower than
    0.259 without any *cun* at all — the radial feathering of an 84–147px disc smeared out even the directionality the base map's ink wash already had.
  - The root cause was the `energy × isotropy³` score in `extract-cun.mjs`: that term was meant to suppress
    scan striping, but in practice it is an indiscriminate penalty on directionality, filtering out every candidate whose "direction is consistent across the patch"
    and leaving the chaotic regions where directions cancel out (measured global coherence 0.02–0.09).
  - **Re-raising the stamps does not work either**: after changing the score to structure-tensor coherence, coherence rose fivefold,
    but what got selected was the running-script colophon after the scroll of 《富春山居图》 (*Dwelling in the Fuchun Mountains*) and the water ripples of 《万壑松风图》 (*Wind in the Pines Among a Myriad Valleys*) —
    you could read 「授之師」 right off the Qinling range. This is an information-level limit, not a badly tuned threshold.

  The organisation follows the rules of landscape painting: direction runs along the **fall lines** (the old code ran "along the contours",
  which draws tangled coils of rope — that is *jiesuo* / *niumao*, not *pima*); the first law of density is
  "leave the sunlit faces blank and texture the shaded ones", and only the second law is a gradual thickening from top to bottom; strokes go down in clusters rather than scattered evenly;
  not a single stroke on the flat fields, the valley floors or the foot of the mountain, and further structural white is carved out inside the mountains. *Cun* types are assigned by the nature of the massif:
  high, steep rock mountains get *fupi* (axe-cut), earth mountains get *pima* (hemp-fibre), dense mid-height ranges get *yudian* (raindrop).

  The lower bound on stroke width is set by the downsampling: `WBASE = max(4.1px, P(0.0186))`, since anything below 4px does not survive
  play-base's 4:1 lanczos. Measured 18499 strokes for the whole map.

- Fixed one self-inflicted blemish along the way: adding jitter to 「墨分五色」 (ink in five shades) used
  `hash((x/P(0.03))|0, …)`, and **truncating the coordinate to an integer means one constant every 6.6px**,
  pressing blocky grey patches across the whole map. Switching to smooth noise then turned it into camouflage — tiering on a continuous field inevitably presses out hard edges.
  Finally the concept came clear: 「墨分五色」 refers to the tonal layering of several passes of ink, which is a matter of **the brush**;
  the ink wash should be continuous, and the tiering should be left to the several passes of the *cun* layer.

### M3 · Models take the field (the pipeline is through; only the key is missing)

`lib/arena/` is complete and **can be verified without an API key** — the whole pipeline apart from the model wiring
has to run on its own first, otherwise once the key arrives everything gets debugged together and you cannot tell a model problem from a pipeline problem.

| Piece | What it does |
| --- | --- |
| `lib/game/engine/observe.ts` | Everything a given seat can see this season. Never contains the seed (roll is a pure function; with the seed you could invert the intelligence bias and recover the true values); does not stuff in GameState (by season 8 it is a hundred thousand characters); built only from a whitelist |
| `lib/game/engine/forecast.ts` | Siege forecast: uses only observed quantities to compute "breaches N–M against defensible P–Q → falls / does not fall / unknown" |
| `lib/arena/seat/admit.ts` | Admission. Illegal output is **discarded entry by entry** rather than voiding the whole turn — the latter would wipe out every judgement that season because of one bad key, and the eval would get no signal |
| `lib/arena/seat/parse.ts` | One string of candidate keys per season. Keys are enums, not indices |
| `lib/arena/seat/prompt.ts` | Static prefix (rule summary, byte-stable and cacheable) + this season's observation |
| `lib/arena/seat/stub-seat.ts` | Three deterministic stubs: random-legal / idle / chaos |
| `lib/arena/llm/client.ts` | OpenRouter, plain fetch. Falls back to free text where structured output is unsupported |
| `tools/eval-run.mjs` | `npm run eval`. Seat rotation, illegal rate, observation peak, tokens and cache hits |
| `tools/obs-budget.mjs` | `npm run obs:budget`. Runs a real match to measure observation size, and scans for seed leakage |

**To run a real model, the user has to add the key themselves** (I do not handle credentials):

```bash
echo 'OPENROUTER_API_KEY=你的key' >> .env.local
npm run eval -- --agent=model --model=<模型 id> --games=1
```

Without a key, `npm run eval -- --agent=stub --games=6` runs the whole pipeline through.

**Everything fixed this round was a hole of the form "the rules say it but the engine did not do it, or did it backwards":**
- The candidate labels' "ratio X" had **no relation** to the quantity the engine judges battles by (measured: ratio 4.35 failed to take a city, ratio 2.26 broke one)
- Allies were always given true values, and forming an alliance did not require the other side's consent — 1 order buys out every real number along a neighbour's border
- Siege labels gave a third-party army's exact troop strength while, in the same sentence, the garrison was still marked "unscouted"
- Order-budget carryover (R9) was never implemented, `carried` had no writer anywhere in the project, while the summary said "carryover ≤2"
- The content pack declared 4 internal-affairs policies and the engine had 5 — the summary never told the model that 「治械」 exists,
  and siege engines are the only source of assault breaches
- The rule summary dumped the design notes to the model as well ("differential pricing tempts the model to compute prices rather than compute position"),
  which is teaching it how to think and would contaminate the eval

**Not done**

## M1 · Engine core

Pure functions, no UI, test-driven.

```
observe(state, factionId)      → 分层观测，硬 token 预算
listActions(state, factionId)  → 预筛后的具体候选，5–15 条
validate(state, action)        → 合法性校验
resolve(state, orders[])       → 确定性同时裁决
```

(Gloss of the block above: layered observation under a hard token budget; concrete pre-filtered candidates, 5–15 of them; legality checking; deterministic simultaneous resolution.)

- **Deterministic randomness**: derived from `H(seed, 年, 季, 势力, 事件类, 序号)`, independent of resolution order, bit-for-bit replayable (R33)
- **Field battle**: effective combat-power ratio → rout in one clash / two clashes / stalemate (R21–22)
- **Siege**: breach count vs defensible count (R23–27)
- **Supply**: compute connected components at the end of each season; anything unreachable has its yield zeroed and its army disperses next season (R28)
- **Win conditions**: scored by the highest grade reached at any point during the match (R39–43)

**Acceptance**: `resolve` is bit-for-bit replayable for the same seed and the same command set;
shuffling the resolution order does not change the result (this is a hard requirement of R6).

---

## M2 · Self-play validation ✅ done

`lib/game/engine/bot.ts` + `tools/selfplay.mjs` (`npm run selfplay`)
All four acceptance checks pass, and the criteria have been frozen into the regression test `tests/selfplay.test.mjs`.

**Measured results (60 matches, seats rotated across four profiles)**

| Profile | Mean score | Territory multiple | Elimination rate |
| --- | --- | --- | --- |
| balanced | 213 | 1.71 | 0% |
| opportunist | 200 | 2.14 | 0% |
| aggressive | 188 | 1.28 | 20% |
| **turtle** | **83** | 0.95 | 0% |

The turtling style has the lowest elimination rate and the worst score — "mere survival scores nothing" really does hold numerically.

**Starting commandery count ↔ actual score, Spearman ρ = −0.09**. This is the most important item:
score is independent of starting national strength. Liu Biao's seven commanderies average 250, Yuan Shao's thirteen only 187,
Liu Zhang's nine come last at 75 (Yizhou is walled in by the Qinling and the Daba mountains and cannot expand).

**A real bug fixed along the way**: `城防` (city defence) was not participating in the defender's calculation at all;
`hold` looked only at garrison count, the 30–100 city-defence values counted for nothing, and the "repair walls" internal-affairs policy was useless.
The consequence was that taking cities was trivial — the first measured round had 17 commanderies change hands in season 1, 96% of them taken between factions.
After folding city defence in: changes of hands per match 136 → 77, Cao Cao's elimination rate 53% → 1.7%.

**The doubt about the Cao Cao seat is resolved**: starting with one commandery and six thousand troops, he is eliminated 1 time in 60 matches
and reaches grade A 14 times. Building a hegemony from a single commandery is exactly what that seat should look like.

**Balance issues to watch** (non-blocking, to be rechecked when models play):
- Liu Biao takes grade A in 45/60 matches; Jingzhou is rich and has no strong neighbour, so that seat is on the easy side
- Liu Zhang's mean of 75 is last; Yizhou being closed off caps his increment, so that seat is on the hard side

Write a deterministic rule-based AI, let it play itself, run 100 matches.

**This step exists to find the diseases of the gameplay itself before any model is wired in**. Using real data, the review computed that the first-round design would produce
"six factions none of whom can take anyone's cities" — that kind of problem has to surface in self-play, not when you are already paying for model calls.

**Acceptance**:
- No map freeze (at least N changes of commandery ownership per match)
- No turtling optimum (a pure-defence strategy scores significantly below an attacking one)
- Match length stable at 16 seasons
- The win distribution is not the same as the ranking of starting national strength

---

## M3 · Model integration

- OpenRouter adapter: `observe` → prompt, model output → `validate`
- The rule summary goes through the KV cache and is not resent each season (R37)
- **Measure tokens for real**: the review found the first-round design underestimated them by 1.7–3×, so this has to be measured, not estimated
- First a single model vs the rule AI; once that works, add multiple models

**Acceptance**: observation ≤4000 tokens (the budget in MERS R34); illegal-action rate measurable; per-match cost accountable.

---

## M4 · Spectating and review

- Overlay match state on the map: faction territory changing with conquest, army positions, supply lines
- Timeline: the four phases of each season — observation / decision / validation / resolution — replayable
- Itemised attribution in the battle report (R38): how much each stat, each aptitude and each terrain contributed

---

## M5 · Eval

- Multi-model matches, seat rotation, TrueSkill, median over multiple matches
- Process metrics: invalid-action rate, supply-break count, alliance-betrayal rate, timing of retirement
- Calling "retire" is itself recorded as a metric (R20) — when to concede is a measurable kind of judgement

---

## Order and dependencies

```
M0.1 邻接图 ─┐
M0.2 郡级状态├→ M0.4 内容包 → M1 引擎 → M2 自对局 → M3 模型接入 → M4 观战 → M5 评测
M0.3 武将数值┘
```

The three M0 items are independent of each other and can run in parallel. M2 is the critical gate: **if self-play does not produce a healthy win distribution,
do not go further** — if the gameplay's diseases are not cured at this step, every later step is piling onto a broken foundation.

## Not doing

- Individual officer growth, tech trees, duels, unit micro-management
- ~~The legitimacy line (Son of Heaven / noble titles)~~ → **done, but only half of it**: granting office (provincial governor) went into the engine,
  while titles and court posts did not. The half that was done is the only half that hangs off the **scoring function** — the grades judge the increment in provinces
  and commanderies controlled, and the title of provincial governor directly changes who the unclaimed commanderies in a province belong to. Titles, court posts and the Nine Bestowments
  add numbers to prestige, which puts them in the same "multiply by a coefficient" class as tech trees and trade; measured four times, all of them came out flat, so they are not being done.
  See `constants.名器` in the engine and `invest` in actions
- Building slots inside cities → **done** (three per commandery; iron office / salt works / horse pasture / tuntian military farms require that commandery to have the resource).
  What differs from the original intent is that no artwork is being done: get the mechanism standing first, the look is a reskin
- Battle-technique chains: the schema keeps the two fields `precondition`/`effect` right now, implementation deferred

<!-- translated-from: PLAN.md@c551e96fe0b9 -->
