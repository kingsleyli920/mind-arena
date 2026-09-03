# 评测怎么跑

这份文档记的是**实测出来的约束**，不是设计意图。每一条都对应一次真花了钱
或花了时间才发现的事，重新发现一遍很贵。

## 一分钟版

```bash
# 基线，不花钱，永远先跑
npm run eval -- --agent=bot:balanced --games=48

# 单个模型
npm run eval -- --agent=model --model=anthropic/claude-sonnet-5 --games=48

# 排行榜
npm run eval:suite -- --agents=bot:balanced,bot:purpose,model:<id>,model:<id> \
  --games=48 --reasoning=low --jobs=4 --out=./eval-out
```

密钥放 `.env.local`（已在 `.gitignore`）。**必须走 `npm run eval`**——脚本是
plain node，靠 npm script 里的 `--env-file-if-exists=.env.local` 才读得到，
直接 `node tools/eval-run.mjs` 读不到。

## 四条硬约束

### 1. 少于 48 局，名次不可当结论

拿 `bot:purpose` vs `bot:balanced`（自对局实测相差约 20 分）做同 seed 同席位
的配对比较：

| 局数 | 配对差 | 95% CI | 分得开 |
|---|---|---|---|
| 6 | +0.0 | ±0.0 | 否，**每个 seed 上两者得分完全相同** |
| 12 | +16.7 | ±32.7 | 否 |
| 24 | +20.8 | ±23.5 | 否 |
| 48 | +29.2 | ±19.3 | 是（勉强） |
| 96 | +20.8 | ±12.6 | 是 |

根子在计分表只有四档（甲 300 / 乙 200 / 丙 100 / 丁 0），配对差每局只能取
0 或 ±100。换连续指标救不了场：郡数增量完全没信号，而且方向相反——purpose
拿分更高却占郡更少（−0.4 郡）。那反证 `gain` 是对的，它挑值钱的郡不是多的郡。

`tools/eval-suite.mjs` 低于 48 局会警告两次。低于这个数的跑仍然有用——
验管道、抓崩溃、看非法率——但排名不是结论。

### 2. 必须有 bot 基线

模型拿「均分 200」说明不了任何事，除非知道同席同 seed 下 `bot:balanced`
拿多少（6 局轮换实测 166.7）。基线不花钱，永远先跑。

机器人走的是与模型**完全相同**的那条路：`picks → admit() → orders`。
绕过准入层的话，illegalRate 与令数用率两列对基线是空的，而那正是判
「模型有没有在乱下令」的参照。

### 3. 必须报降级档位与推理占比，否则分数不可比

**降级档位**：客户端有四档阶梯 `schema → schema-notemp → schema-any → text`，
每档松一个约束。落在不同档位的模型受的约束不同（有无解码层强制、有无
temperature），分数本来就不完全可比。

为什么需要 `schema-notemp`：`provider.require_parameters` 要求端点支持请求里的
**每一个**参数，而 OpenAI 推理系的端点不接受 `temperature`——两者一撞，
OpenRouter 把 4 个端点筛成 0，返回 404「No endpoints found」。
实测 gpt-5-nano 的 16 次调用全部落在这一档；没有它会全部退到自由文本。

**推理占比**：实测 gpt-5-nano 每次调用烧 6739 出参 token（97.7% 是 reasoning），
claude-haiku-4.5 只烧 103，相差 65 倍。不指定 `--reasoning`，比的就不是
策略能力而是各家默认给多少测试时算力。

- 统一档位：`--reasoning=low`。实测 gpt-5-nano 出参 107830 → 25338（少 4.3 倍），档位不变
- 按出厂设置比也是正当口径，但必须是显式选择。报告会在推理占比过半且未指定时提醒

### 4. harness 的失败不能算到模型头上

出参预算被推理吃光（内容为空、`finish_reason=length`）是我们没让它说完，
不是模型答不上来。默认 `max_tokens` 8000，饿死则翻倍重试至 32000；
报告把两类失败分开计数。

原值 2000 的后果：gpt-5-nano 16 季全部返回空串，报告记成
「解析不出决策 / 0 分 / 令数用率 0%」——看着像模型不行。

## 缓存：候选 key 不写进 schema 的 enum

OpenRouter 把 `json_schema` 译成 Anthropic 的 tool，而 Anthropic 的缓存前缀
顺序是 **tools → system → messages**。候选 key 的 enum 每季都变 → tool 变 →
排在后面的 system 整块失效。system 占入参 38–52%。

| claude-haiku-4.5，同 seed 同局 | 缓存 | 入 token | 非法率 |
|---|---|---|---|
| enum 开 | 0（0%） | 178071 | 1.3% |
| enum 关 | 81720（60%） | 137337 | 0.0% |

按 Anthropic 缓存 0.1× 计价便宜 2.8 倍。翻转默认的依据不是省钱而是拦截率：
**五个跑、四个模型，`unknown-key` 一次都没出现过**，连 llama-3.1-8b 也是 0。
全部丢弃都是 `rejected`（引擎判组合不合法），那是 enum 本来就拦不住的。
`--keyenum=on` 复现旧行为。

Anthropic 还必须显式打 `cache_control` 断点，纯字符串 system 一次都不命中。
OpenAI / Gemini / DeepSeek 是自动缓存，两种写法都行。

## token 口径

`estTokens` 的系数由三家真实 tokenizer 标定（13 份真实提示词，最小二乘）：

| | 汉字/字 | ASCII/字 | 实际/估算 |
|---|---|---|---|
| anthropic/claude-haiku-4.5 | 1.300 | 0.446 | 1.59× |
| openai/gpt-5-nano | 1.040 | 0.420 | 1.37× |
| deepseek/deepseek-v3.2 | 0.855 | 0.467 | 1.33× |
| 曾经的系数 | 0.900 | 0.250 | — |

取 Claude 的（最保守，也正是主要评测对象）。观测预算闸门
`npm run obs:budget` 的单位因此是**真实 token**，默认 10000/席·季。

## 相关文件

| 文件 | 职责 |
| --- | --- |
| `tools/eval-run.mjs` | 单个对局方跑 N 局。对局循环只有这一份 |
| `tools/eval-suite.mjs` | 编排多个对局方 + 汇总排行榜。不复制对局循环 |
| `tools/obs-budget.mjs` | 观测预算闸门，exit 1 |
| `tools/selfplay.mjs` | 纯机器人自对局，四条玩法验收 |
| `lib/arena/llm/client.ts` | 降级阶梯、饿死检测、缓存断点 |
| `lib/arena/seat/parse.ts` | 决策 schema 与宽容解析 |
