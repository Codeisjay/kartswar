import type { TouchInput } from "./types";

export interface TouchDriveTarget {
  steer: number;
  throttle: number;
}

export function createTouchInput(): TouchInput {
  return { steer: 0, throttle: 1, drift: false, boost: false, fire: false };
}

export function smoothTouchDrive(
  current: Pick<TouchInput, "steer" | "throttle">,
  target: TouchDriveTarget,
  dt: number,
): TouchDriveTarget {
  const safeDt = Math.max(0, Math.min(0.05, dt));
  const approach = (value: number, destination: number, response: number) =>
    destination + (value - destination) * Math.exp(-response * safeDt);
  const steer = approach(current.steer, target.steer, target.steer === 0 ? 11 : 14);
  const throttleResponse = target.throttle === 0 ? 8 : target.throttle < 0 ? 11 : 6;
  const throttle = approach(current.throttle, target.throttle, throttleResponse);

  return {
    steer: Math.abs(steer) < 0.005 ? 0 : steer,
    throttle: Math.abs(throttle) < 0.005 ? 0 : throttle,
  };
}
