import assert from "node:assert/strict";
import { DriverCharacter } from "./driver";
import { AVATARS } from "./types";

function animate(driver: DriverCharacter, frames: number, acceleration: number, turn = 0, grounded = true, alive = true) {
  for (let frame = 0; frame < frames; frame++) {
    driver.update(1 / 60, frame / 60, acceleration, turn, 0, grounded, 0, 9, alive, null);
  }
}

const drivers = AVATARS.map((avatar) => new DriverCharacter(avatar));
assert.equal(new Set(drivers.map((driver) => driver.group.name)).size, AVATARS.length, "each garage avatar selects a distinct 3D driver");
for (const driver of drivers) {
  assert.ok(driver.group.getObjectByName("driver-head"), "driver has a 3D head");
  assert.ok(driver.group.children.length > 1, "driver has a torso and articulated legs");
}

const accelerating = new DriverCharacter("😎");
animate(accelerating, 60, 28);
assert.ok(accelerating.torsoPivot.rotation.x < -0.09, "acceleration leans the driver backward");
animate(accelerating, 60, -28);
assert.ok(accelerating.torsoPivot.rotation.x > 0.09, "braking leans the driver forward");

const turning = new DriverCharacter("🤖");
animate(turning, 60, 0, -1);
assert.ok(turning.torsoPivot.rotation.z > 0.1, "left steering leans the driver left");
animate(turning, 60, 0, 1);
assert.ok(turning.torsoPivot.rotation.z < -0.1, "right steering leans the driver right");

const airborne = new DriverCharacter("🦊");
airborne.update(1 / 60, 0, 0, 0, 7, false, 0, 9, true, null);
assert.ok(airborne.torsoPivot.position.y > 0.82, "takeoff lifts the driver's posture");
airborne.update(1 / 60, 1 / 60, 0, 0, 0, true, 0, 9, true, null);
assert.ok(airborne.torsoPivot.rotation.x > 0.08, "landing produces an impact reaction");

const hit = new DriverCharacter("🐼");
hit.update(1 / 60, 0, 0, 0, 0, true, 0, 0, true, null);
assert.ok(hit.torsoPivot.rotation.z > 0.1, "damage triggers a flinch");

const firing = new DriverCharacter("👾");
const idleHandY = firing.rightHandPosition.y;
firing.update(1 / 60, 0, 0, 0, 0, true, 1, 9, true, "rocket");
assert.ok(firing.rightHandPosition.y > idleHandY, "weapon kick moves the firing arm");

const defeated = new DriverCharacter("🥷");
animate(defeated, 60, 0, 0, true, false);
assert.ok(defeated.torsoPivot.rotation.x > 0.25, "kart destruction triggers a defeat pose");

console.log("Procedural driver variants and gameplay animation reactions passed.");
