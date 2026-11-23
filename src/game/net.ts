import type { NetworkSeat } from "./types";

export type NetPlayer = NetworkSeat;

export interface NetRoom {
  code: string;
  mapId: string;
  mode: string;
  status: string;
  seed: number;
  maxPlayers: number;
  hostId: string | null;
  startAt: number | null;
}

export interface NetEvent {
  id: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface NetResult {
  ok: boolean;
  code?: string;
  playerId?: string;
  players?: NetPlayer[];
  room?: NetRoom | null;
  events?: NetEvent[];
  cursor?: number;
  error?: string;
  serverNow?: number;
}

export interface KartState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy?: number;
  vz: number;
  heading: number;
  pitch: number;
  roll: number;
  boosting: boolean;
  drifting: boolean;
  grounded?: boolean;
  firing?: boolean;
  driftDir: number;
  aimX: number;
  aimZ: number;
  weapon: string | null;
  ammo: number;
  alive: boolean;
  hp: number;
  score: number;
  kills: number;
  deaths: number;
}

export type NetOutEvent = { type: string; payload: Record<string, unknown> };

/**
 * HTTP room client for real multiplayer rooms (create / join / sync / leave).
 * State is exchanged over a POST sync call at ~10Hz and gameplay events
 * (fire / hit / death) ride along with each sync, so remote karts, shooting,
 * explosions and the scoreboard stay in step across players.
 */
export class RoomNet {
  code = "";
  playerId = "";
  cursor = 0;
  private serverOffset = 0;
  private queue: NetOutEvent[] = [];

  serverNow() {
    return Date.now() + this.serverOffset;
  }

  setServerOffset(offset: number) {
    if (Number.isFinite(offset)) this.serverOffset = offset;
  }

  private rememberSession() {
    if (typeof window !== "undefined" && this.code && this.playerId) {
      window.sessionStorage.setItem(`kartswar-player:${this.code}`, this.playerId);
    }
  }

  private updateServerOffset(result: NetResult) {
    if (typeof result.serverNow === "number" && Number.isFinite(result.serverNow)) {
      this.serverOffset = result.serverNow - Date.now();
    }
    return result;
  }

  private async call(body: Record<string, unknown>): Promise<NetResult> {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.updateServerOffset((await res.json()) as NetResult);
  }

  async create(opts: { name: string; avatar: string; kartId: number; mapId: string; mode: string }) {
    const r = await this.call({ action: "create", ...opts });
    if (r.ok && r.playerId) {
      this.playerId = r.playerId;
      this.code = r.code ?? "";
      this.rememberSession();
    }
    return r;
  }

  async join(opts: { code: string; name: string; avatar: string; kartId: number }) {
    const savedId = typeof window === "undefined" ? "" : window.sessionStorage.getItem(`kartswar-player:${opts.code.toUpperCase()}`) ?? "";
    const r = await this.call({ action: "join", ...opts, playerId: savedId });
    if (r.ok && r.playerId) {
      this.playerId = r.playerId;
      this.code = r.code ?? opts.code;
      this.rememberSession();
    }
    return r;
  }

  async find(opts: { name: string; avatar: string; kartId: number; mapId: string; mode: string }) {
    const r = await this.call({ action: "find", ...opts });
    if (r.ok && r.playerId) {
      this.playerId = r.playerId;
      this.code = r.code ?? "";
      this.rememberSession();
    }
    return r;
  }

  async addAi(opts: { name: string; avatar: string; kartId: number }) {
    return this.call({ action: "addai", code: this.code, playerId: this.playerId, ...opts });
  }

  async kick(target: string) {
    return this.call({ action: "kick", code: this.code, playerId: this.playerId, target });
  }

  async setReady(ready: boolean) {
    return this.call({ action: "ready", playerId: this.playerId, ready });
  }

  async start(opts: { mapId: string; mode: string }) {
    const result = await this.call({ action: "start", code: this.code, playerId: this.playerId, ...opts });
    if (result.ok && typeof result.cursor === "number") this.cursor = result.cursor;
    return result;
  }

  async finish() {
    return this.call({ action: "finish", code: this.code, playerId: this.playerId });
  }

  async restart() {
    const result = await this.call({ action: "restart", code: this.code, playerId: this.playerId });
    if (result.ok && typeof result.cursor === "number") this.cursor = result.cursor;
    return result;
  }

  async snapshot() {
    const heartbeat = await this.heartbeat();
    if (!heartbeat.ok) return heartbeat;
    const res = await fetch(`/api/rooms?code=${encodeURIComponent(this.code)}`);
    const result = this.updateServerOffset((await res.json()) as NetResult);
    if (result.ok && typeof result.cursor === "number") this.cursor = result.cursor;
    return result;
  }

  async heartbeat() {
    return this.call({ action: "heartbeat", playerId: this.playerId });
  }

  watchPageExit() {
    if (typeof window === "undefined" || !this.playerId) return () => undefined;
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted || typeof navigator.sendBeacon !== "function") return;
      const payload = new Blob([JSON.stringify({ action: "disconnect", playerId: this.playerId })], { type: "application/json" });
      if (!navigator.sendBeacon("/api/rooms", payload)) {
        void fetch("/api/rooms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "disconnect", playerId: this.playerId }),
          keepalive: true,
        }).catch((error: unknown) => console.error("Room disconnect request failed", error));
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }

  push(type: string, payload: Record<string, unknown>) {
    this.queue.push({ type, payload });
    if (this.queue.length > 40) this.queue.splice(0, this.queue.length - 40);
  }

  clearPendingEvents() {
    this.queue = [];
  }

  async sync(state: KartState): Promise<NetResult> {
    const events = this.queue;
    this.queue = [];
    const r = await this.call({ action: "sync", playerId: this.playerId, cursor: this.cursor, state, events });
    if (r.ok && typeof r.cursor === "number") this.cursor = r.cursor;
    if (!r.ok) this.queue.unshift(...events.slice(-10)); // retry the tail on failure
    return r;
  }

  async leave() {
    if (!this.playerId) return;
    const result = await this.call({ action: "leave", playerId: this.playerId });
    if (!result.ok) throw new Error(result.error ?? "Could not leave room");
    if (typeof window !== "undefined" && this.code) window.sessionStorage.removeItem(`kartswar-player:${this.code}`);
    this.playerId = "";
    return result;
  }
}
