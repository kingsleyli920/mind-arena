import test from 'node:test';
import assert from 'node:assert/strict';
import { b, P, g, roster, geo, deps } from '../tools/lib/strategy-context.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { listActions } from '../lib/game/engine/actions.ts';
import { admit } from '../lib/arena/seat/admit.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { save, load } from '../lib/game/save.ts';

const primary = ['campaign:中山国>代郡:main', 'campaign:中山国>雁门郡:main'];
const spare = 'campaign:乐安国>泰山郡:main';
const fresh = () => createGame(b, { seed: 'backup-test', roster, geo, graph: g,
  endCondition: 'unification' }, P);

test('备选只替代被拒首选，并与已采纳命令共用兵源及令数预算', () => {
  const game = fresh();
  const candidates = listActions(game, 'yuanshao', g, P, undefined, roster, undefined, geo);
  const withBackup = admit(game, 'yuanshao', primary, candidates, g, roster, undefined, P,
    [primary[0], primary[1], spare]);
  assert.deepEqual(withBackup.admitted, [primary[0], spare]);
  assert.deepEqual(withBackup.backupsUsed, [spare]);
  assert.equal(withBackup.dropped.length, 3, '首选冲突及重复备选均留有理由');
  assert.equal(withBackup.spent, 4);
  assert.deepEqual(admit(game, 'yuanshao', [primary[0]], candidates, g, roster, undefined, P,
    [spare]).backupsUsed, [], '没有首选被拒时不擅自执行备选');
  assert.deepEqual(game, fresh(), '准入不改原始战局');
});

test('模型备选经实际会话采纳、结算并保存，下一季收到采纳收据', async () => {
  let game = fresh(), session = newSession(null);
  session.modelOf.yuanshao = 'test/backup';
  const requests = [];
  const client = { async chat(req) {
    requests.push(JSON.parse(req.user));
    return { model: req.model, content: JSON.stringify({ picks: primary,
      backups: [spare], reason: '分兵两线', plan: { objective: '取代郡并东进', target: '代郡',
        stance: 'attack', preparation: '调配兵力', abortWhen: '兵力不足则收缩',
        status: 'continue', review: '先用中山兵力攻代郡' } }),
      usage: null, structured: true, rung: 'schema', maxTokens: 8000,
      attempts: 1, elapsedMs: 1, finishReason: 'stop' };
  } };
  const out = await advanceSeason(game, session, [], { ...deps, client }, () => {});
  assert.equal(out.rejected.length, 0);
  const record = out.session.records.at(-1);
  assert.deepEqual(record.backups, [spare]);
  assert.deepEqual(record.backupsUsed, [spare]);
  assert.deepEqual(record.admission.admitted, [primary[0], spare]);
  assert.match(record.review.commands.find(c => c.key === spare).label, /备选补位/);

  const original = globalThis.localStorage, store = new Map();
  globalThis.localStorage = { setItem: (key, value) => store.set(key, value),
    getItem: key => store.get(key) };
  try {
    save({ game: out.game, session: out.session, seat: 'yuanshao', picked: [], packStamp: 'backup-orders' });
    const restored = load('backup-orders');
    assert.deepEqual(restored.session.records.at(-1).backupsUsed, [spare]);
    game = restored.game; session = restored.session;
    await advanceSeason(game, session, [], { ...deps, client }, () => {});
    assert.ok(requests[1].decisionLastSeason.admitted.includes(spare));
  } finally { globalThis.localStorage = original; }
});
