import type { CSSProperties } from "react";
import {
  HISTORICAL_PLACES,
  HISTORICAL_ROUTES,
  MAP_VIEWBOX,
  REGION_LABELS,
  RIVER_PATHS,
  projectLongitudeLatitude,
} from "@/lib/game/historical-map";
import { buildAdministrativeCells, type AdministrativeCell } from "@/lib/game/map-rendering";
import { getFactionDefinition, type CityState } from "@/lib/game/strategy";

const CHINA_OUTLINE = "M585.6,616.6 L572.7,611.3 L572.3,596.4 L580.0,588.6 L597.1,583.8 L606.0,584.2 L609.5,590.8 L602.7,598.4 L599.0,608.3 L585.6,616.6 Z M129.1,200.6 L127.8,190.8 L138.5,186.3 L124.5,156.4 L155.4,149.5 L163.4,145.7 L174.7,114.9 L205.7,120.5 L214.4,112.8 L215.1,95.5 L228.1,93.9 L240.0,82.4 L246.1,81.0 L250.2,93.0 L263.3,102.1 L285.6,108.6 L296.4,122.5 L290.4,142.6 L296.0,150.1 L314.6,153.0 L335.6,155.4 L354.5,166.2 L364.2,168.1 L371.3,183.9 L380.5,194.2 L397.7,193.8 L429.9,197.6 L450.7,195.2 L466.1,197.8 L489.3,208.3 L508.2,208.2 L515.1,213.6 L533.3,204.4 L558.5,198.4 L581.9,197.7 L600.2,191.7 L611.4,182.4 L622.3,176.6 L619.8,171.0 L614.8,164.3 L623.0,153.2 L631.8,154.8 L647.9,158.3 L663.4,149.1 L687.3,142.5 L698.7,131.1 L709.7,126.2 L732.4,123.9 L744.7,125.8 L746.5,119.7 L732.3,107.7 L719.8,102.2 L707.7,108.5 L692.3,105.9 L683.5,108.0 L679.5,101.0 L690.5,83.8 L698.1,70.8 L716.9,77.3 L738.9,66.4 L738.7,58.8 L752.8,40.6 L761.5,35.1 L761.3,25.6 L752.8,21.5 L765.7,12.9 L785.1,9.8 L805.8,9.3 L829.2,14.4 L842.9,20.8 L852.6,38.2 L858.4,45.6 L863.9,56.1 L869.6,73.0 L896.8,78.5 L915.3,90.8 L921.7,106.9 L945.4,107.0 L959.0,100.2 L984.8,95.1 L976.6,110.6 L970.5,116.9 L965.2,135.8 L954.6,152.5 L935.7,149.5 L922.3,155.6 L926.4,170.3 L924.1,190.7 L916.2,191.1 L916.2,199.9 L906.2,189.7 L899.9,199.3 L875.8,206.8 L878.3,215.9 L864.7,215.2 L857.3,209.8 L846.6,222.0 L829.4,231.3 L816.7,242.3 L794.8,247.3 L783.3,255.4 L766.5,260.1 L774.8,252.1 L771.5,245.4 L783.9,233.8 L775.6,224.8 L762.0,230.9 L744.4,242.9 L734.7,254.0 L719.4,254.8 L711.4,262.9 L719.7,274.5 L732.5,277.3 L733.0,285.1 L745.4,290.1 L762.9,277.8 L776.7,284.5 L786.8,285.0 L789.4,294.0 L767.3,298.8 L760.0,308.1 L744.8,316.7 L736.7,328.8 L753.6,338.2 L759.7,355.2 L769.2,371.0 L779.8,384.2 L779.6,397.0 L769.8,401.7 L773.5,410.9 L782.7,416.2 L780.3,430.2 L776.3,443.9 L767.6,445.4 L756.2,464.1 L743.5,486.7 L729.0,507.2 L707.5,523.1 L685.8,537.6 L668.2,539.6 L658.6,547.3 L653.2,541.7 L644.4,550.2 L622.6,558.9 L606.0,561.5 L600.7,579.7 L592.0,580.7 L587.9,568.2 L591.6,561.5 L570.7,556.0 L563.3,558.8 L547.6,554.4 L540.1,547.4 L542.6,537.4 L528.3,534.3 L520.8,527.8 L507.5,537.0 L492.3,539.0 L479.8,538.9 L471.4,543.1 L463.3,545.6 L465.7,565.3 L457.3,564.9 L455.9,560.8 L455.5,553.7 L444.0,558.7 L437.2,555.5 L425.6,549.1 L430.2,534.8 L420.3,531.4 L416.6,515.6 L400.1,518.4 L401.9,498.0 L416.7,483.6 L417.4,469.4 L416.9,456.2 L410.1,452.1 L404.9,442.0 L395.7,443.3 L378.9,440.7 L384.2,433.5 L376.8,422.8 L365.7,430.0 L352.6,425.8 L334.6,436.7 L320.4,449.6 L307.8,451.7 L300.9,447.1 L292.7,446.7 L281.5,442.7 L273.1,447.0 L262.7,459.8 L261.4,446.3 L251.9,449.9 L233.7,448.2 L216.0,444.3 L203.3,436.7 L191.2,433.3 L185.9,425.0 L177.1,422.6 L161.4,411.3 L148.8,406.1 L142.4,410.2 L120.6,398.1 L105.3,387.2 L100.9,368.2 L112.1,370.6 L112.6,361.8 L106.4,352.9 L108.0,338.9 L91.2,318.7 L65.5,311.7 L60.9,298.5 L49.3,290.5 L46.6,285.5 L44.2,275.7 L44.8,269.0 L35.3,265.1 L30.1,266.8 L26.2,250.9 L30.6,247.0 L28.5,242.9 L43.4,234.8 L54.2,231.4 L70.7,233.7 L76.6,222.7 L96.7,220.7 L102.2,213.9 L126.9,204.5 L129.1,200.6 Z";

