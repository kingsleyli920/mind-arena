import test from 'node:test';
import assert from 'node:assert/strict';
import { b, P, g, roster, geo, deps } from '../tools/lib/strategy-context.mjs';
import { createGame } from '../lib/game/engine/setup.ts';
import { resolve } from '../lib/game/engine/resolve.ts';
import { listActions, DEFAULT_RULES } from '../lib/game/engine/actions.ts';
import { OrderBudget } from '../lib/game/engine/order-budget.ts';
import { admit } from '../lib/arena/seat/admit.ts';
import { parseDecision, decisionSchemaForKeys } from '../lib/arena/seat/parse.ts';
import { planFeedback, planReset } from '../lib/game/strategy-plan.ts';
import { summarizeSeason } from '../lib/game/engine/season-outcome.ts';
import { observe } from '../lib/game/engine/observe.ts';
import { advanceSeason, newSession } from '../lib/game/session.ts';
import { save, load } from '../lib/game/save.ts';

const fresh = () => createGame(b, { seed: 'strategy-plan', roster, geo, graph: g, endCondition: 'unification' }, P);
const plan = { objective: '保住济阴郡，稳住兖州前线', target: '济阴郡', stance: 'defend',
  preparation: '先侦察邻敌，确保守军足够', abortWhen: '治所失守则迁治并重定目标', status: 'continue', review: '当前治所仍在我方手中' };
const cand = (action, i) => ({ key: `choice-${i}`, action, cost: 2, label: '' });

test('同源多档征伐在准入和结算都只允许一条；玩家预览立即反馈', () => {
  const s = fresh();
  const campaign = listActions(s, 'yuanshao', g, P, DEFAULT_RULES, roster, undefined, geo)
    .find(c => c.action.type === 'campaign');
  assert.ok(campaign);
  const actions = [{ ...campaign.action, strength: 'main' }, { ...campaign.action, strength: 'allout' }];
  const cs = actions.map(cand);
  const a = admit(s, 'yuanshao', cs.map(c=>c.key), cs, g, roster, DEFAULT_RULES, P);
  assert.equal(a.admitted.length, 1);
  assert.match(a.dropped[0].detail, /冲突/);
  assert.match(a.check(actions[1]), /冲突/);
  const orders = actions.map(action => ({ faction: 'yuanshao', action }));
  const one = resolve(s, orders, g, P, roster, geo);
  assert.equal(one.rejected.length, 1);
  assert.deepEqual(one.state, resolve(s, [...orders].reverse(), g, P, roster, geo).state);
  assert.equal(resolve(s, a.orders, g, P, roster, geo).rejected.length, 0);
});

test('撤围与增兵互斥；同一武将不能调往两郡', () => {
  const s = fresh();
  const campaign = listActions(s, 'yuanshao', g, P, undefined, roster, undefined, geo)
    .find(c => c.action.type === 'campaign').action;
  s.armies.push({ id: 'test-siege', faction: 'yuanshao', home: campaign.from, at: campaign.target,
    target: campaign.target, troops: 2000, retinue: [], commander: null, posture: 'main', gear: 'none',
    unit: 'infantry', marchLeft: 0, siegeSeasons: 1, idleSeasons: 0, supply: 3 });
  const r = new OrderBudget(s, g, roster, P);
  assert.equal(r.take({ faction: 'yuanshao', action: { type: 'withdraw', army: 'test-siege' } }), null);
  assert.match(r.check({ faction: 'yuanshao', action: campaign }), /撤围/);
  const appointments = listActions(s, 'yuanshao', g, P, undefined, roster, undefined, geo)
    .filter(c=>c.action.type==='appoint');
  const a=appointments[0].action;
  const other=Object.values(s.commanderies).find(c=>c.owner==='yuanshao' && c.id!==a.at);
  const r2=new OrderBudget(s,g,roster,P);
  assert.equal(r2.take({faction:'yuanshao',action:a}),null);
  assert.match(r2.check({faction:'yuanshao',action:{...a,at:other.id}}),/冲突/);
});

test('累计国库和建筑槽位预留，接受的建设不会到结算时才缺钱', () => {
  const s=fresh();
  const cities=Object.values(s.commanderies).filter(c=>c.owner==='yuanshao').slice(0,2);
  for(const c of cities)c.buildings=[];
  s.factions.yuanshao.gold=P.buildGold.market;
  const cs=cities.map((c,i)=>({key:`build-${i}`,action:{type:'build',at:c.id,kind:'market'},cost:1,label:''}));
  const a=admit(s,'yuanshao',cs.map(c=>c.key),cs,g,roster,DEFAULT_RULES,P);
  assert.equal(a.admitted.length,1);
  assert.match(a.dropped[0].detail,/国库/);
  const result=resolve(s,a.orders,g,P,roster,geo);
  assert.equal(result.rejected.length,0);
  assert.ok(result.state.commanderies[cities[0].id].buildings.includes('market'));
  const t=fresh(), city=Object.values(t.commanderies).find(c=>c.owner==='yuanshao');
  city.buildings=['granary','market'].slice(0,P.buildCap-1); city.resources.push('tuntian');
  const rb=new OrderBudget(t,g,roster,P);
  assert.equal(rb.take({faction:'yuanshao',action:{type:'build',at:city.id,kind:'office'}}),null);
  assert.match(rb.check({faction:'yuanshao',action:{type:'build',at:city.id,kind:'farmstead'}}),/位置已预留/);
});

