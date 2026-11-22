# Cloudflare Durable Objects multiplayer transport

This is a staged transport for **private, invitation-code rooms**. It replaces the existing Colyseus room transport only when `NEXT_PUBLIC_REALTIME_URL` is set. The Three.js simulation, collision code, weapon code, Vercel application, and legacy Colyseus server remain in place.

## What this migration changes (and does not)

- Cloudflare Worker routes `/room/<five-character-code>` WebSocket upgrades to one SQLite-backed `KartRoom` Durable Object per invitation code. The invitation code stays the shareable room locator. The old Colyseus-generated internal room UUID was ephemeral and was not persisted by this project; the Durable Object uses the room code as its stable room ID.
- The Durable Object owns room membership, readiness, host election, countdown, match phase, sequence checks, and each connected player's latest snapshot. It validates and relays state deltas; it does **not** run authoritative kart physics or authoritative combat. Position, health, pickups, and damage are still simulated client-side, as in the existing game.
- Durable Object storage is written for room/lobby lifecycle changes, not for each movement update. Latest snapshots are kept in memory and WebSocket attachments so they can be recovered after hibernation without movement writes to SQLite.
- WebSocket Hibernation is enabled with `state.acceptWebSocket()`. There is no 20 Hz server game loop. Client snapshots target 20 Hz, are delta encoded, and are limited to at most 25 Hz by the room. A bounded outbound buffer check drops a send rather than queueing indefinitely.
- Lobby tickets are signed by the Vercel Node.js Route Handler using `KARTSWAR_REALTIME_AUTH_SECRET` and verified by the Worker. The current repository has no account-authentication API; for this staged path, possession of the invitation code is the join credential. Treat codes as bearer secrets. This does not establish an account identity or stop a code holder from impersonating a display name.
- Ticket claims bind the five-character room code, player UUID, 24-byte re-entry token, profile fields, mode, intent, and 90-second expiry; the HMAC is verified in the Durable Object. Invalid tickets close unauthenticated sockets, reconnect requires the exact resume token, and one active socket per player ID replaces the previous socket. Room commands are throttled once per second, heartbeats once per second, and snapshots at 40 ms (25 Hz headroom). These controls prevent accidental misuse and basic command flooding, but they are not account-bound authentication and do not provide per-user rate limiting or revocation.
- The Vercel ticket route and Worker both require an exact `Origin` match from `KARTSWAR_ALLOWED_ORIGINS`. The ticket API is same-origin and does not enable cross-origin CORS. This is a browser-origin guard, not account authentication; invitation codes remain bearer credentials.
- The existing quick-match matchmaking and rollback path continue to use the legacy Colyseus server. Cloudflare quick matching needs a separate room allocator and is intentionally not routed to one global room.
- Snapshot state includes transform, velocity, health, weapon/ammo/firing state, and aim. Weapon state changes are relayed; projectiles and hits remain in the existing client simulation and are not server-validated.
- The existing game excludes remote karts from kart-kart physics collision resolution. Weapon firing and weapon state are relayed/replayed by the clients, but collision outcomes, projectiles, and damage are not server-authoritative. The new transport preserves this gameplay behavior; it does not claim authoritative combat synchronization.
- The Next.js dependency was upgraded from 16.4.2 to patched 16.4.6. This patch release removes the audited Next.js advisories affecting 16.0.0-16.4.4. React 19.2.6 and the existing API routes remain compatible; the production build passed on 16.4.6.
- Browser snapshots use a 50 ms accumulator (20 Hz intent) and delta/keyframe serialization. The Durable Object accepts movement at 40 ms headroom (up to 25 Hz) per player, while the browser remains at 20 Hz. The smoke test now reports sent updates, delivered updates, sequence gaps, delivery intervals, snapshot age, and RTT rather than infer frequency only from elapsed wall time.
- Remote interpolation extrapolates from the latest snapshot for at most 120 ms and stops extrapolation after 250 ms of stale time, holding the latest position and zero velocity. This reduces rubber-banding and backward jumps after packet delay or loss.

## Configure and deploy

1. Install the project dependencies with `npm install`.
2. Authenticate Wrangler in an interactive terminal. This opens a browser for Cloudflare login:
   ```powershell
   npx wrangler login
   ```
   Complete Cloudflare authorization in the browser, then return to the terminal. Do not continue to deployment until Wrangler confirms the account.
