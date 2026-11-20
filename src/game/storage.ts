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

export function loadTutorialProgress(): TutorialProgress {
  return { ...EMPTY_TUTORIAL_PROGRESS, ...read<Partial<TutorialProgress>>(K_TUTORIAL, {}) };
}
export function saveTutorialProgress(progress: TutorialProgress) {
  tutorialSnapshot = progress;
  write(K_TUTORIAL, progress);
  tutorialListeners.forEach((listener) => listener());
}

export function subscribeTutorialProgress(listener: () => void) {
  tutorialListeners.add(listener);
  if (tutorialListeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onTutorialStorage);
  return () => {
    tutorialListeners.delete(listener);
    if (tutorialListeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onTutorialStorage);
  };
}
export function getTutorialProgressSnapshot() {
  if (typeof window === "undefined") return EMPTY_TUTORIAL_PROGRESS;
  if (!tutorialSnapshot) tutorialSnapshot = loadTutorialProgress();
  return tutorialSnapshot;
}
export function getServerTutorialProgressSnapshot() {
  return EMPTY_TUTORIAL_PROGRESS;
}
