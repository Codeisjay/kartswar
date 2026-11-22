import assert from "node:assert/strict";
import { NetworkDiagnostics } from "./networkDiagnostics";

const metrics = new NetworkDiagnostics(0);
metrics.recordSendAttempt(0);
metrics.recordSent(0);
metrics.recordInterpolationBufferResult(true, 5);
metrics.recordInterpolationBufferResult(false, 10);
assert.equal(metrics.recordRemoteSnapshot("remote", 4, 20, 0), true);
assert.equal(metrics.recordRemoteSnapshot("remote", 6, 40, 60), true);
assert.equal(metrics.recordRemoteSnapshot("remote", 6, 1_000, 70), false);
metrics.recordFrame(75);
metrics.recordEventLoopDelay(12, 80);
metrics.recordExtrapolationFrame(85);
metrics.recordRecoveryCorrection(0.5, 90);

const summary = metrics.summarize(100);
assert.equal(summary.sendAttemptsPerSecond, 10);
assert.equal(summary.sentPerSecond, 10);
assert.equal(summary.remoteReceivesPerSecond, 20);
assert.equal(summary.interpolationBufferOffers, 2);
assert.equal(summary.interpolationBufferInserts, 1);
assert.equal(summary.interpolationBufferRejections, 1);
assert.equal(summary.snapshotAgeP95Ms, 40);
assert.equal(summary.snapshotJitterP95Ms, 10);
assert.equal(summary.sequenceGaps, 1);
assert.equal(summary.staleSnapshots, 1);
assert.equal(summary.browserFramesPerSecond, 10);
assert.equal(summary.eventLoopDelayP95Ms, 12);
assert.equal(summary.extrapolationFramesPerSecond, 10);
assert.equal(summary.meanRecoveryCorrection, 0.5);

const expired = metrics.summarize(10_100);
assert.equal(expired.remoteReceivesPerSecond, 0);
assert.equal(expired.interpolationBufferOffers, 0);
assert.equal(expired.sequenceGaps, 0);

console.log("network diagnostics tests passed");
