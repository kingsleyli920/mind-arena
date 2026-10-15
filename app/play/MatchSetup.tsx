import type { PlaySession } from "@/lib/game/session.ts";
import { VERIFIED_MODELS } from "@/lib/arena/verified-models.ts";

export type ModelRow = { id: string; name: string; contextLength: number;
  promptPrice: string; completionPrice: string; structuredOutput: boolean };
export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export type SetupSeat = { id: string; name: string; lands: number };

export function MatchSetup({ session, onChange, seats, models, onLoadModels, error, onStart }: {
  session: PlaySession; onChange: (session: PlaySession) => void;
  seats: SetupSeat[]; models: ModelRow[]; onLoadModels: () => void;
  error: string | null; onStart: () => void;
}) {
  const count = Object.keys(session.modelOf).length;
  const names = new Map<string, string>([
    [DEFAULT_MODEL, "Nemotron Super（免费，响应可能较慢）"],
    ...VERIFIED_MODELS.map((m): [string, string] => [m.id, `${m.label}（历史实测）`]),
    ...models.map((m): [string, string] => [m.id,
      `${m.name} · 入 $${(Number(m.promptPrice) * 1e6).toFixed(2)} / 出 $${(Number(m.completionPrice) * 1e6).toFixed(2)} 每百万 token`]),
  ]);
  for (const id of Object.values(session.modelOf)) if (!names.has(id)) names.set(id, id);
  function control(id: string, kind: string) {
    const modelOf = { ...session.modelOf };
    delete modelOf[id];
    if (kind === "model") { modelOf[id] = DEFAULT_MODEL; onLoadModels(); }
    onChange({ ...session, modelOf,
      human: kind === "human" ? id : session.human === id ? null : session.human });
  }
  return (
    <section className="match-setup" aria-label="对局配置">
      <h2>谁来执掌天下</h2>
      <div className="setup-options">
        <label>参与方式
          <select value={session.human ? "play" : "watch"} onChange={(e) => {
            const human = e.target.value === "watch" ? null : "caocao";
            const modelOf = { ...session.modelOf };
            if (human) delete modelOf[human];
            onChange({ ...session, human, modelOf });
          }}>
            <option value="play">我控制一方</option>
            <option value="watch">纯观战</option>
          </select>
        </label>
        <label>本局模型决策上限
          <select value={session.callLimit} onChange={(e) => onChange({ ...session, callLimit: Number(e.target.value) })}>
            {[4, 16, 32, 64, 128, 256].map((n) => <option key={n} value={n}>{n} 次</option>)}
          </select>
        </label>
        <label>每次输出上限
          <select value={session.maxTokens} onChange={(e) => onChange({ ...session, maxTokens: Number(e.target.value) })}>
            {[4000, 8000, 16000].map((n) => <option key={n} value={n}>{n} token（含推理）</option>)}
          </select>
        </label>
        <label>推理档
          <select value={session.effort} onChange={(e) => onChange({ ...session, effort: e.target.value as PlaySession["effort"] })}>
            <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
          </select>
        </label>
      </div>
      <p>默认机器人，不调用模型。可给每个势力单独选择 AI；“由我控制”只占一席。</p>
      <div className="controller-list">
        {seats.map((f) => (
          <div className="controller-row" key={f.id}>
            <span><b>{f.name}</b><small>{f.lands} 郡</small></span>
            <select aria-label={`${f.name}控制者`}
              value={session.human === f.id ? "human" : session.modelOf[f.id] ? "model" : "bot"}
              onChange={(e) => control(f.id, e.target.value)}>
              <option value="bot">规则机器人</option>
              <option value="human">由我控制</option>
              <option value="model">AI 模型</option>
            </select>
            {session.modelOf[f.id] && <select aria-label={`${f.name}模型`} value={session.modelOf[f.id]}
              onChange={(e) => onChange({ ...session, modelOf: { ...session.modelOf, [f.id]: e.target.value } })}>
              {[...names].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>}
          </div>
        ))}
      </div>
      {error && <p role="status">模型目录暂不可用：{error}。可用已列出的模型或机器人。</p>}
      <div className="setup-launch">
        <p>{session.human ? `你将执掌${seats.find((f) => f.id === session.human)?.name ?? session.human}` : "你将观战，可随时切换观察势力"}。
          {count ? ` ${count} 个模型席位，每季最多 ${count} 次决策。达到 ${session.callLimit} 次上限前暂停。`
            : " 全部对手使用机器人，模型费用为零。"}
          {count > 0 && <small>每次决策最多发起 2 个请求；输出不会自动超过所选上限。次数限制不等于美元限额，失败请求也可能计费。</small>}
        </p>
        <button className="go" onClick={onStart}>{session.human ? "开始对局" : "开始观战"}</button>
      </div>
    </section>
  );
}
