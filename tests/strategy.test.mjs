import assert from "node:assert/strict";
import test from "node:test";

import {
  FACTIONS,
  ROUTES,
  actionKey,
  applyStrategyAction,
  chooseLocalAction,
  createStrategyGame,
  getLegalActions,
  getOwnedCities,
  resolveStrategyRound,
} from "../lib/game/strategy.ts";
import { HISTORICAL_PLACES } from "../lib/game/historical-map.ts";

test("creates a deterministic 194 warlord opening", () => {
  const first = createStrategyGame("cao", "test-seed");
  const second = createStrategyGame("cao", "test-seed");

  assert.deepEqual(first, second);
  assert.equal(first.cities.length, 69);
  assert.equal(first.factions.length, 18);
  assert.equal(ROUTES.length, 82);
  assert.equal(HISTORICAL_PLACES.length, 116);
  assert.equal(new Set(HISTORICAL_PLACES.map((place) => place.id)).size, HISTORICAL_PLACES.length);
  assert.equal(HISTORICAL_PLACES.filter((place) => place.operational).length, first.cities.length);
  assert.equal(first.year, 194);
  assert.equal(getOwnedCities(first, "cao").length, 4);
  assert.ok(first.cities.some((city) => city.name === "长安"));
  assert.ok(first.cities.some((city) => city.name === "成都"));
  assert.ok(first.cities.some((city) => city.kind === "gate"));
  assert.ok(first.cities.some((city) => city.kind === "port"));
  assert.ok(first.cities.some((city) => city.kind === "crossing"));
  assert.ok(HISTORICAL_PLACES.some((place) => place.kind === "village"));
  assert.ok(HISTORICAL_PLACES.some((place) => place.kind === "stronghold"));
  assert.ok(getLegalActions(first, "cao").some((action) => action.type === "recruit"));
});

test("applies only legal actions and changes resources", () => {
  const opening = createStrategyGame("cao", "resource-seed");
  const factionBefore = opening.factions.find((faction) => faction.id === "cao");
  const sourceBefore = opening.cities.find((city) => city.id === "chenliu");
  const recruit = getLegalActions(opening, "cao").find((action) => action.type === "recruit" && action.sourceId === "chenliu");
  assert.ok(recruit);

  const next = applyStrategyAction(opening, "cao", recruit, "player");
  const factionAfter = next.factions.find((faction) => faction.id === "cao");
  const sourceAfter = next.cities.find((city) => city.id === "chenliu");
  assert.equal(factionBefore.grain - factionAfter.grain, 24);
  assert.equal(factionBefore.gold - factionAfter.gold, 12);
  assert.equal(sourceBefore.publicOrder - sourceAfter.publicOrder, 8);
  assert.ok(next.log.at(-1).message.includes("征募新军"));

  const illegal = applyStrategyAction(next, "cao", { type: "march", sourceId: "chenliu", targetId: "moling" }, "player");
  assert.equal(illegal, next);
});

test("simultaneous local orders advance a full match to a terminal result", () => {
  let state = createStrategyGame("cao", "full-match-seed");
  let safety = 0;

  while (state.status === "playing" && safety < 20) {
    const orders = [];
    for (const faction of FACTIONS) {
      if (!getOwnedCities(state, faction.id).length || state.status !== "playing") continue;
      const action = chooseLocalAction(state, faction.id);
      if (action) {
        assert.ok(getLegalActions(state, faction.id).some((legal) => actionKey(legal) === actionKey(action)));
        orders.push({ factionId: faction.id, action, source: "local-ai" });
      }
    }
    state = resolveStrategyRound(state, orders);
    safety += 1;
  }

  assert.notEqual(state.status, "playing");
  assert.ok(state.winnerFactionId);
  assert.equal(state.turn, state.maxTurns);
  assert.ok(state.log.length > 20);
  assert.equal(new Set(state.log.map((entry) => entry.id)).size, state.log.length);
  assert.ok(state.log.every((entry, index, log) => index === 0 || entry.id > log[index - 1].id));
});
