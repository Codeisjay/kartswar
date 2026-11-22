import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Mode, type Profile, type Settings } from "./types";

const K_SETTINGS = "kw_settings_v1";
const K_PROFILE = "kw_profile_v1";
const K_SCORES = "kw_scores_v1";
const K_TUTORIAL = "kw_tutorial_v1";

export interface TutorialProgress {
  seen: boolean;
  completed: boolean;
  step: number;
}
const EMPTY_TUTORIAL_PROGRESS: TutorialProgress = { seen: false, completed: false, step: 0 };
let tutorialSnapshot: TutorialProgress | null = null;
const tutorialListeners = new Set<() => void>();
const onTutorialStorage = (event: StorageEvent) => {
  if (event.key !== K_TUTORIAL) return;
  tutorialSnapshot = loadTutorialProgress();
  tutorialListeners.forEach((listener) => listener());
};

export interface ScoreEntry {
  name: string;
  avatar: string;
  score: number;
  kills: number;
  mode: Mode;
  date: number;
  wave?: number;
}

const EMPTY_SCORES: ScoreEntry[] = [];
let settingsSnapshot: Settings | null = null;
let profileSnapshot: Profile | null = null;
let scoresSnapshot: ScoreEntry[] | null = null;
const settingsListeners = new Set<() => void>();
const profileListeners = new Set<() => void>();
const scoresListeners = new Set<() => void>();

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

function notify(listeners: Set<() => void>) {
  listeners.forEach((listener) => listener());
}

function subscribeStorageStore(
  listeners: Set<() => void>,
  listener: () => void,
  onStorage: (event: StorageEvent) => void,
) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const onSettingsStorage = (event: StorageEvent) => {
  if (event.key !== K_SETTINGS && event.key !== null) return;
  settingsSnapshot = loadSettings();
  notify(settingsListeners);
};
const onProfileStorage = (event: StorageEvent) => {
  if (event.key !== K_PROFILE && event.key !== null) return;
  profileSnapshot = loadProfile();
  notify(profileListeners);
};
const onScoresStorage = (event: StorageEvent) => {
  if (event.key !== K_SCORES && event.key !== null) return;
  scoresSnapshot = loadScores();
  notify(scoresListeners);
};

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K_SETTINGS, {}) };
}
export function saveSettings(s: Settings) {
  settingsSnapshot = { ...s };
  write(K_SETTINGS, s);
  notify(settingsListeners);
}
export function subscribeSettings(listener: () => void) {
  return subscribeStorageStore(settingsListeners, listener, onSettingsStorage);
}
export function getSettingsSnapshot() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  if (!settingsSnapshot) settingsSnapshot = loadSettings();
  return settingsSnapshot;
}
export function getServerSettingsSnapshot() {
  return DEFAULT_SETTINGS;
}
export function loadProfile(): Profile {
  return { ...DEFAULT_PROFILE, ...read<Partial<Profile>>(K_PROFILE, {}) };
}
export function saveProfile(p: Profile) {
  profileSnapshot = { ...p };
  write(K_PROFILE, p);
  notify(profileListeners);
}
export function subscribeProfile(listener: () => void) {
  return subscribeStorageStore(profileListeners, listener, onProfileStorage);
}
export function getProfileSnapshot() {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  if (!profileSnapshot) profileSnapshot = loadProfile();
  return profileSnapshot;
}
export function getServerProfileSnapshot() {
  return DEFAULT_PROFILE;
}
export function loadScores(): ScoreEntry[] {
  const s = read<ScoreEntry[]>(K_SCORES, []);
  return Array.isArray(s) ? s : [];
}
export function subscribeScores(listener: () => void) {
  return subscribeStorageStore(scoresListeners, listener, onScoresStorage);
}
export function getScoresSnapshot() {
  if (typeof window === "undefined") return EMPTY_SCORES;
  if (!scoresSnapshot) scoresSnapshot = loadScores();
  return scoresSnapshot;
}
export function getServerScoresSnapshot() {
  return EMPTY_SCORES;
}
export function addScore(e: ScoreEntry): { scores: ScoreEntry[]; rank: number } {
  const all = [...loadScores(), e].sort((a, b) => b.score - a.score).slice(0, 20);
  scoresSnapshot = all;
  write(K_SCORES, all);
  notify(scoresListeners);
  return { scores: all, rank: all.findIndex((x) => x.date === e.date && x.score === e.score && x.name === e.name) };
}
export function clearScores() {
  scoresSnapshot = EMPTY_SCORES;
  write(K_SCORES, []);
  notify(scoresListeners);
}

export function loadTutorialProgress(): TutorialProgress {
  return { ...EMPTY_TUTORIAL_PROGRESS, ...read<Partial<TutorialProgress>>(K_TUTORIAL, {}) };
}
export function saveTutorialProgress(progress: TutorialProgress) {
  tutorialSnapshot = progress;
  write(K_TUTORIAL, progress);
  tutorialListeners.forEach((listener) => listener());
}

export function subscribeTutorialProgress(listener: () => void) {
  return subscribeStorageStore(tutorialListeners, listener, onTutorialStorage);
}
export function getTutorialProgressSnapshot() {
  if (typeof window === "undefined") return EMPTY_TUTORIAL_PROGRESS;
  if (!tutorialSnapshot) tutorialSnapshot = loadTutorialProgress();
  return tutorialSnapshot;
}
export function getServerTutorialProgressSnapshot() {
  return EMPTY_TUTORIAL_PROGRESS;
}
