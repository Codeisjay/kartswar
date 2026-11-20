"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { audio } from "@/game/audio";
import { MAPS, mapDef } from "@/game/maps";
import { RoomNet, type NetPlayer, type NetRoom } from "@/game/net";
import { makeRoster, randomCode } from "@/game/roster";
import { BOT_NAMES, TEAM_COLORS, type Mode, type Profile, type RemoteDesc, type RosterEntry } from "@/game/types";

export interface LaunchOpts {
  mode: Mode;
  mapId: string;
  roster: RosterEntry[];
  remotes?: RemoteDesc[];
  net?: { code: string; playerId: string };
  seed?: number;
}

interface Seat {
  id: string;
  name: string;
  avatar: string;
  kartId: number;
  isAi: boolean;
  isHost: boolean;
  you: boolean;
  ready: boolean;
  entry?: RosterEntry;
}

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "ffa", label: "Free For All", icon: "💥" },
  { id: "team", label: "Team Battle", icon: "🛡️" },
];
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

const botSeat = (): { name: string; avatar: string; kartId: number } => ({
  name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
  avatar: ["🤖", "👾", "🦊", "🐲", "💀", "🥷"][Math.floor(Math.random() * 6)],
  kartId: Math.floor(Math.random() * 6),
});

export default function Lobby({ profile, onStart, onBack }: { profile: Profile; onStart: (o: LaunchOpts) => void; onBack: () => void }) {
  const [tab, setTab] = useState<"quick" | "create" | "join">("quick");
  const [mode, setMode] = useState<Mode>("ffa");
  const [mapSel, setMapSel] = useState<string>("random");
  const [seats, setSeats] = useState<Seat[]>([]);
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState<"idle" | "searching" | "room">("idle");
  const [room, setRoom] = useState<NetRoom | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [online, setOnline] = useState(true);
  const netRef = useRef<RoomNet | null>(null);
  const timer = useRef<number | null>(null);
  const seatsRef = useRef<Seat[]>([]);
  const roomRef = useRef<NetRoom | null>(null);
  const launching = useRef(false);

  const me = () => netRef.current?.playerId ?? "local-you";

  const reset = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      clearTimeout(timer.current);
      timer.current = null;
    }
    setSeats([]);
    setStatus("idle");
    setCountdown(null);
    setCode("");
    setRoom(null);
    setError("");
    seatsRef.current = [];
    roomRef.current = null;
    launching.current = false;
  }, []);
  useEffect(() => reset, [reset]);

  const toSeat = (p: NetPlayer, myId: string): Seat => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    kartId: p.kartId ?? 0,
    isAi: p.isAi,
    isHost: p.isHost,
    you: p.id === myId,
    ready: true,
  });

  /** Build the match launch payload from the live seat list. */
  const launchNow = useCallback(
    (rm: NetRoom | null, list: Seat[]) => {
      if (launching.current) return;
      launching.current = true;
      const myId = me();
      const humans = list.filter((s) => !s.you && !s.isAi);
      const aiSeats = list.filter((s) => s.isAi);
      const remotes: RemoteDesc[] = humans.map((h, i) => ({
        id: h.id,
        name: h.name,
        avatar: h.avatar,
        kartId: h.kartId,
        team: (rm?.mode ?? mode) === "team" ? (i % 2 === 0 ? 0 : 1) : -1,
      }));
      onStart({
        mode: ((rm?.mode ?? mode) as Mode) ?? "ffa",
        mapId: rm?.mapId ?? mapSel,
        roster: aiSeats.map((a) => ({ name: a.name, avatar: a.avatar, kartId: a.kartId })),
        remotes,
        net: netRef.current?.playerId ? { code: netRef.current.code, playerId: myId } : undefined,
        seed: rm?.seed,
      });
    },
    [mapSel, mode, onStart],
  );

  const startCountdown = (rm: NetRoom | null, list: Seat[]) => {
    if (timer.current) clearInterval(timer.current);
    let c = 3;
    setCountdown(c);
    audio.sfx("beep");
    timer.current = window.setInterval(() => {
      c--;
      if (c <= 0) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        launchNow(rm, list);
      } else {
        setCountdown(c);
        audio.sfx("beep");
      }
    }, 900);
  };

  /** Poll the room for seat changes + match start. */
  const poll = useCallback(async () => {
    const net = netRef.current;
    if (!net?.code) return;
    try {
      const r = await net.snapshot();
      if (!r.ok || !r.room) return;
      const list = (r.players ?? []).map((p) => toSeat(p, net.playerId));
      seatsRef.current = list;
      setSeats(list);
      setRoom(r.room);
      roomRef.current = r.room;
      if (r.room.status === "playing") {
        if (timer.current) clearInterval(timer.current);
        launchNow(r.room, list);
      }
    } catch {
      /* transient */
    }
  }, [launchNow]);

  useEffect(() => {
    if (status !== "room" || !code) return;
    const id = window.setInterval(() => void poll(), 1800);
    void poll();
    return () => clearInterval(id);
  }, [status, code, poll]);

  const enterRoom = (r: { ok: boolean; code?: string; players?: NetPlayer[]; room?: NetRoom | null; error?: string }) => {
    if (!r.ok || !r.code) throw new Error(r.error ?? "Room request failed");
    setCode(r.code);
    setSeats((r.players ?? []).map((p) => toSeat(p, me())));
    setRoom(r.room ?? null);
    roomRef.current = r.room ?? null;
    setStatus("room");
    audio.sfx("pickup");
  };

  // ---------------- quick match: find/create room, fill with AI, countdown
  const findMatch = async () => {
    audio.init();
    reset();
    setStatus("searching");
    const net = new RoomNet();
    netRef.current = net;
    const bots = makeRoster(5);
    try {
      const r = await net.find({ name: profile.name || "Driver", avatar: profile.avatar, kartId: profile.kartId, mapId: mapSel, mode });
      if (!r.ok || !r.code) throw new Error(r.error ?? "no room");
      enterRoom(r);
      setOnline(true);
      // fill remaining seats with AI so the match can begin immediately
      const fill = Math.max(0, 6 - (r.players?.length ?? 1));
      for (let i = 0; i < fill; i++) {
        const b = bots[i % bots.length];
        await net.addAi({ name: b.name, avatar: b.avatar, kartId: b.kartId }).catch(() => undefined);
      }
      await poll();
      startCountdown(roomRef.current, seatsRef.current.length ? seatsRef.current : [localSeat()]);
    } catch {
      setOnline(false);
      // offline fallback: local AI lobby
      const list = [localSeat(), ...bots.map((b) => ({ id: `ai-${b.name}`, name: b.name, avatar: b.avatar, kartId: b.kartId, isAi: true, isHost: false, you: false, ready: true, entry: b }))];
      setSeats(list);
      seatsRef.current = list;
      setStatus("room");
      startCountdown(null, list);
    }
  };

  const localSeat = (): Seat => ({
    id: "local-you",
    name: profile.name || "Driver",
    avatar: profile.avatar,
    kartId: profile.kartId,
    isAi: false,
    isHost: true,
    you: true,
    ready: true,
  });

  // ---------------- create room
  const createRoom = async () => {
    audio.init();
    reset();
    const net = new RoomNet();
    netRef.current = net;
    try {
      const r = await net.create({ name: profile.name || "Driver", avatar: profile.avatar, kartId: profile.kartId, mapId: mapSel, mode });
      enterRoom(r);
      setOnline(true);
    } catch {
      setOnline(false);
      const c = randomCode();
      setCode(c);
      setSeats([localSeat()]);
      seatsRef.current = [localSeat()];
      setStatus("room");
    }
  };

  const addAi = async () => {
    const net = netRef.current;
    const b = botSeat();
    if (net?.playerId && online) {
      try {
        await net.addAi({ name: b.name, avatar: b.avatar, kartId: b.kartId });
        await poll();
        return;
      } catch {
        /* fall through to local */
      }
    }
    setSeats((cur) => {
      if (cur.length >= 8) return cur;
      const list = [...cur, { id: `ai-${Math.random()}`, name: b.name, avatar: b.avatar, kartId: b.kartId, isAi: true, isHost: false, you: false, ready: true, entry: b }];
      seatsRef.current = list;
      return list;
    });
    audio.sfx("click");
  };

  const kick = async (id: string) => {
    const net = netRef.current;
    if (net?.playerId && online) {
      await net.kick(id).catch(() => undefined);
      await poll();
      return;
    }
    setSeats((cur) => {
      const list = cur.filter((s) => s.id !== id);
      seatsRef.current = list;
      return list;
    });
  };

  // ---------------- join room
  const joinRoom = async () => {
    audio.init();
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) {
      setError("Room codes are 5 letters/numbers.");
      return;
    }
    reset();
    const net = new RoomNet();
    netRef.current = net;
    try {
      const r = await net.join({ code: c, name: profile.name || "Driver", avatar: profile.avatar, kartId: profile.kartId });
      if (!r.ok) throw new Error(r.error ?? "Could not join");
      enterRoom(r);
      setOnline(true);
    } catch (e) {
      setOnline(false);
      setError((e as Error).message || "Could not reach the room server.");
      setStatus("idle");
    }
  };

  // host starts the match for everyone
  const hostStart = async () => {
    const net = netRef.current;
    const list = seatsRef.current;
    if (net?.playerId && online && net.code) {
      try {
        await net.start({ mapId: mapSel, mode });
        setRoom((r) => (r ? { ...r, status: "playing" } : r));
      } catch {
        /* start locally anyway */
      }
    }
    startCountdown(roomRef.current, list.length ? list : seats);
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
  const isHost = tab === "create" || (tab === "quick" && seats.some((s) => s.you && s.isHost));
  const humans = seats.filter((s) => !s.isAi).length;

  return (
    <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <h2 className="kw-display kw-title text-5xl">Multiplayer</h2>
        <button
          className="kw-btn ghost small"
          onClick={() => {
            netRef.current?.leave().catch(() => undefined);
            reset();
            onBack();
          }}
        >
          <span>← Back</span>
        </button>
      </div>

      <div className="mx-auto mt-3 w-full max-w-5xl rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
        🌐 Real rooms: create a room, share the 5-letter code, and friends join from this screen. Everyone plays the same match
        {online ? "" : " — room server unreachable, running a local AI lobby instead"}.
      </div>

      <div className="mx-auto mt-4 grid w-full max-w-5xl gap-5 lg:grid-cols-[320px_1fr]">
        <div className="kw-panel space-y-4 p-4">
          <div className="grid grid-cols-3 gap-1.5">
            {(["quick", "create", "join"] as const).map((t) => (
              <button
                key={t}
                className={`kw-chip py-2 text-xs font-bold uppercase tracking-wider ${tab === t ? "active" : ""}`}
                onClick={() => {
                  if (tab !== t) netRef.current?.leave().catch(() => undefined);
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
                  <button key={m.id} disabled={status !== "idle"} className={`kw-chip px-2 py-2 text-sm font-bold ${mode === m.id ? "active" : ""}`} onClick={() => setMode(m.id)}>
                    <div className="text-xl">{m.icon}</div>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="mb-1 mt-3 text-xs uppercase tracking-widest text-slate-400">Map</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button className={`kw-chip px-2 py-1.5 text-xs font-bold ${mapSel === "random" ? "active" : ""}`} disabled={status === "searching"} onClick={() => setMapSel("random")}>
                  🎲 Random
                </button>
                {MAPS.map((m) => (
                  <button key={m.id} className={`kw-chip px-2 py-1.5 text-xs font-bold ${mapSel === m.id ? "active" : ""}`} disabled={status === "searching"} onClick={() => setMapSel(m.id)}>
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "quick" && (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">Find an open room or start one instantly. AI drivers fill any empty seats.</p>
              {status === "searching" ? (
                <button className="kw-btn ghost w-full" onClick={reset}>
                  <span>✕ Cancel</span>
                </button>
              ) : status === "room" ? (
                <button className="kw-btn w-full" onClick={() => startCountdown(room, seats)} disabled={countdown !== null}>
                  <span>▶ Start Now</span>
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
                    <div className="text-[11px] uppercase tracking-widest text-slate-400">Share this join code</div>
                    <div className="kw-display text-5xl tracking-[0.2em] text-cyan-300">{code || "·····"}</div>
                    <button className="kw-chip mt-1 px-3 py-1 text-xs" onClick={copy}>
                      {copied ? "✔ Copied" : "Copy code"}
                    </button>
                  </div>
                  <button className="kw-btn ghost small w-full" onClick={addAi} disabled={seats.length >= 8}>
                    <span>🤖 Add AI driver</span>
                  </button>
                  <button className="kw-btn w-full" disabled={seats.length < 2 || countdown !== null} onClick={hostStart}>
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
                onKeyDown={(e) => e.key === "Enter" && void joinRoom()}
                placeholder="ABCDE"
                className="kw-display w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-center text-3xl tracking-[0.3em] outline-none focus:border-cyan-300"
              />
              {error && <div className="text-sm text-red-300">{error}</div>}
              {status !== "room" ? (
                <button className="kw-btn pink w-full" onClick={joinRoom}>
                  <span>→ Join Room</span>
                </button>
              ) : (
                <div className="rounded-lg bg-green-400/15 px-3 py-2 text-center text-sm text-green-200">
                  ✔ In room <b>{code}</b> — {room?.mapId ? mapDef(room.mapId).name : "waiting"} · waiting for the host to start
                </div>
              )}
            </div>
          )}
        </div>

        <div className="kw-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="kw-display text-2xl text-white">
              {status === "searching" ? "Searching for drivers…" : status === "room" ? `Room ${code || "·····"}` : "Lobby"}
            </div>
            <div className="text-sm text-slate-300">
              {seats.length}/8 · {MODES.find((m) => m.id === (room?.mode ?? mode))?.label}
              {status === "room" ? ` · ${mapDef(room?.mapId ?? mapSel).name}` : ""}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((s, i) => {
              const teamCol = (room?.mode ?? mode) === "team" ? hex(TEAM_COLORS[i % 2]) : undefined;
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
                          {s.isHost ? "Host · " : ""}
                          {s.isAi ? "AI driver" : "Player"} · <span className="text-green-300">Ready</span>
                        </div>
                      </div>
                      {isHost && s.isAi && !countdown && (
                        <button className="kw-chip px-2 py-1 text-xs" onClick={() => void kick(s.id)}>
                          ✕
                        </button>
                      )}
                    </>
                  ) : isHost && status === "room" ? (
                    <button className="kw-chip w-full py-2 text-sm text-slate-300" onClick={addAi}>
                      ＋ Add AI driver
                    </button>
                  ) : (
                    <div className="w-full text-center text-sm text-slate-500">{status === "searching" ? "Searching…" : "Empty seat — share the code"}</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            {humans} human player{humans === 1 ? "" : "s"} in the room · AI drivers fill the rest. Room codes are case-insensitive.
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