3. Generate a random secret with at least 32 bytes of entropy. Use the same value in Cloudflare and Vercel:
   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```
   Copy the generated value directly into the Cloudflare and Vercel secret prompts; do not save it in the repository or paste it into a `NEXT_PUBLIC_` variable.
   - As a Cloudflare Worker secret named `KARTSWAR_REALTIME_AUTH_SECRET`:
     ```powershell
     npx wrangler secret put KARTSWAR_REALTIME_AUTH_SECRET --config multiplayer/cloudflare/wrangler.toml
     ```
   - In Cloudflare, set `KARTSWAR_ALLOWED_ORIGINS` as a Worker secret/variable to a comma-separated list of exact origins (scheme + host + optional port, no paths). For Preview testing include the exact Preview deployment origin and `https://kartswar.vercel.app`:
     ```powershell
     npx wrangler secret put KARTSWAR_ALLOWED_ORIGINS --config multiplayer/cloudflare/wrangler.toml
     ```
   - In Vercel Project Settings -> Environment Variables, set `KARTSWAR_REALTIME_AUTH_SECRET` and `KARTSWAR_ALLOWED_ORIGINS` for Preview and Production. The secret must be server-only; never use a `NEXT_PUBLIC_` prefix. For each Vercel environment, set its own exact origin allowlist. Production should include `https://kartswar.vercel.app`.
4. Deploy the Worker and Durable Object migration:
   ```powershell
   npm run multiplayer:cloudflare:deploy
   ```
   The config creates the SQLite-backed `KartRoom` namespace and applies its migration. Do not deploy unless Cloudflare's dashboard shows the account/plan and the estimated usage is acceptable.
5. In Vercel Project Settings -> Environment Variables, configure Preview:
   - `KARTSWAR_REALTIME_AUTH_SECRET`: the same secret used by the Worker.
   - `KARTSWAR_ALLOWED_ORIGINS`: the exact Preview origin, for example `https://kartswar-git-<branch>-<team>.vercel.app`.
   - `NEXT_PUBLIC_REALTIME_URL`: the Worker HTTPS origin, for example `https://kartswar-realtime.<account>.workers.dev`.
   - `NEXT_PUBLIC_MULTIPLAYER_URL`: retain the currently deployed Colyseus endpoint for fallback and Quick Match.
   If the exact Preview URL is not known yet, deploy a Preview with `NEXT_PUBLIC_REALTIME_URL` unset, copy its exact Vercel URL, set the Preview origin and Worker allowlist, then redeploy Preview with the Cloudflare URL.
6. Deploy Preview using Vercel Git integration or, after interactive Vercel CLI authorization/linking, run:
   ```powershell
   npx vercel login
   npx vercel link
   npx vercel deploy
   ```
   Complete browser login and project linking interactively. Do not commit `.env`, `.env.local`, `.dev.vars`, or secret values.
7. Test a private room with two independent browser profiles using the checklist below. Keep Production `NEXT_PUBLIC_REALTIME_URL` unset and keep Colyseus deployed until all Preview tests pass.
8. For Production, update the Cloudflare and Vercel Production `KARTSWAR_ALLOWED_ORIGINS` values to include `https://kartswar.vercel.app`. Set Production `NEXT_PUBLIC_REALTIME_URL` to the Worker URL and retain the Colyseus URL. Redeploy the Worker if its allowlist changed, then deploy:
   ```powershell
   npx vercel deploy --prod
   ```
   Roll out only after verifying the Worker deployment and production settings. Do not assume deployment succeeded until the CLI/dashboard confirms it.

### Local development and two-client smoke test

Use separate terminals from the repository root.

Terminal 1 (legacy baseline used by the smoke test):

```powershell
npm run multiplayer:dev
```

Terminal 2 (local Worker and Durable Object):

```powershell
$env:KARTSWAR_REALTIME_AUTH_SECRET = "replace-with-a-random-32-byte-or-longer-secret"
npm run multiplayer:cloudflare:dev -- --var "KARTSWAR_REALTIME_AUTH_SECRET:$env:KARTSWAR_REALTIME_AUTH_SECRET" --var "KARTSWAR_ALLOWED_ORIGINS:http://localhost:3000"
```

Terminal 3:

```powershell
$env:KARTSWAR_REALTIME_AUTH_SECRET = "use-the-same-local-secret"
npm run multiplayer:cloudflare:smoke
```

The script uses two independent WebSocket clients (not browser tabs). It checks legacy and Cloudflare round-trip latency, room creation/join, ready/start, position relay, and player-ID preservation after reconnect. It signs tickets directly to test the Worker/DO boundary; the deployed browser path obtains them from `/api/multiplayer-ticket`.

