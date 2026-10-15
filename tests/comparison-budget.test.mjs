import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveDecision, settleDecision } from '../tools/lib/comparison-budget.mjs';

const limits = { decisions: 9, attempts: 2, maxInputBytes: 70000, maxTokens: 8000, usd: .20 };
const price = { input: .25e-6, output: 2e-6 };
const fresh = () => ({ calls: 0, attempts: 0, heldUsd: 0, reportedUsd: 0 });

test('费用闸门在调用前拒绝超限；失败请求不能释放未知费用', () => {
  const budget = fresh();
  reserveDecision(budget, 70000, price, limits);
  reserveDecision(budget, 70000, price, limits);
  const before = structuredClone(budget);
  assert.throws(() => reserveDecision(budget, 70000, price, limits), /触顶/);
  assert.deepEqual(budget, before);
  assert.throws(() => reserveDecision(budget, 70001, price, limits), /输入/);
  assert.throws(() => reserveDecision(budget, 1000, { input: NaN, output: 1 }, limits), /价格/);
});

test('成功响应只释放已知余量，保留此前尝试，不能重复退款', () => {
  const budget = fresh();
  const ticket = reserveDecision(budget, 30000, price, limits);
  settleDecision(budget, ticket, { attempts: 2, usage: { cost: .003 } }, limits);
  assert.ok(Math.abs(budget.heldUsd - ticket.perAttempt - .003) < 1e-10);
  assert.equal(budget.reportedUsd, .003);
  assert.equal(budget.attempts, 2);
  assert.throws(() => settleDecision(budget, ticket, { attempts: 2 }, limits), /重复/);
  const next = reserveDecision(budget, 30000, price, limits);
  const held = budget.heldUsd;
  settleDecision(budget, next, { attempts: 1, usage: null }, limits);
  assert.ok(Math.abs(budget.heldUsd - held + next.perAttempt) < 1e-10);
});
