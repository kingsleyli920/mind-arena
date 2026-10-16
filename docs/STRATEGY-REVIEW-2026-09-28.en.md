[中文](STRATEGY-REVIEW-2026-09-28.md) · [English](STRATEGY-REVIEW-2026-09-28.en.md)

# Review Facts and Faction-Disparity Diagnosis · 2026-09-28

This round fixed the missing feedback on what actually happened in the fighting, and completed a free faction comparison. The rule pack is still **2.3.0**;
prompt **1.18.0**, observation **1.4.0**, save **11**. Old saves must be restarted.

## The problem, confirmed and fixed

Losing a city used to be recorded under the attacker's `siege-win`, and on entering the defender's observation it was filed under “天下大事” (major events of the realm), which keeps only the latest 10 entries. Losing a non-seat city might also produce no battle report of one's own at all. The first 8 seasons of a natural game contained 94 city losses, and in 6 of them even the commandery's name never appeared in the text battle report the affected party received — for example Liu Bei (刘备) losing Pei (沛国) in season 2.

A new `engine/season-outcome.ts` computes each faction's newly gained commanderies, lost commanderies and net treasury change from the real start-of-season and end-of-season states. `resolve` stores the result in `lastOutcome`, and the next season's `observe.report.changes` takes only that faction's own summary, unaffected by any trimming of the text battle report. Records are validated by season number, there is no summary at the opening, and a stale summary does not pose as the previous season's. `seat.capitalHeld` is also provided, so a model does not wrongly conclude it still holds a commandery just from the name of its seat.

The summary reports net change: a city lost and retaken in the same season is not a net loss; the treasury change covers every actual movement, including spending, income and receipts, and is not the same as income. It does not read other factions' secret ledgers, and it does not pick strategy on the model's behalf.

The prompt requires checking the resolved gains, losses and seats first, and only then reviewing the original plan; a change of objective must be explained, and this season's intent must not be written up as an outcome. Review text that is exactly identical is flagged with “复核沿用上季文字，请结合实际变化检查” (the review reuses last season's text, please check it against the actual changes); this does not automatically reject the whole season, and it does not make an extra model request. `worldCap=0` now correctly returns an empty realm battle report, while the structured summary is still kept.

## Free validation

- Over the same 8 seasons and 94 real city losses, the structured review missed **0**; the text battle report can still be trimmed to budget.
- All 200 tests pass, including natural city loss, ledger isolation, stale summaries, repeated reviews, the next season's request and save restoration.
- TypeScript, lint and build pass.
- All 333 seat-season observations stay under 10000 estimated tokens, peaking at **9834**.
- The 6 naturally unifying games still end at **32, 21, 52, 28, 30 and 34** seasons. Per-season event counts, territory changes and final-standing data are exactly identical to the previous version; this round changed nothing about troops, the economy or the victory condition.

## Live comparison of small models

The same three natural scenarios — tight treasury, siege ongoing, attacked on several fronts — were reused, giving GPT-5 nano and Gemini 2.5 Flash-Lite two consecutive seasons each, with the other factions on rule-based bots. All 12 decisions succeeded, with **76** orders admitted, **18** dropped, and **0** rejected again by resolution after admission.

The input records include the actual `changes`, the seat status, the previous season's plan and its dropped orders, so what the model actually received can be checked directly.

| Observation | Conclusion |
|---|---|
| In the siege scenario's first season, Gemini correctly mentions losing Shanyang (山阳) the previous season | The new feedback really can be used by the model |
| The next season actually gained Henei (河内) and Taishan (泰山) with no net city loss, yet Gemini still calls the earlier loss of Shanyang "last season" | The model still confuses the timeline; a review cannot be trusted on its text alone |
| Nano copied a review verbatim once each in the siege and multi-front scenarios | Both showed the duplication notice; no improvement in review ability was demonstrated |
| From the same natural starting point, the two models chose different orders and the subsequent states diverged | A two-season small sample cannot rank model strength |

Real responses reported a cost of **$0.0204939**. The script allows at most 14 decisions, 2 attempts each, 8000 output tokens and a 90-second timeout, with gates on price and input size; this run made 12 decisions and 14 attempts, for a conservative occupancy of **$0.1107245 < $0.20**.

