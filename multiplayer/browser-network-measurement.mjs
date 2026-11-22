import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const transport = process.env.MULTIPLAYER_MEASURE_TRANSPORT ?? "cloudflare";
const durationSeconds = Number(process.env.MULTIPLAYER_MEASURE_SECONDS ?? 30);
const baseUrl = process.env.MULTIPLAYER_MEASURE_BASE_URL ?? "http://localhost:3000";
const realtimeEndpoint = process.env.MULTIPLAYER_MEASURE_REALTIME_URL ?? "http://127.0.0.1:8787";
const defaultBrowsers = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const browserPath = process.env.MULTIPLAYER_MEASURE_BROWSER
  ?? defaultBrowsers.find((path) => existsSync(path));
const browserWindowWidth = 900;
const browserWindowHeight = 700;

if (!["cloudflare", "colyseus"].includes(transport)) {
  throw new Error("MULTIPLAYER_MEASURE_TRANSPORT must be 'cloudflare' or 'colyseus'.");
}
if (!Number.isFinite(durationSeconds) || durationSeconds < 30) {
  throw new Error("MULTIPLAYER_MEASURE_SECONDS must be at least 30.");
}
if (!browserPath || !existsSync(browserPath)) {
  throw new Error("Set MULTIPLAYER_MEASURE_BROWSER to an installed Chrome or Edge executable.");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openLobby(page) {
  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem("kw_settings_v1") ?? "{}");
    localStorage.setItem("kw_settings_v1", JSON.stringify({ ...settings, quality: "low" }));
  });
  await page.goto(`${baseUrl.replace(/\/+$/, "")}/?netdebug=1`, { waitUntil: "domcontentloaded" });
  const heading = page.getByRole("heading", { name: "Multiplayer" });
  const button = page.getByRole("button", { name: /Multiplayer/ });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await heading.isVisible().catch(() => false)) return;
    if (await button.isVisible().catch(() => false)) await button.click();
    await page.waitForTimeout(250);
  }
  throw new Error("The browser did not enter the multiplayer lobby.");
}

async function waitForRoomPlayers(page, expectedCount) {
  await page.waitForFunction((count) => document.body.innerText.includes(`${count}/8`), expectedCount, {
    timeout: 20_000,
  });
}

async function startCloudflareRoom(firstPage, secondPage) {
  await firstPage.getByRole("button", { name: "Create Room" }).click();
  await firstPage.getByRole("button", { name: /Create Private Room/ }).waitFor({ timeout: 10_000 });
  await firstPage.getByRole("button", { name: /Create Private Room/ }).click();
  const codeElement = firstPage.getByText(/^[A-Z0-9]{5}$/);
  try {
    await codeElement.waitFor({ timeout: 15_000 });
  } catch {
    const state = (await firstPage.locator("body").innerText()).slice(-1_500);
    throw new Error(`Private room setup failed before showing a room code. Current lobby text:\n${state}`);
  }
  const roomCode = (await codeElement.innerText()).trim();

  await secondPage.getByRole("button", { name: "Join Room" }).click();
  await secondPage.getByPlaceholder("ABCDE").fill(roomCode);
  await secondPage.getByRole("button", { name: /Join Room/ }).last().click();
  await Promise.all([waitForRoomPlayers(firstPage, 2), waitForRoomPlayers(secondPage, 2)]);
  await secondPage.getByRole("button", { name: /Ready Up/ }).click();
  await firstPage.getByRole("button", { name: /Start Match/ }).click();
  return roomCode;
}

async function startColyseusQuickMatch(firstPage, secondPage) {
  await Promise.all([
    firstPage.getByRole("button", { name: /Find Match/ }).click(),
    secondPage.getByRole("button", { name: /Find Match/ }).click(),
  ]);
  await Promise.all([waitForRoomPlayers(firstPage, 2), waitForRoomPlayers(secondPage, 2)]);
  const firstStarts = firstPage.getByRole("button", { name: /Start Match/ });
  if (await firstStarts.count()) {
    const secondReady = secondPage.getByRole("button", { name: /Ready Up/ });
    if (await secondReady.count()) await secondReady.click();
    await firstStarts.click();
  } else {
    const secondStarts = secondPage.getByRole("button", { name: /Start Match/ });
    const firstReady = firstPage.getByRole("button", { name: /Ready Up/ });
    if (!(await secondStarts.count()) || !(await firstReady.count())) {
      throw new Error("Quick Match did not expose one host Start Match and one guest Ready Up action.");
    }
    await firstReady.click();
    await secondStarts.click();
  }
  return null;
}

