import assert from "node:assert/strict";
import { createTouchInput, smoothTouchDrive } from "./touchControls";

const initialInput = createTouchInput();
assert.equal(initialInput.throttle, 1, "mobile inputs automatically accelerate");
assert.equal(initialInput.steer, 0, "mobile inputs drive straight until steering");
assert.equal(initialInput.drift, false, "drift is released by default");

const initial = { steer: 0, throttle: 0 };
const firstStep = smoothTouchDrive(initial, { steer: -1, throttle: 1 }, 1 / 60);
assert.ok(firstStep.steer < 0 && firstStep.steer > -1, "steering ramps smoothly toward the held arrow");
assert.ok(firstStep.throttle > 0 && firstStep.throttle < 1, "acceleration ramps smoothly instead of snapping");

let accelerating = initial;
for (let frame = 0; frame < 60; frame++) {
  accelerating = smoothTouchDrive(accelerating, { steer: 0, throttle: 1 }, 1 / 60);
}
assert.ok(accelerating.throttle > 0.99, "held accelerator reaches full throttle");

const braking = smoothTouchDrive(accelerating, { steer: 0, throttle: -1 }, 1 / 60);
assert.ok(braking.throttle < accelerating.throttle, "brake reduces forward throttle toward reverse");

let releasing = { steer: -1, throttle: 1 };
for (let frame = 0; frame < 60; frame++) {
  releasing = smoothTouchDrive(releasing, initial, 1 / 60);
}
assert.deepEqual(releasing, initial, "released arrows smoothly return to neutral");

console.log("Touch arrow input ramping passed.");
