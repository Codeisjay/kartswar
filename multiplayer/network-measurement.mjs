import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Client } from "@colyseus/sdk";
import WebSocket from "ws";

const secret = process.env.KARTSWAR_REALTIME_AUTH_SECRET;
const legacyUrl = process.env.LEGACY_MULTIPLAYER_URL ?? "http://127.0.0.1:2567";
const realtimeUrl = process.env.REALTIME_URL ?? "ws://127.0.0.1:8787";
const origin = process.env.KARTSWAR_TEST_ORIGIN ?? "http://localhost:3000";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DURATION_MS = 10_000;
const SNAPSHOT_INTERVAL_MS = 50;

if (!secret || Buffer.byteLength(secret) < 32) {
  throw new Error("Provide a local KARTSWAR_REALTIME_AUTH_SECRET of at least 32 bytes.");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function codeFor() {
  return Array.from(randomBytes(5), (byte) => alphabet[byte % alphabet.length]).join("");
}

function percentile(samples, ratio) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)].toFixed(2));
}

function trafficSummary(client, durationMs) {
  return {
    sendAttemptsPerSecond: Number((client.attempts * 1_000 / durationMs).toFixed(2)),
    wireSendsPerSecond: Number((client.wireSends * 1_000 / durationMs).toFixed(2)),
    rawRelayFramesPerSecond: Number((client.rawRelayFrames * 1_000 / durationMs).toFixed(2)),
    remoteReceivesPerSecond: Number((client.remoteReceives * 1_000 / durationMs).toFixed(2)),
    snapshotAgeP95Ms: percentile(client.ages, 0.95),
    snapshotJitterP95Ms: percentile(client.jitters, 0.95),
    sequenceGaps: client.sequenceGaps,
    staleOrDuplicate: client.stale,
  };
}

class OrderedDelayQueue {
  constructor(oneWayLatencyMs, jitterMs, seed) {
    this.oneWayLatencyMs = oneWayLatencyMs;
    this.jitterMs = jitterMs;
    this.randomState = seed >>> 0;
    this.nextDeliveryAt = 0;
    this.pending = 0;
    this.drainWaiters = [];
  }

  schedule(callback) {
    const now = performance.now();
    const jitter = (this.random() * 2 - 1) * this.jitterMs;
    const deliveryAt = Math.max(now + this.oneWayLatencyMs + jitter, this.nextDeliveryAt);
    this.nextDeliveryAt = deliveryAt;
    this.pending += 1;
    setTimeout(() => {
      try {
        callback();
      } finally {
        this.pending -= 1;
        if (this.pending === 0) {
          for (const resolve of this.drainWaiters.splice(0)) resolve();
        }
      }
    }, Math.max(0, deliveryAt - now));
  }

  drain() {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  random() {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0x1_0000_0000;
  }
}

function makeTrafficClient(id, offset, inboundDelay, outgoingDelay) {
  return {
    id,
    offset,
    inboundDelay,
    outgoingDelay,
    attempts: 0,
    wireSends: 0,
    rawRelayFrames: 0,
    remoteReceives: 0,
    ages: [],
    jitters: [],
    sequenceGaps: 0,
    stale: 0,
    lastByPlayer: new Map(),
  };
}

async function runMovement(clients) {
  const startedAt = performance.now();
  const endAt = startedAt + DURATION_MS;
  const sequences = clients.map(() => 0);
  let nextTick = 1;
  let missedTimerTicks = 0;

  while (startedAt + nextTick * SNAPSHOT_INTERVAL_MS < endAt) {
    const targetAt = startedAt + nextTick * SNAPSHOT_INTERVAL_MS;
    const waitMs = targetAt - performance.now();
    if (waitMs > 0) await wait(waitMs);
    const now = performance.now();
    if (now >= endAt) break;

    clients.forEach((client, index) => {
      const sequence = ++sequences[index];
      client.attempts += 1;
      client.outgoingDelay.schedule(() => {
        client.sendSnapshot(sequence);
        client.wireSends += 1;
      });
    });

    nextTick += 1;
    while (startedAt + nextTick * SNAPSHOT_INTERVAL_MS <= now) {
      nextTick += 1;
      missedTimerTicks += 1;
    }
  }

  return { durationMs: performance.now() - startedAt, missedTimerTicks };
}

function recordRemote(client, playerId, sequence, serverTime) {
  const receivedAt = performance.now();
  const previous = client.lastByPlayer.get(playerId);
  if (previous && sequence <= previous.sequence) {
    client.stale += 1;
    return;
  }
  if (previous) {
    client.sequenceGaps += Math.max(0, sequence - previous.sequence - 1);
    client.jitters.push(Math.abs(receivedAt - previous.receivedAt - SNAPSHOT_INTERVAL_MS));
  }
  client.lastByPlayer.set(playerId, { sequence, receivedAt });
  client.remoteReceives += 1;
  client.ages.push(Math.max(0, Date.now() + client.offset - serverTime));
}

function ticketFor(playerId, resumeToken, name, intent, roomCode) {
  const claims = {
    v: 1,
    room: roomCode,
    playerId,
    resumeToken,
    profile: { name, avatar: "🏎️", kartId: 0 },
    mode: "ffa",
    intent,
    exp: Math.floor(Date.now() / 1_000) + 60,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function waitForSocketMessage(socket, predicate, label, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", listener);
      reject(new Error(`Timed out waiting for ${label}.`));
    }, timeoutMs);
    const listener = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", listener);
      resolve(message);
    };
    socket.addEventListener("message", listener);
  });
}

