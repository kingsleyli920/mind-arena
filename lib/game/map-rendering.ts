import { getHistoricalPlace } from "./historical-map";
import type { CityState, RouteDefinition, RouteTerrain } from "./strategy";

export type MapZoom = 1 | 2 | 3;
export type AdministrativeLevel = "province" | "commandery" | "city";

export interface MapPoint {
  x: number;
  y: number;
}

export interface LabelLayout {
  id: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  width: number;
  height: number;
}

export interface RenderedRoad {
  id: string;
  fromId: string;
  toId: string;
  terrain: RouteTerrain;
  points: MapPoint[];
  routeNames: string[];
}

export interface AdministrativeCell {
  id: string;
  name: string;
  level: AdministrativeLevel;
  points: MapPoint[];
  memberIds: string[];
  ownerIds: string[];
  center: MapPoint;
}

const BOUNDS: MapPoint[] = [
  { x: -8, y: -8 },
  { x: 108, y: -8 },
  { x: 108, y: 108 },
  { x: -8, y: 108 },
];

export function isCityVisible(city: CityState, zoom: MapZoom): boolean {
  const rank = getHistoricalPlace(city.id)?.rank ?? 2;
  return zoom === 3 || rank === 1 || (zoom === 2 && rank <= 2);
}

function roadDistance(route: RouteDefinition, cityById: Map<string, CityState>): number {
  const from = cityById.get(route.from);
  const to = cityById.get(route.to);
  return from && to ? Math.hypot(from.x - to.x, from.y - to.y) : Number.POSITIVE_INFINITY;
}

function roadTerrain(routes: RouteDefinition[]): RouteTerrain {
  if (routes.every((route) => route.terrain === "大河")) return "大河";
  if (routes.some((route) => route.terrain === "关隘")) return "关隘";
  if (routes.some((route) => route.terrain === "山道")) return "山道";
  if (routes.some((route) => route.terrain === "平原")) return "平原";
  return "官道";
}

/**
 * Contract every chain of hidden sites into a corridor between the nearest visible sites.
 * This preserves the authored graph while preventing a route from ending in empty space at a
 * coarse zoom level.
 */
