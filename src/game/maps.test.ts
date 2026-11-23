import assert from "node:assert/strict";
import { MAPS, isSupportedMultiplayerMap } from "./maps";
import { auditMap } from "./maps/common";

for (const map of MAPS) {
  assert.equal(isSupportedMultiplayerMap(map.id), true, `${map.id} should be available in multiplayer`);
}

assert.equal(isSupportedMultiplayerMap("neon-city-v1"), true, "legacy Colyseus map ID should remain supported");
assert.equal(isSupportedMultiplayerMap("unknown-map"), false, "unknown maps should be rejected");

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

console.log("All playable and legacy multiplayer map IDs are supported.");
