import board from "@/public/game/leaderboard.json";
import history from "@/public/game/history.json";
import pack from "@/lib/game/content/pack-194.json";
import { ruleFingerprint } from "@/lib/game/content/fingerprint";
import { boardStale, versionsSince, changeLogOf } from "@/lib/arena/board-stale";
import { GRADE_CN } from "@/lib/game/engine/victory";
import type { Grade } from "@/lib/game/engine/types";
import { makeT, withLocale, type Locale, type T } from "@/lib/i18n";
import "./board.css";

/*
 * 档位中文名从 victory.ts 来，这里不再抄一份。
 *
 * 原先这一页自己写了一份，和引擎那份逐字相同——而两份表的危险不在于「现在不一样」，
 * 在于**改一份另一份不会报错**：榜上写「甲」，对局页写别的，两边都跑得好好的。
 */
// 标成 Grade[] 而不是 string[]：这样档位名写错了是编译期报错，不是页面上一个空格
const ORDER: Grade[] = ["chao", "jia", "yi", "bing", "ding"];

/**
 * 一句话中间要加粗一截时用它：文案里留一个 `{b}` 洞，强调的那段单独一条 key。
 *
 * 为什么不把 `<b>` 写进文案里：那样目录里就混进了 HTML，译者得懂标签，
 * 而且标签一旦进了字符串，哪天要换成别的元素就得改两种语言的文案。
 * 中英的强调位置不同（中文「前后两份榜就**不可比**」，英文强调落在句末），
 * 所以洞的位置由各自的文案自己定。
 */
function part(text: string, bold: string) {
  const [before, after = ""] = text.split("{b}");
  return <>{before}<b>{bold}</b>{after}</>;
}

type Diff = { mu: number; ci: number; sig: boolean; n: number } | null;

/** 配对差。**区间必须和数字一起出现**——没有区间的排行榜，读者必然把噪声当成差距 */
function Delta({ d, t }: { d: Diff; t: T }) {
  if (!d) return <span className="base">{t("board.tag.base")}</span>;
  return (
    <span className={d.sig ? "d sig" : "d"}>
      {d.mu >= 0 ? "+" : ""}{d.mu}
      <i> ±{d.ci}</i>
      {d.sig ? "" : <em title={t("board.tag.nosig")}>·</em>}
    </span>
  );
}

/**
 * 空手席·季：引擎摆了候选出来而它一条没挑。
 *
 * 单挂一个记号，是因为这件事在表上的**每一列里都是伪装**：非法率的分母是
 * 「它下的令」，一条不下就是 0%，看着最守规矩；榜分只看疆域结果，而一个从不
 * 动手的席位多半也不会崩，于是能稳稳挂在中间档。读者看到的是一个「保守但
 * 规矩」的模型，实际是它把出参预算烧在推理上、什么也没说出来。
 *
 * 旧榜没有这一项，照 scenario 的办法显式读、缺了就当没有。
 */
function Blank({ r, t }: { r: object; t: T }) {
  const { blank = 0, turns = 0 } = r as { blank?: number; turns?: number };
  if (!blank || !turns) return null;
  const pct = Math.round((blank / turns) * 100);
  return (
    <b className="blank" title={t("board.blank.tip", { blank, turns })}>
      {t("board.blank", { pct })}
    </b>
  );
}

/**
 * 排行榜。中英共用同一个组件——两份页面会各自演化，而没有任何东西会报错。
 * 中文入口在 (zh)/board/page.tsx，英文在 (en)/en/board/page.tsx。
 */
