"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { audio } from "@/game/audio";
import { randomMapId, mapDef } from "@/game/maps";
import { makeRoster } from "@/game/roster";
import { clearScores, getServerTutorialProgressSnapshot, getTutorialProgressSnapshot, loadProfile, loadScores, loadSettings, saveProfile, saveSettings, saveTutorialProgress, subscribeTutorialProgress, type ScoreEntry } from "@/game/storage";
import { WEAPONS, WEAPON_IDS, type GameConfig, type Mode, type Profile, type RemoteDesc, type RosterEntry, type Settings } from "@/game/types";
import GameView from "./GameView";
import KartSelect from "./KartSelect";
import Lobby from "./Lobby";
import MapSelect from "./MapSelect";
import ScoreTable from "./Scores";
import SettingsPanel from "./SettingsPanel";
import { HelpOverlay, WelcomeOverlay } from "./Guidance";

type Screen = "menu" | "mode" | "map" | "kart" | "settings" | "lobby" | "scores" | "game";

function getTouchModeSnapshot() {
  return typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
}
function subscribeTouchMode(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(pointer: coarse)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

const MODE_CARDS: { id: Mode; name: string; icon: string; objective: string; rules: string; color: string }[] = [
  { id: "ffa", name: "Free For All", icon: "💥", objective: "Defeat opponents, earn eliminations and finish with the highest score.", rules: "Highest score when the match timer reaches zero wins.", color: "#ff8a1f" },
  { id: "team", name: "Team Battle", icon: "🛡️", objective: "Work with your teammates and eliminate the opposing team.", rules: "Blue vs Red. Friendly fire is off; the higher team score wins.", color: "#35e8ff" },
  { id: "survival", name: "Survival", icon: "☠️", objective: "Survive increasingly difficult enemy waves while managing your lives.", rules: "You have 3 lives. Survive through wave 5 to win.", color: "#ff3fb0" },
];

export default function KartWarsApp() {
  const tutorialProgress = useSyncExternalStore(subscribeTutorialProgress, getTutorialProgressSnapshot, getServerTutorialProgressSnapshot);
  const [screen, setScreen] = useState<Screen>("menu");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const ready = true;
  const [cfg, setCfg] = useState<GameConfig | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [menuHelpOpen, setMenuHelpOpen] = useState(false);

  const touch = useSyncExternalStore(subscribeTouchMode, getTouchModeSnapshot, () => false);

  useEffect(() => {
    if (ready) saveSettings(settings);
  }, [settings, ready]);
  useEffect(() => {
    if (ready) saveProfile(profile);
  }, [profile, ready]);

  const go = useCallback((s: Screen) => {
    audio.init();
    audio.sfx("click");
    if (s === "scores" || s === "menu") setScores(loadScores());
    setScreen(s);
  }, []);

  const [pendingMode, setPendingMode] = useState<Mode>("ffa");

  const startGame = useCallback(
    (o: {
      mode: Mode;
      mapId: string;
      roster: RosterEntry[];
      remotes?: RemoteDesc[];
      net?: { code: string; playerId: string };
      seed?: number;
      tutorial?: boolean;
      tutorialStep?: number;
    }) => {
      audio.init();
      audio.setVolumes(settings.master, settings.music, settings.sfx);
      const resolved = o.mapId === "random" ? randomMapId() : mapDef(o.mapId).id;
      const seed = o.seed && o.seed > 0 ? o.seed : ((Math.random() * 0xffffffff) >>> 0) || 1;
      setCfg({
        mode: o.mode,
        mapId: resolved,
        seed,
        profile: { ...profile },
        settings: { ...settings },
        roster: o.roster,
        remotes: o.remotes ?? [],
        net: o.net,
        touch,
        tutorial: o.tutorial,
        tutorialStep: o.tutorialStep,
      });
      setGameKey((k) => k + 1);
      setScreen("game");
    },
    [profile, settings, touch],
  );

  const launchTutorial = useCallback((step = 0) => {
    saveTutorialProgress({ seen: true, completed: false, step });
    startGame({
      mode: "ffa",
      mapId: "neon",
      roster: [],
      tutorial: true,
      tutorialStep: step,
    });
  }, [startGame]);

  const skipFirstTutorial = useCallback(() => {
    saveTutorialProgress({ seen: true, completed: true, step: 0 });
  }, []);

  const onSettings = useCallback((s: Settings) => {
    setSettings(s);
    audio.setVolumes(s.master, s.music, s.sfx);
  }, []);

  const restart = useCallback(() => setGameKey((k) => k + 1), []);
  const exitGame = useCallback(() => {
    if (cfg) setSettings((s) => ({ ...s, master: cfg.settings.master }));
    setCfg(null);
    setScores(loadScores());
    setScreen("menu");
  }, [cfg]);

  if (screen === "game" && cfg) {
    return (
      <main className="fixed inset-0">
        <GameView key={gameKey} cfg={cfg} onRestart={restart} onExit={exitGame} />
      </main>
    );
  }

  const best = scores[0]?.score ?? 0;

  return (
    <main className="fixed inset-0 overflow-hidden">
      <div className="kw-bg">
        <div className="kw-skyline" />
      </div>

      {screen === "menu" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-y-auto p-4">
          <div className="text-center">
            <div className="kw-display mb-1 text-sm tracking-[0.5em] text-cyan-300 sm:text-base">3D arena combat</div>
            <h1 className="kw-display kw-title text-[clamp(4rem,14vw,10rem)] leading-[0.85]">KART WARS</h1>
            <div className="kw-display mt-2 text-xl tracking-[0.35em] text-pink-300 sm:text-3xl">Ultimate Arena Battle</div>
          </div>
          <div className="mt-8 flex w-[min(90vw,340px)] flex-col gap-3">
            <button className="kw-btn text-2xl" onClick={() => go("mode")} autoFocus>
              <span>▶ Play</span>
            </button>
            <button className="kw-btn cyan" onClick={() => go("lobby")}>
              <span>🌐 Multiplayer</span>
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button className="kw-btn ghost small" onClick={() => go("kart")}>
                <span>🏎 Garage</span>
              </button>
              <button className="kw-btn ghost small" onClick={() => go("scores")}>
                <span>🏆 Scores</span>
              </button>
              <button className="kw-btn ghost small" onClick={() => go("settings")}>
                <span>⚙ Setup</span>
              </button>
            </div>
            <button className="kw-btn ghost small" onClick={() => setMenuHelpOpen(true)}>
              <span>ⓘ Help / Controls</span>
            </button>
            {tutorialProgress.seen && !tutorialProgress.completed && (
              <button className="kw-btn cyan small" onClick={() => launchTutorial(tutorialProgress.step)}>
                <span>▶ Resume Tutorial · Step {Math.min(tutorialProgress.step + 1, 10)}</span>
              </button>
            )}
          </div>
          <div className="mt-8 flex max-w-3xl flex-wrap justify-center gap-2">
            {WEAPON_IDS.map((id) => (
              <div key={id} className="kw-panel flex items-center gap-2 px-3 py-1.5 text-xs" title={WEAPONS[id].desc}>
                <span className="text-xl">{WEAPONS[id].icon}</span>
                <span className="font-bold" style={{ color: WEAPONS[id].color }}>
                  {WEAPONS[id].name}
                </span>
              </div>
            ))}
          </div>
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-sm">
            <span className="text-xl">{profile.avatar}</span>
            <b>{profile.name || "Driver"}</b>
            {best > 0 && <span className="ml-2 text-yellow-300">Best {best.toLocaleString()}</span>}
          </div>
          <div className="absolute bottom-3 right-3 hidden text-[11px] text-slate-400 sm:block">{touch ? "Touch controls active · Turn your kart to aim · FIRE shoots forward" : "WASD / Arrows drive · SPACE drift · SHIFT boost · F fire (shoots forward)"}</div>
        </div>
      )}

      {screen === "menu" && !tutorialProgress.seen && (
        <WelcomeOverlay onStart={() => launchTutorial(0)} onSkip={skipFirstTutorial} />
      )}
      {menuHelpOpen && screen !== "game" && <HelpOverlay touch={touch} onClose={() => setMenuHelpOpen(false)} />}

      {screen === "mode" && (
        <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto p-4 sm:p-8">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
            <h2 className="kw-display kw-title text-5xl">Select Mode</h2>
            <button className="kw-btn ghost small" onClick={() => go("menu")}>
              <span>← Back</span>
            </button>
          </div>
          <div className="mx-auto mt-6 grid w-full max-w-5xl gap-5 md:grid-cols-3">
            {MODE_CARDS.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setPendingMode(m.id);
                  go("map");
                }}
                className="kw-panel group relative overflow-hidden p-6 text-left transition-transform hover:-translate-y-1"
                style={{ borderColor: `${m.color}88` }}
              >
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: m.color, boxShadow: `0 0 20px ${m.color}` }} />
                <div className="text-6xl transition-transform group-hover:scale-110">{m.icon}</div>
                <div className="kw-display mt-3 text-3xl" style={{ color: m.color }}>
                  {m.name}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-200">{m.objective}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{m.rules}</p>
                <div className="mt-4 text-xs uppercase tracking-widest text-slate-400">{m.id === "survival" ? "Endless · 3 lives" : `${settings.matchMinutes} minute match`}</div>
                <div className="kw-display mt-4 inline-block rounded-md bg-white/10 px-4 py-1.5 text-lg group-hover:bg-white/20">Start ▶</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {screen === "map" && (
        <MapSelect
          onPick={(mapId) => startGame({ mode: pendingMode, mapId, roster: makeRoster(pendingMode === "survival" ? 8 : 7) })}
          onBack={() => go("mode")}
        />
      )}

      {screen === "kart" && <KartSelect profile={profile} onChange={setProfile} onBack={() => go("menu")} />}
      {screen === "settings" && <SettingsPanel settings={settings} touch={touch} onReplayTutorial={() => launchTutorial(0)} onChange={onSettings} onBack={() => go("menu")} />}
      {screen === "lobby" && <Lobby profile={profile} onStart={startGame} onBack={() => go("menu")} />}

      {screen === "scores" && (
        <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto p-4 sm:p-8">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
            <h2 className="kw-display kw-title text-5xl">High Scores</h2>
            <button className="kw-btn ghost small" onClick={() => go("menu")}>
              <span>← Back</span>
            </button>
          </div>
          <div className="kw-panel mx-auto mt-5 w-full max-w-3xl p-5">
            <ScoreTable scores={scores} limit={10} />
            {scores.length > 0 && (
              <div className="mt-4 text-right">
                <button
                  className="kw-btn ghost small"
                  onClick={() => {
                    clearScores();
                    setScores([]);
                  }}
                >
                  <span>Clear scores</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
