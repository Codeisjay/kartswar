import assert from "node:assert/strict";
import { createSnapshotDelta } from "./cloudflareMultiplayerClient";
import type { PlayerSnapshot } from "./networkTypes";

type SnapshotState = Omit<PlayerSnapshot, "playerId" | "sequence">;

const baseline: SnapshotState = {
  x: 1,
  y: 2,
  z: 3,
  vx: 4,
  vy: 5,
  vz: 6,
  heading: 0.5,
  pitch: 0,
  roll: 0,
  boosting: false,
  drifting: false,
  driftLevel: 0,
  grounded: true,
  alive: true,
  hp: 100,
  weapon: "mg",
  ammo: 30,
  firing: false,
  aimX: 10,
  aimZ: 20,
};

const unchanged = createSnapshotDelta(baseline, baseline, false);
assert.deepEqual(unchanged.delta, {});
assert.deepEqual(unchanged.changedKeys, []);

const subThreshold = createSnapshotDelta({ ...baseline, x: baseline.x + 0.01 }, baseline, false);
assert.deepEqual(subThreshold.delta, {});
assert.deepEqual(subThreshold.changedKeys, []);

const moved = createSnapshotDelta({
  ...baseline,
  x: baseline.x + 1,
  vx: baseline.vx + 1,
  heading: baseline.heading + 0.1,
  firing: true,
}, baseline, false);
assert.deepEqual(moved.delta, {
  x: baseline.x + 1,
  vx: baseline.vx + 1,
  heading: baseline.heading + 0.1,
  firing: true,
});
assert.deepEqual(moved.changedKeys, ["x", "vx", "heading", "firing"]);
assert.equal(baseline.x, 1);
assert.equal(baseline.firing, false);

const keyframe = createSnapshotDelta(baseline, baseline, true);
assert.deepEqual(keyframe.delta, baseline);

console.log("Cloudflare snapshot delta tests passed");
