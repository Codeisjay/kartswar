import type { PlayerSnapshot } from "./networkTypes";

export type TimedPlayerSnapshot = PlayerSnapshot & { serverTime: number };

export interface InterpolatedSnapshot {
  snapshot: PlayerSnapshot;
  extrapolating: boolean;
}

const MAX_SNAPSHOTS = 24;
const MAX_EXTRAPOLATION_MS = 120;

function interpolateAngle(from: number, to: number, amount: number) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
}

export class RemoteSnapshotBuffer {
  private readonly snapshots: TimedPlayerSnapshot[] = [];
  private lastSequence = -1;
  discardedCount = 0;

  get depth() {
    return this.snapshots.length;
  }

  get latest() {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  push(snapshot: PlayerSnapshot, serverTime: number) {
    if (!Number.isFinite(serverTime) || snapshot.sequence <= this.lastSequence) {
      this.discardedCount += 1;
      return false;
    }

    this.lastSequence = snapshot.sequence;
    const timedSnapshot = { ...snapshot, serverTime };
    const insertionIndex = this.snapshots.findIndex((sample) => sample.serverTime > serverTime);
    if (insertionIndex === -1) this.snapshots.push(timedSnapshot);
    else this.snapshots.splice(insertionIndex, 0, timedSnapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    return true;
  }

  sample(renderTime: number): InterpolatedSnapshot | null {
    if (this.snapshots.length === 0) return null;
    while (this.snapshots.length > 2 && this.snapshots[1].serverTime <= renderTime) {
      this.snapshots.shift();
    }

    const first = this.snapshots[0];
    if (renderTime <= first.serverTime) {
      return { snapshot: first, extrapolating: false };
    }
    const latest = this.snapshots[this.snapshots.length - 1];
    const nextIndex = this.snapshots.findIndex((sample) => sample.serverTime >= renderTime);
    if (nextIndex > 0) {
      const previous = this.snapshots[nextIndex - 1];
      const next = this.snapshots[nextIndex];
      const amount = Math.max(0, Math.min(
        1,
        (renderTime - previous.serverTime) / Math.max(1, next.serverTime - previous.serverTime),
      ));
      return {
        snapshot: {
          ... (amount < 0.5 ? previous : next),
          x: previous.x + (next.x - previous.x) * amount,
          y: previous.y + (next.y - previous.y) * amount,
          z: previous.z + (next.z - previous.z) * amount,
          vx: previous.vx + (next.vx - previous.vx) * amount,
          vy: previous.vy + (next.vy - previous.vy) * amount,
          vz: previous.vz + (next.vz - previous.vz) * amount,
          heading: interpolateAngle(previous.heading, next.heading, amount),
          pitch: previous.pitch + (next.pitch - previous.pitch) * amount,
          roll: interpolateAngle(previous.roll, next.roll, amount),
        },
        extrapolating: false,
      };
    }

    const staleForMs = Math.max(0, renderTime - latest.serverTime);
    const extrapolationMs = Math.min(MAX_EXTRAPOLATION_MS, staleForMs);
    return {
      snapshot: {
        ...latest,
        x: latest.x + latest.vx * extrapolationMs / 1000,
        y: latest.y + latest.vy * extrapolationMs / 1000,
        z: latest.z + latest.vz * extrapolationMs / 1000,
        vx: staleForMs > MAX_EXTRAPOLATION_MS ? 0 : latest.vx,
        vy: staleForMs > MAX_EXTRAPOLATION_MS ? 0 : latest.vy,
        vz: staleForMs > MAX_EXTRAPOLATION_MS ? 0 : latest.vz,
      },
      extrapolating: staleForMs > 0,
    };
  }
}
