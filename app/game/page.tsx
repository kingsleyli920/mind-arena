import { InkMapViewer } from "./InkMapViewer";
import "./game.css";

export const metadata = { title: "汉末沙盘 · 群雄沙盘" };

export default function MapPage() {
  return (
    <main className="map-page">
      <header className="map-head">
        <span className="map-era">兴平元年 · 一九四</span>
        <h1>汉末沙盘</h1>
        <p>《后汉书·郡国志》一百零五郡国 · 十三州 · 黄河东汉故道</p>
        <p><a href="/play">入局对弈 →</a></p>
      </header>
      <InkMapViewer />
    </main>
  );
}
