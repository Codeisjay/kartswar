import worker, { consumeSnapshotRateLimitToken, handleWorkerFetch } from "./worker";

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
  let rateLimitBucket: ReturnType<typeof consumeSnapshotRateLimitToken>["bucket"] | undefined;
  for (let index = 0; index < 20; index += 1) {
    const result = consumeSnapshotRateLimitToken(rateLimitBucket, index * 50);
    if (!result.allowed) {
      throw new Error("The snapshot rate limiter rejected a regular 20 Hz stream.");
    }
    rateLimitBucket = result.bucket;
  }
  console.log("20 Hz snapshot stream allowed: true");

  const firstBurst = consumeSnapshotRateLimitToken(undefined, 0);
  const secondBurst = consumeSnapshotRateLimitToken(firstBurst.bucket, 1);
  const excessBurst = consumeSnapshotRateLimitToken(secondBurst.bucket, 2);
  if (!firstBurst.allowed || !secondBurst.allowed || excessBurst.allowed) {
    throw new Error("Snapshot burst capacity is not limited to two immediate messages.");
  }
  console.log("snapshot burst capacity: 2");

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
  await assertResponse(
    "diagnostics disabled by default",
    worker.fetch(new Request("http://127.0.0.1/__debug/metrics/ABCDE"), env),
    404,
  );
  await assertResponse(
    "diagnostics unavailable outside localhost",
    worker.fetch(new Request("https://worker.example/__debug/metrics/ABCDE", {
      headers: { "Origin": "https://kartswar.vercel.app" },
    }), {
      ...env,
      KARTSWAR_NETWORK_DIAGNOSTICS: "true",
    }),
    404,
  );
  await assertResponse(
    "localhost diagnostics route",
    worker.fetch(new Request("http://127.0.0.1/__debug/metrics/ABCDE"), {
      ...env,
      KARTSWAR_NETWORK_DIAGNOSTICS: "true",
    }),
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
