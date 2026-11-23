import assert from "node:assert/strict";
import { MAPS, isSupportedMultiplayerMap } from "./maps";
import { ALPINE_ISLANDS, ALPINE_LAKES, alpineTerrainHeight } from "./maps/alpine";
import { auditMap } from "./maps/common";

for (const map of MAPS) {
  assert.equal(isSupportedMultiplayerMap(map.id), true, `${map.id} should be available in multiplayer`);
}

assert.equal(isSupportedMultiplayerMap("neon-city-v1"), true, "legacy Colyseus map ID should remain supported");
assert.equal(isSupportedMultiplayerMap("unknown-map"), false, "unknown maps should be rejected");
assert.ok(alpineTerrainHeight(0, 0) < -4, "The lake should occupy the middle of the grassy plain");
assert.equal(alpineTerrainHeight(36, 0), 0, "The spawn ring should remain level and outside the lake");
assert.ok(alpineTerrainHeight(-58, -54) > 9, "Natural plateau ramps should rise around the open plain");
assert.ok(alpineTerrainHeight(0, 57) > 5, "A natural jump hill should be accessible from the meadow");
assert.equal(ALPINE_LAKES.length, 1, "The combat arena should have one large lake");
assert.ok(alpineTerrainHeight(ALPINE_ISLANDS[0].x, ALPINE_ISLANDS[0].z) > 1.2, "The lake island should remain above the drowning threshold");
const alpineDefinition = MAPS.find((map) => map.id === "alpine");
assert.ok(alpineDefinition, "The Alpine combat map should be selectable");
assert.doesNotMatch(
  `${alpineDefinition.name} ${alpineDefinition.tagline} ${alpineDefinition.desc} ${alpineDefinition.traits.join(" ")}`,
  /\b(race|track|road|circuit|checkpoint)\b/i,
  "The Alpine map description should not present it as a racing map",
);

const edgeRampIssues = auditMap({
  name: "edge-ramp-test",
  hx: 20,
  hz: 20,
  surfaces: [{ x0: 12, x1: 18, z0: -2, z1: 2, h: 2, dir: 1 }],
  circles: [],
  spawns: [],
  zones: [],
});
assert.ok(edgeRampIssues.some((issue) => issue.includes("ramp too close to arena edge")), "ramps near map boundaries should fail validation");

console.log("Playable multiplayer maps and Alpine combat terrain are valid.");
