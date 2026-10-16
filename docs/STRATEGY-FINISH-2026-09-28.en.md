[中文](STRATEGY-FINISH-2026-09-28.md) · [English](STRATEGY-FINISH-2026-09-28.en.md)

# Strategy Wrap-Up and Acceptance · 2026-09-28

This round completed three tasks: resolving the late-game stalemate, low-cost cross-season validation with real AI, and clearing TypeScript errors.
Rule pack 2.2.0, prompt 1.16.0, save 9. Old saves must be restarted.

## 1. Late games can unify naturally

Player games still have no season cap, and the victory condition is still controlling 11 provinces or being the last effective faction.
The 256-season budget in the tests only stops the test loop; it does not force a win on a game that has not unified.

Fixes this round:

- Added troop transfers between one's own adjacent commanderies. Each season can move out at most half of the source's troops in total, destination capacity is respected, and relay transfers within the same season are not allowed.
- Fixed the officer-ownership check: officers taken in, or gained through submission, can be reassigned by their new lord, and the former lord cannot recall a general already garrisoned in an enemy city.
- Siege prediction now evaluates the blockade after losses and uses the actual size-based provision-consumption rule; the assumptions about reinforcement and about no external intervention are stated explicitly.
- The player bot now organises rear-area troop transfers, officer assignment at the front and cross-season sieges, avoiding multi-pronged sorties from the same source, repeated officer reassignment and pointless massing.
- Automatic replenishment now checks pay first, so that automatic reinforcement in the interior does not leave the whole army repeatedly in arrears.
- Added a late-game submission condition: with 7 provinces controlled and a territory at least twice that of the adjacent target, a regional faction of more than 8 commanderies can be persuaded to submit.
  A probability check is still required and the refusal cooldown still applies; on submission, troops, officers and treasury are taken over, and the old faction's remaining orders for that season are cancelled.

Experiments that merely tuned the bots, income or the troop-command cap still ended in regional standoffs, so the income and troop-command values tried in those experiments were not kept. Late-game submission is the explicit rule change that produced convergence this time, and it is open to all controllers.

### Final version: 6 fixed seeds, 6 games unified naturally

| Seed suffix | Seasons resolved | Unifier | Commanderies | Provinces | Effective factions left |
| --- | ---: | --- | ---: | ---: | ---: |
| 0 | 23 | Yuan Shao (袁绍) | 78 | 11 | 3 |
| 1 | 30 | Yuan Shao | 94 | 12 | 2 |
| 2 | 217 | Li Jue and Guo Si (李傕、郭汜) | 105 | 13 | 1 |
| 3 | 187 | The Nanzhong tribal chiefs and great clans (南中夷帅与大姓) | 105 | 13 | 1 |
| 4 | 20 | Yuan Shao | 83 | 11 | 4 |
| 5 | 49 | Yuan Shao | 89 | 11 | 2 |

The seeds are `strategy-session-0` through `strategy-session-5`. All use free bots, with no changes to
starting resources, ownership or the victory threshold. The raw results carry the SHA-256 of the engine and the runtime data:
[unification.json](reports/strategy-finish-2026-09-28/unification.json).
This is the result of a six-game sample; it does not guarantee that any given seed will finish within 256 seasons.

The existing 100-game, 16-season eval-profile baseline still passes **4/4**: no game with zero changes of hands, mere survival is not optimal,
game length is correct, and the correlation between starting commandery count and actual score is 0.27. This baseline is not used to prove natural unification.
[Raw baseline output](reports/strategy-finish-2026-09-28/baseline.txt).

## 2. Live run: two cheap AIs over four consecutive seasons

`strategy-session-2` was first advanced with free bots to internal turn=24, then Yuan Shao was handed to
`z-ai/glm-5.3-flash` and Liu Zhang (刘璋) to `openai/gpt-5-nano`, with the other factions kept as free bots.
Troops, money and ownership were not changed. turn=24–27 was advanced through the normal `advanceSeason → modelDecide → OpenRouter → resolve`
path, for 8 model decisions and 11 upstream attempts in total. A failed model was never replaced by a bot.

Result: 8/8 decisions returned a structured result successfully, 67 orders passed admission, and 3 were dropped on commandery-order or action-point constraints.
All 6 real requests across the two seats in the last three seasons were checked against the previous season's plan; dropped-order feedback also entered the subsequent observation.

| Seat and model | Actual cross-season behaviour | Territory after four seasons | Returned cost |
| --- | --- | --- | ---: |
| Yuan Shao · GLM Flash | Lifted the siege of Yuyang (渔阳); took Dai commandery (代郡) the next season; then seized Juyong Pass (居庸关) and took Jiyin (济阴); dealt with multi-front sieges in the final season | 22→24 commanderies, 2→2 provinces | $0.007065595 |
| Liu Zhang · GPT-5 nano | Seized the Baoxie Road (褒斜道); pressed on to take Anding (安定) and You Fufeng (右扶风); then troop transfers and contesting passes | 16→17 commanderies, 1→2 provinces | $0.006153450 |

