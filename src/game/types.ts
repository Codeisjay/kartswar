export type Mode = "ffa" | "team" | "survival";
export type WeaponId = "rocket" | "mg" | "mine" | "bomb" | "shield" | "boost";
export type Quality = "auto" | "low" | "medium" | "high";
export type Difficulty = "easy" | "normal" | "hard";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  icon: string;
  color: string;
  ammo: number;
  cooldown: number;
  desc: string;
  weight: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rocket: { id: "rocket", name: "Rocket Launcher", icon: "🚀", color: "#ff7a1a", ammo: 3, cooldown: 0.75, desc: "Homing rockets lock onto targets in front of you", weight: 22 },
  mg: { id: "mg", name: "Machine Gun", icon: "🔫", color: "#ffe14d", ammo: 50, cooldown: 0.08, desc: "Rapid-fire tracer rounds", weight: 22 },
  mine: { id: "mine", name: "Land Mines", icon: "🧨", color: "#ff3b5c", ammo: 3, cooldown: 0.55, desc: "Drops proximity mines behind you", weight: 14 },
  bomb: { id: "bomb", name: "Bomb", icon: "💣", color: "#b36bff", ammo: 2, cooldown: 1.0, desc: "Lobbed bomb with a huge blast radius", weight: 14 },
  shield: { id: "shield", name: "Shield", icon: "🛡️", color: "#38e8ff", ammo: 1, cooldown: 0.2, desc: "Blocks all damage for a few seconds", weight: 14 },
  boost: { id: "boost", name: "Speed Boost", icon: "⚡", color: "#6dff6d", ammo: 1, cooldown: 0.2, desc: "Rocket-powered burst of speed", weight: 14 },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export interface KartPreset {
  id: number;
  name: string;
  tagline: string;
  shape: "kart" | "buggy" | "saucer";
  primary: number;
  accent: number;
  glow: number;
  num: string;
  speed: number;
  handling: number;
  armor: number;
}

export const KART_PRESETS: KartPreset[] = [
  { id: 0, name: "Inferno", tagline: "Classic flame racer", shape: "kart", primary: 0xff8a1f, accent: 0xd62812, glow: 0xff6a00, num: "04", speed: 1.0, handling: 1.0, armor: 1.0 },
  { id: 1, name: "Phantom", tagline: "Stealth neon buggy", shape: "buggy", primary: 0x20242c, accent: 0x35f0ff, glow: 0x35f0ff, num: "07", speed: 1.08, handling: 0.94, armor: 0.9 },
  { id: 2, name: "Nebula", tagline: "Agile hover saucer", shape: "saucer", primary: 0x8e3bff, accent: 0x62ff9a, glow: 0xb64dff, num: "13", speed: 0.95, handling: 1.12, armor: 0.95 },
  { id: 3, name: "Toxic", tagline: "Heavy hitter", shape: "kart", primary: 0x62d12f, accent: 0xffd21f, glow: 0x9dff3a, num: "88", speed: 0.96, handling: 1.0, armor: 1.12 },
  { id: 4, name: "Royal", tagline: "Balanced bruiser", shape: "buggy", primary: 0x2a5bff, accent: 0xffffff, glow: 0x4aa8ff, num: "21", speed: 1.0, handling: 1.02, armor: 1.04 },
  { id: 5, name: "Crimson Rex", tagline: "Pure speed demon", shape: "buggy", primary: 0xd91e3f, accent: 0xffc400, glow: 0xff2d55, num: "66", speed: 1.06, handling: 0.92, armor: 0.98 },
];

export const GLOW_SWATCHES = [0xff6a00, 0x35f0ff, 0xb64dff, 0x9dff3a, 0x4aa8ff, 0xff2d55, 0xffe14d, 0xff4fd8];

export const AVATARS = ["😎", "🤖", "👽", "🦊", "🐲", "🦄", "💀", "🐼", "🔥", "👾", "🐸", "🥷"];

export const BOT_NAMES = [
  "TurboTess", "NitroNed", "DriftKing", "ByteBandit", "Rocketeer", "MissileMia", "ZoomZara", "BoomBoris",
  "NeonNova", "ChaosChip", "VoltVixen", "GearGhost", "PixelPunk", "HavocHal", "SparkySam", "RiotRex",
];

export const TEAM_COLORS = [0x2f8bff, 0xff3a4a];
export const TEAM_NAMES = ["BLUE", "RED"];

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  quality: Quality;
  shake: boolean;
  aimAssist: boolean;
  showFps: boolean;
  matchMinutes: 3 | 4 | 5;
  difficulty: Difficulty;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  music: 0.5,
  sfx: 0.9,
  quality: "auto",
  shake: true,
  aimAssist: true,
  showFps: false,
  matchMinutes: 3,
  difficulty: "normal",
};

