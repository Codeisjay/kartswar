import { getSpawnPoints } from "../../src/game/spawns";
import type { JoinState, LobbyState, MatchStart, NetworkPlayer, PlayerSnapshot, SnapshotFrame } from "../../src/game/networkTypes";

interface Env {
  ROOMS: DurableObjectNamespace;
  KARTSWAR_REALTIME_AUTH_SECRET: string;
  KARTSWAR_ALLOWED_ORIGINS?: string;
  KARTSWAR_NETWORK_DIAGNOSTICS?: string;
}

type RoomMode = "ffa" | "team";
type RoomPhase = "lobby" | "countdown" | "playing" | "ended";
type MapId = "neon" | "city" | "volcano" | "jungle" | "sunbeam" | "alpine";
type SnapshotState = Record<string, number | boolean | string | null>;

const DEFAULT_MAP_ID: MapId = "neon";

function isMapId(value: unknown): value is MapId {
  return value === "neon" || value === "city" || value === "volcano" || value === "jungle" || value === "sunbeam" || value === "alpine";
}

interface TicketClaims {
  v: 1;
  room: string;
  playerId: string;
  resumeToken: string;
  profile: { name: string; avatar: string; kartId: number };
  mode: RoomMode;
  intent: "create" | "join";
  exp: number;
}

interface Member {
  playerId: string;
  resumeToken: string;
  displayName: string;
  avatar: string;
  kartId: number;
  slot: number;
  team: number;
  connected: boolean;
  ready: boolean;
  host: boolean;
  disconnectedAt?: number;
  lastSnapshot?: Snapshot;
}

interface Snapshot {
  sequence: number;
  state: SnapshotState;
}

interface SnapshotRateLimitBucket {
  tokens: number;
  updatedAt: number;
}

interface PersistedRoom {
  code: string;
  mode: RoomMode;
  mapId?: MapId;
  phase: RoomPhase;
  matchId: string | null;
  startAt: number | null;
  hostPlayerId: string;
  members: Member[];
}

interface SocketAttachment {
  playerId: string | null;
  lastSeenAt: number;
  authAt: number;
  lastHeartbeatAt?: number;
  lastControlAt?: number;
  sequence?: number;
  snapshot?: SnapshotState;
}

const CAPACITY = 8;
const COUNTDOWN_MS = 3500;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const SNAPSHOT_RATE_LIMIT_PER_SECOND = 25;
const SNAPSHOT_RATE_LIMIT_BURST = 2;
const SNAPSHOT_KEYS = [
  "x", "y", "z", "vx", "vy", "vz", "heading", "pitch", "roll", "boosting", "drifting",
  "driftLevel", "grounded", "alive", "hp", "weapon", "ammo", "firing", "aimX", "aimZ",
] as const;
const NUMERIC_KEYS = [
  "x", "y", "z", "vx", "vy", "vz", "heading", "pitch", "roll", "driftLevel", "hp", "ammo", "aimX", "aimZ",
] as const;
const BOOLEAN_KEYS = ["boosting", "drifting", "grounded", "alive", "firing"] as const;

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function allowedOrigin(origin: string | null, configuration: string | undefined) {
  if (!origin || !configuration) return false;
  try {
    return new URL(origin).origin === origin
      && configuration.split(",").map((value) => value.trim()).includes(origin);
  } catch {
    return false;
  }
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function validClaims(value: unknown): value is TicketClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<TicketClaims>;
  return claims.v === 1
    && typeof claims.room === "string" && /^[A-Z0-9]{5}$/.test(claims.room)
    && typeof claims.playerId === "string" && /^[0-9a-f-]{36}$/i.test(claims.playerId)
    && typeof claims.resumeToken === "string" && /^[0-9a-f]{48}$/i.test(claims.resumeToken)
    && !!claims.profile && typeof claims.profile.name === "string"
    && typeof claims.profile.avatar === "string"
    && Number.isInteger(claims.profile.kartId) && claims.profile.kartId >= 0 && claims.profile.kartId <= 5
    && (claims.mode === "ffa" || claims.mode === "team")
    && (claims.intent === "create" || claims.intent === "join")
    && typeof claims.exp === "number" && claims.exp >= Math.floor(Date.now() / 1000)
    && claims.exp <= Math.floor(Date.now() / 1000) + 120;
}

