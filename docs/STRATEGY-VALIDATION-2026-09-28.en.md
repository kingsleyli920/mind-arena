[中文](STRATEGY-VALIDATION-2026-09-28.md) · [English](STRATEGY-VALIDATION-2026-09-28.en.md)

# Long-Term Strategy Validation · 2026-09-28

## Conclusion

**The controller integration now has a basic closed loop; the current evidence is not enough to sign off on the long-term strategy experience.** Multi-seed long games show expansion slowing markedly, and the leading faction is often held back by military upkeep and by local assaults. The AI can read a late-game position and issue effective orders, but this round's continuous-play check stopped under the budget rule after a provider timeout, so it cannot be used to judge long-term planning ability.

This is a validation report, not a balance patch. This round added validation tooling and records; it did not change game rules, bot weights, or the production deployment.

## Test scope

- `strategy-session-0` through `strategy-session-5`, each seed run for 64 and for 104 seasons, giving **1008 model-free resolved seasons** in total. This is a paired game-length comparison over 6 seeds, not 12 independent random samples.
- Uses the same `advanceSeason` as the browser, the same runtime data pack, and the existing bot profiles.
- From seed 1's 104-season game, the position was copied after season 64 completed, and two zero-cost branches of 40 seasons each were run.
- The same snapshot had cheap models attached to two seats, preset to at most 6 seasons and 12 decisions; each decision issues only 1 OpenRouter request with 8000 output tokens. If either model fails, or the total reported cost reaches $0.05, no further season is added. That amount is a stop threshold, not a hard billing cap.
- The actual model branch completed only **1 season and 2 requests** before stopping on a timeout. Separately, a 16-season zero-cost rerun checked the results before and after the tooling refactor.

The raw data carries the SHA-256 of the runtime content plus source digests of `engine/*.ts` and `session.ts`. Files:

- [Per-season and per-phase long-game data](reports/strategy-2026-09-28/long-games.json)
- [Branch comparison, model records and costs](reports/strategy-2026-09-28/branches.json)
- [Season-64 candidates and bot orders](reports/strategy-2026-09-28/checkpoint-analysis.json)

## 1. Late-game expansion slows markedly, and a longer game does not remove the problem

| Seed suffix | Active factions at season 64 | Active factions at season 104 | Largest faction at season 104 | Longest run of seasons with no change of hands (104-season game) |
| --- | ---: | ---: | --- | ---: |
| 0 | 3 | 3 | Yuan Shao (袁绍), 67 commanderies, 9 provinces | 8 |
| 1 | 14 | 12 | Yuan Shao, 27 commanderies, 3 provinces | 7 |
| 2 | 12 | 12 | Yuan Shao, 26 commanderies, 3 provinces | 16 |
| 3 | 16 | 14 | Yuan Shao, 26 commanderies, 3 provinces | 7 |
| 4 | 13 | 10 | Yuan Shao, 28 commanderies, 3 provinces | 3 |
| 5 | 14 | 13 | Yuan Shao, 21 commanderies, 2 provinces | 6 |

Every game hit the season cap with no unifying winner. The current rule requires controlling at least 11 provinces, or being the only active faction left.

Across the six seeds, the first 16 seasons produced **329 inter-faction changes of commandery ownership**; seasons 49–64 produced **60**, a drop of about **82%**. This metric compares ownership before and after each resolution and counts only changes where both the old and the new owner are non-empty; it covers outcomes from war, persuasion to submit and so on, and is not the same as the number of cities stormed.

In the 104-season games, seasons 49–104 amount to 336 game-seasons, of which **195 (58%) had no change of commandery ownership at all**. A commandery that changes hands repeatedly is counted each time; intermediate ownership within a single resolution is not counted separately. No change of hands does not mean there were no domestic or other meaningful decisions, so these metrics flag a pacing risk; they cannot replace a human playtest's judgement of how fun the game is.

Active factions in this table exclude those destroyed and those who have retired. The previous report counted "the number of owners still holding a commandery"; the two metrics differ, so the difference in counts should not be taken as new factions being wiped out.

## 2. Observed bottlenecks and the limits of causal claims

### Large factions run a persistent military-upkeep shortfall

In the representative snapshot, Yuan Shao holds 25 commanderies with about 264,000 garrison troops, and Liu Biao (刘表) 22 commanderies with about 217,000; both treasuries are zero. In the same position, Ma Teng (马腾) and Cao Cao (曹操) have treasuries of about 21,900 and 54,600 gold.

In the following season, bot Yuan Shao takes in 2228 and owes 2277 in upkeep, a shortfall of 49 gold, with 2910 deserters. In the code, income decreases with a commandery's rank order while upkeep grows with billable troop strength; when funds are short, desertion is proportional to the shortfall. A large map footprint does not automatically equal resources that can be freely committed to war.

This confirms that economic pressure exists; it **does not on its own prove that the upkeep coefficient is the root cause**. Local supply, governors, morale, buildings and order allocation all affect income and spending at the same time, so an empty treasury alone is not grounds for lowering upkeep.

### Diplomacy flip-flops constantly, but simply removing active diplomacy did not improve this sample