async function connectCloudflare(roomCode, player, intent) {
  const url = new URL(realtimeUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : url.protocol === "http:" ? "ws:" : url.protocol;
  url.pathname = `/room/${roomCode}`;
  const socket = new WebSocket(url, { origin });
  const welcome = waitForSocketMessage(socket, (message) => message.t === "welcome" || message.t === "room-error", "room welcome");
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Cloudflare WebSocket connection failed.")), { once: true });
  });
  const clientTs = Date.now();
  socket.send(JSON.stringify({
    t: "auth",
    ticket: ticketFor(player.playerId, player.resumeToken, player.name, intent, roomCode),
    clientTs,
  }));
  const response = await welcome;
  if (response.t === "room-error") throw new Error(response.message);
  const receivedAt = Date.now();
  return {
    socket,
    joined: response.joined,
    offset: response.serverTime - (clientTs + receivedAt) / 2,
  };
}

function fullState(x) {
  return {
    x, y: 0, z: 0, vx: 10, vy: 0, vz: 0, heading: 0, pitch: 0, roll: 0,
    boosting: false, drifting: false, driftLevel: 0, grounded: true, alive: true,
    hp: 100, weapon: "mg", ammo: 30, firing: false, aimX: x + 10, aimZ: 10,
  };
}

function installCloudflareReceiver(connection, client, ownPlayerId) {
  connection.socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.t !== "s" || message.p === ownPlayerId) return;
    client.rawRelayFrames += 1;
    client.inboundDelay.schedule(() => recordRemote(client, message.p, message.q, message.ts));
  });
}

async function cloudflareMetrics(roomCode) {
  const url = new URL(realtimeUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = `/__debug/metrics/${roomCode}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Local Worker diagnostic endpoint returned ${response.status}.`);
  return response.json();
}

async function measureCloudflare(rttMs, jitterMs, seed) {
  const roomCode = codeFor();
  const playerA = { playerId: randomUUID(), resumeToken: randomBytes(24).toString("hex"), name: "Measure A" };
  const playerB = { playerId: randomUUID(), resumeToken: randomBytes(24).toString("hex"), name: "Measure B" };
  const a = await connectCloudflare(roomCode, playerA, "create");
  const b = await connectCloudflare(roomCode, playerB, "join");
  const halfRtt = rttMs / 2;
  const trafficA = makeTrafficClient(playerA.playerId, a.offset,
    new OrderedDelayQueue(halfRtt, jitterMs, seed + 1),
    new OrderedDelayQueue(halfRtt, jitterMs, seed + 2));
  const trafficB = makeTrafficClient(playerB.playerId, b.offset,
    new OrderedDelayQueue(halfRtt, jitterMs, seed + 3),
    new OrderedDelayQueue(halfRtt, jitterMs, seed + 4));
  installCloudflareReceiver(a, trafficA, playerA.playerId);
  installCloudflareReceiver(b, trafficB, playerB.playerId);

  try {
    b.socket.send(JSON.stringify({ t: "ready", ready: true }));
    await wait(100);
    const matchMessage = waitForSocketMessage(b.socket, (message) => message.t === "m", "match start");
    a.socket.send(JSON.stringify({ t: "start" }));
    const match = await matchMessage;
    await wait(Math.max(0, match.match.startAt - Date.now()) + 50);

    trafficA.sendSnapshot = (sequence) => {
      if (a.socket.readyState === WebSocket.OPEN) {
        a.socket.send(JSON.stringify({ t: "s", q: sequence, d: fullState(sequence * 0.1) }));
      }
    };
    trafficB.sendSnapshot = (sequence) => {
      if (b.socket.readyState === WebSocket.OPEN) {
        b.socket.send(JSON.stringify({ t: "s", q: sequence, d: fullState(sequence * 0.1) }));
      }
    };
    const eventLoop = monitorEventLoopDelay({ resolution: 10 });
    eventLoop.enable();
    const movement = await runMovement([trafficA, trafficB]);
    const durationMs = movement.durationMs;
    await Promise.all([
      trafficA.outgoingDelay.drain(), trafficB.outgoingDelay.drain(),
      trafficA.inboundDelay.drain(), trafficB.inboundDelay.drain(),
    ]);
    const server = await cloudflareMetrics(roomCode);
    eventLoop.disable();

    return {
      transport: "Cloudflare Durable Objects",
      simulatedBaseRttMs: rttMs,
      simulatedJitterAmplitudeMs: jitterMs,
      sampleWindowMs: Number(durationMs.toFixed(1)),
      missedTimerTicks: movement.missedTimerTicks,
      clientA: trafficSummary(trafficA, durationMs),
      clientB: trafficSummary(trafficB, durationMs),
      server,
      nodeEventLoopDelayP95Ms: Number((eventLoop.percentile(95) / 1e6).toFixed(2)),
    };
  } finally {
    a.socket.close(1000, "Measurement complete");
    b.socket.close(1000, "Measurement complete");
  }
}

