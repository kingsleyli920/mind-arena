# Mind Arena · 智弈场

A reputation-first AI game lab where models compete with other models, and
people can challenge them under the same reproducible rules.

The first vertical slice is **群雄沙盘**, a playable 194 warlord grand-strategy
match on a recognizable China historical core map. Tower defense, football, and basketball are planned game
modules that reuse one provider-neutral match protocol, replay format, and
evaluation system.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

To let in-game factions call real OpenRouter models, copy `.env.local.example`
to `.env.local`, set `OPENROUTER_API_KEY`, and restart the dev server. The key is
read only by server routes and is never exposed through a `NEXT_PUBLIC_*` value.

This starter does not use `wrangler.jsonc`.

## What this prototype proves

- a four-module game collection can share one Observe → Decide → Resolve → Replay contract
- human-vs-model and model-vs-model matches use the same configuration surface
- deterministic seeds and explicit match IDs make later replays reproducible
- planned model integrations are visibly separated from connected providers

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the match protocol,
fairness modes, MVP boundaries, and open-source path. The researched historical
and game-design baseline is in
[docs/research/THREE_KINGDOMS_RESEARCH.md](docs/research/THREE_KINGDOMS_RESEARCH.md).
How to run an evaluation — and the measured constraints that bound it — is in
[docs/EVAL.md](docs/EVAL.md).

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build and verify the rendered product surface
- `npm run lint`: run static checks
- `npm run selfplay`: bot-only self-play plus the four gameplay acceptance gates
- `npm run obs:budget`: per-seat observation token gate (exits 1 when over)
- `npm run eval`: run one agent (bot / stub / model) over N games
- `npm run eval:suite`: run several agents over the same seeds and print a leaderboard

## Playing it

Run `npm run dev` and open `/play`. Pick a seat, issue orders for sixteen
seasons, get graded on how far you moved the board — not on how big you started.
The seat-select page has a rules primer (怎么玩); the in-game header has the same
panel behind 规则.

Progress is saved to `localStorage` after every season, including the picks you
have ticked but not yet committed. Reloading offers 继续 / 弃掉重开. A save is
dropped when the pack or state shape changes rather than migrated — the engine is
still moving, and silently loading a stale save gives you a board whose rules no
longer match.

## Current limits

- **Opponents are the deterministic bot, not models.** The OpenRouter route and
  the whole model-seat pipeline exist and are tested, but wiring live models into
  the play UI is deliberately deferred until the game itself is complete.
- Counties (县) are not a play unit; the map's atom is the commandery (郡).
- One scenario only (194 兴平元年).
- Desktop only.
- No repository or public deploy yet.

Evaluation tooling (`npm run eval`, `npm run eval:suite`) does drive real models
and needs the key above. See [docs/EVAL.md](docs/EVAL.md) for the measured
constraints that bound it — including the two ways a leaderboard can silently
become a lie.
