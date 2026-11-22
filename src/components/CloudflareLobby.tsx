"use client";

import { useEffect, useRef, useState } from "react";
import { audio } from "@/game/audio";
import { createRoom, joinQuickMatch, joinRoom, type MultiplayerSession } from "@/game/multiplayerClient";
import { TEAM_COLORS, type Profile } from "@/game/types";
import type { LobbyState, NetworkPlayer } from "@/game/networkTypes";

const MODES: { id: "ffa" | "team"; label: string; icon: string }[] = [
  { id: "ffa", label: "Free For All", icon: "💥" },
  { id: "team", label: "Team Battle", icon: "🛡️" },
];
const cloudflarePrivateRooms = Boolean(process.env.NEXT_PUBLIC_REALTIME_URL);
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

interface Props {
  profile: Profile;
  onSession: (session: MultiplayerSession | null) => void;
  onBack: () => void;
}

export default function Lobby({ profile, onSession, onBack }: Props) {
  const [tab, setTab] = useState<"quick" | "create" | "join">("quick");
  const [mode, setMode] = useState<"ffa" | "team">("ffa");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(0);
  const [ownPlayerId, setOwnPlayerId] = useState("");
  const sessionRef = useRef<MultiplayerSession | null>(null);
  const unsubscribeRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => {
      window.clearInterval(timer);
      unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const attach = async (session: MultiplayerSession) => {
    sessionRef.current = session;
    onSession(session);
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current = [session.onLobbyState(setLobby), session.onRoomError(setError)];
    const state = await session.initialize();
    setOwnPlayerId(session.ownPlayerId);
    setLobby(state);
    setPending(false);
  };

  const connect = async (action: () => Promise<MultiplayerSession>) => {
    setPending(true);
    setError("");
    try {
      audio.init();
      const session = await action();
      try {
        await attach(session);
      } catch (reason) {
        await session.leave();
        throw reason;
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not connect to the multiplayer server.";
      setError(message);
      setPending(false);
    }
  };

  const leaveRoom = async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setOwnPlayerId("");
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current = [];
    setLobby(null);
    onSession(null);
    if (session) await session.leave();
  };

  const changeTab = async (next: "quick" | "create" | "join") => {
    await leaveRoom();
    setTab(next);
    setError("");
    setPending(false);
  };

  const copy = async () => {
    if (!lobby) return;
    try {
      await navigator.clipboard.writeText(lobby.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Clipboard access is unavailable.");
    }
  };

  const connectedPlayers = lobby?.players.filter((player) => player.connected) ?? [];
  const self = lobby?.players.find((player) => player.playerId === ownPlayerId);
  const isHost = !!self?.host;
  const allReady = connectedPlayers.length >= 2 && connectedPlayers.every((player) => player.ready);
  const statusLabel = lobby?.phase === "countdown" ? "Match starting…" : lobby?.phase === "playing" ? "Match in progress" : lobby?.phase === "ended" ? "Match ended" : "Lobby";
  const countdown = lobby?.phase === "countdown" && lobby.startAt ? Math.max(0, Math.ceil((lobby.startAt - now) / 1000)) : null;

  const slots: (NetworkPlayer | null)[] = Array.from({ length: 8 }, (_, i) => lobby?.players.find((player) => player.slot === i) ?? null);
  const isRoom = !!lobby;
  const canReady = !!lobby && lobby.phase === "lobby" && !!self && !self.host;
  const canStart = !!lobby && lobby.phase === "lobby" && isHost && allReady;

  return (
    <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <h2 className="kw-display kw-title text-5xl">Multiplayer</h2>
        <button
          className="kw-btn ghost small"
          onClick={async () => {
            await leaveRoom();
            onBack();
          }}
        >
          <span>← Back</span>
        </button>
      </div>

      <div className="mx-auto mt-3 w-full max-w-5xl rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
        {cloudflarePrivateRooms
          ? "Private invite rooms use Cloudflare Durable Objects over WebSockets. Quick Match still uses the existing multiplayer server during staged rollout."
          : "Rooms use the existing authoritative KARTSWAR multiplayer server over WebSockets. No AI drivers are added to network rooms."}
      </div>

      <div className="mx-auto mt-4 grid w-full max-w-5xl gap-5 lg:grid-cols-[320px_1fr]">
        <div className="kw-panel space-y-4 p-4">
          <div className="grid grid-cols-3 gap-1.5">
            {(["quick", "create", "join"] as const).map((nextTab) => (
              <button
                key={nextTab}
                className={`kw-chip py-2 text-xs font-bold uppercase tracking-wider ${tab === nextTab ? "active" : ""}`}
                disabled={pending}
                onClick={() => void changeTab(nextTab)}
              >
                {nextTab === "quick" ? "Quick Match" : nextTab === "create" ? "Create Room" : "Join Room"}
              </button>
            ))}
          </div>

          {tab !== "join" && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">Game mode</div>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((option) => (
                  <button
                    key={option.id}
                    disabled={isRoom || pending}
                    className={`kw-chip px-2 py-2 text-sm font-bold ${mode === option.id ? "active" : ""}`}
                    onClick={() => setMode(option.id)}
                  >
                    <div className="text-xl">{option.icon}</div>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "quick" && (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">Join or create an online room for up to 8 real players.</p>
              {isRoom ? (
                <>
                  {isHost ? (
                    <button className="kw-btn w-full" disabled={!canStart} onClick={() => sessionRef.current?.requestStart()}>
                      <span>▶ Start Match</span>
                    </button>
                  ) : (
                    <button className="kw-btn w-full" disabled={!canReady} onClick={() => sessionRef.current?.setReady(!self?.ready)}>
                      <span>{self?.ready ? "✔ Ready" : "✔ Ready Up"}</span>
                    </button>
                  )}
                  <button className="kw-btn ghost w-full" onClick={() => void leaveRoom()}>
                    <span>✕ Leave Room</span>
                  </button>
                </>
              ) : (
                <button className="kw-btn w-full" disabled={pending} onClick={() => void connect(() => joinQuickMatch(profile, mode))}>
                  <span>{pending ? "Connecting…" : "🔍 Find Match"}</span>
                </button>
              )}
            </div>
          )}

          {tab === "create" && (
            <div className="space-y-2">
              {!isRoom ? (
                <button className="kw-btn cyan w-full" disabled={pending} onClick={() => void connect(() => createRoom(profile, mode))}>
                  <span>{pending ? "Creating…" : "＋ Create Private Room"}</span>
                </button>
              ) : (
                <>
                  <div className="rounded-xl border border-cyan-300/40 bg-black/40 p-3 text-center">
                    <div className="text-[11px] uppercase tracking-widest text-slate-400">Join code</div>
                    <div className="kw-display text-5xl tracking-[0.2em] text-cyan-300">{lobby.code}</div>
                    <button className="kw-chip mt-1 px-3 py-1 text-xs" onClick={() => void copy()}>
                      {copied ? "✔ Copied" : "Copy code"}
                    </button>
                  </div>
                  <button className="kw-btn w-full" disabled={!canStart} onClick={() => sessionRef.current?.requestStart()}>
                    <span>▶ Start Match</span>
                  </button>
                  {!allReady && <div className="text-center text-xs text-yellow-200">At least two connected players must be ready.</div>}
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
                disabled={isRoom || pending}
                onChange={(event) => {
                  setJoinCode(event.target.value.toUpperCase());
                  setError("");
                }}
                onKeyDown={(event) => event.key === "Enter" && void connect(() => joinRoom(joinCode, profile))}
                placeholder="ABCDE"
                className="kw-display w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-center text-3xl tracking-[0.3em] outline-none focus:border-cyan-300"
              />
              {isRoom && (
                <button className="kw-btn w-full" disabled={!canReady} onClick={() => sessionRef.current?.setReady(!self?.ready)}>
                  <span>{self?.ready ? "✔ Ready" : "✔ Ready Up"}</span>
                </button>
              )}
              {!isRoom && (
                <button
                  className="kw-btn pink w-full"
                  disabled={pending}
                  onClick={() => void connect(() => joinRoom(joinCode, profile))}
                >
                  <span>{pending ? "Joining…" : "→ Join Room"}</span>
                </button>
              )}
            </div>
          )}

          {error && <div role="alert" className="text-sm text-red-300">{error}</div>}
          {pending && !isRoom && <div className="text-xs text-slate-400">Waiting for the multiplayer server…</div>}
        </div>

        <div className="kw-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="kw-display text-2xl text-white">{isRoom ? `${statusLabel}${lobby.code ? ` · ${lobby.code}` : ""}` : "Lobby"}</div>
            <div className="text-sm text-slate-300">
              {lobby?.players.filter((player) => player.connected).length ?? 0}/8 · {MODES.find((option) => option.id === (lobby?.mode ?? mode))?.label}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((player, index) => {
              const teamCol = lobby?.mode === "team" ? hex(TEAM_COLORS[index % 2]) : undefined;
              return (
                <div key={index} className={`flex h-[58px] items-center gap-3 rounded-xl border px-3 ${player ? "border-white/15 bg-white/5" : "border-dashed border-white/10 bg-black/20"}`} style={player && teamCol ? { borderLeft: `4px solid ${teamCol}` } : undefined}>
                  {player ? (
                    <>
                      <div className="kw-pop flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-2xl">{player.avatar}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">
                          {player.displayName} {player.playerId === self?.playerId && <span className="text-cyan-300">(you)</span>}
                        </div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">
                          {player.host ? "Host · " : ""}
                          {!player.connected ? "Disconnected" : player.ready ? "Ready" : "Not ready"}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="w-full text-center text-sm text-slate-500">{isRoom ? "Empty seat" : "Waiting for room"}</div>
                  )}
                </div>
              );
            })}
          </div>
          {countdown !== null && (
            <div className="mt-4 text-center">
              <div className="text-xs uppercase tracking-[0.4em] text-slate-300">Shared countdown</div>
              <div className="kw-display kw-title text-7xl">{countdown}</div>
            </div>
          )}
          {lobby?.phase === "playing" && (
            <div className="mt-4 text-center text-sm text-green-200">
              Match {lobby.matchId?.slice(0, 8)} · map {lobby.mapId}
            </div>
          )}
          {lobby?.phase === "ended" && isHost && (
            <button className="kw-btn mt-4 w-full" onClick={() => sessionRef.current?.requestRestart()}>
              <span>↻ Restart Match</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