Run the route regression test with:

```powershell
npm run multiplayer:cloudflare:routes
```

This verifies `GET /health`, invalid routes, missing WebSocket upgrades, rejected origins, and room stub routing. It does not perform a real WebSocket handshake or deploy the Worker.

To try the browser client locally, set `KARTSWAR_REALTIME_AUTH_SECRET`, `KARTSWAR_ALLOWED_ORIGINS=http://localhost:3000`, and `NEXT_PUBLIC_REALTIME_URL=http://localhost:8787` in `.env.local`, then start `npm run dev`. The shared secret must never be placed in a `NEXT_PUBLIC_` variable.

### Two-browser Preview checklist

Use two independent browser profiles (or one normal window and one private window), signed in to separate browser sessions if accounts are added later. Open the Vercel Preview URL in both. Capture a screen recording and browser performance trace for each run.

1. In browser A, create a private room and record its five-character code and displayed name. In browser B, join with that code. Verify two unique player IDs, correct names/karts, host/ready state, same room code, and distinct spawn slots/positions.
2. Ready both and start. Drive simultaneously in opposing directions. Verify remote karts stay present, interpolate smoothly, and never jump backward. Use browser Performance tools to record FPS (median and 1% low) for 60 seconds with both clients playing.
3. Fire each available weapon in turn. Confirm remote firing/weapon/ammo events appear on both clients. Test explosions and kart collisions visually, but record divergent health/position as a known client-authoritative limitation (kart-kart physical collisions intentionally exclude remote karts).
4. Record 100 RTT samples per client from client timestamp to server heartbeat echo; report median and p95. Record server snapshot timestamp age on receipt and count server snapshots over a 60-second run; the target is nominally 20 Hz while state changes, with unchanged fields omitted and a 1 Hz full keyframe.
5. Close one tab for under 20 seconds, then reopen/reconnect using the same profile/storage. Record reconnect time, verify the same network player ID and snapshot, and check no duplicate kart appears. Also test a reconnect after the 20-second room retention window; it should be a new seat if the old membership expired.
6. Finish the match, request restart from host, and verify both clients receive the same new match ID/countdown.
7. For delay/loss testing, use browser DevTools Network throttling or a controlled proxy; test 100 ms RTT and 2% packet loss, then 250 ms RTT and 5% loss. WebSocket runs over TCP, so packet loss causes retransmission/head-of-line delay rather than independent UDP snapshot loss. Record reconnects, snapshot age, and frame rate; do not treat DevTools as production-network data.
8. Create two different private rooms in separate pairs of browser profiles and move/fire in both. Verify the room state does not cross room boundaries and compare Cloudflare Durable Object usage before/after.

The local smoke script verifies two independent Node WebSocket clients, not browser rendering/FPS, collisions, or production Internet latency. Do not fill the Preview/Production measurement table with estimates.

## Latency and two-client test record

The checked-in code's pre-migration multiplayer transport is already persistent WebSockets (Colyseus), not HTTP polling. Therefore, a truthful before/after comparison here is **legacy Colyseus WebSocket vs. Cloudflare Durable Object WebSocket**, not polling vs. WebSocket.

`multiplayer:cloudflare:smoke` records 30 round-trip samples for each transport on the same local machine and reports median and p95. These local measurements are a smoke-test comparison, not production network latency.

| Transport / test | Median RTT | p95 RTT | Result |
| --- | ---: | ---: | --- |
| Existing Colyseus WebSocket (local baseline) | 1.62 ms | 2.94 ms | 30 local request/response samples |
| Cloudflare Durable Object WebSocket (local Wrangler) | 4 ms | 7 ms | Local Node smoke only; not browser/internet |
| Two independent production browsers | Not run | Not run | Requires deployed Preview URL and two browser profiles |

Latest local smoke result: **PASS** - two independent WebSocket clients created/joined a room, readied and started a match, exchanged positions in both directions (`x = 20` and `x = 40`), relayed firing state, preserved the second player's ID and latest snapshot on reconnect, restarted the match, and kept a second room isolated. With the final 40 ms server acceptance headroom, the fixed-interval movement sample sent 60 updates, delivered 61 snapshots, reported 0 missing sequence steps, and detected 0 dropped sends. Snapshot age was 14 ms median / 16 ms p95, with 55.64 ms median / 67.07 ms p95 delivery intervals and 68.41 ms maximum interval. The measured 17.34 Hz under Node/Miniflare reflects local fixed-timer and runtime overhead; the browser implementation remains at a 50 ms accumulator (20 Hz intent), and the DO accepts at 40 ms headroom (25 Hz maximum). These are local Node/Miniflare measurements, not a two-browser test or production latency. No production deployment or production latency sample was available in this workspace. Production measurements should be captured from at least two geographic locations under the same test conditions and compared with these local results.

