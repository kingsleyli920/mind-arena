// 失败分级：配置错不许算到模型头上。
//
// docs/EVAL.md 的第四条硬约束是「harness 失败与模型失败分开」，而 400 这一档
// 原先一律归 degradable → 模型。于是把 `deepseek/deepseek-v4-flash-latest`
// （不是有效 id）写进去跑六局，96 席·季全被记成「模型（答不上来）」，
// 报告出了一行「均分 0.0」——一个打错的 id 看上去就像「这个模型得零分」。
// 而它重试了四次 ×96 = 384 个请求才跑完，没有一次能成功。
import test from "node:test";
import assert from "node:assert/strict";

const { classify } = await import("../lib/arena/llm/errors.ts");

test("失败分级：模型 id 不存在是配置错，不是模型答不上来", () => {
  const body = JSON.stringify({ error: { message: "deepseek/deepseek-v4-flash-latest is not a valid model ID", code: 400 } });
  assert.equal(classify(400, body).kind, "config");
  assert.equal(classify(404, JSON.stringify({ error: { message: "No endpoints found for x/y" } })).kind, "config");
});

test("失败分级：寻常的 400 仍是 degradable —— 降一档可能就过了", () => {
  assert.equal(classify(400, '{"error":{"message":"response_format is not supported"}}').kind, "degradable");
  assert.equal(classify(422, '{"error":{"message":"schema too deep"}}').kind, "degradable");
});

test("失败分级：别的档位没被这次改动带动", () => {
  assert.equal(classify(402, "no credits").kind, "budget");
  assert.equal(classify(401, "bad key").kind, "auth");
  assert.equal(classify(403, "not allowed").kind, "auth");
  assert.equal(classify(429, "slow down").kind, "retryable");
  assert.equal(classify(500, "boom").kind, "retryable");
  assert.equal(classify(418, "teapot").kind, "fatal");
});