Across the six 104-season games, seasons 49–104 record 2068 alliance formations and 1874 alliance-break events. The bots use the same action-type weight for forming and for breaking alliances; the candidates switch according to the current treaty state. Breaking an alliance on one's own initiative costs morale across the whole territory and bars re-forming an alliance for a short period.

To check whether this is enough to explain the stall, a comparison was run on the representative snapshot: keep every rule, filter out the alliance-form / alliance-break orders the bots had already selected, and do not reallocate the freed orders. Existing treaties, the automatic diplomacy mechanism and all other actions still execute as the engine dictates.

| Over the next 40 seasons | Original bots | Active diplomacy filtered out |
| --- | ---: | ---: |
| All commandery ownership changes | 13 | 10 |
| City-storming events | 7 | 5 |
| Supply-interruption events | 153 | 255 |
| Upkeep-shortfall events | 101 | 122 |
| Active factions at the end | 12 | 12 |

This sample does not support "removing active diplomacy will fix the stalemate". It is no substitute for good diplomatic strategy, and it cannot be generalised into all diplomacy changes being useless.

### Total troop strength and usable offensive capability differ sharply

In the snapshot, the top five factions have 71 campaign candidates between them, and only 4 of those forecast storming a city outright. The candidates span different troop tiers and cannot be read as 71 independent wars; a battle that cannot storm a city outright may still produce a result through a siege.

For example, Cao Cao has 8 commanderies, over 100,000 garrison troops and large reserves of cash, yet none of his 21 campaign candidates forecasts storming a city outright. Yuan Shao's bot orders that season put 8 officer reassignments first, did only 2 encourage-farming actions, and launched no campaign. What needs further investigation is how bots turn resources into effective massing, officer deployment and sustained campaigns — not simply enlarging the map or adding more models.

## 3. Cheap-model check: one seat made an effective decision, the other timed out

| Faction | Model | Actual result | Time | Reported cost |
| --- | --- | --- | ---: | ---: |
| Yuan Shao | `z-ai/glm-5.3-flash` | 13 orders admitted, 0 dropped: 10 encourage-farming, 3 scouting | 47.98 s | $0.001168965 |
| Liu Biao | `deepseek/deepseek-v4-flash` | Timed out reading the response, `infra`, no orders this season | 91.25 s | unknown |

Only 2 requests, with no retry and no budget extension. Total reported cost about **$0.00117**; the timed-out call's cost cannot be treated as zero, and the full charge is whatever the provider bills.

GLM's strategy plan explicitly says to ease the finances first and only then consider attacking Bingzhou. In the actual resolution, Yuan Shao's income rose from 2228 in the bot comparison to 2265, upkeep went from 2277 to 2279, the season's shortfall shrank from 49 to 14, and deserters fell from 2910 to 833; the treasury was still zero and the territory did not grow.

This is evidence that "one decision was targeted and its orders took effect", **not evidence of successful long-term planning or of a ranking of model strength**. Both seats were replaced at once and Liu Biao issued no orders because of the timeout, so the worlds diverge afterwards; the whole difference across the game must not be attributed to GLM. DeepSeek's result is an infrastructure failure and does not count as a failure of strategic ability.

Under the preset conditions, the test stopped after the first season; no six-season continuous model evidence was obtained. The previous round's two-season opening test also cannot be brought in as proof of continuous late-game planning in this round.

## 4. Validation tooling and a suggested order of work

Tooling checks completed: the zero-cost script's rerun of the first 16 seasons matches season by season; the bot branches compare bit for bit against the browser's `advanceSeason` result every season and pass; the 1008-season count is complete with zero model calls; after a failure the call count stays at 2; an output directory that already holds paid records is refused for reuse; the new tooling passes lint.

To reproduce the zero-cost part:

```bash
node --experimental-strip-types tools/strategy-audit.mjs --out=/tmp/strategy-review
node --experimental-strip-types tools/strategy-branch.mjs \
  --checkpoint=/tmp/strategy-review/checkpoint-64.json \
  --out=/tmp/strategy-review/bot-branches
```

`strategy-branch.mjs` is zero-cost by default; only an explicit `--live` calls the two fixed cheap models, and it checks prices before calling. Once paid records are kept, use a new output directory rather than overwriting the original records.

Suggested order for the next fixes:

1. **First improve the observability of how bots execute across seasons**: record campaign objectives, whether massed troops actually march out, whether reassignments flip back and forth, and the purpose of diplomacy. The existing profiles mostly score season by season and do not represent a strong strategic opponent.
2. **Run paired experiments around one bottleneck at a time**: economic stability, converting garrison troops into offensive strength, and alliance commitment, compared item by item. Beyond expansion and unification, acceptance should also look at whether the weaker side survives, whether it gets chances to counterattack, and whether several strategies are viable.
3. **Only then take a continuous cheap-model sample**: first confirm the current provider can complete requests reliably, then raise the season count step by step; keep the call and cost limits in place and do not open an all-faction model game.

This round had no long human playtest, so "is it fun" remains unverified. The results above are enough to decide where to investigate next; they are not enough to declare the game's balance finished.

<!-- translated-from: STRATEGY-VALIDATION-2026-09-28.md@f144dcdda778 -->