export interface Profile {
  name: string;
  avatar: string;
  kartId: number;
  glow: number;
}

export const DEFAULT_PROFILE: Profile = { name: "Driver", avatar: "😎", kartId: 0, glow: 0xff6a00 };

export interface RosterEntry {
  name: string;
  avatar: string;
  kartId: number;
  slot?: number;
}

export interface NetworkSeat {
  id: string;
  name: string;
  avatar: string;
  kartId: number;
  isHost: boolean;
  isAi: boolean;
  ready: boolean;
  slot: number;
  updatedAt: number;
  state: Record<string, unknown>;
}

export interface GameConfig {
  mode: Mode;
  mapId: string;
  /** Optional match seed for reproducible randomization (debugging). Defaults to random. */
  seed: number;
  profile: Profile;
  settings: Settings;
  roster: RosterEntry[];
  touch: boolean;
  tutorial?: boolean;
  tutorialStep?: number;
  /** A real player connected over a room (multiplayer). */
  net?: {
    code: string;
    playerId: string;
    playerName: string;
    slot: number;
    isHost: boolean;
    startAt: number | null;
    serverOffset: number;
    cursor: number;
    initialState?: Record<string, unknown>;
  };
  /** Human opponents driven by the network instead of AI. */
  remotes?: RemoteDesc[];
}

export interface RemoteDesc {
  id: string;
  name: string;
  avatar: string;
  kartId: number;
  team: number;
  slot: number;
  state?: Record<string, unknown>;
  updatedAt?: number;
}

export interface HudWeapon {
  id: WeaponId;
  ammo: number;
  maxAmmo: number;
}

export interface HudRow {
  name: string;
  avatar: string;
  score: number;
  kills: number;
  team: number;
  isPlayer: boolean;
}

export interface HudState {
  phase: "intro" | "playing" | "ended";
  countdown: number;
  timeLeft: number;
  hp: number;
  maxHp: number;
  shield: number;
  boostMeter: number;
  boosting: boolean;
  speed: number;
  weapon: HudWeapon | null;
  cooldownFrac: number;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
  alive: boolean;
  respawnIn: number;
  lives: number;
  wave: number;
  mode: Mode;
  teamScores: [number, number];
  top: HudRow[];
  fps: number;
  driftLevel: number;
  playerTeam: number;
}

export interface KillEntry {
  id: number;
  killer: string | null;
  killerTeam: number;
  victim: string;
  victimTeam: number;
  icon: string;
  involvesPlayer: boolean;
  t: number;
}

export type GameEvent =
  | { type: "hurt" }
  | { type: "hit"; kill: boolean }
  | { type: "banner"; text: string; sub?: string; color?: string }
  | { type: "pickup"; text: string; color: string };

export interface ResultRow {
  name: string;
  avatar: string;
  kills: number;
  deaths: number;
  score: number;
  team: number;
  isPlayer: boolean;
}

export interface MatchResult {
  mode: Mode;
  rows: ResultRow[];
  score: number;
  kills: number;
  deaths: number;
  win: boolean;
  draw: boolean;
  rank: number;
  teamScores: [number, number];
  wave: number;
  duration: number;
  playerTeam: number;
}

export interface GameCallbacks {
  onHud: (h: HudState) => void;
  onKill: (k: KillEntry) => void;
  onEvent: (e: GameEvent) => void;
  onEnd: (r: MatchResult) => void;
  onNetworkMatchEnd?: () => void;
  onNetworkHostChange?: (isHost: boolean) => void;
  onNetworkCountdown?: (startAt: number) => void;
  onNetworkRestart?: (seed: number, startAt: number, players: NetworkSeat[]) => void;
  onTutorialState?: (state: TutorialState) => void;
}

export interface TutorialState {
  throttle: number;
  steer: number;
  speed: number;
  steeredLeft: boolean;
  steeredRight: boolean;
  reversed: boolean;
  boosting: boolean;
  distance: number;
  fireCount: number;
  pickupCount: number;
  targetHits: number;
  targetInRange: boolean;
  targetBearing: number | null;
  weapon: WeaponId | null;
  ammo: number;
  shield: number;
  pickupBearing: number | null;
  pickupDistance: number | null;
}

export interface TouchInput {
  steer: number;
  throttle: number;
  drift: boolean;
  boost: boolean;
  fire: boolean;
}