The battle reports confirm that the plans are connected to the actual actions. The final net territory change includes enemy counterattacks and is not the same as the total number of captures the model ordered;
troops already in transit before the handover also keep executing, so not every result can be credited to the model.

### Cost and latency

- Returned costs for this round total **$0.013219045**. This is the cost reported by successful responses, not the exact billed total.
- GLM's first decision took 256.3 s, including one retry, with a suspected timeout on the first attempt; the logs did not keep the reason for that failure,
  and whether that attempt was billed separately cannot be confirmed.
  `unknownCost=0` in the raw report only means that every final response had a cost field; it is not grounds for concluding that failed attempts cost nothing.
- The live run's hard limits were 8 decisions, at most 2 attempts each, at most 8,000 output tokens per attempt (including reasoning),
  and 90,000 input bytes. $0.14491 was reserved at model-catalogue prices, against a reservation cap of $0.20; the provider was not pinned,
  so a cost reservation is no guarantee of the billed amount.
- This CLI run used a 180-second timeout per attempt. The page is still 90 seconds per attempt, so CLI success must not be equated with GLM
  always being stable in the page. GLM's last three took 49.1, 34.8 and 66.4 s; nano's four took 8.7–11.4 s.
- nano repeatedly picks different troop tiers with the same source and the same target within one season, and it also refers to a non-existent “夜袭” (night raid) mechanic;
  sometimes it simply repeats the previous season's plan. The system only executes legal candidates, but the explanatory text can still be inaccurate.

Conclusion: cross-season memory, model control, rule execution and the feedback chain are validated; a four-season sample does not constitute a ranking of model strength,
and it did not validate the cost, latency or win rate of an all-AI long game.

The raw [four-season report](reports/strategy-finish-2026-09-28/live.json) and
[per-decision log](reports/strategy-finish-2026-09-28/decisions.jsonl) are kept on record, with no keys.

## 3. Engineering wrap-up and real-page acceptance

- The TypeScript target was raised to ES2022, fixing the BigInt compile-target error.
- Workers runtime types are generated from the build config via Wrangler; the D1 binding declaration matches the actual optional configuration.
- Explicit types were added for the map data and the model-catalogue response; both map sites share `TerritoryGrid`.
- `npm run typecheck` reports zero errors; `npm test` passes **189/189**; lint reports zero errors and zero warnings; the build succeeds.
  The build still emits dependency-deprecation notices, a large-chunk notice and a vinext route static-classification notice, none of which block the build.
- `npm run obs:budget` passes: all 384 seat-season observations stay under 10,000 estimated tokens, peaking at 9,567.
  This excludes the rules summary and cannot be treated as the total input cost of one request; the actual model bill goes by the returned usage.
- 10 new regression tests cover edge cases including transfer conservation / capacity / no-relay, siege prediction, hidden intelligence, officer ownership, upkeep-aware replenishment,
  the submission threshold and order cancellation after submission.
- A real browser started a pure spectate run from `/play`, all rule-based bots, advancing naturally to page season 25,
  where Yuan Shao controls 11 provinces and the page shows “戡定天下，本局结束” (the realm is pacified, this game is over). Auto-spectate stopped and the advance button was disabled.
- After refreshing the page and clicking “继续” (Continue), it was still in the season-25 finished state, with both auto-spectate and the advance button disabled.
  The page showed 0 model seats and 0/32 decisions used; console errors were 0. No game state was injected.

### Reproduction

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run selfplay
npm run obs:budget
node --experimental-strip-types tools/unification-audit.mjs --seeds 6 --budget 256 --out /tmp/unification-new
# 仅在运行时兼容配置更新后刷新声明：先构建，再执行
npm run types:worker
```

*The comment in the block above reads: "Refresh the declarations only after the runtime compatibility configuration is updated: build first, then run."*

Free validation tooling for live runs:

```bash
node --experimental-strip-types tools/strategy-live.mjs --out /tmp/strategy-dry-new
```

Paid models are called only with `--live` and with keys loaded via `--env-file-if-exists=.env.local`.
A directory that already contains a report refuses a re-run, to prevent accidental duplicate spending.

What is worth doing next is a broader free seed-balance test, plus a decision-quality comparison across a small number of models;
this round did not expand into an all-AI long-game eval, and nothing was deployed or released.

<!-- translated-from: STRATEGY-FINISH-2026-09-28.md@d75b8f869595 -->
