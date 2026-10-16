[中文](EVAL.md) · [English](EVAL.en.md)

# How the eval is run

What this document records is **constraints discovered by measurement**, not design
intent. Every item corresponds to something that cost real money or real time to find
out; rediscovering it is expensive.

## 2026-09-29: memory reset for invalidated attack targets

prompt 1.21.0 / observation 1.6.0: when the old attack target is already ours and is not
under siege, the next season's input clears the old plan and emits `planReset`; the
original plan record is still kept, and defending a city or relieving a siege does not
trigger it.
One real Nano decision no longer claimed that Liaoxi (辽西) had not been taken, but it still
misused `continue` and dropped 3 orders; we cannot claim that strategic reliability is
solved.
Strengthening the static text and the factual summary at the end each got a small-sample
check; the latter has been withdrawn. The three-stage live test, the provider's empty
responses, the costs and the final verification are in the
[report](DECISION-GUIDANCE-2026-09-29.en.md).

## 2026-09-28: a paired comparison of real corrections after receipts

For the season following each of three historical errors, a paired decision was made with
and without the new receipt — six low-cost model calls in all, reported cost $0.01073378.
The Flash-Lite receipt arm recognised the current seat; Nano still confused target
ownership, plan and orders. Both arms had 3 rejected orders, so reliable correction
cannot be claimed.
All six real responses have been replayed for free, with the full resolution state
identical. The tool `tools/decision-correction.mjs` is free by default and supports
`--replay`;
the detailed conditions, the manual reading and the limitations are in the
[correction test report](DECISION-CORRECTION-2026-09-28.en.md).

## 2026-09-28: plan-and-order reconciliation

prompt 1.19.0 and observation 1.5.0 add last season's order receipts, returning checkable
target ownership, state changes and notices about key rejected orders. Game, eval, match
and melee share the same validator; save format 11 remains compatible.
A free replay of 9 historical responses keeps the text, the admission and the resolution
identical, and the next season's receipts are complete; 205 tests and a check on the real
page pass.
This proves the feedback is wired up; it does not yet prove that the model can reliably
correct itself once it receives the new prompt. See
[plan-and-order reconciliation](DECISION-REVIEW-2026-09-28.en.md).

## 2026-09-28: a model-selection comparison on fixed positions

Three identical positions, each tested once with nano, Flash-Lite and mini — 9 decisions
in all, reported cost $0.03473.
mini dropped fewer orders and did execute the key withdrawal, but 9/9 plan states were
still `continue`; changing the model alone is not grounds for claiming strategic
reliability.
The new tool `tools/decision-compare.mjs` is free by default, requires an explicit
`--live`, and reserves a cost ceiling of $0.20;
`tools/verify-decision-comparison.mjs` replays the saved responses for free, and all 45
resolutions were checked.
The manually constructed conflicting old plan, the scoring convention, the per-position
conclusions and the cost limitations are in the
[model comparison report](DECISION-COMPARISON-2026-09-28.en.md).

## 2026-09-28: review feedback 1.4.0

