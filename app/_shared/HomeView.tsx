import { ArenaLab } from "./ArenaLab";
import Link from "next/link";
import board from "@/public/game/leaderboard.json";
import { makeT, withLocale, type Locale } from "@/lib/i18n";

// 阵容不再写死。这个面板原本列的是六个「计划接入」的模型名，标着 PLANNED；
// 而现在有实测的榜了，首页最显眼的位置该放真数字而不是愿望。
// 数据来自 npm run build:board，同一份 JSON 也喂着 /board 页
const measured = board.rows.filter((r) => r.kind === "model");
const shortName = (id: string) => id.split("/").pop() ?? id;

/**
 * 落地页。文案全部走 lib/i18n 的目录——中文与英文是同一个组件的两次渲染，
 * 而不是两份页面：两份页面会各自演化，而没有任何东西会报错。
 */
export function HomeView({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  const href = (p: string) => withLocale(locale, p);
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label={t("nav.home.aria")}>
          <span className="brand-mark">MA</span>
          <span>
            <strong>{t("site.name")}</strong>
            <small>{t("site.sub")}</small>
          </span>
        </a>
        <nav aria-label={t("nav.aria")}>
          <a href="#games">{t("nav.games")}</a>
          <Link href={href("/board")}>{t("nav.board")}</Link>
          <a href="#protocol">{t("nav.protocol")}</a>
          <a href="#roadmap">{t("nav.roadmap")}</a>
          {/* 语言开关走真路由：落地页与榜单要能被各自的语言搜索到 */}
          <Link className="lang-switch" href={withLocale(locale === "zh" ? "en" : "zh", "/")}>
            {t("lang.switch")}
          </Link>
        </nav>
        <span className="build-chip"><i /> {t("chip.local")}</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker">{t("home.kicker")}</p>
          <h1>{t("home.title.1")}<br /><em>{t("home.title.2")}</em></h1>
          <p className="hero-lede">{t("home.lede")}</p>
          <div className="hero-actions">
            <Link className="primary-action" href="/play">{t("home.cta.play")} <span>↗</span></Link>
            <Link className="primary-action" href="/game">{t("home.cta.map")} <span>↗</span></Link>
            <a className="text-action" href="#protocol">{t("home.cta.protocol")} <span>→</span></a>
          </div>
          <dl className="hero-stats">
            <div><dt>06</dt><dd>{t("home.stat.models")}</dd></div>
            <div><dt>04</dt><dd>{t("home.stat.games")}</dd></div>
            <div><dt>01</dt><dd>{t("home.stat.protocol")}</dd></div>
          </dl>
        </div>

        <aside className="arena-panel" aria-label={t("home.roster.aria")}>
          <div className="panel-topline">
            <span>MODEL ROSTER</span>
            <span>{t("home.roster.measured", { games: board.rows[0]?.games ?? 0 })}</span>
          </div>
          <div className="arena-orbit" aria-hidden="true">
            <span className="orbit-ring ring-one" />
            <span className="orbit-ring ring-two" />
            <span className="arena-core">VS</span>
            {measured.map((m, index) => (
              <span className={`model-node node-${index + 1}`} key={m.id}>{index + 1}</span>
            ))}
          </div>
          <ol className="model-list">
            {measured.map((m, index) => (
              <li key={m.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {shortName(m.id)}
                <i>{m.board}</i>
              </li>
            ))}
          </ol>
          <p className="panel-foot">
            {t("home.roster.foot", {
              baseline: board.rows.find((r) => r.id === board.baseline)?.board ?? "—",
            })}{" "}
            <Link href={href("/board")}>{t("home.roster.more")} →</Link>
          </p>
        </aside>
      </section>

      <ArenaLab locale={locale} />

      <section className="protocol-section" id="protocol">
        <div className="protocol-intro">
          <p className="kicker">{t("home.protocol.kicker")}</p>
          <h2>{t("home.protocol.title.1")}<br />{t("home.protocol.title.2")}</h2>
        </div>
        <div className="protocol-flow">
          <div><span>01</span><strong>Observe</strong><p>{t("home.protocol.observe")}</p></div>
          <b>→</b>
          <div><span>02</span><strong>Decide</strong><p>{t("home.protocol.decide")}</p></div>
          <b>→</b>
          <div><span>03</span><strong>Resolve</strong><p>{t("home.protocol.resolve")}</p></div>
          <b>→</b>
          <div><span>04</span><strong>Replay</strong><p>{t("home.protocol.replay")}</p></div>
        </div>
      </section>

      <section className="open-lab" id="roadmap">
        <div className="open-lab-heading">
          <p className="kicker">{t("home.lab.kicker")}</p>
          <h2>{t("home.lab.title.1")}<br />{t("home.lab.title.2")}</h2>
        </div>
        <div className="open-lab-grid">
          <article><span>01</span><h3>Protocol Spec</h3><p>{t("home.lab.spec")}</p></article>
          <article><span>02</span><h3>Replay JSON</h3><p>{t("home.lab.replay")}</p></article>
          <article><span>03</span><h3>Evaluation Card</h3><p>{t("home.lab.card")}</p></article>
          <article><span>04</span><h3>Open Adapters</h3><p>{t("home.lab.adapters")}</p></article>
        </div>
      </section>

      <footer>
        <span>{t("home.foot.proto")}</span>
        <span>{t("home.foot.first")}</span>
      </footer>
    </main>
  );
}
