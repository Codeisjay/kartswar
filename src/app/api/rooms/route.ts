import { randomInt, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { roomEvents, roomPlayers, rooms } from "@/db/schema";

export const dynamic = "force-dynamic";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STALE_MS = 45_000;
const COUNTDOWN_MS = 4_000;

function newCode(): string {
  let c = "";
  for (let i = 0; i < 5; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return c;
}
function id(): string {
  return `p_${randomUUID()}`;
}

async function playersOf(code: string) {
  const rows = await db.select().from(roomPlayers).where(eq(roomPlayers.roomCode, code)).orderBy(asc(roomPlayers.id));
  const usedNames = new Set<string>();
  return rows.flatMap((r, slot) => {
    const baseName = r.name.trim().slice(0, 24) || "Driver";
    let name = baseName;
    for (let suffix = 2; usedNames.has(name.toLocaleLowerCase()); suffix++) name = `${baseName} ${suffix}`;
    usedNames.add(name.toLocaleLowerCase());
    const state = (r.state ?? {}) as Record<string, unknown>;
    if (state.disconnected === true) return [];
    return {
      id: r.id,
      name,
      avatar: r.avatar,
      kartId: r.kartId,
      isHost: r.isHost,
      isAi: r.isAi,
      ready: r.isAi || state.ready === true,
      slot,
      updatedAt: r.updatedAt?.getTime() ?? 0,
      state,
    };
  });
}

async function roomInfo(code: string) {
  let [room] = await db.select().from(rooms).where(eq(rooms.code, code));
  if (room?.status === "countdown" && room.updatedAt && room.updatedAt.getTime() <= Date.now()) {
    const players = await db.select().from(roomPlayers).where(and(eq(roomPlayers.roomCode, code), eq(roomPlayers.isAi, false)));
    const active = players.filter((player) => ((player.state ?? {}) as Record<string, unknown>).disconnected !== true);
    const stale = players.filter((player) => {
      const state = (player.state ?? {}) as Record<string, unknown>;
      return state.disconnected !== true && (player.updatedAt?.getTime() ?? 0) < Date.now() - 2_500;
    });
    if (stale.length || active.length === 0) {
      for (const player of stale) {
        await pushEvent(code, "leave", { playerId: player.id, name: player.name });
        await db.delete(roomPlayers).where(eq(roomPlayers.id, player.id));
      }
      await db
        .update(rooms)
        .set({ status: "lobby", updatedAt: new Date() })
        .where(and(eq(rooms.code, code), eq(rooms.status, "countdown")));
      await ensureHost(code);
    } else {
      await db
        .update(rooms)
        .set({ status: "playing" })
        .where(and(eq(rooms.code, code), eq(rooms.status, "countdown")));
    }
    [room] = await db.select().from(rooms).where(eq(rooms.code, code));
  }
  if (!room) return null;
  return {
    ...room,
    startAt: room.status === "countdown" || room.status === "playing" ? room.updatedAt?.getTime() ?? null : null,
  };
}

async function ensureHost(code: string) {
  const room = await roomInfo(code);
  if (!room) return;
  const players = await playersOf(code);
  if (players.some((p) => p.id === room.hostId && !p.isAi)) return;
  const nextHost = players.find((p) => !p.isAi);
  if (!nextHost) return;
  await db.update(roomPlayers).set({ isHost: false }).where(eq(roomPlayers.roomCode, code));
  await db.update(roomPlayers).set({ isHost: true }).where(eq(roomPlayers.id, nextHost.id));
  await db.update(rooms).set({ hostId: nextHost.id }).where(eq(rooms.code, code));
}

/** Prune stale players + old events so rooms cannot leak forever. */
async function janitor(code: string) {
  const room = await roomInfo(code);
  const stale = await db
    .select()
    .from(roomPlayers)
    .where(and(eq(roomPlayers.roomCode, code), lt(roomPlayers.updatedAt, new Date(Date.now() - STALE_MS)), eq(roomPlayers.isAi, false)));
  for (const player of stale) {
    const state = (player.state ?? {}) as Record<string, unknown>;
    if (room && room.status !== "lobby") {
      if (state.disconnected !== true) {
        await pushEvent(code, "leave", { playerId: player.id, name: player.name });
        await db.update(roomPlayers).set({ state: { ...state, disconnected: true } }).where(eq(roomPlayers.id, player.id));
      }
    } else {
      await pushEvent(code, "leave", { playerId: player.id, name: player.name });
      await db.delete(roomPlayers).where(eq(roomPlayers.id, player.id));
    }
  }
  await ensureHost(code);
  await db.delete(roomEvents).where(and(eq(roomEvents.roomCode, code), lt(roomEvents.createdAt, new Date(Date.now() - 120_000))));
}

async function pushEvent(code: string, type: string, payload: Record<string, unknown>) {
  const [event] = await db.insert(roomEvents).values({ roomCode: code, type, payload }).returning({ id: roomEvents.id });
  return event.id;
}

function newMatchSeed() {
  return randomInt(1, 0x7fffffff);
}

async function startMatch(code: string, mapId: string, mode: string, fromStatus: "lobby" | "ended" = "lobby") {
  const startAt = Date.now() + COUNTDOWN_MS;
  const seed = newMatchSeed();
  const [started] = await db
    .update(rooms)
    .set({ status: "countdown", mapId, mode, seed, updatedAt: new Date(startAt) })
    .where(and(eq(rooms.code, code), eq(rooms.status, fromStatus)))
    .returning();
  if (!started) return { room: await roomInfo(code), serverNow: Date.now(), started: false };
  const players = await db.select().from(roomPlayers).where(eq(roomPlayers.roomCode, code));
  for (const player of players) {
    const state = (player.state ?? {}) as Record<string, unknown>;
    await db.update(roomPlayers).set({
      state: { ready: state.ready === true, disconnected: state.disconnected === true },
      updatedAt: new Date(),
    }).where(eq(roomPlayers.id, player.id));
  }
  const cursor = await pushEvent(code, "start", { mapId, mode, seed, matchId: `${code}-${seed}`, startAt });
  return { room: await roomInfo(code), cursor, serverNow: Date.now(), started: true };
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  const action = String(body.action ?? "");
  try {
    if (action === "create") {
      const playerId = id();
      let code = newCode();
      for (let i = 0; i < 6; i++) {
        const [existing] = await db.select().from(rooms).where(eq(rooms.code, code));
        if (!existing) break;
        code = newCode();
      }
      const seed = newMatchSeed();
      await db.insert(rooms).values({
        code,
        hostId: playerId,
        mapId: String(body.mapId ?? "random"),
        mode: String(body.mode ?? "ffa"),
        status: "lobby",
        seed,
        maxPlayers: 8,
      });
      await db.insert(roomPlayers).values({
        id: playerId,
        roomCode: code,
        name: String(body.name ?? "Driver").trim().slice(0, 24) || "Driver",
        avatar: String(body.avatar ?? "😎"),
        kartId: Number(body.kartId ?? 0),
        isHost: true,
        isAi: false,
        state: { ready: true },
      });
      await pushEvent(code, "join", { playerId, name: String(body.name ?? "Driver") });
      return Response.json({ ok: true, code, playerId, players: await playersOf(code), room: await roomInfo(code), serverNow: Date.now() });
    }

    if (action === "join" || action === "find") {
      let code = String(body.code ?? "").toUpperCase();
      if (action === "find") {
        // matchmaking: prefer an open lobby room, otherwise create one
        const [open] = await db
          .select()
          .from(rooms)
          .where(and(eq(rooms.status, "lobby"), eq(rooms.mode, String(body.mode ?? "ffa")), gt(rooms.updatedAt, new Date(Date.now() - STALE_MS))))
          .orderBy(desc(rooms.updatedAt))
          .limit(1);
        if (open) code = open.code;
      }
      let room = code ? await roomInfo(code) : null;
      if (!room) {
        // fall through to creating a room
        return POST(
          new Request(req.url, {
            method: "POST",
            body: JSON.stringify({ ...body, action: "create" }),
          }),
        );
      }
      const resumeId = String(body.playerId ?? "");
      if (resumeId) {
        const [existingPlayer] = await db.select().from(roomPlayers).where(eq(roomPlayers.id, resumeId));
        if (existingPlayer?.roomCode === room.code && !existingPlayer.isAi) {
          const previousState = (existingPlayer.state ?? {}) as Record<string, unknown>;
          const resumeUpdate = room.status === "lobby"
            ? {
                name: String(body.name ?? existingPlayer.name).trim().slice(0, 24) || existingPlayer.name,
                avatar: String(body.avatar ?? existingPlayer.avatar),
                kartId: Number(body.kartId ?? existingPlayer.kartId),
                state: { ...previousState, disconnected: false },
                updatedAt: new Date(),
              }
            : { state: { ...previousState, disconnected: false }, updatedAt: new Date() };
          await db.update(roomPlayers).set(resumeUpdate).where(eq(roomPlayers.id, resumeId));
          room = await roomInfo(room.code);
          return Response.json({ ok: true, code: room?.code, playerId: resumeId, players: await playersOf(room!.code), room, serverNow: Date.now() });
        }
      }
      if (room.status !== "lobby") return Response.json({ ok: false, error: "Match already started; rejoin from the same browser session" }, { status: 409 });
      const existing = await playersOf(room.code);
      if (existing.length >= (room.maxPlayers ?? 8)) return Response.json({ ok: false, error: "Room is full" }, { status: 409 });
      const playerId = id();
      await db.insert(roomPlayers).values({
        id: playerId,
        roomCode: room.code,
        name: String(body.name ?? "Driver").trim().slice(0, 24) || "Driver",
        avatar: String(body.avatar ?? "😎"),
        kartId: Number(body.kartId ?? 0),
        isHost: false,
        isAi: false,
        state: { ready: false },
      });
      await pushEvent(room.code, "join", { playerId, name: String(body.name ?? "Driver") });
      await db.update(rooms).set({ updatedAt: new Date() }).where(and(eq(rooms.code, room.code), eq(rooms.status, "lobby")));
      room = await roomInfo(room.code);
      return Response.json({ ok: true, code: room?.code, playerId, players: await playersOf(room!.code), room, serverNow: Date.now() });
    }

    if (action === "addai") {
      const code = String(body.code ?? "").toUpperCase();
      const room = await roomInfo(code);
      if (!room) return Response.json({ ok: false, error: "No such room" }, { status: 404 });
      if (room.hostId !== String(body.playerId ?? "")) return Response.json({ ok: false, error: "Only the host can add AI drivers" }, { status: 403 });
      if (room.status !== "lobby") return Response.json({ ok: false, error: "Match already started" }, { status: 409 });
      const current = await playersOf(code);
      if (current.length >= (room.maxPlayers ?? 8)) return Response.json({ ok: false, error: "Room is full" }, { status: 409 });
      const aiId = `ai_${randomUUID()}`;
      await db.insert(roomPlayers).values({
        id: aiId,
        roomCode: code,
        name: String(body.name ?? "AI Driver"),
        avatar: String(body.avatar ?? "🤖"),
        kartId: Number(body.kartId ?? 0),
        isHost: false,
        isAi: true,
        state: { ready: true },
      });
      await pushEvent(code, "join", { playerId: aiId, name: String(body.name ?? "AI Driver"), ai: true });
      return Response.json({ ok: true, players: await playersOf(code), room: await roomInfo(code), serverNow: Date.now() });
    }

    if (action === "kick") {
      const code = String(body.code ?? "").toUpperCase();
      const room = await roomInfo(code);
      if (!room) return Response.json({ ok: false, error: "No such room" }, { status: 404 });
      if (room.hostId !== String(body.playerId ?? "")) return Response.json({ ok: false, error: "Only the host can remove a driver" }, { status: 403 });
      const target = String(body.target ?? "");
      const [player] = await db.select().from(roomPlayers).where(and(eq(roomPlayers.roomCode, code), eq(roomPlayers.id, target)));
      if (player && player.id !== room.hostId) {
        await db.delete(roomPlayers).where(eq(roomPlayers.id, target));
        await pushEvent(code, "leave", { playerId: target, name: player.name });
      }
      return Response.json({ ok: true, players: await playersOf(code), serverNow: Date.now() });
    }

    if (action === "ready") {
      const playerId = String(body.playerId ?? "");
      const [player] = await db.select().from(roomPlayers).where(eq(roomPlayers.id, playerId));
      if (!player || player.isAi) return Response.json({ ok: false, error: "Not in a room" }, { status: 404 });
      const room = await roomInfo(player.roomCode);
      if (!room || room.status !== "lobby") return Response.json({ ok: false, error: "Room is no longer waiting" }, { status: 409 });
      const state = (player.state ?? {}) as Record<string, unknown>;
      await db.update(roomPlayers).set({
        state: { ...state, ready: body.ready === true },
        updatedAt: new Date(),
      }).where(eq(roomPlayers.id, playerId));
      return Response.json({ ok: true, players: await playersOf(player.roomCode), room, serverNow: Date.now() });
    }

    if (action === "heartbeat") {
      const playerId = String(body.playerId ?? "");
      const [player] = await db.select().from(roomPlayers).where(eq(roomPlayers.id, playerId));
      if (!player || player.isAi) return Response.json({ ok: false, error: "Not in a room" }, { status: 404 });
      await db.update(roomPlayers).set({ updatedAt: new Date() }).where(eq(roomPlayers.id, playerId));
      return Response.json({ ok: true, serverNow: Date.now() });
    }

    if (action === "disconnect") {
      const playerId = String(body.playerId ?? "");
      const [player] = await db.select().from(roomPlayers).where(eq(roomPlayers.id, playerId));
      if (player && !player.isAi) {
        const state = (player.state ?? {}) as Record<string, unknown>;
        if (state.disconnected !== true) {
          await pushEvent(player.roomCode, "leave", { playerId, name: player.name });
          await db.update(roomPlayers).set({ state: { ...state, disconnected: true } }).where(eq(roomPlayers.id, playerId));
          await ensureHost(player.roomCode);
        }
      }
      return Response.json({ ok: true, serverNow: Date.now() });
    }

    if (action === "start") {
      const code = String(body.code ?? "").toUpperCase();
      const room = await roomInfo(code);
      if (!room) return Response.json({ ok: false, error: "No such room" }, { status: 404 });
      if (room.hostId !== String(body.playerId ?? "")) return Response.json({ ok: false, error: "Only the host can start" }, { status: 403 });
      if (room.status !== "lobby") return Response.json({ ok: false, error: "A match has already been initialized" }, { status: 409 });
      const players = await playersOf(code);
      if (players.length < 2) return Response.json({ ok: false, error: "At least two players are required" }, { status: 409 });
      if (players.some((p) => !p.isAi && !p.ready)) return Response.json({ ok: false, error: "Every player must be ready before starting" }, { status: 409 });
      const result = await startMatch(code, String(body.mapId ?? room.mapId), String(body.mode ?? room.mode));
      if (!result.started) return Response.json({ ok: false, error: "A match has already been initialized" }, { status: 409 });
      return Response.json({ ok: true, ...result, serverNow: Date.now() });
    }

    if (action === "finish" || action === "restart") {
      const code = String(body.code ?? "").toUpperCase();
      const room = await roomInfo(code);
      if (!room) return Response.json({ ok: false, error: "No such room" }, { status: 404 });
      if (room.hostId !== String(body.playerId ?? "")) return Response.json({ ok: false, error: "Only the host can coordinate match state" }, { status: 403 });
      if (action === "finish") {
        if (room.status === "playing") {
          await db.update(rooms).set({ status: "ended", updatedAt: new Date() }).where(and(eq(rooms.code, code), eq(rooms.status, "playing")));
        }
        return Response.json({ ok: true, room: await roomInfo(code), serverNow: Date.now() });
      }
      if (room.status !== "ended") return Response.json({ ok: false, error: "The current match has not ended" }, { status: 409 });
      const players = await playersOf(code);
      if (players.length < 2 || players.some((p) => !p.isAi && !p.ready)) {
        return Response.json({ ok: false, error: "Every player must be ready before restarting" }, { status: 409 });
      }
      const result = await startMatch(code, room.mapId, room.mode, "ended");
      if (!result.started) return Response.json({ ok: false, error: "The match restart was already requested" }, { status: 409 });
      return Response.json({ ok: true, ...result, serverNow: Date.now() });
    }

    if (action === "sync") {
      const playerId = String(body.playerId ?? "");
      const cursor = Number(body.cursor ?? 0);
      const mine = await db.select().from(roomPlayers).where(eq(roomPlayers.id, playerId));
      if (!mine.length) return Response.json({ ok: false, error: "Not in a room" }, { status: 404 });
      const code = mine[0].roomCode;
      const state = body.state && typeof body.state === "object" ? (body.state as Record<string, unknown>) : {};
      const previousState = (mine[0].state ?? {}) as Record<string, unknown>;
      const currentRoom = await roomInfo(code);
      if (currentRoom?.status === "playing") {
        await db
          .update(roomPlayers)
          .set({ state: { ...previousState, ...state, ready: previousState.ready === true }, updatedAt: new Date() })
          .where(eq(roomPlayers.id, playerId));
        const events = (body.events ?? []) as { type: string; payload: Record<string, unknown> }[];
        for (const e of events.slice(0, 24)) await pushEvent(code, e.type, { ...e.payload, source: playerId });
      } else if (currentRoom?.status === "countdown" || currentRoom?.status === "ended") {
        await db.update(roomPlayers).set({ updatedAt: new Date() }).where(eq(roomPlayers.id, playerId));
      }
      await janitor(code);
      const room = await roomInfo(code);
      if (room?.status === "lobby" && Date.now() - (room.updatedAt?.getTime() ?? 0) > 10_000) {
        await db.update(rooms).set({ updatedAt: new Date() }).where(and(eq(rooms.code, code), eq(rooms.status, "lobby")));
      }
      const fresh = await db
        .select()
        .from(roomEvents)
        .where(and(eq(roomEvents.roomCode, code), gt(roomEvents.id, cursor)))
        .orderBy(roomEvents.id)
        .limit(80);
      const nextCursor = fresh.length ? fresh[fresh.length - 1].id : cursor;
      return Response.json({
        ok: true,
        code,
        room,
        players: await playersOf(code),
        events: fresh.map((e) => ({ id: e.id, type: e.type, payload: e.payload ?? {} })),
        cursor: nextCursor,
        serverNow: Date.now(),
      });
    }

    if (action === "leave") {
      const playerId = String(body.playerId ?? "");
      const mine = await db.select().from(roomPlayers).where(eq(roomPlayers.id, playerId));
      if (mine.length) {
        const code = mine[0].roomCode;
        await db.delete(roomPlayers).where(eq(roomPlayers.id, playerId));
        await pushEvent(code, "leave", { playerId, name: mine[0].name });
        await ensureHost(code);
        const rest = await playersOf(code);
        if (!rest.some((p) => !p.isAi)) {
          await db.delete(roomEvents).where(eq(roomEvents.roomCode, code));
          await db.delete(roomPlayers).where(eq(roomPlayers.roomCode, code));
          await db.delete(rooms).where(eq(rooms.code, code));
        }
      }
      return Response.json({ ok: true, serverNow: Date.now() });
    }

    return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "Room request failed" }, { status: 500 });
  }
}

/** Lobby snapshot: room + seats (no state payload churn). */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  try {
    const room = await roomInfo(code.toUpperCase());
    if (!room) return Response.json({ ok: false, error: "No such room" }, { status: 404 });
    await janitor(code.toUpperCase());
    const [latestEvent] = await db
      .select({ id: roomEvents.id })
      .from(roomEvents)
      .where(eq(roomEvents.roomCode, code.toUpperCase()))
      .orderBy(desc(roomEvents.id))
      .limit(1);
    return Response.json({
      ok: true,
      room: await roomInfo(code.toUpperCase()),
      players: await playersOf(code.toUpperCase()),
      cursor: latestEvent?.id ?? 0,
      serverNow: Date.now(),
    });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "Room snapshot failed" }, { status: 500 });
  }
}
