import test from 'node:test';
import assert from 'node:assert/strict';
import { b, P, g, roster, geo } from '../tools/lib/strategy-context.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { resolve } from '../lib/game/engine/resolve.ts';
import { validate, DEFAULT_RULES } from '../lib/game/engine/actions.ts';
import { projectCampaign, projectSiege } from '../lib/game/engine/forecast.ts';

const fresh = () => createGame(b, { seed: 'transport', roster, geo, graph: g, endCondition: 'unification' }, P);
const [from, edges] = [...g.adj].find(([, es]) => es.length >= 2);
const [to, other] = edges.map(e => e.to);
const order = (a, z) => ({ faction: 'yuanshao', action: { type: 'transfer', from: a, to: z } });
const quiet = { ...P, goldOn: false, yieldToGarrison: 0 };
function transportState() {
  const s = fresh();
  for (const c of Object.values(s.commanderies)) {
    c.owner = 'yuanshao'; c.garrison = 1000; c.buildings = ['office'];
  }
  s.commanderies[from].garrison = 10000;
  s.factions.yuanshao.ap = 12;
  return s;
}

test('调兵：多条出发令合计保留半数守军，输入排列不改变结果', () => {
  const s = transportState(), orders = [order(from, to), order(from, other)];
  const a = resolve(s, orders, g, quiet, roster, geo).state;
  const z = resolve(s, [...orders].reverse(), g, quiet, roster, geo).state;
  assert.deepEqual(a, z);
  assert.equal(a.commanderies[from].garrison, 5000);
  assert.equal(a.commanderies[to].garrison + a.commanderies[other].garrison, 7000);
  assert.equal(Object.values(a.commanderies).reduce((n,c)=>n+c.garrison,0),
    Object.values(s.commanderies).reduce((n,c)=>n+c.garrison,0));
});

test('调兵：当季收到的兵不能沿第二条命令再转运', () => {
  const s = transportState();
  const a = resolve(s, [order(from, to), order(to, from)], g, quiet, roster, geo).state;
  assert.equal(a.commanderies[from].garrison, 5500);
  assert.equal(a.commanderies[to].garrison, 5500);
});

test('调兵：目的地容量限制不会吞兵或溢出', () => {
  const s = transportState(); s.commanderies[to].garrison = P.garrisonCap - 100;
  const a = resolve(s, [order(from, to)], g, quiet, roster, geo).state;
  assert.equal(a.commanderies[from].garrison, 9900);
  assert.equal(a.commanderies[to].garrison, P.garrisonCap);
});

test('调兵：敌城、不相邻道路和被围两端均不可通过', () => {
  const s = transportState();
  const check = o => validate(s, o, g, DEFAULT_RULES, roster, P);
  assert.equal(check(order(from, to)), null);
  s.commanderies[to].owner = 'liubiao';
  assert.match(check(order(from, to)), /须属己方/);
  s.commanderies[to].owner = 'yuanshao';
  const far = Object.keys(s.commanderies).find(id => id !== from && !edges.some(e=>e.to===id));
  assert.match(check(order(from, far)), /相邻/);
  s.armies.push({ faction: 'liubiao', target: to, marchLeft: 0 });
  assert.match(check(order(from, to)), /被围/);
});

function siegeFixture() {
  const s = fresh();
  s.commanderies[from].owner = 'yuanshao';
  Object.assign(s.commanderies[to], { owner: 'liubiao', garrison: 10000,
    startGarrison: 10000, defense: 100, provisions: 1, formation: 'square' });
  s.commanderies[from].formation = 'square';
  const army = { id: 'test-siege', faction: 'yuanshao', commander: null, retinue: [],
    troops: 5500, at: to, target: to, home: from, posture: 'main', gear: 'none',
    unit: s.commanderies[from].unit, marchLeft: 0, siegeSeasons: 0, idleSeasons: 0, supply: 5 };
  s.armies = [army]; return { s, army };
}

test('围攻前瞻：首攻折损后不足以封锁，不能误报当季粮尽', () => {
  const { s, army } = siegeFixture();
  const p = { ...quiet, siegeEncircle: false, jitter: 0 };
  const predicted = projectSiege(s, 'yuanshao', army, g, p, null);
  assert.notEqual(predicted.seasons, 0);
  const actual = resolve(s, [], g, p, null, geo).state;
  assert.equal(actual.commanderies[to].owner, 'liubiao');
});

test('围攻前瞻：未侦察不推测跨季结果，已探目标不读取隐藏余粮', () => {
  const { s, army } = siegeFixture(); s.armies = []; s.intel.yuanshao = {};
  const action = { type: 'campaign', from, target: to, commander: null, strength: 'main', siegeGear: 'none' };
  assert.equal(projectCampaign(s, 'yuanshao', action, army.troops, g, P, null), null);
  s.intel.yuanshao[to] = s.turn + 4;
  const first = projectCampaign(s, 'yuanshao', action, army.troops, g, P, null);
  s.commanderies[to].provisions = 100;
  assert.deepEqual(projectCampaign(s, 'yuanshao', action, army.troops, g, P, null), first);
});


