// 失败分级：配置错不许算到模型头上。
//
// docs/EVAL.md 第 6 条「harness 的失败不能算到模型头上」说的正是这件事，而 400 这一档
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

// ── 空内容的三分法 ────────────────────────────────────────────────
//
// 模型回了空内容，有三种完全不同的原因，不能都记成「出参预算不够」：
//   出参顶到上限 → 被推理吃光，harness 的配置问题
//   没顶到却空手 → 模型自己交了白卷，算它的分
//   一个 token 没花 → 提供方回了空壳，基础设施
//
// 原判据是「花过出参就算被吃光」（r > 0 || c > 0），太松。实测
// deepseek/deepseek-v4-flash-0731 四季全空，finish=stop、出参预算 8000
// 而推理只用了 1169——离上限远得很，却被记成 budget，于是一个交白卷的模型
// 被算成我们的预算没调好。这是「模型 id 打错被记成模型答不上来」的镜像。
test("空内容：顶到上限算 harness，没顶到算模型，一个 token 没花算基础设施", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("lib/arena/seat/model-seat.ts", "utf8"));
  // 判据写在源码里，这里只钉住它的形状——改松了会让这条闸失效而不报错
  assert.ok(/const hitCap = res\.finishReason === "length" \|\| \(cap > 0 && r \+ c >= cap \* 0\.9\)/.test(src),
    "hitCap 的判据变了 —— 它必须同时看 finish=length 与「出参接近上限」");
  assert.ok(/kind: FailureBucket = hitCap \? "budget" : touched \? "model" : "infra"/.test(src),
    "三分法变了 —— 顶到上限→budget，没顶到却空手→model，没花 token→infra");
  assert.ok(!/const spent = res\.finishReason === "length" \|\| r > 0 \|\| c > 0/.test(src),
    "旧的宽判据回来了：花过出参就算被吃光 —— 交白卷的模型会被记成预算问题");
});
