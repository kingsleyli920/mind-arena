[中文](BACKUP-ORDERS-2026-09-29.md) · [English](BACKUP-ORDERS-2026-09-29.en.md)

# AI Picks and Backup Fill-Ins (2026-09-29)

## Purpose and implementation

Previously the model gave several orders at once, and the admitter accepted or dropped them one by one in priority order; a conflicting pick left an opportunity to act unused. This round has the model give both `picks` and `backups` in the **same single answer**. A backup only fills in, in the order the model gave them, when a pick is rejected; when there are no rejected orders, the backups are not executed at all.

All orders are still handled by the same `OrderBudget`, with the existing limits on troop source, target, per-commandery order budget, action points, free uses, money and troop-transfer capacity. Backups cannot bypass validation, and no action is chosen from the bots. The output keeps at most 16 pick and backup keys; the real adoption record marks a "backup fill-in", and old responses without `backups` still parse.

The backup keys do not repeat the candidate enum in the schema, to avoid doubling the dynamic schema; the admitter verifies them strictly against the game's candidate table. The enum of the original `picks` is unchanged, and the candidates and the game rules are unchanged. Prompt 1.22.0; the save and content-pack versions are unchanged.

## The pre-spend agreement

Use the existing multi-front natural position for Gongsun Du (公孙度), with exactly one request to OpenAI GPT-5 Nano, a pinned provider, and low reasoning. Item by item against the previous round's live test on the same position: the state, the observation and the reasoning tier are exactly the same; only the static prompt and the output schema gain the backup fields. The price was looked up on the spot; input no more than 70 KB, output no more than 8000 tokens, at most two transmission attempts, and a cost reservation capped at **$0.03** for the single call. Stop on failure; no extra model requests.

Scope of judgement: first, whether the model actually gave any backups; then whether a pick was rejected, whether a backup filled in, whether new rejected orders appeared, and whether the actual resolution had any extra rejections. One output cannot prove that the model makes fewer mistakes in general, nor can a backup filling in be taken directly as an improvement in strategic win rate. If the model provides no usable backups, the free integration test can still demonstrate the feature path, but no benefit will be claimed for this live test.

## Verification results

- Free integration: Yuan Shao's (袁绍) picks sent troops out of Zhongshan (中山国) twice, and the second was rejected because of the same-source conflict; the Le'an (乐安国) sortie the model had provided filled in. The actual resolution had `rejected = 0`, the save restore preserved `backupsUsed`, and the admission receipt in the next season's observation contained the fill-in order. When all picks are legal, backups are not executed; duplicate or illegal backups are still rejected.
- Checked on the page: after loading the resolved save above, `/play` displays "2 adopted, 1 dropped, of which 1 backup filled in"; expanding the log, the Le'an sortie is marked "backup fill-in", and the second Zhongshan sortie shows the conflict reason. The verification entry point and the sample file were both temporary and have been cleaned up.
- Real low-cost request: on the same multi-front Gongsun Du position, `openai/gpt-5-nano` returned 4 picks and 2 backups in a single decision; all 4 picks were adopted, so neither of the 2 backups fired. The actual resolution added no rejected orders, and that season it gained Beihai (北海国) and the Liaodong Dependent State (辽东属国). Completed on the `schema-notemp` rung with 2 transmission attempts; the provider reported a cost of **$0.001686** against a reservation of **$0.0078114**, below the $0.03 cap. The free replay gave the same result, with no additional paid requests.
- Quality boundary: this Nano's first backup had the same troop source and the same target as a pick, just a different troop-strength tier; once that pick had been adopted, it could not fill in for the other, conflicting order. The model also spent only 2 action points, and its plan status was flagged `status-stale`. So this live test only proves that the model can produce output in the new format and does not wrongly execute backups when there is no conflict; it **does not prove that backups raise actual utilisation or the strategic win rate**. The paid request did make a second transmission attempt; the provider's bill is the final authority on the reported cost.

Checks this round: `npm test` 208/208, `npm run typecheck`, `npm run build`, the 16-season observation budget, and a free replay of the historical decision audit's 18 responses from 9 games.
The raw request, response, admission, resolution and cost records are saved in [`reports/decision-backups-2026-09-29/live.json`](reports/decision-backups-2026-09-29/live.json); replaying free from that save again gives the same result.

<!-- translated-from: BACKUP-ORDERS-2026-09-29.md@7d21ae7b61ed -->