prompt 1.18.0 adds a requirement to re-check the actual net gain and loss at season end
and the state of the seat; the rule pack is still 2.3.0.
Of the 94 city losses, 6 used to be truncated by the prose battle report; the structured
summary now covers 94/94.
All 12 cheap-model decisions succeeded, but there were still 2 cases of completely
repeated re-checking and of misreading the timeline, so improved play cannot be claimed.
The per-season results of natural unification over six seeds match the previous version;
the 12-game controller comparison did not prove faction balance either.
See [this round's report](STRATEGY-REVIEW-2026-09-28.en.md).

## 2026-09-28: rule pack 2.3.0 and structured plans

2.3.0 unifies the combined-order reservation across model, player, bot and resolution;
the prompt moves up to 1.17.0.
Bots now also filter duplicate campaigns and cumulative resource conflicts, so **the
results of 2.2 and 2.3 are not directly comparable**.

The current free baseline passes 4/4 over 100 games; the correlation coefficient between
commandery count and score is 0.13, and Cao Cao (曹操) is eliminated in 25/100.
Unification mode finishes naturally 6/6 (21–52 seasons), but always as Yuan Shao (袁绍),
which is not grounds for claiming faction balance.
Three fixed natural positions were each tested with two cheap models for two seasons; the
12 successful decisions adopted 84 orders and discarded 15,
with 0 resolution rejections after adoption. That sample only validates the protocol and
the continuous feedback; it is not a model ranking.

`tools/strategy-cases.mjs` is free by default; `--live` explicitly enables cheap models,
with hard limits on the price check, the number of calls,
output tokens, timeout and reserved cost; `--resume-from` reuses successful seasons to
avoid paying twice.
The first two Nano responses are reused from before the schema was simplified; full
compatibility, cost and evidence are in
[strategy plan acceptance](STRATEGY-PLANS-2026-09-28.en.md).

## 2026-09-28: rule pack 2.2.0

2.2.0 adds troop transfer and late-game submission, fixes officer reassignment for
absorbed officers and the siege forecast, and limits automatic reinforcement when pay is
in arrears.
**The leaderboards of 2.1.0 and 2.2.0 are not directly comparable**; the model prompt is
1.16.0, and old saves must be restarted.

The new free baseline has been re-run: `npm run selfplay` over 100 games, 4/4 acceptance
gates pass, the correlation coefficient between starting commandery count and score is
0.27, and Cao Cao is eliminated in 21/100.
Unification mode additionally ran 6 fixed seeds with an external test budget of 256
seasons; 6/6 ended naturally (20–217 seasons).
The rules are the same in both ending modes; a normal game is not decided by running out
of eval seasons or test budget.

To reproduce: `node --experimental-strip-types tools/unification-audit.mjs --seeds 6 --budget 256 --out /tmp/unification-check`.
The raw results are in [this round's records](reports/strategy-finish-2026-09-28/) (Chinese).
Six games passing proves that a natural finish is possible; it is not a guarantee that
every seed will end within 256 seasons.

## The one-minute version

```bash
# baseline, costs nothing, always run it first
npm run eval -- --agent=bot:balanced --games=48

# a single model
npm run eval -- --agent=model --model=anthropic/claude-sonnet-5 --games=48

# leaderboard
npm run eval:suite -- --agents=bot:balanced,bot:purpose,model:<id>,model:<id> \
  --games=48 --reasoning=low --jobs=4 --budget=6 --out=./eval-out

# take one run apart: by seat, action mix, dropped orders, order-budget utilisation
npm run eval:dissect -- eval-out/board1/*.json

# a full season-by-season record of one game (engine-level formulas, full candidate text, per-commandery diff, out-of-game metadata)
npm run match -- --model=<id> --seasons=32          # seat drawn at random
npm run match -- --model=<id> --seasons=32 --pick3  # draw three and pick one interactively

# multiple models fighting in the same game (fun to watch, but **not a leaderboard**: A's result depends on how B played that day)
npm run melee -- --seats=caocao=<id>,yuanshao=<id> --seasons=32
```

`--budget=<dollars>` is the stop-when-exceeded gate, and `--provider=A,B` pins the
provider (see point 7);
inside a suite, each agent is pinned by writing `model:<id>@BaseTen+Modal` — on one
leaderboard the fast provider for each model
is a different company, so run `npm run models` before opening a leaderboard (see
point 23).
`--maxcost=<dollars>` (default 1.5) is the gate that fires **before** the run: any agent
whose estimate exceeds it is refused,
so use the cheap tier during development and let the expensive ones through explicitly
(see point 22).
**Do not have a browser or the dev server open while running a leaderboard.** For the
same run with the same provider,
throughput is 0.73 seasons/minute with Playwright and `npm run dev` open, and 2.7 with
them closed — **a factor of 3.7**.
The eval process itself is I/O-bound and does not eat CPU, but browser compositing and
vite's compilation saturate the machine
(load measured at 13/14 cores), which drags down the round trip of every request.
(This item has not ruled out the provider's own variance, but the direction is clear
enough: free up the machine when you open a leaderboard.)

`--resume=<existing json>` continues a run without re-running the games that already
finished (after stopping against the budget, topping up
the last few games no longer means paying again for the dozens before them); a mismatch
in settings refuses to resume.
A resumed file was measured to be bit-for-bit identical to a run done in one pass.

A single `npm run eval` prints one heartbeat line per season (game/season/order
count/rung/elapsed/attempts),
and `--heartbeat=off` turns it off; the suite turns it off by default — several
concurrent arms interleave and flood the screen, and it also fills up the
only live stderr there is when something fails. **But turning off the screen is not the
same as not recording**: if `--json` is given, a copy is also written
to `<json>.log`, so halfway through a suite, to find out whether an arm is slow or hung,
just `tail` that file.

Keys go in `.env.local` (already in `.gitignore`). **You must go through `npm run
eval`** — the script is
plain node and only reads them via `--env-file-if-exists=.env.local` in the npm script;
running `node tools/eval-run.mjs` directly will not see them.

## Twenty-one hard constraints

### 1. Below 48 games, a ranking is not a conclusion

Take `bot:purpose` vs `bot:balanced` (a gap of about 20 points in self-play) and compare
them pairwise on the same seeds and the same seats:

| Games | Paired diff | 95% CI | Separable |
|---|---|---|---|
| 6 | +0.0 | ±0.0 | No, **the two score exactly the same on every seed** |
| 12 | +16.7 | ±32.7 | No |
| 24 | +20.8 | ±23.5 | No |
| 48 | +29.2 | ±19.3 | Yes (barely) |
| 96 | +20.8 | ±12.6 | Yes |

The root of it is that the scoring table has only four grades (Grade A 300 / Grade B 200 /
Grade C 100 / Grade D 0), so the paired difference per game can only be 0 or ±100.
Switching to a continuous metric does not save the situation: commandery gain carries no
signal at all, and the direction is reversed — purpose scores higher while taking fewer
commanderies (−0.4). That is backwards evidence that `gain` is right: it picks valuable
commanderies, not numerous ones.

`tools/eval-suite.mjs` warns twice below 48 games. Runs below that number are still
useful — validating the pipeline, catching crashes, looking at the illegal rate — but the
ranking is not a conclusion.

### 2. There must be a bot baseline

A model scoring "200 on average" says nothing unless you know what `bot:balanced` scores
on the same seat and the same seed (166.7 measured over 6 rotating games). The baseline
is free; always run it first.

The bot walks **exactly the same** path as the model: `picks → admit() → orders`.
If it bypassed the admission layer, the illegalRate and order-budget-utilisation columns
would be empty for the baseline, and those are precisely the reference for judging
"is the model issuing nonsense orders".

### 3. `--reasoning=low` is not normalisation — for some models it is an "on" switch

Measured on claude-haiku-4.5, the same batch of 6 games:

| | Output tokens/call | Reasoning share |
|---|---|---|
| without `reasoning` | 103 | 0% |
| with `--reasoning=low` | 1011 | 56% |

It **turns on** thinking that was off, and output tokens go up 10×. Meanwhile
gemini-3.1-flash-lite given `low` is still 91% reasoning, and hard-failed 3 times
(`finish=error`).

In other words, "give every model the same effort" does not produce equal test-time
compute: models that do not reason by default get switched on, models that reason by
default get turned down, and models that ignore the parameter are unaffected.
Three effects, one parameter. Decide which one you want before using it; whether or not
you pass it, the report lists the reasoning share.

### 4. The fallback rung and the reasoning share must be reported, or scores are not comparable

**Fallback rung**: the client has a four-rung ladder `schema → schema-notemp →
schema-any → text`, each rung relaxing one constraint. Models that land on different
rungs are under different constraints (with or without decoder-level enforcement, with or
without temperature), so their scores are not fully comparable to begin with.

Why `schema-notemp` is needed: `provider.require_parameters` requires the endpoint to
support **every** parameter in the request, and OpenAI's reasoning-family endpoints do
not accept `temperature` — the two collide, OpenRouter filters 4 endpoints down to 0, and
returns a 404 "No endpoints found".
All 16 calls to gpt-5-nano were measured to land on this rung; without it they would all
have fallen back to free text.

**Reasoning share**: gpt-5-nano was measured to burn 6739 output tokens per call (97.7%
of it reasoning), while claude-haiku-4.5 burns only 103 — a factor of 65.
Without specifying `--reasoning`, what you are comparing is not strategic ability but how
much test-time compute each vendor hands out by default.

- To unify the rung: `--reasoning=low`. gpt-5-nano's output tokens were measured to go
  107830 → 25338 (4.3× less), with no change of rung
- Comparing at factory settings is also a legitimate convention, but it must be an
  explicit choice. The report warns when the reasoning share is over half and
  `--reasoning` was not specified

### 5. Failures need four buckets, and only one of them counts against the model

    credits account credits exhausted —— the whole run is void, nothing to do with model ability
    infra   timeout / network —— infrastructure
    budget  output-token budget eaten by reasoning —— a harness configuration problem
    model   cannot answer / cannot be parsed —— only this bucket counts against the model

**The same hole was fallen into twice: a failure with no bucket lands in model.**

The first time was timeouts: kimi-k2.5 was reported as "the model could not answer for 55
seasons", of which 54 seasons were 180s timeouts.

The second time was exhausted credits. A leaderboard of eight Chinese models × 48 games
was run, and the result was:

    bot:balanced            147.9   baseline
    deepseek-v3.2            35.4   −76%
    qwen3.7-plus             27.1   −82%
    …
    xiaomi/mimo-v2.5          4.2   −97%

It looks like "Chinese models across the board lose to the rule bot". The truth is that
**the account balance ran dry** — of each model's 768 seat-seasons, 688–765 seasons'
requests were never even sent, OpenRouter returned
`This request would exceed your available credits`, and that 402 belongs under
`budget`, which had no corresponding bucket in model-seat, so it fell into the default,
model.
An order-budget utilisation of 0–7% and a total of only 278 calls (it should be on the
order of six thousand) are both manifestations of the same thing.

Now: `credits` is its own column; `eval-run` calls `process.exit(3)` and stops on the
spot when it sees one; `eval-suite` aborts the whole run on exit code 3 and stamps "the
rankings below are unusable" at the top of the leaderboard.
Continuing would only pile up a few hundred "the request was never sent" records into an
impressive-looking fake leaderboard.

Measured lesson: in one 6-game suite, kimi-k2.5 had 55/96 seasons and deepseek-v3.2 had
35/96 seasons recorded as "the model could not answer". On investigation, **all 54 of
those seasons and all 35 of those were `The operation was aborted due to timeout`** — a
180s per-call timeout is not enough for slow providers (deepseek was measured at 38–69s
per call and frequently blew through under eight-way concurrency).
Ranking by that report is ranking by how fast the providers are.

The default timeout was therefore raised to 300s. When infrastructure failures exceed
20%, the suite flatly annotates "the ranking on this row is not trustworthy".

The same batch of data exposed another fabrication: failure records kept the initial
placeholder `rung` of `"text"`, so the report showed a rung distribution like "kimi
text×54" that never happened. Failure records now have a null rung, and the rung
distribution only counts successful calls.

### 6. Harness failures must not be charged to the model

The output-token budget being eaten by reasoning (empty content, `finish_reason=length`)
is us not letting it finish, not the model failing to answer. The default `max_tokens` is
8000, doubling on starvation up to 32000; the report counts the two failure types
separately.

The consequence of the old value of 2000: all 16 of gpt-5-nano's seasons returned an
empty string, and the report recorded "could not parse a decision / 0 points /
order-budget utilisation 0%" — which looks like the model being bad.

### 7. Without pinning the provider, "the same model" is not the same thing

OpenRouter routes by availability. In one 24-season record, the same model id bounced
across **7** providers (Parasail / Cloudflare / Fireworks / Together / Venice / NextBit /
Morph). Three consequences:

- quantisation precision and context implementation differ by vendor;
- median per-call time 11.2s, slowest **723.9s** (a factor of 45), and that slow one also
  dropped the stream;
- the prefix cache is stored per provider, and the hit rate fell to **2%** (197k input
  tokens, only 4k hits).

The first leaderboard was dragged down by exactly this: two models hit the wall-clock
limit having completed only 38/48 and 26/48.
`--provider=A,B` pins it (default `allow_fallbacks:false`). Not pinning is also fine, but
then you have to read the actual-provider column in the report before drawing
conclusions — the provider and generation id of every call are written to disk
individually.

### 8. The gates themselves will lie to you; verify the gate first

Three real examples, all "the check passed" while in fact it did not:

- **The observation budget gate only tested 16 seasons, and counted a cross-season
  strategy plan as null, i.e. 2 tokens.**
  But the match interface offers a 104-season option, and the `mine` section of the
  observation grows linearly with territory (95 tok per commandery); the strategy plan's
  median in a live run is 173 tok. Re-measured under the worst case: **27/341 seat-seasons
  blow the ceiling**,
  whereas at the time it reported "✓ all pass, Yuan Shao has +86 to spare" — the truth is
  −87, off by a sign.
  Every trade-off of the form "there is no budget, this field cannot be added" was built
  on that number.
- **`npx tsc --noEmit` will, when node_modules is missing, install a hollow 2015 package
  `tsc@2.0.4` on the spot**, and then "pass". Use `./node_modules/.bin/tsc` or confirm the
  dependencies are there first.
- **The Cao Cao criterion compared point estimates directly at n=24**: even when the true
  elimination rate is 45%, there is a four-in-ten chance of it going red. Changed to a
  one-sided 95% lower bound — the criterion does not move, but it is judged at the
  strength the sample can support.

The whole value of a criterion is that "when it goes red there really is a problem". A
criterion that lies forty percent of the time soon stops being read.

### 9. Miss one item in the observation and the model is reasoning under the wrong rules

This class of problem is the most insidious: everything "runs fine", scores come out, and
it is only the information in the model's hands that is wrong. Every row is measured:

| Defect | Consequence |
|---|---|
| Voided order counts are not returned | The model starts from scratch every season and does not know whether it spent last season's budget; measured utilisation 67%–92%, bot 93%, one game throwing away fifteen hundred to nineteen hundred orders |
| `clock.epoch` only sends a sequence number | The only consequence of an epoch advancing is that garrisons in ownerless commanderies grow each season (0→8%→15%), and the model can see neither the growth rate nor how many seasons are left in this epoch — the entire time value of "take ownerless land early" does not exist |
| The briefing filters out provinces where "I hold 0 commanderies and there is no vacant land" | That filters out exactly the **neighbouring provinces entirely in someone else's hands** — Lü Bu (吕布) cannot see the Xuzhou (徐州) whose five commanderies all belong to Liu Bei (刘备), and that is his most valuable direction |
| Reassignment candidates only list that person's politics | The grand administrator is derived as "the highest-politics officer stationed in this commandery", and income is scaled by it, yet how many points the incumbent has cannot be found anywhere in the observation — "will moving him in replace the grand administrator" cannot be judged |
| Supply cut is not in the observation | The model massed 2033 men in a commandery that was cut off, they ran out of grain and scattered that season, and its intent was still "march from here next season" |
| `clock.totalTurns` reads the content pack default and is permanently 16 | Even a 104-season game tells the model "16 seasons in total" |
| `mine[].officers` takes the first three by id order | **63.6%** of the time the three reported are not the ones actually holding the city, and the model reassigns officers on that basis |
| The breach/defensibility of an assault is not returned in the battle report | "Press on or pull back" on a siege has no basis: in one record Yuan Shao reinforced a siege with "breach 0 against defensibility 4" |
| Armies in a siege have no look-ahead forecast | 100% blank; the only way is to infer backwards from last season's result |
| Relief candidates ignore armies standing by | The label says "can send 2425" while the engine sends 1084, so the wording and the outcome have opposite signs |
| The pack says "a siege is automatically lifted if the city is not taken in 6 xun (ten-day periods)" | The engine uses 3 **seasons**; the model believes a siege cannot last past one season, so it does not reinforce to keep it going |
| The pack says "±15% once scouted" | The error ratio is 0.08 |
| scout promises to reveal yield and morale | The engine only gives garrison and formation, while morale is a direct input to the success rate of persuading a city to submit |
| An entire "consumption" section is about grain upkeep | params.ts reads not one field of it, and the money section says "no separate troop provisions" |
| Passage generates no candidates | The summary promises it in three places, and across a live 48-season run `passages` is permanently empty |

The way to find these is **four-way reconciliation**: the rules as written in the content
pack × the state in the engine × the fields in the observation × what the interface shows
a human. `supplyCut` was found exactly this way — the interface table had long had a
"supply" column, the observation did not, and so the human and the model were not looking
at the same war.

### 10. As games get longer the bot's score rises while its territory shrinks — what rises is the number of dice rolls

Someone suspected that "16 seasons is too short; a side that can plan does not have time
to snowball". Verified with bots: five profiles × 16/32/64 seasons × 48 games = **720
games**, zero cost, finished in 113 seconds.

| Game length | Purpose mean score | Purpose territory multiple | Aggressive territory multiple | Elimination rate (five factions) |
|---|---|---|---|---|
| 16 seasons | 158.3 | 1.37 | 0.92 | 0~38% |
| 32 seasons | 164.6 | 1.37 | 0.74 | 6~48% |
| 64 seasons | **172.9** | **1.29** | **0.41** | **21~67%** |

**The mean score rises and the territory shrinks.** These two columns must be read
together — the score rises because `bestGrade` is a **ratchet on the best-ever grade**
(`resolve.ts`: `if (RANK[grade] > RANK[f.bestGrade])`), and the longer the game the more
chances there are to touch Grade B/A, and once touched, being wiped out afterwards does
not take the points back.
At 64 seasons the purpose profile is destroyed in 44% of games, and is still scored at
its best-ever grade.
**That is not "it snowballs in the late game", that is more dice rolls.**

The one positive finding that survives a proper test is the **death rate**: on the same
seeds, the difference-in-differences from 16→64 is significant for all five profiles
(+20.8pp±11.6 to +39.6pp±14.0).
The strategy gap itself was not amplified — purpose over balanced is +4.2 → +6.2 →
+10.4, monotone in direction but with all three intervals covering zero; the
difference-in-differences @64−@16 = +6.25±14.8, also not significant.
This is "cannot measure it", not "it is not there": the interval leaves room for the
advantage to double.

**Ascendant/Hegemon/King, all three grades, were never once reached across 720 games.**
Max zhouGain = 3 (Ascendant needs 4), max absolute provinces controlled = 3 (Hegemon
needs 7, King needs 11), zero unifications. The content pack's notion that "only long
games can reach Ascendant/Hegemon/King" is entirely unrealised at the rule-bot level.

What this experiment can falsify is the bot's half of "it is purely because the game is
short" — **the rule bot has nothing longer-range to unfold over 64 seasons either**. The
model's half has not been tested yet.

#### So a "final-standing score" column was added, and it turns the ruler the other way round

`finalGrade` = which grade you are actually standing on at the moment the game ends,
reported alongside the ratcheted `bestGrade`. The same batch of 48 games:

| | Mean score (best-ever) | Final-standing score | Divergence |
|---|---|---|---|
| 16 seasons purpose | 158.3 | 114.6 | 19/48 games drop a grade, −44 on average |
| 16 seasons aggressive | 137.5 | 75.0 | 24/48 games drop a grade, −63 on average |
| **64 seasons purpose** | **172.9** | **104.2** | 27/48 games drop a grade, −69 on average |
| **64 seasons aggressive** | **147.9** | **33.3** | 36/48 games drop a grade, −115 on average |

**The best-ever grade rises with game length; the final-standing score falls with game
length.** The two lines run opposite.

More important is resolving power. The paired difference of aggressive against purpose:

| | Best-ever grade | Final-standing grade |
|---|---|---|
| 16 seasons | −20.8±22.6　not significant | **−39.6±36.8　significant** |
| 64 seasons | −25.0±27.1　not significant | **−70.8±36.4　significant** |

**Two styles of play the ratchet ruler cannot separate, the final-standing score can, and
the longer the game the better it separates.**
A scoring scheme based on "once touched Grade A" inherently wipes "could not hold it" off
the books — and not holding it is exactly the most expensive mistake in a long game. With
both columns side by side on the leaderboard, the divergence is itself information.

A silent failure was fixed along the way: `tools/eval-suite.mjs` did not forward
`--seasons`, so `npm run eval:suite -- --seasons=64` would **run 16 seasons with no sign
of it in the report**.
Subprocess arguments are the only interface between the suite and eval-run; adding a
parameter means adding a line there.

### 11. The first Ascendant grade appeared in a 32-season melee — 720 bot games produced zero

Two models each holding three seats in the same game (glm holding Cao Cao / Yuan Shao /
Liu Biao (刘表), hy3 holding Lü Bu / Yuan Shu (袁术) / Liu Zhang (刘璋)), played out to 32
seasons, $0.386, 137 calls:

| Seat | Model | Start | End | Provinces | Best-ever/final grade |
|---|---|---|---|---|---|
| Yuan Shao | glm-5.3-flash | 13 commanderies | **40 commanderies** | **6 provinces** | **Ascendant / Ascendant** |
| Liu Biao | glm-5.3-flash | 7 commanderies | 11 commanderies | 1 province | Grade A / Grade C |
| Liu Zhang | tencent/hy3 | 9 commanderies | 16 commanderies | 1 province | Grade B / Grade B |
| Cao Cao | glm-5.3-flash | 1 commandery | 0 commanderies | — | Grade B / Grade D |
| Yuan Shu | tencent/hy3 | 2 commanderies | 0 commanderies | — | Grade C / Grade D |
| Lü Bu | tencent/hy3 | 6 commanderies | 0 commanderies | — | Grade D / Grade D |

**The Ascendant grade (province gain ≥4) had never been reached before**: the rule bot's
best over 720 games was 3 provinces and 25 commanderies, and on the four-model 48-game
leaderboard the province gain never exceeded 2. So the line in the previous item —
"the bottleneck is not the clock, it is that the rule bot cannot snowball" — is right:
**the model can.**

**But this is one game, not a ranking.** In a melee, A's result depends both on itself
and on how B played that day, and it is not comparable across games. It answers "of these
few, who survives at one table", not "who is stronger".

One piece of side evidence: the Cao Cao seat's season 15 strategy plan reads "pick up
more ownerless Yuzhou (豫州) commanderies (garrisons +15% per season, take them early)" —
it is making decisions with the epoch information that had just been added to the
observation, where previously there was only a bare `epoch: 1` (see point 9).

### 12. The longer the game, the model is not stronger but more polarised — and the old ruler only sees the good pole

The other half of the experiment missing from point 10, run with a model:
glm-5.3-flash against bot:purpose, the same batch of 24 seeds, rotating seats, provider
pinned to Parasail, **once at 16 seasons and once at 64**. Actual charge $2.73.

|  | Model mean score | Model final-standing score | Bot mean score | Bot final-standing score |
|---|---|---|---|---|
| 16 seasons | 154.2 | 100.0 | 154.2 | 112.5 |
| 64 seasons | **191.7** | **62.5** | 166.7 | 104.2 |

**The same data, two rulers, opposite answers.** By best-ever grade, the model leads the
bot at 64 seasons by +25.0±46.1; by final-standing grade it trails by −41.7±71.7. Neither
is significant, but the signs are opposite — because the ratchet records "did you ever
touch it" and the final standing records "did you hold it".

Three numbers that show the mechanism:

| | 16 seasons | 64 seasons |
|---|---|---|
| Model ends with 0 commanderies | 7/24 | **14/24** |
| Model territory multiple | 1.04 | **0.72** |
| Model order-budget utilisation | 80% | **76%** (the bot is 92% at both lengths) |

A territory multiple of 0.72 means: **on average it ends with less than it started
with.**
The 64-season final-grade distribution is "Ascendant 1, Grade A 1, Grade B 4, Grade D
18" — eighteen games with nothing at all, and at the same time one game that reached 44
commanderies and 6 provinces. The bot is "Grade A 3, Grade B 7, Grade C 2, Grade D 12",
with neither that high a head nor that long a tail.

**So it is not "the later it gets the easier it gets", it is "the later it gets the more
polarised it gets".**

The ceiling half is real, and it is not statistical inference but fact: the model's
64-season peak is **Yuan Shao 13→44 commanderies, 2→6 provinces, Ascendant reached in two
games**; over these 24 games plus the 720 games of point 10, the bot's peak is 27
commanderies and 3 provinces, with **zero Ascendants**.

Per seat it is more extreme still (n=4, extremely noisy, treat as a lead only): on the
Yuan Shao seat the model ends with 27 commanderies on average and the bot is **wiped out
4/4**; on the Liu Biao seat it is the reverse, the model is **wiped out 4/4** and the bot
holds 19 commanderies.

Two methodological entries:
- **The difference-in-differences is not significant anywhere** (final-standing grade
  −29.2±46.4). A four-step ladder × long games: 24 games cannot resolve "how the size of
  the lead varies with game length". Measuring that requires a finer ruler first.
- This run changed six things at once (pinning the provider, epoch information, the
  briefing, grand-administrator politics, de-duplicating internal-affairs candidates,
  order-count feedback), **so it is not a clean single-variable comparison**.
  The only thing that can be said on its own is order-budget utilisation: for the same
  game numbers 0–23 at the same 16 seasons, 74% → 80%, and orders thrown away per season
  2.20 → 1.69 — the throughput improvement is certain, but it did not buy any points.

### 13. That four-step ruler cannot resolve a single cell to significance at 48 games

Pair the six bot profiles with each other × three game lengths = **18 cells**, 48 games
each (free, 113 seconds), and measure the same paired data with three rulers:

| Ruler | Median signal-to-noise | Median ties | Cells significant at 48 games |
|---|---|---|---|
| Four grades (current) | 0.151 | **28/48** | **0/18** |
| Fine-grained (fineScore) | ≈0.15 | 14/48 | 0/18 |
| **Continuous (province progress)** | **0.193** | **8/48** | **4/18** |

**The four-grade ruler does not reach significance in a single one of the eighteen
cells**, and two thirds of the games are recorded as ties. This is not a "48 games is not
enough" problem — the ruler itself throws the information away.

The continuous ruler = `100 × (province-progress gain + 0.5 × province-seat gain)`, where
**province progress** is computed per province as "my commanderies ÷ the number needed
for a majority", capped at 1, summed over the whole map (`zhouEquiv` in `victory.ts`). It
spreads the step of grade assignment into a slope, and it **grows on the grading
criterion's own axis**: what a commandery is worth depends on which province it is in and
how far that province still is from being controlled (Xuzhou's five commanderies need
three for a majority, so one is worth 1/3; Yizhou's (益州) twelve need seven, so one is
worth 1/7), and once controlled, one more is worth nothing — the continuous version of
the very same rule as "the fifth scattered commandery is worth 0".

Using commandery gain as the fine-grained metric cannot do this, as the failure of the
`fineScore` version already proved: purpose scores higher while taking fewer commanderies
(−0.4), so commandery count is not the objective function.

**The cost has to be stated plainly.** Cell by cell, it is more sensitive in 12 and
blunter in 6: when it wins it wins big (up to 9.3×) and when it loses it loses small (down
to 0.47×). It wins reliably on **long games** and against **clearly unequal opponents**,
and is unstable on near-equal opponents at 16 seasons — in 64-season self-play the
aggressive profile's province progress is **−49** (it ends behind where it started), and a
grade score of 147.9 covers that up completely.

Two pieces of methodological discipline:
- Back-computed numbers of the form "how many games are needed for significance"
  (n ∝ 1/mean²) **are only trustworthy when the mean itself is significant**.
  Only four of the eighteen cells are significant; the rest have an n built on a point
  estimate that covers zero, and must not be quoted.
  This repository already paid for this same mistake once, in point 14.
- The province-seat weight was swept over 0 / 0.25 / 0.5 / 1, giving median
  signal-to-noise of 0.210 / 0.197 / 0.193 / 0.193 — **the differences are within the
  noise**. 0.5 was chosen because the grading criterion itself says so (1 province + 2
  province seats = 2 provinces = Grade A), not because it fits best. Tuning parameters
  against a metric stops holding the moment the pack changes.

A "province progress" column was added to the leaderboard, alongside mean score and
final-standing score. The three columns answer three different questions:
**what you once achieved, what you held, and how far you are from controlling a
province.**

### 14. One game played out to 104 seasons: Hegemon was reached, unification still was not

glm and hy3 each holding three seats in the same game, played out to 104 seasons, $0.874,
262 calls.

| Seat | Model | Start | End | Provinces | Grade | Survived |
|---|---|---|---|---|---|---|
| Yuan Shao | glm-5.3-flash | 13 commanderies | **76 commanderies** | **10 provinces** | **Hegemon** | 104 seasons |
| Liu Zhang | tencent/hy3 | 9 commanderies | 16 commanderies | 1 province | Grade A | 104 seasons |
| Liu Biao | glm-5.3-flash | 7 commanderies | 0 | — | Grade A/Grade D | 27 seasons |
| Yuan Shu | tencent/hy3 | 2 commanderies | 0 | — | Grade C/Grade D | 7 seasons |
| Lü Bu | tencent/hy3 | 6 commanderies | 0 | — | Grade D | 16 seasons |
| Cao Cao | glm-5.3-flash | 1 commandery | 0 | — | Grade B/Grade D | 4 seasons |

**The Hegemon grade (absolute control of ≥7 provinces) had never been reached before** —
the bot's best over 720 games was 3 provinces, and the 32-season melee's best was 6
provinces (Ascendant). **But unification (11 provinces) still did not happen**: it got
stuck at 10.

What matters is **how** it got stuck. Season by season for Yuan Shao:

| Season | Commanderies | Provinces | Troops | Treasury |
|---|---|---|---|---|
| 1 | 13 | 2 | 99,644 | 600 |
| 17 | 36 | 5 | 132,137 | 21,205 |
| 33 | 73 | 9 | 253,131 | 45,147 |
| **41** | **76** | **10** | **325,290** | 22,057 |
| 49 | 75 | 10 | 202,455 | **0** |
| 65 | 69 | 10 | 196,345 | **0** |

**It peaked in season 41, then the treasury ran dry and troops fell from 325,000 to
178,000.**
The battle report carries one line every season: "pay cannot be sustained (3263 gold
needed, 271916 troops), 18334 men deserted".
Pay is 0.012 gold per soldier per season, while income decays by 0.85 per commandery —
the twentieth commandery is already worth little.
**It expanded its territory to a place the economy could not support**, and spent the
next sixty seasons unable to move either way at 10 provinces.

This is the live version of point 12's "the later it gets the more polarised it gets", and
here the mechanism is visible: **it is not a judgement problem, it is that it cannot work
out whether it can afford its own army.** And under the current grade ratchet this game
scores 500 (Hegemon), wiping out the sixty-season collapse entirely — the final-standing
grade is also Hegemon, because the absolute criterion ignores the gain. This game happens
to be the kind none of the three rulers covers: to see the collapse you have to look at
the troop and treasury columns.

One tooling note along the way: the melee recording used to record only the first seat's
thinking, and **the first seat may be eliminated early** (Cao Cao was gone by season 4),
leaving the entire timeline with only two anchors. After changing the anchors to watch
all model seats, there are 73.

### 15. Providers will mangle the encoding of Chinese keys, and that gets recorded as the model's illegal rate

On the second leaderboard, qwen3-30b's illegal rate was **50.9%** (it was 1.0% on the
previous one) and its order-budget utilisation fell to 31%. On investigation: all 2806
`unknown-key` entries looked like this —