async function verifyTicket(ticket: unknown, secret: string): Promise<TicketClaims | null> {
  if (typeof ticket !== "string" || ticket.length > 2048) return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(parts[1]),
      new TextEncoder().encode(parts[0]),
    );
    if (!valid) return null;
    const claims: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    return validClaims(claims) ? claims : null;
  } catch {
    return null;
  }
}

function safeSend(socket: WebSocket, message: unknown) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function cleanName(value: string, members: Iterable<Member>) {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 20) || "Driver";
  const taken = new Set([...members].map((member) => member.displayName.toLocaleLowerCase()));
  if (!taken.has(cleaned.toLocaleLowerCase())) return cleaned;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${cleaned.slice(0, 20 - String(suffix).length - 1)} ${suffix}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function validateDelta(value: unknown): value is Partial<SnapshotState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const delta = value as Record<string, unknown>;
  const keys = Object.keys(delta);
  if (keys.length === 0 || keys.length > SNAPSHOT_KEYS.length || keys.some((key) => !SNAPSHOT_KEYS.includes(key as typeof SNAPSHOT_KEYS[number]))) return false;
  for (const key of NUMERIC_KEYS) {
    if (key in delta && (typeof delta[key] !== "number" || !Number.isFinite(delta[key]))) return false;
  }
  for (const key of BOOLEAN_KEYS) {
    if (key in delta && typeof delta[key] !== "boolean") return false;
  }
  if ("weapon" in delta && delta.weapon !== null && typeof delta.weapon !== "string") return false;
  return true;
}

function completeSnapshot(state: SnapshotState) {
  return SNAPSHOT_KEYS.every((key) => key in state)
    && Math.abs(state.x as number) < 100
    && Math.abs(state.z as number) < 100
    && (state.weapon === null || typeof state.weapon === "string");
}

export function consumeSnapshotRateLimitToken(
  bucket: SnapshotRateLimitBucket | undefined,
  now: number,
) {
  const updatedAt = bucket?.updatedAt ?? now;
  const tokens = Math.min(
    SNAPSHOT_RATE_LIMIT_BURST,
    (bucket?.tokens ?? SNAPSHOT_RATE_LIMIT_BURST)
      + Math.max(0, now - updatedAt) * SNAPSHOT_RATE_LIMIT_PER_SECOND / 1000,
  );
  const allowed = tokens >= 1;
  return {
    allowed,
    bucket: {
      tokens: allowed ? tokens - 1 : tokens,
      updatedAt: Math.max(now, updatedAt),
    },
  };
}

export async function handleWorkerFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const metricsMatch = url.pathname.match(/^\/__debug\/metrics\/([A-Z0-9]{5})$/);
  if (metricsMatch) {
    if (
      request.method !== "GET"
      || env.KARTSWAR_NETWORK_DIAGNOSTICS !== "true"
      || !["localhost", "127.0.0.1"].includes(url.hostname)
    ) return jsonResponse({ error: "Not found." }, 404);
    const id = env.ROOMS.idFromName(metricsMatch[1]);
    return env.ROOMS.get(id).fetch(new Request("https://room.internal/__debug/metrics"));
  }
  if (url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      service: "kartswar-realtime",
      durableObjectBinding: Boolean(env.ROOMS),
      authenticationConfigured: Boolean(
        env.KARTSWAR_REALTIME_AUTH_SECRET
        && env.KARTSWAR_REALTIME_AUTH_SECRET.length >= 32,
      ),
      originAllowlistConfigured: Boolean(env.KARTSWAR_ALLOWED_ORIGINS),
    });
  }
  const match = url.pathname.match(/^\/room\/([A-Z0-9]{5})$/);
  if (!match) return jsonResponse({ error: "Not found." }, 404);
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return jsonResponse({ error: "WebSocket upgrade required." }, 426);
  }
  if (!allowedOrigin(request.headers.get("Origin"), env.KARTSWAR_ALLOWED_ORIGINS)) {
    return jsonResponse({ error: "WebSocket origin is not allowed." }, 403);
  }
  if (!env.KARTSWAR_REALTIME_AUTH_SECRET || env.KARTSWAR_REALTIME_AUTH_SECRET.length < 32) {
    return jsonResponse({ error: "Room authentication is not configured." }, 503);
  }
  const id = env.ROOMS.idFromName(match[1]);
  return env.ROOMS.get(id).fetch(request);
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleWorkerFetch(request, env);
  },
};

