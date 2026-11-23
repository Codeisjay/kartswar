import { AVATARS, BOT_NAMES, KART_PRESETS, type Mode, type RosterEntry } from "./types";

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Build a roster of AI drivers. With a seed the result is deterministic (used for join codes). */
export function makeRoster(count: number, seed?: string, exclude: string[] = []): RosterEntry[] {
  const rnd = seed ? mulberry(hashString(seed)) : Math.random;
  const names = [...BOT_NAMES].filter((n) => !exclude.includes(n));
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return Array.from({ length: count }, (_, i) => ({
    name: names[i % names.length],
    avatar: AVATARS[Math.floor(rnd() * AVATARS.length)],
    kartId: Math.floor(rnd() * KART_PRESETS.length),
  }));
}

export function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

export function modeFromCode(code: string): Mode {
  const m = hashString(code) % 3;
  return m === 0 ? "ffa" : m === 1 ? "team" : "ffa";
}

export function mapFromCode(code: string): string {
  const ids = ["neon", "city", "volcano", "jungle", "sunbeam"];
  return ids[hashString("map:" + code) % ids.length];
}

/**
 * Networking seam. The game simulation consumes an `Input` per kart and produces plain-data state,
 * so a real transport (WebSocket / WebRTC) can implement this interface and replace the AI drivers.
 * The current build ships with the offline `LocalRoomAdapter`, which fills every seat with AI.
 */
export interface RoomAdapter {
  readonly code: string;
  readonly offline: boolean;
  seats(): { name: string; avatar: string; ai: boolean }[];
}
