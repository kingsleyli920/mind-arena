// 免费验证：所有真实失城都必须进入当事方的下一季结构化复盘。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { b, P, g, roster, geo, deps, identity } from './lib/strategy-context.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { observe } from '../lib/game/engine/observe.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';

const { values } = parseArgs({ options: { out: { type: 'string', default: '/tmp/feedback-audit.json' } } });
let game = createGame(b, { seed: 'strategy-cases-0', roster, geo, graph: g, endCondition: 'unification' }, P);
let session = newSession(null);
session.callLimit = 0;
const report = { ...identity, calls: 0, seasons: 8, losses: 0, missingFromText: 0,
  missingFromChanges: 0, examples: [] };
for (let turn = 0; turn < report.seasons; turn++) {
  const before = game;
  ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
  for (const faction of Object.keys(game.factions)) {
    const lost = Object.values(before.commanderies)
      .filter(c => c.owner === faction && game.commanderies[c.id].owner !== faction).map(c => c.id);
    if (!lost.length) continue;
    const observation = observe(game, faction, g, P, roster, geo, { since: before.log.length });
    const text = [...observation.report.mine, ...observation.report.world].join('\n');
    const absent = lost.filter(id => !text.includes(id));
    report.losses += lost.length;
    report.missingFromText += absent.length;
    report.missingFromChanges += lost.filter(id => !observation.report.changes.lost.includes(id)).length;
    assert.deepEqual(new Set(observation.report.changes.lost), new Set(lost));
    if (absent.length) report.examples.push({ turn: game.turn, faction,
      absentFromText: absent, changes: observation.report.changes });
  }
}
assert.equal(report.missingFromChanges, 0);
fs.writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ losses: report.losses, missingFromText: report.missingFromText,
  missingFromChanges: report.missingFromChanges }));
