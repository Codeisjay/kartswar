import { and, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { roomEvents, roomPlayers, rooms } from "@/db/schema";

export const dynamic = "force-dynamic";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STALE_MS = 45_000;

function newCode(): string {
  let c = "";
  for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}
function id(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

async function playersOf(code: string) {
  const rows = await db.select().from(roomPlayers).where(eq(roomPlayers.roomCode, code));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    avatar: r.avatar,
    kartId: r.kartId,
    isHost: r.isHost,
    isAi: r.isAi,
    state: (r.state ?? {}) as Record<string, unknown>,
  }));
}

async function roomInfo(code: string) {
  const [room] = await db.select().from(rooms).where(eq(rooms.code, code));
  return room ?? null;
}

/** Prune stale players + old events so rooms cannot leak forever. */
async function janitor(code: string) {
  await db.delete(roomPlayers).where(
    and(eq(roomPlayers.roomCode, code), lt(roomPlayers.updatedAt, new Date(Date.now() - STALE_MS)), eq(roomPlayers.isAi, false)),
  );
  await db.delete(roomEvents).where(and(eq(roomEvents.roomCode, code), lt(roomEvents.createdAt, new Date(Date.now() - 120_000))));
}

async function pushEvent(code: string, type: string, payload: Record<string, unknown>) {
  await db.insert(roomEvents).values({ roomCode: code, type, payload });
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
      const seed = (Math.random() * 0x7fffffff) | 0 || 1;
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
        name: String(body.name ?? "Driver"),
        avatar: String(body.avatar ?? "😎"),
        kartId: Number(body.kartId ?? 0),
        isHost: true,
        isAi: false,
        state: {},
      });
      await pushEvent(code, "join", { playerId, name: String(body.name ?? "Driver") });
      return Response.json({ ok: true, code, playerId, players: await playersOf(code), room: await roomInfo(code) });
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
      if (room.status !== "lobby") return Response.json({ ok: false, error: "Match already started" }, { status: 409 });
      const existing = await playersOf(room.code);
      if (existing.length >= (room.maxPlayers ?? 8)) return Response.json({ ok: false, error: "Room is full" }, { status: 409 });
      const playerId = id();
      await db.insert(roomPlayers).values({
        id: playerId,
        roomCode: room.code,
        name: String(body.name ?? "Driver"),
        avatar: String(body.avatar ?? "😎"),
        kartId: Number(body.kartId ?? 0),
        isHost: false,
        isAi: false,
        state: {},
      });
      await pushEvent(room.code, "join", { playerId, name: String(body.name ?? "Driver") });
      room = await roomInfo(room.code);
      return Response.json({ ok: true, code: room?.code, playerId, players: await playersOf(room!.code), room });
    }

    if (action === "addai") {
      const code = String(body.code ?? "").toUpperCase();
      const room = await roomInfo(code);
      if (!room) return Response.json({ ok: false, error: "No such room" }, { status: 404 });
      const current = await playersOf(code);
      if (current.length >= (room.maxPlayers ?? 8)) return Response.json({ ok: false, error: "Room is full" }, { status: 409 });
      const aiId = `ai_${Math.random().toString(36).slice(2, 9)}`;
      await db.insert(roomPlayers).values({
        id: aiId,
        roomCode: code,
        name: String(body.name ?? "AI Driver"),
        avatar: String(body.avatar ?? "🤖"),
        kartId: Number(body.kartId ?? 0),
        isHost: false,
        isAi: true,
        state: {},
      });
      await pushEvent(code, "join", { playerId: aiId, name: String(body.name ?? "AI Driver"), ai: true });
      return Response.json({ ok: true, players: await playersOf(code), room: await roomInfo(code) });
    }

    if (action === "kick") {
      const code = String(body.code ?? "").toUpperCase();
      await db.delete(roomPlayers).where(and(eq(roomPlayers.roomCode, code), eq(roomPlayers.id, String(body.target ?? ""))));
      return Response.json({ ok: true, players: await playersOf(code) });
    }

    if (action === "start") {
      const code = String(body.code ?? "").toUpperCase();
      const room = await roomInfo(code);
      if (!room) return Response.json({ ok: false, error: "No such room" }, { status: 404 });
      if (room.hostId !== String(body.playerId ?? "")) return Response.json({ ok: false, error: "Only the host can start" }, { status: 403 });
      await db
        .update(rooms)
        .set({ status: "playing", mapId: String(body.mapId ?? room.mapId), mode: String(body.mode ?? room.mode), updatedAt: new Date() })
        .where(eq(rooms.code, code));
      await pushEvent(code, "start", { mapId: String(body.mapId ?? room.mapId), mode: String(body.mode ?? room.mode) });
      return Response.json({ ok: true, room: await roomInfo(code) });
    }

    if (action === "sync") {
      const playerId = String(body.playerId ?? "");
      const cursor = Number(body.cursor ?? 0);
      const mine = await db.select().from(roomPlayers).where(eq(roomPlayers.id, playerId));
      if (!mine.length) return Response.json({ ok: false, error: "Not in a room" }, { status: 404 });
      const code = mine[0].roomCode;
      const state = (body.state ?? {}) as Record<string, unknown>;
      await db
        .update(roomPlayers)
        .set({ state, updatedAt: new Date() })
        .where(eq(roomPlayers.id, playerId));
      // queue gameplay events (fire / hit / death)
      const events = (body.events ?? []) as { type: string; payload: Record<string, unknown> }[];
      for (const e of events.slice(0, 24)) await pushEvent(code, e.type, { ...e.payload, source: playerId });
      await janitor(code);
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
        room: await roomInfo(code),
        players: await playersOf(code),
        events: fresh.map((e) => ({ id: e.id, type: e.type, payload: e.payload ?? {} })),
        cursor: nextCursor,
      });
    }

    if (action === "leave") {
      const playerId = String(body.playerId ?? "");
      const mine = await db.select().from(roomPlayers).where(eq(roomPlayers.id, playerId));
      if (mine.length) {
        const code = mine[0].roomCode;
        await db.delete(roomPlayers).where(eq(roomPlayers.id, playerId));
        await pushEvent(code, "leave", { playerId, name: mine[0].name });
        const rest = await playersOf(code);
        if (!rest.some((p) => !p.isAi)) {
          await db.delete(roomEvents).where(eq(roomEvents.roomCode, code));
          await db.delete(roomPlayers).where(eq(roomPlayers.roomCode, code));
          await db.delete(rooms).where(eq(rooms.code, code));
        }
      }
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

/** Lobby snapshot: room + seats (no state payload churn). */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  try {
    const room = await roomInfo(code.toUpperCase());
    if (!room) return Response.json({ ok: false, error: "No such room" }, { status: 404 });
    await janitor(code.toUpperCase());
    return Response.json({ ok: true, room, players: await playersOf(code.toUpperCase()) });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