function absolutePoint(longitude: number, latitude: number) {
  const projected = projectLongitudeLatitude(longitude, latitude);
  return {
    x: MAP_VIEWBOX.x + (projected.x / 100) * MAP_VIEWBOX.width,
    y: MAP_VIEWBOX.y + (projected.y / 100) * MAP_VIEWBOX.height,
  };
}

function riverPath(points: readonly (readonly number[])[]) {
  return points.map(([longitude, latitude], index) => {
    const point = absolutePoint(longitude, latitude);
    return `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }).join(" ");
}

function historicalRoutePath(fromId: string, toId: string) {
  const from = HISTORICAL_PLACES.find((place) => place.id === fromId);
  const to = HISTORICAL_PLACES.find((place) => place.id === toId);
  if (!from || !to) return "";
  const start = absolutePoint(from.longitude, from.latitude);
  const end = absolutePoint(to.longitude, to.latitude);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bend = ((fromId.length + toId.length) % 5 - 2) * 2.1;
  const midpoint = {
    x: (start.x + end.x) / 2 - (dy / length) * bend,
    y: (start.y + end.y) / 2 + (dx / length) * bend,
  };
  return `M${start.x.toFixed(1)} ${start.y.toFixed(1)} Q${midpoint.x.toFixed(1)} ${midpoint.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function normalizedPath(points: { x: number; y: number }[]) {
  return points.map((point, index) => {
    const x = MAP_VIEWBOX.x + (point.x / 100) * MAP_VIEWBOX.width;
    const y = MAP_VIEWBOX.y + (point.y / 100) * MAP_VIEWBOX.height;
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") + " Z";
}

const provincePalette = ["#817252", "#71806b", "#7d6558", "#667c7b", "#8a7e62", "#6f7058", "#806b5c"];

function cellColor(cell: AdministrativeCell, cities: CityState[]) {
  if (cell.level === "province") {
    const code = [...cell.name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return provincePalette[code % provincePalette.length];
  }
  const owners = cell.memberIds.map((id) => cities.find((city) => city.id === id)?.owner).filter(Boolean) as CityState["owner"][];
  const majority = owners.sort((first, second) => owners.filter((owner) => owner === second).length - owners.filter((owner) => owner === first).length)[0];
  return majority ? getFactionDefinition(majority).color : "#746a55";
}

function MapDefs() {
  return (
    <defs>
      <linearGradient id="paperLand" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#b8aa7e" />
        <stop offset="0.48" stopColor="#817b58" />
        <stop offset="1" stopColor="#4f5c43" />
      </linearGradient>
      <radialGradient id="seaWash" cx="72%" cy="55%" r="65%">
        <stop offset="0" stopColor="#4d716f" />
        <stop offset="1" stopColor="#1d2d2f" />
      </radialGradient>
      <pattern id="paperGrain" width="18" height="18" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="4" r="0.7" fill="#f3e8c7" opacity="0.15" />
        <path d="M0 12 L18 8" stroke="#172019" strokeWidth="0.55" opacity="0.12" />
      </pattern>
      <pattern id="terrainTileGrid" width="28" height="28" patternUnits="userSpaceOnUse">
        <path d="M0 0H28V28H0Z" fill="none" stroke="#493f2f" strokeWidth="0.22" opacity="0.16" />
        <path d="M4 19 Q9 14 14 18 T25 16" fill="none" stroke="#475441" strokeWidth="0.42" opacity="0.16" />
        <circle cx="8" cy="7" r="1.1" fill="#6f7c62" opacity="0.11" />
      </pattern>
      <pattern id="fieldHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
        <path d="M0 2H8 M0 6H8" stroke="#7d6844" strokeWidth="0.45" opacity="0.34" />
      </pattern>
      <pattern id="forestDot" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M2 8L5 2L8 8Z" fill="#425a43" opacity="0.32" />
      </pattern>
      <filter id="mapShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#0b100d" floodOpacity="0.5" />
      </filter>
      <clipPath id="chinaClip"><path d={CHINA_OUTLINE} /></clipPath>
    </defs>
  );
}

export function HistoricalMap({ zoom, cities }: { zoom: 1 | 2 | 3; cities: CityState[] }) {
  const provinceCells = buildAdministrativeCells(cities, "province");
  const commanderyCells = buildAdministrativeCells(cities, "commandery");
  const cityCells = buildAdministrativeCells(cities, "city");

  return (
    <div className={`historical-map-wrap zoom-${zoom}`} aria-label="194 年群雄割据历史地理分层地图">
      <svg className="historical-map" viewBox={`${MAP_VIEWBOX.x} ${MAP_VIEWBOX.y} ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`} preserveAspectRatio="none" role="img">
        <title>以东汉末年州郡为基线的历史地理沙盘，显示州域、河川、城邑、关隘与港口</title>
        <MapDefs />
        <rect x={MAP_VIEWBOX.x} y={MAP_VIEWBOX.y} width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} fill="#d8d0ba" />
        <path d={CHINA_OUTLINE} fill="url(#paperLand)" stroke="#695f49" strokeWidth="1.4" filter="url(#mapShadow)" />
        <image href="/game/han-terrain-geographic-v1.webp" x={MAP_VIEWBOX.x} y={MAP_VIEWBOX.y} width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} preserveAspectRatio="none" clipPath="url(#chinaClip)" opacity="0.94" />
        <rect x={MAP_VIEWBOX.x} y={MAP_VIEWBOX.y} width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} fill="url(#terrainTileGrid)" clipPath="url(#chinaClip)" />
        <path d={CHINA_OUTLINE} fill="url(#paperGrain)" opacity="0.48" />

        <g className="terrain-detail-layer" clipPath="url(#chinaClip)" aria-hidden="true">
          <path className="field-belt" d="M525 242 C584 218 675 216 765 250 L755 330 C681 304 603 302 536 326 Z" />
          <path className="field-belt" d="M650 350 C704 335 758 344 805 382 L788 438 C733 411 689 401 646 414 Z" />
          <path className="forest-belt" d="M455 356 C488 320 523 306 548 328 C527 359 515 389 505 428 C478 420 458 397 455 356 Z" />
          <path className="forest-belt" d="M555 360 C590 338 626 344 646 373 C625 394 611 424 600 463 C571 447 556 414 555 360 Z" />
          <path className="marsh-belt" d="M684 390 C723 380 763 394 791 426 C764 453 722 459 686 438 C677 424 676 405 684 390 Z" />
          <g className="ridge-lines">
            <path d="M430 398 C472 366 506 352 550 348 C583 346 612 357 638 376" />
            <path d="M548 230 C568 269 573 308 588 347" />
            <path d="M610 333 C640 315 668 320 694 350" />
            <path d="M487 437 C524 423 553 431 582 456" />
          </g>
        </g>

        <g className="administrative-ranges" clipPath="url(#chinaClip)" aria-label="州郡与据点战略范围">
          <g className="province-ranges">
            {provinceCells.map((cell) => <path key={cell.id} d={normalizedPath(cell.points)} style={{ "--range-color": cellColor(cell, cities) } as CSSProperties}><title>{cell.name}州域 · 战略尺度近似范围</title></path>)}
          </g>
          <g className="commandery-ranges">
            {commanderyCells.map((cell) => <path key={cell.id} d={normalizedPath(cell.points)} style={{ "--range-color": cellColor(cell, cities) } as CSSProperties}><title>{cell.name} · 战略控制近似范围</title></path>)}
          </g>
          <g className="city-ranges">
            {cityCells.map((cell) => <path key={cell.id} d={normalizedPath(cell.points)} style={{ "--range-color": cellColor(cell, cities) } as CSSProperties}><title>{cell.name}据点控制范围</title></path>)}
          </g>
        </g>

        <g className="terrain-mass" aria-hidden="true">
          <path d="M454 405 C478 386 507 368 545 352 C573 340 599 345 625 355" />
          <path d="M596 223 C603 250 604 282 618 321" />
          <path d="M520 389 C545 405 570 417 601 425" />
          <path d="M637 371 C661 366 681 373 698 391" />
        </g>

        <g className="river-system" aria-hidden="true">
          {RIVER_PATHS.map((river) => <path key={river.id} d={riverPath(river.points)} data-river={river.id} />)}
        </g>

        <g className="context-trails" aria-hidden="true">
          {HISTORICAL_ROUTES.filter((route) => {
            const from = HISTORICAL_PLACES.find((place) => place.id === route.from);
            const to = HISTORICAL_PLACES.find((place) => place.id === route.to);
            return from && to && (!from.operational || !to.operational);
          }).map((route) => (
            <path key={`${route.from}-${route.to}`} d={historicalRoutePath(route.from, route.to)} data-terrain={route.terrain} />
          ))}
        </g>

        <g className="geography-labels" aria-hidden="true">
          {REGION_LABELS.map((region) => {
            const point = absolutePoint(region.longitude, region.latitude);
            return <text key={region.id} x={point.x} y={point.y}>{region.name}</text>;
          })}
        </g>

        <g className="map-grid" aria-hidden="true">
          <path d="M390 260 H820 M390 370 H820" />
          <path d="M500 150 V480 M610 150 V480 M720 150 V480" />
        </g>
      </svg>

      <div className="map-locator" aria-label="完整中国轮廓及当前战区位置">
        <svg viewBox="0 0 1000 620" role="img">
          <title>中国轮廓，方框为当前汉末核心战区</title>
          <path d={CHINA_OUTLINE} />
          <rect x="390" y="150" width="430" height="330" />
        </svg>
        <span>汉末核心战区</span>
      </div>

      <div className="map-era-stamp" aria-hidden="true">
        <span>兴平元年</span>
        <strong>一九四</strong>
      </div>
      <small className="map-source-note">地貌采用 Natural Earth 公共领域地形并作水墨化处理 · 史实地点经现代资料校对 · 州郡控制面为玩法近似 · 水文、道路、城建与标签独立渲染</small>
    </div>
  );
}