export function BoardView({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  // 列举的分隔符。中文用顿号，英文用逗号——这不是文案，是标点习惯，
  // 放进目录会变成一条谁都看不懂的 key
  const listSep = locale === "zh" ? "、" : ", ";
  // 旧榜没有 scenario（是加第二个剧本那天才盖进去的），退回原值。
  // 类型从 JSON 推出来，所以这里显式读一次
  const scenarioName = (board as { scenario?: string }).scenario ?? t("board.era.fallback");
  const models = board.rows.filter((r) => r.kind === "model");
  const seats = Object.keys(board.rows[0]?.bySeat ?? {});
  // 过期判定与「其间升过哪几版」都在 lib/arena/board-stale.ts，那里有闸
  const boardFp = (board as { packFingerprint?: string | null }).packFingerprint ?? null;
  const nowFp = ruleFingerprint(pack);
  const stale = boardStale(board, pack);
  // 其间升过哪几版。原先是手写的一句「改过通行图、据点、调兵与组合命令预留」，
  // 那句话每升一版就旧一点，而包里本来就逐版记着
  const since = versionsSince(board, changeLogOf(pack));
  return (
    <main className="board-page">
      <header className="board-head">
        {/* 剧本名从榜数据里读。原先写死「兴平元年 · 一九四」，
            有了第二个剧本之后那就成了一句可能为假的话，而读者无从分辨。
            旧榜没有这一项（是加剧本那天才盖进去的），退回原值 */}
        <div className="board-top">
          <span className="era">{scenarioName}</span>
          <span className="board-links">
            <a href={withLocale(locale, "/")}>{t("board.back")}</a>
            {/* 语言开关指向**同一页**的另一种语言，不是回首页 */}
            <a className="lang-switch"
              href={withLocale(locale === "zh" ? "en" : "zh", "/board")}>
              {t("lang.switch")}</a>
          </span>
        </div>
        <h1>{t("board.title")}</h1>
        {/*
         * 榜是在某一版规则下跑出来的，而规则还在动。两者一旦分家，
         * 这一页上的每个数都不再对应任何一局现在能打出来的棋。
         *
         * 判据用**指纹**，不用版本号。这不是偏好，是 fingerprint.ts 开头那段
         * 论证的直接后果：版本号是人写的标签，两个方向都会错——有人只升版本
         * 没动数值，它会把「其实一样」判成不可比；有人改了数值忘了升版本，
         * 它又会把「其实不一样」判成可比。榜里早就盖了 packFingerprint，
         * 而这一页原先拿 packVersion 在比，正是它自己的模块说不该用的那把尺。
         * 旧榜没盖指纹（是后加的），那时才退回版本号。
         */}
        {stale ? (
          <p className="stale">
            <b>{t("board.stale.lead")}</b>{" "}
            {t("board.stale.from", { version: board.packVersion })}
            {boardFp ? t("board.stale.fp", { fp: boardFp }) : null}
            {t("board.stale.now", { version: pack.version, fp: nowFp.hash })}
            {since.length
              ? " " + t("board.stale.since", { n: since.length, list: since.join(listSep) })
              : null}
            <b>{t("board.stale.tail")}</b>{t("board.stale.tail2")}
          </p>
        ) : null}
        <p>
          {t("board.sub", {
            arms: board.rows.length, games: board.rows[0]?.games ?? 0,
            seasons: board.seasons ?? 0, version: board.packVersion,
          })}
          {/* 这里原先写死「1.0.0」：只要 frozen 非空就印 1.0.0，不管这份榜
              到底跑在哪一版。于是同一屏上，横幅说「内容包 0.2.0/1.0.0」，
              这一行说「冻结于 1.0.0」，两句话指同一份榜而数字不一样 */}
          {board.git ? <code> {board.git}</code> : null}
          {t("board.sub.spend", { usd: board.totalUsd })}
        </p>
      </header>

      <section className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="who">{t("board.col.who")}</th>
              <th>{t("board.col.board")}</th>
              <th>{t("board.col.delta")}</th>
              <th>{t("board.col.cont")}</th>
              <th>{t("board.col.growth")}</th>
              <th>{t("board.col.elim")}</th>
              <th>{t("board.col.illegal")}</th>
              <th>{t("board.col.usd")}</th>
              <th className="dist">{t("board.col.dist")}</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r) => (
              <tr key={r.id} className={r.kind === "bot" ? "bot" : ""}>
                <td className="who">
                  {r.id}
                  {r.kind === "bot" ? <i>{t("board.tag.bot")}</i> : null}
                  <Blank r={r} t={t} />
                </td>
                <td className="num strong">{r.board}</td>
                <td className="num"><Delta d={r.vs.board as Diff} t={t} /></td>
                <td className="num">+{r.cont}</td>
                <td className="num">{r.growth}</td>
                <td className="num">{r.elim}/{r.games}</td>
                <td className="num">{r.illegal}%</td>
                <td className="num">{r.usd ? `$${(r.usd / r.games).toFixed(3)}` : "—"}</td>
                <td className="dist">
                  {ORDER.filter((g) => (r.grades as Record<string, number>)[g]).map((g) => (
                    <span key={g} className={`g g-${g}`}>
                      {GRADE_CN[g]}{(r.grades as Record<string, number>)[g]}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 三把尺各量什么。不写清楚，读者会以为它们是同一个数的三种写法 */}
      <section className="rulers">
        <h2>{t("board.rulers.h")}</h2>
        <dl>
          <div>
            <dt>{t("board.col.board")}</dt>
            <dd>{t("board.rulers.board")}</dd>
          </div>
          <div>
            <dt>{t("board.col.cont")}</dt>
            <dd>{t("board.rulers.cont")}</dd>
          </div>
          <div>
            <dt>{t("board.col.growth")}</dt>
            <dd>{t("board.rulers.growth")}</dd>
          </div>
        </dl>
        {/* 三把尺各自的配对差摆在一起。主表只放榜分那一列，
            而「hy3 在最粗的尺上其实不显著」这件事只有摊开才看得见——
            一份藏起分歧的排行榜，比没有排行榜更坏 */}
        <table className="board rulers-table">
          <thead>
            <tr>
              <th className="who">{t("board.rulers.table")}</th>
              <th>{t("board.rulers.grade")}</th><th>{t("board.col.board")}</th>
              <th>{t("board.col.cont")}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td className="who">{m.id}</td>
                <td className="num"><Delta d={m.vs.grade as Diff} t={t} /></td>
                <td className="num"><Delta d={m.vs.board as Diff} t={t} /></td>
                <td className="num"><Delta d={m.vs.cont as Diff} t={t} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="verdict">
          {t("board.rulers.verdict")}<b>{t("board.rulers.verdict.same")}</b>
          {locale === "zh" ? "：" : ": "}{models.map((m) => m.id).join(" > ")}。{" "}
          {t("board.rulers.verdict.tail")}
        </p>
      </section>

      <section className="seats">
        <h2>{t("board.seats.h")}</h2>
        <p className="note">{t("board.seats.note")}</p>
        <table className="board">
          <thead>
            <tr><th className="who">{t("board.col.who")}</th>
              {seats.map((s) => <th key={s}>{s}</th>)}</tr>
          </thead>
          <tbody>
            {board.rows.map((r) => (
              <tr key={r.id} className={r.kind === "bot" ? "bot" : ""}>
                <td className="who">{r.id}</td>
                {seats.map((s) => {
                  const b = (r.bySeat as Record<string, { n: number; dead: number; gain: number }>)[s];
                  return (
                    <td key={s} className="num">
                      {b ? <>{b.gain >= 0 ? "+" : ""}{b.gain}{b.dead ? <i> ({b.dead})</i> : null}</> : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 历史按「规则代」分组。代与代之间必须有断口——
          把跨规则的榜画在同一条线上，是在制造一个不存在的趋势 */}
      <section className="history">
        <h2>{t("board.history.h")}</h2>
        <p className="note">
          {part(t("board.history.note"), t("board.history.note.b"))}
        </p>
        {history.eras.map((era) => (
          <div key={era.fingerprint} className={era.fingerprint === history.current ? "rule-era now" : "rule-era"}>
            <h3>
              {t("board.history.era")} <code>{era.fingerprint.slice(0, 12)}</code>
              {era.fingerprint === history.current
                ? <b>{"\u3000"}{t("board.history.now")}</b>
                : <i>{"\u3000"}{t("board.history.dead")}</i>}
            </h3>
            <table className="board">
              <thead>
                <tr>
                  <th className="who">{t("board.history.col.board")}</th>
                  <th>{t("board.history.col.date")}</th>
                  <th>{t("board.history.col.git")}</th>
                  {era.boards[0]?.rows.map((r) => <th key={r.id}>{r.id.split("/").pop()}</th>)}
                </tr>
              </thead>
              <tbody>
                {era.boards.map((b) => (
                  <tr key={b.id}>
                    <td className="who">{b.id}</td>
                    <td className="num">{b.date}</td>
                    <td className="num"><code>{b.git}</code></td>
                    {b.rows.map((r) => (
                      <td key={r.id} className={`num${r.kind === "bot" ? " botcell" : ""}`}>{r.board}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="note dim">
          {part(t("board.history.dim"), t("board.history.dim.b"))}
        </p>
      </section>

      {/* 读这份榜之前要知道的事。放在页面上而不是脚注里——
          一份不写清楚前提的排行榜，比没有排行榜更坏 */}
      <section className="caveats">
        <h2>{t("board.caveats.h")}</h2>
        <ul>
          <li><b>{t("board.caveat.ci.b")}</b>
            {part(t("board.caveat.ci"), t("board.caveat.ci.b2"))}</li>
          <li><b>{t("board.caveat.n.b")}</b>{t("board.caveat.n")}</li>
          <li><b>{t("board.caveat.illegal.b")}</b>{t("board.caveat.illegal")}</li>
          <li><b>{t("board.caveat.ver.b")}</b>{t("board.caveat.ver")}</li>
          {board.versionSkewNote ? (
            <li className="skew"><b>{t("board.caveat.skew.b")}</b>{board.versionSkewNote}</li>
          ) : null}
          <li><b>{t("board.caveat.usd.b")}</b>{t("board.caveat.usd")}</li>
        </ul>
        <p className="foot">
          <a href="/play">{t("board.foot.play")} →</a>
          <a href="/game">{t("board.foot.map")} →</a>
        </p>
        {/* 英文读者点进去是一页全中文。与其让他自己撞上，不如先说清楚——
            这是 docs/I18N-PLAN.md 第七节的要求：半英文的界面比纯中文更难用，
            因为读者会以为自己能读懂 */}
        {locale === "en" ? <p className="foot zhonly">{t("board.zhonly")}</p> : null}
      </section>
    </main>
  );
}
