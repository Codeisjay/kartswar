"use client";

import { Client, type Room } from "@colyseus/sdk";
import { modeFromCode, randomCode } from "./roster";
import type { Profile } from "./types";
import type {
  JoinState,
  LobbyState,
  MatchStart,
  NetworkGameConfig,
  NetworkPlayer,
  PlayerSnapshot,
  SnapshotFrame,
  SnapshotServerMetrics,
} from "./networkTypes";
import { createCloudflareRoom, joinCloudflareRoom } from "./cloudflareMultiplayerClient";

const ROOM_NAME = "kart_room";
const RESUME_KEY_PREFIX = "kartwars:resume:";
const endpoint = process.env.NEXT_PUBLIC_MULTIPLAYER_URL || "http://localhost:2567";
const realtimeEndpoint = process.env.NEXT_PUBLIC_REALTIME_URL;

export interface MultiplayerSession {
  readonly state: LobbyState | null;
  readonly ownPlayerId: string;
  readonly isConnected: boolean;
  initialize(): Promise<LobbyState>;
  onLobbyState(listener: (state: LobbyState) => void): () => void;
  onMatchStart(listener: (match: MatchStart) => void): () => void;
  onSnapshots(listener: (frame: SnapshotFrame) => void): () => void;
  onRoomError(listener: (message: string) => void): () => void;
  createGameConfig(match: MatchStart): NetworkGameConfig;
  setReady(ready: boolean): void;
  setMap?(mapId: string): void;
  requestStart(): void;
  requestRestart(): void;
  finishMatch(matchId: string): void;
  leave(): Promise<void>;
}

function getClient() {
  return new Client(endpoint);
}

function joinLegacyRoom(normalizedCode: string, profile: Profile): Promise<MultiplayerSession> {
  const client = getClient();
  const options = {
    code: normalizedCode,
    quick: false,
    mode: modeFromCode(normalizedCode),
    profile,
  };
  const resumeToken = readResumeToken(normalizedCode);
  return client.join(ROOM_NAME, { ...options, resumeToken })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      if (!resumeToken || !message.includes("already connected")) throw error;
      return client.join(ROOM_NAME, options);
    })
    .then((room) => new LegacyMultiplayerSession(room, normalizedCode));
}

function resumeKey(code: string) {
  return `${RESUME_KEY_PREFIX}${code}`;
}

function readResumeToken(code: string): string | undefined {
  try {
    return window.sessionStorage.getItem(resumeKey(code)) ?? window.localStorage.getItem(resumeKey(code)) ?? undefined;
  } catch (error) {
    console.warn("Room re-entry token could not be read from local storage.", error);
    return undefined;
  }
}

function saveResumeToken(code: string, token: string) {
  try {
    window.sessionStorage.setItem(resumeKey(code), token);
    window.localStorage.setItem(resumeKey(code), token);
  } catch (error) {
    console.warn("Room re-entry token could not be saved to local storage.", error);
  }
}

export async function createRoom(profile: Profile, mode: "ffa" | "team"): Promise<MultiplayerSession> {
  let code = randomCode();
  while (modeFromCode(code) !== mode) code = randomCode();
  if (realtimeEndpoint) return createCloudflareRoom(realtimeEndpoint, code, profile, mode);
  const room = await getClient().create(ROOM_NAME, { code, quick: false, mode, profile });
  return new LegacyMultiplayerSession(room, code);
}

export async function joinRoom(code: string, profile: Profile): Promise<MultiplayerSession> {
  const normalizedCode = code.trim().toUpperCase();
  if (realtimeEndpoint) {
    try {
      return await joinCloudflareRoom(realtimeEndpoint, normalizedCode, profile);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Room not found. Check the invitation code.") throw error;
      return joinLegacyRoom(normalizedCode, profile);
    }
  }
  return joinLegacyRoom(normalizedCode, profile);
}

export async function joinQuickMatch(profile: Profile, mode: "ffa" | "team"): Promise<MultiplayerSession> {
  const room = await getClient().joinOrCreate(ROOM_NAME, { code: "", quick: true, mode, profile });
  return new LegacyMultiplayerSession(room, "");
}

class LegacyMultiplayerSession implements MultiplayerSession {
  private readonly room: Room;
  private readonly lobbyListeners = new Set<(state: LobbyState) => void>();
  private readonly matchListeners = new Set<(match: MatchStart) => void>();
  private readonly snapshotListeners = new Set<(frame: SnapshotFrame) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private readonly snapshotHistory: SnapshotFrame[] = [];
  private lobby: LobbyState | null = null;
  private lastMatch: MatchStart | null = null;
  private playerId = "";
  private resumeToken = "";
  private snapshotSequence = 0;
  private serverOffset = 0;
  private connected = true;
  private intentionalLeave = false;

