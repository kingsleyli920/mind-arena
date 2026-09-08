import board from "@/public/game/leaderboard.json";
import history from "@/public/game/history.json";
import "./board.css";

export const metadata = { title: "汉末沙盘 · 排行榜" };

const GRADE_CN: Record<string, string> = {
  wang: "王", ba: "霸", chao: "超", jia: "甲", yi: "乙", bing: "丙", ding: "丁",
};
const ORDER = ["chao", "jia", "yi", "bing", "ding"];

type Diff = { mu: number; ci: number; sig: boolean; n: number } | null;

/** 配对差。**区间必须和数字一起出现**——没有区间的排行榜，读者必然把噪声当成差距 */
function Delta({ d }: { d: Diff }) {
  if (!d) return <span className="base">基线</span>;
  return (
    <span className={d.sig ? "d sig" : "d"}>
      {d.mu >= 0 ? "+" : ""}{d.mu}
      <i> ±{d.ci}</i>
      {d.sig ? "" : <em title="置信区间盖过零，分不开">·</em>}
    </span>
  );
}

export default function BoardPage() {
  const models = board.rows.filter((r) => r.kind === "model");
  const seats = Object.keys(board.rows[0]?.bySeat ?? {});
  return (
    <main className="board-page">
      <header className="board-head">
        <span className="era">兴平元年 · 一九四</span>
        <h1>汉末沙盘 · 排行榜</h1>
        <p>
          {board.rows.length} 个对局方 × {board.rows[0]?.games ?? 0} 局，
          同一批开局种子、同一批对手、席位轮换，每局 {board.seasons} 季。
          规则冻结于内容包 {board.frozen ? "1.0.0" : board.packVersion}
          {board.git ? <code> {board.git}</code> : null}。
          实扣合计 ${board.totalUsd}。
        </p>
      </header>

      <section className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="who">对局方</th>
              <th>榜分</th>
              <th>对基线 ±95%</th>
              <th>州进度</th>
              <th>疆域倍数</th>
              <th>灭亡</th>
              <th>非法率</th>
              <th>每局实扣</th>
              <th className="dist">档位分布</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r) => (
              <tr key={r.id} className={r.kind === "bot" ? "bot" : ""}>
                <td className="who">
                  {r.id}
                  {r.kind === "bot" ? <i>机器人</i> : null}
                </td>
                <td className="num strong">{r.board}</td>
                <td className="num"><Delta d={r.vs.board as Diff} /></td>
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
        <h2>三把尺</h2>
        <dl>
          <div>
            <dt>榜分</dt>
            <dd>档位分 + 档内的连续进度。排名用它。档位仍是头号指标——
              低一档永远压不过高一档。</dd>
          </div>
          <div>
            <dt>州进度</dt>
            <dd>每州按「我方郡数 ÷ 过半所需」计、封顶 1，再加半个州治，取相对开局的增量。
              连续，最灵敏，但**分不开两个机器人**：它们疆域几乎一样，
              差别在挑值钱的郡过线——那正是档位在量而它看不见的。</dd>
          </div>
          <div>
            <dt>疆域倍数</dt>
            <dd>终局郡数 ÷ 开局郡数。最直观，但不入排名：占郡多不等于成势。</dd>
          </div>
        </dl>
        {/* 三把尺各自的配对差摆在一起。主表只放榜分那一列，
            而「hy3 在最粗的尺上其实不显著」这件事只有摊开才看得见——
            一份藏起分歧的排行榜，比没有排行榜更坏 */}
        <table className="board rulers-table">
          <thead>
            <tr>
              <th className="who">对基线的配对差</th>
              <th>档位分</th><th>榜分</th><th>州进度</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td className="who">{m.id}</td>
                <td className="num"><Delta d={m.vs.grade as Diff} /></td>
                <td className="num"><Delta d={m.vs.board as Diff} /></td>
                <td className="num"><Delta d={m.vs.cont as Diff} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="verdict">
          三把尺给出<b>完全相同的名次</b>：{models.map((m) => m.id).join(" > ")}。
          最弱的那个在最粗的尺（档位分）上没过显著线——那是它的效应小，
          不是尺子瞎：三把尺的方向与名次都一致。
        </p>
      </section>

      <section className="seats">
        <h2>按席位</h2>
        <p className="note">
          强席与弱席混在一个均分里，正是「模型是不是普遍地差」这个问题被答错的地方。
          下表是各席位的郡数增量（括号内为灭亡数）。
        </p>
        <table className="board">
          <thead>
            <tr><th className="who">对局方</th>{seats.map((s) => <th key={s}>{s}</th>)}</tr>
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
        <h2>历史</h2>
        <p className="note">
          规则数值一改，前后两份榜就<b>不可比</b>。所以历史不是一条线，是分代的：
          同一代（规则数值的指纹相同）之内可以连起来看，跨代之间只能各读各的。
        </p>
        {history.eras.map((era) => (
          <div key={era.fingerprint} className={era.fingerprint === history.current ? "rule-era now" : "rule-era"}>
            <h3>
              规则代 <code>{era.fingerprint.slice(0, 12)}</code>
              {era.fingerprint === history.current
                ? <b>{"\u3000当前（已冻结）"}</b> : <i>{"\u3000已废"}</i>}
            </h3>
            <table className="board">
              <thead>
                <tr>
                  <th className="who">榜</th><th>日期</th><th>提交</th>
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
          更早的几份榜不在这里，原因有二：一是它们的各臂跑在<b>不同代</b>的规则上
          （当时边跑边改），那种榜内部就不可比；二是有的目录里躺着同一次跑的
          几份快照，那是工作目录不是榜。两种情况都会被产出工具当场拒掉。
        </p>
      </section>

      {/* 读这份榜之前要知道的事。放在页面上而不是脚注里——
          一份不写清楚前提的排行榜，比没有排行榜更坏 */}
      <section className="caveats">
        <h2>读这份榜之前</h2>
        <ul>
          <li><b>没有区间的名次不是名次。</b>「对基线 ±95%」里带 · 的那几行，
            置信区间盖过零，意思是<b>分不开</b>，不是「略胜」。</li>
          <li><b>48 局是分辨力下界。</b>实测 20 分左右的真实差距需要 ≥48 局才超出区间；
            局数更少的跑可以验管道、看非法率，但名次不可当结论。</li>
          <li><b>非法率不是「答错题」。</b>它是「单看每条都合法、合起来超了本季令数」
            那一类，会被准入层丢掉。丢掉的令等于没下。</li>
          <li><b>跨版本的榜不能并排读。</b>规则数值一改，新旧榜就不可比——
            页面顶上那个包版本与提交号就是为这件事留的。</li>
          {board.versionSkewNote ? (
            <li className="skew"><b>本榜的一处例外：</b>{board.versionSkewNote}</li>
          ) : null}
          <li><b>钱是实扣，不是估算。</b>价目表在重推理模型上会低估十倍——
            实测过一个模型估 $1.61、实扣 $16.64。</li>
        </ul>
        <p className="foot">
          <a href="/play">自己下场 →</a>
          <a href="/game">看地图 →</a>
        </p>
      </section>
    </main>
  );
}