```
'appoint:æµ\x8eé\x98´é\x83¡:caoren'   ← should be 'appoint:济阴郡:caoren'
```

Chinese encoded as UTF-8 and then decoded again as Latin-1. **Every single one of them had
actually chosen correctly.**
This is an encoding problem in the routing layer or at the provider, unrelated to model
ability, and we were counting it as "that key is not in the candidate table" — once again
charging an infrastructure failure to the model.

The admission layer now restores it (`Buffer.from(key,"latin1").toString("utf8")`), but
**only accepts it when the restored key happens to hit a candidate**, so genuine
hallucinations are not whitewashed: a fabricated key is still not in the table after
restoration. The restoration count is reported separately, and when non-zero the report
prints a line "N keys were mangled by the provider's encoding (restored) — not counted in
the model's illegal rate".

Incidentally: both models that had the problem landed on the `schema-any` rung. On the
strict schema rung, the enum is enforced by the decoding layer, and a broken encoding is
rejected outright by the endpoint; once dropped to schema-any, the enum is no longer
enforced, the model assembles keys freely, and the encoding problem becomes visible.

**After the fix its score went down**, and this is more important than the fix itself.
Re-run over the same 48 games:

| | Illegal rate | Order-budget utilisation | Mean score | Eliminated | Grade distribution |
|---|---|---|---|---|---|
| Before the fix | 50.9% | 31% | 135.4 | 6/48 | B 23, C 16, D 8, A 1 |
| After the fix | 5.4% | 62% | **120.8** | **14/48** | B 19, D 15, C 11, A 3 |

When half its orders were being dropped it was forced to do less; once the orders really
executed, its own decisions killed it.
**That bug had been covering for it the whole time.** So: a score dropping after fixing an
infrastructure defect does not mean the fix was wrong — you have to look separately at
"are its orders legal" (fixed correctly: 50.9% → 5.4%)
and "are its orders any good" (they were never good, we just could not see it before).
Grade A going from 1 to 3 and Grade D going from 8 to 15 — winning bigger and losing
worse — is the same thing.

(The restoration count was 775 this run and 2805 last run — the provider's encoding
corruption is **intermittent**, and the routing most likely changed between runs. So this
is not a clean A/B; only the illegal-rate column is certain.)

### 16. Cross-season memory is worth about +92 points, but a small sample will get the sign backwards

A model's decision is stateless by construction: the observation is all "the state right
now", with not one line of "what I intended to do last season". Give it a cross-season
strategy plan that it writes itself and that is handed back verbatim next season
(`Decision.plan`):

```
 4 games  paired diff −75 ± 94   the interval covers 0
12 games  paired diff +92 ± 74   the interval excludes 0, 8 wins 2 losses 2 ties
```

**The point estimate flipped sign between 4 games and 12 games.** At the time I invented a
whole "the plan locks it in" mechanistic explanation on the basis of 4 games — that
inference was wrong. When the interval covers 0, the only honest statement is "we know
nothing". 12 games is still below the threshold of point 1, so this is recorded as
"strongly indicated" rather than "confirmed"; the effect size is large enough: with memory
off there were three games ending at 0/1/3 commanderies (wiped out or nearly so), and on
the same seeds with it on they were 54/33/29.

This feature was once **broken end-to-end at parsing**: the schema asked for it, the
prompt explained it, the observation held a slot for it, both call sites were passing it,
and only `parseDecision` read nothing but `picks` and `reason`.
Across a 24-season record it was recorded 0 times, and the unit test pinned only those two
fields.

### 17. The wording of the order budget is worth 40 percentage points

The prompt originally said "total order cost must **not exceed** budget.ap", so the model
took the objective to be "do not overspend". In practice it picked 5–6 orders a season
while spending only 3–5 of the budget (9–11 available), and of 1010 choices **713 were
free actions** (scout 376, reassignment 337) — it filled the list with actions that cost
nothing, never touched the order budget, and issued only 87 campaigns across 186 seasons.

Changed to "an unused order budget **is forfeited** (at most N carry over); it is a
resource that must be spent this season", and spelling out that "free actions cannot
substitute for things that cost budget": order-budget utilisation went **36% → 76%**, and
Grade A was reached for the first time in the same game.

### 18. When a new mechanic ships, spend a dollar to see whether the model notices it; do not open a leaderboard straight away

The smoke test run on the day prestige offices (granting the post of provincial governor)
shipped: `claude-haiku-4.5`, pinned to Anthropic, 2 games × 16 seasons × 2 seats (Li Jue
(李傕), Liu Biao), **total cost 0.79 dollars** — about 0.025 dollars per seat-season, 655k
input tokens, 9.4k output tokens, 32 calls, 0 failures, illegal rate 0.4%.

What to look at is not the score (2 games say nothing), it is **whether this new order
gets seen**:

    season 0  Li Jue     invest:凉州:lijue   "obtain the Liangzhou governorship to take ownerless commanderies by proclamation"
    season 4  Liu Biao   invest:豫州/交州     "grant myself the Yuzhou and Jiaozhou governorships to make proclamation easier"
    season 5  Liu Biao   invest:司隶:liubiao "grant myself the Sili governorship in preparation for later proclamations"

It was used in the very first season, and the reasoning it gave back matched the rules.
Conversely, if a new mechanic is never once chosen across 32 seat-seasons, that is most
likely **a candidate or prompt problem**, not a model problem — so before spending 76
dollars on a 48-game leaderboard, spend 1 dollar to settle this question.

At that unit price, a leaderboard of 48 games × 4 agents is on the order of seventy-odd
dollars. A leaderboard should wait until the rules are frozen: change a rule and the money
already spent is wasted.

### 19. The first 48-game leaderboard: both models lose to the rule bot, and lose significantly

The first proper leaderboard run after the rules were frozen (same seeds, same opponents,
rotating seats, 16 seasons, 48 games, pinned to OpenAI, `--reasoning=low`, `--keyenum` on
by default):