## Free-tier usage estimate

This is an estimate based on Cloudflare's published pricing, not a guarantee of available capacity. Check the linked pricing pages and the account dashboard before every rollout. Free-plan limits are daily and exceeded operations can fail.

Relevant published Workers Free / Durable Objects Free limits:

- Durable Object requests: **100,000/day**; incoming WebSocket messages use a **20:1 request billing ratio** for compute billing. Each WebSocket upgrade is also a request.
- Durable Object duration: **13,000 GB-s/day**.
- SQLite-backed Durable Object storage: **100,000 rows written/day**, **5 million rows read/day**, and **5 GB total**. Each `setAlarm()` is a row write.
- Worker inbound requests: **100,000/day** and **10 ms CPU per invocation** on Free. The WebSocket handshake counts as an inbound Worker request; routed WebSocket messages do not count as Worker requests.

For `R` active rooms, `P` average connected players per room, and `H` active hours/day, sustained movement at 20 messages/second gives `R × P × H × 72,000` raw incoming state messages/day and about 1/20 as many request units. At 20 snapshot messages/second per player, before heartbeats and room lifecycle:

| Load | Incoming DO snapshot messages/day | Approx. DO requests/day after 20:1 ratio |
| --- | ---: | ---: |
| 1 player connected 24 hours | 1,728,000 | 86,400 |
| 2 players connected 24 hours | 3,456,000 | 172,800 |
| 2 players for one hour | 144,000 | 7,200 |
| 8 players for one hour | 576,000 | 28,800 |
| 8 players connected 24 hours | 13,824,000 | 691,200 |

Approximate message/request billing for a continuously active room, based on the actual 20 Hz client send cadence and 10-second heartbeat cadence:

| Connected players | One active hour | 24 active hours |
| ---: | ---: | ---: |
| 2 | 7,236 DO request units + lifecycle/upgrade units | 173,664 DO request units + lifecycle/alarm units |
| 4 | 14,472 DO request units + lifecycle/upgrade units | 347,328 DO request units + lifecycle/alarm units |
| 8 | 28,944 DO request units + lifecycle/upgrade units | 694,656 DO request units + lifecycle/alarm units |

These estimates count incoming 20 Hz snapshot traffic at the 20:1 WebSocket message/request ratio, plus incoming 10-second heartbeats. Outbound broadcast frames are not counted in this incoming-message estimate, but add Worker/Durable Object execution and network egress work. Room control messages, upgrades, and alarm writes are shown separately and can push a room over these totals.

Application heartbeats add 432 incoming DO messages/player-day at a 10-second interval, or about **22 request units/player-day** after the 20:1 ratio. An active room also uses about 2,880 heartbeat-timeout alarm invocations and alarm-set row writes per room-day, plus connection upgrades and room-control messages. Thus the Free request allowance supports at most about **1.15 player-days at sustained 20 Hz** before these extras; an eight-player room uses the daily allowance in about **3.5 room-hours**. The free tier is suitable for brief validation, not an always-on multiplayer population.

The DO does not persist movement snapshots. Room countdown and cleanup alarms are event-driven; they are not a 20 Hz game loop. Continuous snapshot traffic can still keep a room active and consume duration. At the maximum 128 MB allocation, 24 hours fully active is about 10,800 GB-s for that one room, before considering CPU overhead. Multiple continuously active rooms can exceed the 13,000 GB-s/day free allowance. Free-tier usage is a hard capacity limit, not unlimited hosting.

The room polls no database and uses no persistent simulation timer, but each active match's 20 Hz client traffic keeps its DO busy; hibernation primarily benefits idle rooms between sparse heartbeat/alarm events, not rooms with continuous movement.

For cost/usage tracking, watch Durable Object requests, duration, SQLite reads/writes, Worker requests/CPU, WebSocket counts, and failed/limited operations in Cloudflare Observability. Alert before reaching the daily limits. Cloudflare pricing references: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Rollback

Set `NEXT_PUBLIC_REALTIME_URL` to an empty value in Vercel and redeploy or roll back to the prior Vercel deployment. New private rooms then use the existing Colyseus server again. Keep that server and its deployment configuration available until the Cloudflare migration has passed browser testing and the production rollout is accepted.
