[中文](GAMEPLAY-DESIGN-V2-DELTA.md) · [English](GAMEPLAY-DESIGN-V2-DELTA.en.md)

# Gameplay Design V2, Incremental Revision: Round Two's Six Scans × Reconciling Round One's Conclusions

Written: 2026-08-31
Nature: **incremental revision proposals, not a rewrite.** `GAMEPLAY-DESIGN.md` is still the baseline; this document only writes down "what to change, what to change it to, and why".

**Inputs**
- This round's six: `GAMEPLAY-KOEI-WIDE.md` · `GAMEPLAY-CN-INDIE.md` · `GAMEPLAY-MOD-ECOSYSTEM.md` · `GAMEPLAY-WESTERN-ANALOG.md` · `GAMEPLAY-MINIMALISM.md` · `GAMEPLAY-SLG-MOBILE.md` *(all under `docs/research/`, Chinese)*
- Round one: `GAMEPLAY-DESIGN.md` (the design) · `GAMEPLAY-REVIEW.md` (adversarial review, which ruled 7 fatal problems: B1 C1 C2 E1 F2 G2 G7) *(Chinese)*

**Tag system (consistent throughout)**

| Tag | Meaning |
| --- | --- |
| **[MUST CHANGE]** | Without the change, even a running M1 measures nothing, or the rules contradict themselves so badly they cannot be implemented |
| **[RECOMMENDED]** | Noticeably improves discrimination or cost, but does not block getting it running |
| **[OVERTURNED]** | Directly conflicts with an explicit round-one conclusion; that round-one item has to be voided |
| **[UNCERTAIN]** | This round's evidence is not enough to decide; flagged explicitly rather than forcing a conclusion |

**One-sentence summary**

> Round one's **skeleton** (WEGO, the intent layer, the two-level xun (旬, a ten-day period) / season clock, layered observation, deterministic resolution) **all holds up** under cross-checking against this round's six scans; not one item needs overturning.
> But round one's **three "knob-style" designs** (differential SP pricing, public outrage (众怒), composite-score weighting) were each independently falsified this round, from three different tracks;
> and this round's most important methodological gain is a sentence that can be used directly as a design rule:
> **Any mechanism that prevents degeneracy by "bolting on a penalty term after the fact" can be routed around; anti-degeneracy has to be written into the payoff structure.**

---

## 0. How to read this document

### 0.1 The criteria have not changed

Everything still obeys the six hard constraints (hereafter C1–C6); every rating in this document is checked against them:

```
C1 Decisions must be high-level strategy, not micromanagement
C2 State must be serializable; observation ≤ 6000 tokens
C3 Decision frequency decoupled from call cost
C4 The legal action set is enumerable, O(10)–O(10²)
C5 Stronger reasoning must reliably convert into better results
C6 One match is bounded (~15 years / 60 seasons / ~15 full decisions per side)
```

### 0.2 This document's relation to the previous two

| Document | Status | How this document treats it |
| --- | --- | --- |
| `GAMEPLAY-DESIGN.md` | Baseline design | Patches given section by section; not restated |
| `GAMEPLAY-REVIEW.md` | The 7 fatal + 13 serious problems already ruled | **The review's rulings are assumed to stand.** This document only writes an item where it can give a solution **better than the review's own**; where it cannot, it says so plainly |
| This round's six | Evidence base | Each mechanism is tagged with the specific work/system, distinguishing history / romance fiction / that game's own invention |

### 0.3 One methodology running through this document

The rule given in `GAMEPLAY-MINIMALISM.md` §9.1 is the only blade this document cuts with:

> **If a new rule cannot change the optimal use of at least two existing rules, it only adds complexity, not depth. Delete it.**

Among the seven matching inverse conditions (R1–R7, same document §9.2), the round-one design is already caught three times:
R1 (a price table creates a dominant strategy), R2+R3 (`C(98,5)` is not evidence of depth), R7 (an over-budget observation crowds out attention from the effective rules).
Details in §4 of this document.

---

## 1. This round's new findings: mechanisms round one did not consider at all

Screening rule: something counts as a "new finding" only if **no comparable concept can be found in round one's four research documents (RTK-SERIES / OTHER-SANGUO / AI-FRIENDLY / DESIGN)**.
"Mentioned but not developed" does not count; "the same thing under a different name" does not count.

Ordered by value to this project, 14 items. Each gives: mechanism → source → **why round one missed it** → value to this project, plus a rating.

---

### N1 ★★★★★ [MUST CHANGE] Key-derived random streams, replacing a single global random sequence

**Mechanism**: no random check ever "draws" from a global sequence; instead it hashes its own stream out of a deterministic key:

```
draw = H(match_seed, year, season, faction_id, event_kind, event_seq)
```

**Source**: `GAMEPLAY-MOD-ECOSYSTEM.md` §2.7 / M18.
Community reverse-engineering notes on *Romance of the Three Kingdoms XI* (三国志 11) reconstruct a game with only two random primitives in total, sharing a single LCG,
where `random_value` is a **global variable** — every faction and every event in the whole match shares one sequence.
Derived conclusions: the sequence is fixed in advance; every check advances it by one slot, no matter who initiated it; commands that consume no action points, such as 评定 (appraisal), **also** advance the pointer,
so players use repeated appraisals to "wash" the random numbers.
⚠ That reverse-engineering is community material, not official KOEI information; what this document cites is the file content itself, and the decompilation has not been independently reproduced.

**Why round one missed it**: all four round-one research documents stop at the **rules layer**; not one touches the **implementation layer**.
`GAMEPLAY-DESIGN.md` §9.4 has a handsome "randomness placement table" (which steps are allowed to be random),
but **never specifies how random numbers are generated**. That is a pure engineering-layer spec gap, and rules-layer research cannot see it.

**Value to this project**: this is a **precondition for WEGO deserving the name**, not an optimization.

- A single global stream = **the resolution order secretly hands out luck**. Whoever the solver happens to traverse first eats that number in the sequence. This advantage has nothing at all to do with decision quality.
- It is especially fatal for "simultaneous sealed orders + simultaneous resolution": the solver must have some internal traversal order, and that order quietly decides who gets lucky.
- Refactor the loop order once and match outcomes change — **replays no longer line up, and reproducibility is out of the question**.
- It also incidentally closes a retry loophole on the model side: random numbers must be key-derived **at resolution time**, not drawn **at request time**, otherwise a retry caused by one network hiccup is a free re-roll of the dice.
- "Washing random numbers with appraisals" is a precise warning: **any free, apparently read-only action becomes a strategy channel the moment it touches the random stream**. So observation and scouting actions have to be strictly side-effect-free. LLMs are perfectly capable of discovering channels like this — that is exactly what they do.

**Landing it**: write it into the spec of `lib/game/engine/`, nailed down at the M0 stage, not later. Against C5 (✓✓✓) and C6 (✓✓ reproducible).

---

### N2 ★★★★★ [MUST CHANGE] Final standings by absolute thresholds + a quota + a floor grade that requires attacking + scored by best-ever grade

**Mechanism** (four properties, none optional):

| Property | Content | Degeneracy it kills |
| --- | --- | --- |
| Q1 | **Absolute thresholds, not ranking**. "Control ≥3 provinces" is a bar, not "more than second place" | Dogpiling the leader (knocking him down does not increase your province count) |
| Q2 | **Multiple grades, multiple winners**. One match can have several Grade A factions at once | Dogpiling (with non-conflicting goals there is no reason to gang up) |
| Q3 | **The quota is allocable by negotiation** (through one enumerable treaty clause) | Zero-sum framing (replaces "destroy the opponent" with "split the pie") |
| Q4 | **There is a floor grade, and the floor grade requires attacking** (clear a chain of passes, not "lost no territory") | Everybody turtling + giving up early |
| Q5 | **Scored by the highest grade reached at any point this match**, not by the instant of final resolution | Everybody shelling up in the last 4 seasons to protect their score |

**Source**: `GAMEPLAY-SLG-MOBILE.md` §3.1 / §3.5, from the Hegemony / Separatist / Veteran quotas of *Three Kingdoms: Strategy Edition* (三国志·战略版, hereafter SGZ:SE) (S1 rules + the 2025 quota pool) and the "highest grade ever reached" criterion in *Infinite Borders* (率土之滨) season appraisal.
⚠ Both scraping attempts on the official *Infinite Borders* 2023-06 season appraisal page returned garbled text, so the specific grade table is **not accepted**; this document only uses the "best-ever" structure.

**Why round one missed it**: round one's `GAMEPLAY-OTHER-SANGUO.md` §3 covered *Infinite Borders* and SGZ:SE, but it looked at the **gameplay layer** (land tiers, alliances, seasons),
not specifically at the **objective function and scoring table**. And the objective function is precisely the layer this track has ground hardest over ten years of live operation.
Round one's composite score (`0.45×PI + 0.15×prestige + 0.15×survival + 0.25×private objectives`)
is structurally **the honor-point system of *Rise of Kingdoms* (万国觉醒) KVK** — and `GAMEPLAY-SLG-MOBILE.md` §3.4 points out
that this is the one title on that same track that players universally regard as having the weakest competitive ecology.

**Value to this project**: this is the **root cure** for the review's [C2 fatal], and more thorough than the fix the review gave itself (adjust the weights + multiply a destroyed faction by 0.5).

The key difference is one sentence:

> Round one: "lose land, lose points" → the optimal strategy is **not to take risks**.
> This track: "losing land costs no points, but not fighting earns none" → the optimal strategy is **to fight where you can win**.
> The punishment is **opportunity cost**, not **a direct deduction**.

The marginal exchange rates the review computed (for the Yuan Shao (袁绍) seat, the cost of losing land is 7.3× the gain from taking land; for the Cao Cao (曹操) seat, 26×)
become 0 / positive infinity under these criteria — losing land earns no points at all, it just puts the bar out of reach.

**Landing it**: replace `GAMEPLAY-DESIGN.md` §9.1 (composite score) and §9.2 (Hegemony grades). The concrete shape is in the one-page rule set in §5 of this document.

**A verification that has to be done at the same time** [MUST CHANGE]: verify the thresholds against the actual 194 CE data, with the **requirement that nobody meets a grade at the start**.
The review's §3.3 computed that Yuan Shao is at second-class Hegemony from turn one, and Liu Bei (刘备) / Lü Bu (吕布) / Liu Biao (刘表) at third-class from turn one.
`GAMEPLAY-SLG-MOBILE.md` §6.5(c) adds a warning specific to this project:
***Infinite Borders*-like games start from a random allocation; this project starts from a fixed 194 scenario, so there is no "play a few more matches and average out the opening differences" safety net.**
Get the thresholds wrong and every single match is wrong.

---

### N3 ★★★★★ [MUST CHANGE] Role branching: Retirement (归隐, voluntary exit) and Exile (流亡, losing all land without elimination)

**Mechanism**: a seat can occupy three roles during a match, each with its own objective function:

```
                           Can expand   Has yield   Eligible for grades   Can be destroyed
  Warlord (normal)            yes         yes            yes                   yes
  Exile (beaten out)          no          no          Grade D only       no (no land left to lose)
  Retired (voluntary exit)    no        yes (high)    Grade D only       no (cannot be attacked)
```

