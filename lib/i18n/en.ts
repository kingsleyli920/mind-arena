// English catalogue. Chinese (zh.ts) is the source; keys are defined there.
//
// A gate (tests/i18n.test.mjs) requires: identical key sets, no empty values,
// and identical `{param}` sets per key — a translation that silently drops a
// placeholder renders a sentence with a hole in it, and nothing else would notice.
//
// Not in here, on purpose: candidate labels, battle reports and the rules digest.
// Those are assembled by the engine, and part of them (the model's prompt and
// observation) must stay Chinese forever — see docs/I18N-PLAN.md section 3.
import type { Dict } from "./index.ts";

export const en: Dict = {
  // ── shared ──────────────────────────────────────────────────────
  "site.name": "Mind Arena",
  "site.sub": "Han Sandbox",
  "site.title": "Mind Arena · Han Sandbox",
  "site.desc": "Let several AI models play each other in reproducible lightweight games, "
    + "and let a human take one of the seats.",
  "nav.aria": "Main navigation",
  "nav.home.aria": "Mind Arena home",
  "nav.games": "Games",
  "nav.board": "Leaderboard",
  "nav.protocol": "Protocol",
  "nav.roadmap": "Roadmap",
  "chip.local": "Local prototype",
  "lang.switch": "中文",

  // ── landing page ────────────────────────────────────────────────
  "home.kicker": "AI GAME LAB · MODEL VS MODEL · HUMAN VS MODEL",
  "home.title.1": "Put models on the board,",
  "home.title.2": "not just on the question.",
  "home.lede": "A lightweight game platform built for AI play. Several models plug into one "
    + "interface, and reproducible rules, full replays and decision evidence show how each of "
    + "them actually chooses.",
  "home.cta.play": "Take a seat",
  "home.cta.map": "Open the map",
  "home.cta.protocol": "Read the match protocol",
  "home.stat.models": "models planned",
  "home.stat.games": "lightweight game types",
  "home.stat.protocol": "shared match protocol",

  "home.roster.aria": "Model roster",
  "home.roster.measured": "measured · {games} games",
  "home.roster.foot": "Board score = grade points + progress within the grade. "
    + "Strongest bot baseline: {baseline}.",
  "home.roster.more": "Full leaderboard with confidence intervals",

  "home.protocol.kicker": "ONE SHARED CONTRACT",
  "home.protocol.title.1": "The model only decides;",
  "home.protocol.title.2": "the rules engine owns the facts.",
  "home.protocol.observe": "Receives the same versioned, structured position",
  "home.protocol.decide": "Issues orders within the same time and call budget",
  "home.protocol.resolve": "A deterministic engine validates and settles everything",
  "home.protocol.replay": "Decisions, outcomes and the full evidence are kept",

  "home.lab.kicker": "REPUTATION BEFORE REVENUE",
  "home.lab.title.1": "Not announcing who won,",
  "home.lab.title.2": "but publishing the evidence.",
  "home.lab.spec": "One format for observation, decision, validation and settlement, "
    + "so other developers can plug in their own agents.",
  "home.lab.replay": "Every match keeps its seed, actions, rejected decisions, state hashes "
    + "and the full timeline.",
  "home.lab.card": "Win rate, cost, latency, illegal-action rate and stability all reported "
    + "together, rather than a screenshot of one ranking.",
  "home.lab.adapters": "The game core is decoupled from model providers, so the protocol, "
    + "an SDK and the base adapters can be opened up later.",

  "home.foot.proto": "Mind Arena · local prototype",
  "home.foot.first": "First match: Warlords Sandbox",

  // ── match lab (the four modules on the landing page) ─────────────
  "lab.kicker": "GAME MODULES",
  "lab.title": "One platform, four battlefields",
  "lab.lede": "Only “Warlords Sandbox” is built deep for now; the other games reuse the "
    + "same models, replays, leaderboard and validation.",

  "lab.game.01.title": "Warlords Sandbox",
  "lab.game.01.desc": "Six models run cities, move grain and strike alliances, contesting the "
    + "last word on a single map of the realm.",
  "lab.game.01.status": "First prototype",
  "lab.game.01.window": "Once per turn",
  "lab.game.02.title": "Tower Defence",
  "lab.game.02.desc": "Models set their lines within a fixed decision window while the rules "
    + "engine keeps the battlefield moving and records every judgement.",
  "lab.game.02.status": "Rules research",
  "lab.game.02.window": "Every 12 seconds",
  "lab.game.03.title": "Football Manager",
  "lab.game.03.desc": "Formation, substitutions, tempo and in-match events together make one "
    + "reviewable duel between model coaches.",
  "lab.game.03.status": "Concept queued",
  "lab.game.03.window": "On phase change",
  "lab.game.04.title": "Basketball Tactics",
  "lab.game.04.desc": "With the possession as the atom, models arrange rotations, plays and "
    + "the final shot.",
  "lab.game.04.status": "Concept queued",
  "lab.game.04.window": "Once per possession",

  // The module glyphs are marks, not copy: the Han characters stay in English too.
  // They live in the catalogue so that changing them later needs no component edit.
  "lab.game.01.symbol": "将",
  "lab.game.02.symbol": "塔",
  "lab.game.03.symbol": "⚽",
  "lab.game.04.symbol": "24",

  "lab.card.inspect.aria": "View the plan for {title}",
  "lab.card.configure": "Configure the first match",
  "lab.card.roadmap": "View the module plan",

  "lab.fact.window": "Decision window",
  "lab.fact.truth": "Source of truth",
  "lab.fact.truth.v": "Deterministic engine",
  "lab.fact.replay": "Replay format",

  "lab.form.aria": "{title} match configuration",
  "lab.notice.title": "Kept on the shared-protocol roadmap",
  "lab.notice.body": "First prove the agent loop on “Warlords Sandbox”, then reuse the same "
    + "model adapters, replays and evaluation.",
  "lab.notice.back": "Back to the first prototype",

  "lab.mode.legend": "Match type",
  "lab.mode.mvm": "Model vs model",
  "lab.mode.hvm": "Human vs model",
  "lab.seat.a": "Seat A",
  "lab.seat.b": "Seat B",
  "lab.seat.a.aria": "Seat A model",
  "lab.seat.b.aria": "Seat B model",
  "lab.style.legend": "Experiment mode",
  "lab.style.benchmark": "Fair benchmark",
  "lab.style.persona": "Persona play",
  "lab.seed": "Deterministic seed",
  "lab.submit": "Generate a local match config",
  "lab.note": "{status}. Two seats are pre-configured here; inside the sandbox each of the six "
    + "major factions can be bound to any OpenRouter text model.",

  "lab.models.loading": "Reading the OpenRouter model directory…",
  "lab.models.ok": "{count} text models · {auth}",
  "lab.models.auth.yes": "API configured",
  "lab.models.auth.no": "server-only key not configured yet",
  "lab.models.fail": "Model directory unavailable · showing the usual fallbacks",

  "lab.prepared.same": "Same position / same action budget",
  "lab.prepared.replay": "Decisions, validation and settlement all go into the replay",
  "lab.prepared.launch": "Enter the playable sandbox",
};
