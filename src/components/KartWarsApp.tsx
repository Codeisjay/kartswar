"use client";

import { useCallback, useEffect, useState } from "react";
import { audio } from "@/game/audio";
import { makeRoster } from "@/game/roster";
import { clearScores, loadProfile, loadScores, loadSettings, saveProfile, saveSettings, type ScoreEntry } from "@/game/storage";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, WEAPONS, WEAPON_IDS, type GameConfig, type Mode, type Profile, type RosterEntry, type Settings } from "@/game/types";
import GameView from "./GameView";
import KartSelect from "./KartSelect";
import Lobby from "./Lobby";
import ScoreTable from "./Scores";
import SettingsPanel from "./SettingsPanel";

type Screen = "menu" | "mode" | "kart" | "settings" | "lobby" | "scores" | "game";

const MODE_CARDS: { id: Mode; name: string; icon: string; blurb: string; color: string }[] = [
  { id: "ffa", name: "Free For All", icon: "💥", blurb: "8 drivers, one winner. Most eliminations when the clock hits zero takes the crown.", color: "#ff8a1f" },
  { id: "team", name: "Team Battle", icon: "🛡️", blurb: "Blue vs Red, 4 on 4. Friendly fire is off — coordinate and out-score the enemy team.", color: "#35e8ff" },
  { id: "survival", name: "Survival", icon: "☠️", blurb: "Endless waves of tougher AI. You have 3 lives. How many waves can you last?", color: "#ff3fb0" },
];

export default function KartWarsApp() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [cfg, setCfg] = useState<GameConfig | null>(null);
  const [gameKey, setGameKey] = useState(0);

  useEffect(() => {
    setSettings(loadSettings());
    setProfile(loadProfile());
    setScores(loadScores());
    setReady(true);
  }, []);
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

  const startGame = useCallback(
    (mode: Mode, roster: RosterEntry[]) => {
      audio.init();
      audio.setVolumes(settings.master, settings.music, settings.sfx);
      const touch = typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
      setCfg({ mode, profile: { ...profile }, settings: { ...settings }, roster, touch });
      setGameKey((k) => k + 1);
      setScreen("game");
    },
    [profile, settings],
  );

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
          <div className="absolute bottom-3 right-3 hidden text-[11px] text-slate-400 sm:block">WASD drive · SPACE drift · SHIFT boost · CLICK fire (shoots forward)</div>
        </div>
      )}

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
                onClick={() => startGame(m.id, makeRoster(m.id === "survival" ? 8 : 7))}
                className="kw-panel group relative overflow-hidden p-6 text-left transition-transform hover:-translate-y-1"
                style={{ borderColor: `${m.color}88` }}
              >
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: m.color, boxShadow: `0 0 20px ${m.color}` }} />
                <div className="text-6xl transition-transform group-hover:scale-110">{m.icon}</div>
                <div className="kw-display mt-3 text-3xl" style={{ color: m.color }}>
                  {m.name}
                </div>
                <p className="mt-2 text-sm text-slate-300">{m.blurb}</p>
                <div className="mt-4 text-xs uppercase tracking-widest text-slate-400">{m.id === "survival" ? "Endless · 3 lives" : `${settings.matchMinutes} minute match`}</div>
                <div className="kw-display mt-4 inline-block rounded-md bg-white/10 px-4 py-1.5 text-lg group-hover:bg-white/20">Start ▶</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {screen === "kart" && <KartSelect profile={profile} onChange={setProfile} onBack={() => go("menu")} />}
      {screen === "settings" && <SettingsPanel settings={settings} onChange={onSettings} onBack={() => go("menu")} />}
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
