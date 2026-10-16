[中文](STRATEGY-PLANS-2026-09-28.md) · [English](STRATEGY-PLANS-2026-09-28.en.md)

# Strategy Plans and Order-Consistency Acceptance · 2026-09-28

This round delivered three things: unified validation of combined orders, structured cross-season plans, and low-cost validation on fixed scenarios.
Versions are pack **2.3.0**, prompt **1.17.0**, save **10**. Old saves must be restarted.

## 1. Unified order validation

`OrderBudget` is shared by the player's selection preview, model admission, every kind of rule-based bot, and the real resolution.

- The same troop source or target cannot be used for duplicate campaigns, and the same officer cannot be reassigned to several places in one season; lifting a siege and reinforcing the same target are mutually exclusive.
- A troop transfer cannot tie up troops at the same time as a campaign or a massing from the same source; transfer pre-allocation and resolution share `allocateTransfers`, and troops received this season cannot be forwarded onward.
- Treasury, building slots, faction order budget, commandery order budget and free uses are reserved cumulatively. Income that has not yet arrived is not spent in advance.
- The model's legal orders are admitted in the order it chose, with the reason recorded for each dropped order; resolution still executes in the canonical order. The page displays the reasons in Chinese.

What is guaranteed here is that orders are legal and resources are not committed twice. Enemies acting at the same time can still make the result come to nothing; a legal order is not a guaranteed success.

## 2. Cross-season plans shipped

The new plan stores `objective / target / stance / preparation / abortWhen / status / review`: the objective, the target commandery, the offensive/defensive stance, the preconditions, the conditions for withdrawing or adjusting, the status, and the basis for the review.

The next season's request receives the previous season's plan, the actual battle report, the previous season's dropped orders, and `planFeedback`. The feedback includes one's own territory and treasury; when a target commandery exists it adds the public ownership and one's own garrison or marching status, and it does not read the enemy's hidden troop strength. A bad plan does not overwrite the old plan, and the page shows a warning. The old free-text strategy plan is still usable for replaying historical records.

The plan is readable in the controller panel, in recent decisions, in saves and in logs. The page labels the model's own account as “AI 判断” ("AI judgement") and separately shows the current facts; it does not treat a model's claim of completion as an engine ruling.

## 3. Fixed-scenario live runs

Positions were taken from the natural bot game on `strategy-cases-0`, with no troops or money added by hand: Lü Bu (吕布) with a tight treasury at the opening, Lü Bu in a siege in season 3, and Gongsun Du (公孙度) attacked on several fronts in season 4. Each scenario was run for two seasons separately with the bot, with GPT-5 nano and with Gemini 2.5 Flash-Lite, all other factions being free bots. Within a scenario, every controller uses the same starting state, and the state hash is on record.

| Scenario | Controller | Commanderies | Treasury | Model admitted / dropped |
|---|---|---|---|---|
| Tight treasury | bot | 6 → 5 | 600 → 1233 | — / — |
| Tight treasury | gpt-5-nano | 6 → 7 | 600 → 1505 | 16 / 0 |
| Tight treasury | gemini-2.5-flash-lite | 6 → 5 | 600 → 1321 | 17 / 1 |
| Siege ongoing | bot | 5 → 5 | 1233 → 1139 | — / — |
| Siege ongoing | gpt-5-nano | 5 → 5 | 1233 → 744 | 13 / 3 |
| Siege ongoing | gemini-2.5-flash-lite | 5 → 4 | 1233 → 1027 | 14 / 5 |
| Attacked on several fronts | bot | 6 → 7 | 1976 → 3593 | — / — |
| Attacked on several fronts | gpt-5-nano | 6 → 7 | 1976 → 2818 | 8 / 3 |
| Attacked on several fronts | gemini-2.5-flash-lite | 6 → 7 | 1976 → 3522 | 16 / 3 |

Across 12 valid model decisions, **84** orders were admitted and **15** dropped; after admission, the real resolution rejected **0**. Dropped orders include duplicate targets, reassignment conflicts, and insufficient order budget or commandery quota. Every valid response carried a structured plan.

A checkable example: in the multi-front scenario Gemini took Beihai (北海国), and the next season's input had `planFeedback.ownership` as `own` with a garrison of 1999; its review mentions taking Beihai and losing Donghai (东海), after which it changed the objective to the Liaodong Dependent State (辽东属国). In the siege scenario Nano's review text was exactly the same in both seasons, which shows that wiring up memory is still not enough to guarantee it reviews correctly.

### Provider compatibility and cost

Gemini's first request hit a 400. An isolated diagnosis returned the reason: too many constraint states in the JSON Schema; dropping the string-length constraints still failed, and after further removing `picks.maxItems` the same natural scenario succeeded. The candidate `enum` was kept, and the app still hard-limits orders to 16 and caps the length of the plan fields. This handling also matches what the [Gemini structured-output documentation](https://ai.google.dev/gemini-api/docs/structured-output) says about complex schemas possibly being rejected.