  constructor(room: Room, private readonly requestedCode: string) {
    this.room = room;
    this.room.onMessage("lobby-state", (state: LobbyState) => this.setLobby(state));
    this.room.onMessage("match-start", (match: MatchStart) => this.setMatch(match));
    this.room.onMessage("snapshots", (frame: SnapshotFrame) => this.setSnapshots(frame));
    this.room.onMessage("room-error", (message: { message?: string }) => {
      this.emitError(message.message || "The room rejected that request.");
    });
    this.room.onDrop(() => {
      this.setConnected(false);
      this.emitError("Connection interrupted. Reconnecting…");
    });
    this.room.onReconnect(() => {
      this.setConnected(true);
      this.emitError("");
    });
    this.room.onLeave((code, reason) => {
      if (!this.intentionalLeave) {
        this.setConnected(false);
        this.emitError(reason || `Disconnected from the room (code ${code}).`);
      }
    });
    this.room.onError((code, message) => {
      this.emitError(message || `Room error ${code}.`);
    });
  }

  async initialize(): Promise<LobbyState> {
    const requestStartedAt = Date.now();
    const time = await this.room.request<Record<string, never>, { serverTime: number }>("server-time", {});
    const requestFinishedAt = Date.now();
    this.serverOffset = time.serverTime - (requestStartedAt + requestFinishedAt) / 2;
    const joined = await this.room.request<Record<string, never>, JoinState>("get-lobby", {});
    this.playerId = joined.playerId;
    this.resumeToken = joined.resumeToken;
    if (joined.initialSnapshots) {
      this.snapshotSequence = Math.max(
        0,
        ...joined.initialSnapshots.players
          .filter((snapshot) => snapshot.playerId === this.playerId)
          .map((snapshot) => snapshot.sequence),
      );
    }
    const code = joined.state.code || this.requestedCode;
    if (code) saveResumeToken(code, this.resumeToken);
    this.setLobby(joined.state);
    if (joined.matchStart) this.setMatch(joined.matchStart);
    if (joined.initialSnapshots) this.setSnapshots(joined.initialSnapshots);
    return joined.state;
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
      initialSnapshot: this.snapshotHistory
        .flatMap((frame) => frame.players)
        .find((snapshot) => snapshot.playerId === this.playerId),
      serverNow: () => this.serverNow(),
      canControlMatch: () => this.lobby?.hostPlayerId === this.playerId,
      finishMatch: (matchId) => this.finishMatch(matchId),
      isConnected: () => this.connected,
      onConnectionChange: (listener) => this.onConnectionChange(listener),
      getCloudflareSnapshotPipelineStats: () => null,
      getSnapshotServerMetrics: async () => {
        const metrics = await this.room.request<Record<string, never>, SnapshotServerMetrics>("network-metrics", {});
        return metrics.enabled ? metrics : null;
      },
      sendSnapshot: (snapshot) => this.sendSnapshot(snapshot),
      getTransportStaleSnapshotCount: () => 0,
      onSnapshots: (listener) => this.onSnapshots(listener),
      onPlayersChange: (listener) => this.onLobbyState((state) => listener(state.players)),
    };
  }

  setReady(ready: boolean) {
    this.room.send("ready", { ready });
  }

  requestStart() {
    this.room.send("request-start", {});
  }

  requestRestart() {
    if (this.lobby?.matchId) this.room.send("request-restart", { matchId: this.lobby.matchId });
  }

  finishMatch(matchId: string) {
    this.room.send("match-ended", { matchId });
  }

  async leave() {
    this.intentionalLeave = true;
    this.setConnected(false);
    await this.room.leave();
  }

  private serverNow() {
    return Date.now() + this.serverOffset;
  }

  private sendSnapshot(snapshot: Omit<PlayerSnapshot, "playerId" | "sequence">) {
    if (!this.connected || this.lobby?.phase !== "playing") return false;
    this.room.send("player-state", { sequence: ++this.snapshotSequence, state: snapshot });
    return true;
  }

  private setLobby(state: LobbyState) {
    this.lobby = state;
    for (const listener of this.lobbyListeners) listener(state);
  }

  private setMatch(match: MatchStart) {
    if (this.lastMatch?.matchId === match.matchId) return;
    this.lastMatch = match;
    this.snapshotHistory.length = 0;
    for (const listener of this.matchListeners) listener(match);
  }

  private setSnapshots(frame: SnapshotFrame) {
    this.snapshotHistory.push(frame);
    if (this.snapshotHistory.length > 24) this.snapshotHistory.shift();
    for (const listener of this.snapshotListeners) listener(frame);
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