test('已招降或收编武将可由现主调任，原主不能再按开局名册调走', async () => {
  const { recruitable } = await import('../lib/game/engine/officers.ts');
  const s = fresh();
  const who = roster.byFaction.get('liubiao')[0];
  s.commanderies[from].owner = 'yuanshao';
  s.commanderies[to].owner = 'yuanshao';
  s.stations[who.id] = from;
  s.capturedOfficers = s.capturedOfficers.filter(id => id !== who.id);
  assert.ok(recruitable(s, roster, 'yuanshao').some(o => o.id === who.id));
  assert.ok(!recruitable(s, roster, 'liubiao').some(o => o.id === who.id));
  assert.equal(validate(s, { faction: 'yuanshao', action: { type: 'appoint', officer: who.id, at: to } },
    g, DEFAULT_RULES, roster, P), null);
  s.capturedOfficers.push(who.id);
  assert.ok(!recruitable(s, roster, 'yuanshao').some(o => o.id === who.id));
});

test('国库只够现有军费时，自动补兵延后，不挤掉现役兵力', async () => {
  const { upkeepFor } = await import('../lib/game/engine/economy.ts');
  const s = transportState();
  for (const c of Object.values(s.commanderies)) c.garrison = 4000;
  s.factions.yuanshao.gold = 20000;
  const cost = upkeepFor(s, 'yuanshao', P);
  const probe = resolve(s, [], g, { ...P, yieldToGarrison: 0 }, null, geo).state;
  const income = probe.factions.yuanshao.gold - 20000 + cost;
  assert.ok(cost > income);
  s.factions.yuanshao.gold = cost - income;
  const a = resolve(s, [], g, P, null, geo).state;
  assert.ok(a.log.some(e => e.kind === 'recruit-limited' && e.faction === 'yuanshao'));
  assert.ok(!a.log.some(e => e.kind === 'unpaid' && e.faction === 'yuanshao'));
  assert.equal(Object.values(a.commanderies).reduce((n,c)=>n+c.garrison,0), 105*4000);
});

function lateSubmission() {
  const s = fresh();
  const provinces = [...geo.zhouMembers.values()];
  const owned = new Set(provinces.slice(0, 7).flat());
  const rest = Object.keys(s.commanderies).filter(id => !owned.has(id));
  for (const c of Object.values(s.commanderies)) c.owner = owned.has(c.id) ? 'yuanshao' : 'liubiao';
  // 留一个超过旧上限、且与霸主接壤的区域政权。
  for (const id of rest.slice(16)) s.commanderies[id].owner = 'yuanshao';
  s.factions.yuanshao.capital = [...owned][0];
  s.factions.liubiao.capital = rest[0];
  // 霸主还得是**打出来的**：劝降另有一道克城数门槛（见内容包
  // constants.归降.门槛_为何要克城数）。夹具只发地不发战功，就捏不出一个
  // 够得着劝降的霸主——而那不是机制坏了，是夹具没把霸主捏全
  s.factions.yuanshao.conquests = Math.max(s.factions.yuanshao.conquests, P.submitMinConquests);
  return s;
}

test('归降：晚期区域政权可劝降；开局越权请求被真实结算拒绝', async () => {
  const { submissionTerms, listActions } = await import('../lib/game/engine/actions.ts');
  const s = lateSubmission();
  assert.ok(submissionTerms(s, 'yuanshao', 'liubiao', g, P, geo));
  assert.ok(listActions(s, 'yuanshao', g, P, undefined, roster, undefined, geo)
    .some(c => c.key === 'submit:liubiao'));
  const start = fresh();
  const result = resolve(start, [{ faction: 'caocao', action: { type: 'submit', to: 'yuanshao' } }], g, P, roster, geo);
  assert.ok(result.rejected.length > 0);
  assert.ok(!result.state.factions.yuanshao.submittedTo);
  const cutoff = { ...P, submitHegemonyZhou: 99 };
  assert.equal(submissionTerms(s, 'yuanshao', 'liubiao', g, cutoff, geo), null);
});

test('归降退出后取消旧命令，并接管待任武将；拒降冷却仍有效', async () => {
  const { recruitable } = await import('../lib/game/engine/officers.ts');
  const { submissionTerms, submitBanUntil } = await import('../lib/game/engine/actions.ts');
  let won;
  for (let i = 0; i < 30; i++) {
    const s = lateSubmission(); s.seed = `surrender-${i}`;
    const officer = roster.byFaction.get('liubiao')[0]; delete s.stations[officer.id];
    const theirCity = Object.values(s.commanderies).find(c => c.owner === 'liubiao');
    const result = resolve(s, [
      { faction: 'yuanshao', action: { type: 'submit', to: 'liubiao' } },
      { faction: 'liubiao', action: { type: 'retire' } },
    ], g, P, roster, geo).state;
    if (result.factions.liubiao.submittedTo) {
      won = result;
      assert.equal(result.commanderies[theirCity.id].owner, 'yuanshao');
      assert.ok(!result.log.some(e => e.faction === 'liubiao' && e.kind === 'retire'));
      assert.ok(recruitable(result, roster, 'yuanshao').some(o => o.id === officer.id));
      break;
    }
    const until = submitBanUntil(result, 'liubiao');
    assert.ok(until > result.turn);
    assert.equal(submissionTerms(result, 'yuanshao', 'liubiao', g, P, geo), null);
  }
  assert.ok(won, '30个固定种子中应有归降成功的覆盖');
});
