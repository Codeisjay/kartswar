"use client";

import { useEffect, useRef, useState } from "react";
import { audio } from "@/game/audio";
import { makeRoster, modeFromCode, randomCode } from "@/game/roster";
import { TEAM_COLORS, type Mode, type Profile, type RosterEntry } from "@/game/types";

interface Seat {
  name: string;
  avatar: string;
  ai: boolean;
  you: boolean;
  host: boolean;
  ready: boolean;
  entry?: RosterEntry;
}

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "ffa", label: "Free For All", icon: "💥" },
  { id: "team", label: "Team Battle", icon: "🛡️" },
];
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export default function Lobby({ profile, onStart, onBack }: { profile: Profile; onStart: (mode: Mode, roster: RosterEntry[]) => void; onBack: () => void }) {
  const [tab, setTab] = useState<"quick" | "create" | "join">("quick");
  const [mode, setMode] = useState<Mode>("ffa");
  const [seats, setSeats] = useState<Seat[]>([]);
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState<"idle" | "searching" | "found" | "room">("idle");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  const you: Seat = { name: profile.name || "Driver", avatar: profile.avatar, ai: false, you: true, host: false, ready: true };

  const clear = () => {
    if (timer.current) {
      clearInterval(timer.current);
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clear, []);

  const reset = () => {
    clear();
    setSeats([]);
    setStatus("idle");
    setCountdown(null);
    setCode("");
    setError("");
  };

  const launch = (m: Mode, list: Seat[]) => {
    const roster = list.filter((s) => !s.you).map((s) => s.entry as RosterEntry);
    onStart(m, roster);
  };

  const startCountdown = (m: Mode, list: Seat[]) => {
    clear();
    let c = 3;
    setCountdown(c);
    audio.sfx("beep");
    timer.current = window.setInterval(() => {
      c--;
      if (c <= 0) {
        clear();
        launch(m, list);
      } else {
        setCountdown(c);
        audio.sfx("beep");
      }
    }, 900);
  };

  // ---- quick match
  const findMatch = () => {
    audio.init();
    reset();
    setStatus("searching");
    const target = 6 + Math.floor(Math.random() * 3);
    const pool = makeRoster(7);
    let list: Seat[] = [{ ...you, ready: true }];
    setSeats(list);
    timer.current = window.setInterval(() => {
      if (list.length >= target) {
        clear();
        setStatus("found");
        audio.sfx("pickup");
        window.setTimeout(() => startCountdown(mode, list), 600);
        return;
      }
      const e = pool[list.length - 1];
      list = [...list, { name: e.name, avatar: e.avatar, ai: true, you: false, host: false, ready: true, entry: e }];
      setSeats(list);
      audio.sfx("click");
    }, 650);
  };

  // ---- private room
  const createRoom = () => {
    reset();
    setCode(randomCode());
    setSeats([{ ...you, host: true }]);
    setStatus("room");
  };
  const addAi = () => {
    setSeats((cur) => {
      if (cur.length >= 8) return cur;
      const pool = makeRoster(8, undefined, cur.map((s) => s.name));
      const e = pool[0];
      return [...cur, { name: e.name, avatar: e.avatar, ai: true, you: false, host: false, ready: true, entry: e }];
    });
    audio.sfx("click");
  };
  const fillAi = () => {
    setSeats((cur) => {
      const need = 8 - cur.length;
      const pool = makeRoster(need, undefined, cur.map((s) => s.name));
      return [...cur, ...pool.map((e) => ({ name: e.name, avatar: e.avatar, ai: true, you: false, host: false, ready: true, entry: e }))];
    });
  };
  const kick = (i: number) => setSeats((cur) => cur.filter((_, idx) => idx !== i));

  // ---- join room
  const joinRoom = () => {
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) {
      setError("Room codes are 5 letters/numbers.");
      return;
    }
    reset();
    const m = modeFromCode(c);
    const n = 3 + (c.charCodeAt(0) % 4);
    const roster = makeRoster(n, c);
    setMode(m);
    setCode(c);
    setSeats([
      { name: roster[0].name, avatar: roster[0].avatar, ai: true, you: false, host: true, ready: true, entry: roster[0] },
      { ...you, ready: false },
      ...roster.slice(1).map((e) => ({ name: e.name, avatar: e.avatar, ai: true, you: false, host: false, ready: true, entry: e })),
    ]);
    setStatus("room");
    audio.sfx("pickup");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const slots = Array.from({ length: 8 }, (_, i) => seats[i] ?? null);
  const isHost = tab === "create";
  const youSeat = seats.find((s) => s.you);

  return (
    <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <h2 className="kw-display kw-title text-5xl">Multiplayer</h2>
        <button
          className="kw-btn ghost small"
          onClick={() => {
            clear();
            onBack();
          }}
        >
          <span>← Back</span>
        </button>
      </div>

      <div className="mx-auto mt-3 w-full max-w-5xl rounded-lg border border-yellow-300/30 bg-yellow-300/10 px-3 py-2 text-xs text-yellow-100">
        ⚠ Online servers aren&apos;t connected in this build — rooms and matchmaking run offline and empty seats are filled by AI drivers. The game core separates input from simulation so a network transport can plug in later.
      </div>

      <div className="mx-auto mt-4 grid w-full max-w-5xl gap-5 lg:grid-cols-[320px_1fr]">
        <div className="kw-panel space-y-4 p-4">
          <div className="grid grid-cols-3 gap-1.5">
            {(["quick", "create", "join"] as const).map((t) => (
              <button
                key={t}
                className={`kw-chip py-2 text-xs font-bold uppercase tracking-wider ${tab === t ? "active" : ""}`}
                onClick={() => {
                  setTab(t);
                  reset();
                }}
              >
                {t === "quick" ? "Quick Match" : t === "create" ? "Create Room" : "Join Room"}
              </button>
            ))}
          </div>

          {tab !== "join" && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">Game mode</div>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((m) => (
                  <button key={m.id} disabled={status === "searching" || status === "found"} className={`kw-chip px-2 py-2 text-sm font-bold ${mode === m.id ? "active" : ""}`} onClick={() => setMode(m.id)}>
                    <div className="text-xl">{m.icon}</div>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "quick" && (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">Jump into the next available arena. We&apos;ll gather up to 8 drivers.</p>
              {status === "searching" || status === "found" ? (
                <button className="kw-btn ghost w-full" onClick={reset}>
                  <span>✕ Cancel</span>
                </button>
              ) : (
                <button className="kw-btn w-full" onClick={findMatch}>
                  <span>🔍 Find Match</span>
                </button>
              )}
            </div>
          )}

          {tab === "create" && (
            <div className="space-y-2">
              {status !== "room" ? (
                <button className="kw-btn cyan w-full" onClick={createRoom}>
                  <span>＋ Create Private Room</span>
                </button>
              ) : (
                <>
                  <div className="rounded-xl border border-cyan-300/40 bg-black/40 p-3 text-center">
                    <div className="text-[11px] uppercase tracking-widest text-slate-400">Join code</div>
                    <div className="kw-display text-5xl tracking-[0.2em] text-cyan-300">{code}</div>
                    <button className="kw-chip mt-1 px-3 py-1 text-xs" onClick={copy}>
                      {copied ? "✔ Copied" : "Copy code"}
                    </button>
                  </div>
                  <button className="kw-btn ghost small w-full" onClick={fillAi} disabled={seats.length >= 8}>
                    <span>🤖 Fill with AI</span>
                  </button>
                  <button className="kw-btn w-full" disabled={seats.length < 2 || countdown !== null} onClick={() => startCountdown(mode, seats)}>
                    <span>▶ Start Match</span>
                  </button>
                </>
              )}
            </div>
          )}

          {tab === "join" && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-slate-400">Enter room code</div>
              <input
                value={joinCode}
                maxLength={5}
                onChange={(e) => {
                  setJoinCode(e.target.value.toUpperCase());
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                placeholder="ABCDE"
                className="kw-display w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-center text-3xl tracking-[0.3em] outline-none focus:border-cyan-300"
              />
              {error && <div className="text-sm text-red-300">{error}</div>}
              <button className="kw-btn pink w-full" onClick={joinRoom}>
                <span>→ Join Room</span>
              </button>
              {status === "room" && youSeat && (
                <button
                  className="kw-btn w-full"
                  disabled={countdown !== null}
                  onClick={() => {
                    const next = seats.map((s) => (s.you ? { ...s, ready: true } : s));
                    setSeats(next);
                    startCountdown(mode, next);
                  }}
                >
                  <span>✔ Ready Up</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="kw-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="kw-display text-2xl text-white">
              {status === "searching" ? "Searching for drivers…" : status === "found" ? "Match found!" : status === "room" ? `Room ${code}` : "Lobby"}
            </div>
            <div className="text-sm text-slate-300">
              {seats.length}/8 · {MODES.find((m) => m.id === mode)?.label}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((s, i) => {
              const teamCol = mode === "team" ? hex(TEAM_COLORS[i % 2]) : undefined;
              return (
                <div key={i} className={`flex h-[58px] items-center gap-3 rounded-xl border px-3 ${s ? "border-white/15 bg-white/5" : "border-dashed border-white/10 bg-black/20"}`} style={s && teamCol ? { borderLeft: `4px solid ${teamCol}` } : undefined}>
                  {s ? (
                    <>
                      <div className="kw-pop flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-2xl">{s.avatar}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">
                          {s.name} {s.you && <span className="text-cyan-300">(you)</span>}
                        </div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">
                          {s.host ? "Host · " : ""}
                          {s.ai ? "AI driver" : "Player"} · <span className={s.ready ? "text-green-300" : "text-yellow-300"}>{s.ready ? "Ready" : "Not ready"}</span>
                        </div>
                      </div>
                      {isHost && s.ai && !countdown && (
                        <button className="kw-chip px-2 py-1 text-xs" onClick={() => kick(i)}>
                          ✕
                        </button>
                      )}
                    </>
                  ) : isHost && status === "room" ? (
                    <button className="kw-chip w-full py-2 text-sm text-slate-300" onClick={addAi}>
                      ＋ Add AI driver
                    </button>
                  ) : (
                    <div className="w-full text-center text-sm text-slate-500">{status === "searching" ? "Searching…" : "Empty seat"}</div>
                  )}
                </div>
              );
            })}
          </div>
          {countdown !== null && (
            <div className="mt-4 text-center">
              <div className="text-xs uppercase tracking-[0.4em] text-slate-300">Match starts in</div>
              <div className="kw-display kw-title text-7xl">{countdown}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
