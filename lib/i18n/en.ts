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
  "board.history.note": "Change a rule number and the two boards on either side become **incomparable**. So history is not "
    + "one line but a series of eras: within an era (same fingerprint over the rule numbers) the boards connect; "
    + "across eras each must be read on its own.",
  "board.history.era": "Rule era",
  "board.history.now": "current (frozen)",
  "board.history.dead": "retired",
  "board.history.col.board": "Board",
  "board.history.col.date": "Date",
  "board.history.col.git": "Commit",
  "board.history.dim": "Earlier boards are not here, for two reasons. One: their arms ran on **different eras** of the rules "
    + "(the rules were still moving), so such a board is incomparable with itself. Two: some directories hold "
    + "several snapshots of a single run — that is a working directory, not a board. The build tool refuses "
    + "both on the spot.",

  "board.caveats.h": "Before reading this board",
  "board.caveat.ci.b": "A ranking without intervals is not a ranking.",
  "board.caveat.ci": "The rows marked · under \u201cvs baseline ±95%\u201d have a confidence interval that covers "
    + "zero, which means **they cannot be told apart** — not \u201cslightly ahead\u201d.",
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

  // ── rules primer (the “how to play” panel) ─────────────────────
  // Every number comes from EngineParams as a {param} — **never copied into the
  // copy itself**, or this page would be describing the rules of three months ago.
  "primer.win.h": "How you win",
  "primer.win.lead": "After sixteen seasons the grade is set by the **gain over your opening "
    + "position**, and **holding what you had scores nothing** \u2014 nursing the family estate "
    + "to the end is a Ding.",
  "primer.win.jia": "2 more provinces, or 1 more province and 2 more province seats",
  "primer.win.yi": "1 more province, or 1 more province seat",
  "primer.win.bing": "More commanderies than at the start, at least one of them taken from another faction",
  "primer.win.ding": "None of the above",
  "primer.win.note": "\u201cControlling a province\u201d means holding more than half of its "
    + "commanderies. Ten scattered commanderies are worth less than one completed province \u2014 "
    + "the sidebar\u2019s province progress spells out how many you still need in each.",

  "primer.ap.h": "How much one season buys",
  "primer.ap.lead": "Orders are granted each season by territory; at most {carry} carry over, "
    + "the rest expire. A single commandery takes at most {per} orders a season.",
  "primer.ap.campaign": "Campaign / relief",
  "primer.ap.normal": "Governance / muster / diplomacy / passage",
  "primer.ap.scout": "Scout",
  "primer.ap.scout.v": "**free**, {n} per season",
  "primer.ap.appoint": "Appoint",
  "primer.ap.appoint.v": "a first posting is **free** ({n} per season); moving someone already "
    + "in post costs **{ap} orders**",
  "primer.ap.unit": "**{n} orders**",

  "primer.siege.h": "A siege turns on breaches, not on the troop ratio",
  "primer.siege.lead": "The troop ratio does not decide it directly. The engine turns "
    + "\u201cmy strength ÷ theirs\u201d into a number of **breaches** off a ladder, then compares it "
    + "with the defender\u2019s **holds** \u2014 **the wall falls only when breaches strictly exceed holds**.",
  "primer.siege.hold": "Holds = {base} + defence/{per} + a garrison-size band + the defending "
    + "officer\u2019s bonus. So repairing walls is not busywork, and an empty city may not hold "
    + "however many troops are inside.",
  "primer.siege.gear": "Siege gear (ram, mound) adds breaches directly, halved at a gate; a "
    + "commander with might ≥ {might} breaks the line in person and adds one too. Breaches are "
    + "small integers \u2014 one more is worth about thirty percent more troops.",
  "primer.siege.floor": "But none of this **tears open a gap that was never there**: below the "
    + "ladder\u2019s lowest rung the breach count is flatly 0. Gear and formation only widen an "
    + "advantage you already have.",
  "primer.siege.rung": "from {ratio}: {n} breaches",

  "primer.form.h": "Formation: one breach flips nearly half of all sieges",
  "primer.form.lead": "Formation belongs to the **commandery**, not to the sortie: **an attack "
    + "uses the formation of the commandery it set out from, a defence that of the commandery "
    + "under attack**. The three cycle: **Fish-Scale beats Crane-Wing, Crane-Wing beats Square, "
    + "Square beats Fish-Scale**. The favoured side gains {n} breaches, the other loses {n}.",
  "primer.form.why": "Why breaches rather than raw strength: the test is a coarse integer ladder, "
    + "and a ±20% multiplier often fails to move it at all. Measured, the margin of "
    + "\u201cbreaches − holds\u201d lands on **0 or 1 in 43.1% of cases** \u2014 so ±1 breach flips "
    + "nearly half of all sieges.",
  "primer.form.fog": "An enemy\u2019s formation is as hidden as their walls: **you see it only once "
    + "scouted**. Unseen, the forecast folds all three possibilities into its range and the verdict "
    + "widens accordingly \u2014 which is precisely what scouting buys. **Changing formation** is its "
    + "own order, and the engine offers it only when the enemy facing you has the formation that "
    + "beats yours, naming which one would turn it round.",

  "primer.fog.h": "What you see of the enemy carries error",
  "primer.fog.own": "Your own",
  "primer.fog.own.v": "true values",
  "primer.fog.scouted": "Scouted",
  "primer.fog.scouted.v": "a point estimate within ±{pct}%, good for {seasons} seasons",
  "primer.fog.unseen": "Unscouted",
  "primer.fog.unseen.v": "only which band it falls in ({tiers} bands, each {ratio}× apart)",
  "primer.fog.ally": "Reported by an ally",
  "primer.fog.ally.v": "what an ally passes on is also only scout-grade, not the true value",
  "primer.fog.note": "Scouting is free. Unscouted, neither the walls (20\u2013100) nor the defender\u2019s "
    + "bonus is known and the verdict is usually \u201cunknown\u201d \u2014 which is not the engine "
    + "failing to work it out, it is you not having looked.",

  "primer.officer.h": "Officers are not decoration",
  "primer.officer.lead": "Officers are stationed in commanderies. A sortie takes that commandery\u2019s "
    + "officers along, up to {cap}: the commander at full value, deputies at {weight}.",
  "primer.officer.cap": "**Troops you can send = officers along × {per}.** A commandery with no "
    + "notable officer can field only a token force however large its garrison \u2014 that is what an "
    + "empty \u201cofficers\u201d column means in the commandery table.",
  "primer.officer.captive": "When a city falls, **every officer inside is taken**, and is out of "
    + "this game. Posting a great name to a key position is a bet with a price.",

  "primer.suade.h": "After the wall falls: persuasion",
  "primer.suade.captive": "When a city falls **every officer inside is taken** \u2014 not only the "
    + "defending commander. That is what makes posting a great name a real bet.",
  "primer.suade.rate": "The attacker then has {window} seasons to spend a **persuade** order and "
    + "win them over; after that the chance is gone. The rate is {base} − mean of the five stats × "
    + "{per} (+{home} more if you hold their home commandery): an ordinary officer sits around a "
    + "third, while **a famous one averaging 90 is barely one in twenty**. Winning the siege is not "
    + "a free Guan Yu.",
  "primer.suade.fail": "If persuasion fails, **they refuse and leave for good**; the order is spent "
    + "either way. Officers set the ceiling on a sortie (officers along × {per}), so recruiting and "
    + "repairing walls compete for the same season\u2019s orders.",

  "primer.supply.h": "Supply lines and alliances",
  "primer.supply.lead": "At the end of each season connectivity is computed outward from your seat. "
    + "A commandery that is cut off **produces nothing**, and an army in the field **disperses next "
    + "season** \u2014 so cutting the supply line behind an army is a real tactic, and losing the seat "
    + "starves everything at once.",
  "primer.supply.ally": "An alliance buys intelligence and passage, **not immunity**. You may attack "
    + "an ally, but that is betrayal: morale drops by {morale} across your whole territory and you "
    + "may form no alliance for {ban} seasons. An alliance that simply expires returns to neutral "
    + "and is not betrayal.",

  "primer.sim.h": "Everything resolves at once",
  "primer.sim.lead": "All orders settle simultaneously and the order they were given does not change "
    + "the outcome. While you march on a city someone else may besiege it the same season \u2014 and "
    + "then it is a field battle, not a siege. The candidate list forecasts what can be forecast, but "
    + "nobody can predict a collision within the same season, and that cuts both ways.",
  // Grade names. 甲乙丙丁 are the Heavenly Stems used as ordinal marks \u2014 they are
  // literally the Chinese A/B/C/D, so that is what they become here. The three grades
  // above A are words, not marks (\u8d85 \u201csurpassing\u201d, \u9738 \u201chegemon\u201d,
  // \u738b \u201cking\u201d), so they are translated rather than lettered: a reader needs to
  // see that the ladder keeps going up past A.
  "grade.ding": "D",
  "grade.bing": "C",
  "grade.yi": "B",
  "grade.jia": "A",
  "grade.chao": "Ascendant",
  "grade.ba": "Hegemon",
  "grade.wang": "King",

  // ── action names (candidate panels and decision replay) ─────────
  // These are **a different vocabulary from the pack\u2019s actions[].name**: the pack says
  // \u6cbb / \u9635 / \u76df / \u63a2, written for the rules digest, where short wins; the UI needs to be
  // plain. The model reads the former, the player sees the latter. That is a division of
  // labour, not drift \u2014 the gate only requires every action to have a UI name.
  "action.campaign": "Campaign",
  "action.relief": "Relief",
  "action.withdraw": "Lift siege",
  "action.seize": "Seize site",
  "action.muster": "Muster",
  "action.transfer": "Transfer",
  "action.govern": "Govern",
  "action.build": "Build",
  "action.submit": "Demand surrender",
  "action.suade": "Persuade",
  "action.array": "Change formation",
  "action.relocate": "Move seat",
  "action.appoint": "Appoint",
  "action.scout": "Scout",
  "action.ally": "Diplomacy",
  "action.invest": "Invest office",
  "action.passage": "Right of passage",
  "action.retire": "Retire",

  // ── match control panel ─────────────────────────────────────────
  "panel.aria": "Match controls",
  "panel.watch.seat": "Watching",
  "panel.seat.dead": " (destroyed)",
  "panel.seat.retired": " (withdrawn)",
  "panel.advance": "Advance one season",
  "panel.auto.on": "Watch automatically",
  "panel.auto.off": "Pause",
  "panel.status.busy": "This season is settling; a pause takes effect once it finishes.",
  "panel.status.auto": "Advancing automatically",
  "panel.status.idle": "Paused",
  "panel.calls": "{models} model seats · {used}/{limit} decisions used",
  "panel.cost": "Reported cost ${usd}",
  "panel.cost.unknown": "; another {n} calls have no confirmed cost (interrupted or failed), "
    + "so the total may be higher.",
  "panel.retried": "There were retries; a timed-out attempt may not report its cost, so the "
    + "provider\u2019s bill is the final word.",
  "panel.quota.add": "Add 16 more decisions",
  "panel.quota.bots": "Continue with bots only",
  "panel.roster": "Controllers and standing plans",
  "panel.role.human": "You",
  "panel.role.bot": "Rule bot",
  "panel.last": "Last season\u2019s AI decisions · {n} seats",
  "panel.no.reason": "No reasoning given",
  "panel.adopted": "{ok} adopted, {drop} dropped",
  "panel.backups": ", {n} of them filled from backups",
  "panel.calls.detail": "{attempts} requests · {secs}s · output cap {max}",
  "panel.charged": " · ${usd} charged",
  "panel.charge.unknown": " · cost unconfirmed",
  "panel.order": "Order",
  "panel.drop.fallback": "failed validation",
  "drop.duplicate": "the same order was picked twice",
  "drop.unknown-key": "no such candidate",
  "drop.over-budget": "not enough orders left",
  "drop.rejected": "failed validation",

  // ── match setup ─────────────────────────────────────────────────
  "setup.aria": "Match setup",
  "setup.h": "Who takes the realm",
  "setup.join": "Your part",
  "setup.join.play": "I take a seat",
  "setup.join.watch": "Spectate only",
  "setup.limit": "Decision cap for this match",
  "setup.limit.unit": "{n} calls",
  "setup.maxtok": "Output cap per call",
  "setup.maxtok.unit": "{n} tokens (reasoning included)",
  "setup.effort": "Reasoning",
  "setup.effort.low": "Low",
  "setup.effort.medium": "Medium",
  "setup.effort.high": "High",
  "setup.note": "Bots by default, with no model calls. Any faction can be given its own AI; "
    + "\u201cI take this one\u201d uses a single seat.",
  "setup.lands": "{n} commanderies",
  "setup.ctrl.aria": "Controller for {name}",
  "setup.model.aria": "Model for {name}",
  "setup.ctrl.bot": "Rule bot",
  "setup.ctrl.human": "I take this one",
  "setup.ctrl.model": "AI model",
  "setup.models.fail": "The model directory is unavailable: {err}. Use one of the models listed, "
    + "or the bots.",
  "setup.will.play": "You will command {name}",
  "setup.will.watch": "You will spectate, and can switch which faction you watch at any time",
  "setup.seats": " {n} model seats, at most {n} decisions a season. It pauses before reaching "
    + "the cap of {limit}.",
  "setup.seats.none": " Every opponent is a bot, so there is no model cost.",
  "setup.seats.fine": "Each decision makes at most 2 requests, and output never exceeds the cap "
    + "you chose. A call limit is not a dollar limit, and failed requests can still be billed.",
  "setup.go.play": "Start the match",
  "setup.go.watch": "Start watching",
  "setup.model.free": "Nemotron Super (free, may be slow)",
  "setup.model.verified": "{label} (measured before)",
  "setup.model.price": "{name} · in ${in} / out ${out} per million tokens",

  // ── standing plan / decision review / settlement review ─────────
  "plan.aria": "Standing plan",
  "plan.legacy": "Free-text plan (old format): {text}",
  "plan.objective": "Objective: ",
  "plan.target": "Target commandery: ",
  "plan.target.global": "whole map",
  "plan.prep": "Preconditions: ",
  "plan.abort": "Abort or revise when: ",
  "plan.review": "This season\u2019s check: ",
  "plan.review.judged": " (AI verdict: {status})",
  "plan.status.continue": "continue",
  "plan.status.revise": "revise",
  "plan.status.complete": "complete",
  "plan.stance.attack": "attack",
  "plan.stance.defend": "defend",
  "plan.stance.develop": "develop",
  "plan.facts": "Facts right now: ",
  "plan.facts.v": "{lands} commanderies, {gold} gold in the treasury.",
  "plan.own.global": "A whole-map plan \u2014 check it against the battle report",
  "plan.own.unknown": "The target commandery could not be identified; correct it next season",
  "plan.own.mine": "The target is ours, garrison {n}",
  "plan.own.besieged": ", currently under siege",
  "plan.own.neutral": "The target is unowned",
  "plan.own.other": "The target still belongs to another faction",
  "plan.own.marching": "; {n} of our armies are moving on it",

  "review.aria": "Plan and orders check",
  "review.h": "Season {turn}: plan and orders check",
  "review.note": "Below is what validation said when the orders were given. Admitted means it "
    + "entered settlement; what actually happened is in this season\u2019s changes and report.",
  "review.summary": "Admission record · {n} orders",
  "review.admitted": "Admitted",
  "review.rejected": "Not admitted",
  "review.empty": "No orders were submitted this season.",

  "outcome.aria": "Settlement review",
  "outcome.h": "Season {turn}, what actually changed: ",
  "outcome.delta": "gained {gained}; lost {lost}.",
  "outcome.none": "nothing",
  "outcome.gold": "Treasury net change {delta} gold; ",
  "outcome.capital": "current seat {name} ({state}).",
  "outcome.capital.none": "no seat is set.",
  "outcome.capital.held": "held",
  "outcome.capital.lost": "lost",

  // ── map page ────────────────────────────────────────────────────
  "map.title": "Han Sandbox · The Map",
  "map.h": "Han Sandbox",
  "map.lede": "105 commanderies of the Book of Later Han · 13 provinces · the Yellow River\u2019s Eastern Han course",
  "map.cta.play": "Take a seat",
  "map.cta.board": "Leaderboard",
  "map.loading": "Loading the sandbox\u2026",
  "map.load.fail": "Could not load: {err}",
  "map.seat": "seat {name}",
  "map.modern": "today {name}",
  "map.control.full": "held",
  "map.control.contested": "contested",
  "map.control.nominal": "nominal",
  "map.counties": "counties",
  "map.households": "pop. 140 CE",
  "map.belongs": "holder",
  "map.hint": "Drag to pan · scroll to zoom · more passes and fords appear as you zoom in",
  "map.cancel": "Cancel",
  "map.kind.commandery": "Commandery",
  "play.title": "Han Sandbox · Match",

  // ── match page: seat selection and setup ────────────────────────
  "play.preparing": "Preparing the sandbox\u2026",
  "play.h": "Han Sandbox",
  "play.era.fallback": "Xingping 1 · 194 CE",
  "play.lede.pick": "Take one of the seats. ",
  "play.lede.win": "First to unify the realm wins",
  "play.lede.rule": ". Hold {zhou} provinces, or be the last faction standing. There is no "
    + "season limit; you can pause, save and come back at any time.",
  "play.scenario.aria": "Scenario",
  "play.scenario.meta": "{year} CE　{factions} factions　{blurb}",
  "play.primer.sum": "How to play",
  "play.primer.hint": "start here if this is new",
  "play.length.sum": "How long is a game",
  "play.length.hint": "until someone unifies",
  "play.length.1": "The game continues while the realm is divided. You can pause, spectate, "
    + "save your progress and pick it up later.",
  "play.length.2": "It pauses when an AI model reaches its call quota; raise the quota or hand "
    + "the seat to a bot and it continues. Seasons never decide the winner.",
  "play.resume.done": "See the last result",
  "play.resume.go": "Resume your game",
  "play.resume.watch": "spectating · ",
  "play.resume.state": "　season {turn}　{owned} commanderies (started with {start})　grade {grade}",
  "play.resume.continue": "Continue",
  "play.resume.discard": "Discard and restart",
  "play.seat.heading": "The factions · pick the one you will command",
};
