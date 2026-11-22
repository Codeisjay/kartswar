"use client";

import type { Profile } from "./types";
import { modeFromCode } from "./roster";
import type {
  JoinState,
  LobbyState,
  MatchStart,
  NetworkGameConfig,
  CloudflareSnapshotPipelineStats,
  PlayerSnapshot,
  SnapshotFrame,
} from "./networkTypes";
import type { MultiplayerSession } from "./multiplayerClient";

type RoomMode = "ffa" | "team";
type SnapshotState = Omit<PlayerSnapshot, "playerId" | "sequence">;
type SnapshotKey = keyof SnapshotState;

const RESUME_KEY_PREFIX = "kartwars:cf-resume:";
const SNAPSHOT_KEYS: SnapshotKey[] = [
  "x", "y", "z", "vx", "vy", "vz", "heading", "pitch", "roll", "boosting", "drifting",
  "driftLevel", "grounded", "alive", "hp", "weapon", "ammo", "firing", "aimX", "aimZ",
];
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 25_000;
const KEYFRAME_INTERVAL_MS = 1_000;

function sequenceBase() {
  return Date.now() * 100 + crypto.getRandomValues(new Uint8Array(1))[0] % 100;
}

interface ResumeIdentity {
  playerId: string;
  resumeToken: string;
}

interface WelcomeMessage {
  t: "welcome";
  joined: JoinState;
  serverTime: number;
  clientTs: number | null;
}

