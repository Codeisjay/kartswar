"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "@/game/engine";
import { addScore, loadScores, type ScoreEntry } from "@/game/storage";
import { TEAM_COLORS, WEAPONS, type GameConfig, type GameEvent, type HudState, type KillEntry, type MatchResult } from "@/game/types";
import TouchControls from "./TouchControls";
import ScoreTable from "./Scores";

interface Props {
  cfg: GameConfig;
  onExit: () => void;
  onRestart: () => void;
}

const fmt = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export default function GameView({ cfg, onExit, onRestart }: Props) {
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
  const [vol, setVol] = useState(cfg.settings.master);
  const [result, setResult] = useState<{ r: MatchResult; scores: ScoreEntry[]; rank: number } | null>(null);
  const [bestBefore, setBestBefore] = useState(0);

  const handleEvent = useCallback((e: GameEvent) => {
    const id = performance.now();
    if (e.type === "hurt") setHurtKey((k) => k + 1);
    else if (e.type === "hit") setHit({ id, kill: e.kill });
    else if (e.type === "banner") setBanner({ id, text: e.text, sub: e.sub, color: e.color });
    else if (e.type === "pickup") setToast({ id, text: e.text, color: e.color });
  }, []);

  useEffect(() => {
    if (!mountRef.current || !overlayRef.current) return;
    const best = loadScores().reduce((m, s) => Math.max(m, s.score), 0);
    setBestBefore(best);
    const game = new Game(mountRef.current, overlayRef.current, miniRef.current, cfg, {
      onHud: setHud,
      onKill: (k) => setKills((prev) => [...prev.slice(-4), k]),
      onEvent: handleEvent,
      onEnd: (r) => {
        if (resultRef.current) return;
        resultRef.current = r;
        const entry: ScoreEntry = { name: cfg.profile.name || "Driver", avatar: cfg.profile.avatar, score: r.score, kills: r.kills, mode: r.mode, date: Date.now(), wave: r.mode === "survival" ? r.wave : undefined };
        const { scores, rank } = addScore(entry);
        setResult({ r, scores, rank });
      },
    });
    gameRef.current = game;
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, [cfg, handleEvent]);

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
    if (!hit) return;
    const t = window.setTimeout(() => setHit(null), 320);
    return () => clearTimeout(t);
  }, [hit]);

  const setPause = useCallback((p: boolean) => {
    if (resultRef.current) return;
    gameRef.current?.setPaused(p);
    setPaused(p);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        if (!resultRef.current) setPause(!(gameRef.current?.isPaused() ?? false));
      } else if (e.code === "KeyR" && (resultRef.current || gameRef.current?.isPaused())) {
        onRestart();
      } else if (e.code === "Enter" && resultRef.current) {
        onRestart();
      }
    };
    const onBlur = () => {
      if (!resultRef.current) setPause(true);
    };
    const onVis = () => {
      if (document.hidden) onBlur();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [onRestart, setPause]);

  const hpPct = hud ? (hud.hp / hud.maxHp) * 100 : 100;
  const w = hud?.weapon ? WEAPONS[hud.weapon.id] : null;
  const isTouch = cfg.touch;

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

          {/* bottom left: health */}
          <div className={`pointer-events-none absolute z-10 ${isTouch ? "left-1/2 top-[58px] w-60 -translate-x-1/2" : "bottom-4 left-4 w-72 max-w-[45vw]"}`}>
            <div className="kw-panel px-3 py-2">
              <div className="flex items-end justify-between">
                <span className="kw-display text-sm tracking-widest text-slate-300">HULL {hud.shield > 0 && <span className="text-cyan-300">· SHIELD {hud.shield.toFixed(1)}s</span>}</span>
                <span className="kw-display text-2xl leading-none">{Math.ceil(hud.hp)}</span>
              </div>
              <div className="relative mt-1 h-4 overflow-hidden rounded-full bg-black/60 ring-1 ring-white/20" style={hud.shield > 0 ? { boxShadow: "0 0 14px #38e8ff" } : undefined}>
                <div
                  className="h-full rounded-full transition-[width] duration-150"
                  style={{ width: `${hpPct}%`, background: hpPct > 55 ? "linear-gradient(90deg,#3ddc6a,#9dff3a)" : hpPct > 28 ? "linear-gradient(90deg,#ffb020,#ffe14d)" : "linear-gradient(90deg,#ff2a3a,#ff7a3a)" }}
                />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-widest text-green-300">BOOST</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/60 ring-1 ring-white/10">
                  <div className="h-full rounded-full" style={{ width: `${hud.boostMeter * 100}%`, background: hud.boosting ? "linear-gradient(90deg,#fff,#6dff6d)" : "linear-gradient(90deg,#2fb860,#6dff6d)" }} />
                </div>
                <span className="kw-display w-14 text-right text-sm text-slate-200">{hud.speed} <span className="text-[9px]">KM/H</span></span>
              </div>
              {hud.driftLevel > 0 && (
                <div className="mt-1 flex gap-1">
                  {[1, 2, 3].map((l) => (
                    <div key={l} className="h-1.5 flex-1 rounded-full" style={{ background: hud.driftLevel >= l ? (l === 3 ? "#ff8a1f" : l === 2 ? "#35c8ff" : "#ffffff") : "rgba(255,255,255,0.15)" }} />
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

      {isTouch && !paused && !result && <TouchControls onChange={(t) => gameRef.current?.setTouch(t)} />}

      {/* pause menu */}
      {paused && !result && (
        <div data-ui className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-sm">
          <div className="kw-panel kw-pop w-[min(92vw,420px)] p-7 text-center">
            <h2 className="kw-display kw-title text-6xl">PAUSED</h2>
            <div className="mt-6 flex flex-col items-stretch gap-3">
              <button className="kw-btn" onClick={() => setPause(false)}>
                <span>▶ Resume</span>
              </button>
              <button className="kw-btn cyan" onClick={onRestart}>
                <span>↻ Restart (R)</span>
              </button>
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

      {/* results */}
      {result && (
        <div data-ui className="absolute inset-0 z-40 flex justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm">
          <div className="kw-panel kw-pop my-auto w-[min(96vw,820px)] p-5 sm:p-7">
            <div className="text-center">
              <h2 className="kw-display kw-title text-6xl sm:text-7xl">
                {result.r.mode === "survival" ? "GAME OVER" : result.r.win ? "VICTORY!" : result.r.mode === "team" && result.r.teamScores[0] === result.r.teamScores[1] ? "DRAW" : "DEFEAT"}
              </h2>
              <div className="mt-1 text-sm uppercase tracking-[0.3em] text-slate-300">
                {result.r.mode === "ffa" && `You finished #${result.r.rank}`}
                {result.r.mode === "team" && `Blue ${result.r.teamScores[0]} — ${result.r.teamScores[1]} Red`}
                {result.r.mode === "survival" && `You survived ${result.r.wave} wave${result.r.wave === 1 ? "" : "s"}`}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              <Stat label="Score" value={result.r.score.toLocaleString()} accent />
              <Stat label="Eliminations" value={String(result.r.kills)} />
              <Stat label="Deaths" value={String(result.r.deaths)} />
            </div>
            {result.r.score > bestBefore && result.r.score > 0 && <div className="mt-3 animate-pulse text-center text-lg font-bold text-yellow-300">🏆 NEW PERSONAL BEST!</div>}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="kw-display mb-2 text-lg text-cyan-300">Match leaderboard</h3>
                <div className="overflow-hidden rounded-lg border border-white/10 text-sm">
                  {result.r.rows.slice(0, 8).map((row, i) => (
                    <div key={i} className={`flex items-center gap-2 border-b border-white/5 px-3 py-1.5 last:border-0 ${row.isPlayer ? "bg-yellow-300/15 font-bold text-yellow-100" : ""}`}>
                      <span className="w-4 text-slate-400">{i + 1}</span>
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
              <button className="kw-btn" onClick={onRestart} autoFocus>
                <span>↻ Play Again (R)</span>
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
