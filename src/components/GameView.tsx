"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Game } from "@/game/engine";
import { addScore, awardMatchCredits, loadScores, type ScoreEntry } from "@/game/storage";
import { saveTutorialProgress } from "@/game/storage";
import { KART_PRESETS, TEAM_COLORS, WEAPONS, type GameConfig, type GameEvent, type HudState, type KillEntry, type MatchResult, type NetworkSeat, type TutorialState } from "@/game/types";
import TouchControls from "./TouchControls";
import KartPreview from "./KartPreview";
import ScoreTable from "./Scores";
import { HelpOverlay, TUTORIAL_STEPS, TutorialOverlay } from "./Guidance";

interface Props {
  cfg: GameConfig;
  onExit: () => void;
  onRestart: (match?: { seed: number; startAt: number; players: NetworkSeat[] }) => void;
  restartError?: string;
}

const fmt = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const COIN_OFFSETS = [
  [-46, -22], [-28, -38], [-5, -42], [22, -36], [44, -19], [49, 8],
  [34, 30], [8, 39], [-20, 34], [-43, 16], [-15, 5], [19, 12],
] as const;

export default function GameView({ cfg, onExit, onRestart, restartError }: Props) {
  const isTouch = cfg.touch;
  const mountRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const resultRef = useRef<MatchResult | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [kills, setKills] = useState<KillEntry[]>([]);
  const [banner, setBanner] = useState<{ id: number; text: string; sub?: string; color?: string } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; color: string } | null>(null);
  const [hurtKey, setHurtKey] = useState(0);
  const [hit, setHit] = useState<{ id: number; kill: boolean } | null>(null);
  const [paused, setPaused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [vol, setVol] = useState(cfg.settings.master);
  const [result, setResult] = useState<{ r: MatchResult; scores: ScoreEntry[]; rank: number; creditsEarned: number } | null>(null);
  const [bestBefore, setBestBefore] = useState(0);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(() => new Set());
  const [tutorialStep, setTutorialStep] = useState(cfg.tutorialStep ?? 0);
  const [tutorialState, setTutorialState] = useState<TutorialState | null>(null);
  const [networkError, setNetworkError] = useState("");
  const [isHost, setIsHost] = useState(cfg.net?.isHost ?? false);
  const [restartStartAt, setRestartStartAt] = useState<number | null>(null);
  const [restartCountdown, setRestartCountdown] = useState<number | null>(null);
  const [contextTip, setContextTip] = useState<string | null>(
    cfg.tutorial ? null : cfg.touch ? "◀ ▶ STEER · ▲ ACCELERATE · ▼ BRAKE · FIRE" : "W / ↑ ACCELERATE · SPACE DRIFT · SHIFT BOOST · F FIRE",
  );

  const handleEvent = useCallback((e: GameEvent) => {
    const id = performance.now();
    if (e.type === "hurt") setHurtKey((k) => k + 1);
    else if (e.type === "hit") setHit({ id, kill: e.kill });
    else if (e.type === "banner") {
      setBanner({ id, text: e.text, sub: e.sub, color: e.color });
      if (e.text === "LAVA!") setContextTip("AVOID THE LAVA! GET BACK ON SOLID GROUND");
    } else if (e.type === "pickup") {
      setToast({ id, text: e.text, color: e.color });
      if (e.text.includes("SHIELD")) setContextTip(isTouch ? "SHIELD EQUIPPED · HOLD FIRE TO ACTIVATE" : "SHIELD EQUIPPED · HOLD F TO ACTIVATE");
      else if (e.text.includes("REPAIR")) setContextTip("HULL REPAIRED · KEEP MOVING");
      else setContextTip("POWER-UP COLLECTED · CHECK WEAPON, AMMO & COOLDOWN");
    }
  }, [isTouch]);

  const setPause = useCallback((p: boolean) => {
    if (resultRef.current) return;
    gameRef.current?.setPaused(p);
    setPaused(p);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else {
        setToast({ id: performance.now(), text: "FULLSCREEN IS NOT AVAILABLE", color: "#fca5a5" });
      }
    } catch (error: unknown) {
      console.error("Could not toggle fullscreen", error);
      setToast({ id: performance.now(), text: "FULLSCREEN REQUEST FAILED", color: "#fca5a5" });
    }
  };

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!mountRef.current || !overlayRef.current) return;
    const best = loadScores().reduce((m, s) => Math.max(m, s.score), 0);
    setBestBefore(best);
    const game = new Game(mountRef.current, overlayRef.current, miniRef.current, cfg, {
      onHud: setHud,
      onTutorialState: setTutorialState,
      onKill: (k) => setKills((prev) => [...prev.slice(-4), k]),
      onEvent: handleEvent,
      onEnd: (r) => {
        if (resultRef.current) return;
        resultRef.current = r;
        cfg.network?.finishMatch(cfg.network.matchId);
        if (cfg.net?.isHost) {
          void gameRef.current?.net?.finish().then((response) => {
            if (!response.ok) setNetworkError(response.error ?? "Could not synchronize match end");
          }).catch((error: unknown) => {
            setNetworkError(error instanceof Error ? error.message : "Could not synchronize match end");
          });
        }
        const entry: ScoreEntry = { name: cfg.profile.name || "Driver", avatar: cfg.profile.avatar, score: r.score, kills: r.kills, mode: r.mode, date: Date.now(), wave: r.mode === "survival" ? r.wave : undefined };
        const { scores, rank } = addScore(entry);
        const creditsEarned = awardMatchCredits(r.score, r.win);
        setResult({ r, scores, rank, creditsEarned });
      },
      onNetworkCountdown: setRestartStartAt,
      onNetworkRestart: (seed, startAt, players) => onRestart({ seed, startAt, players }),
      onNetworkHostChange: setIsHost,
      onNetworkMatchEnd: () => setPause(false),
    });
    gameRef.current = game;
    const removePageExitHandler = game.net?.watchPageExit();
    return () => {
      removePageExitHandler?.();
      game.dispose();
      gameRef.current = null;
    };
  }, [cfg, handleEvent, onRestart, setPause]);

  useEffect(() => {
    if (!cfg.net) return;
    const timerId = window.setInterval(() => {
      void gameRef.current?.net?.heartbeat().then((response) => {
        if (!response.ok) setNetworkError(response.error ?? "Room connection was lost");
        else setNetworkError("");
      }).catch((error: unknown) => {
        setNetworkError(error instanceof Error ? error.message : "Room connection was lost");
      });
    }, 15_000);
    return () => window.clearInterval(timerId);
  }, [cfg.net]);

  useEffect(() => {
    if (restartStartAt === null) return;
    const update = () => {
      const now = Date.now() + (cfg.net?.serverOffset ?? 0);
      setRestartCountdown(Math.max(0, Math.ceil((restartStartAt - now) / 1_000)));
    };
    update();
    const timerId = window.setInterval(update, 100);
    return () => window.clearInterval(timerId);
  }, [cfg.net?.serverOffset, restartStartAt]);

  useEffect(() => {
    if (cfg.tutorial) gameRef.current?.setTutorialStep(tutorialStep);
  }, [cfg.tutorial, tutorialStep]);

  useEffect(() => {
    if (!cfg.tutorial) return;
    saveTutorialProgress({ seen: true, completed: false, step: tutorialStep });
  }, [cfg.tutorial, tutorialStep]);

  // expire kill feed
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now();
      setKills((prev) => (prev.some((k) => now - k.t > 6000) ? prev.filter((k) => now - k.t <= 6000) : prev));
    }, 800);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 1700);
    return () => clearTimeout(t);
  }, [banner]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1300);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!contextTip) return;
    const t = window.setTimeout(() => setContextTip(null), 4500);
    return () => clearTimeout(t);
  }, [contextTip]);
  useEffect(() => {
    if (!hit) return;
    const t = window.setTimeout(() => setHit(null), 320);
    return () => clearTimeout(t);
  }, [hit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setPressedKeys((previous) => {
        if (previous.has(e.code)) return previous;
        const next = new Set(previous);
        next.add(e.code);
        return next;
      });
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        if (!resultRef.current) setPause(!(gameRef.current?.isPaused() ?? false));
      } else if (e.code === "KeyR" && (resultRef.current || (!cfg.network && !cfg.net && gameRef.current?.isPaused()))) {
        if ((!cfg.net && !cfg.network) || isHost || cfg.network?.canControlMatch()) onRestart();
      } else if (e.code === "Enter" && resultRef.current) {
        if ((!cfg.net && !cfg.network) || isHost || cfg.network?.canControlMatch()) onRestart();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      setPressedKeys((previous) => {
        if (!previous.has(e.code)) return previous;
        const next = new Set(previous);
        next.delete(e.code);
        return next;
      });
    };
    const onBlur = () => {
      if (!resultRef.current) setPause(true);
    };
    const onVis = () => {
      if (document.hidden) onBlur();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [cfg.net, cfg.network, isHost, onRestart, setPause]);

  const tutorialProgress = (() => {
    if (!cfg.tutorial || !tutorialState) return { canContinue: false, detail: "Waiting for controls…" };
    switch (tutorialStep) {
      case 0: return { canContinue: tutorialState.throttle > 0 && tutorialState.speed >= 8, detail: `Speed ${Math.round(tutorialState.speed)} / 8 KM/H` };
      case 1: return { canContinue: tutorialState.steeredLeft && tutorialState.steeredRight, detail: "Turn both directions" };
      case 2: return { canContinue: tutorialState.reversed, detail: "Reverse to continue" };
      case 3: return { canContinue: tutorialState.distance >= 25, detail: `${Math.min(25, Math.round(tutorialState.distance))} / 25 M` };
      case 4: return { canContinue: tutorialState.boosting, detail: "Hold boost" };
      case 5: return { canContinue: tutorialState.distance >= 60, detail: `${Math.min(60, Math.round(tutorialState.distance))} / 60 M` };
      case 6: return { canContinue: tutorialState.targetInRange, detail: "Face the cyan practice target" };
      case 7: return { canContinue: tutorialState.targetHits > 0, detail: "Land a hit on the target" };
      case 8: return { canContinue: tutorialState.pickupCount > 0 && tutorialState.weapon === "shield", detail: "Collect the shield box" };
      case 9: return { canContinue: tutorialState.shield > 0, detail: "Hold fire to activate shield" };
      default: return { canContinue: false, detail: "Complete the objective" };
    }
  })();

  const changeTutorialStep = (next: number) => {
    setTutorialStep(Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, next)));
  };
  const skipTutorial = () => {
    saveTutorialProgress({ seen: true, completed: true, step: TUTORIAL_STEPS.length - 1 });
    onExit();
  };
  const finishTutorial = () => {
    saveTutorialProgress({ seen: true, completed: true, step: TUTORIAL_STEPS.length });
    onExit();
  };

  const hpPct = hud ? (hud.hp / hud.maxHp) * 100 : 100;
  const w = hud?.weapon ? WEAPONS[hud.weapon.id] : null;
  const winner = result?.r.winner ?? null;
  const winnerPreset = winner ? KART_PRESETS.find((preset) => preset.id === winner.kartId) ?? KART_PRESETS[0] : null;
  const winnerProfile = winner && winnerPreset
    ? { ...cfg.profile, name: winner.name, avatar: winner.avatar, kartId: winner.kartId, glow: winnerPreset.glow, paintId: "factory", wheelStyle: "stock" }
    : null;

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <div ref={mountRef} className="absolute inset-0" />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0 overflow-hidden" />

      {/* screen feedback */}
      {hurtKey > 0 && <div key={hurtKey} className="kw-hurt pointer-events-none absolute inset-0" />}
      {hud && hud.alive && hpPct < 30 && hud.phase === "playing" && <div className="kw-lowhp pointer-events-none absolute inset-0" />}
      {hit && (
        <div key={hit.id} className="kw-hit pointer-events-none absolute left-1/2 top-1/2 z-10">
          <div className={`relative ${hit.kill ? "h-10 w-10" : "h-6 w-6"}`}>
            <div className={`absolute left-1/2 top-0 h-full w-[3px] -translate-x-1/2 ${hit.kill ? "bg-red-500" : "bg-white"}`} />
            <div className={`absolute left-0 top-1/2 h-[3px] w-full -translate-y-1/2 ${hit.kill ? "bg-red-500" : "bg-white"}`} />
          </div>
        </div>
      )}

      {hud && (
        <>
          {/* top center: timer / score */}
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 text-center">
            <div className="kw-panel flex items-center gap-4 px-5 py-1.5">
              {hud.mode === "team" && (
                <div className="kw-display text-2xl" style={{ color: hex(TEAM_COLORS[0]) }}>
                  {hud.teamScores[0]}
                </div>
              )}
              <div>
                {hud.mode === "survival" ? (
                  <>
                    <div className="kw-display text-2xl leading-none text-rose-300">WAVE {Math.max(1, hud.wave)}</div>
                    <div className="text-[11px] tracking-widest text-slate-300">
                      {fmt(hud.timeLeft)} · {"❤️".repeat(Math.max(0, hud.lives))}
                      {"🖤".repeat(Math.max(0, 3 - hud.lives))}
                    </div>
                  </>
                ) : (
                  <div className={`kw-display text-3xl leading-none ${hud.timeLeft <= 10 ? "animate-pulse text-red-400" : "text-white"}`}>{fmt(hud.timeLeft)}</div>
                )}
              </div>
              {hud.mode === "team" && (
                <div className="kw-display text-2xl" style={{ color: hex(TEAM_COLORS[1]) }}>
                  {hud.teamScores[1]}
                </div>
              )}
            </div>
          </div>

          {/* top left: score + kills */}
          <div className="pointer-events-none absolute left-3 top-3 z-10" style={{ marginTop: isTouch ? 126 : 0 }}>
            <div className="kw-panel px-4 py-2">
              <div className="kw-display text-3xl leading-none text-yellow-300">{hud.score.toLocaleString()}</div>
              <div className="mt-1 flex gap-3 text-xs font-bold tracking-wider text-slate-200">
                <span>💀 {hud.kills}</span>
                <span className="text-slate-400">☠ {hud.deaths}</span>
                {hud.streak >= 2 && <span className="text-orange-300">🔥 x{hud.streak}</span>}
              </div>
            </div>
          </div>

          {/* top right: pause, leaderboard, killfeed */}
          <div className="absolute right-3 top-3 z-20 flex w-56 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {cfg.settings.showFps && <span className="rounded bg-black/50 px-2 py-0.5 text-[11px] text-green-300">{hud.fps} FPS</span>}
              <button data-ui onClick={() => setHelpOpen(true)} className="kw-chip pointer-events-auto h-9 px-2 text-xs font-bold" aria-label="Help and controls">
                HELP
              </button>
              {isTouch && (
                <button
                  data-ui
                  onClick={() => void toggleFullscreen()}
                  className="kw-chip kw-landscape-fullscreen pointer-events-auto h-9 w-9 text-lg font-bold"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  aria-pressed={isFullscreen}
                  title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  ⛶
                </button>
              )}
              <button data-ui onClick={() => setPause(true)} className="kw-chip pointer-events-auto h-9 w-9 text-sm font-bold" aria-label="Pause">
                ❚❚
              </button>
            </div>
            <div className={`kw-panel pointer-events-none w-full px-2 py-1.5 ${isTouch ? "hidden" : "hidden sm:block"}`}>
              {hud.top.map((r, i) => (
                <div key={i} className={`flex items-center gap-1.5 px-1 text-[12px] leading-5 ${r.isPlayer ? "font-bold text-yellow-200" : "text-slate-200"}`}>
                  <span className="w-3 text-slate-400">{i + 1}</span>
                  {hud.mode === "team" && <span className="h-2 w-2 rounded-full" style={{ background: hex(TEAM_COLORS[r.team] ?? 0xffffff) }} />}
                  <span>{r.avatar}</span>
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="tabular-nums">{r.score}</span>
                </div>
              ))}
            </div>
            <div className="pointer-events-none flex w-full flex-col items-end gap-1">
              {kills.map((k) => (
                <div key={k.id} className={`kw-feed flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] font-bold ${k.involvesPlayer ? "bg-yellow-400/30 ring-1 ring-yellow-300" : "bg-black/50"}`}>
                  {k.killer ? <span style={{ color: k.killerTeam >= 0 && hud.mode === "team" ? hex(TEAM_COLORS[k.killerTeam]) : "#fff" }}>{k.killer}</span> : null}
                  <span>{k.icon}</span>
                  <span className="text-slate-300" style={{ color: k.victimTeam >= 0 && hud.mode === "team" ? hex(TEAM_COLORS[k.victimTeam]) : undefined }}>
                    {k.victim}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* vehicle status */}
          <div className={`pointer-events-none absolute z-10 ${isTouch ? "right-3 top-[82px] w-36" : "bottom-4 left-4 w-72 max-w-[45vw]"}`}>
            <div className={`kw-panel ${isTouch ? "px-2 py-1.5" : "px-3 py-2"}`}>
              <div className="flex items-end justify-between">
                <span className={`kw-display tracking-widest text-slate-300 ${isTouch ? "text-[10px]" : "text-sm"}`}>
                  HULL {hud.shield > 0 && <span className="text-cyan-300">· SHIELD {hud.shield.toFixed(1)}s</span>}
                </span>
                <span className={`kw-display leading-none ${isTouch ? "text-lg" : "text-2xl"}`}>{Math.ceil(hud.hp)}</span>
              </div>
              <div className={`relative mt-1 overflow-hidden rounded-full bg-black/60 ring-1 ring-white/20 ${isTouch ? "h-2" : "h-4"}`} style={hud.shield > 0 ? { boxShadow: "0 0 14px #38e8ff" } : undefined}>
                <div
                  className="h-full rounded-full transition-[width] duration-150"
                  style={{ width: `${hpPct}%`, background: hpPct > 55 ? "linear-gradient(90deg,#3ddc6a,#9dff3a)" : hpPct > 28 ? "linear-gradient(90deg,#ffb020,#ffe14d)" : "linear-gradient(90deg,#ff2a3a,#ff7a3a)" }}
                />
              </div>
              <div className={`flex items-center ${isTouch ? "mt-1 gap-1" : "mt-2 gap-2"}`}>
                <span className={`font-bold tracking-widest text-green-300 ${isTouch ? "text-[8px]" : "text-[10px]"}`}>BOOST</span>
                <div className={`flex-1 overflow-hidden rounded-full bg-black/60 ring-1 ring-white/10 ${isTouch ? "h-1.5" : "h-2"}`}>
                  <div className="h-full rounded-full" style={{ width: `${hud.boostMeter * 100}%`, background: hud.boosting ? "linear-gradient(90deg,#fff,#6dff6d)" : "linear-gradient(90deg,#2fb860,#6dff6d)" }} />
                </div>
                <span className={`kw-display text-right text-slate-200 ${isTouch ? "w-12 text-xs" : "w-14 text-sm"}`}>{hud.speed} <span className={isTouch ? "text-[7px]" : "text-[9px]"}>KM/H</span></span>
              </div>
              {hud.driftLevel > 0 && (
                <div className="mt-1 flex gap-1">
                  {[1, 2, 3].map((l) => (
                    <div key={l} className={`flex-1 rounded-full ${isTouch ? "h-1" : "h-1.5"}`} style={{ background: hud.driftLevel >= l ? (l === 3 ? "#ff8a1f" : l === 2 ? "#35c8ff" : "#ffffff") : "rgba(255,255,255,0.15)" }} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* bottom center: weapon */}
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2" style={{ transform: isTouch ? "translateX(-50%) scale(0.8)" : undefined, transformOrigin: "bottom center" }}>
            <div className="kw-panel relative flex w-56 items-center gap-3 px-3 py-2" style={{ borderColor: w ? w.color : undefined, boxShadow: w ? `0 0 24px ${w.color}55` : undefined }}>
              <div className="relative flex h-14 w-14 items-center justify-center rounded-lg bg-black/50 text-3xl">
                {w ? w.icon : "∅"}
                {w && hud.cooldownFrac > 0 && <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/60" style={{ height: `${hud.cooldownFrac * 100}%` }} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="kw-display truncate text-base leading-tight" style={{ color: w?.color ?? "#94a3b8" }}>
                  {w ? w.name : "NO WEAPON"}
                </div>
                {hud.weapon ? (
                  hud.weapon.maxAmmo <= 3 ? (
                    <div className="mt-1 flex gap-1">
                      {Array.from({ length: hud.weapon.maxAmmo }).map((_, i) => (
                        <div key={i} className="h-2.5 w-6 rounded-sm" style={{ background: i < hud.weapon!.ammo ? w!.color : "rgba(255,255,255,0.15)" }} />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 h-2.5 overflow-hidden rounded-sm bg-white/15">
                      <div className="h-full" style={{ width: `${(hud.weapon.ammo / hud.weapon.maxAmmo) * 100}%`, background: w!.color }} />
                    </div>
                  )
                ) : (
                  <div className="text-[11px] text-slate-400">Grab a glowing box!</div>
                )}
              </div>
            </div>
          </div>

          {/* minimap */}
          <div className={`pointer-events-none absolute z-10 ${isTouch ? "left-3 top-3" : "bottom-4 right-4"}`}>
            <canvas ref={miniRef} width={190} height={190} className={isTouch ? "h-[118px] w-[118px]" : "h-[190px] w-[190px]"} style={{ filter: "drop-shadow(0 0 12px rgba(53,232,255,0.35))" }} />
          </div>

          {/* countdown */}
          {hud.phase === "intro" && hud.countdown > 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
              <div key={hud.countdown} className="kw-count kw-display kw-title text-[10rem] leading-none">
                {hud.countdown}
              </div>
              <div className={`kw-panel mt-6 px-5 py-3 text-center text-sm text-slate-200 ${isTouch ? "hidden" : "hidden sm:block"}`}>
                <b className="text-cyan-300">WASD</b> drive · <b className="text-cyan-300">SPACE</b> drift (release for turbo) · <b className="text-cyan-300">SHIFT</b> boost ·{" "}
                <b className="text-cyan-300">F</b> fire (shoots forward)
              </div>
            </div>
          )}

          {/* death */}
          {!hud.alive && hud.phase === "playing" && (
            <div className="pointer-events-none absolute inset-x-0 top-1/3 z-10 text-center">
              <div className="kw-display text-6xl text-red-400 drop-shadow-[0_0_20px_rgba(255,0,40,0.7)]">ELIMINATED</div>
              {hud.mode === "survival" && hud.lives <= 0 ? null : <div className="mt-2 text-lg text-slate-200">Respawning in {Math.ceil(hud.respawnIn)}…</div>}
            </div>
          )}
        </>
      )}

      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-[22%] z-20 text-center">
          <div key={banner.id} className="kw-banner kw-display text-6xl sm:text-7xl" style={{ color: banner.color ?? "#fff", textShadow: `0 4px 0 #000, 0 0 30px ${banner.color ?? "#fff"}` }}>
            {banner.text}
            {banner.sub && <div className="mt-1 text-xl tracking-widest text-white/90">{banner.sub}</div>}
          </div>
        </div>
      )}
      {toast && (
        <div key={toast.id} className="kw-pop pointer-events-none absolute inset-x-0 top-[62%] z-10 text-center">
          <span className="kw-display rounded-full bg-black/60 px-5 py-1 text-2xl" style={{ color: toast.color, boxShadow: `0 0 20px ${toast.color}66` }}>
            {toast.text}
          </span>
        </div>
      )}

      {contextTip && !paused && !result && !cfg.tutorial && (
        <div className="pointer-events-none absolute left-1/2 top-[16%] z-20 -translate-x-1/2">
          <div className="rounded-full border border-cyan-300/25 bg-black/50 px-3 py-1 text-center text-[10px] font-bold tracking-wider text-cyan-100 backdrop-blur-sm sm:text-xs">
            {contextTip}
          </div>
        </div>
      )}
      {networkError && !result && <div className="pointer-events-none absolute left-1/2 top-[12%] z-30 -translate-x-1/2 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100">{networkError}</div>}

      {cfg.tutorial && !paused && !result && tutorialState && (
        <TutorialOverlay
          stepIndex={tutorialStep}
          state={tutorialState}
          touch={isTouch}
          pressedKeys={pressedKeys}
          objectiveProgress={tutorialProgress.detail}
          canContinue={tutorialProgress.canContinue}
          onBack={() => changeTutorialStep(tutorialStep - 1)}
          onNext={() => changeTutorialStep(tutorialStep + 1)}
          onSkipStep={() => tutorialStep === TUTORIAL_STEPS.length - 1 ? finishTutorial() : changeTutorialStep(tutorialStep + 1)}
          onSkipTutorial={skipTutorial}
          onFinish={finishTutorial}
        />
      )}

      {isTouch && !paused && !result && <TouchControls onChange={(t) => gameRef.current?.setTouch(t)} />}

      {/* pause menu */}
      {paused && !result && (
        <div data-ui className="absolute inset-0 z-40 flex justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm">
          <div className="kw-panel kw-pop my-auto w-[min(92vw,420px)] shrink-0 p-7 text-center">
            <h2 className="kw-display kw-title text-6xl">PAUSED</h2>
            <div className="mt-6 flex flex-col items-stretch gap-3">
              <button className="kw-btn" onClick={() => setPause(false)}>
                <span>▶ Resume</span>
              </button>
              <button
                className="kw-btn cyan"
                disabled={(!!cfg.net && !isHost) || (!!cfg.network && !cfg.network.canControlMatch())}
                onClick={() => onRestart()}
              >
                <span>{cfg.network && !cfg.network.canControlMatch() ? "Restart after match" : "↻ Restart (R)"}</span>
              </button>
              <button className="kw-btn ghost" onClick={() => setHelpOpen(true)}>
                <span>⌘ Help / Controls</span>
              </button>
              {cfg.tutorial && <button className="kw-btn ghost" onClick={skipTutorial}><span>Skip Tutorial</span></button>}
              <button className="kw-btn ghost" onClick={onExit}>
                <span>⌂ Quit to Menu</span>
              </button>
            </div>
            <label className="mt-6 block text-left text-xs uppercase tracking-widest text-slate-300">
              Master volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={vol}
                className="mt-1 w-full"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVol(v);
                  gameRef.current?.setMasterVolume(v);
                }}
              />
            </label>
            <p className="mt-4 text-[11px] text-slate-400">ESC / P to resume</p>
          </div>
        </div>
      )}

      {helpOpen && <HelpOverlay touch={isTouch} onClose={() => setHelpOpen(false)} />}

      {/* results */}
      {result && (
        <div data-ui className="absolute inset-0 z-40 flex justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm">
          <div className="kw-panel kw-pop my-auto w-[min(96vw,820px)] p-5 sm:p-7">
            <div className="text-center">
              <h2 className="kw-display kw-title text-6xl sm:text-7xl">
                {result.r.mode === "survival" ? "GAME OVER" : result.r.draw ? "DRAW" : result.r.win ? "VICTORY!" : "DEFEAT"}
              </h2>
              <div className="mt-1 text-sm uppercase tracking-[0.3em] text-slate-300">
                {result.r.mode === "ffa" && `${result.r.draw ? "Tied for" : "You finished"} #${result.r.rank}`}
                {result.r.mode === "team" && `Blue ${result.r.teamScores[0]} — ${result.r.teamScores[1]} Red`}
                {result.r.mode === "survival" && `You survived ${result.r.wave} wave${result.r.wave === 1 ? "" : "s"}`}
              </div>
              {(restartError || networkError) && <div className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-center text-sm text-red-200">{restartError || networkError}</div>}
              {restartCountdown !== null && <div className="mt-3 text-center text-sm uppercase tracking-[0.3em] text-cyan-200">Match starts in {restartCountdown}</div>}
            </div>
            {winner && winnerProfile && (
              <div className="mt-4 flex flex-col items-center overflow-hidden rounded-xl border border-yellow-300/25 bg-gradient-to-r from-yellow-300/10 via-black/25 to-cyan-300/10 px-3 sm:flex-row sm:justify-between">
                <div className="py-3 text-center sm:px-3 sm:text-left">
                  <div className="kw-display text-sm tracking-[0.25em] text-yellow-200">🏆 Winner Kart</div>
                  <div className="mt-1 text-xl font-black text-white">{winner.avatar} {winner.name}</div>
                  <div className="text-xs uppercase tracking-widest text-cyan-100">{winnerPreset?.name ?? "Kart"} · {result.r.mode === "team" ? `Team ${winner.team === 0 ? "Blue" : "Red"}` : "Match champion"}</div>
                </div>
                <div className="h-36 w-full max-w-[260px] shrink-0 sm:h-32">
                  <KartPreview profile={winnerProfile} />
                </div>
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <Stat label="Score" value={result.r.score.toLocaleString()} accent />
              <Stat label="Eliminations" value={String(result.r.kills)} />
              <Stat label="Deaths" value={String(result.r.deaths)} />
              <div className="relative">
                <Stat label="Credits earned" value={`+${result.creditsEarned}`} accent />
                <div key={result.r.duration} aria-hidden="true" className="pointer-events-none absolute inset-0">
                  {COIN_OFFSETS.map(([x, y], index) => (
                    <span
                      key={index}
                      className="kw-coin-flight"
                      style={{
                        "--coin-x": `${x}px`,
                        "--coin-y": `${y}px`,
                        animationDelay: `${(index % 4) * 0.065}s`,
                      } as CSSProperties}
                    >
                      🪙
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {result.r.score > bestBefore && result.r.score > 0 && <div className="mt-3 animate-pulse text-center text-lg font-bold text-yellow-300">🏆 NEW PERSONAL BEST!</div>}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="kw-display mb-2 text-lg text-cyan-300">Match leaderboard</h3>
                <div className="overflow-hidden rounded-lg border border-white/10 text-sm">
                  {result.r.rows.slice(0, 8).map((row, i) => (
                    <div key={i} className={`flex items-center gap-2 border-b border-white/5 px-3 py-1.5 last:border-0 ${row.isPlayer ? "bg-yellow-300/15 font-bold text-yellow-100" : ""}`}>
                      <span className="w-4 text-slate-400">
                        {1 + result.r.rows.filter((other) => other.score > row.score
                          || (other.score === row.score && other.kills > row.kills)
                          || (other.score === row.score && other.kills === row.kills && other.deaths < row.deaths)).length}
                      </span>
                      {result.r.mode === "team" && <span className="h-2.5 w-2.5 rounded-full" style={{ background: hex(TEAM_COLORS[row.team] ?? 0xffffff) }} />}
                      <span>{row.avatar}</span>
                      <span className="flex-1 truncate">{row.name}</span>
                      <span className="text-xs text-slate-400">
                        {row.kills}/{row.deaths}
                      </span>
                      <span className="kw-display w-14 text-right">{row.score}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="kw-display mb-2 text-lg text-pink-300">Your high scores</h3>
                <ScoreTable scores={result.scores} highlight={result.rank} limit={6} />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                className="kw-btn"
                disabled={(!!cfg.network && !cfg.network.canControlMatch()) || (!!cfg.net && !isHost)}
                onClick={() => onRestart()}
                autoFocus
              >
                <span>{((cfg.network && !cfg.network.canControlMatch()) || (cfg.net && !isHost)) ? "Waiting for host" : cfg.net ? "↻ Restart Match" : "↻ Play Again (R)"}</span>
              </button>
              <button className="kw-btn ghost" onClick={onExit}>
                <span>⌂ Main Menu</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
      <div className={`kw-display text-4xl leading-none ${accent ? "text-yellow-300" : "text-white"}`}>{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-widest text-slate-400">{label}</div>
    </div>
  );
}
