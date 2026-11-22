interface NetworkMetricBucket {
  interval: number;
  sendAttempts: number;
  sent: number;
  received: number;
  interpolationBufferOffers: number;
  interpolationBufferInserts: number;
  interpolationBufferRejections: number;
  stale: number;
  sequenceGaps: number;
  frames: number;
  extrapolationFrames: number;
  correctionDistance: number;
  correctionCount: number;
  snapshotAgeMs: number[];
  snapshotJitterMs: number[];
  eventLoopDelayMs: number[];
}

interface RemoteSequenceState {
  sequence: number;
  receivedAt: number;
}

export interface NetworkDiagnosticSummary {
  windowMs: number;
  sendAttemptsPerSecond: number;
  sentPerSecond: number;
  remoteReceivesPerSecond: number;
  interpolationBufferOffers: number;
  interpolationBufferInserts: number;
  interpolationBufferRejections: number;
  snapshotAgeP95Ms: number;
  snapshotJitterP95Ms: number;
  sequenceGaps: number;
  staleSnapshots: number;
  browserFramesPerSecond: number;
  eventLoopDelayP95Ms: number;
  extrapolationFramesPerSecond: number;
  meanRecoveryCorrection: number;
  recoveryCorrections: number;
}

const WINDOW_MS = 10_000;
const BUCKET_MS = 100;
const EXPECTED_SNAPSHOT_INTERVAL_MS = 50;

function percentile(samples: number[], ratio: number) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

export class NetworkDiagnostics {
  private readonly startedAt: number;
  private readonly buckets = new Map<number, NetworkMetricBucket>();
  private readonly remotes = new Map<string, RemoteSequenceState>();

  constructor(startedAt: number) {
    this.startedAt = startedAt;
  }

  recordSendAttempt(now: number) {
    this.bucket(now).sendAttempts += 1;
  }

  recordSent(now: number) {
    this.bucket(now).sent += 1;
  }

  recordRemoteSnapshot(playerId: string, sequence: number, ageMs: number, now: number) {
    const previous = this.remotes.get(playerId);
    const bucket = this.bucket(now);
    if (previous && sequence <= previous.sequence) {
      bucket.stale += 1;
      return false;
    }

    if (previous) {
      bucket.sequenceGaps += Math.max(0, sequence - previous.sequence - 1);
      const interval = now - previous.receivedAt;
      bucket.snapshotJitterMs.push(Math.abs(interval - EXPECTED_SNAPSHOT_INTERVAL_MS));
    }
    this.remotes.set(playerId, { sequence, receivedAt: now });
    bucket.received += 1;
    bucket.snapshotAgeMs.push(Math.max(0, ageMs));
    return true;
  }

  recordFrame(now: number) {
    this.bucket(now).frames += 1;
  }

  recordInterpolationBufferResult(accepted: boolean, now: number) {
    const bucket = this.bucket(now);
    bucket.interpolationBufferOffers += 1;
    if (accepted) bucket.interpolationBufferInserts += 1;
    else bucket.interpolationBufferRejections += 1;
  }

  recordEventLoopDelay(delayMs: number, now: number) {
    this.bucket(now).eventLoopDelayMs.push(Math.max(0, delayMs));
  }

  recordExtrapolationFrame(now: number) {
    this.bucket(now).extrapolationFrames += 1;
  }

  recordRecoveryCorrection(distance: number, now: number) {
    const bucket = this.bucket(now);
    bucket.correctionDistance += distance;
    bucket.correctionCount += 1;
  }

  summarize(now: number): NetworkDiagnosticSummary {
    const windowMs = Math.max(1, Math.min(WINDOW_MS, now - this.startedAt));
    const cutoffInterval = Math.floor((now - windowMs) / BUCKET_MS);
    for (const interval of this.buckets.keys()) {
      if (interval < cutoffInterval) this.buckets.delete(interval);
    }

    const buckets = [...this.buckets.values()];
    const total = (key: "sendAttempts" | "sent" | "received" | "interpolationBufferOffers" | "interpolationBufferInserts" | "interpolationBufferRejections" | "stale" | "sequenceGaps" | "frames" | "extrapolationFrames" | "correctionDistance" | "correctionCount") => {
      return buckets.reduce((sum, bucket) => sum + bucket[key], 0);
    };
    const ages = buckets.flatMap((bucket) => bucket.snapshotAgeMs);
    const jitters = buckets.flatMap((bucket) => bucket.snapshotJitterMs);
    const eventLoopDelays = buckets.flatMap((bucket) => bucket.eventLoopDelayMs);
    const corrections = total("correctionCount");

    return {
      windowMs,
      sendAttemptsPerSecond: total("sendAttempts") * 1_000 / windowMs,
      sentPerSecond: total("sent") * 1_000 / windowMs,
      remoteReceivesPerSecond: total("received") * 1_000 / windowMs,
      interpolationBufferOffers: total("interpolationBufferOffers"),
      interpolationBufferInserts: total("interpolationBufferInserts"),
      interpolationBufferRejections: total("interpolationBufferRejections"),
      snapshotAgeP95Ms: percentile(ages, 0.95),
      snapshotJitterP95Ms: percentile(jitters, 0.95),
      sequenceGaps: total("sequenceGaps"),
      staleSnapshots: total("stale"),
      browserFramesPerSecond: total("frames") * 1_000 / windowMs,
      eventLoopDelayP95Ms: percentile(eventLoopDelays, 0.95),
      extrapolationFramesPerSecond: total("extrapolationFrames") * 1_000 / windowMs,
      meanRecoveryCorrection: corrections ? total("correctionDistance") / corrections : 0,
      recoveryCorrections: corrections,
    };
  }

  private bucket(now: number) {
    const interval = Math.floor(now / BUCKET_MS);
    let bucket = this.buckets.get(interval);
    if (!bucket) {
      bucket = {
        interval,
        sendAttempts: 0,
        sent: 0,
        received: 0,
        interpolationBufferOffers: 0,
        interpolationBufferInserts: 0,
        interpolationBufferRejections: 0,
        stale: 0,
        sequenceGaps: 0,
        frames: 0,
        extrapolationFrames: 0,
        correctionDistance: 0,
        correctionCount: 0,
        snapshotAgeMs: [],
        snapshotJitterMs: [],
        eventLoopDelayMs: [],
      };
      this.buckets.set(interval, bucket);
    }
    return bucket;
  }
}
