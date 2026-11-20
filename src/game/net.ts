export interface NetPlayer {
  id: string;
  name: string;
  avatar: string;
  kartId: number;
  isHost: boolean;
  isAi: boolean;
  state: Record<string, unknown>;
}

export interface NetRoom {
  code: string;
  mapId: string;
  mode: string;
  status: string;
  seed: number;
  maxPlayers: number;
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
}

export interface KartState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
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
  private queue: NetOutEvent[] = [];

  private async call(body: Record<string, unknown>): Promise<NetResult> {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as NetResult;
  }

  async create(opts: { name: string; avatar: string; kartId: number; mapId: string; mode: string }) {
    const r = await this.call({ action: "create", ...opts });
    if (r.ok && r.playerId) {
      this.playerId = r.playerId;
      this.code = r.code ?? "";
    }
    return r;
  }

  async join(opts: { code: string; name: string; avatar: string; kartId: number }) {
    const r = await this.call({ action: "join", ...opts });
    if (r.ok && r.playerId) {
      this.playerId = r.playerId;
      this.code = r.code ?? opts.code;
    }
    return r;
  }

  async find(opts: { name: string; avatar: string; kartId: number; mapId: string; mode: string }) {
    const r = await this.call({ action: "find", ...opts });
    if (r.ok && r.playerId) {
      this.playerId = r.playerId;
      this.code = r.code ?? "";
    }
    return r;
  }

  async addAi(opts: { name: string; avatar: string; kartId: number }) {
    return this.call({ action: "addai", code: this.code, ...opts });
  }

  async kick(target: string) {
    return this.call({ action: "kick", code: this.code, target });
  }

  async start(opts: { mapId: string; mode: string }) {
    return this.call({ action: "start", code: this.code, playerId: this.playerId, ...opts });
  }

  async snapshot() {
    return fetch(`/api/rooms?code=${encodeURIComponent(this.code)}`).then((r) => r.json() as Promise<NetResult>);
  }

  push(type: string, payload: Record<string, unknown>) {
    this.queue.push({ type, payload });
    if (this.queue.length > 40) this.queue.splice(0, this.queue.length - 40);
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
    await this.call({ action: "leave", playerId: this.playerId });
  }
}