export function buildRenderedRoads(cities: CityState[], routes: RouteDefinition[], zoom: MapZoom): RenderedRoad[] {
  const cityById = new Map(cities.map((city) => [city.id, city]));
  const visibleIds = new Set(cities.filter((city) => isCityVisible(city, zoom)).map((city) => city.id));
  const adjacency = new Map<string, Array<{ otherId: string; route: RouteDefinition }>>();

  for (const route of routes) {
    if (!cityById.has(route.from) || !cityById.has(route.to)) continue;
    adjacency.set(route.from, [...(adjacency.get(route.from) ?? []), { otherId: route.to, route }]);
    adjacency.set(route.to, [...(adjacency.get(route.to) ?? []), { otherId: route.from, route }]);
  }

  const corridors = new Map<string, RenderedRoad>();
  for (const startId of [...visibleIds].sort()) {
    const queue: Array<{ nodeId: string; distance: number; nodeIds: string[]; routes: RouteDefinition[] }> = [
      { nodeId: startId, distance: 0, nodeIds: [startId], routes: [] },
    ];
    const bestHiddenDistance = new Map<string, number>();

    while (queue.length) {
      queue.sort((a, b) => a.distance - b.distance);
      const current = queue.shift()!;
      for (const edge of adjacency.get(current.nodeId) ?? []) {
        if (current.nodeIds.includes(edge.otherId)) continue;
        const nextDistance = current.distance + roadDistance(edge.route, cityById);
        const nodeIds = [...current.nodeIds, edge.otherId];
        const traversedRoutes = [...current.routes, edge.route];

        if (visibleIds.has(edge.otherId)) {
          if (edge.otherId === startId) continue;
          const endpointIds = [startId, edge.otherId].sort();
          const corridorId = endpointIds.join("--");
          const orderedNodeIds = endpointIds[0] === startId ? nodeIds : [...nodeIds].reverse();
          const candidate: RenderedRoad = {
            id: corridorId,
            fromId: endpointIds[0],
            toId: endpointIds[1],
            terrain: roadTerrain(traversedRoutes),
            points: orderedNodeIds.map((id) => {
              const city = cityById.get(id)!;
              return { x: city.x, y: city.y };
            }),
            routeNames: [...new Set(traversedRoutes.flatMap((route) => route.routeName ? [route.routeName] : []))],
          };
          const existing = corridors.get(corridorId);
          const existingDistance = existing
            ? existing.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - existing.points[index].x, point.y - existing.points[index].y), 0)
            : Number.POSITIVE_INFINITY;
          if (nextDistance < existingDistance) corridors.set(corridorId, candidate);
          continue;
        }

        if (nodeIds.length > 16 || nextDistance >= (bestHiddenDistance.get(edge.otherId) ?? Number.POSITIVE_INFINITY)) continue;
        bestHiddenDistance.set(edge.otherId, nextDistance);
        queue.push({ nodeId: edge.otherId, distance: nextDistance, nodeIds, routes: traversedRoutes });
      }
    }
  }

  return [...corridors.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function deterministicBend(id: string): number {
  let hash = 0;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return ((Math.abs(hash) % 7) - 3) * 0.12;
}

export function smoothRoadPath(road: RenderedRoad): string {
  if (road.points.length < 2) return "";
  if (road.points.length === 2) {
    const [from, to] = road.points;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const bend = deterministicBend(road.id) * Math.min(5, length * 0.3);
    const midpoint = {
      x: (from.x + to.x) / 2 - (dy / length) * bend,
      y: (from.y + to.y) / 2 + (dx / length) * bend,
    };
    return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} Q ${midpoint.x.toFixed(2)} ${midpoint.y.toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
  }

  const [first, ...rest] = road.points;
  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (let index = 0; index < rest.length - 1; index += 1) {
    const point = rest[index];
    const next = rest[index + 1];
    path += ` Q ${point.x.toFixed(2)} ${point.y.toFixed(2)} ${((point.x + next.x) / 2).toFixed(2)} ${((point.y + next.y) / 2).toFixed(2)}`;
  }
  const last = rest.at(-1)!;
  path += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return path;
}

function labelDimensions(city: CityState, zoom: MapZoom) {
  const nameLength = [...city.name].length;
  // The strategic overview uses the largest markers and includes the faction seal.
  // Keep its collision boxes deliberately conservative so DOM text metrics cannot
  // reintroduce a one-pixel overlap after the percentage-based layout is rendered.
  if (zoom === 1) return { width: 2.5 + nameLength * 1.65, height: 3.2 };
  if (zoom === 2) return { width: 1.65 + nameLength * 0.82, height: 1.95 };
  return { width: 1.2 + nameLength * 0.62, height: 1.42 };
}

function rectangleOverlap(a: LabelLayout, b: LabelLayout, padding = 0.18): number {
  const overlapX = Math.min(a.labelX + a.width / 2, b.labelX + b.width / 2) - Math.max(a.labelX - a.width / 2, b.labelX - b.width / 2) + padding;
  const overlapY = Math.min(a.labelY + a.height / 2, b.labelY + b.height / 2) - Math.max(a.labelY - a.height / 2, b.labelY - b.height / 2) + padding;
  return overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0;
}

function candidateOffsets(zoom: MapZoom): MapPoint[] {
  const stepX = zoom === 1 ? 1.9 : zoom === 2 ? 1.35 : 0.95;
  const stepY = zoom === 1 ? 1.55 : zoom === 2 ? 1.08 : 0.78;
  const offsets: MapPoint[] = [{ x: 0, y: 0 }];
  for (let ring = 1; ring <= 6; ring += 1) {
    const candidates = [
      { x: ring, y: 0 }, { x: -ring, y: 0 }, { x: 0, y: ring }, { x: 0, y: -ring },
      { x: ring, y: ring }, { x: -ring, y: ring }, { x: ring, y: -ring }, { x: -ring, y: -ring },
    ];
    offsets.push(...candidates.map((candidate) => ({ x: candidate.x * stepX, y: candidate.y * stepY })));
  }
  return offsets;
}

export function layoutCityLabels(cities: CityState[], zoom: MapZoom): LabelLayout[] {
  const visible = cities.filter((city) => isCityVisible(city, zoom)).sort((a, b) => {
    const rankDifference = (getHistoricalPlace(a.id)?.rank ?? 3) - (getHistoricalPlace(b.id)?.rank ?? 3);
    if (rankDifference) return rankDifference;
    return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
  });
  const placed: LabelLayout[] = [];
  const offsets = candidateOffsets(zoom);

  for (const city of visible) {
    const dimensions = labelDimensions(city, zoom);
    let best: LabelLayout | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const offset of offsets) {
      const candidate: LabelLayout = {
        id: city.id,
        anchorX: city.x,
        anchorY: city.y,
        labelX: Math.max(dimensions.width / 2, Math.min(100 - dimensions.width / 2, city.x + offset.x)),
        labelY: Math.max(dimensions.height / 2, Math.min(100 - dimensions.height / 2, city.y + offset.y)),
        ...dimensions,
      };
      const overlap = placed.reduce((sum, other) => sum + rectangleOverlap(candidate, other), 0);
      const displacement = Math.hypot(candidate.labelX - city.x, candidate.labelY - city.y);
      // A visually tiny overlap is still an overlap once the label is painted with
      // its outline. Always prefer a collision-free candidate over a closer one;
      // displacement is only the tie-breaker inside the same collision class.
      const score = overlap > 0 ? 1_000_000 + overlap * 1000 + displacement : displacement;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
      if (overlap === 0 && displacement <= Math.max(Math.abs(offset.x), Math.abs(offset.y))) break;
    }

    placed.push(best!);
  }
  return placed;
}

