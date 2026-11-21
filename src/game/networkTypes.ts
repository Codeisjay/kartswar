import type { Mode } from "./types";

export interface NetworkSpawnPoint {
  x: number;
  z: number;
  heading: number;
}

export interface NetworkPlayer {
  playerId: string;
  displayName: string;
  avatar: string;
  kartId: number;
  slot: number;
  team: number;
  connected: boolean;
  ready: boolean;
  host: boolean;
  spawn: NetworkSpawnPoint;
}

export type RoomPhase = "lobby" | "countdown" | "playing" | "ended";

export interface LobbyState {
  roomId: string;
  code: string;
  mode: Mode;
  quick: boolean;
  phase: RoomPhase;
  hostPlayerId: string;
  players: NetworkPlayer[];
  matchId: string | null;
  mapId: string;
  startAt: number | null;
}

export interface JoinState {
  state: LobbyState;
  playerId: string;
  resumeToken: string;
  matchStart?: MatchStart | null;
  initialSnapshots?: SnapshotFrame;
}

export interface PlayerSnapshot {
  playerId: string;
  sequence: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  pitch: number;
  roll: number;
  boosting: boolean;
  drifting: boolean;
  driftLevel: number;
  grounded: boolean;
  alive: boolean;
  hp: number;
  weapon: string | null;
  ammo: number;
  firing: boolean;
  aimX: number;
  aimZ: number;
}

export interface SnapshotFrame {
  serverTime: number;
  players: PlayerSnapshot[];
}

export interface MatchStart {
  matchId: string;
  mapId: string;
  mode: Mode;
  startAt: number;
  players: NetworkPlayer[];
  lateJoin?: boolean;
}

export interface NetworkGameConfig {
  playerId: string;
  matchId: string;
  mapId: string;
  startAt: number;
  players: NetworkPlayer[];
  initialSnapshot?: PlayerSnapshot;
  serverNow: () => number;
  canControlMatch: () => boolean;
  finishMatch: (matchId: string) => void;
  sendSnapshot: (snapshot: Omit<PlayerSnapshot, "playerId" | "sequence">) => void;
  onSnapshots: (listener: (frame: SnapshotFrame) => void) => () => void;
  onPlayersChange: (listener: (players: NetworkPlayer[]) => void) => () => void;
}
