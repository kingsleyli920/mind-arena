// 免费控制者对照。只替换机器人画像，不修改剧本兵力、经济或胜利规则。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { createGame, refreshAp } from '../lib/game/engine/setup.ts';
import { resolve } from '../lib/game/engine/resolve.ts';
import { decide, decideForPlay } from '../lib/game/engine/bot.ts';
import { b, P, g, roster, geo, identity, leaders } from './lib/strategy-context.mjs';

const { values } = parseArgs({ options: {
  out: { type: 'string', default: '/tmp/mind-arena-balance' },
  seeds: { type: 'string', default: '4' },
  budget: { type: 'string', default: '96' },
} });
const seeds = Number(values.seeds), budget = Number(values.budget);
assert.ok(Number.isInteger(seeds) && seeds >= 1 && seeds <= 12);
assert.ok(Number.isInteger(budget) && budget >= 1 && budget <= 256);
fs.mkdirSync(values.out, { recursive: true });
const file = path.join(values.out, 'report.json');
assert.ok(!fs.existsSync(file), '不覆盖已有对照');
const report = { ...identity, seeds, budget, calls: 0, runs: [] };
for (let index = 0; index < seeds; index++) {
  for (const variant of ['all-play', 'all-balanced', 'yuanshao-balanced']) {
    let s = createGame(b, { seed: `strategy-session-${index}`, roster, geo, graph: g,
      seasons: 64, endCondition: 'unification' }, P);
    const run = { seed: s.seed, variant, start: leaders(s), frames: [] };
    report.runs.push(run);
    while (!s.finished && s.turn < budget) {
      const orders = Object.keys(s.factions).sort().flatMap(f => {
        if (s.factions[f].eliminated || s.factions[f].retired) return [];
        const balanced = variant === 'all-balanced' || (variant === 'yuanshao-balanced' && f === 'yuanshao');
        return balanced ? decide(s, f, g, 'balanced', undefined, roster, P, geo)
          : decideForPlay(s, f, g, undefined, roster, P, geo);
      });
      const before = s;
      const result = resolve(s, orders, g, P, roster, geo);
      assert.equal(result.rejected.length, 0, '机器人与结算准入不一致');
      s = result.state.finished ? result.state : refreshAp(result.state, P);
      const events = s.log.slice(before.log.length);
      run.frames.push({ turn: s.turn, leaders: leaders(s).slice(0, 3),
        transfers: Object.values(s.commanderies).filter(c => c.owner !== before.commanderies[c.id].owner).length,
        majorEvents: events.filter(e => ['coalition', 'submitted', 'unified'].includes(e.kind)),
      });
    }
    Object.assign(run, { turn: s.turn, finished: s.finished, winner: s.winner,
      stopReason: s.finished ? 'unification' : 'test-budget-paused', leaders: leaders(s) });
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ seed: s.seed, variant, turn: s.turn, winner: s.winner, first: run.leaders[0] }));
  }
}
report.completed = true;
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
