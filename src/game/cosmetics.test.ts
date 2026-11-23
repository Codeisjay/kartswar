import assert from "node:assert/strict";
import { buyCosmetic, calculateMatchCredits } from "./cosmetics";
import { awardMatchCredits, loadProfile } from "./storage";
import { DEFAULT_PROFILE } from "./types";

const savedItems = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => savedItems.get(key) ?? null,
    setItem: (key: string, value: string) => savedItems.set(key, value),
  },
});
savedItems.set("kw_profile_v1", JSON.stringify({ name: "Returning Driver", avatar: "🤖", kartId: 2, glow: 0xb64dff }));
const migratedProfile = loadProfile();
assert.equal(migratedProfile.credits, 0, "legacy profiles start with an empty wallet");
assert.deepEqual(migratedProfile.ownedPaints, ["factory"]);
assert.equal(migratedProfile.wheelStyle, "stock");

const wallet = {
  ...DEFAULT_PROFILE,
  credits: 220,
  ownedPaints: [...DEFAULT_PROFILE.ownedPaints],
  ownedWheelStyles: [...DEFAULT_PROFILE.ownedWheelStyles],
};
const painted = buyCosmetic(wallet, "sunset");
assert.equal(painted?.credits, 70);
assert.equal(painted?.paintId, "sunset");
assert.equal(painted && buyCosmetic(painted, "sunset"), null, "owned cosmetics cannot be purchased twice");
const wheels = buyCosmetic(wallet, "gold");
assert.equal(wheels?.credits, 100);
assert.equal(wheels?.wheelStyle, "gold");
assert.equal(buyCosmetic(wallet, "chrome"), null, "unaffordable cosmetics cannot be purchased");
assert.equal(buyCosmetic(wallet, "unknown"), null, "unknown cosmetics cannot be purchased");
assert.equal(calculateMatchCredits(0, false), 10);
assert.equal(calculateMatchCredits(1_000, true), 45);
assert.equal(calculateMatchCredits(Number.MAX_SAFE_INTEGER, true), 200);
assert.equal(awardMatchCredits(1_000, true), 45);
assert.equal(loadProfile().credits, 45, "match rewards persist in the local profile");

console.log("Cosmetic purchases and match-credit rewards passed.");