Separately, the page enabled Flash-Lite for Liu Bei only and advanced two seasons by hand: 22 orders admitted, 0 dropped, with the cost shown as about **$0.0033**. Reported costs total about **$0.024**; attempts that stepped down a rung or failed do not necessarily report a cost at all, and the full charge against the account is still whatever the provider says. This round used no expensive models and no all-AI long game.

## Real page validation

In the browser, `/play` season 2 shows: nothing gained, Pei lost, a net treasury decrease of 182 gold, and the seat of Donghai commandery still held by us. Screenshots were checked for line wrapping and panel layout. After a refresh and resuming the game, it was still season 3, paused, with 2/4 of the quota used, and the actual summary and the plan were fully restored. No console errors.

The AI's text judgement is produced before orders are issued, while the panel's “第 N 季实际变化” ("actual changes in season N") is produced after that season resolves; the two must not be conflated into a judgement made at one and the same time. A model saying it will do something does not mean the order was executed in the end, or that it succeeded.

## Diagnosing Yuan Shao's winning streak

Only the controller profile was swapped, keeping the scenario, the rules and the seed identical; 3 configurations were run across 4 seeds, for 12 games in total, all free. The 96 seasons are only an external test cap.

| Configuration | Unification result | Seasons / paused state |
|---|---|---|
| All normal-play bots | Yuan Shao (袁绍) 4/4 | 32, 21, 52, 28 seasons |
| Yuan Shao alone swapped to the balanced bot | Yuan Shao 4/4 | 32, 27, 96, 26 seasons |
| All balanced bots | 0/4 unified naturally | Paused at 96 seasons; Yuan Shao held 21, 26, 16 and 19 commanderies respectively |

Yuan Shao opens this scenario with 13 commanderies, larger than Liu Zhang's (刘璋) 9 and Liu Biao's (刘表) 7; either of his own controllers can close the game out when the other factions use the normal-play bot. Once everyone turns conservative the game stalls, and "no unification" must not be misread as balance already achieved.

These results show that the advantage does not disappear just by swapping out Yuan Shao's controller, and that the opponents' strategy significantly affects how fast the game closes out; they do not isolate the contribution of geography, starting resources, officers or the specific bot preferences, and they cannot prove that some number is wrong or that some model is bound to win. This round keeps the historical scenario's asymmetric opening and did not simply weaken Yuan Shao to make the win rates line up.

## How this should be evaluated from here

Feedback completeness is validated; model comprehension and factional balance are not yet assured. If the next round aims to raise the AI's playing strength, it should compare, on these fixed positions, the rate of "reporting gains and losses accurately, adjusting the objective, and avoiding repeated dropped orders", and only then decide which model to use; if the aim is to adjust balance, first settle whether to keep the historical difficulty differences or to add a separate scenario for comparing AIs fairly.

Reproduction entry points:

```bash
# 免费：失城信息完整性
node --experimental-strip-types tools/feedback-audit.mjs --out /tmp/feedback-check.json

# 免费：三个控制者配置，各四种子
node --experimental-strip-types tools/balance-audit.mjs --out /tmp/balance-check

# 付费：两种低价模型，每场景两季；新建输出目录以避免重复消费
node --env-file-if-exists=.env.local --experimental-strip-types tools/strategy-cases.mjs \
  --live --out /tmp/review-cases-new
```

*Comments in the block above, in order: "Free: completeness of city-loss information"; "Free: three controller configurations, four seeds each"; "Paid: two cheap models, two seasons per scenario; create a new output directory to avoid duplicate spending".*

[Validation summary](reports/strategy-review-2026-09-28/verification.json) · [Gaps before the fix](reports/strategy-review-2026-09-28/feedback-before.json) · [Coverage after the fix](reports/strategy-review-2026-09-28/feedback-after.json) · [Actual model inputs and responses](reports/strategy-review-2026-09-28/model-cases.json) · [Free controller comparison](reports/strategy-review-2026-09-28/balance.json)

<!-- translated-from: STRATEGY-REVIEW-2026-09-28.md@1590ceab84a7 -->
