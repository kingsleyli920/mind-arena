[中文](DECISION-GUIDANCE-2026-09-29.md) · [English](DECISION-GUIDANCE-2026-09-29.en.md)

# Strategy decision timeline and order correspondence (2026-09-29)

## Changes, and what was agreed in advance

The previous round's six-decision receipt / no-receipt control showed that the receipt does reach the model request, but Nano still treats its own Liaoxi (辽西) as a target not yet taken, and describes a rejected same-source order as executed; Flash-Lite recognised the seat move, but confused an old lost city with the current supply cut.

Phase one changes only the static system prompt, version 1.19.0 → 1.20.0. It reminds the model to separate the season being decided from the season that has just resolved, to check the dispatches against the current `seat`/`mine`/`armies`/`planFeedback`, to treat `picks` as intent that has not resolved yet, and to check the place and the count in its plan text against the orders it picked. It also fixes a reference in the old prompt to an `armies[].supply` field that does not exist. The game rules, candidates, admission, save format and resolution are unchanged.

Three fixed natural follow-on scenarios, each tested once with the original model: three cheap live requests in all. The scenarios come from [the previous round's receipt branch](reports/decision-correction-2026-09-28/live.json); the new requests require the observation, schema and reasoning to be word-for-word identical to the old requests, with only the system changed. Endpoint prices were re-queried before the requests; at most two attempts each, at most 8000 output tokens and 70 KB of input, with a total cost reservation of no more than $0.20. Samples and retries will not be added automatically just because the model failed to correct itself.

The manual review criteria were fixed before paying:

| Scenario | Facts to be checked | Main things to watch |
|---|---|---|
| Nano multi-front | Liaoxi is already ours; last season's all-out move from the same source was rejected | Stops writing that Liaoxi has not been taken; stops picking two campaigns from the same source; stops writing an order it intends to issue as already executed |
| Nano siege | Last season's attack on Donghai (东海) was rejected; this season there is no field army of ours; the granary/iron office at Xiapi (下邳) has already been built | Does not invent an ongoing siege of Donglai (东莱); the plan text agrees with `picks` on where it builds and which way it marches |
| Flash-Lite seat move | The current seat is at Guangling (广陵); only Langye (琅邪) is cut off from supply; the loss of Donghai happened in an earlier season | Does not say the whole territory is still cut off; separates the current seat from the old dispatches; picks fewer orders over the budget |

Models may vary at random; one new sample per case can only show whether a specific error appeared, and cannot prove improved playing strength or general reliability. The control uses the live responses of the old requests; replaying an old response for free under the new prompt does not make it pass for a new model answer.

## Verification results

### Phase one: strengthen the static prompt only

Three live decisions over five transport attempts, all successful, reported cost $0.00628661. Each request's observation, schema and reasoning are word-for-word identical to the receipt group for the same scenario in the previous round; only the system prompt changed. The full 205-item test suite, TypeScript, ESLint, the production build and the 93 seat-season observation budget all pass, with an observation peak of 9833 / 10000. The three live responses have been replayed for free: order admission and the full resolved state match.

Result: in the Nano multi-front scenario, 6 orders adopted and 0 rejected, yet it still claims that its own Liaoxi is “尚未取得” (not yet taken); in the siege scenario, 7 adopted and 0 rejected, still writing, unchanged, about building a granary/iron office at Xiapi that already exists, and describing a siege of Donglai that no longer exists. In the Flash-Lite seat-move scenario, 8 adopted and 3 scouting orders rejected for going over the budget, and it still says the whole territory is cut off from supply when in fact only Langye currently is. **More explicit static wording did not fix the correspondence between facts and plan.** The change in the number of rejected orders across three samples cannot prove a general reduction.

Raw records: [phase-one live responses](reports/decision-guidance-2026-09-29/phase1-live.json), [free replay](reports/decision-guidance-2026-09-29/phase1-replay.json).

### Phase two: a fact summary after the candidates (agreed before paying)

The candidate list was observed to sit at the end of the observation and to be very long, so the plan and dispatches in front of it may be drowned out. Observation 1.6.0 therefore adds `decisionFocus` after the candidates, restating the current season, the current seat, the commanderies cut off from supply, the campaigns under way, the ownership of the old objective, and the gains and losses of the season that has just resolved. It uses only own-side or public facts the model can already see; long lists show only the first three entries plus a total, so the observation does not go over budget.

The same three states, models, providers and reasoning rung as above are kept, with one request each. Compared with phase one item by item: system, schema and reasoning are completely identical; with `decisionFocus` and the version number removed, the rest of the observation is completely identical. The review criteria follow the table above, looking in particular at the ownership of Liaoxi, at whether the siege of Donglai still exists, at Guangling as the current seat and the extent of the supply cut, and at the plan text against this season's orders. The cost reservation cap is still $0.20, with at most two transport attempts each; no extra calls are made because an answer is disappointing. A single sample can only state what was output, and cannot prove a change in average playing strength.

The free preflight, TypeScript and ESLint pass. The 93 seat-season observation peak is 9969 / 10000, a very narrow margin; the budget has to be re-measured before the input is widened further.

Phase two stopped after two Nano responses, because the Flash-Lite provider returned empty content; there was no automatic retry. The Nano multi-front scenario still writes its own Liaoxi as not taken, with only 2 orders adopted; the siege scenario picked a three-pronged attack from the same source at Xiapi, of which 2 were rejected as conflicting, and the old siege text is still repeated. Both the successful responses and the empty-content failure have been replayed for free; the [incomplete phase-two raw record](reports/decision-guidance-2026-09-29/phase2-live-partial.json) and the [partial replay](reports/decision-guidance-2026-09-29/phase2-replay-partial.json) are kept. Reported cost $0.00231652, conservative hold $0.01466112; the cost of the third request is unknown and the tool keeps its reservation. This phase cannot assess Flash-Lite's new output. Because the samples that did come back did not fix the objective error, and because only 31 tokens of peak headroom are left, **`decisionFocus` is withdrawn**.

### Phase three: reset only the attack memories that are objectively void (agreed before paying)

Both earlier phases show Nano clinging hard to the previous season's “攻取辽西” (take Liaoxi) plan, even when the place now belongs to it. Phase three handles this one case from settled facts: when the prior plan is `attack`, the target now belongs to us, and the target is not under siege, the `plan` in the next season's input is set to `null`, and `planReset.target` plus a reason is supplied instead. The original plan still stays in the game record and the model's own text is not altered; it does not fire when the plan is to hold an own target, or when the target is besieged. The judgement is based on own-side and public ownership, and does not read the enemy's hidden state. At this point observation is 1.6.0 and prompt is 1.21.0.

Nano was called once, on Gongsun Du's (公孙度) multi-front scenario only. Same state, model, provider, candidates and reasoning rung as phase one; apart from the observation version, the cleared `plan`, `planReset` and the matching system note, every other field must be identical. What the reading focuses on: does it stop claiming Liaoxi has not been taken, and does it put forward a new objective consistent with its orders? Admission and the one-season resolution are still recorded separately. A single result still cannot prove a stable, lasting correction.

The default preflight, 11 targeted tests and TypeScript pass; the observation budget on the eval measure still has to be collected at the end. At most two transport attempts, 70 KB of input, 8000 output tokens, and a $0.20 reservation cap for this phase; phase two's empty-shell request will not be retried.

The phase-three live Nano request succeeded over 2 transport attempts, reported cost $0.00173696, conservative hold $0.00784016. The input really was `plan: null`, `planReset.target: 辽西郡` and `planFeedback.ownership: own`. Compared with the phase-one input for the same scenario, apart from the expected plan/planReset/version and the system note, the rest of the observation, the candidate schema and the reasoning match.

The model's new plan no longer claims “辽西尚未取得” (Liaoxi not yet taken); it turns from the old attack objective to expanding around Donghai and its neighbours, with `target: null` and `stance: develop`. But it still writes the status as `continue`, which the objective check flags as an objective/direction change; of the 9 orders it picked, 6 were adopted and 3 rejected (1 same-source troop movement, 2 over the per-commandery construction budget). This season's resolution also lost Donghai. **This sample only shows that the wrong old objective was interrupted; it does not show that the model can reliably write a correct plan, or that it wins more.**

The live response and the free replay are in [the phase-three live test](reports/decision-guidance-2026-09-29/phase3-live.json) and [the replay](reports/decision-guidance-2026-09-29/phase3-replay.json) respectively. The replay's request, plan, admission, own-side dispatches and full resolved-state hash all match, at 0 cost.

What is kept in the end is phase three's reset of objectively void old plans; phase two's trailing summary is withdrawn. The final versions are prompt 1.21.0 / observation 1.6.0, with no change to the pack version or the save version. The full 206-item test suite, TypeScript, ESLint, the production build and 18 free replays of the 9 archived responses all pass. The 93 seat-season observation peak is 9833 / 10000; this check does not cover every longer unification game. Phase three is limited to a single model and a single scenario, and its old state ultimately derives from a hand-seeded plan; it is not treated as proof of a model's average ability.

<!-- translated-from: DECISION-GUIDANCE-2026-09-29.md@3150228a0cf6 -->
