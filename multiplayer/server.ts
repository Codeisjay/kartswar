import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Room, Server, type Client } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { getSpawnPoints, MAP_ID } from "../src/game/spawns";
import type { LobbyState, MatchStart, NetworkPlayer, PlayerSnapshot, RoomPhase, SnapshotFrame } from "../src/game/networkTypes";
import type { Mode } from "../src/game/types";

interface JoinOptions {
  code?: string;
  quick?: boolean;
  mode?: Mode;
  profile?: {
    name?: string;
    avatar?: string;
    kartId?: number;
  };
  resumeToken?: string;
}

interface Member extends NetworkPlayer {
  resumeToken: string;
  sessionId: string | null;
  lastSequence: number;
  snapshot: Omit<PlayerSnapshot, "sequence" | "playerId"> | null;
}

const ROOM_CAPACITY = 8;
const COUNTDOWN_MS = 3500;
const activeCodes = new Set<string>();

function uniqueName(requested: string | undefined, players: Member[]): string {
  const cleaned = (requested ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 20) || "Driver";
  const taken = new Set(players.map((player) => player.displayName.toLocaleLowerCase()));
  if (!taken.has(cleaned.toLocaleLowerCase())) return cleaned;
  for (let suffix = 2; ; suffix++) {
    const label = `${cleaned.slice(0, 20 - String(suffix).length - 1)} ${suffix}`;
    if (!taken.has(label.toLocaleLowerCase())) return label;
  }
}

function validSnapshot(value: unknown): value is Omit<PlayerSnapshot, "playerId" | "sequence"> {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  const numeric = ["x", "y", "z", "vx", "vy", "vz", "heading", "pitch", "roll", "driftLevel", "hp", "ammo", "aimX", "aimZ"];
  return numeric.every((key) => typeof snapshot[key] === "number" && Number.isFinite(snapshot[key]))
    && ["boosting", "drifting", "grounded", "alive", "firing"].every((key) => typeof snapshot[key] === "boolean")
    && (snapshot.weapon === null || typeof snapshot.weapon === "string")
    && Math.abs(snapshot.x as number) < 100
    && Math.abs(snapshot.z as number) < 100;
}

export class KartRoom extends Room {
  maxClients = ROOM_CAPACITY;
  patchRate = 50;

  private code = "";
  private quick = false;
  private mode: Mode = "ffa";
  private readonly members = new Map<string, Member>();
  private readonly playerBySession = new Map<string, string>();
  private phase: RoomPhase = "lobby";
  private hostPlayerId = "";
  private matchId: string | null = null;
  private startAt: number | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private matchStartBroadcast = false;
  private readonly snapshotMessageTimes: number[] = [];
  private readonly snapshotReceiveTimes: number[] = [];
  private readonly snapshotRelaySamples: { at: number; frames: number }[] = [];
  private readonly rejectedSnapshotTimes: number[] = [];
  private snapshotMetricsStartedAt = performance.now();

  onCreate(options: JoinOptions) {
    const quick = options.quick === true;
    const code = quick ? "" : (options.code ?? "").toUpperCase();
    if (!quick && !/^[A-Z0-9]{5}$/.test(code)) throw new Error("A private room code must be five letters or numbers.");
    if (!quick && activeCodes.has(code)) throw new Error("That room code is already in use.");
    if (!quick) activeCodes.add(code);
    this.code = code;
    this.quick = quick;
    this.mode = options.mode === "team" ? "team" : "ffa";
    void this.setMetadata({ code, quick, mode: this.mode });

    this.onMessage("get-lobby", (client) => this.joinState(client));
    this.onMessage("ready", (client, payload: { ready?: unknown }) => this.setReady(client, payload));
    this.onMessage("request-start", (client) => this.requestStart(client));
    this.onMessage("request-restart", (client, payload: { matchId?: unknown }) => this.requestRestart(client, payload));
    this.onMessage("match-ended", (client, payload: { matchId?: unknown }) => this.endMatch(client, payload));
    this.onMessage("player-state", (client, payload: { sequence?: unknown; state?: unknown }) => this.receivePlayerState(client, payload));
    this.onMessage("server-time", () => ({ serverTime: Date.now() }));
    this.onMessage("network-metrics", () => {
      return process.env.KARTSWAR_NETWORK_DIAGNOSTICS === "true"
        ? { enabled: true, ...this.networkMetrics() }
        : { enabled: false };
    });
    this.setTimestep(() => this.broadcastSnapshots(), 50);
  }