async function diagnostics(page) {
  const panel = page.locator('pre[aria-label="Remote network diagnostics"]');
  await panel.waitFor({ timeout: 20_000 });
  const [text, pipeline, sampleAt] = await Promise.all([
    panel.innerText(),
    panel.getAttribute("data-cloudflare-pipeline"),
    panel.getAttribute("data-pipeline-sample-at"),
  ]);
  return {
    text,
    pipeline: pipeline ? JSON.parse(pipeline) : null,
    sampleAt: sampleAt === null ? null : Number(sampleAt),
  };
}

function parseCounter(line, pattern) {
  const match = line.match(pattern);
  return match ? Number(match[1]) : null;
}

function parsePipeline(text) {
  const result = {};
  const rows = text.split("\n");
  const tx = rows.find((row) => row.startsWith("CF tx totals:"));
  const sampled = rows.find((row) => row.startsWith("CF sampled state changes:"));
  const deltas = rows.find((row) => row.startsWith("CF delta messages:"));
  const wire = rows.find((row) => row.startsWith("CF tx wire:"));
  const rx = rows.find((row) => row.startsWith("CF rx:"));
  if (!tx || !sampled || !deltas || !wire || !rx) return null;
  for (const [key, expression] of Object.entries({
    sendInvocations: /invoked (\d+)/,
    deltaSuppressed: /unchanged (\d+)/,
    inactiveSkips: /inactive (\d+)/,
    socketUnavailableSkips: /socket (\d+)/,
    backpressureSkips: /backpressure (\d+)/,
  })) result[key] = parseCounter(tx, expression);
  for (const [key, expression] of Object.entries({
    stateChangedAttempts: /any (\d+)/,
    observedPositionChanges: /pos (\d+)/,
    observedVelocityChanges: /vel (\d+)/,
    observedRotationChanges: /rot (\d+)/,
    observedGameplayChanges: /gameplay (\d+)/,
  })) result[key] = parseCounter(sampled, expression);
  for (const [key, expression] of Object.entries({
    positionChangedMessages: /pos (\d+)/,
    velocityChangedMessages: /vel (\d+)/,
    rotationChangedMessages: /rot (\d+)/,
    gameplayChangedMessages: /gameplay (\d+)/,
  })) result[key] = parseCounter(deltas, expression);
  for (const [key, expression] of Object.entries({
    serializedMessages: /serialized (\d+)/,
    websocketSendCalls: /WebSocket\.send (\d+)/,
    maxBufferedAmount: /max (\d+) B/,
  })) result[key] = parseCounter(wire, expression);
  for (const [key, expression] of Object.entries({
    websocketMessagesReceived: /WS (\d+)/,
    snapshotMessagesReceived: /snapshots (\d+)/,
    acceptedSnapshotMessages: /accepted (\d+)/,
    staleSnapshotMessages: /stale (\d+)/,
    malformedSnapshotMessages: /malformed (\d+)/,
    incompleteSnapshotMessages: /incomplete (\d+)/,
    snapshotFramesEmitted: /frames (\d+)/,
  })) result[key] = parseCounter(rx, expression);
  return result;
}

