import worker, { handleWorkerFetch } from "./worker";

const secret = "a".repeat(32);

function envWithStub(stubFetch: (request: Request) => Promise<Response>) {
  return {
    ROOMS: {
      idFromName: () => ({}),
      get: () => ({ fetch: stubFetch }),
    },
    KARTSWAR_REALTIME_AUTH_SECRET: secret,
    KARTSWAR_ALLOWED_ORIGINS: "https://kartswar.vercel.app",
  } as unknown as Parameters<typeof handleWorkerFetch>[1];
}

async function assertResponse(
  label: string,
  response: Promise<Response>,
  status: number,
) {
  const resolved = await response;
  if (resolved.status !== status) {
    throw new Error(`${label}: expected ${status}, received ${resolved.status}.`);
  }
  console.log(`${label}: ${resolved.status}`);
}

async function main() {
  const env = envWithStub(async () => new Response(null, { status: 200 }));
  await assertResponse(
    "GET /health",
    worker.fetch(new Request("https://worker.example/health"), env),
    200,
  );
  await assertResponse(
    "invalid route",
    worker.fetch(new Request("https://worker.example/not-a-route"), env),
    404,
  );
  await assertResponse(
    "room upgrade required",
    worker.fetch(new Request("https://worker.example/room/ABCDE"), env),
    426,
  );
  await assertResponse(
    "origin rejected",
    worker.fetch(new Request("https://worker.example/room/ABCDE", {
      headers: { Upgrade: "websocket", Origin: "https://evil.example" },
    }), env),
    403,
  );
  await assertResponse(
    "valid room setup",
    worker.fetch(new Request("https://worker.example/room/ABCDE", {
      headers: {
        Upgrade: "websocket",
        Origin: "https://kartswar.vercel.app",
      },
    }), env),
    200,
  );

  const health = await worker.fetch(
    new Request("https://worker.example/health"),
    env,
  );
  const body = await health.json();
  if (
    typeof body !== "object"
    || body === null
    || !("ok" in body)
    || body.ok !== true
  ) {
    throw new Error("GET /health returned an invalid response body.");
  }
  console.log("health response body: valid");
}

(async () => {
  await main();
})();
