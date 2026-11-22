"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { audio } from "@/game/audio";
import { randomMapId, mapDef } from "@/game/maps";
import { makeRoster } from "@/game/roster";
import { RoomNet } from "@/game/net";
import {
  clearScores,
  getProfileSnapshot,
  getScoresSnapshot,
  getServerProfileSnapshot,
  getServerScoresSnapshot,
  getServerSettingsSnapshot,
  getServerTutorialProgressSnapshot,
  getSettingsSnapshot,
  getTutorialProgressSnapshot,
  saveProfile,
  saveSettings,
  saveTutorialProgress,
  subscribeProfile,
  subscribeScores,
  subscribeSettings,
  subscribeTutorialProgress,
} from "@/game/storage";
import { WEAPONS, WEAPON_IDS, type GameConfig, type Mode, type NetworkSeat, type RemoteDesc, type RosterEntry, type Settings } from "@/game/types";
import GameView from "./GameView";
import KartSelect from "./KartSelect";
import Lobby from "./Lobby";
import CloudflareLobby from "./CloudflareLobby";
import MapSelect from "./MapSelect";
import ScoreTable from "./Scores";
import SettingsPanel from "./SettingsPanel";
import { HelpOverlay, WelcomeOverlay } from "./Guidance";
import type { MultiplayerSession } from "@/game/multiplayerClient";
import type { MatchStart } from "@/game/networkTypes";

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
  const settings = useSyncExternalStore(subscribeSettings, getSettingsSnapshot, getServerSettingsSnapshot);
  const profile = useSyncExternalStore(subscribeProfile, getProfileSnapshot, getServerProfileSnapshot);
  const scores = useSyncExternalStore(subscribeScores, getScoresSnapshot, getServerScoresSnapshot);
  const [cfg, setCfg] = useState<GameConfig | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const networkSessionRef = useRef<MultiplayerSession | null>(null);
  const lastNetworkMatchRef = useRef<string | null>(null);
  const unsubscribeMatchRef = useRef<(() => void) | null>(null);
  const [networkError, setNetworkError] = useState("");
  const [menuHelpOpen, setMenuHelpOpen] = useState(false);

  const touch = useSyncExternalStore(subscribeTouchMode, getTouchModeSnapshot, () => false);

  const go = useCallback((s: Screen) => {
    audio.init();
    audio.sfx("click");
    setScreen(s);
  }, []);

  const [pendingMode, setPendingMode] = useState<Mode>("ffa");

  const startGame = useCallback(
    (o: {
      mode: Mode;
      mapId: string;
      roster: RosterEntry[];
      remotes?: RemoteDesc[];
      net?: NonNullable<GameConfig["net"]>;
      seed?: number;
      tutorial?: boolean;
      tutorialStep?: number;
    }) => {
      audio.init();
      setNetworkError("");
      audio.setVolumes(settings.master, settings.music, settings.sfx);
      const resolved = o.mapId === "random" ? randomMapId() : mapDef(o.mapId).id;
      const seed = o.seed && o.seed > 0 ? o.seed : ((Math.random() * 0xffffffff) >>> 0) || 1;
      setCfg({
        mode: o.mode,
        mapId: resolved,
        seed,
        profile: { ...profile, name: o.net?.playerName ?? profile.name },
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

  const startNetworkGame = useCallback((session: MultiplayerSession, match: MatchStart) => {
    if (lastNetworkMatchRef.current === match.matchId) return;
    const self = match.players.find((player) => player.playerId === session.ownPlayerId);
    if (!self) {
      console.error("The multiplayer server started a match without this client's player identity.");
      return;
    }
    lastNetworkMatchRef.current = match.matchId;
    audio.init();
    audio.setVolumes(settings.master, settings.music, settings.sfx);
    const touch = typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
    setCfg({
      mode: match.mode,
      mapId: match.mapId,
      seed: 1,
      profile: { ...profile, name: self.displayName, avatar: self.avatar, kartId: self.kartId },
      settings: { ...settings },
      roster: [],
      touch,
      network: session.createGameConfig(match),
    });
    setGameKey((key) => key + 1);
    setScreen("game");
  }, [profile, settings]);

  const onNetworkSession = useCallback((session: MultiplayerSession | null) => {
    unsubscribeMatchRef.current?.();
    unsubscribeMatchRef.current = null;
    networkSessionRef.current = session;
    lastNetworkMatchRef.current = null;
    if (session) unsubscribeMatchRef.current = session.onMatchStart((match) => startNetworkGame(session, match));
  }, [startNetworkGame]);

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
    saveSettings(s);
    audio.setVolumes(s.master, s.music, s.sfx);
  }, []);

  const restart = useCallback(async (match?: { seed: number; startAt: number; players: NetworkSeat[] }) => {
    setNetworkError("");
    if (match) {
      const playerId = cfg?.net?.playerId;
      const own = match.players.find((player) => player.id === playerId);
      const remotes: RemoteDesc[] = match.players.filter((player) => !player.isAi && player.id !== playerId).map((player) => ({
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        kartId: player.kartId,
        team: cfg?.mode === "team" ? player.slot % 2 : -1,
        slot: player.slot,
        state: player.state,
        updatedAt: player.updatedAt,
      }));
      const roster: RosterEntry[] = match.players.filter((player) => player.isAi).map((player) => ({
        name: player.name,
        avatar: player.avatar,
        kartId: player.kartId,
        slot: player.slot,
      }));
      setCfg((current) => current ? {
        ...current,
        seed: match.seed,
        profile: own ? { ...current.profile, name: own.name, avatar: own.avatar, kartId: own.kartId } : current.profile,
        roster,
        remotes,
        net: current.net && own ? {
          ...current.net,
          slot: own.slot,
          isHost: own.isHost,
          startAt: match.startAt,
          initialState: undefined,
        } : current.net,
      } : current);
      setGameKey((k) => k + 1);
      return;
    }
    if (cfg?.network) {
      if (cfg.network.canControlMatch()) networkSessionRef.current?.requestRestart();
      return;
    }
    if (cfg?.net) {
      const net = new RoomNet();
      net.code = cfg.net.code;
      net.playerId = cfg.net.playerId;
      net.setServerOffset(cfg.net.serverOffset);
      try {
        const response = await net.restart();
        if (!response.ok) setNetworkError(response.error ?? "Could not restart the room match");
      } catch (error) {
        setNetworkError(error instanceof Error ? error.message : "Could not restart the room match");
      }
      return;
    }
    setGameKey((key) => key + 1);
  }, [cfg]);
  const exitGame = useCallback(async () => {
    if (cfg?.net) {
      const net = new RoomNet();
      net.code = cfg.net.code;
      net.playerId = cfg.net.playerId;
      net.setServerOffset(cfg.net.serverOffset);
      try {
        await net.leave();
      } catch (error) {
        setNetworkError(error instanceof Error ? error.message : "Could not leave the room");
      }
    }
    if (cfg) saveSettings({ ...settings, master: cfg.settings.master });
    const session = networkSessionRef.current;
    unsubscribeMatchRef.current?.();
    unsubscribeMatchRef.current = null;
    networkSessionRef.current = null;
    lastNetworkMatchRef.current = null;
    if (session) void session.leave();
    setCfg(null);
    setScreen("menu");
  }, [cfg, settings]);

  if (screen === "game" && cfg) {
    return (
      <main className="fixed inset-0">
        <GameView key={gameKey} cfg={cfg} onRestart={restart} onExit={exitGame} restartError={networkError} />
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

      {screen === "kart" && <KartSelect profile={profile} onChange={saveProfile} onBack={() => go("menu")} />}
      {screen === "settings" && <SettingsPanel settings={settings} touch={touch} onReplayTutorial={() => launchTutorial(0)} onChange={onSettings} onBack={() => go("menu")} />}
      {screen === "lobby" && (process.env.NEXT_PUBLIC_REALTIME_URL
        ? <CloudflareLobby profile={profile} onSession={onNetworkSession} onBack={() => go("menu")} />
        : <Lobby profile={profile} onStart={startGame} onBack={() => go("menu")} />)}

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
