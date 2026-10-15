// 每次决策先预留全部尝试。未知费用不退回，只释放未发生的尝试与成功响应的余量。
import assert from 'node:assert/strict';

export function reserveDecision(budget, bytes, price, limits) {
  assert.ok(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= limits.maxInputBytes, '输入大小超限');
  for (const rate of [price.input, price.output]) {
    assert.ok(Number.isFinite(rate) && rate > 0, '价格不可用');
  }
  assert.ok(budget.calls < limits.decisions, '决策次数触顶');
  // UTF-8 字节数作为保守 token 上界，额外覆盖消息封装与 schema 包装。
  const perAttempt = (bytes + 4096) * price.input + limits.maxTokens * price.output;
  const reserved = perAttempt * limits.attempts;
  assert.ok(budget.heldUsd + reserved <= limits.usd, '费用预留触顶，停止付费请求');
  budget.calls++;
  budget.heldUsd += reserved;
  return { perAttempt, reserved, settled: false };
}

export function settleDecision(budget, ticket, response, limits) {
  assert.ok(!ticket.settled, '同一请求不能重复释放预留');
  assert.ok(Number.isInteger(response.attempts) && response.attempts >= 1
    && response.attempts <= limits.attempts, '实际尝试次数异常');
  ticket.settled = true;
  const cost = response.usage?.cost;
  const knownCost = Number.isFinite(cost) && cost >= 0;
  // 客户端不提供失败尝试账单：保留前面每次尝试的全额，即使返回累计费用也宁可多留。
  const held = (response.attempts - 1) * ticket.perAttempt
    + (knownCost ? Math.max(cost, 0) : ticket.perAttempt);
  budget.heldUsd += held - ticket.reserved;
  budget.reportedUsd += knownCost ? cost : 0;
  budget.attempts += response.attempts;
  assert.ok(budget.heldUsd <= limits.usd, '回报费用超过预留，停止后续请求');
}