  onAuth(_client: Client, options: JoinOptions): boolean {
    if (this.phase === "countdown" || this.phase === "ended") return false;
    if (this.phase === "playing" && options.resumeToken) {
      const previousPlayer = this.findByResumeToken(options.resumeToken);
      if (previousPlayer?.sessionId === null) return true;
    }
    return this.members.size < ROOM_CAPACITY;
  }

  onJoin(client: Client, options: JoinOptions) {
    let player = options.resumeToken ? this.findByResumeToken(options.resumeToken) : undefined;
    if (player && player.sessionId !== null) player = undefined;
    if (player) {
      for (const [sessionId, mappedPlayerId] of this.playerBySession) {
        if (mappedPlayerId === player.playerId) this.playerBySession.delete(sessionId);
      }
      player.connected = true;
      player.ready = true;
      player.sessionId = client.sessionId;
      if (this.phase !== "playing") {
        player.snapshot = null;
        player.lastSequence = 0;
      }
    } else {
      if (this.phase !== "lobby" && this.phase !== "playing") throw new Error("This match is not accepting players.");
      const slot = this.firstAvailableSlot();
      if (slot < 0) throw new Error("This room is full.");
      const playerId = randomUUID();
      player = {
        playerId,
        displayName: uniqueName(options.profile?.name, [...this.members.values()]),
        avatar: this.validAvatar(options.profile?.avatar),
        kartId: this.validKartId(options.profile?.kartId),
        slot,
        team: this.mode === "team" ? slot % 2 : -1,
        connected: true,
        ready: this.members.size === 0 || this.phase === "playing",
        host: false,
        spawn: getSpawnPoints()[slot],
        resumeToken: randomUUID(),
        sessionId: client.sessionId,
        lastSequence: 0,
        snapshot: null,
      };
      this.members.set(playerId, player);
      this.playerBySession.set(client.sessionId, playerId);
      if (!this.hostPlayerId) this.hostPlayerId = playerId;
      player.host = player.playerId === this.hostPlayerId;
    }

    this.members.set(player.playerId, player);
    this.playerBySession.set(client.sessionId, player.playerId);
    this.publishLobby();
  }

  onDrop(client: Client) {
    const playerId = this.playerBySession.get(client.sessionId);
    const player = playerId ? this.members.get(playerId) : undefined;
    if (!player) return;
    player.connected = false;
    player.sessionId = null;
    if (this.phase === "countdown") this.cancelCountdown();
    this.electHost();
    this.publishLobby();
    void this.allowReconnection(client, 20).catch((error: unknown) => {
      if (error instanceof Error && error.message !== "reconnection timed out") {
        console.error("Player reconnection failed:", error);
      }
    });
  }

  onReconnect(client: Client) {
    const playerId = this.playerBySession.get(client.sessionId);
    const player = playerId ? this.members.get(playerId) : undefined;
    if (!player) return;
    player.connected = true;
    player.sessionId = client.sessionId;
    player.ready = true;
    this.publishLobby();
  }

  onLeave(client: Client) {
    const playerId = this.playerBySession.get(client.sessionId);
    const player = playerId ? this.members.get(playerId) : undefined;
    this.playerBySession.delete(client.sessionId);
    if (!player || player.sessionId !== client.sessionId) return;
    player.connected = false;
    player.sessionId = null;
    player.snapshot = null;
    this.members.delete(player.playerId);
    if (this.members.size === 0) activeCodes.delete(this.code);
    this.electHost();
    this.publishLobby();
  }

  onDispose() {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (!this.quick) activeCodes.delete(this.code);
  }

  private joinState(client: Client) {
    const playerId = this.playerBySession.get(client.sessionId);
    const player = playerId ? this.members.get(playerId) : undefined;
    if (!player) throw new Error("Player identity is not in this room.");
    const matchStart = (this.phase === "countdown" || this.phase === "playing") && this.matchId && this.startAt
      ? {
          matchId: this.matchId,
          mapId: MAP_ID,
          mode: this.mode,
          startAt: this.startAt,
          players: [...this.members.values()].filter((member) => member.connected).map((member) => this.publicPlayer(member)),
          lateJoin: this.phase === "playing",
        } satisfies MatchStart
      : null;
    return {
      state: this.lobbyState(),
      playerId: player.playerId,
      resumeToken: player.resumeToken,
      matchStart,
      initialSnapshots: this.phase === "playing"
        ? {
            serverTime: Date.now(),
            players: [...this.members.values()]
              .filter((member) => member.connected && member.snapshot)
              .map((member) => ({ ...member.snapshot!, playerId: member.playerId, sequence: member.lastSequence })),
          }
        : undefined,
    };
  }

