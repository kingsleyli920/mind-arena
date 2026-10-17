import { InkMapViewer } from "./InkMapViewer";
import { DICTS, makeT, type Locale } from "@/lib/i18n";
import scenarios from "@/public/game/scenarios.json";
import "./game.css";

export const metadata = { title: DICTS.zh["map.title"] };

export default function MapPage() {
  const locale: Locale = "zh";
  const t = makeT(locale);
  return (
    <main className="map-page">
      <header className="map-head">
        {/* 剧本入口**从目录读**，不写死。
            原先这里手写着「兴平元年 / 建安五年」两个链接，而 public/game/scenarios.json
            本来就是由 build-runtime-bundle 扫出来的那份目录——加第三个剧本时，
            包会自己出现在目录里，而这两个链接不会，于是页面上少一个入口而没人报错。
            年号是**数据**不是文案，所以它不进 lib/i18n：它随剧本走，不随语言走 */}
        <span className="map-era">
          {scenarios.scenarios.map((s, i) => (
            <span key={s.id}>
              {i > 0 ? "　·　" : null}
              <a href={s.id === "194" ? "/game" : `/game?scenario=${s.id}`}>{s.era}</a>
            </span>
          ))}
        </span>
        <h1>{t("map.h")}</h1>
        <p>{t("map.lede")}</p>
        <p>
          <a href="/play">{t("map.cta.play")} →</a>{"　"}
          <a href="/board">{t("map.cta.board")} →</a>
        </p>
      </header>
      <InkMapViewer locale={locale} />
    </main>
  );
}