| Agent | Mean score | Final-standing score | Province progress | vs baseline ±95% | Territory multiple | Eliminated | Illegal rate | Order-budget utilisation | Cost |
|---|---|---|---|---|---|---|---|---|---|
| bot:purpose | 191.7 | 141.7 | +105 | baseline | 1.51 | 5/48 | 0.0% | 97% | — |
| bot:balanced | 158.3 | 112.5 | +90 | −33±20 | 1.50 | 4/48 | 0.0% | 96% | — |
| gpt-5-mini | 135.4 | 58.3 | +15 | **−56±23** | 0.89 | 7/48 | 7.6% | 81% | $5.31 |
| gpt-5-nano | 120.8 | 81.3 | +46 | **−71±25** | 0.93 | 11/48 | 9.4% | 66% | $1.05 |

$6.36 in total, 1400 calls, 60 minutes (concurrency 2). Neither confidence interval
crosses zero: **this gap is real**.

Three ways to read it:

**One, a territory multiple < 1 — they are shrinking.** The bot grows its territory to
1.5×, while both models on average end smaller than they started (0.89 / 0.93). The reason
the mean score is still 120–135 is that grades are recorded at the **best-ever grade** (the
ratchet): spike high, lose it all, and nothing is deducted. The final-standing scores
(58 / 81 against a baseline of 142) are what they actually held.

**Two, an illegal rate of 7.6–9.4% is real, not mojibake.** With the provider pinned,
mojibake is 0 and `unknown-key` is 0 as well — the enum blocked hallucinations and there
was not one fabricated key. What was dropped is a different class:

    rejected     mini 427 / nano 344    legal one by one, illegal taken together
    duplicate    nano 93                the same key picked twice
    over-budget  nano 41 / mini 8       issuing orders without enough budget left

That is, the model picks a **set** of orders: every one really exists in the candidate
table, but at most 2 orders per commandery per season, not enough gold, not enough order
budget — it does not account for its own budget this season. This is a measurable
decision-quality defect, not an interface problem.

**Three, mini spent 5× the money for +15 mean score and −31 province progress.** It spikes
higher (26 games at Grade B against 24) but holds worse (final-standing score 58 against
81, province progress +15 against +46). Under this set of criteria, "a bigger model" does
not mean "plays better", and the continuous ruler (province progress) orders them the
opposite way from the grade score — you only see this by reading both rulers together.

### 20. Feeding "dropped orders" back to the model: utilisation +6.2pp, duplicates halved, illegal rate unmoved

The illness dug up in point 19 was "legal one by one, illegal taken together", and the
prompt **already said** "at most 2 orders per commandery per season". So what changed was
not the wording but the feedback: the observation gained
`droppedLastSeason` (orders picked last season but not executed, plus the reason, at most
five, nothing sent for a clean season).

Same seeds, same seat rotation, gpt-5-nano, 24 games per arm, the only difference being
`--dropback` (this switch has to be separate from `--memory`; both are cross-season
feedback, and hanging them on one switch makes it impossible to tell which one did the
work):

| | Control | Feedback on | Diff ±95% | |
|---|---|---|---|---|
| Illegal rate | 8.47% | 9.26% | +0.79 ±1.55 pp | **not significant** (z=1.01) |
| of which duplicate rate | 2.06% | 1.25% | −0.81 ±0.69 pp | significant (z=−2.30) |
| Order-budget utilisation | 65.1% | 71.3% | +6.2 ±3.7 pp | significant (z=3.27) |

$0.52 each. **The headline metric did not move**: telling it "these orders were dropped
last season" did not reduce the overall illegal rate. Two things did move — it stopped
picking the same key twice (duplicates nearly halved), and it spent 6 percentage points
more of its order budget each season.

A plausible mechanism: among the dropped orders, `duplicate` is something the model **can
check at a glance itself** (the same key appears twice), and a reminder in the feedback is
enough to fix it; whereas `rejected` requires it to simulate the engine's per-order
validation (how many orders have already been issued in this commandery this season, how
much gold is left), and the feedback only tells it "you were wrong last season" without
giving it a way to compute it. The two arms' `rejected` counts are 150 and 183 — more
after the feedback, consistent with "more orders issued, more chances to collide".

Keeping it: two significant improvements, one non-significant change, at a cost of only
about 40 extra tokens in the seasons where orders were dropped. If the next step is to
push `rejected` down, it needs something it can compute with — for example marking on the
candidate itself "orders already used in this commandery this season", rather than
continuing to tell it that it was wrong.

### 21. Teaching the model to "count by commandery first" is a net negative — already reverted

Point 20 left a next step: 63% of the illegal rate is "this commandery's order quota for
this season is already full", and the feedback only tells it "you were wrong last season"
without giving it a way to compute it. So a line was added to the prompt: "count by
commandery first — a commandery appearing twice is at the cap, and a third will certainly
be dropped. The commandery name is right there in the key."

Same seeds, same seats, gpt-5-nano, 24 games, the only difference being that one line:

| | Before this line | After | Diff ±95% | |
|---|---|---|---|---|
| Order-budget utilisation | 71.3% | 66.9% | **−4.3 ±3.5 pp** | significant (z=−2.46) |
| Illegal rate | 9.26% | 8.11% | −1.15 ±1.58 pp | not significant (z=−1.43) |

**The bit of legality bought back does not cover the loss.** Teach it to count order slots
and it becomes cautious and issues fewer orders — and order-budget utilisation is one of
the few process metrics in this eval that correlate strongly with score (point 17: change
the wording and it goes 36%→76%, with Grade A reached for the first time in that same
game). Reverted to the 1.11 wording.

Two methodological lessons:

**One, think first about "what is being compared with what".** In this round, "commandery
quota full 0% → 6.33%" looks startling but is fake: when the control arm ran, rejection
details were not yet being stored, so the strings on that side do not contain the words
"order quota full" at all. **Change the record format and old records can no longer be
compared with new ones along that dimension.**

**Two, before adding a `sites` field to candidates (listing the commanderies occupied), I
measured it and found there is not a single one that cannot already be derived** — the
commandery names are all in the key, including for mustering
(`muster:中山国:中山国+安平国+河闲国`). The information was already there; the model simply
was not counting it. And the experiment above shows that making it count is not worth it.

### 22. Use the cheap tier throughout development — the expensive models did not tell us anything more, they only cost more

The first 48-game leaderboard cost $6.36, of which **gpt-5-mini alone was $5.31**, 4×
more than every other agent on that leaderboard combined. What conclusion did it buy?

| | Mean score | Diff vs baseline | Territory multiple | Illegal rate |
|---|---|---|---|---|
| bot:purpose | 191.7 | — | 1.5 | 0 |
| gpt-5-mini ($5.31) | 135.4 | −56 ±23 | 0.93 | 7.6% |
| gpt-5-nano ($1.25) | 120.8 | −71 ±25 | 0.89 | 9.4% |

**The conclusion for both is the same sentence**: both are beaten through by the baseline,
both are "hoarding troops without attacking", and both end with less than two thirds of
the baseline's territory. The expensive one turns −71 into −56, and the confidence
intervals of those two numbers overlap — $4 bought a difference that is statistically
inseparable.

Debugging rules, validating mechanics and running A/Bs all want to know "does the model
accept this protocol, what order of magnitude is the illegal rate, which rung does it drop
to", and the **cheap tier shows all of that just as well**. Prices for 48 games (measured
2026-09):

| Model | In $/M | Out $/M | 48 games |
|---|---|---|---|
| qwen/qwen3.7-flash | 0.03 | 0.13 | **$0.62** |
| ~deepseek/deepseek-v4-flash-latest | 0.05 | 0.16 | $0.96 |
| z-ai/glm-4.7-flash | 0.06 | 0.40 | $1.40 |
| openai/gpt-5-nano | 0.05 | 0.40 | $1.25 |
| openai/gpt-5-mini | 0.40 | 3.20 | $3.84 |

So `eval-suite` gained `--maxcost` (default **$1.5 per agent**): if the estimate exceeds
it the run is **refused**, and cheaper substitutes are printed on screen. To run an
expensive one you have to write `--maxcost=4` explicitly — **making "spend a lot of money"
a deliberate act rather than the default one.**

The expensive models are reserved for the official leaderboard after the rules are frozen;
that is when the conclusions go out, and that is when they are worth the money.

### 23. Survey the providers before opening a leaderboard: a 28× difference may be in the routing, not the model

Smoke-testing the cheap Chinese tier, one season took 341 seconds. Suspected in turn: a
slow model, upstream rate limiting, a bug in the fallback ladder. None of them.
`~deepseek/deepseek-v4-flash-latest`, a **floating alias**, was routed to DigitalOcean,
p50 throughput **5 tok/s**. The same model pinned to Alibaba is 78, and glm-5.3-flash
pinned to BaseTen is 139. One season is about 1500 output tokens:

| Routing | p50 throughput | Measured per season |
|---|---|---|
| floating alias (lands on DigitalOcean) | 5 tok/s | **341 seconds** |
| `--provider=BaseTen,Modal` | 139 tok/s | **5–20 seconds** |

`npm run models` was built for exactly this (`tools/model-survey.mjs`, read-only on prices
and endpoint statistics, costs nothing). Before a leaderboard it answers three questions:

1. **Does any vendor support structured_outputs.** Without it the candidate-key enum
   cannot be used and the whole run falls back to the text rung — and at that point what
   is being measured is Chinese transcription, not strategic ability (see the enum
   section). qwen3.7-flash is exactly this case: only Alibaba serves it, it does not
   support them, and sending `require_parameters` gets `404 No endpoints found`.
2. **Which vendor to pin.** Sorted by p50 throughput, with throughput converted into
   schedule — "how many hours will 48 games take" is the thing to judge.
3. **Quantisation tier.** The same model is quantised differently by different vendors
   (fp8/fp4/unknown). A leaderboard mixing fp8 and fp4 is not comparable, so pin within
   one tier.

How to pin: write `model:<id>@BaseTen+Modal` in the suite (providers joined with `+`;
commas are reserved for separating agents). **List two vendors, not one**:
`allow_fallbacks:false` plus a single vendor means one provider hiccup loses the whole
season — pinning a single vendor was measured to produce 0 orders in season 1.

Three corollaries:

- **Do not use aliases on a leaderboard.** `~author/model-latest` has no discoverable
  endpoints and uncontrollable routing, and when it slows down it looks exactly like "the
  model is stupid" in the report.
- **Separate slow from hung.** The `attempts N` field in the heartbeat is for this: 341
  seconds with attempts=2 is a 300-second timeout plus a 41-second successful retry, i.e.
  the provider is hanging requests.
- **Retries cost money.** 2–4 attempts in a season was measured to be common, so the
  actual charge runs above the estimate, and `--budget` needs margin for it.

### 24. Two Chinese models both reached bot level — plus two falls I took over my own numbers

2026-09-07, same seeds, rotating seats, reasoning tier low, $2.76 in total, 10302 seconds.

**Final results** (48 games per arm across four arms, paired differences computed on the
board score, see point 26):

| Agent | Grade score | Board score | Province progress | vs baseline ±95% | Territory multiple | Wiped out | Illegal rate | Cost |
|---|---|---|---|---|---|---|---|---|
| z-ai/glm-5.3-flash@Modal+BaseTen+Parasail | 206.3 | **223.9** | +167 | +20.8 ±27.7 | 1.89 | 4/48 | 3.8% | $1.80 |
| deepseek-v4-flash@Alibaba | 204.2 | 220.4 | +161 | +17.4 ±20.6 | **2.10** | **1/48** | 5.1% | $2.22 |
| bot:purpose | 191.7 | 203.1 | +100 | baseline | 1.53 | 4/48 | 0% | — |
| bot:balanced | 162.5 | 172.2 | +85 | −30.9 ±22.5 ✓ | 1.46 | 3/48 | 0% | — |

**Neither model's gap against the strongest bot is significant**, while both are
significant against the weaker bot (and that difference itself is significant, showing
that 48 games can separate things at that magnitude). So what can be said is: **both cheap
Chinese models reached the level of the strongest bot, and neither exceeded it.**

The biggest behavioural difference is territory: the models 1.89–2.10, the bot 1.53.
**They take nearly twice as much land as the bot for only ten percent more score.**

My first version explained this as "it got the land but did not convert it into provinces
— scoring counts provinces and what it took extra was commanderies".
**On checking, it is the reverse**:

| | Commandery gain | Province-equivalent gain | Whole-province gain | Province-seat gain | Province-equivalent per extra commandery |
|---|---|---|---|---|---|
| glm-5.3-flash | +6.15 | +1.20 | +0.44 | +0.94 | 0.195 |
| deepseek-v4-flash | +5.73 | +1.16 | +0.35 | +0.90 | 0.203 |
| bot:purpose | +3.23 | +0.66 | +0.10 | +0.67 | 0.206 |
| bot:balanced | +3.17 | +0.69 | +0.00 | +0.31 | 0.219 |

**The conversion efficiency is nearly identical across all four (0.195–0.219)**, and the
models are higher on everything: nearly twice the commanderies, nearly twice the
province-equivalents, more than four times the whole provinces. It is not that they "only
take commanderies and never build real power".

The real reason the scores are compressed is the **grading thresholds**: Grade A requires
"≥2 more provinces controlled", while over 16 seasons the mean whole-province gain is only
0.10–0.44. Grade B (≥1 more province **or** ≥1 more province seat) is the only grade
within reach, so the bot has **35/48 (73%)** and glm has **25/44 (57%)** of their games
all falling into that one bucket. A ruler that reads seventy percent of the sample at the
same mark cannot tell strong from weak — which is exactly what the board score in point 26
is there to fix.

(This item overturns what I myself wrote in a commit message. It is kept here because
"the candidate already said 'take 2 more in Jizhou (冀州) to control it'" was something I
also only learned by going and reading `gainNote` — I nearly rebuilt a feature that was
already implemented. **Check before changing.**)

