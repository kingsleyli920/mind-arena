import assert from "node:assert/strict";
import test from "node:test";

import { findDuplicateModelIds, countExternalControllers } from "../lib/game/controller-assignment.ts";
import {
  buildAdministrativeCells,
  buildRenderedRoads,
  countLayoutOverlaps,
  isCityVisible,
  layoutCityLabels,
  smoothRoadPath,
} from "../lib/game/map-rendering.ts";
import { FACTIONS, ROUTES, createStrategyGame } from "../lib/game/strategy.ts";

test("contracts hidden road nodes into connected zoom-level corridors", () => {
  const state = createStrategyGame("cao", "map-road-test");
  const expected = new Map([[1, { cities: 21, roads: 33 }], [2, { cities: 59, roads: 71 }], [3, { cities: 69, roads: 82 }]]);

  for (const zoom of [1, 2, 3]) {
    const visible = state.cities.filter((city) => isCityVisible(city, zoom));
    const visibleIds = new Set(visible.map((city) => city.id));
    const roads = buildRenderedRoads(state.cities, ROUTES, zoom);
    const coveredIds = new Set(roads.flatMap((road) => [road.fromId, road.toId]));

    assert.equal(visible.length, expected.get(zoom).cities);
    assert.equal(roads.length, expected.get(zoom).roads);
    assert.ok(roads.every((road) => visibleIds.has(road.fromId) && visibleIds.has(road.toId)));
    assert.ok(roads.every((road) => road.points.length >= 2 && smoothRoadPath(road).startsWith("M ")));
    assert.deepEqual([...visibleIds].filter((id) => !coveredIds.has(id)), []);
  }
});

test("lays out every visible label without geometry-level collisions", () => {
  const state = createStrategyGame("cao", "map-label-test");
  for (const zoom of [1, 2, 3]) {
    const visibleCount = state.cities.filter((city) => isCityVisible(city, zoom)).length;
    const layout = layoutCityLabels(state.cities, zoom);
    assert.equal(layout.length, visibleCount);
    assert.equal(countLayoutOverlaps(layout), 0);
  }
});

test("creates finite province, commandery and city control cells", () => {
  const state = createStrategyGame("cao", "map-cell-test");
  const expected = { province: 14, commandery: 51, city: 69 };
  for (const level of Object.keys(expected)) {
    const cells = buildAdministrativeCells(state.cities, level);
    assert.equal(cells.length, expected[level]);
    assert.ok(cells.every((cell) => cell.points.length >= 3));
    assert.ok(cells.every((cell) => cell.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))));
  }
});

test("allows all factions but rejects duplicate external model assignments", () => {
  const controllers = Object.fromEntries(FACTIONS.map((faction) => [faction.id, "local"]));
  assert.equal(Object.keys(controllers).length, 18);
  controllers.yuan = "openai/gpt-5";
  controllers.liu = "OPENAI/GPT-5";
  controllers.sun = "anthropic/claude-sonnet-4";

  assert.deepEqual([...findDuplicateModelIds(controllers)], ["openai/gpt-5"]);
  assert.equal(countExternalControllers(controllers), 3);
  assert.deepEqual([...findDuplicateModelIds(controllers, ["yuan"])], []);
  assert.equal(countExternalControllers(controllers, ["yuan"]), 2);
});
