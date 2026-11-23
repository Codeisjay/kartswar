import assert from "node:assert/strict";
import { MAPS, isSupportedMultiplayerMap } from "./maps";

for (const map of MAPS) {
  assert.equal(isSupportedMultiplayerMap(map.id), true, `${map.id} should be available in multiplayer`);
}

assert.equal(isSupportedMultiplayerMap("neon-city-v1"), true, "legacy Colyseus map ID should remain supported");
assert.equal(isSupportedMultiplayerMap("unknown-map"), false, "unknown maps should be rejected");

console.log("All playable and legacy multiplayer map IDs are supported.");
