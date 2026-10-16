[中文](README.md) · [English](README.en.md)

# Documentation index

## Currently in force

| Document | Contents |
| --- | --- |
| `ARCHITECTURE.en.md` | Tech stack, data layer, map pipeline, match protocol, licensing boundaries |
| `GAMEPLAY-DESIGN-V2-DELTA.en.md` | **The current version of the gameplay design.** Contains the MERS v0.1 one-page rule set (43 rules) |
| `PLAN.en.md` | **The development plan.** Inventory of where things stand, milestones, dependency order, acceptance criteria |
| `EVAL.en.md` | **How the eval is run.** Four hard constraints measured in practice: the 48-game lower bound, the bot baseline, the fallback rung and reasoning share, and keeping harness failures separate from model failures |
| `RESEARCH-2026-08-31.en.md` | The research and decision record for the map and the art, including the reasons for three reworks |
| `I18N-PLAN.md` | **What bilingual UI would actually cost** (Chinese only). Why the layer the model reads has to stay in Chinese |

Apart from `I18N-PLAN.md` — written for the maintainer, Chinese only — every
document on this page and in the three sections below has an English parallel
version `*.en.md`, with switcher links at the top of each. Chinese is the source;
when a Chinese file changes, `tests/bilingual-drift.test.mjs` names the English
twins that have gone stale. `tests/docs-index.test.mjs` pins this page itself:
every document under `docs/` must appear here.

## How the officer stats were derived

The numbers were not made up. These three record how the five dimensions are
derived from the sources, and which constraints may not be broken.

| Document | Contents |
| --- | --- |
| `OFFICER-ANCHORS.en.md` | **The five-dimension anchor system.** Five anchor ladders, the long-tail distribution, the derivation rules, fifteen cross-constraints |
| `OFFICER-ANCHORS-FEMALE.en.md` | The anchor ladder for women, and the C15 ceiling dispute (the Wang Yi case is parked in `proposals.P1`) |
| `OFFICER-RENOWN.en.md` | Renown tiers: how `historicalWeight` and `renown` are set, and which ceilings they clamp |

## Empirical reports (by date)

Each one is a before-and-after on a single change, and **negative results are
recorded as such**. Where a conclusion was later overturned by measurement, the
new report says so; the old report keeps its original data untouched.

| Document | What it records |
| --- | --- |
| `BALANCE-2026-10-16.en.md` | **Yuan Shao takes the board alone: four interventions, all four failed, and why.** The neighbourhood-pressure measure, and the one time I misread terrain as the cause partway through |
| `UNIFICATION-2026-09-28.en.md` | Unification endgame and the first round of bot optimisation. Two groups of six seeds run to 256 seasons; 0/6 unified |
| `STRATEGY-VALIDATION-2026-09-28.en.md` | Long-run strategy validation |
| `STRATEGY-REVIEW-2026-09-28.en.md` | Review facts and a diagnosis of the differences between factions |
| `STRATEGY-PLANS-2026-09-28.en.md` | Acceptance run on the consistency between strategic plans and orders |
| `STRATEGY-FINISH-2026-09-28.en.md` | Strategy wrap-up and acceptance |
| `PLAYTEST-2026-09-28.en.md` | Per-faction AI and a long strategic-game acceptance run |
| `PLAN-CONSISTENCY-2026-09-29.en.md` | Reconciling cross-season plan state against what actually happened |

## Model-decision measurements (these really do call models)

| Document | What it records |
| --- | --- |
| `DECISION-COMPARISON-2026-09-28.en.md` | nano / Flash-Lite / mini across nine decisions on a fixed position. **This is not a win-rate ranking** |
| `DECISION-CORRECTION-2026-09-28.en.md` | Whether a model corrects itself once order receipts are fed back. Six decisions cost $0.01073 |
| `DECISION-GUIDANCE-2026-09-29.en.md` | The strategic-decision timeline and how orders map onto it |
| `DECISION-REVIEW-2026-09-28.en.md` | Reconciling plans against orders |
| `BACKUP-ORDERS-2026-09-29.en.md` | When the AI's first-choice order is rejected, whether the backup picks up the slack |

## Research archive (`research/`)

9 cross-cutting research documents over two rounds, about 1.1MB. The conclusions that converged went into the "Currently in force" documents above; the full text is kept here for reference.

| Document | Coverage |
| --- | --- |
| `GAMEPLAY-RTK-SERIES.md` (Chinese) | Entry-by-entry comparison of KOEI's main *Sangokushi* (三国志) line: 8/9/10/11/13/14 |
| `GAMEPLAY-KOEI-WIDE.md` (Chinese) | *Bawang de Dalu* (霸王的大陆), the *Eiketsuden* (英杰传) line, *Senki* (战记), *Taisen* (大战), Empires, *Nobunaga's Ambition* (信长之野望) |
| `GAMEPLAY-CN-INDIE.md` (Chinese) | Establishing what *Chuangzao Sanguozhi* (创造三国志) actually is; *Han Mo Ba Ye* (汉末霸业); *Zhonghua Sanguozhi* (中华三国志); older domestic Chinese titles |
| `GAMEPLAY-OTHER-SANGUO.md` (Chinese) | *Qunyingzhuan* (群英传), *Total War: Three Kingdoms* (全战三国), *Shuaitu* / *Strategy Edition* (率土/战略版), *Sanguosha* (三国杀), open-source projects |
| `GAMEPLAY-SLG-MOBILE.md` (Chinese) | The season system and anti-decay mechanics of the *Shuaitu*-like (率土like) segment |
| `GAMEPLAY-WESTERN-ANALOG.md` (Chinese) | Oriental Empires, Paradox, Total War, asymmetric multiplayer board games |
| `GAMEPLAY-MINIMALISM.md` (Chinese) | How minimal rules produce deep strategy; eight techniques under an O(10²) action set |
| `GAMEPLAY-MOD-ECOSYSTEM.md` (Chinese) | The pain points of the original games as reflected in the mod ecosystem; **existing precedents for LLM Three Kingdoms projects** |
| `GAMEPLAY-AI-FRIENDLY.md` (Chinese) | Mechanics in grand strategy that suit AI agents: 12 principles |
| `OFFICER-STATS-DESIGN.md` (Chinese) | A reproducible methodology for deriving officer stats |
| `OFFICERS-AUDIT.md` (Chinese) | Historical verification report on the data for 578 officers |
| `PIXI-RENDERING.md` (Chinese) | Verification of PixiJS v8 usage |
| `THREE_KINGDOMS_RESEARCH.md` (Chinese) | The earliest history and gameplay baseline (parts of it since overturned) |

### Retired

| Document | Why it was retired |
| --- | --- |
| `GAMEPLAY-DESIGN-v1-superseded.md` (Chinese) | The first-round design. An adversarial review found 7 fatal problems; V2-DELTA has rewritten it |
| `GAMEPLAY-REVIEW-v1.md` (Chinese) | The adversarial review of the first-round design. Its conclusions have been folded into V2-DELTA; kept for traceability |

<!-- translated-from: README.md@a3ba694d03dd -->
