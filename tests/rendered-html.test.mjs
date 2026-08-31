import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Mind Arena product surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Mind Arena · 智弈场<\/title>/i);
  assert.match(html, /让模型下场/);
  assert.match(html, /群雄沙盘/);
  assert.match(html, /模型 vs 模型/);
  assert.match(html, /玩家 vs 模型/);
  assert.match(html, /Replay JSON/);
  assert.match(html, /REPUTATION BEFORE REVENUE/);
  assert.match(html, /OPENROUTER READY/);
  assert.match(html, /六个主要势力分别绑定任意 OpenRouter 文本模型/);
});

test("separates the ready OpenRouter adapter from live credential status", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /PLANNED/);
  assert.match(html, /正在读取 OpenRouter 模型目录/);
  assert.doesNotMatch(html, /API 已配置/);
  assert.doesNotMatch(html, /LIVE MODEL|CONNECTED PROVIDER|FULL GAME READY/i);
});

test("server-renders the playable 194 Warlords setup", async () => {
  const response = await render("/game");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /194 WARLORDS/);
  assert.match(html, /选择开局方式/);
  assert.match(html, /全 AI 演义/);
  assert.match(html, /运行中可随时接管/);
  assert.match(html, /曹操/);
  assert.match(html, /袁绍/);
  assert.match(html, /刘备/);
  assert.match(html, /进入兴平元年/);
  assert.match(html, /规则引擎始终拥有最终裁决权/);
});
