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

  // ── leaderboard ─────────────────────────────────────────────────
  "board.title": "Han Sandbox · Leaderboard",
  "board.era.fallback": "Xingping 1 · The Warlords",
  "board.stale.lead": "This board is out of date.",
  "board.stale.from": "It was run under content pack {version}",
  "board.stale.fp": " (fingerprint {fp})",
  "board.stale.now": ", while the current engine is {version} (fingerprint {fp}).",
  "board.stale.since": " {n} versions have shipped since: {list}.",
  "board.stale.tail": " The scores below correspond to no game anyone can play today",
  "board.stale.tail2": "; they are kept as history and must not be compared with new results.",
  "board.sub": "{arms} contenders × {games} games, the same opening seeds, the same opponents, "
    + "seats rotated, {seasons} seasons each. Content pack {version}",
  "board.sub.spend": ". ${usd} actually charged in total.",

  "board.col.who": "Contender",
  "board.col.board": "Board score",
  "board.col.delta": "vs baseline ±95%",
  "board.col.cont": "Province progress",
  "board.col.growth": "Territory ×",
  "board.col.elim": "Eliminated",
  "board.col.illegal": "Illegal rate",
  "board.col.usd": "Charged / game",
  "board.col.dist": "Grade spread",
  "board.tag.bot": "bot",
  "board.tag.base": "baseline",
  "board.tag.nosig": "The confidence interval covers zero — they cannot be told apart",
  "board.blank": "blank {pct}%",
  "board.blank.tip": "{blank}/{turns} seat-seasons had candidates on the table and picked no order — "
    + "a column that neither the illegal rate nor the board score can show",

  "board.rulers.h": "Three rulers",
  "board.rulers.board": "Grade points plus continuous progress within the grade. Ranking uses this. "
    + "The grade is still the headline: a lower grade never beats a higher one.",
  "board.rulers.cont": "Each province counts as \u201cmy commanderies ÷ what a majority needs\u201d, capped at 1, "
    + "plus half a province seat, taken as the gain over the opening. Continuous and the most sensitive, "
    + "but it **cannot separate two bots**: their territory is nearly identical and the difference lies in "
    + "which valuable commanderies cross the line — exactly what the grade measures and this does not see.",
  "board.rulers.growth": "Final commanderies ÷ opening commanderies. The most intuitive, and not part of "
    + "the ranking: holding more ground is not the same as building power.",
  "board.rulers.table": "Paired difference vs baseline",
  "board.rulers.grade": "Grade points",
  "board.rulers.verdict": "All three rulers give ",
  "board.rulers.verdict.same": "exactly the same order",
  "board.rulers.verdict.tail": "The weakest one misses significance on the coarsest ruler (grade points) — "
    + "that is its effect being small, not the ruler being blind: all three agree on direction and order.",

  "board.seats.h": "By seat",
  "board.seats.note": "Mixing strong and weak seats into one mean is exactly where \u201cis this model just bad "
    + "everywhere?\u201d gets answered wrongly. The table below is each seat's commandery gain "
    + "(eliminations in brackets).",

  "board.history.h": "History",
  "board.history.note": "Change a rule number and the two boards on either side become {b}. So history is not "
    + "one line but a series of eras: within an era (same fingerprint over the rule numbers) the boards connect; "
    + "across eras each must be read on its own.",
  "board.history.note.b": "incomparable",
  "board.history.era": "Rule era",
  "board.history.now": "current (frozen)",
  "board.history.dead": "retired",
  "board.history.col.board": "Board",
  "board.history.col.date": "Date",
  "board.history.col.git": "Commit",
  "board.history.dim": "Earlier boards are not here, for two reasons. One: their arms ran on {b} of the rules "
    + "(the rules were still moving), so such a board is incomparable with itself. Two: some directories hold "
    + "several snapshots of a single run — that is a working directory, not a board. The build tool refuses "
    + "both on the spot.",
  "board.history.dim.b": "different eras",

  "board.caveats.h": "Before reading this board",
  "board.caveat.ci.b": "A ranking without intervals is not a ranking.",
  "board.caveat.ci": "The rows marked · under \u201cvs baseline ±95%\u201d have a confidence interval that covers "
    + "zero, which means {b} — not \u201cslightly ahead\u201d.",
  "board.caveat.ci.b2": "they cannot be told apart",
  "board.caveat.n.b": "48 games is the resolution floor.",
  "board.caveat.n": "A real gap of about 20 points measurably needs ≥48 games to clear the interval. Shorter runs "
    + "can exercise the pipeline and show the illegal rate, but their ranking is not a conclusion.",
  "board.caveat.illegal.b": "The illegal rate is not \u201cwrong answers\u201d.",
  "board.caveat.illegal": "It is the \u201ceach order is legal on its own but together they exceed this season's "
    + "order budget\u201d kind, which the admission layer drops. A dropped order is an order never given.",
  "board.caveat.ver.b": "Boards from different versions cannot be read side by side.",
  "board.caveat.ver": "Change a rule number and old and new boards stop being comparable — the pack version and "
    + "commit at the top of this page are there for exactly this.",
  "board.caveat.skew.b": "One exception on this board: ",
  "board.caveat.usd.b": "The money is what was charged, not an estimate.",
  "board.caveat.usd": "Price tables underestimate heavy-reasoning models tenfold — one model was estimated at "
    + "$1.61 and actually charged $16.64.",
  "board.foot.play": "Take a seat yourself",
  "board.foot.map": "See the map",
  "board.back": "Home",
  "board.zhonly": "The sandbox itself is Chinese-only for now: the rules digest, the candidate list and the battle report are assembled by the engine at runtime, and that layer has no English yet \u2014 part of it never will, since what the model reads must stay Chinese or old and new leaderboards stop being comparable.",
};