export default worker;

export class KartRoom {
  private readonly ready: Promise<void>;
  private code = "";
  private mode: RoomMode = "ffa";
  private mapId: MapId = DEFAULT_MAP_ID;
  private phase: RoomPhase = "lobby";
  private matchId: string | null = null;
  private startAt: number | null = null;
  private hostPlayerId = "";
  private created = false;
  private readonly members = new Map<string, Member>();
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly lastSequence = new Map<string, number>();
  private readonly snapshotRateLimits = new Map<string, SnapshotRateLimitBucket>();
  private readonly snapshotMetricEvents: {
    at: number;
    accepted: boolean;
    validatedDelta: boolean;
    broadcastAttempts: number;
    relayedFrames: number;
    rejected: "sequence" | "rate-limit" | "invalid" | "inactive" | null;
  }[] = [];
  private snapshotMetricsStartedAt = Date.now();

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.ready = state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get<PersistedRoom>("room");
      if (!saved) return;
      this.code = saved.code;
      this.mode = saved.mode;
      this.mapId = isMapId(saved.mapId) ? saved.mapId : DEFAULT_MAP_ID;
      this.phase = saved.phase;
      this.matchId = saved.matchId;
      this.startAt = saved.startAt;
      this.hostPlayerId = saved.hostPlayerId;
      this.created = true;
      for (const member of saved.members) {
        this.members.set(member.playerId, member);
        if (member.lastSnapshot) {
          this.snapshots.set(member.playerId, member.lastSnapshot);
          this.lastSequence.set(member.playerId, member.lastSnapshot.sequence);
        }
      }
      for (const socket of state.getWebSockets()) {
        const attachment = this.attachment(socket);
        const member = attachment?.playerId ? this.members.get(attachment.playerId) : undefined;
        if (member) {
          member.connected = true;
          member.disconnectedAt = undefined;
          if (attachment && attachment.sequence !== undefined && attachment.snapshot) {
            this.lastSequence.set(member.playerId, attachment.sequence);
            this.snapshots.set(member.playerId, { sequence: attachment.sequence, state: attachment.snapshot });
          }
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === "/__debug/metrics") {
      if (this.env.KARTSWAR_NETWORK_DIAGNOSTICS !== "true") return jsonResponse({ error: "Not found." }, 404);
      return jsonResponse(this.networkMetrics());
    }
    const code = url.pathname.split("/").pop() ?? "";
    if (!/^[A-Z0-9]{5}$/.test(code)) return jsonResponse({ error: "Invalid room code." }, 400);
    if (this.code && this.code !== code) return jsonResponse({ error: "Room identity mismatch." }, 409);
    this.code = code;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null, lastSeenAt: Date.now(), authAt: Date.now() } satisfies SocketAttachment);
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
  }

  async webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer) {
    await this.ready;
    const raw = typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);
    if (raw.length > 8_192) {
      socket.close(1009, "Message too large");
      return;
    }
    let message: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid message.");
      message = value as Record<string, unknown>;
    } catch {
      socket.close(1007, "Invalid JSON");
      return;
    }

    const attachment = this.attachment(socket);
    if (!attachment?.playerId) {
      if (message.t !== "auth") {
        socket.close(1008, "Authenticate before joining the room");
        return;
      }
      await this.authenticate(socket, message.ticket, message.clientTs);
      return;
    }

    const player = this.members.get(attachment.playerId);
    if (!player) {
      socket.close(1008, "Room player no longer exists");
      return;
    }
    switch (message.t) {
      case "h":
        if (Date.now() - (attachment.lastHeartbeatAt ?? 0) < 1_000) return;
        attachment.lastHeartbeatAt = Date.now();
        attachment.lastSeenAt = attachment.lastHeartbeatAt;
        socket.serializeAttachment(attachment);
        safeSend(socket, { t: "h", clientTs: message.ts, ts: Date.now() });
        break;
      case "ready":
        if (!this.takeControlSlot(socket, attachment)) return;
        if (this.phase === "lobby" && typeof message.ready === "boolean" && player.ready !== message.ready) {
          player.ready = message.ready;
          await this.persist();
          this.publishLobby();
          await this.scheduleAlarm();
        }
        break;
      case "map":
        if (!this.takeControlSlot(socket, attachment)) return;
        if (player.playerId !== this.hostPlayerId) {
          safeSend(socket, { t: "e", message: "Only the host can choose the room map." });
          return;
        }
        if (this.phase !== "lobby") {
          safeSend(socket, { t: "e", message: "The map can only be changed before the match starts." });
          return;
        }
        if (!isMapId(message.mapId)) {
          safeSend(socket, { t: "e", message: "Choose a valid map." });
          return;
        }
        if (this.mapId !== message.mapId) {
          this.mapId = message.mapId;
          await this.persist();
          this.publishLobby();
        }
        break;
      case "start":
        if (!this.takeControlSlot(socket, attachment)) return;
        if (player.playerId === this.hostPlayerId) await this.beginCountdown(false);
        break;
      case "restart":
        if (!this.takeControlSlot(socket, attachment)) return;
        if (player.playerId === this.hostPlayerId && this.phase === "ended" && message.matchId === this.matchId) {
          await this.beginCountdown(true);
        }
        break;
      case "end":
        if (!this.takeControlSlot(socket, attachment)) return;
        if (player.playerId === this.hostPlayerId && this.phase === "playing" && message.matchId === this.matchId) {
          this.phase = "ended";
          await this.persist();
          this.publishLobby();
        }
        break;
      case "leave":
        await this.leaveRoom(socket, player);
        break;
      case "s":
        this.receiveSnapshot(socket, player, message);
        break;
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    await this.disconnect(socket);
    if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) socket.close(code, reason);
    else socket.close();
    await this.scheduleAlarm();
  }

  async webSocketError(socket: WebSocket) {
    await this.disconnect(socket);
    await this.scheduleAlarm();
  }

  async alarm() {
    await this.ready;
    const now = Date.now();
    for (const socket of this.state.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (!attachment?.playerId && now - (attachment?.authAt ?? now) > 10_000) {
        socket.close(1008, "Authentication timeout");
      } else if (attachment?.playerId && now - attachment.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
        socket.close(4000, "Heartbeat timeout");
      }
    }
    if (this.phase === "countdown" && this.startAt !== null && now >= this.startAt) {
      this.phase = "playing";
      this.snapshotMetricEvents.length = 0;
      this.snapshotMetricsStartedAt = now;
      await this.persist();
      this.publishLobby();
    }
    for (const [playerId, member] of this.members) {
      if (!member.connected && member.disconnectedAt && now - member.disconnectedAt >= 20_000) {
        this.members.delete(playerId);
        this.snapshots.delete(playerId);
        if (this.hostPlayerId === playerId) this.hostPlayerId = "";
      }
    }
    if (!this.hostPlayerId) this.electHost();
    if (this.members.size === 0 && this.state.getWebSockets().length === 0) {
      this.created = false;
      this.phase = "lobby";
      this.matchId = null;
      this.startAt = null;
      await this.state.storage.delete("room");
    } else {
      await this.persist();
    }
    await this.scheduleAlarm();
  }

  private async authenticate(socket: WebSocket, ticket: unknown, clientTs: unknown) {
    const claims = await verifyTicket(ticket, this.env.KARTSWAR_REALTIME_AUTH_SECRET);
    if (!claims || claims.room !== this.code) {
      safeSend(socket, { t: "room-error", message: "Room authorization failed." });
      socket.close(1008, "Invalid room ticket");
      return;
    }
    if (claims.intent === "create") {
      if (this.created || this.members.size > 0) {
        safeSend(socket, { t: "room-error", message: "That room code is already in use." });
        socket.close(1008, "Room already exists");
        return;
      }
      this.created = true;
      this.mode = claims.mode;
    } else if (!this.created) {
      safeSend(socket, { t: "room-error", message: "Room not found. Check the invitation code." });
      socket.close(1008, "Room not found");
      return;
    }
    if (this.created && this.mode !== claims.mode && claims.intent === "join") {
      safeSend(socket, { t: "room-error", message: "The invitation code is not valid for that game mode." });
      socket.close(1008, "Room mode mismatch");
      return;
    }
    if (this.phase === "countdown" || this.phase === "ended") {
      safeSend(socket, { t: "room-error", message: "This match is not accepting players." });
      socket.close(1008, "Room is not accepting players");
      return;
    }
    let member = this.members.get(claims.playerId);
    const isResume = Boolean(member);
    if (member && member.resumeToken !== claims.resumeToken) {
      safeSend(socket, { t: "room-error", message: "Room re-entry token is invalid." });
      socket.close(1008, "Invalid re-entry token");
      return;
    }
    if (member?.connected) {
      for (const previous of this.state.getWebSockets()) {
        const previousAttachment = this.attachment(previous);
        if (previous !== socket && previousAttachment?.playerId === member.playerId) previous.close(4001, "Reconnected from another client");
      }
    }
    if (!member) {
      if (this.members.size >= CAPACITY) {
        safeSend(socket, { t: "room-error", message: "This room is full." });
        socket.close(1008, "Room full");
        return;
      }
      const slot = this.firstAvailableSlot();
      member = {
        playerId: claims.playerId,
        resumeToken: claims.resumeToken,
        displayName: cleanName(claims.profile.name, this.members.values()),
        avatar: claims.profile.avatar,
        kartId: claims.profile.kartId,
        slot,
        team: this.mode === "team" ? slot % 2 : -1,
        connected: true,
        ready: this.members.size === 0 || this.phase === "playing",
        host: false,
      };
      this.members.set(member.playerId, member);
      if (!this.hostPlayerId) this.hostPlayerId = member.playerId;
    }
    member.connected = true;
    member.disconnectedAt = undefined;
    if (isResume) member.ready = true;
    member.host = member.playerId === this.hostPlayerId;
    if (member.lastSnapshot) {
      this.snapshots.set(member.playerId, member.lastSnapshot);
      this.lastSequence.set(member.playerId, member.lastSnapshot.sequence);
    }
    socket.serializeAttachment({ playerId: member.playerId, lastSeenAt: Date.now(), authAt: Date.now() } satisfies SocketAttachment);

    await this.persist();
    const players = [...this.snapshots].map(([playerId, snapshot]) => ({
      ...snapshot.state,
      playerId,
      sequence: snapshot.sequence,
    } as PlayerSnapshot));
    const initialSnapshots: SnapshotFrame = { serverTime: Date.now(), players };
    const joined: JoinState = {
      state: this.lobbyState(),
      playerId: member.playerId,
      resumeToken: member.resumeToken,
      matchStart: this.phase === "playing" ? this.matchStart() : null,
      initialSnapshots: this.phase === "playing" ? initialSnapshots : undefined,
    };
    safeSend(socket, {
      t: "welcome",
      joined,
      serverTime: Date.now(),
      clientTs: typeof clientTs === "number" && Number.isFinite(clientTs) ? clientTs : null,
    });
    this.publishLobby();
    await this.scheduleAlarm();
  }

  private receiveSnapshot(socket: WebSocket, player: Member, message: Record<string, unknown>) {
    const now = Date.now();
    if (this.phase !== "playing") {
      this.recordSnapshotMetric({
        at: now,
        accepted: false,
        validatedDelta: false,
        broadcastAttempts: 0,
        relayedFrames: 0,
        rejected: "inactive",
      });
      return;
    }
    const validatedDelta = validateDelta(message.d);
    if (!validatedDelta || !Number.isSafeInteger(message.q)) {
      this.recordSnapshotMetric({
        at: now,
        accepted: false,
        validatedDelta,
        broadcastAttempts: 0,
        relayedFrames: 0,
        rejected: "invalid",
      });
      return;
    }
    const sequence = message.q as number;
    if (sequence <= (this.lastSequence.get(player.playerId) ?? 0)) {
      this.recordSnapshotMetric({
        at: now,
        accepted: false,
        validatedDelta,
        broadcastAttempts: 0,
        relayedFrames: 0,
        rejected: "sequence",
      });
      return;
    }
    const rateLimit = consumeSnapshotRateLimitToken(
      this.snapshotRateLimits.get(player.playerId),
      now,
    );
    this.snapshotRateLimits.set(player.playerId, rateLimit.bucket);
    if (!rateLimit.allowed) {
      this.recordSnapshotMetric({
        at: now,
        accepted: false,
        validatedDelta,
        broadcastAttempts: 0,
        relayedFrames: 0,
        rejected: "rate-limit",
      });
      return;
    }
    const previous = this.snapshots.get(player.playerId)?.state ?? {};
    const state = { ...previous, ...(message.d as SnapshotState) };
    if (!completeSnapshot(state)) {
      this.recordSnapshotMetric({
        at: now,
        accepted: false,
        validatedDelta,
        broadcastAttempts: 0,
        relayedFrames: 0,
        rejected: "invalid",
      });
      return;
    }
    this.lastSequence.set(player.playerId, sequence);
    const attachment = this.attachment(socket);
    if (attachment) {
      attachment.lastSeenAt = now;
      socket.serializeAttachment(attachment);
    }
    this.snapshots.set(player.playerId, { sequence, state });
    if (attachment) {
      attachment.sequence = sequence;
      attachment.snapshot = state;
      socket.serializeAttachment(attachment);
    }
    const delta = message.d as SnapshotState;
    const broadcastAttempts = this.state.getWebSockets().filter((candidate) => candidate !== socket).length;
    const relayedFrames = this.broadcast({ t: "s", p: player.playerId, q: sequence, ts: now, d: delta }, socket);
    this.recordSnapshotMetric({
      at: now,
      accepted: true,
      validatedDelta,
      broadcastAttempts,
      relayedFrames,
      rejected: null,
    });
  }

  private async beginCountdown(restart: boolean) {
    if (this.phase !== "lobby" && !restart) return;
    const players = [...this.members.values()].filter((member) => member.connected);
    if (players.length < 2 || players.some((member) => !member.ready)) {
      this.sendToPlayer(this.hostPlayerId, { t: "e", message: "At least two connected players must be ready." });
      return;
    }
    this.phase = "countdown";
    this.matchId = crypto.randomUUID();
    this.startAt = Date.now() + COUNTDOWN_MS;
    this.snapshots.clear();
    this.lastSequence.clear();
    for (const member of this.members.values()) member.lastSnapshot = undefined;
    for (const socket of this.state.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (attachment) {
        delete attachment.sequence;
        delete attachment.snapshot;
        socket.serializeAttachment(attachment);
      }
    }
    await this.persist();
    this.broadcast({ t: "m", match: { ...this.matchStart(), restart } });
    this.publishLobby();
    await this.state.storage.setAlarm(this.startAt);
  }

  private matchStart(): MatchStart {
    return {
      matchId: this.matchId ?? "",
      mapId: this.mapId,
      mode: this.mode,
      startAt: this.startAt ?? Date.now(),
      players: [...this.members.values()].filter((member) => member.connected).map((member) => this.publicPlayer(member)),
      lateJoin: this.phase === "playing",
    };
  }

  private lobbyState(): LobbyState {
    return {
      roomId: this.code,
      code: this.code,
      mode: this.mode,
      quick: false,
      phase: this.phase,
      hostPlayerId: this.hostPlayerId,
      players: [...this.members.values()].map((member) => this.publicPlayer(member)),
      matchId: this.matchId,
      mapId: this.mapId,
      startAt: this.startAt,
    };
  }

  private publicPlayer(member: Member): NetworkPlayer {
    return {
      playerId: member.playerId,
      displayName: member.displayName,
      avatar: member.avatar,
      kartId: member.kartId,
      slot: member.slot,
      team: member.team,
      connected: member.connected,
      ready: member.ready,
      host: member.playerId === this.hostPlayerId,
      spawn: getSpawnPoints()[member.slot],
    };
  }

  private publishLobby() {
    this.broadcast({ t: "l", state: this.lobbyState() });
  }

  private broadcast(message: unknown, exclude?: WebSocket) {
    let relayed = 0;
    for (const socket of this.state.getWebSockets()) {
      if (socket !== exclude && safeSend(socket, message)) relayed += 1;
    }
    return relayed;
  }

  private recordSnapshotMetric(event: (typeof this.snapshotMetricEvents)[number]) {
    this.snapshotMetricEvents.push(event);
    const cutoff = event.at - 10_000;
    while (this.snapshotMetricEvents.length && this.snapshotMetricEvents[0].at < cutoff) {
      this.snapshotMetricEvents.shift();
    }
    if (this.snapshotMetricEvents.length > 4_096) this.snapshotMetricEvents.shift();
  }

  private networkMetrics() {
    const now = Date.now();
    const cutoff = now - 10_000;
    while (this.snapshotMetricEvents.length && this.snapshotMetricEvents[0].at < cutoff) {
      this.snapshotMetricEvents.shift();
    }
    const windowMs = Math.max(1, Math.min(10_000, now - this.snapshotMetricsStartedAt));
    const received = this.snapshotMetricEvents.length;
    const validated = this.snapshotMetricEvents.filter((event) => event.validatedDelta).length;
    const accepted = this.snapshotMetricEvents.filter((event) => event.accepted);
    const broadcastAttempts = accepted.reduce((sum, event) => sum + event.broadcastAttempts, 0);
    const relayedFrames = accepted.reduce((sum, event) => sum + event.relayedFrames, 0);
    return {
      windowMs,
      receivedSnapshotMessagesPerSecond: received * 1_000 / windowMs,
      validatedSnapshotDeltasPerSecond: validated * 1_000 / windowMs,
      acceptedSnapshotsPerSecond: accepted.length * 1_000 / windowMs,
      serverBroadcastAttemptsPerSecond: broadcastAttempts * 1_000 / windowMs,
      serverRelayedFramesPerSecond: relayedFrames * 1_000 / windowMs,
      rateLimitedSnapshots: this.snapshotMetricEvents.filter((event) => event.rejected === "rate-limit").length,
      rejectedSequences: this.snapshotMetricEvents.filter((event) => event.rejected === "sequence").length,
      invalidSnapshots: this.snapshotMetricEvents.filter((event) => event.rejected === "invalid").length,
      inactiveSnapshots: this.snapshotMetricEvents.filter((event) => event.rejected === "inactive").length,
    };
  }

  private sendToPlayer(playerId: string, message: unknown) {
    for (const socket of this.state.getWebSockets()) {
      if (this.attachment(socket)?.playerId === playerId) safeSend(socket, message);
    }
  }

  private async disconnect(socket: WebSocket) {
    await this.ready;
    const playerId = this.attachment(socket)?.playerId;
    const member = playerId ? this.members.get(playerId) : undefined;
    if (!member) return;
    const stillConnected = this.state.getWebSockets().some((candidate) => {
      return candidate !== socket && this.attachment(candidate)?.playerId === playerId;
    });
    if (stillConnected) return;
    member.connected = false;
    member.ready = false;
    member.disconnectedAt = Date.now();
    const snapshot = this.snapshots.get(member.playerId);
    if (snapshot) member.lastSnapshot = snapshot;
    if (this.phase === "countdown") {
      this.phase = "lobby";
      this.matchId = null;
      this.startAt = null;
    }
    if (this.hostPlayerId === member.playerId) {
      const next = [...this.members.values()].find((candidate) => candidate.connected);
      this.hostPlayerId = next?.playerId ?? "";
    }
    await this.persist();
    this.publishLobby();
  }

  private async leaveRoom(socket: WebSocket, member: Member) {
    this.members.delete(member.playerId);
    this.snapshots.delete(member.playerId);
    this.lastSequence.delete(member.playerId);
    this.snapshotRateLimits.delete(member.playerId);
    if (this.hostPlayerId === member.playerId) this.electHost();
    if (this.phase === "countdown") {
      this.phase = "lobby";
      this.matchId = null;
      this.startAt = null;
    }
    if (this.members.size === 0) {
      this.created = false;
      this.phase = "lobby";
      this.matchId = null;
      this.startAt = null;
      await this.state.storage.delete("room");
    } else {
      await this.persist();
      this.publishLobby();
    }
    socket.close(1000, "Left room");
    await this.scheduleAlarm();
  }

  private firstAvailableSlot() {
    const slots = new Set([...this.members.values()].map((member) => member.slot));
    for (let slot = 0; slot < CAPACITY; slot += 1) if (!slots.has(slot)) return slot;
    return -1;
  }

  private electHost() {
    const host = [...this.members.values()].find((member) => member.connected);
    this.hostPlayerId = host?.playerId ?? "";
    for (const member of this.members.values()) member.host = member.playerId === this.hostPlayerId;
  }

  private async scheduleAlarm() {
    const deadlines: number[] = [];
    const now = Date.now();
    if (this.phase === "countdown" && this.startAt !== null) deadlines.push(this.startAt);
    for (const member of this.members.values()) {
      if (!member.connected && member.disconnectedAt) deadlines.push(member.disconnectedAt + 20_000);
    }
    for (const socket of this.state.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (attachment?.playerId && now - attachment.lastSeenAt <= HEARTBEAT_TIMEOUT_MS) {
        deadlines.push(attachment.lastSeenAt + HEARTBEAT_TIMEOUT_MS);
      } else if (attachment && !attachment.playerId && now - attachment.authAt <= 10_000) {
        deadlines.push(attachment.authAt + 10_000);
      }
    }
    if (deadlines.length === 0) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(Math.max(now + 1, Math.min(...deadlines)));
  }

  private takeControlSlot(socket: WebSocket, attachment: SocketAttachment) {
    const now = Date.now();
    if (now - (attachment.lastControlAt ?? 0) < 1_000) {
      safeSend(socket, { t: "e", message: "Please wait before sending another room command." });
      return false;
    }
    attachment.lastControlAt = now;
    attachment.lastSeenAt = now;
    socket.serializeAttachment(attachment);
    return true;
  }

  private attachment(socket: WebSocket): SocketAttachment | null {
    const value: unknown = socket.deserializeAttachment();
    return value && typeof value === "object" && "lastSeenAt" in value
      ? value as SocketAttachment
      : null;
  }

  private async persist() {
    const room: PersistedRoom = {
      code: this.code,
      mode: this.mode,
      mapId: this.mapId,
      phase: this.phase,
      matchId: this.matchId,
      startAt: this.startAt,
      hostPlayerId: this.hostPlayerId,
      members: [...this.members.values()],
    };
    await this.state.storage.put("room", room);
  }
}
