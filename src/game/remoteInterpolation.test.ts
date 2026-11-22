import assert from "node:assert/strict";
import { RemoteSnapshotBuffer } from "./remoteInterpolation";
import type { PlayerSnapshot } from "./networkTypes";

function snapshot(sequence: number, x: number, heading = 0): PlayerSnapshot {
  return {
    playerId: "remote-player",
    sequence,
    x,
    y: 0,
    z: 0,
    vx: 10,
    vy: 0,
    vz: 0,
    heading,
    pitch: 0,
    roll: 0,
    boosting: false,
    drifting: false,
    driftLevel: 0,
    grounded: true,
    alive: true,
    hp: 100,
    weapon: null,
    ammo: 0,
    firing: false,
    aimX: 0,
    aimZ: 0,
  };
}

const buffer = new RemoteSnapshotBuffer();
assert.equal(buffer.push(snapshot(1, 0, Math.PI - 0.1), 1_000), true);
assert.equal(buffer.push(snapshot(2, 1, -Math.PI + 0.1), 1_100), true);
assert.equal(buffer.push(snapshot(2, 100), 1_150), false);
assert.equal(buffer.discardedCount, 1);
const beforeBuffer = buffer.sample(900);
assert.ok(beforeBuffer);
assert.equal(beforeBuffer.snapshot.x, 0);
assert.equal(beforeBuffer.extrapolating, false);
const between = buffer.sample(1_050);
assert.ok(between);
assert.equal(between.snapshot.x, 0.5);
assert.ok(Math.abs(Math.abs(between.snapshot.heading) - Math.PI) < 0.001);
assert.equal(between.extrapolating, false);

const capped = buffer.sample(1_400);
assert.ok(capped);
assert.equal(capped.snapshot.x, 2.2);
assert.equal(capped.snapshot.vx, 0);
assert.equal(capped.extrapolating, true);

console.log("remote interpolation tests passed");