**Source**: `GAMEPLAY-SLG-MOBILE.md` §6.4.
- Retirement ← the "Peach Blossom Army" (桃源军) in the 2024 annual version of *Infinite Borders*: converting requires clearing all your territory, is **irreversible for the season**, forbids contiguous land, but lets you do things warlords cannot (share a tile with someone else, raise a tile's level by 1).
- Exile ← the "Wandering Army" (流浪军) from *Infinite Borders* S2 onward: cities / fortresses / territory / alliance are cleared, but **facilities and tech levels are kept** (so combat power survives); territory produces nothing; it lives off "plunder" (which requires contiguous land) and "seizure" (3 edicts, no contiguity requirement); wandering armies cannot attack each other and can lend each other land.
  ⚠ The wandering-army rules come from secondhand strategy-guide accounts; the official page was not fully retrieved this round.

**Why round one missed it**: round one treated both "turtling to stay alive" and "being eliminated" as **failure modes to be stamped out**,
so the whole design has only one state, "warlord", and every abnormal state is forced into the same composite score for expression.
Round one never considered the third path: **give them a formal identity.**

**Value to this project**: two things, pointing in opposite directions, both large.

**(i) Retirement turns turtling from a hidden strategy into an observable signal.**
For **an arena whose purpose is comparing models**, this is a critical step:

> "Making degenerate behavior observable" and "eliminating degenerate behavior" are equally important goals, and sometimes the former matters more — **because it turns noise into signal**.

`withdraw` being called = that model publicly gave up the game in season k. That is a clean, countable behavioral metric,
far better than reverse-engineering "is it turtling?" out of a composite score.

**(ii) Exile strikes at the psychological root of turtling.**
The argument in `GAMEPLAY-SLG-MOBILE.md` §6.4.2 is worth keeping verbatim:

> A rational model, choosing between "don't fight = a safe Grade D" and "fight = some chance of Grade A, some chance of elimination (no score and no further calls)",
> will lean toward not fighting if elimination means **total zeroing plus the loss of every subsequent decision**. **This is not the model being stupid; this is the payoff structure.**

Plus one arena-specific reason, stronger than it is for a mobile game:
**if a model that gets beaten out is simply eliminated, we lose every decision sample it would have produced under adversity — and decisions under adversity are exactly the most discriminating samples.**

**Landing it**: `withdraw` is one action + one state flag + a special case at resolution; the cost is minimal, **do it in M1**.
The full exile state (raid / plunder / resettle, three actions) is medium cost; **M1 does only the half that says "losing all land does not mean elimination; you become a yield-less exile"**, and the plunder actions are pushed to M2.

---

### N4 ★★★★★ [MUST CHANGE] `muster`: draw from several commanderies + a mustering window + allies may join

**Mechanism**:

```
action: muster
  at:        muster point (own commandery, or own forward outpost)
  from:      [commandery, strength tier] × 2–5 sources, allies allowed (requires stance=ally)
  commander: lead officer
  deadline:  season k+1 or k+2
  cost: 1 SP (initiator) + 0.5 SP (per non-own source, paid by that faction)
  resolution: sources arrive one by one according to travel time; on the deadline season they
              merge into one army; whatever has not arrived returns to its home commandery
              the muster point can be attacked while mustering; if it falls, the whole muster fails
```

**Source**: `GAMEPLAY-SLG-MOBILE.md` §4.5, from SGZ:SE's "Grand Administrator + muster":
each commandery city can appoint one Grand Administrator; allies send troops into that city, and the Administrator commands them as one force.
The matching siege rules are "last hit" (whoever lands the final blow on a city's durability takes it) and "if the garrison is wiped out but the city is not taken within 1 hour, it recovers".

**Why round one missed it**: round one's `campaign` took its four `strength` tiers from **the garrison of the starting stronghold**,
an assumption inherited from the mainline KOEI games that looks self-evident —
`GAMEPLAY-WESTERN-ANALOG.md` §10.2 states plainly that this is **this project's own design choice**:
Western grand strategy generally **does not tie force size to the garrison of the departure point** (units exist independently on the map; the cost of concentrating them is march time and action budget),
so the Western track offers no counterpart. **Only the *Infinite Borders*-like track provides a ready-made shape for "several parties send troops into one point, one person commands them".**

**Value to this project**: this is the direct cure for **cause one** of the review's [C1 fatal] (army size capped at a single commandery's garrison, so Yuan Shao can commit only 12% of his national strength at a time),
and it is **clearly better** than the review's own suggestion (add a `muster: CommanderyId[] ≤3` parameter to `campaign`), because:

> Made into its own action, mustering becomes a game move that **reveals intent, can be reacted to, and can be interrupted**;
> made into a hidden parameter of `campaign`, it is just a silent addition.

Against the constraints one by one: C1 ✓ (you only say where to draw from, where to gather, and who leads — not the route or the formation);
C4 ✓ (the source set is limited to "own + allied commanderies within ≤N of the muster point", usually choosing 2–5 of 3–8, so the combination count stays inside O(10²));
C5 ✓✓ (**pure reasoning: do I hollow out my rear in order to attack you? and if you see it, will you go hit my rear?** zero randomness);
C6 ✓ (breaks the deadlock → commanderies start changing hands → the "8 consecutive seasons with no change" stalemate stops firing).

It also fixes three things at once: concentration of force, "the alliance has no concrete content to cooperate on", and "an ally relationship has no verifiable behavior"
(**sending troops to a muster is observable proof of loyalty**).

---

### N5 ★★★★★ [MUST CHANGE] Majority-rule regional control: control(province) = holding the most directly-held commanderies in that province

**Mechanism**:

```
control(province) = the faction with the most directly-held commanderies in that province
                    (a tie means nobody controls it)
adjacency advance: you may only launch a campaign into commanderies in provinces adjacent to S
                   if you control province S
                   (a province where you already hold a commandery counts as having a foothold
                    and is exempt from this restriction)
```

(The Chinese writes this predicate `控制(州)`; it is written `control(province)` throughout here.)

**Source**: `GAMEPLAY-SLG-MOBILE.md` §4.8, abstracted from the region / stronghold structure of *Civilization and Conquest* (文明与征服).
⚠ "680 regions / 5 strongholds per region" comes from two secondhand strategy guides that agree with each other but are both unofficial; this document uses only the **structure** of majority-rule control and does not depend on those two numbers.

**Why round one missed it**: round one's final-standing criterion used "control **more than half** the commanderies in ≥N provinces",
which is already close to majority rule, but round one **only used it for the final standings** and never realized the same predicate can carry three jobs at once.

**Value to this project**: it dismantles the siege deadlock from the **criteria side**, complementing N4 (the supply side) —
**muster lets you attack at all; majority rule means you do not have to finish the job.**

Four benefits:

| # | Benefit | Maps to |
| --- | --- | --- |
| 1 | Advancing does not require annihilation. Take more than half a province and you can push outward without rooting out every commandery | Review [C1], criteria side |
| 2 | Changes of hands are reversible. One extra commandery lets the opponent take provincial control back, so the defender always has a cheap counter | Weakens snowballing |
| 3 | The strategic focus is a single integer. "In Jizhou it's me 6 : you 5, one more flips it" — every seat can compute it | C2 (about 15 tokens per province line), C5 |
| 4 | Fully deterministic, resolved by a single count | C5 |

**The key engineering benefit**: unifying final-standing grades, adjacency advance and the observation summary onto **one single `control(province)` predicate** is pure gain.
This project's geographic hierarchy is already there — the 105 commanderies of `commanderies.json` naturally belong to the thirteen provinces, so the rule lands without changing a character.

---

### N6 ★★★★★ [RECOMMENDED] Anonymized mode: hide names and stats, and let the A/B score gap quantify "how much the model leans on memory"

**Mechanism**: run the same batch of models through two modes.
- **Mode A (historical)**: officer names and attributes fully public. This measures a blend of "memory + reasoning".
- **Mode B (anonymized)**: officers get only an ID and **observable clues** (place of origin, background, performance in past postings, others' assessments); names and stats are hidden. This measures pure reasoning.
- **The gap between A and B is itself an evaluation metric.**

**Source**: `GAMEPLAY-CN-INDIE.md` §7.3, *Three Kingdoms: Alias* (隐名三国, Plotrick, a Korean team, released on Steam 2026-07-14, 351 reviews / 80.9% positive).
⚠ Explicitly not a Chinese-language title; it is included because the mechanism bears directly on "using a game to measure reasoning ability".

**Why round one missed it**: round one **does** have a de-Three-Kingdoms control group (`GAMEPLAY-DESIGN.md` §8.8), but it is just an `id → display name` mapping layer — **it only changes names**.
Review G7 already pointed out that this approach misses the death-year table:
"a model that has read the *Records of the Three Kingdoms* (三国志) knows what year its own chief strategist will die and what year the opposing ruler will die; that is pure memory advantage, and the entire point of §8.8 is to measure it and cancel it out."
**Three Kingdoms: Alias gives the complete version**: not just renaming, but hiding the stats too, leaving only observable clues.

**Value to this project**: of everything this round, this contributes most to the **project's positioning** (not just to gameplay).

One of this project's biggest risks: every mainstream LLM knows that Zhuge Liang has high intelligence, that Lü Bu has high might, and that Xun Yu is Cao Cao's chief strategist. Which means
① a large part of "decision quality" is actually memory retrieval;
② the score gaps between models may come mainly from "who remembers more accurately";
③ this conflicts directly with the positioning of "testing and comparing different large language models".

**Landing it**: leave the interface in at M0 (round one already wrote "leave the interface in at M0" — the direction is right, only the interface spec needs widening).
Actually running mode B is pushed to M4, but **the interface must be designed from the start for "hide the stats", not for "change the names"** — the two have different observation schemas.

---

### N7 ★★★★☆ [RECOMMENDED] A proposal channel: the engine generates candidate actions, the model only picks

**Mechanism**: the engine pre-filters 5–15 "proposals" by deterministic rules, **with no scores and no ranking**, and the model chooses which to adopt.

**Source**: three independent appearances, which is itself evidence.
- `GAMEPLAY-KOEI-WIDE.md` §7.2: the **council** (评定) in *Nobunaga's Ambition: Taishi* (信长之野望·大志) — four times a year (months 1/4/7/10), soliciting opinions from retainer officers, **adopting at most 3 officers' opinions**; adopting one grants "policy power" of the corresponding type, which then buys policy measures whose effects are **mostly permanent**. The daimyō's "Ambition" (志) determines which measures are available.
- Same document §5: officer proposals in *Dynasty Warriors: Empires* (真·三国无双 Empires).
- `GAMEPLAY-WESTERN-ANALOG.md` §4.2: the **proposal** (具申) system in *Nobunaga's Ambition: Awakening* (信长之野望·新生) (retainers propose on their own initiative).

**Why round one missed it**: round one's action protocol is "the engine enumerates `legalActions[]`, the model returns an index" —
the direction is right, but what it enumerates is **every legal action** (the review measured 62–195 entries at the first level),
not **a handful of meaningful candidates**. The two differ by an order of magnitude.
Round one read "enumeration" as a completeness problem; Taishi reads it as a **candidate generation** problem.

**Value to this project**:
- C4 ✓✓: **illegal actions are eliminated at the root** — the model is always answering a multiple-choice question.
- C2 ✓✓: `legalActions` is the largest single block in the review's recount (6,324 tokens at the start, 8,160 mid-game, 60% of the total). Pre-filtered to 5–15 entries, this block drops from 3,000+ to a few hundred.
- C5 ✓: `GAMEPLAY-WESTERN-ANALOG.md` §10.3 P0-2 stresses **"no scores, no ranking"** — the moment you add a ranking, the engine is making the decision for the model and the delegation headroom is eaten up.

**One accompanying mechanism with high standalone value**: Taishi's **"reconsider" (再考)** — if you are unhappy you may re-roll the candidate set, but **the policy power you get after reconsidering is smaller**.
`GAMEPLAY-KOEI-WIDE.md` §7.2 translates this as a "**re-reasoning budget**":
the model may declare that it is unsatisfied with the current candidate set and demand a regeneration, at a price.
**Knowing when you ought to think again is part of reasoning ability**, and it is a measurable metacognitive decision that almost no other game offers. ★★★★★, implementation cost near zero.

---

### N8 ★★★★☆ [RECOMMENDED] Direct-rule radius: make the observation layering part of the rules, not a bolted-on truncation

**Mechanism** (*Nobunaga's Ambition: Sphere of Influence* (信长之野望·创造), 2013):
- Define a faction's "direct-rule radius" (graph distance from its home base)
- **Commanderies inside the radius** → full fields in the observation
- **Commanderies outside the radius** → must be delegated to an army, and the observation gives only a one-line army summary (total troops / provisions / directive / current objective / loyalty warning)
- **Moving the capital can change the radius coverage**, and is therefore a genuine strategic decision

**Source**: `GAMEPLAY-KOEI-WIDE.md` §7.1 / §9.3.
The same idea reappears in *Nobunaga's Ambition: Awakening* as "chigyō" (知行) (two-level grants at the commandery/castle level + limits on an army commander's governing range) (same document §7.3).

**Why round one missed it**: round one's layered observation is **cut against the token budget** (`GAMEPLAY-DESIGN.md` §8.5 has a degradation-order table: first cut known officers, then …).
That is a harness-layer technique; the model can neither understand it nor plan around it. Round one never considered letting **the rules themselves** produce the layering.

**Value to this project**: this is a change of kind, not of degree.

> **Token compression becomes part of the rules, and observation size converges as territory grows instead of diverging.**
> And **the model can understand why it cannot see clearly**, instead of feeling that the system is hiding things from it.

The evaluation significance is even greater: information loss caused by bolted-on truncation **cannot be attributed** (the model did badly — is it stupid, or did we cut away what it needed?);
information loss caused by in-rule delegation **can be planned around by the model** (it can choose to move the capital, it can choose to shorten its front).
This bears directly on whether the review's [B1 fatal] can be solved cleanly.

A ★★★★★ companion: the **checkbox authorization list** in the PK edition of *Nobunaga's Ambition: Taishi* (commerce / agriculture / trade / development / recruitment / assignment + the council, each separately checkable).
The judgment in `GAMEPLAY-KOEI-WIDE.md` §9.8 deserves quoting verbatim:
**"Whether you delegate correctly is part of reasoning ability."** It recommends listing "soundness of the delegation configuration" as its own evaluation metric.

---

### N9 ★★★★★ [MUST CHANGE] Hard alliance expiry: price permanent coalitions, not temporary ones

**Mechanism**:

```
a stance = ally relationship carries an expiry (agreed at signing, at most N seasons, N = 8 suggested)
on expiry it automatically falls back to neutral, with no action required from either side
and no betrayal penalty
renewal: both sides pay 1 SP to re-sign; takes effect one season later, visible to every seat
hostile has no expiry (hostility is the default state and needs no upkeep)
```

**Source**: `GAMEPLAY-SLG-MOBILE.md` §4.9, abstracted from the squads in *Infinite Lagrange* (无尽的拉格朗日) — cross-organization teams that share vision and can reinforce each other, but that **disband automatically at the end of the season**.

**Why round one missed it**: round one's alliances have an `untilCouncil` expiry turn (§7.2), but **renewal is free**,
and round one's whole anti-dogpiling idea rests on the single knob of public outrage (§3.7, verbatim: "the only anti-snowball knob").
Round one never considered that **alliance itself can have an upkeep cost**.

**Value to this project**: it says something counterintuitive —

> **To prevent long-term dogpiling, you should not ban alliances; you should give alliances an expiry date.**

Banning alliances deletes the entire diplomacy layer of the game (and diplomacy is one of the abilities we most want to measure). An expiry date keeps all the gameplay and only changes the price curve:

| | No expiry (round one) | With expiry |
| --- | --- | --- |
| Temporary coalition (fight one war) | cheap | **equally cheap** |
| Permanent coalition (long-term suppression of the leader) | **equally cheap** | pay SP again every 8 seasons, and re-expose your intent every time |

Three derived properties:
1. **A backstab no longer needs `abrogate`** — letting an alliance lapse is an amicable parting at zero cost; you only pay the betrayal price if you turn on someone while it is still in force. This turns "breaking a treaty" from a free action (the loophole the review ruled as F5) into **a decision about timing**.
2. A 5-on-1 coalition has to renegotiate 4 edges every 8 seasons, so the leader has a **predictable window to split them**.
3. Observation cost is zero: one integer added to that row of the stance matrix.

**Implementation: one field plus one per-season decrement.** One of the best value-for-effort items in the whole document.

---

### N10 ★★★★★ [MUST CHANGE] Structural connectivity = yield, replacing `scheme:断粮`

**Mechanism**:

```
at the end of each season's resolution, compute connectivity once per seat:
  starting from the seat's administrative seat, walk along
  「own commanderies + own forward outposts + allied commanderies covered by a transit clause」
  reachable commanderies   → normal yield
  unreachable commanderies → yield drops to zero (the territory is still yours, the garrison is
                             still there, it simply produces nothing and remits nothing)
  if the commandery holding a pass changes hands, the entire corridor behind it is cut at once
one line in the observation: supplyCut: [commandery A, commandery B]
```

**Source**: `GAMEPLAY-SLG-MOBILE.md` §6.6, from the alliance-banner-to-fortress connectivity in *Rise of Kingdoms* (万国觉醒).
The same idea appears independently three times: `GAMEPLAY-MOD-ECOSYSTEM.md` M3 (the `TransportCity` field in *Romance of the Three Kingdoms XI*) and
`GAMEPLAY-CN-INDIE.md` §9.1-5 (grain roads in *Chinese Three Kingdoms* (中华三国志), baggage trains in *Dragon Throne: Battle of Red Cliffs* (傲世三国)).

**Why round one missed it**: round one **does** have a supply system (§5.3, marching and supply: "a fully-own path to the nearest own granary; if cut, the force disperses after 1+⌊command/25⌋ xun"),
but it acts only on **armies**, not on **territorial yield**. And "cutting supply" was made into a 2 SP `scheme:断粮` (cut-grain scheme) action —
which review F4 ruled on: a 2 SP action should not be able to delete an entire army.

**Value to this project**: one change solves three problems at once.

1. The review's **F4** pricing problem (delete that action).
2. The point the review raised as **G4** — "the 61 passes in `strategic-nodes.json` have never carried any load" — once this becomes a connectivity rule, **passes become cut vertices in the connectivity graph and carry load naturally**.
3. It turns "cutting the supply line" from a **dice-rolling scheme** into **a deterministic, reasonable graph-theory problem** — exactly the kind of "stronger reasoning reliably converts into better results" that C5 asks for.

**No random numbers, no new actions, one connected-component computation, under 30 extra tokens of observation.**

**One empirical note from a predecessor** (`GAMEPLAY-MOD-ECOSYSTEM.md` §7.3):
the author of "Cyber Cricket Fighting: 9 LLMs Battle in Three Kingdoms" (赛博斗蛐蛐：9 大模型决战三国志) records that Claude wrote the best strategy documents (27 strategy revisions) and was the most trustworthy in diplomacy,
but **repeatedly had offensives collapse from supply shortages** — **supply was the main dimension that separated the models in that experiment**.
⚠ The model names and version numbers in that article were not independently verified, and no public repository link was provided.
But it issues a direct warning: **if the causal chain of supply is invisible in the observation, it is just noise**. Supply status has to be explicit, quantified, and carry a trend.

---

### N11 ★★★★★ [RECOMMENDED] Epoch advance = server-wide objective OR time limit (dual trigger)

**Mechanism**: a match is divided into several epochs, each with **a name + a one-sentence objective + a deadline season**.
Meeting the objective advances the epoch early; failing to meet it forces the advance on timeout. Epoch advance changes the map state (passes open, core regions unlock).
Put a `currentEpoch: { name, objective, deadline }` field in the observation.

**Source**: `GAMEPLAY-SLG-MOBILE.md` §1.3.4 / §3.3, the 20 stages of *Hongtu Zhixia* (鸿图之下) ("黄天当立" the Yellow Heaven shall rise / "啸聚山林" bandits gather in the hills / "汉室遗珍" relics of the Han house / "兵戈之祸" the scourge of war / "厉兵秣马" sharpen the weapons and feed the horses / "天下归一" the realm made one).
⚠ That title's official season length has never been published; two attempts this round failed to establish an authoritative account of its live-operation status, so this document draws no conclusion.

**Why round one missed it**: round one's clock is purely a timer (xun / season / year, three levels), with **no "stage objective" layer at all**.
Round one left "the situation advancing" entirely to interactions between factions, with no exogenous, shared clock pressure.

**Value to this project**:
- Direct answer to the review's §4.4, "turtling is a stable equilibrium": **collective inaction cannot freeze the clock**. A turtling faction's borders automatically become the front line.
- Observation cost is 30–50 tokens, **yet it eliminates the whole problem of "the model does not know where to attack"** — when a player/model asks at any moment "what should I be doing now", the answer is one sentence, with no need to read the whole stat table.

**Note the division of labor with N5** (`GAMEPLAY-SLG-MOBILE.md` §6.3 puts it most clearly; both are required):

> **Epoch timeout (T3) solves "even if you don't fight you get pushed to the front" — a motive problem.**
> **Majority rule (T7) solves "if you want to fight you can actually fight" — a capability problem.**
> The review's §3.1 and §3.2 happen to be one capability problem and one motive problem.
> **Fixing only one degenerates into another kind of turtling**: give motive without capability and the model is forced into attacks it cannot win and learns to dodge them; give capability without motive and the model keeps the capability unused.

---

### N12 ★★★★★ [RECOMMENDED] A scenario-randomness checkup (T-Span), plus "seed influence rises with skill, not falls"

**Mechanism**: before running any models, use a **deterministic baseline strategy** (all six seats playing the same policy) to run N matches on each of 200 scenario seeds,
and measure the Trimmed Span (the max-minus-min of first-mover win rate across seeds, dropping the most extreme 5%).

```
≤ 0.15    → pass, you may start running models
0.15–0.30 → conditional pass: you must increase the number of scenarios, and no single-scenario
            conclusion may appear in the report
> 0.30    → fail. Fix the mechanisms first; do not run models
cost: zero model calls
```

**Source**: `GAMEPLAY-WESTERN-ANALOG.md` §8.5,
James Goodman, Diego Perez-Liebana, Simon Lucas, *Seeding for Success: Skill and Stochasticity in Tabletop Games*,
IEEE Transactions on Games, Vol. 17, No. 3, pp. 777–786, 2025 ([arXiv:2503.02686](https://arxiv.org/abs/2503.02686)).
Reference points: Puerto Rico's T-Span is 0.08, Poker's is 0.99. This project should aim for the Puerto Rico end.

**Why round one missed it**: round one's `GAMEPLAY-AI-FRIENDLY.md` covered a batch of LLM benchmarks — CivRealm / SAGA / DSGBench / SPIN-Bench and so on —
but **did not cover the evaluation-methodology literature of board-game AI**. And the question "is this game measuring the model or measuring the opening?"
is exactly what the board-game AI community has quantified best.

**Value to this project**: two things, the second of which hits a round-one assumption.

**(i) It is a zero-cost gate that runs before any money is burned.**
The review's §5.5 computed one round of M1 evaluation (24 matches) at $3,570 on flagship models, $9,730 for the full version.
At that order of magnitude, **spending zero dollars first to confirm "this game measures the model, not the opening" is simply rational**.

**(ii) [Overturns a common understanding] Seed influence rises with skill; it does not fall.**
The paper's finding: as player skill rises, the influence of the random seed **grows**; the explanation is that stronger agents are better at cashing in the advantage of a good seed,
while weak agents misplay good hands and thereby mask the seed's influence.

> **Corollary: you cannot solve the variance problem by "waiting for models to get stronger"; it has to be solved by mechanism and experiment design.**
> This upgrades round one's §9.4 "randomness placement table" from a **preference** into a **hard requirement**.

**(iii) Incidentally, it corrects a possible cost illusion: mirrored pairings pay off far less than intuition suggests.**
Paper Table I: for most games, mirrored pairs (the same seed played once from each position) narrow the 95% confidence interval by only 0.1–0.4 percentage points relative to independent seats;
only games like Poker, "where the result is mostly settled at the deal", see an order-of-magnitude improvement.
**So do not expect seat rotation + mirrored pairings to bring evaluation costs down.** Cost has to be saved through mechanism.

---

### N13 ★★★★☆ [RECOMMENDED] Breach counts instead of force ratios

**Mechanism**:

```
breaches = base breaches (stronghold tier) + breaches produced by siege-engine investment
  subordinate county / unwalled stronghold   4    ← can be stormed immediately
  commandery seat (walled)                   0
  pass                                       0, and siege engines are half as effective
siege-engine investment (an O(1) tier choice; enters the action set, costs SP):
  none +0 / rams and towers +1 (needs N xun of preparation) / earth ramps and tunnels +2
  (needs 2N xun, and the terrain must allow it) / fire attack +1 (only against wooden palisades)
per-xun check (deterministic):
  breaches the defender can effectively hold = ⌊defending units / k⌋
  breaches > holdable breaches → the city falls; otherwise both sides trade losses, and the
  defender repairs at most 1 breach per xun
```

**Source**: `GAMEPLAY-WESTERN-ANALOG.md` §10.2, Oriental Empires (2017) manual pp.20–21.

**Why round one missed it**: round one's siege rules carried over the force-ratio thinking of the mainline KOEI games (`A/D ≥ 2.2`),
and Oriental Empires is **the only ancient-China 4X made by Westerners** — it is absent from round one's four documents.

**Value to this project**: the attacker's core decision changes from "how many troops do I gather" to "**how many siege engines do I invest, and how many xun do I wait**" —
a trade-off between time and resources, not a multiplication. The action set grows by only one entry (siege-engine tier, 3–4 tiers), it is fully deterministic, the breach count is public, and both attacker and defender can compute how many more xun are needed.

**What it does not solve has to be written down plainly** (`GAMEPLAY-WESTERN-ANALOG.md` honestly flags this itself):
the review's [C1] has two causes, and breach counts **only solve cause two** (the threshold for taking a city);
**cause one (army size capped at a single commandery's garrison) is untouched.**
Even with breach counts you still get the stalemate of "the engines are ready, but I cannot field enough troops to hold what I would take."

> **This is a textbook example of the two documents this round complementing each other**: the Western track cannot solve cause one (because Western games have no such binding at all),
> and the *Infinite Borders*-like track solves cause one with `muster`. **Both must be adopted together.**

---

### N14 ★★★★☆ [RECOMMENDED] Replace round one's "assign tactics" with tactic chaining

**Mechanism**: a tactic is not "+15% damage" but **an action with a trigger precondition and an after-effect** (rout / confusion / splitting / flanking).
A battle unfolds in order through a deterministic engine; one tactic's after-effect may satisfy another officer's tactic precondition, chaining automatically, and **the longer the chain the greater the payoff**.

**Source**: `GAMEPLAY-KOEI-WIDE.md` §3, the tactic chaining of *Dynasty Tactics* (三国志战记) (KOEI, PS2, 2002/2003).

**Why round one missed it**: round one adopted the auto-battle of **RTK9** (form up, designate targets, assign tactics, do not intervene once fighting starts).
RTK9's tactics are essentially numeric bonuses. *Dynasty Tactics* is not a mainline title, and round one's `GAMEPLAY-RTK-SERIES.md` covered only mainline 8/9/10/11/13/14.

**Value to this project**: in the language of `GAMEPLAY-MINIMALISM.md`, this swaps an **additive rule (R3)** for a **multiplicative rule (S1 interaction)**.

> When configuring tactics before a campaign, the model has to reason about "can these few people's tactics be strung together".
> **This is pure planning with no randomness to hide behind — exactly the source of discrimination C5 wants.**

**Rated [RECOMMENDED] rather than [MUST CHANGE]**: it needs a whole table of tactic preconditions/after-effects, which M1 cannot finish.
But **it determines the data shape of the §4 officer system** (a tactic needs two fields, `precondition` and `effect`, not a single `bonus` number),
so **the data schema has to reserve the slots now**.

---

### Remaining new findings: a one-line list

The entries below are likewise absent from round one but do not block M1; they are recorded grouped by track for M2+ to draw on.

| # | Mechanism | Source | Value in one line | ★ |
| --- | --- | --- | --- | --- |
| N15 | **Decapitation takes everything**: capturing the home base transfers all territory at once; the home base can be relocated | *Dynasty Warriors 8: Empires* (无双 8 Empires) (KOEI-WIDE §5) | Deletes the mop-up phase outright and shortens matches; meshes naturally with "moving the capital changes the direct-rule radius" | ★5 |
| N16 | **A hard-coded seasonal calendar** (gold collected in month 4 / grain in month 10 / floods in 5–6 / drought in 8–9) | *Haō no Tairiku* (霸王的大陆) (KOEI-WIDE §1, MINIMALISM technique 5) | A deterministic periodic structure = a structure reasoning can exploit. A strong model positions itself 3 months ahead; a weak one can only react | ★5 |
| N17 | **A shared doom clock + explicit attribution** (DEFCON) | Twilight Struggle (WESTERN §6.1 / §9.3) | One integer that changes the structure of the whole game; the last-place side has weight instead of being a kingmaker | ★5 |
| N18 | **A commitment device (军令状, a sworn performance pledge)**: tie your own hands, pay a penalty if you fail | Root · Eyrie Decree (WESTERN §9.2) | Turns "long-range planning" from talk into something the engine can settle | ★5 |
| N19 | **Publicly and irreversibly re-declaring your own victory condition** | Root · Dominance (WESTERN §9.4) | Directly answers the review's [C3]: a trailing side can switch to a track it can actually reach | ★5 |
| N20 | **Eligibility rotation**: only 2 parties are eligible at each decision point | The COIN series (WESTERN §6.5 / §9.5) | Model calls per decision point drop 6 → 2; a side effect is that the clock no longer needs a "wake someone or not" judgment | ★5 [UNCERTAIN, needs experiment E-3] |
| N21 | **Inaction bleeds too** (Decadence / a climate forcing function) | FoG:Empires + Attila (WESTERN §5.3 / §3.5) | Makes "standing still" a loss, blocking turtling from the asset side | ★5 |
| N22 | **Paired mutually exclusive laws** replacing 4×3 state policies | Old World Laws (WESTERN §9.8) | Swaps an "accumulation" structure for a "trade-off" structure | ★5 |
| N23 | **Private objectives unlocked one at a time + scored by number completed** | Old World Ambitions (WESTERN §9.9) | Eliminates the 4 purely defensive entries among round one's 12 private objectives | ★5 |
| N24 | **Appointments and dismissals cost something + arrival delay + dismissal ≠ weakening** | CK3 Roads to Power (WESTERN §9.11) | Eliminates high-frequency zero-information actions (reshuffling personnel every season) | ★5 |
| N25 | **Governance failure → the action set shrinks** | Imperator: Rome (WESTERN §9.12) | Upper-bound protection for C4: the worse your state, the less you can do | ★5 |
| N26 | **A finite edict pool**: a small number of high-value special commands that must be earned | *Sand Table War: Three Kingdoms* (沙盘战争：三国) (CN-INDIE §7.2) | The textbook shape of C4: finite, enumerable, with an acquisition cost | ★5 |
| N27 | **Conditional orders / standing orders**: `if in three seasons commandery X's garrison < N then attack` | *Three Kingdoms: Mou Ding Tian Xia* (三国：谋定天下) (CN-INDIE §9.1-4) | **Fills the 3-season gap between "one full call per year"**, instead of leaving the resolver to guess | ★5 |
| N28 | **The spectator four-pack** + **a state-visualization pack = an observation field list** | WH3 Auto-Run & Spectate; RTK11 custom packs (MOD §M9/M11) | An engineering precondition for 60-season × N-match experiments; twenty years of community voting on "the state we most want to know" is a ready-made observation requirement doc | ★5 |
| N29 | **Composition preferences, not formation orders**: the model states preferences, the solver does globally optimal matching | Learned in reverse from RTK11's auto-formation defects + Total War Better AI Templates (MOD §M4) | Goes one step beyond RTK9 — **even formation should not be handed to the model** | ★5 |
| N30 | **Absolute symmetry written into the spec**: no difficulty bonuses, faction potential, or scenario handholding of any kind | Fairplay AI (MOD §M6) | The floor of arena legitimacy; it directly decides whether C5 holds | ★5 |
| N31 | **A coalition system**: when one faction crosses a threshold, every other faction gains a legal "coalition" action | *Hongtuce: Three Kingdoms* (宏图策：三国) (CN-INDIE §7.4) | Historically grounded (the campaign against Dong Zhuo, 讨董), explainable, and gives weaker sides room to reason — far better than numeric subsidies | ★4 [choose between this and N17/N9, see §2 D3] |
| N32 | **Multi-path recruitment**: summons (征辟) / recommendation (荐举) / capture on the field / appeal to a righteous cause, each with its own preconditions and costs | *Heroes of the Three Kingdoms* (三国群侠传) (CN-INDIE §9.2-14) | Lets the model choose a path rather than roll dice | ★4 |
| N33 | **Orders through two slots, lead officer / deputy** | *Great Three Kingdoms Era* (大三国时代) (CN-INDIE §7.6) | Compresses combat decisions into intent assignment over two slots, at exactly the granularity C1 permits | ★4 |
| N34 | **Pure simulation with no combat presentation layer**, validated by the market | *Sand Table War: Three Kingdoms*, 322 reviews / 83.9% positive (CN-INDIE §7.2) | External evidence for round one's shape: this path is not just self-indulgence | noted |

---

## 2. New solutions to round one's 7 fatal problems

**How to read it**: each item first restates the review's recommendation, then says whether this round can offer a **better** solution.
Where this round cannot, it says plainly "adopt the review's recommendation" — **no padding for the sake of looking productive**.

---

### C1 [FATAL] Siege deadlock: no means of concentrating troops + `A/D ≥ 2.2` = a frozen map

**The review's recommendation** (§3.6(i)): add a `muster: CommanderyId[] ≤3` parameter to `campaign`; siege grain consumption 1.0 → 0.7; lower the city-taking threshold to A/D ≈ 1.6.

**This round offers a clearly better solution.** All three of the review's fixes act on **the same link** (loosening the force-ratio multiplication);
this round dismantles it at **four different links** simultaneously:

| Link | Mechanism | Source | Ruling |
| --- | --- | --- | --- |
| **Supply side** | `muster` as its own action (draw from several commanderies + a mustering window + allies may join + the muster point is visible and can be interrupted) | SGZ:SE Grand Administrator / muster (SLG-MOBILE §4.5) | **[MUST CHANGE]** |
| **Criteria side** | Majority-rule regional control: `control(province) = the most directly-held commanderies in that province`; advancing does not require taking every city | *Civilization and Conquest* (SLG-MOBILE §4.8) | **[MUST CHANGE]** |
| **Resolution side** | Breach counts instead of force ratios | Oriental Empires (WESTERN §10.2) | [RECOMMENDED] (requires rewriting §5.5; M1 can use the review's lowered-threshold version first) |
| **Time-limit side** | Sieges have a hard expiry + two-way attrition (the defender burns grain too) | *Haō no Tairiku*'s 30-day limit (MINIMALISM §2.10-6) | **[MUST CHANGE]** (round one already has a 6-xun window, but defender attrition is unmodeled) |
| **Projection side** | `outpost` forward bases + `clause:transit` rights of passage, priced at "3× the cost of bypassing the adjacency constraint" | *Infinite Borders* fortresses / borrowed-land expeditions (SLG-MOBILE §4.4) | [RECOMMENDED] M2 |

**Why this beats the review's fix**, three reasons:

1. **The review's `muster` parameter is a hidden addition; a standalone action is exposed gameplay.**
   The muster point is visible → the opponent gets a season to react → "do I hollow out my rear to attack you? and if you see it, will you go hit my rear?"
   That is **pure reasoning, zero randomness** game content, and the parameter version has none of it.
2. **The review only solved "can I attack", not "must I finish the job".** Majority rule decouples "advancing" from "annihilating",
   and at the same time makes changes of hands **reversible** (one extra commandery lets the opponent take provincial control back), which weakens snowballing.
3. **One `control(province)` predicate reused in three places** (final-standing grades, adjacency advance, observation summary) is pure engineering gain.

**A complementary relationship worth recording**: `GAMEPLAY-WESTERN-ANALOG.md` §10.2 openly admits
that the Western track cannot solve cause one of C1 (army size bound to the departure commandery's garrison), because Western games have no such binding at all.
**And `muster` comes precisely from the *Infinite Borders*-like track. The two documents this round complement each other on this item; neither alone would close the gap.**

---

### C2 [FATAL] The composite score makes "turtling to survive" the optimal play

**The review's recommendation** (§3.6(ii)):
```
composite = 0.70 × PI + 0.10 × prestige/100 + 0.20 × private-objective completion rate
destroyed or vassalized: composite × 0.5 (replacing 「survival」)
```

**This round offers a fundamentally better solution, and it is the single most valuable piece of methodology from the whole round of research.**

The judgment in `GAMEPLAY-SLG-MOBILE.md` §6.1:

> **Round one's "public outrage" is a corrective knob — it tries to punish the leader after the fact. The review's §4.3 proved that any single corrective knob can be routed around.
> The *Infinite Borders*-like track has had no "public outrage"-style knob in ten years; it relies on making "dogpiling" and "turtling" unprofitable in the payoff structure itself.**

The review's fix is still **weight tuning** — it turns the 0.15 survival additive term into a 0.5 multiplicative penalty, which is the right direction but still inside the same continuous weighted sum.
This round recommends **changing the framework**:

| Layer | Fix | Source | Ruling |
| --- | --- | --- | --- |
| **Scoring framework** | Absolute-threshold grades + a quota (not a weighted sum, not a ranking) | SGZ:SE Hegemony quota | **[MUST CHANGE]** |
| **Floor grade** | The Grade C criterion is "**clear ≥2 passes AND directly-held commanderies ≥ starting count**", not "lost no territory" | SGZ:SE Q4 | **[MUST CHANGE]** |
| **Scoring moment** | **Scored by the highest grade reached at any point this match**, not the instant of final resolution | *Infinite Borders* season appraisal | **[MUST CHANGE]** (zero cost, large payoff) |
| **Yield source** | All yield comes from land; without fighting there is no growth, and domestic administration cannot make it up | T2 across the whole track | **[MUST CHANGE]** |
| **Expansion cap** | Hung on **cumulative commanderies captured** (not prestige — prestige in round one is a quantity a defensive player never loses) | *Infinite Borders* territory cap (modified) | [RECOMMENDED] |
| **Clock pressure** | Epoch advance = server-wide objective OR time limit; collective inaction cannot freeze the clock | *Hongtu Zhixia*'s 20 stages | **[MUST CHANGE]** |
| **Role branching** | `withdraw` retirement: turns turtling into a public, irreversible self-elimination, **and into an observable metric** | *Infinite Borders* Peach Blossom Army | **[MUST CHANGE]** (low cost) |
| **Root of the fear** | An exile state: losing all land does not mean elimination | *Infinite Borders* Wandering Army | [RECOMMENDED], M1 does half |
| **Asset side** | Inaction bleeds too (governance record − dissipation / a disorder timetable) | FoG:E + Attila | [RECOMMENDED] M2 |
| **Private objectives** | Unlocked one at a time + scored by number completed; **delete every purely defensive entry** | Old World Ambitions | **[MUST CHANGE]** (setting them to 0 in M1 is also acceptable) |

**The core judgment, nailed down**:

> **Delete the "survival" term. In ten years this track has not produced one title that scores "being alive".
> The value of surviving should show up entirely as opportunity cost: stay alive and you have a chance at a grade; lose your land and you cannot reach the bar.**

---

### D1 / D2 / D3 [SERIOUS] Multiplayer-game degeneracy — this section overturns a whole block of round one

**The review's recommendation** (§4.5): change the vassalage-request threshold to directly-held PI, count vassals at only 20%, allow at most 2 vassals per overlord,
cap `cede` at 1 commandery per season, remove the cap on the outrage size term and change it to `100×(PI−0.15)/0.35`, add a permanent residual floor to the decay of the behavior term, tighten the imperial-edict discount to 60%, and tighten the vassalage discount to 50%.

**This round's judgment: the review is repairing something that should not exist.**

`GAMEPLAY-SLG-MOBILE.md` §6.2 gives the six **structural** anti-dogpiling mechanisms of this track (R1–R6),
and **not one of them is a "punish the leader" knob**:

| # | Mechanism | Why it works |
| --- | --- | --- |
| R1 | Absolute thresholds, not rankings | Knocking down first place does not increase your province count. **The direct payoff of dogpiling is zero** |
| R2 | Multiple grades, multiple winners + a quota allocable by negotiation | When goals do not conflict there is no reason to coalesce; when they do, "splitting the pie" is cheaper than "destroying the opponent" |
| R3 | **The contiguity constraint** | Distant factions **physically cannot reach** the leader |
| R4 | The floor grade requires attacking | A weak side has a path it can reach, but that path still demands offense |
| R5 | A finite time horizon | The payoff of revenge is truncated |
| R6 | **Organizations have expiry dates** | Prices permanent coalitions, not temporary ones |

**Recommendation on D3 (public outrage not working)** [OVERTURNED]:

> **Recommend deleting "public outrage" entirely and letting R1 + R3 + R6, three structural mechanisms, carry the anti-snowball job.**
>
> Reason: the review's §4.3 already computed that the "revere the Han + obey the edicts + collect vassals" route keeps outrage **permanently parked at 60 and never triggers usurpation**.
> The review's fix (tune three coefficients) plugs that one route but cannot plug the next —
> **this is a searchable parameter space, and sitting across the table is a set of models that are good at searching for rule loopholes.**
> `GAMEPLAY-SLG-MOBILE.md` §6.5(b) gives track-level empirical evidence:
> *Infinite Borders*' 380-member alliance cap was routed around by players with "multi-alliance matrices", and the official response **was not to patch the cap, but to wipe things periodically with season resets and to introduce smaller organizational units to drain off the pressure**.
> Conclusion: **any form of "size cap" will be routed around, unless the channel for routing around it is also sealed.**

**Repositioning R3 [RECOMMENDED, zero cost]**:
Round one treated the contiguity constraint as a tool for C4 (enumerable actions) and C2 (observation trimming). This round points out that it is **also the main anti-dogpiling mechanism**:

> **In a world where you can only attack your neighbors, "everyone ganging up on first place" is physically impossible — unless first place happens to be everyone's neighbor.**

This is a free benefit at zero implementation cost (the existing code already restricts via `neighbors`). **Recommend writing this value into the design document so that nobody later loosens the contiguity constraint for some unrelated reason.**

**On D1 (kingmaker)**:
- Absolute thresholds + multiple grades with multiple winners eliminate the "more than second place" class of problems;
- `cede` capped at 1 commandery per season (adopting the review's recommendation);
- **Cut vassalage / requesting vassal status entirely in M1** (see §4). It is the common source of both review problems D2 and D4, and it is not a required system.
- If restored in M2: **vassal PI does not count toward the final-standing grade criteria** (the lesson of *Infinite Borders*' mega-alliances — channels like this either get sealed or the final criteria refuse to recognize them).

**[UNCERTAIN] An alternative route this round could not settle**:
`GAMEPLAY-WESTERN-ANALOG.md` §9.3 proposes replacing public outrage with Twilight Struggle's **DEFCON** (a shared doom clock + explicit attribution) —
one integer, shared by everyone, with public accountability for who pushed it.
`GAMEPLAY-CN-INDIE.md` §7.4 proposes a **coalition system** (crossing the threshold unlocks a "coalesce" action for everyone else).
These two and "delete public outrage, keep only structural mechanisms" are three different paths.
**This document leans toward the first (deletion), because it carries the least state and has ten years of track evidence behind it; but neither of the other two has been falsified.**
The cautionary example is clear: Shogun 2's Realm Divide (an unconditionally triggered everyone-against-you dogpile) is a textbook failure (WESTERN §3.4) —
dogpiling must be **coolable, behavior-weighted, and cooling down must cost opportunity**.

---

### B1 [FATAL] The token budget is underestimated by 1.7–3×

**The review's recommendation** (§2.3): move the full adjacency table into the system prompt and KV-cache it, give graded standings for all 30 factions,
never trim your own officers, converge legalActions to 90 entries → mid-game total 7,631, and change the budget line to "soft target 7,500 / hard cap 10,000".

**This round offers a more thorough solution, at the cost of structural change.**

The **four gates** of `GAMEPLAY-WESTERN-ANALOG.md` §7.4, each cutting one order of magnitude:

```
Gate 1 (breadth):      administrative capacity  → commanderies entering the action set drop
                                                   from 105 to 15–30
Gate 2 (granularity):  move the decision object → first-level entries drop from O(commanderies)
                       to another layer           to O(theaters + 3)
Gate 3 (presentation): the proposal channel     → commandery-level matters still happen, but
                                                   appear only as "what subordinates proposed"
                                                   (5–15 entries)
Gate 4 (frequency):    eligibility rotation     → model calls per decision point drop from 6 to 2
```

**Targets (recommended for the acceptance criteria)**:

| Quantity | Round one, measured | After the review's fix | This round's target |
| --- | --- | --- | --- |
| First-level action entries | 62–195 | ≤90 | **≤12–20** |
| **Spread in entry count across the six seats** | **3.1×** | not addressed | **≤1.5×** |
| Observation tokens | 9,910–13,761 | 7,631 | ≤6,000 (commandery-level detail ≤1,200) |
| Model calls per decision point | 6 | 2 (batched queries) | 2 |

**The item "spread in entry count across the six seats ≤1.5×" is new this round, and is ruled [MUST CHANGE].**
The review measured the six seats' opening first-level entry counts at 62 / 138 / 155 / 172 / 186 / 195 — a 3.1× spread.

> **That means the six models are not even answering the same question. This is a question of evaluation validity, not just of cost.**

Gates 1 and 2 compress this spread naturally, because theater counts and estate counts **do not grow linearly with territory**.

**Plus one qualitative overhaul [RECOMMENDED]**: move the layering from the harness layer into the rules layer (N8, direct-rule radius).
Together with one boundary that must be held (WESTERN §7.5):

> **Aggregate decisions, do not aggregate consequences. Commanderies stop being decision objects, but commanderies must still be consequence objects, and the causal chain must be short enough for the model to derive it itself.**

Concretely: for each theater, the observation gives a **three-line receipt** of "what this directive actually produced last season"
(change in registered population, change in morale, change in provisions + the names of the two commanderies that contributed most and least).
That is two orders of magnitude cheaper than giving full detail for 30 commanderies, while preserving causal legibility.

**Rulings**: Gate 3 (the proposal channel) [RECOMMENDED, do it in M1; pure harness change, zero new state];
Gates 1 and 2 [RECOMMENDED, M2]; Gate 4 (eligibility rotation) [UNCERTAIN, experiment E-3 must come first].

---

### E1 [FATAL] The M1 acceptance criteria and the budget differ by 20×

**The review's recommendation** (§5.6): a hard wake budget of 36, batched tool queries (4 round trips compressed to 2), M1 cut to 16 seasons,
and acceptance criteria changed to "under 3M tokens per match, wall clock under 90 minutes".

**This round adds two things, but neither is complete.**

**(i) Eligibility rotation (COIN) can cut model calls per decision point from 6 to 2**,
with the side effect that the clock no longer needs a "wake someone or not" judgment — the card order is the answer (this also lands on F2).
**But `GAMEPLAY-WESTERN-ANALOG.md` §6.5 explicitly refuses to settle this trade-off**:
it is a structural choice between "many small decisions vs few large decisions", with reasonable priors on both sides and no way to decide but measurement (experiment E-3).
**This document adopts that position: [UNCERTAIN]. M1 does not do eligibility rotation, but E-3 goes into the plan.**

**(ii) This round offers a route to lowering "acceptance cost" rather than "match cost", and its value is underrated.**

`GAMEPLAY-MINIMALISM.md` technique 8 cites the Rep. column of the Heidelberg study (how many matches each mechanism needs before you can confirm with >75% confidence that the stronger player is stronger):

| Resolution character | Minimum matches per ablation group | Total budget for three ablation groups + control |
| --- | --- | --- |
| **Deterministic resolution** | **5–10 matches** | **20–40 matches** |
| With resolution randomness mixed in | 70+ matches | 280+ matches |

> **This closes the loop on round one's argument for "deterministic resolution"**: deterministic resolution is not only "measures accurately",
> it makes **the whole acceptance methodology affordable**.
> If validating one mechanism required 280 matches of 60 seasons each, the methodology would be dead; at 20–40 matches it is a routine tool you can use on every change.

**Concretely [RECOMMENDED]**: freeze the restricted-play ablation into a `depth-ablation` task in CI:
disable the whole `scheme` class / disable the negotiation channel / fix SP so it does not grow with scale, three groups of 5–10 matches each,
**and each group's drop in win rate is that dimension's contribution to depth**. If disabling one dimension barely moves the win rate → that dimension contributes 0 to depth; delete it, saving implementation cost and tokens.

**Plus one [MUST CHANGE] that goes at the very front**: **E-1 (the T-Span checkup) must run before any model match.**
Zero model calls, and it directly answers "is this game measuring the model or measuring the opening?"
At the scale of $3,570 per evaluation round, this is simply rational.

---

### F2 [FATAL] Interrupt-driven wakeups contradict the fixed 60-season clock

**The review's recommendation** (preferred option A): interrupts only decide "whether to wake someone"; they do not move the clock. The 9 xun are an uninterruptible gate; interrupts accumulate within the xun and are reported together at the seasonal-council boundary, where they trigger a wakeup.

**This round offers nothing better. Adopt the review's option A.**

Reason: the only relevant alternative this round (eligibility rotation, which naturally defines "who speaks this season") requires experiment E-3 first and cannot be M1's plan.
The extra argument for the review's option A is strengthened this round: `GAMEPLAY-MOD-ECOSYSTEM.md` §6.2-A10 records a counterexample from *Romance of the Three Kingdoms XI* —
rear cities **check their supply lines only once a year**, showing that "if the AI's thinking frequency is far below the world's rate of change, no amount of good logic will save it".
This project's structure is exactly the opposite (the solver runs continuously every xun, while the model decides at the seasonal council),
**so the design of the interrupt thresholds is a core engineering problem that cannot be skipped — but it should not move the clock.**

**One addition this round [RECOMMENDED]**: use **conditional orders** to fill the gap between two decisions (N27, the "scheduled siege" of *Three Kingdoms: Mou Ding Tian Xia*).
Orders carrying a trigger condition, like `if in three seasons commandery X's garrison < N then attack`,
cost fewer calls than "interrupt wakeups", and **they make the model's lookahead explicit** — you can compute a "lookahead realization rate" process metric straight from them.

---

### G2 [FATAL] There is no commandery-level initial state data at all, and no generation rule either

**The review's recommendation** (§G2): add `commandery-initial-194.json`, give generation formulas for six items — cultivated land / commerce / city defenses / morale / garrison troops / granary stores — and hand-write a "war-devastation coefficient" per commandery with its historical justification attached.

**This round adds three things, one of which is [MUST CHANGE].**

**(i) [MUST CHANGE] Garrisons in ownerless commanderies are configured in the same direction as their yield level.**
Source: `GAMEPLAY-SLG-MOBILE.md` §5.1 (*Infinite Borders*' level 1–10 land: the tier determines yield and garrison together).
This one rule kills the degenerate strategy **D6 (racing to grab ownerless land)** from the review's §3.4 —
within M1's scope, 23.5% of the registered population belongs to frozen NPC / ownerless commanderies, and under the round-one design the first 8–10 seasons would degenerate into a zero-risk land grab race.
Once **high yield necessarily means a high garrison**, grabbing ownerless land becomes a decision you have to do arithmetic for.

**(ii) [RECOMMENDED] Two tiers, commandery seat / subordinate county, which cuts more than half the commandery-level fields that need generating.**
Source: `GAMEPLAY-WESTERN-ANALOG.md` §3.1 (a province in Rome II / Attila = several commanderies + one commandery seat).
Subordinate counties do not need cultivated land / commerce / city defense; they need only a derived supply/garrison coefficient.
Companion: `GAMEPLAY-CN-INDIE.md` §9.2-15 recommends using the 1180-county data for derived quantities, **not letting it enter the action space**.

**(iii) [MUST CHANGE, restated] The source of a faction's strength has to move from the "officer stat table" to "geography and population".**
Source: `GAMEPLAY-MOD-ECOSYSTEM.md` M12 / insight 6.
This and N30 (absolute symmetry, no faction-potential or scenario-handholding parameters) are two sides of the same thing, and **both belong in the spec**.

**This document has nothing better than the review's six generation formulas; they are adopted.**
Of them, "hand-write the war-devastation coefficient per commandery with historical justification" **must be done** —
round one's §13.3 said "there is no reliable historical source for the devastation coefficient, so the first version skips it", but the review already pointed out:
**the consequence of skipping it is that you have to dodge it some other way, and the current design both skips the devastation coefficient and uses the 140 CE population registers directly as the economic base — it is having it both ways.**

---

### G7 [FATAL] Historical death years = a scripted guaranteed loss

**The review's recommendation** (§G7): rulers do not go into the historical death-year table; historical death years apply only to those "whose cause of death is unrelated to in-game events" (needs a `deathCause` field);
add succession rules (successor = the officer with the highest renown×0.5 + righteousness×0.3 + bonds×0.2; all loyalties −12 in the season of succession); add `estimatedBirthYear`.

**This round offers something better in two directions.**

**(i) [RECOMMENDED] The succession penalty should have three tiers keyed to "how prepared you were", not a flat −12.**
Source: `GAMEPLAY-WESTERN-ANALOG.md` §5.1.4 (what Old World and Oriental Empires do).
"**Designating an heir**" is an action that spends explicit resources; whether you designated one in advance, how long ago, and how strong the heir's power base is together determine the penalty tier at succession.

> This beats the review's flat penalty because it turns succession from **a one-off exogenous shock** into **a plannable decision** —
> and "whether you prepare for a foreseeable risk" is exactly one of the reasoning abilities we most want to measure.
> The split of Hebei after Yuan Shao's death and Jingzhou changing hands after Liu Biao's death both become natural products of this rule, with no need to script them.

**(ii) [RECOMMENDED] Memory contamination from the death-year table is cured at the root by anonymized mode (N6).**
The review identified the contamination surface ("the de-Three-Kingdoms control group only changed the names; the death-year table was left as it was") but gave no solution.
Anonymized mode's solution is: **officers get only an ID and observable clues; names and stats are hidden** — the death-year table loses its anchor by itself.
This is also why N6's interface spec has to be designed at M0 for "hide the stats", not for "change the names".

**The review's other three items (rulers excluded from the death-year table, the `deathCause` field, `estimatedBirthYear` interpolation) are adopted, all [MUST CHANGE].**

---

### Section summary: disposition of the 7 fatal problems

| # | Problem | Does this round offer a better solution | Ruling |
| --- | --- | --- | --- |
| **C1** | Siege deadlock | **Yes** (dismantled at four links at once; `muster` supplies the half the Western track could not) | Must change |
| **C2** | Turtling is optimal | **Yes** (change the scoring framework, not the weights) | Must change |
| **B1** | Over token budget | **Yes** (four gates + move layering into the rules layer); but gates 1/2/4 are structural changes | Partly must change |
| **E1** | Acceptance criteria off by 20× | **Partly** (ablation acceptance needs only 20–40 matches; eligibility rotation pending experiment) | Partly must change |
| **F2** | Interrupts vs the clock | **No, adopt the review's option A** | Must change (per the review) |
| **G2** | No commandery-level initial state | **Partly** (garrison aligned with yield + two stronghold tiers) | Must change |
| **G7** | Historical death years | **Yes** (three preparedness tiers + anonymization cures the contamination) | Must change |
| D1–D3 | Multiplayer degeneracy | **Yes, and recommend overturning the whole "public outrage" block** | See §3 |

---

## 3. Round-one judgments that need overturning

**Scope**: only items that conflict directly with an **explicit** round-one conclusion. Anything round one did not nail down counts as an addition, not an overturn.

---

### 3.1 "The RTK9 paradigm fits best" — **still holds, but two of its components have to be swapped**

**Round one, verbatim** (skeleton conclusion): "RTK9-style auto-battle: form up, designate targets, assign tactics, do not intervene once fighting starts."

**This round's evidence supports this skeleton, and supports it more strongly than round one did:**
of the twelve entries in `GAMEPLAY-MOD-ECOSYSTEM.md` §6.2 under "ways the AI looks stupid",
three — A2 (piecemeal commitment: queueing up to feed the enemy kills), A7 (cannot use siege engines or terrain), A8 (clumsy troop-allocation / formation algorithms) — are inevitable products of a **per-unit interface**.
The conclusion in §6.4 is structural: "the AI and the player share the same micromanagement interface → at that granularity the rules engine can only use greedy heuristics → greedy inevitably shows its weakness globally."
**This is the strongest independent corroboration for "do not intervene once fighting starts".**

**But two components have to be swapped:**

| Round one | Swap for | Source | Reason |
| --- | --- | --- | --- |
| **Formation** (the model designates who leads which army) | **Composition preferences** (the model declares "heavy infantry as the core, cavalry on the flanks, prefer officers good at defense"; the solver does globally optimal matching) | MOD §M4 | Goes **one step beyond** RTK9: an optimal solver = no exploitable gaps = reasoning differences are not masked by execution noise. And it saves tokens |
| **Assigning tactics** (numeric bonuses) | **Tactic chaining** (triggers and after-effects, chainable automatically, longer chains pay more) | *Dynasty Tactics* (KOEI-WIDE §3) | Numeric bonuses are an additive rule (R3); chaining is a multiplicative rule (S1). **The first produces no depth; the second produces pure planning depth** |

**Ruling**: composition preferences [RECOMMENDED, feasible in M1, saves tokens]; tactic chaining [RECOMMENDED, M2, but the data schema must reserve the `precondition`/`effect` fields now].

---

### 3.2 "Is *Haō no Tairiku*'s one-order-per-city a better skeleton?" — **first correct the premise, then: yes, and this overturns round one**

**A widely circulated misstatement has to be corrected first.**
`GAMEPLAY-MINIMALISM.md` §2.2 states plainly:

> "One order per city per month" is **inaccurate**. The accurate statement is: **the whole country gets 3–12 operation opportunities per month, and each operation is a (city, command) pair.**
> You may spend all 12 on a single city, or spread them across 12 cities.

So the question should be re-asked as: **is an action budget with a globally hard upper bound a better skeleton than round one's `SP = 5 + ⌊√n⌋ + noble rank + carryover`?**

**Answer: yes. This [OVERTURNS] round one's §2.2.** Three documents this round independently reach the same conclusion
(`GAMEPLAY-KOEI-WIDE.md` §9.1, `GAMEPLAY-MINIMALISM.md` technique 1, `GAMEPLAY-SLG-MOBILE.md` §5.3).

**Three reasons:**

1. **Round one's SP has no hard cap** (it can actually reach 18), so the observation budget **diverges** with territory. C4 requires the action set to be bounded.
2. **A hard cap is simultaneously an anti-snowball mechanism**: expand from 12 cities to 30 and the number of order chits does not go up by one — **the marginal return on territory decays to 0, per-city decision bandwidth falls from 1.0 to 0.4, and the leader is forced to abandon development across most of his territory.**
3. Old World's Orders are a **soft cap** (growing smoothly with empire size), which only satisfies anti-snowballing; **a hard cap satisfies C4 and anti-snowballing at the same time.**

**The concrete fix** (`GAMEPLAY-MINIMALISM.md` technique 1, adopted here in full):

| Round one | Change to |
| --- | --- |
| `SP = 5 + ⌊√n⌋ + noble rank(0–2) + carryover(≤4)`, reaching 18 | **`SP = min(5 + ⌊√n⌋, 12)`, carryover ≤2, noble-rank bonus removed from SP** |
| Each command costs 0–3 SP | **Everything costs 1 SP, with the single exception of `campaign` = 2** |
| No "per-commandery cap" | **At most 2 commands per commandery per season** |
| — | **Maintenance actions (appointing a Grand Administrator, reassigning officers, raising defenses) are outside the budget** (*Haō no Tairiku* and 8 Empires each validated this independently) |

**"Everything costs 1 SP" deserves its own note, because it is also an [OVERTURN].**
The argument in `GAMEPLAY-MINIMALISM.md` §9.3(ii):

> **A price table is itself a rule, and an extremely error-prone one.**
> A pricing table encodes the designer's judgment about "what is strong". Get one cell wrong and the model finds an optimal route through it, and a layer of depth collapses.

The three items the review found independently (F4: a 2 SP `scheme:断粮` deleting an army; F5: `abrogate`/`respond` priced at 0 SP; F1: `requestWakeAt` with no budget)
**are three instances of the same disease**. *Haō no Tairiku*'s approach is to **delete the rule entirely** — every command costs one chit.
That way **depth can only come from "what to do", not from "mining the price table"**.

**The cost of the hard cap has to be recorded honestly** (`GAMEPLAY-MINIMALISM.md` §2.11):

> With command chits capped at 12, late-game development stalls and play converges to "gather troops — take a city — gather troops".
> **The price of a hard cap is that the late-game decision space shrinks along with it. This project needs to change dimension in the late game, not merely shrink the budget.**

This project's "change dimension" channels: epoch advance (N11) changing the map state, diplomacy and quota negotiation (N2's Q3), and the threshold race in the final standings.
**This is a design risk, and it has to be revisited and verified after M1.**

---

### 3.3 "Public outrage is the only anti-snowball knob" — **[OVERTURNED]**

See §2 D3. Round one's §3.7 says verbatim "public outrage is the only anti-snowball knob", and the review's §4.3 already computed that this single knob is **permanently ineffective** against the optimal expansion route.
What this round adds is a track-level judgment: **in ten years this track has not produced one "public outrage"-style knob**; anti-degeneracy is written entirely into the payoff structure.

**Recommend deleting it entirely, with the job carried by R1 (absolute thresholds) + R3 (contiguity) + R6 (alliance expiry).**
[UNCERTAIN] A shared doom clock (TS DEFCON) and a coalition system (*Hongtuce*) are two alternative routes that have not been falsified.

---

### 3.4 "Survival is one term of the composite score" — **[OVERTURNED]**

The review already overturned it; this round adds track-level evidence: **in ten years of *Infinite Borders*-like games, not one grade criterion has been "lost no territory" or "survived".**
`GAMEPLAY-SLG-MOBILE.md` §3.4 also supplies an in-track comparison: *Rise of Kingdoms* KVK's honor-point system (continuous + accumulable + ranked + points for continued occupation)
is precisely the title players universally regard as having the weakest competitive ecology, and **round one's composite score is structurally that same kind of thing**.

---

### 3.5 "Layered observation = trimming against the token budget" — **[OVERTURNED]; change to "layering is part of the rules"**

Round one's §8.5 has a budget-driven degradation-order table. This round recommends replacing it with in-rule direct-rule radius / delegation (N8).
The difference is not how many tokens you save, but **whether the missing information can be attributed and whether the model can plan around it** (details in §2 B1).

---

### 3.6 "Pushing all randomness ahead of the decision is enough" — **[MUST BE STRENGTHENED]**, and round one missed the implementation layer

Two things:
1. **Goodman et al. 2025**: seed influence **rises with skill**. You cannot solve variance by "waiting for models to get stronger". Round one's §9.4 is upgraded from a preference to a hard requirement.
2. **Round one never specified how random numbers are generated** (N1). A single global RNG stream lets the resolution order secretly hand out luck, which **is fatal for WEGO**. This is a spec gap that must be filled, not an optimization.

---

### 3.7 "578 officers + five attributes + 24 special skills" — not an overturn, a criterion upgrade

The criterion in `GAMEPLAY-MINIMALISM.md` technique 4 is the sharpest available:

> **If 578 officers can be arranged in a single "who is stronger" ordering, then the depth contribution of those 578 data points ≈ log(578).**
> If each officer carries a discrete **aptitude tag**, so that "who to bring" depends on "where you are fighting", the depth contribution is the size of a **matching problem**.

Round one's five attributes + 24 special skills are basically orderable (a higher number is better at everything).
**Recommend changing to: keep the numbers for computation, but turn every ability switch into thresholds + discrete aptitude tags** (techniques 3 + 4).
Source: *Haō no Tairiku*'s intelligence thresholds (five tiers, 85/93/95/98/99, unlocking stratagems), its loyalty thresholds (≥90 immune to discord-sowing, <40 open to persuasion, ≤25 easy),
its troop-type × terrain mobility matrix, and its **level × unit-composition table (L1 = 5 infantry / 4 crossbow / 1 cavalry → L8 = 0 infantry / 4 crossbow / 6 cavalry; a level-8 officer has no infantry at all)**.

The second benefit of thresholding lands directly on evaluation:

> **Thresholds turn floats into booleans.** The model does not have to compute `0.87 × 1.2 × (1 − 0.15)`; it only has to judge "did it clear 93 or not".
> That sharply reduces the risk of **arithmetic errors contaminating the measurement of reasoning quality** —
> the core finding of lmgame-Bench is that without scaffolding almost all models cluster near chance level, because perception/arithmetic noise drowns out the reasoning signal.

---

### 3.8 One thing that was **not** overturned but is undervalued: the contiguity constraint

See R3 in §2 D3. Round one treats it as a tool for C4/C2; this round points out it is **the main anti-dogpiling mechanism**.
**Recommend writing this value into the design document** so nobody loosens it later for reasons like "making the map livelier".

---

## 4. Minimalism, reconsidered

### 4.1 Was the round-one design too complex? — Yes

Run the round-one design through the seven inverse conditions (R1–R7) of `GAMEPLAY-MINIMALISM.md` §9.2 and it is **already caught three times** (that document's §9.3 names them itself):

| Condition | Where round one is caught |
| --- | --- |
| **R1** (a new rule supplies a dominant strategy) | Differential SP pricing (review F4/F5/F1 are three instances); the composite score making turtling optimal (review C2) |
| **R2 + R3** (duds + addition rather than multiplication) | §2.4 argues depth from `C(98,5) ≈ 6.7×10⁷`. **Of those 98 entries, `fortify` 8 + `levy` 8 + `scout` 9 = 25 are the same action expanded per commandery, with zero interaction between them**, so their contribution to depth is closer to log(8) than to C(8,k) |
| **R7** (total rule mass exceeds the context budget) | Review B1 ruled tokens underestimated by 1.7–3×, which is essentially one firing of R7. The excess rules are not merely useless — **they also crowd out attention from the effective rules** |

**Round one's §2.4 depth argument has to be replaced [MUST CHANGE].**
The recommended replacement argument (`GAMEPLAY-MINIMALISM.md` §9.3):
do not argue depth from combination counts; use **interaction-pair counting** — count how many pairs of templates in the template set have a **joint effect ≠ the sum of their separate effects**.
If that count is below the template count (i.e. each template interacts with only 2 templates on average), the depth is insufficient, and **what you need to add is not more templates but more coupling between templates**.

### 4.2 Systems that can be cut without losing depth

The blade: **"Can this rule change the optimal use of at least two existing rules?"** If not → cut it.

| # | What to cut | Ruling | Reason | Replacement |
| --- | --- | --- | --- | --- |
| 1 | **Public outrage** | **[MUST CUT]** | A single corrective knob will always be routed around (review D3's computation + track-level evidence) | The three structural mechanisms R1 + R3 + R6 |
| 2 | **Survival score** | **[MUST CUT]** | Mathematically it is paying out for "zero ΔPI" | Grades + quota (losing land just puts the bar out of reach) |
| 3 | **Bidding for the floor** | **[MUST CUT]** | Review G8: prestige is threshold-shaped, so the same price costs different factions infinitely different amounts → everyone bids 0 and the mechanism is dead | A separate "floor points" resource, a fixed 3 per faction per season; or delete it outright (M1 has no negotiation round) |
| 4 | **Vassalage / requesting vassal status** | **[MUST CUT]** (M1) | Review D2/D4: the request threshold is circularly defined (the overlord's PI includes 40% of vassal PI) → positive feedback; hatred counts at only 25% → the most cost-effective expansion route in the whole design | If restored in M2: vassal PI does not count toward the final-standing criteria |
| 5 | **Differential SP pricing (0–3)** | **[MUST CUT]** | A price table is itself an extremely error-prone rule (MINIMALISM §9.3-ii) | Everything 1 SP, `campaign` = 2 |
| 6 | **State policies, 4 lines × 3 levels** | [RECOMMEND CUTTING] | An "accumulation" structure: save up and take it, with no trade-off | 2–3 pairs of **mutually exclusive laws** (Old World Laws); picking A rules out B |
| 7 | **The noble-rank ladder** | [RECOMMEND CUTTING] | Functionally overlapping with prestige and legitimacy, three parallel lines; with the rank bonus removed from SP it carries almost no load | — |
| 8 | **The legitimacy route value** | [RECOMMEND CUTTING] (M1) | One route value + one prestige + one good-faith = three scalars with heavily overlapping functions | In M2, swap for a "transferable, non-revocable legitimacy token" (Oriental Empires, one ID) |
| 9 | **The six `scheme` types** | [RECOMMEND CUTTING TO 1–2] | `断粮` becomes the structural connectivity rule (N10); most of the rest are dice-rolls | Keep `离间` (sow discord) — it carries the interaction "the opponent's assets can be operated on" (MINIMALISM technique 7) |
| 10 | **`project` works (4–12 seasons + multiple prerequisite AND-gates)** | [RECOMMEND CUTTING TO 1–2] | Review §7.2 already recommended it | **But at least one investment channel with a 3–5 season payback period must be kept, or S6 (long-range credit assignment) goes to zero** |
| 11 | **The 12 private objectives** | **[MUST CHANGE]** | At least 4 of them are purely defensive ("lose no commandery for three years" and the like) | Set to 0 in M1; in M2 change to unlocked one at a time + scored by number completed |
| 12 | **6 stance tiers / 4 strength tiers / 4 reward types** | [RECOMMENDED] | Second-level parameter domains must be discretized to ≤3–4 tiers (MINIMALISM technique 2) | 4 stance tiers, 3 strength tiers (detachment / main force / all-out), 3 reward amount tiers |
| 13 | **`deputies ≤2 freely chosen`** (C(24,2) = 276 combinations) | **[MUST CHANGE]** | Second-level parameter domain explosion (review A1) | `≤2 and must be stationed with the lead officer` |
| 14 | **Every continuous quantity in tribute and clause counts** | **[MUST CHANGE]** | Review F6: conflicts with §6.6's own prohibition | 3 tiers across the board |
| 15 | **Five attributes + 24 special skills** | [RECOMMENDED] (M1) | Orderable → depth contribution ≈ log(578) | M1 uses only 3 attributes (command / stratagem / administration) at 5 tiers each + 6–8 discrete aptitude tags |
| 16 | **6 strength tiers** | **[MUST CHANGE]** | Review §3.5: a tier is 2.5–3× wide > the 1.47× spacing between decision thresholds = equivalent to rolling dice | 13 tiers, geometric with ratio 1.4 |

**What must be kept (deleting these would make a large number of strategies vanish at once):**

WEGO sealed orders + deterministic simultaneous resolution · a globally hard-capped action budget · **the contiguity constraint** (three jobs) ·
supply connectivity · the intent layer + a deterministic solver · a graded objective function · discrete thresholds · **key-derived random streams** ·
troop type × terrain (the main carrier of S7 orthogonal differentiation) · structured, explainable battle reports.

**The last one deserves separate emphasis**: `GAMEPLAY-CN-INDIE.md` §10 records the lesson of (创造三国志) —
auto-battle that "you cannot tell how it was resolved" led players to say "famous generals might as well not exist".
**Battle reports must be structured and explainable: which attribute / which tactic / which terrain contributed how much.** Otherwise C5 fails outright.

---

### 4.3 The minimum evaluable rule set — one page

**Design goal**: fits on one page, yet suffices to separate strong models from weak ones.
**Check method**: the rule count is aligned with *Haō no Tairiku* (≈75 rules), but the **interaction density** has to be higher (see the interaction-pair count in §4.4).

```
════════════════════════════════════════════════════════════════════
  MIND ARENA · Minimum Evaluable Rule Set (MERS v0.1)
════════════════════════════════════════════════════════════════════

[MAP]
 R1  105 commanderies (M1 uses the 40 of the Central Plains), belonging to thirteen
     provinces. Commanderies are joined by adjacency edges; some edges carry a pass.
 R2  Three numbers per commandery: yield tier(1–10) · garrison tier(13 tiers, geometric 1.4)
     · morale tier(1–5).
 R3  An ownerless commandery's garrison tier runs with its yield tier (high yield
     necessarily means a high garrison).
 R4  control(province) = the faction with the most directly-held commanderies in that
     province; a tie means nobody controls it.

[TIME]
 R5  Four seasons per year. M1 runs 16 seasons. No turn order.
 R6  Four phases per season: report → sealed orders → simultaneous resolution →
     settlement. Resolution order affects no result (see R33).
 R7  Three epochs. Epoch advance = the server-wide objective is met OR this epoch times
     out after 6 seasons (dual trigger).
     Epoch advance changes the map state (passes open / core regions unlock).
 R8  One line in the observation: currentEpoch: {name, one-sentence objective, seasons left}.

[BUDGET]
 R9  Orders per season = min(5 + ⌊√(commanderies)⌋, 12). A hard cap decoupled from
     territory; carryover ≤2.
 R10 Everything costs 1 order; campaign costs 2. There is no other pricing.
 R11 Appointment / reassignment / observation: free.
 R12 At most 2 orders per commandery per season.

[ACTIONS — 8 templates, all pre-filtered by the engine into 5–15 concrete candidates;
 the model answers a multiple-choice question]
 R13 campaign 征伐(target commandery, lead officer, strength ∈ {detachment, main force,
     all-out}, engines ∈ {none, ram, earth ramp})
     May only strike adjacent commanderies; and only commanderies inside 「a province
     where you already hold a commandery」 or 「a province adjacent to one you control」.
 R14 muster 集结(muster point, 2–5 source commanderies incl. allies, lead officer,
     deadline k+1|k+2)
     The muster point is publicly visible; if it falls the whole muster fails; whatever
     has not arrived returns to its home commandery.
 R15 govern 治(commandery, directive ∈ {promote farming, recruit, repair walls, pacify})
 R16 appoint 任(commandery, Grand Administrator)            —— free
 R17 ally 盟(target, term ≤8 seasons) / break alliance 绝盟(target)
     Changes take effect one season later and are public to every seat. On expiry the
     relation falls back to neutral automatically; this is not a betrayal.
 R18 transit 借道(target, set of commanderies)              —— a clause; feeds R28's
     connectivity check
 R19 scout 探(commandery)  returns ±15% point estimates of that commandery's three numbers
 R20 withdraw 归隐   once per match, irreversible. Gives up every commandery outside the
             administrative seat; thereafter cannot be attacked, cannot expand, yield
             doubles, automatically scored Grade D. **Invoking it is recorded as an
             evaluation metric.**

[RESOLUTION — FIELD BATTLE]
 R21 Effective strength = troops × command-tier coefficient × troop-type/terrain
     coefficient (长戟 halberds > 突骑 shock cavalry > 弩阵 crossbows > 长戟 halberds, ×1.25).
 R22 Ratio ≥1.5 → rout in one clash; 1.2–1.5 → two clashes; <1.2 → a season-long
     standoff. Losses are read from a table by ratio.

[RESOLUTION — SIEGE]
 R23 Breaches = base (commandery seat 0 / subordinate county 4 / pass 0 with engines
     halved) + engine tier (ram +1 / earth ramp +2).
 R24 Breaches the defender can hold = ⌊garrison tier / k⌋. Breaches > holdable → the
     city falls.
 R25 A siege unbroken after 6 xun → automatically lifted. The attacker burns 0.7 and the
     defender 0.5 shi per man per xun (two-way attrition).
 R26 Persuasion to submit: defending officer loyalty <40 and the attacker fields an
     officer with the persuader aptitude → city and officer submit together. Loyalty
     visibility per R31.
 R27 Taking an enemy's administrative seat → you take over all of its commanderies at
     once. The seat can be moved (≤2 times per match, 8-season cooldown).

[SUPPLY]
 R28 Compute connected components once at each season's end: walk from the administrative
     seat along 「own commanderies + allied commanderies covered by a transit clause」.
     Unreachable commanderies: yield to zero (still yours, garrison still there).
     Unreachable armies: disperse next season.
     The commandery holding a pass changes hands → the whole corridor behind it is cut at
     once. The observation gives one supplyCut line.

[OFFICERS]
 R29 Three attributes: command / stratagem / administration, 5 tiers each.
 R30 1–2 discrete aptitude tags: mountain · naval · siege · city defense · civil
     administration · persuader. Who you bring depends on where you fight.
 R31 Three loyalty tiers: Secure 安(≥90, immune to discord-sowing) · Doubtful 疑(40–89)
     · At risk 危(<40, open to persuasion). Fully visible on your own side; the tier is
     visible for the enemy.
 R32 Every threshold is published in the system prompt. An ability is a switch, not a bonus.

[RANDOMNESS — EXACTLY ONE PLACE]
 R33 The only randomness: the roster of recruitable unaffiliated officers at the start.
     Every check is derived from H(seed, year, season, faction, event_kind, event_seq),
     independent of resolution order, replayable bit for bit.

[OBSERVATION ≤4000 tokens]
 R34 Public: ownership of every commandery · each province's controller and each faction's
     commandery count there · each faction's commandery count and population · the
     alliance table with expiry seasons · the epoch
 R35 Tiered + time-stamped: adjacent commanderies' garrison / morale / granary stores
     (13 tiers, geometric 1.4)
 R36 Never visible: other factions' orders this season · private promises
 R37 The full adjacency table sits in the system prompt, KV-cached, not resent each season.
 R38 Battle reports must attribute item by item: which attribute / which aptitude / which
     terrain contributed how much.

[OUTCOME — scored by the highest grade reached at any point this match, not the instant
 of final resolution]
 R39 Grade A: control ≥3 provinces AND hold ≥2 provincial seats AND ≥3 passes along the
     route are in your own or an ally's hands
 R40 Grade B: control ≥2 provinces; or control ≥1 province AND hold ≥1 provincial seat
 R41 Grade C: clear ≥2 chains of passes AND directly-held commanderies ≥ the starting
     count                        ← the floor grade; only attacking can reach it
 R42 Grade D: none of the above. Survival by itself scores nothing.
 R43 Quota: A 300 / B 200 / C 100 / D 0. When several factions reach the same grade it is
     split by directly-held population, and the ratio is negotiable.
════════════════════════════════════════════════════════════════════
  43 rules. For comparison: Haō no Tairiku's core rules ≈75; Go (Tromp–Taylor) 10.
```

### 4.4 Are these 43 rules deep enough? — A self-check by interaction-pair counting

The criterion from `GAMEPLAY-MINIMALISM.md` §9.1: **the independent variable of depth is interaction density (m/C(n,2)), not the rule count n.**
The table below lists, one by one, the rule pairs whose **joint effect ≠ the sum of their separate effects**.

| Interaction pair | Strategic question it produces | Depth type |
| --- | --- | --- |
| R14 muster × R28 connectivity | The muster route has to pass through a connected corridor of your own; can the ally whose land you borrow be trusted | S1 interaction |
| R14 muster × R6 sealed simultaneity | The muster point is public → if I hollow out my rear, will you go hit it | **S4 hidden intent + S5 opponent modeling** |
| R23 breaches × R24 garrison tier × R2 yield tier | Which commandery to attack: high yield → high garrison → how many engines, how many xun of waiting | S1 + S2 timing |
| R23 engines × R25 six-xun window × R9 order cap | Engines need several xun of preparation, drawn from the same pool of 12 chits | **S3 opportunity cost** |
| R4 control(province) × R13 adjacency advance × R39–41 grades | One integer decides both "where I can attack" and "what grade I am in" | S1 (one stone, three jobs) |
| R4 control(province) × R22 field battle | No need to annihilate; one extra commandery flips control → target selection becomes a counting problem | S1 |
| R17 alliance expiry × R43 negotiable quota | The price of a coalition rises over time; splitting the pie vs destroying the opponent | **S5 opponent modeling** |
| R17 alliance × R18 transit × R28 connectivity | An ally's commanderies are my supply corridor; breaking the alliance cuts my grain road | S1 + S6 long range |
| R28 connectivity × R1 passes × R27 decapitation | A pass is a cut vertex: take one pass = cut a whole corridor = force out the enemy's seat | **S1, the densest spot** |
| R31 loyalty tier × R26 persuasion × R23 breaches | A city you cannot storm can be talked into submitting; persuading requires sowing discord first; discord costs orders | S1 × S3 × S5 |
| R30 aptitude × R21 terrain × R13 target | Who you bring depends on where you fight, not on "who is stronger" | **S7 orthogonal differentiation** |
| R9 hard cap × R12 2 orders per commandery × territory | The larger the territory the lower the per-unit bandwidth → anti-snowballing written into the budget | S3 + anti-snowball |
| R7 epoch dual trigger × R42 survival scores nothing | Even if you do not fight you get pushed to the front; the clock will not freeze on collective inaction | S2 timing |
| R20 withdraw × R43 quota | Can self-elimination buy you a share of someone else's quota? (a real bargaining chip) | S5 |
| R27 decapitation takes all × R27 moving the seat | The seat is the single largest point of risk; moving it is a defensive strategic decision | S2 + S6 |
| R33 the single randomness × R38 item-by-item attribution | Every failure can be attributed to some decision rather than to luck | Meta layer (evaluability) |

**16 non-trivial interactions / 43 rules.** On average each rule participates in ≥2 interactions — it passes the blade from §0.3.

**Compared with round one's 20 templates**: `fortify commandery A` and `levy commandery B` have **no interaction whatsoever**; they merely happen at the same time.
The overwhelming majority of combinations inside `C(98,5)` are of this kind. **The interaction density of 43 rules is higher than that of 98 action entries, and that is the concrete shape of "few and dense > many and sparse".**

### 4.5 A self-check against the seven sources of depth

S1–S7 from `GAMEPLAY-MINIMALISM.md` §8, scored item by item against MERS v0.1:

| Code | Category | Where MERS carries it | Score |
| --- | --- | --- | --- |
| **S1** | Interaction / combination | Passes = connectivity cut vertices (R28×R1×R27); control(province) doing three jobs at once (R4) | **Strong** |
| **S2** | Timing / ordering | Epoch dual trigger (R7); xun of engine preparation (R23); alliance expiry dates (R17) | **Strong** |
| **S3** | Resource trade-off | A hard cap of 12 chits + everything costs 1 + 2 per commandery (R9–R12) | **Strong** (no "do everything" path exists) |
| **S4** | Incomplete information | **Only intent is hidden** (R6 sealed + R36); state fog pushed to the minimum (R35 thirteen tiers + R19 point estimates) | Medium (deliberate, see below) |
| **S5** | Opponent modeling | The muster point is public (R14); quota negotiation (R43); the alliance renewal window (R17) | **Strong** |
| **S6** | Long-range credit | Engine preparation, epoch objectives, moving the seat, cultivating supply corridors | Medium (**warning: with `project` cut, keep an eye on this one, see §4.2-10**) |
| **S7** | Orthogonal differentiation | Aptitude tags × terrain × target (R30×R21×R13); a commandery's three numbers are not interchangeable | **Strong** |

**The handling of S4 is deliberate and has to be spelled out**:
the review's §3.5 pointed out that "deterministic resolution + hidden state = deterministic dice".
The theoretical grounding in MINIMALISM §8 is the same thing:
**hidden state mostly produces variance rather than depth** (because the unknown quantity usually cannot be converged on by reasoning — you can only guess);
**hidden intent is what produces depth** (because intent can be reasoned about from past behavior, the current situation, and verbal commitments).
So MERS chooses: **state fog pushed to the minimum (thirteen tiers + point estimates), intent fog pushed to the maximum (sealed orders + simultaneous resolution).**

---

## 5. The revised M1 slice

### 5.1 What has to be done before M1 (zero model calls, all [MUST CHANGE])

| # | Item | Source | Effort |
| --- | --- | --- | --- |
| **0-1** | **The spec for key-derived random streams**, written into `lib/game/engine/`, nailed down at M0 | N1 | Small |
| **0-2** | **E-1, the scenario-randomness checkup (T-Span)**: a deterministic baseline with all six seats playing the same policy, 200 seeds × N matches; models may only start running once T-Span ≤0.15 | WESTERN §10.4 | Medium |
| **0-3** | `commandery-power.json`: normalized population registers (use `population` where the persons/household ratio ∈[3,8], otherwise households×4.92), fill the gaps and tag them `imputed` | Review G1 | Small |
| **0-4** | `commandery-initial-194.json`: cultivated land / commerce / city defenses / morale / garrison / granary stores; **the war-devastation coefficient hand-written per commandery + historical justification** | Review G2 | Medium |
| **0-5** | `zhou-seats-194.json`: 13 provincial seats, each with its historical justification attached (the 194 CE provincial seats differ from those of the *Treatise on Commanderies and Kingdoms* (郡国志) period) | Review G3 | Small |
| **0-6** | `adjacency.json`: in-province Delaunay + a manual cross-province whitelist + terrain sampling, **with all 305 edges reviewed by hand and a note left on each** | Review G5 | 1–2 person-days |
| **0-7** | `strategic-nodes.json`: add `controlsEdge: [郡A, 郡B]`; change `pass` to `capturable: true` | Review G4 | Small |
| **0-8** | `officers.json`: add `deathCause` and `estimatedBirthYear` (464 people lack a birth year; tag them `imputed`) | Review G7 | Medium |
| **0-9** | **The spectator four-pack + side-by-side intent/outcome replay** (auto-advance / neutral observer / vision grants / programmable breakpoints) | MOD §M9 | Medium |
| **0-10** | **Write the absolute-symmetry checklist into the spec** (same rules, same observation schema, same token budget, same action-set generator; the engine does not know which seat is which model; no faction potential / scenario handholding) | MOD §M6 | Small |

### 5.2 What M1 does

| Dimension | Round-one M1 | **Revised M1** | Reason for the change |
| --- | --- | --- | --- |
| Map | 40 commanderies + 20 nodes | **Unchanged** | — |
| Seats | The six Central Plains factions (Cao Cao · Lü Bu · Yuan Shao · Yuan Shu · Liu Bei · Liu Biao) | **Unchanged** | The starting hands differ extremely and are backed by historical sources; the reasoning still stands |
| Match length | 24 seasons | **16 seasons** | Review §5.6; and once C1 is unfrozen, more happens in 16 seasons than used to happen in 24 |
| Action templates | 13 | **8** (MERS R13–R20 + pass) | §4.2 cuts 5 classes |
| Action presentation | Enumerate every legal action (measured at 62–195 entries) | **The engine pre-filters 5–15 candidates, with no scores or ranking** | N7, the proposal channel |
| SP | `5+⌊√n⌋+noble rank+carryover`, priced 0–3 | **`min(5+⌊√n⌋,12)`, everything 1 order (campaign 2)** | §3.2 [OVERTURNED] |
| Concentrating troops | None | **`muster`** | C1, supply side |
| Advance criterion | Take every city | **`control(province) = the most directly-held commanderies in that province`** | C1, criteria side |
| Siege | `A/D ≥ 2.2` | **Threshold lowered to ≈1.6 + a six-xun window + two-way attrition** (breach counts pushed to M2) | C1, resolution side (breach counts are too large a change) |
| Supply | Army supply lines + `scheme:断粮` | **Structural connectivity = yield**, `断粮` deleted | N10 |
| Intelligence tiers | 6 tiers | **13 tiers, geometric 1.4 + `探` returning ±15% point estimates** | Review §3.5 |
| Diplomacy | Structured clauses, permanently in force | **Three stance states + a term ≤8 seasons + one-season delay + visible to every seat + a transit clause** | N9 |
| Clock | 60 seasons, linear | **3 epochs × dual trigger (objective OR timeout)** | N11 |
| Scoring | `0.45 PI + 0.15 prestige + 0.15 survival + 0.25 private objectives` | **Four absolute-threshold grades + a quota + a floor grade that requires attacking + scored by best-ever grade** | N2 [MUST CHANGE] |
| Identity | Only "warlord" | **+ `withdraw` retirement; losing all land is not elimination (an exile flag)** | N3 |
| Officers | 5 attributes + 24 special skills + a loyalty formula | **3 attributes × 5 tiers + 6–8 aptitude tags + three loyalty threshold tiers** | §3.7 |
| Interrupts | Interrupts can cut short the 9-xun advance | **Interrupts only wake, they do not move the clock (the review's option A)** | F2 |
| Wakeups | `requestWakeAt` with no budget | **A global wake budget of 24, counted into the "decision cost" metric** | Review F1 |
| Randomness | A placement table | **+ key-derived streams (R33)** | N1 |
| Cut | — | State policies · projects · private objectives · legitimacy · noble ranks · public outrage · vassalage · bidding for the floor · schemes (keep 离间) | §4.2 |

### 5.3 M1's acceptance criteria (rewritten)

Of round one's five criteria, the review ruled criterion 4 off by 20× (E1) and criterion 1's sample size insufficient. Rewritten as eight:

```
[RUNS AT ALL]
 A1  Total tokens per match < 3M, wall clock < 90 minutes        (the actually attainable
                                                                  values from review §5.6)
 A2  First-level candidate entries for the six seats at the start:
     max/min ≤ 1.5×                                              ★ new this round, an
                                                                  evaluation-validity issue
 A3  Observation ≤ 6000 tokens (commandery-level detail ≤1200), measured, not estimated
 A4  IAR (illegal action rate) < 5%

[RUNS CORRECTLY]
 A5  Bit-for-bit replayable: the same seed and the same order sequence → a byte-identical
     state stream; **shuffle the resolution order and the result does not change**
                                                                 ★ new this round, verifies R33
 A6  E-1's T-Span ≤ 0.15                                         ★ new this round, the gate
                                                                  before running models
 A7  Verified against the 194 data: **nobody reaches Grade A/B/C at the start**
                                                                 ★ new this round
                                                                  (SLG-MOBILE §6.5c)
 A8  Historical calibration: the annexations that historically happened within a year of
     194 CE are feasible under the rules                         (raised in review §3.6)

[MEASURES SOMETHING]
 A9  Given the formulas and a concrete situation, a mid-capability model correctly predicts
     the direction of a field battle ≥ 80% of the time
 A10 depth-ablation, three groups (no scheme / no diplomacy / SP fixed and not growing with
     scale), 5–10 matches each; **each group's drop in win rate = that dimension's
     contribution to depth**; if disabling a dimension does not change the win rate
     significantly → delete that dimension                       ★ new this round
                                                                  (MINIMALISM technique 8)
 A11 Attribute explanatory power: 200 matches with a fixed scripted strategy; the variance
     in outcome explained by initial attribute advantage lands in 25%–40%
 A12 TrueSkill ranking: a Latin-square design, ≥4 repetitions per model per seat
     (24 matches), with ≥ 50% of model pairs having non-overlapping confidence intervals
```

**A cost note (put here so nobody discovers it after work starts)**: the review's §5.5 computed one 24-match evaluation round at
$3,570 on flagship models / $677 mid-tier / $110 budget (the three OpenRouter price tiers as of mid-2026; **unit prices change, what is given here is the order of magnitude**).
And Goodman et al. 2025's mirrored-pairing conclusion means: **do not expect seat rotation to bring costs down; cost has to be saved through mechanism.**

### 5.4 Pushed to M2 and beyond

| Pushed to | Item | Reason |
| --- | --- | --- |
| **M2** | Breach-count sieges (N13) | Requires rewriting §5.5; a large change |
| M2 | Tactic chaining (N14) | Needs a full precondition/after-effect table; **but the schema reserves the slots now** |
| M2 | The full exile state (raid / plunder / resettle) | M1 does only the "not eliminated" half |
| M2 | A legitimacy token replacing the legitimacy line (N?/OE) · mutually exclusive laws replacing state policies (N22) · private objectives unlocked one at a time (N23) | Each requires rewriting a whole block |
| M2 | `outpost` forward bases + full `transit` pricing | Depends on M1's connectivity rule working first |
| M2 | Commitment devices / sworn pledges (N18) · publicly re-declaring the victory condition (N19) | Adds a new class of action and resolution |
| M2 | Free-text negotiation rounds + floor points | Already deferred in round one; keep it deferred |
| **M3** | Administrative capacity (gate 1) + moving the decision object to another layer (gate 2) | Needs calibration; and we should see M1's actual token curve first |
| M3 | The estates system (scholar-gentry / magnate clans / military officers) | WESTERN rates it "the single largest engineering effort in the document" |
| **M4** | Anonymized mode (N6), running A/B for real | Interface reserved at M0, run after the main ranking works |
| **Pending experiment** | Eligibility rotation (N20) | E-3 has to come first; this document draws no conclusion |
| **Pending experiment** | Delegation headroom, E-2 (layered test: S0 all defaults / S1 weak model / S2 strong model) | Answers "has our delegation design delegated away the model's contribution too?" |

---

## 6. Overall priority ordering

### P0 — without these, even a running M1 measures nothing (all [MUST CHANGE])

| # | What to change | Fatal item addressed | Source | Size |
| --- | --- | --- | --- | --- |
| **1** | **Change the scoring framework**: four absolute-threshold grades + a quota + a floor grade that requires attacking + scored by best-ever grade; delete the survival term, delete every defensive objective | **C2** | SGZ:SE Hegemony quota | Medium |
| **2** | **`muster`** (supply side) + **majority-rule provincial control** (criteria side) + a six-xun window with two-way attrition (time-limit side) | **C1** | SGZ:SE + *Civilization and Conquest* + *Haō no Tairiku* | Medium |
| **3** | **Key-derived random streams**, replacing any single global stream | C5 / a precondition for WEGO | RTK11 reverse engineering (cautionary example) | Small |
| **4** | **Verify the grade thresholds against the 194 data; require that nobody reaches a grade at the start** | **C3** | SLG-MOBILE §6.5c | Small |
| **5** | **Interrupts only wake, they do not move the clock** (the review's option A) | **F2** | Adopt the review | Small |
| **6** | **Five data files + one manual pass over the edges** (0-3 through 0-8) | **G2 / G1 / G3 / G5 / G7** | Adopt the review | Large (1–2 person-days + several half-days) |
| **7** | **Rulers excluded from the historical death-year table + succession penalties in three preparedness tiers** | **G7** | Old World + OE | Small |
| **8** | **Everything costs 1 order (campaign 2) + a hard cap of 12 + 2 orders per commandery + maintenance actions free** | **R1 dominant strategy** (review F1/F4/F5 share a root) | *Haō no Tairiku* | Small |
| **9** | **Intelligence in 13 geometric 1.4 tiers + `探` returning point estimates** | Review §3.5 | Adopt the review | Small |
| **10** | **Structural connectivity = yield**, delete `scheme:断粮` | **F4 + G4** | *Rise of Kingdoms* | Small |
| **11** | **Ownerless commanderies' garrison tier runs with their yield tier** | Degenerate strategy **D6** | *Infinite Borders* level 1–10 land | Very small |
| **12** | **Alliances carry an expiry + changes delayed one season + visible to every seat** | **F5** | *Infinite Lagrange* squads | Small |
| **13** | **Epoch dual trigger (objective OR timeout)** | Review §4.4, turtling is a stable equilibrium | *Hongtu Zhixia*'s 20 stages | Medium |
| **14** | **`withdraw` retirement + losing all land is not elimination** | Degenerate strategy **D1** | *Infinite Borders* Peach Blossom Army / Wandering Army | Small |
| **15** | **Cut: public outrage · vassalage · bidding for the floor · private objectives (set to 0)** | **D2/D3/D4** + G8 | §4.2 of this document | Small (it is deletion) |
| **16** | **Change the acceptance criteria to the twelve in §5.3** (including A2, six-seat entry spread ≤1.5×; A5, shuffling the resolution order does not change the result; A6, the T-Span gate) | **E1** | §5.3 of this document | Small |
| **17** | **Run the E-1 T-Span checkup before any model match** | A precondition for E1 | Goodman 2025 | Medium, zero model calls |
| **18** | **Write the absolute-symmetry checklist into the spec** | The legitimacy floor for C5 | Fairplay AI | Small |
| **19** | **Discretize every second-level parameter domain to ≤3–4 tiers** (including `deputies` required to share a station, tribute changed to 3 tiers) | **A1 / A3 / F6** | MINIMALISM technique 2 | Small |
| **20** | **Item-by-item attribution in battle reports** | C5 | (创造三国志) (cautionary example) | Medium |

### P1 — noticeably improves discrimination or cost, does not block getting it running ([RECOMMENDED])

| # | What to change | Solves | Source |
| --- | --- | --- | --- |
| 21 | **The proposal channel**: the engine pre-filters 5–15 candidates, with no scores or ranking | **B1** (legalActions is the largest block) | Nobunaga's Ambition: Awakening 具申 / Taishi 评定 |
| 22 | **"Reconsider" (再考) = a re-reasoning budget** (re-roll the candidate set, but the payoff shrinks) | C5, measurable metacognition | Taishi |
| 23 | **Thresholds for every ability** (loyalty 90/40/25, stratagem unlock tiers, command-based troop tiers) | **C5 / F8** | *Haō no Tairiku* |
| 24 | **Aptitude tags instead of five-attribute ordering** (3 attributes + 6–8 tags) | C5 / **S7** | Harvey Smith GDC 2003 + *Haō no Tairiku* |
| 25 | **Composition preferences instead of formation orders** | C1 / C2 | RTK11's auto-formation defects (learned in reverse) |
| 26 | **A hard-coded seasonal calendar** (grain / gold collection and flood / drought months fixed) | **C5** (a deterministic cycle = a structure you can reason about) | *Haō no Tairiku* |
| 27 | **Freeze `depth-ablation` into a CI task** (three groups, 5–10 matches each) | Turns "depth" into a regression test | MINIMALISM technique 8 |
| 28 | **Three process metrics**: SP allocation entropy / threshold hit rate / lookahead realization rate | An R1 detector + a proxy for reasoning quality + direct measurement of S6 | MINIMALISM technique 8 |
| 29 | **Conditional orders / standing orders** (`if in three seasons commandery X's garrison < N then attack`) | C3, fills the gap between two decisions | *Three Kingdoms: Mou Ding Tian Xia* |
| 30 | **Decapitation takes everything + the seat can be moved** | C6, deletes the mop-up phase | *Dynasty Warriors 8: Empires* |
| 31 | **A three-line theater receipt** (changes in population / morale / provisions + the two commanderies contributing most and least) | B1 + "aggregate decisions, not consequences" | WESTERN §7.5 |
| 32 | **Design the anonymized-mode interface for "hide the stats"** (slot reserved at M0, run at M4) | Project positioning | Three Kingdoms: Alias |
| 33 | **A checkbox authorization list + "soundness of the delegation configuration" as an evaluation metric** | C3 / C5 | Taishi PK |
| 34 | **The spectator four-pack + side-by-side intent/outcome replay** | An engineering precondition for C6 | WH3 Auto-Run & Spectate |
| 35 | **`outpost` + `transit`, priced at "3× for bypassing the adjacency constraint"** | C1, projection distance | *Infinite Borders* fortresses / borrowed land |

### P2 — leave for v2, or needs an experiment to decide

| # | Item | Why deferred |
| --- | --- | --- |
| 36 | Breach counts instead of force ratios | Requires rewriting §5.5; and it **only solves half of C1** |
| 37 | Tactic chaining | Needs a full precondition/after-effect table; the schema reserves the slots now |
| 38 | Administrative capacity (gate 1) + moving the decision object to another layer (gate 2) | Needs calibration; look at M1's actual token curve first |
| 39 | Mutually exclusive laws / legitimacy tokens / commitment devices / re-declared victory conditions / objectives unlocked one at a time | Each requires rewriting a whole block |
| 40 | The estates system | WESTERN rates it the largest engineering effort |
| 41 | **Eligibility rotation (COIN)** | **[UNCERTAIN] E-3 has to come first** |
| 42 | **Delegation headroom** | **[UNCERTAIN] E-2 has to come first**: test the theater-directive layer / the estate-policy layer / the proposal-adoption layer separately; any layer without significant headroom gets deleted or reworked |
| 43 | A shared doom clock / a coalition system (as one alternative route to public outrage) | **[UNCERTAIN]** This document leans toward "just delete public outrage", but neither of these two has been falsified |

### Explicitly not doing (newly added to the "not doing" list this round)

| Not doing | Source | Reason |
| --- | --- | --- |
| An unconditionally triggered everyone-against-you dogpile | Shogun 2 Realm Divide | It lets "identify the leader", a zero-difficulty task, dominate the whole game; dogpiling must be coolable, behavior-weighted, and cooling down must cost opportunity |
| Building slots / domestic layout | Attila + RTK11's "demolish a level 3 to build a level 1" | 105 commanderies × 4–8 slots = 420–840 decision slots; and once there is a layout there will be templates, and templates will inevitably drift away from the situation |
| Quest trees / fixed scenario objectives | Imperator / Terra Indomita | A published fixed scenario → data contamination; and it is the opposite of "measuring autonomous planning" |
| Separate scoring tracks per faction | Here I Stand | Cross-dimensional incomparability, which destroys the comparability of every process metric |
| Letting the 1180 counties into the action set | (创造三国志) (400+ strongholds, the AI piled 91 officers in the capital) | A model with ≤6000 tokens of observation has no chance across 1180 strongholds. **Counties serve only as a derived supply/garrison coefficient** |
| Letting players draw their own theaters | Stellaris / Shadow Empire | Adds a question unrelated to strategy. Use the thirteen Eastern Han provinces as a fixed grouping |
| An LLM as judge | HiStrategy (`emergencescience/histrategy`) | A judge has variance → differences between contestants get drowned out. **We put LLMs in the contestant seat; the judge is a deterministic solver** |
| 500v500 mass battles / chasing on-screen unit counts | Sangokushi Online; (创造三国志) 58.9%, (横戈) 67.3% | Individual decision impact gets diluted; and the value for money is terrible for an independent team (two well-sampled empirical cases) |
| Randomizing the starting conditions of the seats under test | Fairplay AI's "AI Potential randomised" | Randomize only the behavioral tendencies of neutral/unaffiliated factions, and publish that in the observation; **never for the seats under test** |
| Dice driving the main process / duels deciding campaigns | (富甲天下); most domestic titles | Head-on conflict with C5 |

---

## 7. Uncertainties and what this document failed to resolve

Listed under strict discipline, no hedging.

| # | Item | Status |
| --- | --- | --- |
| 1 | **Whether deleting public outrage is correct** | **[UNCERTAIN]**. This document leans toward deleting it (least state, ten years of track evidence), but neither alternative route — a shared doom clock (TS DEFCON) or a coalition system (*Hongtuce*) — has been falsified. **Recommend putting no anti-snowball knob into M1 at all, observing whether the three structural mechanisms R1+R3+R6 suffice, and then deciding whether to add one** |
| 2 | **Eligibility rotation vs everyone at the seasonal council** | **[UNCERTAIN]**. Experiment E-3 has not been run. Both sides have reasonable priors. It bears directly on E1, so it cannot be skipped — but it also cannot be settled before the experiment |
| 3 | **The ceiling of delegation** | **[UNCERTAIN]**. E-2 has not been run. Every delegation design carries one risk: `S(strong model) ≈ S(default)`, i.e. the delegation has delegated away the model's contribution too. Two cautionary references: Stellaris (defaults too dumb) and Distant Worlds (defaults too strong) |
| 4 | **Whether a hard cap of 12 orders collapses the late-game decision space** | **[UNCERTAIN]**. *Haō no Tairiku*'s late game really does converge to "gather troops — take a city — gather troops". The "change dimension" channels proposed here (epochs / quota negotiation / the threshold race) are conjecture, unverified |
| 5 | **Whether MERS v0.1's 43 rules are really enough** | **[DERIVED HERE, UNVERIFIED]**. The 16 interaction pairs in §4.4 are my own count, and the "interaction-pair counting" metric is itself flagged in `GAMEPLAY-MINIMALISM.md` §11 as "original to that document, unverified, with no literature support" |
| 6 | **Whether 13 geometric 1.4 tiers are enough** | The review's reasoning was "tier width 1.4 < the 1.47 spacing between decision thresholds". But once the siege threshold moves to 1.6 the threshold spacing changes, so **the tier width has to be recomputed** |
| 7 | **`muster`'s SP pricing (1 + 0.5 per source)** | A suggested value from `GAMEPLAY-SLG-MOBILE.md`, **with no simulation behind it at all**. And it is in tension with the "everything costs 1 order" principle (0.5 is a fractional order) |
| 8 | **The specific numbers in the grade thresholds (≥3 provinces / ≥2 provinces / ≥2 passes)** | All **pending verification**. A7 requires "nobody reaches a grade at the start", but this document did not run that check |
| 9 | **The complete rules of *Infinite Borders*' Wandering Army** | The official page was not fully retrieved this round; what is cited here is the secondhand account of several strategy guides |
| 10 | **The complete grade table for *Infinite Borders*' 2023-06 season appraisal** | Both scraping attempts returned garbled text. This document uses only the "highest grade ever reached" structure |
| 11 | **The RTK11 RNG reverse engineering** | Community reverse-engineering notes + C code reconstructed from decompilation, **not official KOEI information**; what was checked is the file content itself, and the decompilation was not independently reproduced. But **the conclusion (key derivation beats a single global stream) does not depend on whether it is true** |
| 12 | **The model names and version numbers in the "Cyber Cricket Fighting" experiment** | Not independently verified; the article gives no public repository link. This document cites only its **qualitative findings** (supply was the main failure point, models allied along historical lines, refused battle, struggled to maintain diplomatic consistency, and 2v1 dogpiled) |
| 13 | **Every sales / rating figure cited in this document** | Sources and retrieval methods are tagged in the respective source documents. This document uses no sales figure to support any design conclusion |
| 14 | **What this document did not do** | ① ran no verification computations at all (thresholds, A/D, measured token counts by tokenizer); ② did not check the primary sources of this round's six documents (it trusts each document's own verification-boundary annotations); ③ did not estimate the total effort for the 20 P0 items |

---

## Appendix: how this document maps onto each source document

| Section of this document | Main basis |
| --- | --- |
| §1 N1 · N21 · N28–N30 | `GAMEPLAY-MOD-ECOSYSTEM.md` §2.5 / §2.7 / §6 / §7.3 / §8 |
| §1 N2–N5 · N9–N11 | `GAMEPLAY-SLG-MOBILE.md` §3 / §4 / §5 / §6 / §9 |
| §1 N6 · N26 · N27 · N31–N34 | `GAMEPLAY-CN-INDIE.md` §7 / §8 / §9 / §10 |
| §1 N7 · N8 · N14–N16 | `GAMEPLAY-KOEI-WIDE.md` §1 / §3 / §5 / §7 / §8 / §9 |
| §1 N12 · N13 · N17–N25 | `GAMEPLAY-WESTERN-ANALOG.md` §1 / §3 / §5 / §6 / §9 / §10 |
| §3 · §4 | `GAMEPLAY-MINIMALISM.md` §2 / §8 / §9 / §10 (the blade, R1–R7, S1–S7, the eight techniques) |
| §2 | Cross-reference: `GAMEPLAY-REVIEW.md` §3 / §4 / §5 / §6 / §8 / §9 as the target, the six documents as the answer |
| §5 | Cross-reference: `GAMEPLAY-DESIGN.md` §10 + review §9 + everything from this round |

<!-- translated-from: GAMEPLAY-DESIGN-V2-DELTA.md@0a341cf2a448 -->