test('结构化计划完整解析，坏计划不会覆盖合法旧计划', async () => {
  const parsed=parseDecision(JSON.stringify({picks:[],plan}));
  assert.deepEqual(parsed.plan,plan);
  assert.equal(parseDecision(JSON.stringify({picks:[],plan:{objective:'缺字段'}})).plan,undefined);
  assert.equal(decisionSchemaForKeys(['x']).schema.properties.plan.type,'object');
  let game=fresh(),session=newSession(null); session.modelOf={caocao:'test/plan'};session.plans.caocao=plan;
  const client={async chat(){return {content:JSON.stringify({picks:[],plan:{objective:'坏计划'}}),
    usage:null,structured:true,rung:'schema',maxTokens:8000,attempts:1,elapsedMs:1};}};
  ({game,session}=await advanceSeason(game,session,[],{...deps,client},()=>{}));
  assert.deepEqual(session.plans.caocao,plan);
  assert.match(session.records[0].planWarning,/保留上季/);
});

test('目标反馈跟随事实变化，不读取敌方隐藏守军或存粮', () => {
  const s=fresh();
  const global = planFeedback(s, 'caocao', { ...plan, target: null });
  assert.equal(global.ownership, 'global');
  assert.equal(global.lands, Object.values(s.commanderies).filter(c => c.owner === 'caocao').length);
  assert.equal(global.treasury, Math.floor(s.factions.caocao.gold));
  const ours=planFeedback(s,'caocao',plan);
  assert.equal(ours.ownership,'own');
  s.commanderies['济阴郡'].owner='lubu';
  const foreign=planFeedback(s,'caocao',plan);
  s.commanderies['济阴郡'].garrison=999999;s.commanderies['济阴郡'].provisions=0;
  assert.deepEqual(planFeedback(s,'caocao',plan),foreign);
  assert.equal(foreign.ownership,'other');
  assert.ok(!('ownGarrison' in foreign));
  assert.equal(planFeedback(s,'caocao',{...plan,target:'虚构郡'}).ownership,'unknown-target');
});

test('已归属且未被围的旧进攻目标在下季输入中清空，守城和被围目标保留', () => {
  const s = fresh(), attack = { ...plan, stance: 'attack' };
  const reset = planReset(s, 'caocao', attack);
  assert.equal(reset.target, '济阴郡');
  const input = observe(s, 'caocao', g, P, roster, geo, { plan: attack });
  assert.equal(input.plan, null);
  assert.equal(input.planReset.target, '济阴郡');
  assert.equal(input.planFeedback.ownership, 'own');
  assert.equal(planReset(s, 'caocao', plan), null, '防守自家目标仍可延续');
  assert.deepEqual(observe(s, 'caocao', g, P, roster, geo, { plan }).plan, plan);
  s.armies.push({ id: 'siege-reset-test', faction: 'lubu', home: '陈留郡', at: '济阴郡',
    target: '济阴郡', troops: 1000, retinue: [], commander: null, posture: 'main', gear: 'none',
    unit: 'infantry', marchLeft: 0, siegeSeasons: 1, idleSeasons: 0, supply: 2 });
  assert.equal(planReset(s, 'caocao', attack), null, '己方目标正被围时可继续出城解围');
  assert.deepEqual(observe(s, 'caocao', g, P, roster, geo, { plan: attack }).plan, attack);
});

test('上季净失的防守或发展目标失效，同季收复和旧战报不误触发', () => {
  const before = fresh(), after = structuredClone(before);
  after.commanderies['济阴郡'].owner = 'lubu';
  after.lastOutcome = summarizeSeason(before, after);
  after.turn++;
  for (const stance of ['defend', 'develop']) {
    const old = { ...plan, stance };
    assert.match(planReset(after, 'caocao', old)?.reason ?? '', /上季净失/);
    const input = observe(after, 'caocao', g, P, roster, geo, { plan: old });
    assert.equal(input.plan, null);
    assert.equal(input.planFeedback.ownership, 'other');
    assert.deepEqual(input.report.changes.lost, ['济阴郡']);
  }
  assert.equal(planReset(after, 'caocao', { ...plan, stance: 'attack' }), null,
    '失地后的反攻仍是有效阶段');
  after.commanderies['济阴郡'].owner = 'caocao';
  assert.equal(planReset(after, 'caocao', plan), null, '已收复时不重置防守计划');
  after.commanderies['济阴郡'].owner = 'lubu';
  after.turn++;
  assert.equal(planReset(after, 'caocao', plan), null, '旧季失城不冒充刚结算的失守');
});