function halfPlaneValue(point: MapPoint, site: MapPoint, other: MapPoint): number {
  return 2 * point.x * (other.x - site.x) + 2 * point.y * (other.y - site.y)
    - (other.x * other.x + other.y * other.y - site.x * site.x - site.y * site.y);
}

function clipToNearestSite(polygon: MapPoint[], site: MapPoint, other: MapPoint): MapPoint[] {
  const result: MapPoint[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentValue = halfPlaneValue(current, site, other);
    const previousValue = halfPlaneValue(previous, site, other);
    const currentInside = currentValue <= 0;
    const previousInside = previousValue <= 0;

    if (currentInside !== previousInside) {
      const denominator = previousValue - currentValue;
      const t = denominator === 0 ? 0 : previousValue / denominator;
      result.push({
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
      });
    }
    if (currentInside) result.push(current);
  }
  return result;
}

function groupName(city: CityState, level: AdministrativeLevel): string {
  if (level === "province") return city.province;
  if (level === "commandery") return `${city.province} · ${city.commandery}`;
  return city.id;
}

export function buildAdministrativeCells(cities: CityState[], level: AdministrativeLevel): AdministrativeCell[] {
  const groups = new Map<string, CityState[]>();
  for (const city of cities) {
    const id = groupName(city, level);
    groups.set(id, [...(groups.get(id) ?? []), city]);
  }

  const sites = [...groups.entries()].map(([id, members]) => ({
    id,
    name: level === "city" ? members[0].name : level === "province" ? members[0].province : members[0].commandery,
    members,
    center: {
      x: members.reduce((sum, city) => sum + city.x, 0) / members.length,
      y: members.reduce((sum, city) => sum + city.y, 0) / members.length,
    },
  }));

  return sites.map((site) => {
    let points = BOUNDS.map((point) => ({ ...point }));
    for (const other of sites) {
      if (other.id === site.id) continue;
      points = clipToNearestSite(points, site.center, other.center);
      if (!points.length) break;
    }
    return {
      id: site.id,
      name: site.name,
      level,
      points,
      memberIds: site.members.map((city) => city.id),
      ownerIds: [...new Set(site.members.map((city) => city.owner))],
      center: site.center,
    };
  });
}

export function polygonPath(points: MapPoint[]): string {
  return points.length ? `${points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")} Z` : "";
}

export function countLayoutOverlaps(layout: LabelLayout[]): number {
  let count = 0;
  for (let first = 0; first < layout.length; first += 1) {
    for (let second = first + 1; second < layout.length; second += 1) {
      if (rectangleOverlap(layout[first], layout[second]) > 0) count += 1;
    }
  }
  return count;
}
