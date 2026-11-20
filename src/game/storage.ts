import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Mode, type Profile, type Settings } from "./types";

const K_SETTINGS = "kw_settings_v1";
const K_PROFILE = "kw_profile_v1";
const K_SCORES = "kw_scores_v1";

export interface ScoreEntry {
  name: string;
  avatar: string;
  score: number;
  kills: number;
  mode: Mode;
  date: number;
  wave?: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K_SETTINGS, {}) };
}
export function saveSettings(s: Settings) {
  write(K_SETTINGS, s);
}
export function loadProfile(): Profile {
  return { ...DEFAULT_PROFILE, ...read<Partial<Profile>>(K_PROFILE, {}) };
}
export function saveProfile(p: Profile) {
  write(K_PROFILE, p);
}
export function loadScores(): ScoreEntry[] {
  const s = read<ScoreEntry[]>(K_SCORES, []);
  return Array.isArray(s) ? s : [];
}
export function addScore(e: ScoreEntry): { scores: ScoreEntry[]; rank: number } {
  const all = [...loadScores(), e].sort((a, b) => b.score - a.score).slice(0, 20);
  write(K_SCORES, all);
  return { scores: all, rank: all.findIndex((x) => x.date === e.date && x.score === e.score && x.name === e.name) };
}
export function clearScores() {
  write(K_SCORES, []);
}
