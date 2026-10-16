[中文](UNIFICATION-2026-09-28.md) · [English](UNIFICATION-2026-09-28.en.md)

# Unification End Condition and the First Round of Bot Tuning

## Conclusion

A normal player game now runs until unification. The old implementation applied the
fixed-season eval's termination condition to player games, so a game would end even with
the realm undecided. Now both the season test and the model budget merely pause a
unification game, and play can continue afterwards. The unification rule is unchanged:
control 11 provinces (holding more than half the commanderies in each), or be the only
faction left that is neither destroyed nor retired. This is not a criterion of holding
all 105 commanderies.

The first round of bot tuning improved some convergence metrics but **has not solved the
long-term stalemate**. Two groups of six seeds each ran to season 256 and neither reached
unification. The test stops at the budget cap, the game state is still `finished: false`,
and no fake winner is picked. This round made zero model calls throughout, and the model
cost was zero. Nothing here is used to infer the long-term strategic ability of real LLMs.

## Changes

- `endCondition` now distinguishes `unification` from `season-limit` explicitly. The
  player UI defaults to, and only offers, unification games; the old fixed-length CLI eval
  is still supported. A unification game keeps the epoch rhythm of the original 64-season game.
- The player UI no longer displays a bogus total season count. The AI's clock includes the
  end mode, and `totalTurns` is `null` for a unification game; the prompt also no longer
  promises an ending at sixteen seasons.
- Player bots now all use the goal-driven baseline strategy, and the eval's fixed turtling
  seats that deliberately never sent troops are gone. When the treasury falls below two
  seasons of current upkeep, the priority of encouraging agriculture, pacifying the people
  and tuntian military farms (屯田) goes up; with no administrative seat, moving the seat
  takes priority.
- Officer reassignment now only accepts moves that narrow the staffing gap between the two
  locations; staffing is reserved within the season, so that a run of departures does not
  flip the imbalance the other way, and the same officer is not reassigned twice.
  Construction and domestic spending share one funding budget for the season.
- The tuntian discount used to be correct only at resolution, while the player UI and the
  model observation still showed full-price upkeep. Resolution, observation, UI and bots
  now all share `upkeepFor`.
- The save version goes up to 8. Per the project's existing policy, saves in the old format
  are refused on restore and a new game has to be started.

## Same-seed zero-cost comparison

The same six `strategy-session-0..5` seeds, unification end mode, the 64-season epoch
rhythm, and an external budget of 256 seasons. 3,072 seasons in total. The old group
assigned the original five profiles in rotation; the new group goes through the real
`advanceSeason` player path.

| Seed | Factions alive, old group | Factions alive, new group | Largest faction's commanderies, old group | Largest faction's commanderies, new group |
|---|---:|---:|---:|---:|
| 0 | 3 | 4 | 75 | 49 |
| 1 | 12 | 4 | 23 | 39 |
| 2 | 4 | 5 | 42 | 49 |
| 3 | 5 | 4 | 51 | 41 |
| 4 | 6 | 2 | 30 | 73 |
| 5 | 6 | 4 | 35 | 49 |

- Average factions alive: 6 → 3.83. Not every seed improved; seeds 0 and 2 actually ended with more factions alive.
- Actual officer-reassignment events: 8,708 → 1,181, down 86.4%. Fewer operations does not mean every cancelled reassignment was useless.
- Upkeep-shortfall events: 3,912 → 3,389. The new group also has fewer total active-faction seasons, so this total cannot be used to claim
  that each faction's finances are healthier. In the new group's final season, several large factions still have an empty treasury.
- Unification: 0/6 in both groups. The first round of tuning has not been shown to end a natural game reliably.

This is a comparison of the whole strategy package, covering profile selection, economic
priorities and scheduling fixes, so the difference cannot be attributed to any single
change. The historical 64/104-season reports keep their original data; only this report
describes the current version.

Per-season raw metrics and a runtime source digest:
[old group](reports/unification-2026-09-28/legacy.json),
[new group](reports/unification-2026-09-28/play.json).

To reproduce:

```sh
node --experimental-strip-types tools/unification-audit.mjs --controller legacy --out /tmp/unify-old
node --experimental-strip-types tools/unification-audit.mjs --controller play --out /tmp/unify-new
```

The tool loads no model credentials; the model client is replaced by a guard that throws
on any call. It outputs a season-256 snapshot that can be computed forward. The new group's
seed-0 snapshot was actually advanced to season 257; the two runs matched bit for bit, the
game still had not ended, and the model call count was still 0.

## Acceptance

- Engine and session: a unification game does not terminate after passing the specified
  season count; a normal victory does terminate it; a finished game cannot be advanced
  again; fixed-length evals still stop on time; the end mode survives save/restore; the
  model clock and the tuntian upkeep basis agree.
- Browser: local `/play` shows "until unification", and an all-bot spectated run actually
  went through seasons 16, 17, 18 and 19. A refresh at season 19 came back paused, then was
  manually advanced to season 20. The UI shows no total-season limit, and the console has no errors.
  The observed seat this time, Cao Cao (曹操), had already been destroyed, but the world could still
  be advanced, which matches spectator behaviour.
- The full regression suite passes 178 tests; two further independent unification paths were then tested and pass; lint and the production build pass.
- `tsc --noEmit` still has 8 pre-existing project-configuration problems: missing Cloudflare
  types, and the ES2017 target not supporting BigInt. The files touched this round added no new type errors.

## Still outstanding

The long-term stalemate in natural games is still there; follow-up work should keep doing
same-seed verification around cross-season campaigns against hard-to-take cities, the
scheduling of available troops, and the finances of large factions. Enlarging the test
budget or lowering the unification criterion must not be passed off as a strategy improvement.

<!-- translated-from: UNIFICATION-2026-09-28.md@2b6644b8525f -->
