[中文](DECISION-COMPARISON-2026-09-28.md) · [English](DECISION-COMPARISON-2026-09-28.en.md)

# Fixed-scenario model comparison · 2026-09-28

## Conclusion

**This round mini had fewer orders rejected and did carry out the key withdrawals; but upgrading the model alone is not enough to make the strategy plan reliable.**
Keep the product direction of choosing a model per faction; mini can be a candidate when one is willing to pay more. The sample is too small to make it the sole recommendation or to auto-upgrade every faction.
The next step is to fix the checking and the display that link "facts, plan, adopted actions", and only then widen the model testing.

All 9 live decisions returned, over 13 actual request attempts; 42 orders adopted and 12 dropped in total, with 0 further rejections by the engine after adoption. One run per model per scenario — no stable win rate can be estimated from this.

| Model | Adopted / submitted | Dropped | Reported cost over three runs | Main observations this round |
|---|---:|---:|---:|---|
| GPT-5 nano | 10 / 14 | 4 | $0.005143 | Liaoxi (辽西) had already come over to us, yet it copied over “尚未取得” (not yet taken); in the out-of-provisions scenario it did not withdraw, and the campaign in its plan was rejected because the city's order budget was exhausted |
| Gemini 2.5 Flash-Lite | 16 / 23 | 7 | $0.005651 | Can read off several gains, losses and sieges, but its combined orders went over the limit, and the plan contradicts itself on ownership |
| GPT-5 mini | 16 / 17 | 1 | $0.023932 | When the seat fell it moved the seat and withdrew; when provisions ran out it also lifted the siege; it still does not update the plan status correctly, and its exit conditions contradict its actions |

mini's cost over three runs is about 4.7× nano's and 4.2× Flash-Lite's. That is a small-sample cost that includes whatever cache hits occurred on these runs, not a fixed long-term price gap. All three models used `reasoning.effort=low`, but there is no guarantee that each provider interprets that rung as the same amount of compute.
The two OpenAI models used `schema-notemp`, Google used `schema`; the JSON candidate constraint is identical, the temperature parameter differs.

All **9/9** plans were still marked `continue`. Every prior plan here had an adjustment or completion condition that had already fired, so this round the status field cannot be treated as a trustworthy signal of plan progress. It also did not stop some of the models from changing their objective or issuing more sensible orders.

## Scenario-by-scenario review

The assessment covers the full returned plan and the stored plan, read together with the reason field and the orders actually adopted;
"partly omitted" means it did not fully restate the facts agreed before the test, and does not mean that every order it issued was wrong.

| Scenario / model | Fact review | Plan vs. actual action |
|---|---|---|
| Seat / nano | Partly omitted: did not fully acknowledge the two losses, Donghai (东海) and Peiguo (沛国); the review mostly wrote up attack expectations | Objective changed to Donghai yet still `continue`; the campaign was adopted, and the seat was still not recovered by the end of the first season; building a salt works was rejected |
| Seat / Flash-Lite | Partly omitted: recognised the fall of Donghai and the supply cut, missed Peiguo | Actually moved the seat to Guangling (广陵); the plan still writes moving the seat to Pengcheng (彭城) as the fallback if that fails, which differs from the action actually adopted; two orders rejected |
| Seat / mini | Partly omitted: recognised the loss of the seat, the supply cut and the in-transit army's remaining provisions, missed Peiguo | Actually moved the seat to Pengcheng and recalled the in-transit army from Donglai (东莱); all six orders adopted, but the status is still `continue` |
| Multi-front / nano | Clearly wrong: “辽西尚未取得” (Liaoxi not yet taken), in direct conflict with `ownership=own` and `gained=辽西` | Copied the prior plan over in full, yet the orders send troops from Liaoxi to the Liaodong Dependent State (辽东属国); did not respond to the two places under siege, and a duplicate campaign was rejected |
| Multi-front / Flash-Lite | Clearly wrong: the review correctly says Donghai and Liaoxi have been taken, while preparation says it is preparing to attack Liaoxi; the seat's status is not stated | Both relief operations were adopted; the four orders after them were rejected for insufficient AP, and two commanderies were lost in the first season; "understood that there was a siege" must not be counted as a successful relief |
| Multi-front / mini | Partly omitted: recognised the two newly gained commanderies and the two sieges, did not state whether it still held the seat | Reinforcing Beihai (北海) actually succeeded in taking the city, and it stockpiled provisions at both places; the muster was rejected because the source commandery's order budget was already full; still writes “两处同时被围则中止进攻” (if both places are besieged at once, abort the attack) even though that condition already holds |
| Provisions / nano | Partly omitted: did not re-check the gain of Jiujiang (九江) or the losses of Guangling and Langye (琅邪), and did not respond to the one season of provisions left | Construction filled up Xiapi's (下邳) order budget, and the Donghai campaign in its plan was rejected; no withdrawal, and no action that actually restored the rear |
| Provisions / Flash-Lite | Clearly wrong: the review knows the seat has already moved to Xiapi, yet the objective says “夺回治所” (retake the seat) while Xiapi is still ours; it did read the gains, losses and the provisions risk | A relief order was adopted, but a second relief order on the same target was rejected; it did not withdraw the Donglai army. At actual resolution the siege of Xiapi had already been lifted, and the relief force turned back without fighting |
| Provisions / mini | Partly omitted: recognised that Xiapi is now the seat and that Donglai has one season and Rencheng (任城) two seasons of provisions left, did not re-check the three territorial gains and losses | Both besieging armies were actually withdrawn; at the same time it writes “军粮归零、军队溃散时撤回” (withdraw when army provisions hit zero and the army breaks up) as the exit condition, which contradicts in timing what it did, and once the army has broken up there is nothing left to withdraw |

