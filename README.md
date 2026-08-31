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
[docs/THREE_KINGDOMS_RESEARCH.md](docs/THREE_KINGDOMS_RESEARCH.md).

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build and verify the rendered product surface
- `npm run lint`: run static checks

## Current limits

The first strategy match is playable with local AI. OpenRouter decisions require
the server-only key above. The project does not yet publish a repository or deploy
a public site.
