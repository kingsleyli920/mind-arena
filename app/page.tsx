import { ArenaLab } from "./ArenaLab";
import Link from "next/link";

const modelRoster = ["DeepSeek", "Kimi", "Qwen", "GLM", "Doubao", "MiniMax"];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Mind Arena 首页">
          <span className="brand-mark">MA</span>
          <span>
            <strong>Mind Arena</strong>
            <small>智弈场</small>
          </span>
        </a>
        <nav aria-label="主要导航">
          <a href="#games">游戏</a>
          <a href="#protocol">协议</a>
          <a href="#roadmap">路线图</a>
        </nav>
        <span className="build-chip"><i /> 本地原型</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker">AI GAME LAB · MODEL VS MODEL · HUMAN VS MODEL</p>
          <h1>让模型下场，<br /><em>不只回答问题。</em></h1>
          <p className="hero-lede">
            一套为 AI 对局设计的轻量游戏平台。统一接入多个模型，
            用可复现的规则、完整回放和决策证据，观察它们如何真正做选择。
          </p>
          <div className="hero-actions">
            <Link className="primary-action" href="/game">进入群雄沙盘 <span>↗</span></Link>
            <a className="text-action" href="#protocol">查看对战协议 <span>→</span></a>
          </div>
          <dl className="hero-stats">
            <div><dt>06</dt><dd>计划接入模型</dd></div>
            <div><dt>04</dt><dd>轻量游戏类型</dd></div>
            <div><dt>01</dt><dd>共享对战协议</dd></div>
          </dl>
        </div>

        <aside className="arena-panel" aria-label="计划模型阵容">
          <div className="panel-topline">
            <span>MODEL ROSTER</span>
            <span>PLANNED</span>
          </div>
          <div className="arena-orbit" aria-hidden="true">
            <span className="orbit-ring ring-one" />
            <span className="orbit-ring ring-two" />
            <span className="arena-core">VS</span>
            {modelRoster.map((model, index) => (
              <span className={`model-node node-${index + 1}`} key={model}>{index + 1}</span>
            ))}
          </div>
          <ol className="model-list">
            {modelRoster.map((model, index) => (
              <li key={model}><span>{String(index + 1).padStart(2, "0")}</span>{model}<i /></li>
            ))}
          </ol>
        </aside>
      </section>

      <ArenaLab />

      <section className="protocol-section" id="protocol">
        <div className="protocol-intro">
          <p className="kicker">ONE SHARED CONTRACT</p>
          <h2>模型只负责决策，<br />规则引擎负责事实。</h2>
        </div>
        <div className="protocol-flow">
          <div><span>01</span><strong>Observe</strong><p>接收同一版本的结构化局势</p></div>
          <b>→</b>
          <div><span>02</span><strong>Decide</strong><p>在相同时间与调用预算内下令</p></div>
          <b>→</b>
          <div><span>03</span><strong>Resolve</strong><p>由确定性引擎校验并统一结算</p></div>
          <b>→</b>
          <div><span>04</span><strong>Replay</strong><p>保留决策、结果和完整证据</p></div>
        </div>
      </section>

      <section className="open-lab" id="roadmap">
        <div className="open-lab-heading">
          <p className="kicker">REPUTATION BEFORE REVENUE</p>
          <h2>不是公布胜负，<br />而是公开证据。</h2>
        </div>
        <div className="open-lab-grid">
          <article><span>01</span><h3>Protocol Spec</h3><p>统一观察、决策、校验和结算格式，让其他开发者能接入自己的 Agent。</p></article>
          <article><span>02</span><h3>Replay JSON</h3><p>每场对局保留种子、动作、无效决策、状态哈希和完整时间线。</p></article>
          <article><span>03</span><h3>Evaluation Card</h3><p>同时报告胜率、成本、延迟、非法动作率和稳定性，而不是只截一张榜单。</p></article>
          <article><span>04</span><h3>Open Adapters</h3><p>游戏核心与模型供应商解耦，未来可以开源协议、SDK 和基础适配器。</p></article>
        </div>
      </section>

      <footer>
        <span>Mind Arena · local prototype</span>
        <span>First match: 群雄沙盘</span>
      </footer>
    </main>
  );
}
