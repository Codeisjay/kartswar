import assert from "node:assert/strict";
import {
  NetworkSnapshotScheduler,
  NETWORK_SNAPSHOT_INTERVAL_MS,
  type SnapshotSchedulerClock,
} from "./networkSnapshotScheduler";

interface Timer {
  id: number;
  dueAt: number;
  callback: () => void;
}

class FakeClock implements SnapshotSchedulerClock {
  currentTime = 0;
  private nextId = 1;
  private readonly timers = new Map<number, Timer>();

  now() {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number) {
    const id = this.nextId++;
    this.timers.set(id, { id, dueAt: this.currentTime + delayMs, callback });
    return id;
  }

  clearTimeout(timerId: number) {
    this.timers.delete(timerId);
  }

  get pendingTimers() {
    return this.timers.size;
  }

  get nextTimerAt() {
    return [...this.timers.values()].sort((left, right) => left.dueAt - right.dueAt)[0]?.dueAt;
  }

  advanceBy(durationMs: number) {
    const endAt = this.currentTime + durationMs;
    while (true) {
      const next = [...this.timers.values()]
        .filter((timer) => timer.dueAt <= endAt)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (!next) break;
      this.currentTime = next.dueAt;
      this.timers.delete(next.id);
      next.callback();
    }
    this.currentTime = endAt;
  }

  delayWithoutRunning(durationMs: number) {
    this.currentTime += durationMs;
  }

  runDueTimers() {
    while (true) {
      const next = [...this.timers.values()]
        .filter((timer) => timer.dueAt <= this.currentTime)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (!next) break;
      this.timers.delete(next.id);
      next.callback();
    }
  }
}

function createScheduler(clock: FakeClock, sent: number[], getValue = () => 1) {
  return new NetworkSnapshotScheduler<number>({
    getSnapshot: getValue,
    sendSnapshot: (snapshot) => {
      sent.push(snapshot);
      return true;
    },
  }, clock);
}

{
  const clock = new FakeClock();
  const sent: number[] = [];
  const scheduler = createScheduler(clock, sent);
  scheduler.setConnected(true);
  scheduler.setVisible(true);
  scheduler.setActive(true);
  clock.advanceBy(1_000);
  assert.equal(sent.length, 1_000 / NETWORK_SNAPSHOT_INTERVAL_MS);
  scheduler.dispose();
}

{
  const clock = new FakeClock();
  const sent: number[] = [];
  const scheduler = createScheduler(clock, sent);
  scheduler.setConnected(true);
  scheduler.setVisible(true);
  scheduler.setActive(true);
  scheduler.setActive(true);
  scheduler.setVisible(true);
  scheduler.setConnected(true);
  assert.equal(clock.pendingTimers, 1);
  clock.advanceBy(100);
  assert.equal(sent.length, 2);
  assert.equal(clock.pendingTimers, 1);
  scheduler.dispose();
}

{
  const clock = new FakeClock();
  const sent: number[] = [];
  let latestValue = 1;
  const scheduler = createScheduler(clock, sent, () => latestValue);
  scheduler.setConnected(true);
  scheduler.setVisible(true);
  scheduler.setActive(true);
  clock.delayWithoutRunning(450);
  latestValue = 9;
  clock.runDueTimers();
  assert.deepEqual(sent, [9]);
  assert.equal(clock.pendingTimers, 1);
  assert.equal(clock.nextTimerAt, 500);
  clock.runDueTimers();
  assert.deepEqual(sent, [9]);
  clock.advanceBy(NETWORK_SNAPSHOT_INTERVAL_MS);
  assert.deepEqual(sent, [9, 9]);
  scheduler.dispose();
}

{
  const clock = new FakeClock();
  const sent: number[] = [];
  const scheduler = createScheduler(clock, sent);
  scheduler.setConnected(true);
  scheduler.setVisible(true);
  scheduler.setActive(true);
  clock.delayWithoutRunning(70);
  clock.runDueTimers();
  assert.equal(sent.length, 1);
  assert.equal(clock.nextTimerAt, 100);
  clock.advanceBy(30);
  assert.equal(sent.length, 2);
  scheduler.dispose();
}

{
  const clock = new FakeClock();
  const sent: number[] = [];
  const scheduler = createScheduler(clock, sent);
  scheduler.setConnected(true);
  scheduler.setActive(true);
  clock.advanceBy(500);
  assert.equal(sent.length, 0);
  scheduler.setVisible(true);
  clock.advanceBy(NETWORK_SNAPSHOT_INTERVAL_MS);
  assert.equal(sent.length, 1);
  scheduler.setVisible(false);
  assert.equal(clock.pendingTimers, 0);
  clock.advanceBy(500);
  assert.equal(sent.length, 1);
  scheduler.setVisible(true);
  clock.advanceBy(NETWORK_SNAPSHOT_INTERVAL_MS);
  assert.equal(sent.length, 2);
  scheduler.dispose();
}

{
  const clock = new FakeClock();
  const sent: number[] = [];
  const scheduler = createScheduler(clock, sent);
  scheduler.setConnected(true);
  scheduler.setVisible(true);
  clock.advanceBy(500);
  assert.equal(sent.length, 0);
  scheduler.setActive(true);
  clock.advanceBy(NETWORK_SNAPSHOT_INTERVAL_MS);
  assert.equal(sent.length, 1);
  scheduler.setActive(false);
  assert.equal(clock.pendingTimers, 0);
  clock.advanceBy(500);
  assert.equal(sent.length, 1);
  scheduler.setActive(true);
  clock.advanceBy(NETWORK_SNAPSHOT_INTERVAL_MS);
  assert.equal(sent.length, 2);
  scheduler.dispose();
}

{
  const clock = new FakeClock();
  const sent: number[] = [];
  const scheduler = createScheduler(clock, sent);
  scheduler.setConnected(true);
  scheduler.setVisible(true);
  scheduler.setActive(true);
  clock.advanceBy(NETWORK_SNAPSHOT_INTERVAL_MS);
  scheduler.setConnected(false);
  assert.equal(clock.pendingTimers, 0);
  clock.advanceBy(500);
  assert.equal(sent.length, 1);
  scheduler.setConnected(true);
  clock.advanceBy(NETWORK_SNAPSHOT_INTERVAL_MS);
  assert.equal(sent.length, 2);
  scheduler.dispose();
}

{
  const clock = new FakeClock();
  const sent: number[] = [];
  const scheduler = createScheduler(clock, sent);
  scheduler.setConnected(true);
  scheduler.setVisible(true);
  scheduler.setActive(true);
  scheduler.dispose();
  scheduler.dispose();
  assert.equal(clock.pendingTimers, 0);
  clock.advanceBy(500);
  assert.equal(sent.length, 0);
}

console.log("network snapshot scheduler tests passed");