  private setReady(client: Client, payload: { ready?: unknown }) {
    if (this.phase !== "lobby") return;
    const player = this.memberFor(client);
    if (!player || typeof payload.ready !== "boolean") return;
    player.ready = payload.ready;
    this.publishLobby();
  }

  private requestStart(client: Client) {
    if (this.phase !== "lobby" || this.memberFor(client)?.playerId !== this.hostPlayerId) return;
    const connected = [...this.members.values()].filter((player) => player.connected);
    if (connected.length < 2 || connected.some((player) => !player.ready)) {
      client.send("room-error", { message: "At least two connected players must be ready." });
      return;
    }
    this.beginCountdown(false);
  }

  private requestRestart(client: Client, payload: { matchId?: unknown }) {
    if (this.phase !== "ended" || this.memberFor(client)?.playerId !== this.hostPlayerId || payload.matchId !== this.matchId) return;
    this.beginCountdown(true);
  }

  private beginCountdown(restart: boolean) {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    const players = [...this.members.values()].filter((player) => player.connected);
    if (players.length === 0) return;
    this.phase = "countdown";
    this.matchId = randomUUID();
    this.matchStartBroadcast = true;
    this.startAt = Date.now() + COUNTDOWN_MS;
    for (const player of players) player.snapshot = null;
    const matchStart: MatchStart = {
      matchId: this.matchId,
      mapId: MAP_ID,
      mode: this.mode,
      startAt: this.startAt,
      players: players.map((player) => this.publicPlayer(player)),
    };
    this.broadcast("match-start", { ...matchStart, restart });
    this.publishLobby();
    const expectedMatchId = this.matchId;
    this.countdownTimer = setTimeout(() => {
      if (this.phase !== "countdown" || this.matchId !== expectedMatchId || !this.matchStartBroadcast) return;
      this.phase = "playing";
      this.countdownTimer = null;
      this.resetNetworkMetrics();
      this.publishLobby();
    }, COUNTDOWN_MS);
  }

  private cancelCountdown() {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    this.phase = "lobby";
    this.matchId = null;
    this.startAt = null;
    this.matchStartBroadcast = false;
    this.publishLobby();
  }

  private endMatch(client: Client, payload: { matchId?: unknown }) {
    if (this.phase !== "playing" || this.memberFor(client)?.playerId !== this.hostPlayerId || payload.matchId !== this.matchId) return;
    this.phase = "ended";
    this.publishLobby();
  }

  private receivePlayerState(client: Client, payload: { sequence?: unknown; state?: unknown }) {
    const diagnosticsEnabled = process.env.KARTSWAR_NETWORK_DIAGNOSTICS === "true";
    const receivedAt = performance.now();
    if (diagnosticsEnabled) this.snapshotMessageTimes.push(receivedAt);
    const player = this.memberFor(client);
    if (this.phase !== "playing" || !player || !player.connected || typeof payload.sequence !== "number" || !Number.isSafeInteger(payload.sequence) || payload.sequence <= player.lastSequence || !validSnapshot(payload.state)) {
      if (diagnosticsEnabled) this.rejectedSnapshotTimes.push(receivedAt);
      return;
    }
    player.lastSequence = payload.sequence;
    player.snapshot = payload.state;
    if (diagnosticsEnabled) this.snapshotReceiveTimes.push(receivedAt);
  }

  private broadcastSnapshots() {
    if (this.phase !== "playing" || !this.matchId) return;
    const now = performance.now();
    const frame: SnapshotFrame = {
      serverTime: Date.now(),
      players: [...this.members.values()]
        .filter((player) => player.connected && player.snapshot)
        .map((player) => ({ ...player.snapshot!, playerId: player.playerId, sequence: player.lastSequence })),
    };
    if (frame.players.length) {
      this.broadcast("snapshots", frame);
      if (process.env.KARTSWAR_NETWORK_DIAGNOSTICS === "true") {
        const recipients = [...this.members.values()].filter((player) => player.connected).length;
        this.snapshotRelaySamples.push({ at: now, frames: recipients });
        this.pruneNetworkMetrics(now);
      }
    }
  }