Below is the process and the lessons from running this leaderboard (including two places
where I miscalculated and one conclusion that was overturned).
The first version's numbers (deepseek 36 games, glm with 18.7% blank seasons) are kept
below, because those falls are more useful than the conclusion.

| Agent | Games | Mean score | Paired diff vs baseline ±95% | Territory multiple | Eliminated | Illegal rate | Cost |
|---|---|---|---|---|---|---|---|
| deepseek-v4-flash@Alibaba | **36** | 202.8 | +8.3 ±19.7 | **2.07** | 1/36 | 5.0% | $1.64 |
| z-ai/glm-5.3-flash@BaseTen+Modal | 48 | 202.1 | +10.4 ±18.7 | 1.91 | 5/48 | 4.2% | $1.12 |
| bot:purpose | 48 | 191.7 | baseline | 1.53 | 4/48 | 0% | — |
| bot:balanced | 48 | 162.5 | −29.2 ±21.0 | 1.46 | 3/48 | 0% | — |

**Neither model's gap against the strongest bot is significant** — both confidence
intervals cover zero. All that can be said is: inseparable from the strongest bot, clearly
stronger than the weak one (bot:purpose − bot:balanced is significant).
On the previous leaderboard gpt-5-mini was −56 ±23 and nano was −71 ±25, with territory
shrinking to 0.89–0.93; there is a step between the two. (The rules changed between the
two leaderboards — prestige offices, formation attributes and the all-out-attack hint were
all added afterwards — **so numbers across leaderboards are not comparable**; the old
numbers are only used to indicate magnitude.)

A territory multiple of 1.9–2.1 against the bot's 1.5 is the largest behavioural
difference on this leaderboard: the models open up territory faster than the bot, and
the scores do not separate. **That shows the scoring function does not pay enough along
the "takes more commanderies" dimension** — it scores by the gain in provinces and
province seats, and what the models take extra is commanderies. That is a problem with
the scoring table, not with the models.

#### The hard flaws in each arm, stated before the numbers are read

**The glm arm had 141/754 seasons (18.7%) in which not one order was issued**, all of them
`Provider returned error` — I rate-limited BaseTen/Modal myself by running four-way
concurrency. It got 202.1 **while absent for a fifth of its seat-seasons**. That number is
biased low rather than high, but the arm is not clean; getting a quotable number requires
re-running at lower concurrency.

**The deepseek arm only reached 36 games before hitting the budget** (cumulative actual
charge $1.64 > the $1.50 ceiling). It was later topped up to 48 games with `--resume`, for
a total actual charge of $2.22. It had only 2/756 failed seasons.

It is expensive because of reasoning: of 4.19 million output tokens, **4 million is
reasoning** (5305 tok per call), and **129/756 seasons were pushed into a doubling retry
by reasoning** — that is us having configured the output budget too small, a harness
configuration problem, not the model's score. The ⚠ line in the report exists for this.

#### The two falls I took over my own numbers

In the first version of the analysis I wrote "the model issues thirty percent fewer orders
and gets the same score", and used that to claim point 17's "order-budget utilisation
correlates strongly with score" had been overturned. **Both sentences are wrong.**

- The 69.3% order-budget utilisation was obtained by **counting the 141 blank seasons**.
  Excluding the seasons where the provider failed, glm is **85.3%**, issuing **9.55**
  orders a season — **more** than the bot's 9.18.
- I read the action-mix table one column off: I wrote "the bot maxes out the free
  **formation change** at 3.31 times", when that column is **reassignment**. The bot's
  formation changes are 0.01 times.

The lesson is the same one: **when the denominator contains seasons that "could not
answer", any per-season average metric is wrong.**
`eval-dissect` currently averages over all seasons, so you have to exclude them yourself
when reading its output.

The corrected mix (per seat-season, failed seasons excluded):

| | Total | Campaign | Muster | Internal affairs | Scout | Reassignment | Persuade to submit |
|---|---|---|---|---|---|---|---|
| glm-5.3-flash | 9.55 | 0.91 | 0.35 | **2.86** | 2.21 | 1.32 | **0.63** |
| deepseek-v4-flash | 9.43 | 0.67 | 0.15 | **3.44** | 1.93 | 1.32 | **0.54** |
| bot:purpose | 9.18 | 0.99 | 0.03 | 1.40 | 2.39 | **3.31** | 0.08 |

The real difference is not in how many orders are issued but in **what is issued**: the bot
maxes out free reassignment (3.31/season), while both models put their budget into
internal affairs (2.9–3.4) and persuading cities to submit (0.5–0.6), and the bot almost
never persuades anyone to submit.

#### By seat

| Seat | glm commandery gain | deepseek commandery gain | bot commandery gain |
|---|---|---|---|
| Liu Biao | +14.3 | **+14.5** | +9.3 |
| Yuan Shao | +7.3 | **+8.0** | +6.1 |
| Liu Zhang | **+8.3** | +4.3 | +3.5 |
| Yuan Shu | +2.1 | **+3.0** | +0.5 |
| Lü Bu | +0.8 | **+2.7** | −0.9 |
| Cao Cao | +0.8 | +1.3 | +0.9 |

Cao Cao, starting with one commandery, is the only seat where nothing separates, and the
only place deaths concentrate: glm is wiped out 4/8 (the bot 2/8), deepseek 1/6. **"How to
survive starting from one commandery" is still the hardest cell in this eval.**

I wanted to use it for an A/B on the all-out-attack hint, but computed the power: judging
the death rate over 12 games on each of two seats, the noise covers any real effect.
**If the sample is not enough, do not run it** — running it only produces a number that
does not convince even me. To do that A/B, the first thing to settle is whether the
criterion should be the death rate at all.

### 25. After removing those 18.7% blank seasons: 215.9 points, the first significant win over the strongest bot

In point 24, the glm arm was absent for 141/754 seasons, entirely the result of my own
four-way concurrency rate-limiting the provider. Re-run at two-way with three fp8 vendors
listed (Modal+BaseTen+Parasail):

| | Dirty arm (4-way concurrency) | Clean arm (2-way + three vendors as fallback) |
|---|---|---|
| Failed seasons | 141/754 (**18.7%**) | **2/694 (0.3%)** |
| Mean score | 202.1 | **215.9** |
| Paired diff vs bot:purpose | +10.4 ±18.7 (not significant) | **+25.0 ±23.9 (significant)** |
| Order-budget utilisation | 69.3% (including blank seasons) | 86% |
| Cao Cao wiped out | 4/8 | **1/8** (bot 2/8) |
| Commandery gain | +5.6 | +6.4 |
| Games | 48 | 44 (stopped on budget: actual charge $1.64 > the $1.60 ceiling) |

**And that significance did not hold.** What was written at the time was "+25.0 ±23.9, a
lower bound of only +1.1, just over the line; to treat it as a conclusion it has to be run
out to 48 games and looked at again" — and after topping up the missing 4 games with
`--resume`:

| | 44 games (truncated) | 48 games (full) |
|---|---|---|
| Grade score | 215.9 | **206.3** |
| Board score | 234.0 | **223.9** |
| vs the strongest bot (board score) | +31.3 ±25.8 ✓ | **+20.8 ±27.7, not significant** |

The 4 games added were **+117 / −97 / −200 / −196**, two of them wipeouts.
**The truncation happened to keep three disasters outside the sample.**

Furthermore, at 44 games the seat quota is 8/8/7/7/7/7 — six-seat rotation goes by
`gi % 6`, so a game count that is not a multiple of 6 is uneven, and the seats differ
enormously in difficulty (in the same batch Liu Biao is +13.9 commanderies and Lü Bu is
−0.7). **A leaderboard truncated by the budget is not a random subsample, and its ranking
cannot be read at face value.** eval-run now points out the uneven quota right at the top
of the report, and `--resume` is used to fill in the missing games without re-running
everything.

So as of here, **no model is significantly stronger than the strongest bot.**
glm-5.3-flash is the closest so far: board score 223.9 against 203.1, territory multiple
1.89 against 1.53.

But the direction is clear, and the second point matters more: **the conclusion "Cao Cao
wiped out 4/8" is false.** Under a clean run it is 1/8, better than the bot's 2/8. A seat
that starts with one commandery is the most sensitive to "missing a season" — lose three
seasons of orders out of sixteen and the one-commandery Cao Cao dies.

So the same lesson showed up three times in one day, each time more expensively:

1. Order-budget utilisation 69.3% — blank seasons in the denominator (point 24)
2. "The bot spams formation changes" — read one column off (point 24)
3. "Cao Cao wiped out 4/8, it has not learned how to die with one commandery" — blank
   seasons again

**Infrastructure failures disguise themselves as model capability defects**, and the
disguise is good: it does not raise an error, it merely leaves that seat doing nothing
that season, which looks exactly like "the model does not know what to do". So the
failure-breakdown column has to be read first, and the scores after.

The clean arm by seat (against the strongest bot):

| Seat | glm commandery gain | bot commandery gain | Wiped out |
|---|---|---|---|
| Liu Biao | **+13.9** | +9.3 | 0/7 |
| Yuan Shao | **+12.3** | +6.1 | 0/8 |
| Liu Zhang | **+10.1** | +3.5 | 0/7 |
| Yuan Shu | **+2.0** | +0.5 | 0/7 |
| Cao Cao | +0.8 | +0.9 | 1/8 (bot 2/8) |
| Lü Bu | −0.7 | −0.9 | **2/7** (bot 2/8) |

The genuinely weak seat is Lü Bu, not Cao Cao: six commanderies to start, enemies on all
four sides, no governorship — both agents shrink on that seat.

### 26. The board score: grade score + continuous within-grade progress — eliminating the 25/44 games where "one or two provinces apart" was recorded as a tie

Grading has only seven levels (D/C/B/A/Ascendant/Hegemon/King), and **Grade A is two
provinces wide**: zhouGain 2 and 3 both score 300. In one measured run of 44 games, the
paired difference between the model and the strongest bot was **a tie in 25/44 games** —
one or two provinces apart, recorded as a draw. The intervals are widened by exactly those
ties.

(First, a correction of something I got wrong myself: **Grade A is not the ceiling.** Above
it are Ascendant (+4 provinces), Hegemon (≥7 provinces) and King (≥11 provinces); it is
just that none of these agents got near them. The problem is the width of the grade, not a
cap.)

The leaderboard's ranking and paired intervals are now computed on `boardScore`:

    board score = grade score + min(99, max(0, 10 × (province-progress gain + 0.5 × province-seat gain)))

Clamping to 0–99 is so that **a lower grade can never beat a higher one** — the grade
remains the headline metric and the continuous term only acts within a grade. The weight
comes from the same source as the grading criterion: in grading, "1 more province
controlled" and "1 more province seat held" are both Grade B, and "1 more province + 2
more province seats" and "2 more provinces" are both Grade A, so a province seat is worth
about half a province. Three tests pin these three facts.

Measured (number of games needed for 80% power on the paired difference; smaller is more
sensitive):

| Ruler | Between the two bots | glm−bot | deepseek−bot | Ties |
|---|---|---|---|---|
| Grade score (old) | 51 | 83 | 412 | **25/44** |
| **Board score (current)** | 53 | **61** | **193** | **1/44** |
| contScore, purely continuous | **347 ✗** | 30 | 19 | 1/44 |
| fineScore, lexicographic | 50 | 69 | 344 | 5/44 |

**The purely continuous one is more sensitive, but it cannot be used for ranking**: it
cannot separate the two bots (347 games). The two bots have almost identical territory,
and their difference is in "picking the valuable commanderies that cross a line" — which
is exactly what grading measures and the continuous measure cannot see. So it stays on the
leaderboard as a separate "province progress" column, and readers can see for themselves
whether the two rulers point the same way; when the two rulers disagree, that fact is
itself the conclusion.

`fineScore` (lexicographic bit-packing) is left alone: it compresses the continuous term
down to the 1/169 scale, 83 → 69 games, better than nothing. The board score adds on a
hundred-point scale directly, which is the right magnitude.

### 27. Half of the cheap tier simply cannot be tested: reasoning runs away, the score is not low

Picking three more cheap Chinese models for the leaderboard, each smoke-tested on two
games for $0.1 as per point 18. **Two of the three are unusable**, and not because they
"play badly" but because **they cannot produce a body at all**:

| Model (`--reasoning=low`) | Output tokens/game | of which reasoning | Blank seasons | Order-budget utilisation | Measured price for 48 games | Price list |
|---|---|---|---|---|---|---|
| tencent/hy3 | 70 thousand | 98% | **0/32** | 80% | $2.74 | $1.01 |
| qwen/qwen3.6-35b-a3b | 208 thousand | 93% | 8/32 (25%) | 58% | **$16.64** | $1.61 |
| inclusionai/ling-3.0-flash-fin | 336 thousand | 85% | **27/32 (84%)** | **9%** | $3.48 | $0.69 |

The latter two blew through the output budget rung by rung, 8000 → 16000 → **32000**, with
`finish=length` and empty content. The body of one decision only needs two hundred tokens.
**`--reasoning=low` does nothing for them.**

Three things that matter:

**One, the smoke test saved $16.** The price-list estimate for qwen is $1.61 and the
measured figure is $16.64 — **ten times**. Point 18's "spend under a dollar to settle it
before opening a leaderboard" is not fastidiousness.

**Two, the `--maxcost` gate works off a number that can underestimate by a factor of ten.**
It computes price list × 2, while a heavy-reasoning model's output tokens can be **8.8–42×**
the assumed value (8000/game). The gate is still useful (it blocks things like gpt-5-mini
that are expensive on input), but **it cannot block runaway reasoning**. On that, only a
smoke test counts.

**Three, `--reasoning=cap:N` was added** (a reasoning-token ceiling, via OpenRouter's
`reasoning.max_tokens`). With qwen capped at 3000: 19–35 seconds per season (was 91), 0/10
blank seasons, $4.68 for 48 games (was $16.64) — **testable**.
ling capped at 3000 still only reasons and never outputs (`finish=stop` with empty
content); dropped.

