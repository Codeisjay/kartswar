import { createHmac } from "node:crypto";
import { MAX_KART_ID } from "@/game/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TicketRequest {
  code?: unknown;
  mode?: unknown;
  intent?: unknown;
  playerId?: unknown;
  resumeToken?: unknown;
  profile?: unknown;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function text(value: unknown, fallback: string, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength) || fallback
    : fallback;
}

function allowedOrigin(origin: string | null, configuration: string | undefined) {
  if (!origin || !configuration) return false;
  try {
    return new URL(origin).origin === origin
      && configuration.split(",").map((value) => value.trim()).includes(origin);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const allowedOrigins = process.env.KARTSWAR_ALLOWED_ORIGINS;
  if (!allowedOrigins) return Response.json({ error: "Multiplayer origin allowlist is not configured." }, { status: 503 });
  if (!allowedOrigin(request.headers.get("origin"), allowedOrigins)) {
    return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const body = value as TicketRequest;

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const intent = body.intent;
  const profile = body.profile && typeof body.profile === "object"
    ? body.profile as Record<string, unknown>
    : {};
  const secret = process.env.KARTSWAR_REALTIME_AUTH_SECRET;

  if (!/^[A-Z0-9]{5}$/.test(code)) return Response.json({ error: "A valid five-character room code is required." }, { status: 400 });
  if (intent !== "create" && intent !== "join") return Response.json({ error: "Room intent must be create or join." }, { status: 400 });
  if (body.mode !== "ffa" && body.mode !== "team") return Response.json({ error: "Game mode must be ffa or team." }, { status: 400 });
  if (typeof body.playerId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.playerId)) {
    return Response.json({ error: "A valid player identity is required." }, { status: 400 });
  }
  if (typeof body.resumeToken !== "string" || !/^[0-9a-f]{48}$/i.test(body.resumeToken)) {
    return Response.json({ error: "A valid room re-entry token is required." }, { status: 400 });
  }
  if (!secret || Buffer.byteLength(secret) < 32) {
    return Response.json({ error: "Cloudflare room authentication is not configured." }, { status: 503 });
  }

  const playerName = text(profile.name, "Driver", 20);
  const avatar = text(profile.avatar, "😎", 4);
  const kartId = typeof profile.kartId === "number" && Number.isInteger(profile.kartId) && profile.kartId >= 0 && profile.kartId <= MAX_KART_ID
    ? profile.kartId
    : 0;
  const claims = {
    v: 1,
    room: code,
    playerId: body.playerId,
    resumeToken: body.resumeToken,
    profile: { name: playerName, avatar, kartId },
    mode: body.mode,
    intent,
    exp: Math.floor(Date.now() / 1000) + 90,
  };
  const payload = base64Url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret).update(payload).digest();
  return Response.json({ ticket: `${payload}.${base64Url(signature)}` }, {
    headers: { "Cache-Control": "no-store" },
  });
}