  private resetNetworkMetrics() {
    this.snapshotMessageTimes.length = 0;
    this.snapshotReceiveTimes.length = 0;
    this.snapshotRelaySamples.length = 0;
    this.rejectedSnapshotTimes.length = 0;
    this.snapshotMetricsStartedAt = performance.now();
  }

  private pruneNetworkMetrics(now: number) {
    const cutoff = now - 10_000;
    while (this.snapshotMessageTimes.length && this.snapshotMessageTimes[0] < cutoff) this.snapshotMessageTimes.shift();
    while (this.snapshotReceiveTimes.length && this.snapshotReceiveTimes[0] < cutoff) this.snapshotReceiveTimes.shift();
    while (this.snapshotRelaySamples.length && this.snapshotRelaySamples[0].at < cutoff) this.snapshotRelaySamples.shift();
    while (this.rejectedSnapshotTimes.length && this.rejectedSnapshotTimes[0] < cutoff) this.rejectedSnapshotTimes.shift();
  }

  private networkMetrics() {
    const now = performance.now();
    this.pruneNetworkMetrics(now);
    const windowMs = Math.max(1, Math.min(10_000, now - this.snapshotMetricsStartedAt));
    const relayFrames = this.snapshotRelaySamples.reduce((sum, sample) => sum + sample.frames, 0);
    return {
      windowMs,
      receivedSnapshotMessagesPerSecond: this.snapshotMessageTimes.length * 1_000 / windowMs,
      validatedSnapshotMessagesPerSecond: this.snapshotReceiveTimes.length * 1_000 / windowMs,
      acceptedSnapshotsPerSecond: this.snapshotReceiveTimes.length * 1_000 / windowMs,
      serverBroadcastAttemptsPerSecond: relayFrames * 1_000 / windowMs,
      relayTicksPerSecond: this.snapshotRelaySamples.length * 1_000 / windowMs,
      relayedFramesPerSecond: relayFrames * 1_000 / windowMs,
      rejectedSnapshots: this.rejectedSnapshotTimes.length,
    };
  }

  private lobbyState(): LobbyState {
    return {
      roomId: this.roomId,
      code: this.code,
      mode: this.mode,
      quick: this.quick,
      phase: this.phase,
      hostPlayerId: this.hostPlayerId,
      players: [...this.members.values()].map((player) => this.publicPlayer(player)),
      matchId: this.matchId,
      mapId: MAP_ID,
      startAt: this.startAt,
    };
  }

  private publishLobby() {
    this.broadcast("lobby-state", this.lobbyState());
  }

  private publicPlayer(player: Member): NetworkPlayer {
    return {
      playerId: player.playerId,
      displayName: player.displayName,
      avatar: player.avatar,
      kartId: player.kartId,
      slot: player.slot,
      team: player.team,
      connected: player.connected,
      ready: player.ready,
      host: player.playerId === this.hostPlayerId,
      spawn: player.spawn,
    };
  }

  private memberFor(client: Client): Member | undefined {
    const playerId = this.playerBySession.get(client.sessionId);
    return playerId ? this.members.get(playerId) : undefined;
  }

  private findByResumeToken(token: string): Member | undefined {
    return [...this.members.values()].find((player) => player.resumeToken === token);
  }

  private firstAvailableSlot(): number {
    const used = new Set([...this.members.values()].map((player) => player.slot));
    for (let slot = 0; slot < ROOM_CAPACITY; slot++) if (!used.has(slot)) return slot;
    return -1;
  }

  private electHost() {
    const currentHost = this.members.get(this.hostPlayerId);
    if (currentHost?.connected) return;
    const nextHost = [...this.members.values()].find((player) => player.connected);
    this.hostPlayerId = nextHost?.playerId ?? "";
  }

  private validAvatar(value: string | undefined): string {
    return typeof value === "string" && Array.from(value).length <= 4 ? value : "😎";
  }

  private validKartId(value: number | undefined): number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0;
  }
}

const server = new Server({
  transport: new WebSocketTransport({ pingInterval: 10000 }),
  greet: false,
});
server.define("kart_room", KartRoom).filterBy(["code", "quick", "mode"]);

async function main() {
  const port = Number(process.env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  await server.listen(port, "0.0.0.0");
  console.info(`KARTSWAR multiplayer server listening on port ${port}`);
}

void main().catch((error: unknown) => {
  console.error("Could not start the KARTSWAR multiplayer server:", error);
  process.exitCode = 1;
});