A cap is **a different setting**, not the same measurement of the same model: scores from
it cannot be compared directly with those at `effort=low`, and that is what the `reasoning`
field in the report records.

This also means the sentence "the cheap-tier models all reached bot level" needs a
qualifier: **the ones that can finish a sentence** reached it. The half that cannot produce
a body will show as low scores on the leaderboard, and that is a different matter.

### 28. Re-calibrating the grading thresholds: the two rulers finally point at the same thing (plus one prediction yet to be tested)

The conclusion of points 24–25 was "no model is significantly stronger than the strongest
bot". That was said **in terms of the grade score**. Switching to the continuous ruler,
which is unaffected by thresholds (province progress = province-equivalent gain + half a
province seat, see scoring.ts), on the same batch of 48 games:

| Paired diff vs bot:purpose | Grade score (board score) | Province progress |
|---|---|---|
| glm-5.3-flash | +20.8 ±27.7　not significant | **+67.3 ±36.1　✓** |
| deepseek-v4-flash | +17.4 ±20.6　not significant | **+61.4 ±28.2　✓** |
| bot:balanced | −30.9 ±22.5 ✓ | −14.8 ±27.8　not significant |

**The two rulers give opposite verdicts**, and systematically so: the gap between models
and bots is large in territory and small in grade; the gap between the two bots is large in
grade and small in territory (their territories are almost identical, and the difference is
in "picking the valuable commanderies that cross a line").

The grade ruler cannot see the models' advantage because it reads 45–73% of games at the
same mark: Grade A requires two more whole provinces (the 93rd percentile in a 192-game
measurement), while Grade B needs only one province seat.
**The new thresholds separate "getting a foothold" (one more province seat → Grade B) from
"building real power" (one more whole province → Grade A)**, and in 600 self-play games
the largest bucket went 45% → 33%, with the Ascendant grade going from 0% to 10% (see the
comments in victory.ts).

**A prediction yet to be tested**: re-running the same batch of 48 games under the new
thresholds, the models' grade-score gap against bot:purpose should become significant, and
in the same direction as province progress. If not, that means the two rulers measure two
different abilities rather than being a coarse and a fine version of the same thing — and
that would be the more important finding.

(board2/board3 ran under the old thresholds and are self-consistent among their three arms,
but **not comparable across thresholds**. Re-running a leaderboard under the new thresholds
costs about $6.8.)

### 29. The first leaderboard after the freeze: all three cheap Chinese models are stronger than the strongest bot

Point 28's prediction was tested and holds. 48 games, same seeds, rotating seats, reasoning
tier low, $3.87.

Content pack 1.0.0 (frozen), 48 games, same seeds, rotating seats, reasoning tier low,
$6.57 in total.

| Agent | Grade score | Board score | Province progress | Territory multiple | Wiped out | Illegal rate | Cost | Grade distribution |
|---|---|---|---|---|---|---|---|---|
| **z-ai/glm-5.3-flash** | **293.8** | **315.4** | **+214** | 2.18 | 2/48 | 3.2% | $1.83 | Ascendant 15, A 17, B 14, C 2 |
| **deepseek-v4-flash** | 258.3 | 277.0 | +187 | **2.47** | **1/48** | 5.0% | $2.04 | Ascendant 11, A 16, B 12, C 8, D 1 |
| **tencent/hy3** | 252.1 | 270.2 | +171 | 1.84 | 4/48 | 3.0% | $2.69 | Ascendant 14, A 9, B 15, C 8, D 2 |
| bot:purpose | 227.1 | 238.9 | +104 | 1.54 | 4/48 | 0% | — | Ascendant 7, A 9, B 25, C 4, D 3 |
| bot:balanced | 181.3 | 190.9 | +85 | 1.46 | 3/48 | 0% | — | Ascendant 1, A 8, B 22, C 15, D 2 |

Paired differences against the strongest bot (`npm run verdict`):

| | Grade score | Board score | Province progress |
|---|---|---|---|
| glm-5.3-flash | +66.7 ±23.6 ✓ | +76.4 ±26.1 ✓ | +109.7 ±44.4 ✓ |
| deepseek-v4-flash | +31.3 ±29.3 ✓ | +38.1 ±31.2 ✓ | +82.7 ±30.3 ✓ |
| tencent/hy3 | +25.0 ±26.4 · | +31.2 ±28.8 ✓ | +67.4 ±38.2 ✓ |

**All three rulers give exactly the same ranking**: glm > deepseek > hy3. hy3 just misses
the significance line on the coarsest ruler (+25.0 ±26.4); both board score and province
progress clear it.

#### I changed the criterion once, recorded here honestly

The criterion set in point 28 was "every model is significant on both rulers". When hy3's
results came in, it judged failure, and **I only noticed the criterion was wrong after
seeing the data** — which weakens the weight of this test, and that is not being hidden.

Where it was wrong: "not significant on the coarse ruler" is a judgement about **that
model's effect size**, not about whether the two rulers agree. The weakest model's effect
is small to begin with, 48 games cannot resolve it, and no amount of ruler quality changes
that. The illness to guard against is a different one: one ruler significant while the
other points the opposite way or sits near zero — that is what would show that the two
measure different things.

The criterion was changed to three clauses: no opposite signs, the two rulers agree on the
ranking, and the strongest one is also significant on the coarse ruler (otherwise the
coarse ruler is pure decoration). All three pass.

**What would falsify it**: if the next leaderboard shows opposite signs, or the two rulers
cross in their ranking, it should be judged a failure — **and at that point changing the
criterion again is not allowed.**

**This contradicts the conclusion of points 24–25**, where neither model was significant
against the strongest bot. What changed is not the models but the ruler: the old thresholds
read 45–73% of games at the same mark and could not see the doubling of territory the
models were taking.

#### A confound that has to be stated

This run **changed two things at once**: the grading thresholds, and the rules summary
written for the model — the latter had to describe the new rules honestly, or the model
would be deciding under an outdated set of rules. So for the following changes it is
impossible to tell whether "the ruler changed" or "the model read a new objective and
played differently":

| | The old-threshold run | This new-threshold run |
|---|---|---|
| glm province progress (absolute) | 167.0 | **213.7** |
| glm commandery gain | 6.15 | **7.67** |
| bot:purpose province progress | 99.7 | 104.0 |
| bot:purpose commandery gain | 3.23 | 3.44 |

**The bot changed too** — its heuristic looks at "taking this raises my grade", so changing
a rule changes its play. The baseline therefore has to be re-run and cannot be carried over
from the previous leaderboard.

The two cannot be tested separately: giving the model a false description of the rules is
meaningless. What can be said is that the new rule's incentive, "one more whole province →
Grade A", **worked**: both bot and model moved toward "rounding out whole provinces", and
the model moved more (+28% against +4%).

#### Freeze criteria

Three were set, and all three now pass:

1. No bucket in the grade distribution above 40% — 33% (600 self-play games, point 28) ✓
2. Grade score and province progress point the same way for the models and both are
   significant — this item ✓
3. The four gameplay acceptance gates pass ✓

**The rules are frozen**: the content pack's `version` goes 0.2.0 → **1.0.0**, and the
pack's `_frozen` records the date, the commit it is based on and these three criteria.

**1.1.0 (2026-09-08) changed one thing**, and the gate duly fired: siege grain consumption
went from a constant 1 to being tiered by the men and horses in the city (1 at the base
level, 2 above 1.5×, 3 above 3×, with the baseline taken from the starting garrison). The
reason is that previously provisions fell by a constant −1 per season regardless of how
many people were in the city — Yuzhang commandery (豫章郡) with thirty-three thousand
garrison troops lasted exactly as long as Shanggu commandery (上谷郡) with three hundred,
and the provisions ceiling is only 2–5 (63 of the 105 commanderies are at 4), so every
siege was the same length of time.
**board4 ran on 1.0.0 and cannot be read side by side with later leaderboards**; the bot
baseline has been re-run as prescribed (the four acceptance gates are still 4/4), and
re-running the three model arms would cost about $6.5, which has not been done.

Frozen does not mean "no changes allowed", it means "if you change it you must know you are
changing it". What guards it is the **fingerprint gate** in `tests/pack-drift.test.mjs`:
take a stable sum over **all the numbers** in constants / actions / victory /
terrain / units / skills together with their paths, and pin it in the test.
Only numbers, not text — most of those groups are explanations and sources, and changing a
turn of phrase should not fire the gate; while any number that affects the win/loss
determination must fire it (changing "formation_counter_plus_breach" from 1 to 2 was
measured to fail on the spot).

After it fires, three things have to be done: bump `pack.version`, re-run the bot baseline,
and state here that the old and new leaderboards are not comparable. Only then update the
fingerprint. **Every leaderboard produced carries `stamp.packVersion`, and two leaderboards
with different packVersions cannot be read side by side** — and that fact is invisible in
the body of the report, appearing only as one small line in the stamp, which is why the gate
has to fire at the moment of the change.

### 30. The first-assault breach penalty: the motivation was right, the measurement sent it back — it makes score depend more on how big you start

The siege mechanics are written out fully (a six-season cap, a provisions clock, breach
accumulating each season, relief, besieging a point to strike the relief force), and then
one measurement of bot self-play: **92% of 4734 sieges lasted only one season**, the first
assault took the city. The provisions clock only rang 1.6% of the time (75/4734). The goals
the siege section states for itself — "make 'relieve the siege', 'besiege Wei to rescue
Zhao' and 'cut their supply line' real options" — almost never happen.

The reason is very concrete: the first assault pays no price at all. Across 3098 first
assaults,

| | Distribution |
|---|---|
| Breach | mostly 3–5 |
| Defensibility | mostly 1–3 (cap 6) |
| Breach − defensibility > 0 (i.e. the city falls) | **73%** |

Bringing triple the troops gives breach 4, while a typical city's defensibility is only 2–3.
Historically, storming a strong city at three to one basically never succeeded in one go —
an assault required earthworks and siege engines first. So "first assault −1 breach" was
tried, with besieging earning +1 back each season, i.e. "storming is a gamble, besieging is
steady".

**Measurement sent it back.** 100 games × 6 seats of self-play:

| | Before | First-assault penalty = 1 |
|---|---|---|
| Starting commanderies ↔ score ρ | **0.37** | **0.66** |
| Yuan Shao (13 commanderies to start) mean final | 15.2 commanderies | **18.6 commanderies** |
| Cao Cao (1 commandery to start) mean final | 1.2 commanderies | 1.2 commanderies |
| Cities taken | 3660 | 3111 |
| Sieges lifted | 679 | **1145** |

Making the first assault harder **benefits the large factions** — they can muster triple
the troops and small factions cannot. ρ jumping from 0.37 to 0.66 means score depends more
on how big you started, which is exactly what this eval most wants to avoid (one of the four
acceptance gates is precisely this). And the sieges still did not last: the bot switched to
lifting them (lifting a siege you cannot win is rational — tying up an army outside a city
for three of sixteen seasons is too expensive).

The knob stays in the pack, set to 0: anyone who wants to try again does not have to reinvent
it, and does not have to step into this hole again.

#### Two further failed attempts, and one structural conclusion

**Attempt two: raise the baseline of city defence to 40** (the city-defence term in
defensibility changed to `floor((city_defence−40)/15)`). The motivation was "make the
defender's investment worth more" — starting city defence of 35–79 is all compressed into
tiers 1–2 under `floor(city_defence/30)`, the whole range barely distinguishes anything, and
repairing a city gives +8 so four repairs are needed to cross a tier, making that internal
affairs order barely worth anything (the bot issues it in only 2.0% of its orders).

**Also sent back. ρ 0.60.** The direction is the opposite of attempt one (this version makes
most cities **easier** to take) and the result is the same: Yuan Shao's mean final goes 15.2 →
18.8, Liu Biao's 12.1 → 13.7, conquest speeds up, the large factions benefit.
What was learned: **ρ is sensitive to the pace of conquest itself** — whether the attacker
gets stronger or weaker, as long as the pace moves, the large factions snowball faster.

**Attempt three: add only at the top.** The baseline does not move one notch; only cities with
city defence ≥88 get a further +2. The starting maximum is only 79, out of reach — the only way
to get there is to repair up to it (+8 per repair, cap 100), which makes it a pure return on
investment.

| | ρ | Yuan Shao mean final | Lü Bu mean final | Sieges ≥2 seasons |
|---|---|---|---|---|
| Baseline | 0.37 | 15.2 | 5.7 | 8% |
| Attempt 1, first-assault breach penalty | 0.66 ✗ | 18.6 | — | 5% |
| Attempt 2, city-defence baseline 40 | 0.60 ✗ | 18.8 | 4.2 | — |
| **Attempt 3, fortress line 88** | **0.37 ✓** | 15.3 | 5.6 | **6%** |

Attempt three is **balance-neutral** (the per-seat figures are almost identical to baseline,
four gates 4/4), and it is not idle either — 6.7% of commanderies reach the fortress line by
the end of the game. **Kept** (content pack 1.2.0).

**But none of the three made sieges longer.** At this point a conclusion can be drawn:

> **Short sieges are not a numbers error; it is that a sixteen-season game makes a long siege
> irrational.**
> Pinning an army outside a city for two or three seasons has too high an opportunity cost —
> the bot lifts the siege when it cannot take the city (sieges lifted 679 → 1145), and that is
> rational. No local parameter tuning can change it.

To make sieges a real tactical line, the structure has to change: longer games, or sieges not
tying up an army, or a lower maintenance cost for a siege. All three are large changes; none
done.

**These three experiments are worth three methodological entries of their own**:
one, measure the baseline before changing balance (ρ=0.37 was the criterion for all three, not
something found afterwards);
two, two changes in opposite directions producing the same consequence shows that what was
perturbed is **pace**, not **direction**;
three, the right way to "make X worth more" is **to add at the top**, not **to move the
baseline** — the latter moves everybody, the former moves only those who choose to invest.