Two of Flash-Lite's reviews exceed 160 characters — 190 and 230 characters in the original — and were cut to 160 characters on entering the cross-season memory.
This is the existing length-trimming behaviour; this round keeps the full responses for checking, and does not blame the model for everything missing from the tail.

## Actual short-term consequences

The table gives the territory count after the first season's decision resolves and after the two seasons that follow, once the free bot takes over. Even in the empty-order branch, existing armies keep fighting,
other factions keep acting and passive events keep happening — the world is not frozen. **The model is not in control for the last two seasons.**

| First-season controller | Seat lost (4 commanderies at start) | Multi-front war (6 commanderies at start) | Siege and provisions out (3 commanderies at start) |
|---|---|---|---|
| Normal bot | 3 → 3 → 1 | 6 → 7 → 6 | 3 → 1 → 1 |
| Empty orders | 4 → 4 → 5 | 6 → 8 → 7 | 4 → 2 → 1 |
| nano | 4 → 4 → 5 | 6 → 8 → 7 | 4 → 3 → 2 |
| Flash-Lite | 4 → 5 → 5 | 4 → 6 → 5 | 3 → 2 → 2 |
| mini | 4 → 4 → 3 | 7 → 9 → 7 | 3 → 2 → 2 |

For instance, nano's territory count in the multi-front scenario is the same as the empty-order branch; not losing cities is no reason to judge that it read the position correctly.
mini moved the seat and withdrew in the seat scenario and still did not end up with the highest three-season territory count.
This round supports judgements about specific errors and differences in action, nothing more; it does not prove that any model can always unify, or that any one action is best in the long run.

## Suggested order of implementation

1. **First make the cross-season memory reflect the actions actually adopted.** The plan still keeps the AI's own text, but rejected key campaigns, seat moves and withdrawals must be explicitly tied to the actual resolution.
   This round nano wrote that it would campaign and then only built things, which is a more immediate problem than how well anything is worded.
2. **Flag the contradictions that can be checked outright.** A target already held still being called “尚未取得” (not yet taken), the main objective changing while the status stays `continue`, and so on:
   raise these from structured target ownership, status changes and the action record. Complex natural language must not pretend it has already been verified automatically.
   The besieging army's rear commandery and its remaining provisions should also become explicit fields, to cut down on inferring from prose dispatches and army IDs.
3. **Keep letting the user pick the model, and keep screening with fixed scenarios.** mini can be used for a few key factions, with cheap models for low-cost spectating and debugging.
   When stronger reliability is needed, first validate process improvements on these failure cases, and only then consider widening the model or the seed count.
   Do not add a paid second review by default, and do not change the global default model on the strength of these 9 responses.

This round adds a comparison tool and a report; the game rules, the prompt, the save format and the default model are all unchanged.

## Agreed before the test

The question this round answers: does raising the model tier for a single decision improve its grasp of the situation and its plan updates? This is not a win-rate leaderboard.

Using rule pack 2.3.0, prompt 1.18.0 and observation 1.4.0, three states were drawn from the free natural game `strategy-cases-0`.
Each state was given once to GPT-5 nano, Gemini 2.5 Flash-Lite and GPT-5 mini.
mini is this round's higher-cost candidate; whether it is more reliable is judged from the actual responses.

For each scenario the game state, system, user and candidate schema were all checked by SHA-256.
The prior plan is a **hand-seeded conflicting memory** and all three models received the same content; it is not a plan the model itself had written earlier.
So what this round measures is the ability to spot a contradiction and update the plan, not the ability to plan autonomously over time.

