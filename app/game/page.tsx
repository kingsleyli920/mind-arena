import { InkMapViewer } from "./InkMapViewer";
import "./game.css";

export const metadata = { title: "汉末沙盘 · 群雄沙盘" };

export default function MapPage() {
  return (
    <main className="map-page">
      <header className="map-head">
        {/* 底图两个剧本共用，叠在上面的势力归属不共用——era 由
            InkMapViewer 从标注数据里读，这里只给两个入口 */}
        <span className="map-era">
          <a href="/game">兴平元年</a>{"\u3000"}·{"\u3000"}
          <a href="/game?scenario=200">建安五年</a>
        </span>
        <h1>汉末沙盘</h1>
        <p>《后汉书·郡国志》一百零五郡国 · 十三州 · 黄河东汉故道</p>
        <p><a href="/play">入局对弈 →</a>{"\u3000"}<a href="/board">排行榜 →</a></p>
      </header>
      <InkMapViewer />
    </main>
  );
}