## Putting candidate keys into the schema's enum: buying correctness with money

**On** by default. The decoding layer enforces "you may only choose from the candidates"
(R13), at the cost of Anthropic's prefix cache being invalidated wholesale — OpenRouter
translates `json_schema` into a tool, and Anthropic's cache prefix order is
**tools → system → messages**, so the candidate keys change every season → the tool
changes → everything after it, the whole system, is wasted.
system is 38–52% of the input tokens, and at the 0.1× cache price that makes input about
2.8× more expensive.

Isolated experiment (the same 4.3k tok system sent twice in a row, claude-haiku-4.5):

| | 2nd call |
|---|---|
| no `response_format` | cached 4317 ✓ |
| present, schema constant | cached 4534 ✓ |
| present, schema different each time (the default) | cached 0, the whole block rewritten ✗ |

This was once changed to off by default, on the grounds that "measurement shows the enum
catches 0 errors". **That conclusion was wrong**; it was built on a sample of 1 game (16
seasons) per model. Scaled up to 6 games (96 seasons):

| claude-haiku-4.5 | Mean score | Illegal rate | unknown-key | Cache |
|---|---|---|---|---|
| enum off | 216.7 | 8.6% | 47 | 45% |
| enum on | 233.3 | 0.7% | 0 | 0% |

Those 47 are orders the model intended to issue and that were dropped, 8.3% of the orders
it issued. The score difference of +16.6 is not significant at 6 games (see the power
analysis above), but the illegal-rate difference is a direct mechanistic difference. And
reproducing long Chinese keys character by character is transcription ability, not
strategic ability; letting it into the score is measuring the wrong thing.

`--keyenum=off` buys the cache back; the scores it buys have to be read as "x% of that
model's orders were dropped".

Anthropic also requires an explicit `cache_control` breakpoint; a plain-string system
never hits once. OpenAI / Gemini / DeepSeek cache automatically, and either style works.

**The lesson here matters more than the conclusion**: a sample of 1 game and 16 seasons
cannot support any conclusion of the form "never happens". `unknown-key` is 0 across 16
seasons and 47 across 96.

## Token convention

`estTokens`'s coefficients were calibrated against three real tokenizers (13 real prompts,
least squares):

| | per Chinese char | per ASCII char | actual/estimated |
|---|---|---|---|
| anthropic/claude-haiku-4.5 | 1.300 | 0.446 | 1.59× |
| openai/gpt-5-nano | 1.040 | 0.420 | 1.37× |
| deepseek/deepseek-v3.2 | 0.855 | 0.467 | 1.33× |
| the old coefficients | 0.900 | 0.250 | — |

Claude's are used (the most conservative, and also the main subject of evaluation). The
unit of the observation budget gate `npm run obs:budget` is therefore **real tokens**,
defaulting to 10000 per seat-season.

## Related files

| File | Responsibility |
| --- | --- |
| `tools/eval-run.mjs` | Runs N games for a single agent. This is the only copy of the game loop |
| `tools/eval-suite.mjs` | Orchestrates several agents + aggregates the leaderboard. Does not duplicate the game loop |
| `tools/obs-budget.mjs` | Observation budget gate, exit 1 |
| `tools/selfplay.mjs` | Pure bot self-play, four gameplay acceptance checks |
| `lib/arena/llm/client.ts` | Fallback ladder, starvation detection, cache breakpoints |
| `lib/arena/seat/parse.ts` | Decision schema and lenient parsing |

---

## 31. The traversal graph is now solved from a cost field (content pack 2.0.0, old and new leaderboards not comparable)

One sentence from the user overturned the entire adjacency model:

> "Those ports along the Yangtze (长江), in theory you can get to all of them… it is not that
> because history only records a route from this port to that port, you can only travel
> between those two ports."

The old adjacency took candidate edges from a Delaunay triangulation plus manual
historical corrections, drawing **the roads the histories recorded**; the right question
is **whether it is geographically passable**. In the old table, **Donglai commandery
(东莱郡) and Liaodong commandery (辽东郡) were land neighbours** — with the Bohai Sea
(渤海) in between.

### The new model

One traversal cost per cell, determined only by slope and water. Dijkstra is run from all
105 administrative seats at once (2.23 million cells, **0.1 seconds**); territories that
touch are neighbours; and for every pair of neighbours a genuinely cheapest path is walked,
with `cost / km / terrain / nodes / crossings` all read off that path.
"Attaching passes and fords" therefore no longer needs any threshold: **if the path goes
through it, it goes through it.**

There is also a waterway layer: sea / great river / small river are cheap, inland is
impassable, and ports and fords are the openings between the two fields. Gongsun Du (公孙度)
holding Donglai across the sea rests on exactly this.

### Calibration: every number answers to a criterion

| Parameter | Criterion | Result |
| --- | --- | --- |
| Cost exponent 2.6 | whether a pass can be measured to have chokehold value | Tong Pass (潼关) 27% → **101%** |
| Barrier = 1600m above the local baseline | adjacency must not isolate commanderies | at 600m only 175 pairs remain and 9 commanderies are isolated |
| Shared border ≥ **6%** of the smaller side | **ρ (starting commandery count ↔ score)** | **0.37**, bit-for-bit identical to the baseline |

The third is the most important, and the only one where I went wrong first and then came
back:

- The first version used an **absolute cell count**. 8 cells → ρ **0.60** (Yuan Shu's
  exposed frontage 7→14, elimination 13%→30%;
  Liu Biao 12.1→14.4 commanderies). Tightened to 35 cells → ρ back to 0.37 — **but that
  was fake**:
  an absolute cell count penalises dense regions, where the territory of each commandery
  around Yanzhou and Jizhou (兖冀) is small to begin with,
  and 35 cells cut away adjacencies that are obviously real — Taishan commandery
  (泰山郡)–Jibei principality (济北国) (52km), Dongping principality (东平国)–Lu principality
  (鲁国) (63km), Hongnong commandery (弘农郡)–Hedong commandery (河东郡) (77km) — while
  leaving the 184–296km long edges of the Jiang-Huai (江淮) region.
  That ρ was bought by cutting away the frontages of the six main seats, not by calibrating
  correctly.
- After changing to a **relative criterion** (the share of the smaller side's border), at
  6% there are 233 edges,
  only 5 edges under 120km are lost, and ρ = 0.37.

### Acceptance

**Four gates 4/4, ρ = 0.37.** 233 edges (the same number as the old table),
and 5 factions have supply internally disconnected (6 in the old table).

**But the character of each seat changed, so old and new leaderboards are not comparable:**

| Seat | Old | New |
| --- | --- | --- |
| Cao Cao eliminated | 31% | 21% |
| Liu Zhang mean final | 13.7 commanderies | 9.0 commanderies (Yizhou is walled in by mountains — this is correct) |
| Yuan Shu eliminated | 13% | 33% |
| Lü Bu eliminated | 11% | 25% |

### Three real problems dug up along the way

One, **the Grade C criterion did not match the implementation**. The pack states flatly
that "it can only be had by attacking", yet `isolated-submit` (a neighbouring commandery
is cut off, runs out of grain, and the whole commandery comes over, with the receiving side
issuing no order at all) was also counted toward conquests. So sitting still for a whole
game could still reach Grade C. The old map happened not to trigger it (it had that edge
across the Bohai Sea connecting Donglai), and the hole was there all along. Changed to not
count.

Two, **a dozen tests took the map topology as a premise**. `attackPair` takes "the first
adjacent edge of the first commandery" — silently depending on the ordering of the
traversal graph. After the map changed, the first one became a mountain road taking two
months to walk, the army could not reach the city that season, and a dozen tests on sieges,
formations, unit types and mustering all failed together, while reporting "the first
assault should turn into a siege". Changed to take the **cheapest to march** edge (and the
ones verifying the combat formula further restrict to flat edges).

Three, **the terrain fallback formula in `build-adjacency.mjs` is a different criterion**.
After de-duplicating attachments removed the pass, it re-judged by `maxElev > 1400`, whereas
the original sampling went by the proportion of each tier along the route — the two were
always going to give different answers, so that edge fell back to a terrain that had **never
been measured**. (This one was fixed in the previous version.)

### March days per unit, 8 → 5.5

A unit conversion, not a pacing change: km went from "the straight-line distance between the
two seats" to "the path actually walked", the median cost rose 44% accordingly, and
8 ÷ 1.44 ≈ 5.5 pulls the median march time back to where it was. The siege clock and the
relief window both stay as they were.

---

## 32. Strongholds become strongholds (content pack 2.1.0)

> "Ports and fords and so on could actually all be put to use as strongholds."

Of the sixty-one strongholds, **thirty-seven did nothing whatsoever in the engine**: drawn
on the map, untouchable by the player. The remaining twenty-nine (passes and valley roads)
did no more than make "this edge counts as a pass road" — a property of an edge, unrelated
to who holds it.

### One rule running through five types

**The bonus for choking a place belongs to the owner of that place.**

If the attacker already holds the pass or ford on an edge, the defender loses the terrain
bonus on that edge, and siege engines are no longer halved.
Granaries do something else: they restore one extra season of provisions each season to
their owner's neighbouring commanderies (Aocang (敖仓), Liyang granary (黎阳仓), Wuchao
(乌巢), Meiwu (郿坞) — the Wuchao burned at Guandu is this very thing, and this is the first
time a granary does anything in the engine).

A new order, `seize` (take a stronghold, 1 order): send troops from a neighbouring
commandery, and if troops sent ≥ garrison ×1.5 it falls, with both sides losing fifteen
percent. Strongholds **do not count toward the commandery count** — the win criterion is at
province level, and if strongholds counted, three passes on one edge would be worth a
commandery.

### Only list the ones that can be taken

Taking a stronghold has a **determinate** outcome (troops sent vs troops needed, nothing
unknown), so the engine lists only the ones that can be taken. Measured without filtering,
the bot spammed **355 certain-to-fail attacks** in one game and took only 82; after
filtering it is 89 taken and 44 failed (the failures being ones where the garrison had been
moved by someone else earlier in the same season).

This differs from campaigns: campaigns must list the ones that cannot be won, because the
garrison has not been scouted and the outcome is uncertain to begin with. The same R13, two
different answers for two situations.

### Acceptance

**ρ = 0.37, bit-for-bit identical to the baseline, four gates 4/4.**
29 strongholds lie on roads, and 24 have owners at the start. The bot takes 89 in a game,
and at the end they belong to 14 factions.

### Incidentally

- Campaign candidate labels gained "(already in my hands, the defender has no pass
  advantage)" — a rule that takes effect but that the model cannot see is a rule hidden from
  it. The part most easily missed in four-way reconciliation is still the model's.
- `createGame` takes one more argument, `graph`: the stronghold table is built from it. All
  eight game-creation sites were changed — if a test does not pass it, what the test verifies
  is not the thing that actually runs.

---

## 33. ρ was always computed over six seats — I misread that criterion for a whole round

The conclusion first: **ρ was originally a Spearman over the six factions in SEATS. The
standard error at n=6 is about 0.58.**
Its value can only land on a handful of discrete points, and 0.37 and 0.60 are simply
inseparable at that sample size.

And I had been using it as a precision criterion: twice in point 30 as "ρ 0.37 → 0.6x,
reverted", and in point 31 to "tune ρ back to 0.37" by adjusting MIN_SHARE. Within the same
batch of changes, swapping the adjacency threshold makes ρ report 0.60 / 0.60 / −0.09, a
jump of 0.7 — that is not the mechanism moving, it is the statistic shaking.

After changing to compute it over **all factions holding a commandery** (30 of them), the
same three configurations give:

| MIN_SHARE | Old ρ (n=6) | New ρ (n=30) |
| --- | --- | --- |
| 0.06 | 0.60 | **0.31** |
| 0.11 | 0.60 | **0.34** |
| 0.13 | −0.09 | **0.31** |

The three configurations were never different; it was too small a denominator blowing noise
up into signal.

This is the same lesson as "a 6-game sample has zero resolution against a 20-point gap",
except this time the tuition was paid on the **denominator**. The lesson is recorded here:
**before using a criterion to veto a change, compute its standard error.**

## 34. Passes are waypoints: geography decides whether it connects, the sources decide which road

After the traversal graph was solved from a cost field, a dozen real passes — Wu Pass (武关),
Hu Pass (壶关), Jingxing Pass (井陉关), Fukou Pass (滏口陉), Guandu, Ruxukou (濡须口),
Jiameng Pass (葭萌关) — **lay on no cheapest path at all**: the edge they ought to choke does
exist, but A* crossed the Taihang (太行) somewhere else.

Widening the "ancient-road discount" did nothing (24 → 26, not a budge): the discount treats
all passes alike and cannot change which corridor a road takes.

The root cause is in the model: **terrain alone cannot reproduce historical roads.** A road
is where it is also because of its roadbed, its water and its settlements, and none of that
is in the elevation data. So the two each govern half — **geography decides whether two
commanderies connect and how far apart they are; the sources decide which pass that road goes
through**. Passes are set as waypoints (the criterion uses "extent", 79km), and A* walks it in
segments.

  Strongholds lying on roads: **26/61 → 51/61**
  The remaining 10: Yang Pass (阳关), Xuwen (徐闻), Houguan (侯官) (out of reach in this
  scenario), Aocang, Meiwu (granaries are not waypoints),
  and five ancient battlefields

Waypoints also need de-duplicating: a pass belongs to only **one** edge, the nearest one
(two for fords and ports). Without de-duplication, every edge within 79km claims it as a
waypoint, and pass-road edges go from 27 to 50 (21% of the whole map). Hulao Pass (虎牢关)
being attached to Henan Yin (河南尹)–Shangdang (上党) at the same time is this kind of error: going from
Luoyang (洛阳) to Shangdang crosses the Taihang by Tianjing Pass (天井关), not by Hulao.

