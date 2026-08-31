# Mind Arena architecture

Mind Arena is a reputation-first AI game lab. Its public value is not the number
of games; it is a reproducible contract for comparing agents inside games.

## Product boundary

- The **Godot 4.7 game client** is the primary play surface. It owns the strategic
  map, camera, terrain, bases, field armies, battles, game HUD, input, save data,
  and deterministic local simulation. It can ship natively on Steam and export
  to WebGL 2 for zero-install play.
- The React/Cloudflare app is the platform shell: account and model setup, match
  lobby, OpenRouter proxy, public evaluation cards, replay pages, and hosting the
  Godot web export. It must not render the campaign map as DOM/SVG markers.
- Static game definitions use versioned JSON contracts shared by Godot and the
  server. OpenRouter proposes legal high-level orders; it never owns or mutates
  authoritative game state.
- The first complete vertical slice is **群雄沙盘**. Tower defense, football,
  and basketball remain protocol compatibility targets until the first slice is
  proven end to end.
- The historical, geographic, and scope baseline for that slice lives in
  [`THREE_KINGDOMS_RESEARCH.md`](./THREE_KINGDOMS_RESEARCH.md). The prototype
  must use the 194 warlord scenario and a recognizable China geography rather
  than fictional factions or an abstract continent.
- The project does not reuse proprietary Three Kingdoms game art, UI, data, or
  trademarks. Historical subject matter and original rules/art are the boundary.

## Shared match contract

Every module follows the same loop:

1. `observe`: produce the same versioned, structured game state and legal action
   list for every contender.
2. `decide`: collect an action inside the declared time, token, and call budget.
3. `validate`: reject malformed or illegal actions without allowing an agent to
   rewrite game facts.
4. `resolve`: let the deterministic engine apply valid actions using a fixed seed.
5. `replay`: append observation, decision, validation, resolution, and state hash
   events to an immutable timeline.

The model may propose decisions and optional reasoning. It never mutates state
directly, rolls random numbers, or determines whether its own action succeeded.

## Fairness modes

### Benchmark

- same observation schema and hidden information policy
- same model-call and action budget
- same fixed seed set across a comparison series
- temperature and tool access recorded
- score reports include cost, latency, invalid-action rate, and variance

### Persona

- different historical roles, risk preferences, or communication styles allowed
- optimized for entertaining matches rather than strict model comparison
- clearly separated from benchmark leaderboards

## Module MVPs

| Module | Smallest decision unit | First MVP question |
| --- | --- | --- |
| 群雄沙盘 | one simultaneous ten-day strategy period | Can an agent sustain economy, diplomacy, and multi-front expansion across a long campaign? |
| 塔防生存 | one fixed decision window | Can an agent adapt a build plan from event snapshots without frame-level control? |
| 足球教练 | one match phase or stoppage | Can an agent recognize when to alter shape, tempo, and substitutions? |
| 篮球战术 | one possession or timeout | Can an agent manage rotation and shot selection across possessions? |

## Reputation-ready release path

1. Publish the protocol draft and deterministic local simulator.
2. Publish a small, reproducible match corpus with replay files.
3. Add provider adapters behind server-only secrets and publish evaluation cards.
4. Open source the protocol, replay schema, SDK, and one reference module when the
   interfaces are stable.
5. Export the same Godot client to Web and native desktop. Steam and browser are
   distribution targets, not separate game implementations.

No public repository, marketplace listing, or deployment is created by the
current local prototype.