test('模型防守目标真实失守后，存档恢复与下一季请求收到失效提示', async () => {
  let game = fresh(), session = newSession(null);
  session.callLimit = 0;
  ({ game, session } = await advanceSeason(game, session, [], deps, () => {}));
  session.callLimit = 2;
  session.modelOf.liubei = 'test/plan';
  const defense = { ...plan, objective: '守住沛国', target: '沛国',
    abortWhen: '沛国失守则另择防线', review: '当前仍守沛国' };
  const requests = [];
  const client = { async chat(req) {
    requests.push(JSON.parse(req.user));
    return { model: req.model, content: JSON.stringify({ picks: [], backups: [],
      plan: requests.length === 1 ? defense : { ...defense, stance: 'attack', status: 'revise',
        objective: '收复沛国', review: '沛国上季失守，改为反攻' } }),
      usage: null, structured: true, rung: 'schema', maxTokens: 8000,
      attempts: 1, elapsedMs: 1, finishReason: 'stop' };
  } };
  ({ game, session } = await advanceSeason(game, session, [], { ...deps, client }, () => {}));
  assert.ok(game.lastOutcome.factions.liubei.lost.includes('沛国'));
  assert.equal(game.commanderies['沛国'].owner, 'liuchong');
  assert.deepEqual(session.records.at(-1).plan, defense, '模型原计划保留在历史记录');

  const original = globalThis.localStorage, storage = new Map();
  globalThis.localStorage = { setItem: (key, value) => storage.set(key, value),
    getItem: key => storage.get(key) };
  try {
    save({ game, session, seat: 'liubei', picked: [], packStamp: 'lost-plan' });
    const restored = load('lost-plan');
    assert.ok(restored);
    ({ game, session } = await advanceSeason(restored.game, restored.session, [],
      { ...deps, client }, () => {}));
  } finally { globalThis.localStorage = original; }
  assert.equal(requests.length, 2, '只在原定两季各请求一次');
  assert.equal(requests[1].plan, null);
  assert.equal(requests[1].planReset.target, '沛国');
  assert.match(requests[1].planReset.reason, /上季净失/);
  assert.deepEqual(requests[1].report.changes.lost, ['沛国']);
  assert.equal(requests[1].planFeedback.ownership, 'other');
  assert.equal(session.records[0].plan.status, 'continue');
  assert.equal(session.records[1].plan.status, 'revise');
});

test('跨提供方 schema 简化后，应用仍限制命令数与计划长度', () => {
  const decision = parseDecision(JSON.stringify({
    picks: Array.from({ length: 30 }, (_, i) => `order-${i}`),
    plan: { ...plan, objective: '目'.repeat(120), preparation: '备'.repeat(150),
      abortWhen: '退'.repeat(150), review: '复'.repeat(200) },
  }));
  assert.equal(decision.picks.length, 16);
  assert.equal(decision.plan.objective.length, 80);
  assert.equal(decision.plan.preparation.length, 100);
  assert.equal(decision.plan.abortWhen.length, 100);
  assert.equal(decision.plan.review.length, 160);
  assert.deepEqual(decisionSchemaForKeys(['order-1']).schema.properties.picks.items.enum, ['order-1']);
  assert.equal(decisionSchemaForKeys(['order-1']).schema.properties.backups.items.enum, undefined);
  const withBackups = parseDecision(JSON.stringify({ picks: ['first'],
    backups: Array.from({ length: 30 }, (_, i) => `backup-${i}`), plan }));
  assert.equal(withBackups.backups.length, 15, '首选与备选总共最多 16 条');
});

test('结构化计划实际进入下一季请求并可存档恢复，失败时不丢记忆', async () => {
  let game=fresh(),session=newSession(null); session.modelOf={caocao:'test/plan'};
  const observed=[];
  const client={async chat(req){observed.push(JSON.parse(req.user));return {
    model:req.model,content:JSON.stringify({picks:[],plan}),usage:null,structured:true,rung:'schema',
    maxTokens:8000,attempts:1,elapsedMs:1};}};
  for(let i=0;i<2;i++)({game,session}=await advanceSeason(game,session,[],{...deps,client},()=>{}));
  assert.deepEqual(observed[1].plan,plan);
  assert.equal(observed[1].planFeedback.target,'济阴郡');
  assert.ok(observed[1].report.mine.length>0);
  const original=globalThis.localStorage,store=new Map();
  globalThis.localStorage={setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)};
  try {save({game,session,seat:'caocao',picked:[],packStamp:'plan-test'});
    assert.deepEqual(load('plan-test').session.plans.caocao,plan);
  } finally {globalThis.localStorage=original;}
});
