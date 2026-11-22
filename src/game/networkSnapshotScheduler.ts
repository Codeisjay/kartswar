export const NETWORK_SNAPSHOT_INTERVAL_MS = 50;

export interface SnapshotSchedulerClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export interface NetworkSnapshotSchedulerOptions<T> {
  getSnapshot(): T | null;
  sendSnapshot(snapshot: T): boolean;
  onAttempt?(now: number): void;
  onSent?(now: number): void;
}

const browserClock: SnapshotSchedulerClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timerId) => window.clearTimeout(timerId),
};

export class NetworkSnapshotScheduler<T> {
  private active = false;
  private connected = false;
  private visible = false;
  private disposed = false;
  private timerId: number | null = null;
  private nextDueAt: number | null = null;

  constructor(
    private readonly options: NetworkSnapshotSchedulerOptions<T>,
    private readonly clock: SnapshotSchedulerClock = browserClock,
  ) {}

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.reconcile();
  }

  setConnected(connected: boolean) {
    if (this.disposed || this.connected === connected) return;
    this.connected = connected;
    this.reconcile();
  }

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.reconcile();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.nextDueAt = null;
  }

  private readonly tick = () => {
    this.timerId = null;
    if (!this.shouldRun()) return;

    try {
      const snapshot = this.options.getSnapshot();
      if (snapshot !== null) {
        this.options.onAttempt?.(this.clock.now());
        if (this.options.sendSnapshot(snapshot)) this.options.onSent?.(this.clock.now());
      }
    } finally {
      this.scheduleAfterTick();
    }
  };

  private reconcile() {
    if (this.shouldRun()) this.schedule();
    else {
      this.clearTimer();
      this.nextDueAt = null;
    }
  }

  private shouldRun() {
    return !this.disposed && this.active && this.connected && this.visible;
  }

  private schedule() {
    if (!this.shouldRun() || this.timerId !== null) return;
    if (this.nextDueAt === null) this.nextDueAt = this.clock.now() + NETWORK_SNAPSHOT_INTERVAL_MS;
    this.timerId = this.clock.setTimeout(
      this.tick,
      Math.max(0, this.nextDueAt - this.clock.now()),
    );
  }

  private scheduleAfterTick() {
    if (!this.shouldRun()) {
      this.nextDueAt = null;
      return;
    }
    const now = this.clock.now();
    const previousDueAt = this.nextDueAt ?? now;
    let nextDueAt = previousDueAt + NETWORK_SNAPSHOT_INTERVAL_MS;
    if (nextDueAt <= now) {
      const missedIntervals = Math.floor((now - nextDueAt) / NETWORK_SNAPSHOT_INTERVAL_MS) + 1;
      nextDueAt += missedIntervals * NETWORK_SNAPSHOT_INTERVAL_MS;
    }
    this.nextDueAt = nextDueAt;
    this.schedule();
  }

  private clearTimer() {
    if (this.timerId === null) return;
    this.clock.clearTimeout(this.timerId);
    this.timerId = null;
  }
}