function parseClientWindow(text) {
  const parsed = {};
  const fields = {
    windowSeconds: [/^Rolling window: ([\d.]+)s$/m],
    snapshotsSentPerSecond: [/^Client snapshots\/s: ([\d.]+) sent/m],
    snapshotAttemptsPerSecond: [/^Client snapshots\/s: [\d.]+ sent \/ ([\d.]+) attempted/m],
    remoteReceivesPerSecond: [/^Remote receives\/s: ([\d.]+)/m],
    snapshotAgeP95Ms: [/^Snapshot age p95: ([\d.]+) ms/m],
    snapshotJitterP95Ms: [/^Snapshot jitter p95: ([\d.]+) ms/m],
    sequenceGaps: [/^Sequence gaps \/ stale: (\d+)/m],
    staleSnapshots: [/^Sequence gaps \/ stale: \d+ \/ (\d+)/m],
    browserFps: [/^Browser FPS: ([\d.]+)/m],
    eventLoopDelayP95Ms: [/^Event-loop delay p95: ([\d.]+) ms/m],
    interpolationBufferDepth: [/^Remote buffer depth avg: ([\d.]+)/m],
    extrapolationFramesPerSecond: [/^Extrapolation frames\/s: ([\d.]+)/m],
    serverMessagesReceivedPerSecond: [/^Server snapshots: ([\d.]+) received\/s/m],
    serverSnapshotsAcceptedPerSecond: [/^Server snapshots: [\d.]+ received\/s \/ ([\d.]+) accepted\/s/m],
    serverValidationPerSecond: [/^Server validation: ([\d.]+)\/s/m],
    serverRelayTicksPerSecond: [/^Server relay: ([\d.]+) ticks\/s/m],
    serverBroadcastAttemptsPerSecond: [/^Server relay: [\d.]+ ticks\/s \/ ([\d.]+) attempts\/s/m],
    serverRejectedSnapshots: [/^Server rejects: (\d+)/m],
  };
  for (const [key, patterns] of Object.entries(fields)) {
    const match = text.match(patterns[0]);
    parsed[key] = match ? Number(match[1]) : null;
  }
  return parsed;
}

function subtractCounters(after, before) {
  if (!after || !before) return null;
  return Object.fromEntries(Object.keys(after).map((key) => {
    if (after[key] === null || before[key] === null) return [key, null];
    const difference = after[key] - before[key];
    return [key, difference >= 0 ? difference : null];
  }));
}

function stageCounters(stats) {
  if (!stats) return null;
  const nonCounters = new Set(["lastReadyState", "lastBufferedAmount", "maxBufferedAmount"]);
  return Object.fromEntries(Object.entries(stats).filter(([key]) => !nonCounters.has(key)));
}

async function cloudflareServerMetrics(roomCode) {
  const url = new URL(realtimeEndpoint);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Browser measurement only queries a local Cloudflare Worker diagnostics endpoint.");
  }
  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  url.pathname = `/__debug/metrics/${roomCode}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Local Cloudflare metrics request failed with HTTP ${response.status}.`);
  return response.json();
}

