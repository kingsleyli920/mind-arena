[中文](DECISION-CORRECTION-2026-09-28.md) · [English](DECISION-CORRECTION-2026-09-28.en.md)

# Live test of model self-correction after order receipts (2026-09-28)

## Test protocol (fixed before any paid request)

Question: given last season's order receipts, can a model correct the plan errors we have already observed?

Each case continues from the natural state left after the earlier live responses resolved, and calls the original model for one season only; the other factions are still controlled by the free bot.
The prior plan is the model's own output from the previous season; the season before that came from the hand-seeded conflicting plan of the original comparison experiment, so this cannot be regarded as a long, natural model-played game.

Each case has two independent branches using the same model, provider, game state, prior plan, system, candidate schema and reasoning settings:

- `legacy`: keeps the existing `droppedLastSeason` and does not pass the new receipt.
- `receipt`: uses the product's current `decisionLastSeason`, which carries the adoptions, the rejections and the objective check prompts.

With those two feedback fields removed, the inputs must be completely identical. Both groups use the current prompt 1.19.0; this is not an overall comparison of the old and new prompt.
Three fixed scenarios, six decisions in all, with no extra samples added because a result is disappointing. The order of the two branches alternates; one run per case per condition, from which neither statistical reliability nor a model ranking can be derived.

| Scenario | Model | Facts before the decision | What the manual check focuses on |
|---|---|---|---|
| Next season of Gongsun Du's (公孙度) multi-front position | GPT-5 Nano | Liaoxi (辽西) is already ours; last season the main-force attack was adopted and the all-out attack from the same source was rejected | Does it stop claiming Liaoxi has not been taken? Does it adjust objective/status? Does it issue conflicting same-source orders again? |
| Next season of Liu Bei's (刘备) siege position | GPT-5 Nano | Last season the attack on Donghai (东海) and the building of a government office were rejected at the order-budget cap; this season there is no field army of ours left; Rencheng (任城) has been taken | Does it treat an unadopted troop movement or construction as completed? Does it still schedule orders over the cap? Are the status and the actual action consistent? |
| Next season of Liu Bei's lost-seat position | Gemini 2.5 Flash-Lite | The seat moved to Guangling (广陵) last season and Guangling still holds; Donghai is still the enemy's; the order reassigning Liu Bei was not adopted | Does it correctly acknowledge the current seat? Does it invent a successful reassignment or order from last season? Does it update plan/status? |

Also recorded: the admission count, the reasons orders were dropped, the objective check prompts and the actual one-season resolution. The absence of a repeated warning does not mean the strategy is right; not mentioning a fact is neither an acknowledgement of it nor a denial.
Freely chosen objectives, stop-loss conditions and the like are explained by hand; playing strength is not scored automatically from keywords.

Cost: only OpenAI's Nano and Google's Flash-Lite are allowed, with the endpoint price queried first and the allowlist checked.
At most two transport attempts per decision, at most 8000 output tokens, at most 70 KB of input, and a reservation cap of $0.20 for the whole batch.
If there is no response, the full reservation is kept and the whole batch stops; no extra paid correction loop is triggered.

## How to run

The default preflight and the replay both make no model request; the output directory must not already contain a `report.json`, which prevents overwriting results and spending twice.

```bash
node --experimental-strip-types tools/decision-correction.mjs --out /tmp/correction-preflight
node --env-file-if-exists=.env.local --experimental-strip-types tools/decision-correction.mjs --live --out /tmp/correction-live
node --experimental-strip-types tools/decision-correction.mjs --replay /tmp/correction-live/report.json --out /tmp/correction-replay
```

## Measured results

**The receipts do reach the live request, but this round did not prove that a low-cost model can correct itself reliably.** No product prompt, engine rule or default model was changed, and no automatic retry was triggered.

