import type { HistoricalPlaceKind } from "@/lib/game/historical-map";

function modelClass(kind: HistoricalPlaceKind) {
  if (kind === "province-seat" || kind === "commandery-seat" || kind === "county-seat") return "city";
  if (kind === "settlement" || kind === "village") return "village";
  if (kind === "stronghold" || kind === "battlefield") return "stronghold";
  return kind;
}

export function MapSiteIcon({ kind, seal, minor = false }: { kind: HistoricalPlaceKind; seal?: string; minor?: boolean }) {
  const model = modelClass(kind);
  return (
    <span className={`map-site-model model-${model} ${minor ? "minor-model" : ""}`} aria-hidden="true">
      <span className="site-shadow" />
      {model === "city" ? (
        <>
          <span className="site-wall" />
          <span className="site-tower tower-left" />
          <span className="site-tower tower-right" />
          <span className="site-roof" />
          <span className="site-gate" />
        </>
      ) : null}
      {model === "gate" ? (
        <>
          <span className="site-wall" />
          <span className="site-tower tower-left" />
          <span className="site-tower tower-right" />
          <span className="site-gate" />
        </>
      ) : null}
      {model === "port" ? (
        <>
          <span className="site-water" />
          <span className="site-pier" />
          <span className="site-sail" />
          <span className="site-hull" />
        </>
      ) : null}
      {model === "crossing" ? (
        <>
          <span className="site-water" />
          <span className="site-bridge" />
          <span className="site-pillar pillar-left" />
          <span className="site-pillar pillar-right" />
        </>
      ) : null}
      {model === "village" ? (
        <>
          <span className="site-field" />
          <span className="site-hut hut-left" />
          <span className="site-hut hut-right" />
          <span className="site-tree" />
        </>
      ) : null}
      {model === "stronghold" ? (
        <>
          <span className="site-rampart" />
          <span className="site-palisade" />
          <span className="site-watchtower" />
        </>
      ) : null}
      {seal ? <b className="site-seal">{seal}</b> : null}
    </span>
  );
}