| Scenario | Checkable facts in the input | Plan and action checks |
|---|---|---|
| Liu Bei (刘备), turn 2, seat lost | Lost Donghai and Peiguo last season, gained no commandery; the Donghai seat is not ours | Does it reject the prior plan's “治所仍在” (the seat still stands)? Does it adjust status and objective? Does it adopt a seat move or a well-founded recovery plan? |
| Liu Bei, turn 3, siege and provisions out | Gained Jiujiang, lost Guangling and Langye; the current seat has already moved to Xiapi and is still held; the besieging army at Donglai has only one season of provisions left | Does it distinguish the loss of the old seat from the current seat? Does it acknowledge that running out of provisions triggers the exit condition? Does it lift the siege or actually restore supply — saying it withdraws in prose only does not count |
| Gongsun Du (公孙度), turn 3, multi-front war | Gained Donghai and Liaoxi, lost no city; the Liaodong (辽东) seat is still held; Donghai and Donglai are besieged at the same time | Does it see that the old objective “取得辽西” (take Liaoxi) has already been achieved? Does it update the plan? Does it arrange a defence, or state plainly which place it gives up and why? |

Facts are reviewed by hand as "fully correct / partly omitted / clearly wrong", listing the specific omission or contradiction; mentioning a keyword does not automatically count as correct.
Plans are reviewed on whether the old conditions have already fired and whether status and explanation are consistent; no single optimal order is insisted on.
Actions are recorded as adopted, as dropped with a reason, and as rejected again at resolution; legal does not mean strategically effective.
Particular attention goes to whether "what it says it will do" matches "the orders actually adopted".

Each model controls only the first season; the two seasons after that switch to the free bot. There are also controls with a normal bot in the first season and with empty orders in the first season,
likewise followed by the bot. The three-season result is used only to observe the short-term consequence of this one choice, and is not attributed to a model's long-run strength.
Short-term gains under a fixed seed are also not the sole standard of good or bad.

## Cost and reproduction

`tools/decision-compare.mjs` runs only the free control by default; `--live` is what makes it request a model.
At most 9 decisions, at most 2 attempts each, 8000 output tokens, a 90-second request timeout;
only the three models above and the fixed OpenAI / Google providers are allowed, with no routing fallback.

Before each request, the reservation for two attempts is computed from the actual UTF-8 byte count plus envelope margin, the endpoint's highest price and the maximum output.
The conservative hold must not exceed **$0.20**; a failed attempt that reports no cost keeps the full amount, and a successful response releases only the margin that is now known.
The price must be confirmed by querying the endpoint on that run — missing or increased, and the run is refused; the directory is created exclusively, and overwriting an existing run is refused.
The budget reservation is a local guard; the actual bill is still whatever the provider says.

References: [OpenRouter mini pricing and endpoints](https://openrouter.ai/openai/gpt-5-mini),
[structured outputs documentation](https://openrouter.ai/docs/guides/features/structured-outputs).
The run's highest endpoint input/output unit prices and what the calls actually reported are stored separately in the raw report.

```bash
# 免费
node --experimental-strip-types tools/decision-compare.mjs --out /tmp/decision-free-new

# 付费：必须使用新的输出目录
node --env-file-if-exists=.env.local --experimental-strip-types tools/decision-compare.mjs \
  --live --out /tmp/decision-live-new

# 免费重放已归档的真实响应，核对输入、解析准入、45 次结算及费用预留
node --experimental-strip-types tools/verify-decision-comparison.mjs \
  --report docs/reports/decision-comparison-2026-09-28/live.json
```

## Verification evidence

The 9 live responses have the provider, generation ID, raw content, token usage and cost saved.
For the same scenario the input hashes all match; the fixed provider and the structured output both passed; there was no provider output-budget truncation and no call failure.
The 13 attempts include the downgrade taken when OpenAI does not support the temperature parameter; unknown costs continue to be held at the full reservation.
Total reported cost **$0.0347267067**, conservative hold **$0.107643507 < $0.20**.

Regenerating the three states offline from the same seed and replaying the 9 live responses, **all 45 resolutions across 15 branches match**,
including the plan record, admission, own-side events, territory, treasury, seat and the gains/losses summary; 0 additional paid requests.

24 targeted tests pass; lint and the diff check on the new script pass.
The default free path actually ran 6 branches and 18 resolutions; a repeated output directory was refused and the original report left unchanged.
A doctored report with an altered treasury number was rejected by the offline re-check, so a corrupted record cannot pass as verified.
This round changed no page and no production logic, so there is no need to substitute a browser or a repeated build for these script-boundary checks.

[Live requests and resolutions](reports/decision-comparison-2026-09-28/live.json) ·
[Free control](reports/decision-comparison-2026-09-28/free.json) ·
[Verification summary](reports/decision-comparison-2026-09-28/verification.json)

<!-- translated-from: DECISION-COMPARISON-2026-09-28.md@b83145991274 -->