The scenario script pins the cheap providers OpenAI / Google, with at most 2 attempts each, 8000 output tokens, a 90-second timeout, at most 14 decision calls in total (including the two failures) and 28 attempts, plus a conservative **$0.20** cost gate. Current prices and payload size are checked before each run.

- Costs reported by successful scenario responses total **$0.02218085**.
- The two small-schema diagnostics total **$0.0003236**; one further full diagnostic failed and returned no cost.
- The real page separately ran Nano for two seasons, with the page's running total showing about **$0.0034**.
- Reported cost for this round is about **$0.026**. Failed requests, and some requests that stepped down a rung, report no cost at all, which must not be taken as a confirmed zero; this is not the account's total bill.

The last season was once blocked by the cumulative reservation. The script now releases only the unused remainder of "the last request that succeeded and reported a cost"; failures and other attempts keep their full reservation. The final cumulative reservation was $0.213036 with $0.06685255 released, for a conservative occupancy of **$0.14618345 < $0.20**. The cap was not raised. The resumed run replays the first season that had already succeeded and checks the battle report, territory and admitted orders against it, issuing new requests only for the unfinished second season.

The first two Nano decisions reuse results from before the schema was simplified, so the global `planFeedback` had not yet been added. The other 10 come from the fixed protocol; this set of results is therefore for pipeline acceptance and cannot serve as a same-version model ranking. Both the original failures and the reuse are kept on record.

## Engineering and page evidence

- The full suite of 195 tests passes; after finally adding assertions for the parse cap and the global feedback, the 7 related tests pass, covering 196 distinct tests in total. Typecheck, lint and build pass.
- All 333 seat-season observations stay under 10000 estimated tokens, peaking at 9798.
- The 100-game free eval baseline passes 4/4: a median of 61 commandery changes of hands, Cao Cao (曹操) eliminated in 25/100, and a correlation of 0.13 between starting commandery count and score. This keeps the 16-season eval metric.
- A separate unification run over 6 seeds: natural endings at 32, 21, 52, 28, 30 and 34 seasons, all won by Yuan Shao (袁绍). The engine and runtime hashes match the scenario validation.
- Real browser `/play`: Nano assigned to Yuan Shao only, advanced two seasons by hand, with 12 orders admitted and 3 dropped in total; after a refresh it restored season 3, the paused state, 2/4 of the quota used, and the structured plan. The objective, preparation, adjustment conditions, review, facts and the Chinese dropped-order explanations were all checked; no console errors.

A normal game still ends on the unification condition. The script's external season budget only pauses validation; it does not mark the game as finished.

## Conclusions that still cannot be drawn from this

Two-season scenarios can only validate continuous requests, constraints and feedback; they cannot prove improved long-term playing strength, nor rank models. Plans may misread ownership, write an intention up as an outcome that has already happened, and use vague withdrawal conditions; long fields get truncated by the app. All six unification games were won by Yuan Shao, which likewise does not prove factional balance. If the next round continues to optimise, it should set up quantifiable comparisons separately for review accuracy and for opening factional balance; there is no need to first scale up an expensive all-AI long game.

## Reproduction and raw records

```bash
# 默认免费：自然局面 + 机器人对照
node --experimental-strip-types tools/strategy-cases.mjs --out /tmp/strategy-cases-new

# 显式付费：只运行上述两种廉价模型；输出目录不能重复使用
node --env-file-if-exists=.env.local --experimental-strip-types tools/strategy-cases.mjs \
  --live --out /tmp/strategy-cases-live-new

# 免费统一验证，256 季为外置验证预算
node --experimental-strip-types tools/unification-audit.mjs \
  --seeds 6 --budget 256 --out /tmp/strategy-unification-new
```

*Comments in the block above, in order: "Free by default: natural position + bot comparison"; "Explicitly paid: runs only the two cheap models named above; the output directory cannot be reused"; "Free unification validation, 256 seasons being the external validation budget".*

After an interruption, `--resume-from <report.json>` can be used; if the engine or runtime differs, reuse is refused, so it will not automatically pay to re-run every scenario that already succeeded.

[Scenarios and plans](reports/strategy-plans-2026-09-28/cases.json) · [Validation summary](reports/strategy-plans-2026-09-28/verification.json) · [Unification long games](reports/strategy-plans-2026-09-28/unification.json) · [Failure records](reports/strategy-plans-2026-09-28/failed-attempts.json) · [Provider errors](reports/strategy-plans-2026-09-28/schema-complexity-error.json)

<!-- translated-from: STRATEGY-PLANS-2026-09-28.md@7d84140a33fd -->
