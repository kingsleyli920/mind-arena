[中文](DECISION-REVIEW-2026-09-28.md) · [English](DECISION-REVIEW-2026-09-28.en.md)

# Plan and order checking · 2026-09-28

The game now surfaces checkable plan problems and the record of which orders were adopted, and feeds them back to the AI next season.
This round's **added model cost is $0**: the live responses saved last round were reused, and no provider was called again.

## What the player sees

“上季 AI 决策” (Last season's AI decision) gains a “第 N 季计划与命令核对” (Season N plan and order check) section:

- The attack target already belonged to us when the order was issued: prompts a check of the objective and the completion condition.
- The main objective or the attack/defence stance has changed while the status is still “继续” (continue): prompts a re-check.
- Unrecognisable objectives, a missing plan, and a review copied over verbatim continue to raise prompts.
- When orders such as troop movements, seat moves, withdrawals, musters, troop transfers and stronghold seizures are rejected: prompts a reschedule.
- Expanding the record shows “已采纳 / 未采纳” (adopted / not adopted) and the reason for rejection, order by order; the main-force and all-out orders on the same route carry different labels.

The old “执行 N 条” (executed N) becomes “采纳 N 条” (adopted N). An order that passes validation has only entered resolution; an enemy withdrawal, a march,
another faction's action or losing the battle can still change the final outcome. Actual territory and treasury changes continue to come from the engine's resolution summary.

The check text is a **snapshot of the facts at the moment the order was issued**, with the season number marked on the page; the target's ownership next season is whatever the current observation says.
The prompts do not rewrite the AI's own text, cancel a legal order, or pay to ask again.

## Implementation and compatibility

`lib/game/decision-review.ts` is the single validation entry point. After admission, `modelDecide` produces `record.review`,
which stores the objective prompts and the complete adopted / rejected record. It uses only the orders our own side submitted and public target ownership; it does not read the enemy's hidden garrisons.

`observe.decisionLastSeason` accepts only a record from the same faction for the season just past, carrying the prompts, the adopted keys and the rejection reasons.
A stale record, or a record from another faction, never enters the request. When a complete receipt is present, the old `droppedLastSeason` is no longer sent as well;
old saves with no receipt still use the original feedback path. Normal play, eval, match and melee are all wired up.

The prompt moves up to **1.19.0** and the observation to **1.5.0**. The new fields belong to the optional model record,
GameState and the victory rules are unchanged, and **the save version is still 11, so existing version 11 saves can be continued**.
A bad receipt is rejected at load time, so malformed data cannot break the page or the next season's input.

## Free-replay verification

Using the 9 live responses from [the previous round's comparison](DECISION-COMPARISON-2026-09-28.en.md):

| Check | Result |
|---|---|
| Regenerate the three natural scenarios | Game-state hashes match the previous round |
| The original model text, admission results, first-season events, territory and treasury | All stay consistent; the validation did not change the game's resolution |
| Objective / stance changed but still `continue` | 8 responses have the corresponding prompt |
| Attack target already ours | 2 responses have the corresponding prompt; one is the Liaoxi (辽西) ownership error, the other a relief target at Xiapi (下邳) that is still ours |
| Key orders rejected | 5 responses have the corresponding prompt and a reason for each |
| Next season's input | 9/9 received the complete receipt for the same seat's previous season; the old dropped-order field was not attached as well |
| Number of calls | Two responses replayed per branch, 18 local replays in all; 0 additional paid requests |
| Observation budget for those 18 inputs | Estimated peak 8,959, all below 10,000 |

Attacking a target of ours is sometimes a relief operation, so "target already ours" is a prompt to check, **not an automatic ruling that the strategy is wrong or finished**.
Defending an already-held target does not raise this prompt.

The full 205-item test suite passes. New tests cover defending a city raising no false prompt, enemy secrets not affecting the prompts, both admission outcomes for a duplicate key,
isolation of the wrong seat and of stale records, the next season's request after a save is restored, old-save compatibility, and rejection of a bad record.
The final label adjustment ran 3 further targeted tests; TypeScript, lint and the production build pass.
The original free observation stress test still peaks at 9,834 over 333 seat-seasons; that test has no model order receipts,
and the budget evidence for the new receipts is the 18 real scenario inputs above, which cannot guarantee that no long game ever goes over budget.

## Verification on the real page

On a separate local port, a temporary button wrote the replay save through the real `save()`, and then the real `/play` page was opened:

1. The Gongsun Du (公孙度) scenario shows “决策时目标辽西郡已属我方” (at decision time the target Liaoxi commandery already belonged to us), the repeated-review prompt and the key-rejection prompt.
   Expanded, the main-force campaign shows as adopted and the all-out campaign as not adopted, with the conflict reason.
2. The Liu Bei (刘备) scenario shows the plan status not updated and the Donghai (东海) campaign rejected because the origin commandery's order budget was full; the construction, the officer reassignment and the rejected order are each readable.
3. After a refresh and continue, the prompts, the order record and the used 1/1 quota are all still there; 0 console errors.
4. Screenshots of both scenarios were actually looked at: the right-hand panel wraps properly and does not cover the map; the temporary entry point, the browser tab and the dev server have been cleaned up.

This is real page verification driven by replaying archived responses; it is not an online model test of the new prompt dressed up as one.

## Limits of what this does

The validation has been shown to catch the structured problems above and to close the feedback loop; **it has not been shown that the AI corrects itself reliably once it receives the prompt**.
Nor does it understand every natural-language objective or exit condition: merely rewording the objective under the same target and the same stance may raise no status prompt;
semantic contradictions such as “粮尽溃散后再撤军” (withdraw only after provisions run out and the army breaks up) still have to be handled separately.

The next paid verification should re-test only the existing failure scenarios, comparing whether the same errors recur and whether the key actions are actually adopted.
There is no need to start a long all-AI game first.

```bash
# 免费：重放历史响应、检查新提示与下一季反馈，输出目录须未使用
node --experimental-strip-types tools/decision-review-audit.mjs --out /tmp/decision-review-new
```

[Replay record](reports/decision-review-2026-09-28/audit.json) ·
[Verification summary](reports/decision-review-2026-09-28/verification.json)

<!-- translated-from: DECISION-REVIEW-2026-09-28.md@e27376791a1b -->