const browsers = [];
const contexts = [];
try {
  const firstBrowser = await chromium.launch({
    executablePath: browserPath,
    headless: false,
    args: [`--window-size=${browserWindowWidth},${browserWindowHeight}`, "--window-position=0,0"],
  });
  const secondBrowser = await chromium.launch({
    executablePath: browserPath,
    headless: false,
    args: [`--window-size=${browserWindowWidth},${browserWindowHeight}`, `--window-position=${browserWindowWidth},0`],
  });
  browsers.push(firstBrowser, secondBrowser);
  const firstContext = await firstBrowser.newContext({ viewport: { width: browserWindowWidth, height: browserWindowHeight } });
  const secondContext = await secondBrowser.newContext({ viewport: { width: browserWindowWidth, height: browserWindowHeight } });
  contexts.push(firstContext, secondContext);
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  await openLobby(firstPage);
  await openLobby(secondPage);
  const roomCode = transport === "cloudflare"
    ? await startCloudflareRoom(firstPage, secondPage)
    : await startColyseusQuickMatch(firstPage, secondPage);

  await Promise.all([
    firstPage.locator('pre[aria-label="Remote network diagnostics"]').waitFor({ timeout: 30_000 }),
    secondPage.locator('pre[aria-label="Remote network diagnostics"]').waitFor({ timeout: 30_000 }),
  ]);
  await wait(5_000);
  for (const page of [firstPage, secondPage]) {
    await page.keyboard.down("w");
    await page.keyboard.down("d");
    await page.keyboard.down("Shift");
  }

  const visibilitySamples = [0, 0];
  const finalWindowVisibilitySamples = [0, 0];
  let finalWindowVisibilitySampleCount = 0;
  const startAt = Date.now();
  let at20Seconds = null;
  let finalDiagnostics = null;
  while (Date.now() - startAt < durationSeconds * 1_000) {
    await wait(1_000);
    for (const [index, page] of [firstPage, secondPage].entries()) {
      if (await page.evaluate(() => document.visibilityState === "visible")) visibilitySamples[index] += 1;
      if (
        Date.now() - startAt >= durationSeconds * 1_000 - 10_000
        && await page.evaluate(() => document.visibilityState === "visible")
      ) finalWindowVisibilitySamples[index] += 1;
    }
    if (Date.now() - startAt >= durationSeconds * 1_000 - 10_000) finalWindowVisibilitySampleCount += 1;
    const elapsed = Date.now() - startAt;
    if (elapsed >= 20_000 && !at20Seconds) {
      at20Seconds = await Promise.all([diagnostics(firstPage), diagnostics(secondPage)]);
    }
  }
  const finishedAt = Date.now();
  for (const page of [firstPage, secondPage]) {
    await page.keyboard.up("w");
    await page.keyboard.up("d");
    await page.keyboard.up("Shift");
  }
  finalDiagnostics = await Promise.all([diagnostics(firstPage), diagnostics(secondPage)]);
  const renderer = await firstPage.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    const extension = context?.getExtension("WEBGL_debug_renderer_info");
    return extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : "unavailable";
  });
  const server = transport === "cloudflare" ? await cloudflareServerMetrics(roomCode) : null;
  const clientWindows = finalDiagnostics.map((sample) => parseClientWindow(sample.text));
  const stageWindowDeltas = finalDiagnostics.map((text, index) => {
    const after = text.pipeline;
    const before = at20Seconds ? at20Seconds[index].pipeline : null;
    const difference = subtractCounters(stageCounters(after), stageCounters(before));
    const stageWindowSeconds = after && before
      ? (text.sampleAt - at20Seconds[index].sampleAt) / 1_000
      : null;
    if (!difference || !stageWindowSeconds || stageWindowSeconds <= 0) return null;
    return {
      windowSeconds: Number(stageWindowSeconds.toFixed(2)),
      counts: difference,
      perSecond: Object.fromEntries(Object.entries(difference).map(([key, count]) => [
        key,
        count === null ? null : Number((count / stageWindowSeconds).toFixed(2)),
      ])),
    };
  });
  const limitations = [];
  if (visibilitySamples.some((count) => count < Math.ceil(durationSeconds * 0.9))) {
    limitations.push("At least one browser page was not visible for 90% of the sample.");
  }
  if (/swiftshader|llvmpipe|software/i.test(renderer)) {
    limitations.push("The browser reported a software WebGL renderer; FPS is not representative of hardware rendering.");
  }
  if (
    transport === "cloudflare"
    && stageWindowDeltas.every((client) => !client || client.counts.observedPositionChanges === 0)
  ) {
    limitations.push("Neither Cloudflare client reported sampled position changes in the stage window.");
  }
  if (finalWindowVisibilitySamples.some((count) => count < Math.ceil(finalWindowVisibilitySampleCount * 0.9))) {
    limitations.push("At least one browser page was not visible for 90% of the final measurement window.");
  }

  console.log(JSON.stringify({
    result: "MEASURED",
    classification: "local two-browser test; not an internet or production measurement",
    transport,
    durationMs: Date.now() - startAt,
    browser: browserPath,
    graphicsQuality: "low",
    renderer,
    roomCode,
    visibilitySamples,
    visibilitySampleCount: Math.ceil(durationSeconds),
    finalWindowVisibilitySamples,
    finalWindowVisibilitySampleCount,
    clientRolling10SecondWindows: clientWindows,
    stageMeasurementWindow: at20Seconds ? {
      clients: stageWindowDeltas,
    } : null,
    clientsAtEnd: finalDiagnostics.map((sample) => ({
      diagnostics: sample.text,
      cloudflarePipelineTotals: sample.pipeline ?? parsePipeline(sample.text),
    })),
    cloudflareServerMetrics: server,
    limitations,
  }, null, 2));
} finally {
  for (const context of contexts) await context.close();
  for (const browser of browsers) await browser.close();
}