function waitForRoomMessage(room, type, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Colyseus ${type}.`)), timeoutMs);
    room.onMessage(type, (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
}

async function connectLegacy(profile, roomCode, create) {
  const client = new Client(legacyUrl);
  const options = { code: roomCode, quick: false, mode: "ffa", profile };
  return create ? client.create("kart_room", options) : client.join("kart_room", options);
}

function installLegacyReceiver(room, client, ownPlayerId) {
  room.onMessage("snapshots", (frame) => {
    for (const snapshot of frame.players) {
      if (snapshot.playerId === ownPlayerId) continue;
      client.rawRelayFrames += 1;
      client.inboundDelay.schedule(() => recordRemote(client, snapshot.playerId, snapshot.sequence, frame.serverTime));
    }
  });
}

async function measureLegacy(rttMs, jitterMs, seed) {
  const roomCode = codeFor();
  const roomA = await connectLegacy({ name: "Measure A", avatar: "🏎️", kartId: 0 }, roomCode, true);
  const roomB = await connectLegacy({ name: "Measure B", avatar: "🏎️", kartId: 0 }, roomCode, false);
  roomA.onMessage("lobby-state", () => {});
  roomB.onMessage("lobby-state", () => {});
  const joinedA = await roomA.request("get-lobby", {});
  const joinedB = await roomB.request("get-lobby", {});
  const serverTime = await roomA.request("server-time", {});
  const offsetA = serverTime.serverTime - Date.now();
  const offsetB = offsetA;
  const halfRtt = rttMs / 2;
  const trafficA = makeTrafficClient(joinedA.playerId, offsetA,
    new OrderedDelayQueue(halfRtt, jitterMs, seed + 5),
    new OrderedDelayQueue(halfRtt, jitterMs, seed + 6));
  const trafficB = makeTrafficClient(joinedB.playerId, offsetB,
    new OrderedDelayQueue(halfRtt, jitterMs, seed + 7),
    new OrderedDelayQueue(halfRtt, jitterMs, seed + 8));
  const matchMessage = waitForRoomMessage(roomB, "match-start");
  roomB.send("ready", { ready: true });
  await wait(100);
  roomA.send("request-start", {});
  const match = await matchMessage;
  await wait(Math.max(0, match.startAt - Date.now()) + 50);
  installLegacyReceiver(roomA, trafficA, joinedA.playerId);
  installLegacyReceiver(roomB, trafficB, joinedB.playerId);

  try {
    trafficA.sendSnapshot = (sequence) => {
      roomA.send("player-state", { sequence, state: fullState(sequence * 0.1) });
    };
    trafficB.sendSnapshot = (sequence) => {
      roomB.send("player-state", { sequence, state: fullState(sequence * 0.1) });
    };
    const eventLoop = monitorEventLoopDelay({ resolution: 10 });
    eventLoop.enable();
    const movement = await runMovement([trafficA, trafficB]);
    const durationMs = movement.durationMs;
    await Promise.all([
      trafficA.outgoingDelay.drain(), trafficB.outgoingDelay.drain(),
      trafficA.inboundDelay.drain(), trafficB.inboundDelay.drain(),
    ]);
    const server = await roomA.request("network-metrics", {});
    eventLoop.disable();

    return {
      transport: "Colyseus Quick Match transport",
      simulatedBaseRttMs: rttMs,
      simulatedJitterAmplitudeMs: jitterMs,
      sampleWindowMs: Number(durationMs.toFixed(1)),
      missedTimerTicks: movement.missedTimerTicks,
      clientA: trafficSummary(trafficA, durationMs),
      clientB: trafficSummary(trafficB, durationMs),
      server,
      nodeEventLoopDelayP95Ms: Number((eventLoop.percentile(95) / 1e6).toFixed(2)),
    };
  } finally {
    await Promise.all([roomA.leave(), roomB.leave()]);
  }
}

const scenarios = [
  { rttMs: 50, jitterMs: 10 },
  { rttMs: 100, jitterMs: 20 },
  { rttMs: 150, jitterMs: 30 },
];
const results = [];
for (let index = 0; index < scenarios.length; index += 1) {
  const scenario = scenarios[index];
  results.push(await measureLegacy(scenario.rttMs, scenario.jitterMs, 100 + index * 10));
  results.push(await measureCloudflare(scenario.rttMs, scenario.jitterMs, 200 + index * 10));
}
console.log(JSON.stringify({
  result: "PASS",
  measurementWindowMs: DURATION_MS,
  latencyModel: "Symmetric base RTT split into one-way delays; per-packet uniform variable jitter, ordering preserved, no packet loss injected.",
  results,
}, null, 2));
