import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Client } from "@colyseus/sdk";
import WebSocket from "ws";

const secret = process.env.KARTSWAR_REALTIME_AUTH_SECRET;
const legacyUrl = process.env.LEGACY_MULTIPLAYER_URL ?? "http://127.0.0.1:2567";
const realtimeUrl = process.env.REALTIME_URL ?? "ws://127.0.0.1:8787";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = process.env.TEST_ROOM_CODE
  ?? Array.from(randomBytes(5), (byte) => alphabet[byte % alphabet.length]).join("");
const origin = process.env.KARTSWAR_TEST_ORIGIN ?? "http://localhost:3000";

if (!secret || Buffer.byteLength(secret) < 32) {
  throw new Error("Set KARTSWAR_REALTIME_AUTH_SECRET to a random value of at least 32 bytes.");
}

function ticketFor(playerId, resumeToken, name, intent, roomCode = code) {
  const claims = {
    v: 1,
    room: roomCode,
    playerId,
    resumeToken,
    profile: { name, avatar: "🏎️", kartId: 0 },
    mode: "ffa",
    intent,
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: Number(sorted[Math.floor(sorted.length * 0.5)].toFixed(2)),
    p95Ms: Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)].toFixed(2)),
  };
}

async function sampleLegacyRtt() {
  const client = new Client(legacyUrl);
  const options = { code, quick: false, mode: "ffa", profile: { name: "Baseline A", avatar: "🏎️", kartId: 0 } };
  const first = await client.create("kart_room", options);
  const second = await new Client(legacyUrl).join("kart_room", { ...options, profile: { ...options.profile, name: "Baseline B" } });
  first.onMessage("lobby-state", () => {});
  second.onMessage("lobby-state", () => {});
  try {
    const samples = [];
    for (let index = 0; index < 30; index += 1) {
      const start = performance.now();
      await first.request("server-time", {});
      samples.push(performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return stats(samples);
  } finally {
    await Promise.all([first.leave(), second.leave()]);
  }
}

function waitForMessage(socket, predicate, timeoutMs = 10_000, label = "room message") {
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

async function connectCloudflare(player, intent, roomCode = code) {
  const url = new URL(`/room/${roomCode}`, realtimeUrl);
  const socket = new WebSocket(url, { origin });
  const welcome = waitForMessage(socket, (message) => message.t === "welcome" || message.t === "room-error", 10_000, `welcome for ${roomCode}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Cloudflare Worker WebSocket connection failed.")), { once: true });
  });
  const clientTs = Date.now();
  socket.send(JSON.stringify({
    t: "auth",
    ticket: ticketFor(player.playerId, player.resumeToken, player.name, intent, roomCode),
    clientTs,
  }));
  const response = await welcome;
  if (response.t === "room-error") {
    socket.close();
    throw new Error(response.message);
  }
  const receivedAt = Date.now();
  const serverOffset = response.serverTime - (clientTs + receivedAt) / 2;
  return { socket, welcome: response.joined, serverOffset };
}

async function sampleCloudflareRtt(socket) {
  const samples = [];
  for (let index = 0; index < 30; index += 1) {
    const ts = Date.now();
    const pong = waitForMessage(socket, (message) => message.t === "h" && message.clientTs === ts, 10_000, "heartbeat RTT echo");
    socket.send(JSON.stringify({ t: "h", ts }));
    await pong;
    samples.push(Date.now() - ts);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
  }
  return stats(samples);
}

function percentile(samples, ratio) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)].toFixed(2));
}

async function main() {
  const legacyRtt = await sampleLegacyRtt();
  const firstPlayer = { playerId: randomUUID(), resumeToken: randomBytes(24).toString("hex"), name: "Cloud A" };
  const secondPlayer = { playerId: randomUUID(), resumeToken: randomBytes(24).toString("hex"), name: "Cloud B" };
  const first = await connectCloudflare(firstPlayer, "create");
  let second = await connectCloudflare(secondPlayer, "join");
  const firstMapUpdate = waitForMessage(first.socket, (message) => message.t === "l" && message.state.mapId === "city", 5_000, "host map selection");
  const secondMapUpdate = waitForMessage(second.socket, (message) => message.t === "l" && message.state.mapId === "city", 5_000, "guest map update");
  first.socket.send(JSON.stringify({ t: "map", mapId: "city" }));
  await Promise.all([firstMapUpdate, secondMapUpdate]);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const snapshotAges = [];
  const snapshotTimes = [];
  const snapshotSequences = [];
  const snapshotIntervals = [];
  let snapshotWindowActive = false;
  let previousSnapshotTime = null;
  let previousSnapshotSequence = null;
  const snapshotListener = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.t === "s" && message.p === firstPlayer.playerId) {
        snapshotAges.push(Date.now() + first.serverOffset - message.ts);
        const now = performance.now();
        snapshotTimes.push(now);
        if (snapshotWindowActive) {
          if (previousSnapshotTime !== null) snapshotIntervals.push(now - previousSnapshotTime);
          if (previousSnapshotSequence !== null) {
            snapshotSequences.push({ sequence: message.q, previousSequence: previousSnapshotSequence });
          }
          previousSnapshotSequence = message.q;
          previousSnapshotTime = now;
        }
      }
    } catch {
      // Ignore non-JSON test frames.
    }
  };
  second.socket.addEventListener("message", snapshotListener);
  let otherRoomCode = Array.from(randomBytes(5), (byte) => alphabet[byte % alphabet.length]).join("");
  while (otherRoomCode === code) {
    otherRoomCode = Array.from(randomBytes(5), (byte) => alphabet[byte % alphabet.length]).join("");
  }
  const otherRoomPlayer = { playerId: randomUUID(), resumeToken: randomBytes(24).toString("hex"), name: "Other Room" };
  const otherRoom = await connectCloudflare(otherRoomPlayer, "create", otherRoomCode);
  let measuringRtt = false;
  const keepAlive = setInterval(() => {
    const sockets = measuringRtt ? [second.socket, otherRoom.socket] : [first.socket, second.socket, otherRoom.socket];
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "h", ts: Date.now() }));
    }
  }, 10_000);
  try {
    second.socket.send(JSON.stringify({ t: "ready", ready: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const matchStart = waitForMessage(second.socket, (message) => message.t === "m", 10_000, "match start");
    first.socket.send(JSON.stringify({ t: "start" }));
    const match = await matchStart;
    if (match.match.mapId !== "city") throw new Error("The selected map was not included in match start.");
    const playingAt = match.match.startAt;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, playingAt - Date.now()) + 100));

    const moved = waitForMessage(second.socket, (message) => message.t === "s" && message.p === firstPlayer.playerId && message.d.x >= 20, 10_000, "first movement update");
    const state = {
      x: 0, y: 0, z: 0, vx: 10, vy: 0, vz: 0, heading: 0, pitch: 0, roll: 0,
      boosting: false, drifting: false, driftLevel: 0, grounded: true, alive: true,
      hp: 100, weapon: "mg", ammo: 30, firing: false, aimX: 10, aimZ: 10,
    };
    let sequence = Date.now() * 100;
    snapshotAges.length = 0;
    snapshotTimes.length = 0;
    snapshotIntervals.length = 0;
    snapshotSequences.length = 0;
    previousSnapshotTime = null;
    previousSnapshotSequence = null;
    const movementStartedAt = performance.now();
    snapshotWindowActive = true;
    await new Promise((resolve) => {
      let index = 0;
      const movementInterval = setInterval(() => {
        state.x = index;
        state.aimX = index + 10;
        first.socket.send(JSON.stringify({ t: "s", q: ++sequence, d: { ...state } }));
        index += 1;
        if (index >= 60) {
          clearInterval(movementInterval);
          resolve();
        }
      }, 50);
    });
    snapshotWindowActive = false;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const movementElapsedMs = performance.now() - movementStartedAt;
    const movement = await moved;
    if (movement.d.x !== 20) throw new Error(`Unexpected synchronized position: ${movement.d.x}`);
    const firingEvent = waitForMessage(second.socket, (message) => message.t === "s" && message.p === firstPlayer.playerId && message.d.firing === true, 10_000, "weapon firing update");
    state.firing = true;
    state.x = 21;
    first.socket.send(JSON.stringify({ t: "s", q: ++sequence, d: { ...state } }));
    await firingEvent;

    const reverseMovement = waitForMessage(first.socket, (message) => {
      return message.t === "s" && message.p === secondPlayer.playerId && message.d.x === 40;
    }, 10_000, "reverse movement update");
    const reverseState = { ...state, x: 40, aimX: 50 };
    second.socket.send(JSON.stringify({ t: "s", q: Date.now() * 100, d: reverseState }));
    await reverseMovement;

    measuringRtt = true;
    const cloudflareRtt = await sampleCloudflareRtt(first.socket);
    measuringRtt = false;
    second.socket.close(4000, "Smoke test reconnect");
    await new Promise((resolve) => setTimeout(resolve, 200));
    second = await connectCloudflare(secondPlayer, "join");
    if (second.welcome.playerId !== secondPlayer.playerId) throw new Error("Reconnect did not retain the player identity.");
    if (second.welcome.state.mapId !== "city") throw new Error("Reconnect did not restore the selected room map.");
    const resumedSnapshot = second.welcome.initialSnapshots?.players.find((snapshot) => snapshot.playerId === secondPlayer.playerId);
    if (resumedSnapshot?.x !== 40) throw new Error("Reconnect did not restore the player's latest snapshot.");
    const ended = waitForMessage(second.socket, (message) => message.t === "l" && message.state.phase === "ended", 10_000, "match ended state");
    if (first.socket.readyState !== WebSocket.OPEN) throw new Error("Host connection closed before match end.");
    first.socket.send(JSON.stringify({ t: "end", matchId: match.match.matchId }));
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const restarted = waitForMessage(second.socket, (message) => message.t === "m" && message.match.matchId !== match.match.matchId, 10_000, "match restart");
    if (first.socket.readyState !== WebSocket.OPEN) throw new Error("Host connection closed before match restart.");
    first.socket.send(JSON.stringify({ t: "restart", matchId: match.match.matchId }));
    await restarted;
    if (otherRoom.welcome.state.code !== otherRoomCode || otherRoom.welcome.state.players.length !== 1) {
      throw new Error("A second Durable Object room did not remain isolated.");
    }

    console.log(JSON.stringify({
      result: "PASS",
      testMode: "local Wrangler Durable Object + two independent WebSocket clients (not browsers)",
      roomCode: code,
      synchronizedPosition: movement.d.x,
      reverseSynchronizedPosition: 40,
      weaponFiringEventRelayed: true,
      reconnectPlayerIdPreserved: second.welcome.playerId === secondPlayer.playerId,
      selectedMapPersistedOnReconnect: second.welcome.state.mapId === "city",
      reconnectSnapshotRestored: resumedSnapshot.x === 40,
      matchRestarted: true,
      multipleRoomsIsolated: true,
      snapshotMetrics: {
        sentUpdates: 60,
        movementWindowMs: Number(movementElapsedMs.toFixed(2)),
        receivedUpdates: snapshotTimes.length,
        medianAgeMs: percentile(snapshotAges, 0.5),
        p95AgeMs: percentile(snapshotAges, 0.95),
        medianIntervalMs: percentile(snapshotIntervals, 0.5),
        p95IntervalMs: percentile(snapshotIntervals, 0.95),
        maxIntervalMs: snapshotIntervals.length ? Number(Math.max(...snapshotIntervals).toFixed(2)) : null,
        droppedOrDelayedSequenceCount: snapshotSequences.reduce((total, item) => {
          return total + Math.max(0, item.sequence - item.previousSequence - 1);
        }, 0),
        droppedSentUpdateCount: Math.max(0, 60 - snapshotTimes.length),
        measuredHz: snapshotTimes.length > 1
          ? Number(((snapshotTimes.length - 1) * 1_000 / (snapshotTimes[snapshotTimes.length - 1] - snapshotTimes[0])).toFixed(2))
          : null,
      },
      rtt: {
        legacyColyseusWebSocket: legacyRtt,
        cloudflareDurableObjectWebSocket: cloudflareRtt,
      },
    }, null, 2));
  } finally {
    clearInterval(keepAlive);
    second.socket.removeEventListener("message", snapshotListener);
    first.socket.close(1000, "Smoke test complete");
    second.socket.close(1000, "Smoke test complete");
    otherRoom.socket.close(1000, "Smoke test complete");
  }
}

await main();