interface SnapshotMessage {
  t: "s";
  p: string;
  q: number;
  ts: number;
  d: Partial<SnapshotState>;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function identityFor(code: string): ResumeIdentity {
  const key = `${RESUME_KEY_PREFIX}${code}`;
  try {
    const saved = window.localStorage.getItem(key);
    if (saved) {
      const identity: unknown = JSON.parse(saved);
      if (
        identity && typeof identity === "object"
        && typeof (identity as ResumeIdentity).playerId === "string"
        && typeof (identity as ResumeIdentity).resumeToken === "string"
      ) return identity as ResumeIdentity;
    }
  } catch (error) {
    console.warn("Room re-entry identity could not be read from local storage.", error);
  }
  const identity = { playerId: crypto.randomUUID(), resumeToken: randomToken() };
  try {
    window.localStorage.setItem(key, JSON.stringify(identity));
  } catch (error) {
    console.warn("Room re-entry identity could not be saved to local storage.", error);
  }
  return identity;
}

async function issueTicket(
  code: string,
  mode: RoomMode,
  profile: Profile,
  identity: ResumeIdentity,
  intent: "create" | "join",
): Promise<string> {
  const response = await fetch("/api/multiplayer-ticket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, mode, profile, ...identity, intent }),
    cache: "no-store",
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error
      : `Could not authorize the multiplayer connection (${response.status}).`;
    throw new Error(message);
  }
  if (!result || typeof result !== "object" || !("ticket" in result) || typeof result.ticket !== "string") {
    throw new Error("The multiplayer ticket service returned an invalid response.");
  }
  return result.ticket;
}

function socketUrl(endpoint: string, code: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("NEXT_PUBLIC_REALTIME_URL must be an absolute URL including https://, for example https://your-worker.workers.dev.");
  }
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("NEXT_PUBLIC_REALTIME_URL must use HTTP(S) or WS(S).");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/room/${encodeURIComponent(code)}`;
  return url.toString();
}

export async function createCloudflareRoom(endpoint: string, code: string, profile: Profile, mode: RoomMode) {
  return CloudflareMultiplayerSession.connect(endpoint, code, profile, mode, "create");
}

export async function joinCloudflareRoom(endpoint: string, code: string, profile: Profile) {
  const normalizedCode = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(normalizedCode)) throw new Error("Enter a valid five-character room code.");
  const mode = modeFromCode(normalizedCode) === "team" ? "team" : "ffa";
  return CloudflareMultiplayerSession.connect(endpoint, normalizedCode, profile, mode, "join");
}

function emptySnapshotPipelineStats(): CloudflareSnapshotPipelineStats {
  return {
    sendInvocations: 0,
    stateChangedAttempts: 0,
    observedPositionChanges: 0,
    observedVelocityChanges: 0,
    observedRotationChanges: 0,
    observedGameplayChanges: 0,
    inactiveSkips: 0,
    socketUnavailableSkips: 0,
    backpressureSkips: 0,
    deltaSuppressed: 0,
    serializedMessages: 0,
    serializedCharacters: 0,
    positionChangedMessages: 0,
    velocityChangedMessages: 0,
    rotationChangedMessages: 0,
    gameplayChangedMessages: 0,
    websocketSendCalls: 0,
    websocketMessagesReceived: 0,
    snapshotMessagesReceived: 0,
    malformedSnapshotMessages: 0,
    staleSnapshotMessages: 0,
    incompleteSnapshotMessages: 0,
    acceptedSnapshotMessages: 0,
    snapshotFramesEmitted: 0,
    lastReadyState: -1,
    lastBufferedAmount: 0,
    maxBufferedAmount: 0,
  };
}

function snapshotValueChanged(key: SnapshotKey, previous: SnapshotState[SnapshotKey], current: SnapshotState[SnapshotKey]) {
  if (typeof previous !== "number" || typeof current !== "number") return previous !== current;
  const threshold = key === "aimX" || key === "aimZ" ? 0.1 : key === "hp" || key === "ammo" ? 1 : 0.015;
  return Math.abs(previous - current) >= threshold;
}

export function createSnapshotDelta(
  snapshot: SnapshotState,
  previous: SnapshotState | null,
  keyframe: boolean,
) {
  const delta: Partial<SnapshotState> = keyframe ? { ...snapshot } : {};
  const changedKeys: SnapshotKey[] = [];
  if (previous) {
    for (const key of SNAPSHOT_KEYS) {
      const value = snapshot[key];
      if (snapshotValueChanged(key, previous[key], value)) {
        changedKeys.push(key);
        if (!keyframe) delta[key] = value as never;
      }
    }
  }
  return { delta, changedKeys };
}

class CloudflareMultiplayerSession implements MultiplayerSession {
  private readonly lobbyListeners = new Set<(state: LobbyState) => void>();
  private readonly matchListeners = new Set<(match: MatchStart) => void>();
  private readonly snapshotListeners = new Set<(frame: SnapshotFrame) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private readonly snapshotHistory: SnapshotFrame[] = [];
  private readonly remoteStates = new Map<string, { sequence: number; state: SnapshotState }>();
  private readonly staleSnapshotTimes: number[] = [];
  private readonly identity: ResumeIdentity;
  private lobby: LobbyState | null = null;
  private lastMatch: MatchStart | null = null;
  private playerId = "";
  private serverOffset = 0;
  private connected = false;
  private intentionalLeave = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private heartbeatTimer: number | null = null;
  private lastHeartbeatResponse = 0;
  private socket: WebSocket | null = null;
  private snapshotSequence = sequenceBase();
  private lastSentSnapshot: SnapshotState | null = null;
  private lastObservedSnapshot: SnapshotState | null = null;
  private lastKeyframeAt = 0;
  private readonly networkDebugEnabled = new URLSearchParams(window.location.search).has("netdebug");
  private snapshotPipelineStats = emptySnapshotPipelineStats();

  private constructor(
    private readonly endpoint: string,
    private readonly code: string,
    private readonly profile: Profile,
    private readonly mode: RoomMode,
    private intent: "create" | "join",
  ) {
    this.identity = identityFor(code);
  }

  static async connect(endpoint: string, code: string, profile: Profile, mode: RoomMode, intent: "create" | "join") {
    const session = new CloudflareMultiplayerSession(endpoint, code, profile, mode, intent);
    await session.open();
    return session;
  }

  get state(): LobbyState | null {
    return this.lobby;
  }

  get ownPlayerId(): string {
    return this.playerId;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async initialize(): Promise<LobbyState> {
    if (!this.lobby) throw new Error("The room has not sent its initial state.");
    return this.lobby;
  }

  onLobbyState(listener: (state: LobbyState) => void): () => void {
    this.lobbyListeners.add(listener);
    if (this.lobby) listener(this.lobby);
    return () => this.lobbyListeners.delete(listener);
  }

  onMatchStart(listener: (match: MatchStart) => void): () => void {
    this.matchListeners.add(listener);
    if (this.lastMatch) listener(this.lastMatch);
    return () => this.matchListeners.delete(listener);
  }

  onSnapshots(listener: (frame: SnapshotFrame) => void): () => void {
    this.snapshotListeners.add(listener);
    for (const frame of this.snapshotHistory) listener(frame);
    return () => this.snapshotListeners.delete(listener);
  }

  onRoomError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.connected);
    return () => this.connectionListeners.delete(listener);
  }

  createGameConfig(match: MatchStart): NetworkGameConfig {
    return {
      playerId: this.playerId,
      matchId: match.matchId,
      mapId: match.mapId,
      startAt: match.startAt,
      players: match.players,
      initialSnapshot: this.snapshotHistory.flatMap((frame) => frame.players)
        .find((snapshot) => snapshot.playerId === this.playerId),
      serverNow: () => Date.now() + this.serverOffset,
      canControlMatch: () => this.lobby?.hostPlayerId === this.playerId,
      finishMatch: (matchId) => this.finishMatch(matchId),
      isConnected: () => this.connected,
      onConnectionChange: (listener) => this.onConnectionChange(listener),
      getCloudflareSnapshotPipelineStats: () => this.networkDebugEnabled ? { ...this.snapshotPipelineStats } : null,
      sendSnapshot: (snapshot) => this.sendSnapshot(snapshot),
      getTransportStaleSnapshotCount: () => this.transportStaleSnapshotCount(),
      onSnapshots: (listener) => this.onSnapshots(listener),
      onPlayersChange: (listener) => this.onLobbyState((state) => listener(state.players)),
    };
  }

  setReady(ready: boolean) {
    this.send({ t: "ready", ready });
  }

  requestStart() {
    this.send({ t: "start" });
  }

  requestRestart() {
    if (this.lobby?.matchId) this.send({ t: "restart", matchId: this.lobby.matchId });
  }

  finishMatch(matchId: string) {
    this.send({ t: "end", matchId });
  }

  async leave() {
    this.intentionalLeave = true;
    this.setConnected(false);
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.send({ t: "leave" });
    this.socket?.close(1000, "Leaving room");
    this.socket = null;
  }

  private async open() {
    const ticket = await issueTicket(this.code, this.mode, this.profile, this.identity, this.intent);
    const socket = new WebSocket(socketUrl(this.endpoint, this.code));
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error("Timed out connecting to the Cloudflare room."));
      }, 10_000);
      socket.addEventListener("open", () => {
        const clientTs = Date.now();
        socket.send(JSON.stringify({ t: "auth", ticket, clientTs }));
      }, { once: true });
      socket.addEventListener("message", (event) => {
        if (this.networkDebugEnabled) this.snapshotPipelineStats.websocketMessagesReceived += 1;
        const message = this.parseMessage(event.data);
        if (!message) return;
        if (message.t === "welcome") {
          const welcome = message as unknown as WelcomeMessage;
          window.clearTimeout(timeout);
          settled = true;
          this.intent = "join";
          this.setConnected(true);
          this.reconnecting = false;
          this.reconnectAttempts = 0;
          this.lastHeartbeatResponse = Date.now();
          this.playerId = welcome.joined.playerId;
          const receivedAt = Date.now();
          this.serverOffset = welcome.serverTime
            - (typeof welcome.clientTs === "number" ? (welcome.clientTs + receivedAt) / 2 : receivedAt);
          this.lastSentSnapshot = null;
          this.setLobby(welcome.joined.state);
          if (welcome.joined.matchStart) this.setMatch(welcome.joined.matchStart);
          if (welcome.joined.initialSnapshots) this.setSnapshots(welcome.joined.initialSnapshots);
          this.startHeartbeat();
          resolve();
          return;
        }
        if (message.t === "room-error") {
          const text = typeof message.message === "string" ? message.message : "The room rejected that request.";
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error(text));
          } else this.emitError(text);
          return;
        }
        if (settled) this.handleMessage(message);
      });
      socket.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error("Could not connect to the Cloudflare multiplayer server."));
        }
      }, { once: true });
      socket.addEventListener("close", (event) => {
        window.clearTimeout(timeout);
        if (!settled) {
          settled = true;
          reject(new Error(event.reason || `The room closed the connection (${event.code}).`));
        }
        if (this.socket === socket) this.socket = null;
        this.setConnected(false);
        if (!this.intentionalLeave && this.playerId) this.scheduleReconnect();
      });
    });
  }

  private startHeartbeat() {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      if (Date.now() - this.lastHeartbeatResponse > HEARTBEAT_TIMEOUT_MS) {
        this.socket?.close(4000, "Heartbeat timeout");
        return;
      }
      this.send({ t: "h", ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private scheduleReconnect() {
    if (this.reconnecting || this.intentionalLeave) return;
    this.reconnecting = true;
    this.emitError("Connection interrupted. Reconnecting…");
    const delay = Math.min(8_000, 500 * (2 ** this.reconnectAttempts));
    window.setTimeout(() => {
      if (this.intentionalLeave) return;
      this.reconnectAttempts += 1;
      void this.open().catch((error: unknown) => {
        this.reconnecting = false;
        if (this.reconnectAttempts < 8) this.scheduleReconnect();
        else this.emitError(error instanceof Error ? error.message : "Could not reconnect to the room.");
      });
    }, delay);
  }

  private send(message: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private sendSnapshot(snapshot: SnapshotState) {
    const stats = this.networkDebugEnabled ? this.snapshotPipelineStats : null;
    if (stats) {
      stats.sendInvocations += 1;
      if (this.lastObservedSnapshot) {
        const observedChanges = SNAPSHOT_KEYS.filter((key) => snapshot[key] !== this.lastObservedSnapshot?.[key]);
        if (observedChanges.length) stats.stateChangedAttempts += 1;
        const hasObserved = (keys: SnapshotKey[]) => observedChanges.some((key) => keys.includes(key));
        if (hasObserved(["x", "y", "z"])) stats.observedPositionChanges += 1;
        if (hasObserved(["vx", "vy", "vz"])) stats.observedVelocityChanges += 1;
        if (hasObserved(["heading", "pitch", "roll"])) stats.observedRotationChanges += 1;
        if (hasObserved(["boosting", "drifting", "driftLevel", "grounded", "alive", "hp", "weapon", "ammo", "firing", "aimX", "aimZ"])) {
          stats.observedGameplayChanges += 1;
        }
      }
      this.lastObservedSnapshot = { ...snapshot };
    }
    const socket = this.socket;
    if (stats) {
      stats.lastReadyState = socket?.readyState ?? -1;
      stats.lastBufferedAmount = socket?.bufferedAmount ?? 0;
      stats.maxBufferedAmount = Math.max(stats.maxBufferedAmount, stats.lastBufferedAmount);
    }
    if (!this.connected || this.lobby?.phase !== "playing") {
      if (stats) stats.inactiveSkips += 1;
      return false;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (stats) stats.socketUnavailableSkips += 1;
      return false;
    }
    if (socket.bufferedAmount > 64 * 1024) {
      if (stats) stats.backpressureSkips += 1;
      return false;
    }
    const now = Date.now();
    const keyframe = !this.lastSentSnapshot || now - this.lastKeyframeAt >= KEYFRAME_INTERVAL_MS;
    const { delta, changedKeys } = createSnapshotDelta(snapshot, this.lastSentSnapshot, keyframe);
    if (stats) {
      const hasAny = (keys: SnapshotKey[]) => changedKeys.some((key) => keys.includes(key));
      if (hasAny(["x", "y", "z"])) stats.positionChangedMessages += 1;
      if (hasAny(["vx", "vy", "vz"])) stats.velocityChangedMessages += 1;
      if (hasAny(["heading", "pitch", "roll"])) stats.rotationChangedMessages += 1;
      if (hasAny(["boosting", "drifting", "driftLevel", "grounded", "alive", "hp", "weapon", "ammo", "firing", "aimX", "aimZ"])) {
        stats.gameplayChangedMessages += 1;
      }
    }
    if (Object.keys(delta).length === 0) {
      if (stats) stats.deltaSuppressed += 1;
      return false;
    }
    const payload = JSON.stringify({ t: "s", q: ++this.snapshotSequence, d: delta });
    if (stats) {
      stats.serializedMessages += 1;
      stats.serializedCharacters += payload.length;
    }
    socket.send(payload);
    if (stats) stats.websocketSendCalls += 1;
    this.lastSentSnapshot = { ...snapshot };
    if (keyframe) this.lastKeyframeAt = now;
    return true;
  }

  private parseMessage(data: unknown): Record<string, unknown> | null {
    if (typeof data !== "string") return null;
    try {
      const value: unknown = JSON.parse(data);
      return value && typeof value === "object" ? value as Record<string, unknown> : null;
    } catch (error) {
      console.warn("Ignoring malformed Cloudflare room message.", error);
      return null;
    }
  }

  private handleMessage(message: Record<string, unknown>) {
    switch (message.t) {
      case "l":
        if (message.state && typeof message.state === "object") this.setLobby(message.state as LobbyState);
        break;
      case "m":
        if (message.match && typeof message.match === "object") this.setMatch(message.match as MatchStart);
        break;
      case "s":
        this.receiveSnapshot(message as unknown as SnapshotMessage);
        break;
      case "h":
        this.lastHeartbeatResponse = Date.now();
        if (typeof message.clientTs === "number" && typeof message.ts === "number") {
          const receivedAt = Date.now();
          const measuredOffset = message.ts - (message.clientTs + receivedAt) / 2;
          this.serverOffset = this.serverOffset * 0.8 + measuredOffset * 0.2;
        }
        break;
      case "e":
        this.emitError(typeof message.message === "string" ? message.message : "The room rejected that request.");
        break;
    }
  }

  private receiveSnapshot(message: SnapshotMessage) {
    const stats = this.networkDebugEnabled ? this.snapshotPipelineStats : null;
    if (stats) stats.snapshotMessagesReceived += 1;
    if (
      typeof message.p !== "string"
      || !Number.isSafeInteger(message.q)
      || !Number.isFinite(message.ts)
      || !message.d
      || typeof message.d !== "object"
      || Array.isArray(message.d)
    ) {
      if (stats) stats.malformedSnapshotMessages += 1;
      return;
    }
    const previous = this.remoteStates.get(message.p);
    if (previous && message.q <= previous.sequence) {
      if (stats) stats.staleSnapshotMessages += 1;
      const now = performance.now();
      this.staleSnapshotTimes.push(now);
      while (this.staleSnapshotTimes.length && this.staleSnapshotTimes[0] < now - 10_000) {
        this.staleSnapshotTimes.shift();
      }
      return;
    }
    const state = { ...(previous?.state ?? {}), ...message.d } as SnapshotState;
    if (SNAPSHOT_KEYS.some((key) => state[key] === undefined)) {
      if (stats) stats.incompleteSnapshotMessages += 1;
      return;
    }
    this.remoteStates.set(message.p, { sequence: message.q, state });
    if (stats) {
      stats.acceptedSnapshotMessages += 1;
      stats.snapshotFramesEmitted += 1;
    }
    this.setSnapshots({
      serverTime: message.ts,
      players: [{ ...state, playerId: message.p, sequence: message.q }],
    });
  }

  private setLobby(state: LobbyState) {
    this.lobby = state;
    for (const listener of this.lobbyListeners) listener(state);
  }

  private setMatch(match: MatchStart) {
    if (this.lastMatch?.matchId === match.matchId) return;
    this.lastMatch = match;
    this.snapshotHistory.length = 0;
    this.remoteStates.clear();
    this.staleSnapshotTimes.length = 0;
    this.snapshotSequence = sequenceBase();
    this.lastSentSnapshot = null;
    this.lastObservedSnapshot = null;
    this.lastKeyframeAt = 0;
    if (this.networkDebugEnabled) this.snapshotPipelineStats = emptySnapshotPipelineStats();
    for (const listener of this.matchListeners) listener(match);
  }

  private setSnapshots(frame: SnapshotFrame) {
    for (const snapshot of frame.players) {
      if (snapshot.playerId === this.playerId) continue;
      const current = this.remoteStates.get(snapshot.playerId);
      if (!current || snapshot.sequence > current.sequence) {
        const { playerId: _playerId, sequence, ...state } = snapshot;
        this.remoteStates.set(snapshot.playerId, { sequence, state });
      }
    }
    this.snapshotHistory.push(frame);
    if (this.snapshotHistory.length > 24) this.snapshotHistory.shift();
    for (const listener of this.snapshotListeners) listener(frame);
  }

  private transportStaleSnapshotCount() {
    const cutoff = performance.now() - 10_000;
    while (this.staleSnapshotTimes.length && this.staleSnapshotTimes[0] < cutoff) {
      this.staleSnapshotTimes.shift();
    }
    return this.staleSnapshotTimes.length;
  }

  private emitError(message: string) {
    for (const listener of this.errorListeners) listener(message);
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    for (const listener of this.connectionListeners) listener(connected);
  }
}
