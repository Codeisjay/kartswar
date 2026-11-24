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

const signatureFeatures: Record<string, string> = {
  "😎": "driver-human-sunglasses-1",
  "🤖": "driver-robot-antenna",
  "👽": "driver-alien-antenna-tip-1",
  "🦊": "driver-fox-ear-1",
  "🐲": "driver-dragon-center-horn",
  "🦄": "driver-unicorn-horn",
  "💀": "driver-skeleton-jaw",
  "🐼": "driver-panda-ear-1",
  "🔥": "driver-fire-tip-0",
  "👾": "driver-bug-antenna-tip-1",
  "🐸": "driver-frog-eye-stalk-1",
  "🥷": "driver-ninja-headband-tail-1",
};
for (let index = 0; index < AVATARS.length; index++) {
  assert.ok(drivers[index].group.getObjectByName(signatureFeatures[AVATARS[index]]), `${AVATARS[index]} has its own signature 3D feature`);
  const driver = drivers[index];
  for (const side of [-1, 1]) {
    const eye = driver.group.getObjectByName(`driver-eye-${side}`);
    assert.ok(eye, `${AVATARS[index]} has a visible eye on each side`);
    assert.ok(eye.position.z > 0.18, `${AVATARS[index]} eyes sit in front of the face geometry`);
    driver.update(1 / 60, 0.09, 0, 0, 0, true, 0, 9, true, null);
    assert.ok(eye.scale.y > eye.userData.baseY * 0.7, `${AVATARS[index]} blink animation keeps the eyes visible`);
  }
}

const humanHead = drivers[AVATARS.indexOf("😎")].group.getObjectByName("driver-head");
const alienHead = drivers[AVATARS.indexOf("👽")].group.getObjectByName("driver-head");
assert.ok(humanHead && alienHead && alienHead.scale.y > humanHead.scale.y * 1.3, "the alien has a visibly oversized head");

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

const fireDriver = new DriverCharacter("🔥");
const flameTip = fireDriver.group.getObjectByName("driver-fire-tip-0");
assert.ok(flameTip, "fire driver has animated flame geometry");
fireDriver.update(1 / 60, 0, 0, 0, 0, true, 0, 9, true, null);
const flameScale = flameTip.scale.y;
fireDriver.update(1 / 60, 0.05, 0, 0, 0, true, 0, 9, true, null);
assert.notEqual(flameTip.scale.y, flameScale, "fire tips flicker over time");

const ninjaDriver = new DriverCharacter("🥷");
const scarfTail = ninjaDriver.group.getObjectByName("driver-ninja-headband-tail-1");
assert.ok(scarfTail, "ninja has animated headband tails");
ninjaDriver.update(1 / 60, 0, 0, 0, 0, true, 0, 9, true, null);
const scarfAngle = scarfTail.rotation.z;
ninjaDriver.update(1 / 60, 0.2, 0, 0, 0, true, 0, 9, true, null);
assert.notEqual(scarfTail.rotation.z, scarfAngle, "ninja scarf reacts with a flowing motion");

console.log("Procedural driver variants and gameplay animation reactions passed.");