### Ancient battlefields leave the map

The chokehold value of all seven ancient battlefields measures 0, and across 12 games and
5493 field battles **not one** took place next to them. They are "a battle was fought here",
not "a battle can be fought here". The data stays — the sources are good — but they are not
drawn on the map.

The map now draws only **living strongholds**: the criterion is the one the user set —
anything drawn has to be takeable, attackable or defensible, or has to explain one of those
three.

---

## 35. The premise of that siege conclusion is gone — it solved itself

Point 30 records three failed attempts, and one conclusion that was stated very firmly at the
time:

> **Short sieges are not a numbers error; it is that a sixteen-season game makes a long siege
> irrational.**
> Pinning an army outside a city for two or three seasons has too high an opportunity cost —
> the bot lifts the siege when it cannot take the city.
> No local parameter tuning can change it. Changing it requires structure: longer games, or
> sieges not tying up an army,
> or a lower maintenance cost. All three are large changes; none done.

That conclusion **had a premise**, and the premise was later removed by something else: once
the player game was changed to end on unification, **there is no season cap**. "Longer games"
was not done for the sake of sieges, but it is exactly the condition sieges were missing.

Three 64-season long games (`npm run playtest`, all bots, zero model calls, finishing
naturally at 32 / 21 / 52 seasons):

| | 16-season game (point 30) | Unbounded game (now) |
| --- | --- | --- |
| Average extension per siege | **0.07 seasons** | **0.61 seasons** |
| City opened for want of grain | almost never happens | **62 times** |
| Reinforcing a city already under siege | — | **339 times** |

**Ninefold.** And "opening a city for want of grain" and "reinforcing a siege" **can only
happen in a multi-season siege** — they went from leftovers at the margin to routine tactics.

### The real reason for recording this

Not "the siege is fixed", but that **those three changes were rightly reverted**. If the
numbers had been forced at the time until sieges got longer, then now that the game length has
changed, sieges would grow out of control, and nobody would think to go back and check those
three numbers.

When the diagnosis says "this is structural, local tuning cannot change it", the right thing to
do is **revert and write it down**, not keep tuning until the numbers look good. That record is
why today's re-check cost only one free long game.

---

## 36. One faction dominates in unification mode: making the coalition recurrent did not solve the problem

### First, "can a game be played to the end"

It can. Across 24 all-bot long games, **21 unified naturally between seasons 19 and 52**
(median 32 seasons), and 3 were still undecided at the 64-season test budget. 64 is the tool's
budget, not the game's cap.

### But across the 21 unifications, the winner is always the same faction

| | |
| --- | --- |
| Yuan Shao | **21 / 21** |
| The other thirty factions | 0 |

Not a coincidence: spot-checking 12 games, **the leader at season 16 is Yuan Shao in 12/12**,
with 22–29 commanderies, while the runner-up has only 11–18. He starts with 13 commanderies
(the most on the map), doubles in sixteen seasons, and after that nobody can stop him,
snowballing to as many as 58 commanderies by the end.

**This was exposed by removing the season cap**, from the same root as the siege matter in
point 35: the sixteen-season game length used to cover the snowball up — the eval grades on
**gain relative to the start**, so a snowball does not score; whereas "who unifies first" is
absolute, and the faction that starts largest necessarily wins.

### The coalition was changed; it did not help

The pack already contained a counterweight: hold 20% of the map (21 commanderies) and be 1.5×
the runner-up, and the empire turns on you — all alliances are void, nobody will ally with you
for eight seasons, and all bordering factions automatically ally with each other.

But its guard is `!f.coalitionAgainst`, **a boolean that is set once and never cleared: it
fires once per game**. That did not matter in a sixteen-season game (the bot's mean final is
16.0 commanderies, below the threshold, never triggering in a whole game), but in an unbounded
game the hegemon crosses the threshold in seasons 14–16, it fires once, and eight seasons later
it lapses — and he is only just past halfway.

Changed to **recurrent** (if he is still dominant when the no-alliance period expires, it
starts again; if he shrinks back below the threshold, it is lifted):

| | Before | After |
| --- | --- | --- |
| Coalition triggers | 1.0 per game | **3.2 per game** |
| Yuan Shao unifications | 21/21 | **20/20** |
| Sixteen-season eval ρ | 0.13 | 0.13 (bit-for-bit identical) |
| Four gates | 4/4 | 4/4 |

**The mechanic is alive, the problem is not solved.**

### Why it did not help — this is the part worth recording

**The coalition strikes at "forming alliances", and a hegemon three times everyone else's size
does not need allies at all.**
Its three weapons:

1. Voiding his alliances — he does not care
2. Bordering factions automatically ally with each other — that only keeps the neighbours from
   fighting each other; it does not direct any force at him
3. A `+5` score in the bot's target selection — the only one that really directs force at him,
   but in a pile of scores it is only a nudge

To counterweight a snowball you need a mechanic whose **cost grows with size and that the
hegemon cannot dodge**. The diplomacy pipe is empty for someone who does not need diplomacy.

### The reason for keeping it (narrow)

The one-shot guard was an **accident** left behind by removing the season cap — a hegemon ought
to keep paying a price, not pay a toll once. The change is completely invisible to the
sixteen-season eval (ρ, the four gates and the per-seat figures are all bit-for-bit identical),
and it is wired up data-driven (`联军.可复发`; turn it off and the old behaviour returns).
**But it does not solve faction imbalance, and the criterion originally set was not met.**

## 37. The first model run on the Jian'an 5 scenario: $0.2887, and the five holes it hit

After adding the second scenario (Jian'an 5 · the eve of Guandu (建安五年·官渡前夕), the
first month of 200 CE, twenty factions), the evaluation pipeline was walked end to end
again. **Validate with the free bots before you run it** — that rule earned its keep
once more today: five of the six holes were turned up by the bot runs, and only one of
them needed money to become visible.

### What the free run turned up

| Hole | Symptom | The actual cause |
|---|---|---|
| eval-run default seats | Line 336, `Cannot read properties of undefined (reading 'bestGrade')` | The default seats are the six factions from 194, and Yuan Shu (袁术) and Lü Bu (吕布) are no longer around in Jian'an 5. The error site is three hundred lines from the cause |
| Officer allegiance | Sun Ce's (孙策) faction opens with **not a single officer** | The field name `affiliation194` carries the year in it. Measured: 77 people with no lord, and Sun Ce himself still filed under Yuan Shu, dead a year by then |
| Era dating | The record header printed 「第 1/16 季　194 年·春」 (season 1/16, 194, spring) on a game that was Jian'an 5 | `createGame`'s `year` defaults to a hard-coded 194, and **the observation carries clock.year** — the model uses it to judge who ought to be on the board |
| Rules digest | The digest said both 「朝廷所在=颍川郡」 (court located in Yingchuan commandery) and 「须持朝廷（据京兆尹）」 (must hold the court, which sits at Jingzhao) | The packing step rewrites the commandery holding the Emperor per scenario, but it only covered the `preconditions` of the office-granting order and missed the summary |
| Draw pool | Ma Teng (马腾) and Lu Kang (陆康) **were never once drawn** | melee and match-log each keep their own copy of the pool, and both misspell the ids as `maten` / `luking`; the filter drops them silently, on a "does this faction exist" check |

A gate was added for every one of them; see `tests/roster-scenario.test.mjs` and
`tests/pack-drift.test.mjs`.
**What the five have in common**: none of them raises an error, none of them shows
itself until the day you add a second scenario, and the symptom sits hundreds of lines
away from the cause. With only one scenario they do not exist.

### The run that cost money

`z-ai/glm-5.3-flash`, six games (one per seat, so the quota comes out even), sixteen
seasons, `--reasoning=low`, **$0.2887 actually charged**, 96 calls and 0 failures.

| Seat | Best-ever/final grade | Score | End/start commanderies | Illegal rate | Observation peak |
|---|---|---:|---|---:|---:|
| Cao Cao | Grade B / Grade D | 200 | 31/24 | 8% | 9605 |
| Yuan Shao | Grade C / — | 100 | 21/19 | 1% | 9204 |
| Liu Bei | Grade A / Grade D | 300 | 1/3 | 11% | 8080 |
| Sun Ce | Ascendant / — | 400 | 14/5 | 6% | 8543 |
| Zhang Lu | Grade B / — | 200 | 5/1 | 4% | 6977 |
| Liu Zhang | Grade A / Grade D | 300 | 17/9 | 9% | 8982 |

Mean score 250.0, illegal rate 6.3%, order-budget utilisation 88%. On the same batch of
seeds (`eval-0..5`) the `bot:balanced` baseline is **200.0**.

**This is not "the model beat the bot".** Six games, where the lower bound this repo
sets is 48 games; three of the seats collapsed (final grade D), and grade and score are
counted from the best-ever grade. A 50-point gap in the mean amounts to three of the six
games each coming out one grade higher — at n=6 that falls inside the noise.
There is exactly one thing that can be said:
**the pipeline runs end to end, the observation peak of 9605 tok is inside the
ten-thousand gate, and not one call failed.**

### Elsewhere: the bots never once used the Guandu stronghold play

Jian'an 5 brings in the entire geography of the Guandu campaign — Guandu (官渡) and
Yanjin (延津) are fords, Wuchao (乌巢) and the Liyang Granary (黎阳仓) are grain depots —
and the engine already has `seize`: you can take a stronghold without taking its
commandery (garrison 1600, troop ratio needed 1.5). Cao Cao has seven seize candidates
in the very first season, and among them **taking the Liyang Granary from Dong
Commandery (东郡)** is precisely Yuan Shao's forward grain depot; Yuan Shao's mirror of
it is taking Yanjin from Wei Commandery (魏郡), where Wen Chou (文丑) fell.

Measured over 12 games × 16 seasons, the bots seized a stronghold 29 times, and the
targets were Chaisang (柴桑), Hepu (合浦) and Panyu (番禺) — **all southern ports, and
not once anywhere on the Guandu line** (the same in the 194 scenario: Hengjiang Ford
(横江津), Niuzhu (牛渚), Ruxu Mouth (濡须口)).

The mechanic is not broken. In the bot's scoring a stronghold is worth only the road it
commands, and the two on the Guandu line sit astride the one line where two large armies
are already facing each other head-on, so that weight cannot outweigh attacking a
commandery outright. **This is exactly the kind of place where a model could open a gap
on the bot**: whether it goes for the opponent's grain depot, which the baseline never
does. It is recorded here so that next time there is a model run, we know what to look
for.

(Wuchao and Guandu itself are hosted in Chenliu Commandery (陈留郡), and Chenliu is
surrounded on every side by Cao Cao, so nobody can take them at the start — the front
has to move up first. That follows necessarily from "the commandery is the atom"; it is
not a gap.)

### Incidentally: the console table had been lying all along

Liu Bei's row used to print 「甲 300 分　终郡 1/3」 (Grade A, 300 points, ended holding
1 of 3 commanderies) — top grade while losing ground, which leaves a reader no option
but to suspect the scoring is broken. The cause is that grade and score are counted
from the **best-ever grade**, and the console had only that one column. The tables in
this document have always carried two, "best-ever / final-standing grade"; the console
was printing one column short, and it has been added.

### The baseline: 48 games, free, and it proves the two scenarios are not on the same ruler

A model's score only means anything against a reference point, and the lower bound point
1 of this document gives is 48 games. Filling that in:

| Scenario · profile | Mean score | Eliminated | Mean score by seat |
|---|---:|---:|---|
| Jian'an 5 · balanced | 200.0 | 0/48 | Sun Ce 312　Liu Bei 262　Yuan Shao 162　Zhang Lu 162　Liu Zhang 162　**Cao Cao 138** |
| Jian'an 5 · purpose | 208.3 | 0/48 | Sun Ce 312　Liu Bei 262　Cao Cao 250　Yuan Shao 212　Liu Zhang 200　**Zhang Lu 12** |
| Xingping 1 · balanced | 158.3 | 1/48 | Liu Biao 300　Yuan Shao 250　Cao Cao 125　Yuan Shu 125　Liu Zhang 100　Lü Bu 50 |

Three things:

**1. The same agent is 42 points apart across the two scenarios (200.0 against 158.3).**
Grades are assigned on the increment relative to the opening, and the Jian'an 5 seats
have more room to grow. **The scores from the two scenarios are not on the same ruler** —
250 points on Jian'an 5 and 250 points on Xingping 1 (兴平元年) are not the same thing.
Boards must therefore be kept separate by scenario, and that is now gated
(`build-leaderboard.mjs` refuses to produce a board when the arms disagree on scenario).

**2. Cao Cao is the hardest seat in Jian'an 5** (138 on balanced, the lowest of the six;
he collapsed in six of his eight games, and his territory is still shrinking).
Historically he was the side under pressure, and for evaluation purposes "the
protagonist's seat is the hard one" is exactly what you want.

**3. Swap the profile and one seat can move by more than tenfold.** Zhang Lu scores 162
on balanced and **12** on purpose; Cao Cao goes the other way, 138 → 250. This is
precisely what profile rotation exists to expose — **a ranking without rotation measures
the pairing of profile and opening, not the strength of the agent.**

The raw data is in [reports/scenario-200-2026-10-16/](reports/scenario-200-2026-10-16/)
(Chinese).

### The reasoning budget blew up the first time

The earliest smoke run (with no `--reasoning` set) produced this in its very first
season:
`✗ 无内容（finish=length，出参预算 32000，推理占 32000）`
(no content; finish=length, output budget 32000, of which reasoning took 32000) —
three attempts, 241 seconds spent. With `--reasoning=low` added, each decision came
down to 5–16 seconds. It is recorded here because **a cheap-tier model's reasoning
budget has to be tuned, and leaving it untuned burns wall clock and money together** —
and the failure classifier records it as a model failure, which it is not.

<!-- translated-from: EVAL.md@cf1b0336b8d6 -->