All six decisions succeeded, over eight transport attempts (each of Nano's first two decisions had one drop-the-temperature downgrade), all with structured output and a normal stop.
Nano ended on `schema-notemp` throughout and Flash-Lite on `schema`; within a pair the rung is the same.
Reported cost **$0.01073378**; the conservative hold once unknown failed attempts are counted is **$0.02283123**, both below $0.20.
Endpoint prices were confirmed before the calls; the actual providers were OpenAI and Google respectively.

| Scenario | legacy adopted/rejected | receipt adopted/rejected | Conclusion after reading the raw text |
|---|---:|---:|---|
| Nano multi-front | 3 / 2 | 4 / 1 | Both groups still treat their own Liaoxi as an attack target; the receipt group again picked a main-force and an all-out order from the same source and claimed “完成两条并行征伐” (completed two parallel campaigns) when in fact only one was adopted. The error was not corrected. |
| Nano siege | 5 / 0 | 5 / 0 | Both groups got the previously rejected Donghai campaign adopted, which cannot be attributed to the new receipt. Both still write “巩固东莱围城后方补给” (shore up the rear supply of the Donglai siege), but at decision time there was no field army of ours left; the receipt group also writes about building a granary/iron office at Xiapi (下邳) that already exists, while what it actually picked was the Pengcheng (彭城) iron office. |
| Flash-Lite seat move | 6 / 1 | 6 / 2 | The receipt group writes explicitly “广陵郡（我方治所）” (Guangling commandery (our seat)), while the control group still explains the current territory-wide supply cut by the fall of Donghai. The receipt group still writes the earlier fall of Donghai as “上季” (last season), and picked two domestic orders over the order budget. The actions finally adopted by the two groups are the same, and so is the full resolved state. |

The limits of reading each case by hand:

- In the multi-front receipt group the troops move from Liaoxi to the Liaodong Dependent State (辽东属国), yet the plan describes “对辽西郡发起两路并进攻” (launching a two-pronged attack on Liaoxi commandery). That is both a mismatch of place and a mismatch of how many orders were adopted. The control group repeats “辽西尚未取得” (Liaoxi not yet taken) verbatim.
- Neither siege group explicitly re-checks last season's rejected orders, the new gain of Rencheng, or the disappearance of the besieging army. The fact that this season's attack was adopted is not grounds for deciding that the model understood why last season's orders were rejected. Both groups end this season having lost Jiujiang (九江) and Rencheng; that is a short-term result, not a ranking of playing strength.
- Before the seat-move decision, the structured facts are that the seat is at Guangling, that Guangling is still ours, and that only Langye (琅邪) has `supplyCut=true`. Last season's prose dispatches still carry both the fall of the old seat partway through resolution and the successful seat move at the end of the season; the receipt group did recognize the current seat, but its account of the timing is still confused.
- All six statuses are still `continue`; the structured target/stance did not change in any case this round, so the six `continue`s cannot all be counted as status errors. The raw text of the Flash-Lite receipt group also says “本季以守势为主” (this season is mainly defensive) while the stance is still `attack`, which has to be read by hand against the context of preparing a counterattack.
- The two raw Flash-Lite reviews are 183 and 188 characters; storage cuts them to 160 characters under the existing protocol. The manual review above used the complete raw text; the tail that was cut off must not be described as something the model can see next season.

In total the control group had 14 adopted and 3 rejected; the receipt group 15 adopted and 3 rejected. Rejected orders did not go to zero.
Two receipt-group branches drew no objective warning, yet their plan text still has the problems above; **no warning does not mean the plan is correct**.
Every adopted order went into an actual one-season resolution, with 0 further rejections at resolution. The estimated observation peak is 8715; it is not the full request tokens including system/schema, and must not be mixed with the provider's total input token count.

## Verification and evidence

- Default free preflight: six branches pass; each pair's normalised input is completely identical, compared after removing only the two fields `decisionLastSeason` / `droppedLastSeason`.
- Free replay after the live requests: the six requests' content, records, order admission, own-side dispatches, gains/losses and **full resolved-state hash** match item by item, and the replay added 0 cost.
- The first replay hit a JSON-representation difference in the eval tooling: optional `undefined` fields held in memory are not written to disk. The comparison was switched to the on-disk representation and the replay then passed; no paid request had to be repeated.
- This round's five cost-gate tests and the receipt integration test pass, and ESLint and `git diff --check` on the new tool pass. The product code is unchanged, so the previous round's full 205-item product suite and page verification are reused; no claim is made that they were re-run this round.
- Raw inputs/responses and resolutions: [live.json](reports/decision-correction-2026-09-28/live.json); free replay: [replay.json](reports/decision-correction-2026-09-28/replay.json); check summary: [verification.json](reports/decision-correction-2026-09-28/verification.json).

## What this means for the project

Order validation can hold the game rules, and the receipts do let a person see which instructions were not executed; but a cheap model's plan text still cannot be taken as a trustworthy strategic after-action review.
The clearest remaining problem this round is: **the model does not reliably line up the current facts, the past results and the orders it actually issues this season.**
Further work should run limited experiments on that correspondence and on plan updating, and then accept them against the fixed-scenario control; the current evidence is not enough to support scaling up to a long all-AI game, or to declare playing strength improved outright.

<!-- translated-from: DECISION-CORRECTION-2026-09-28.md@a9c3afe90342 -->
