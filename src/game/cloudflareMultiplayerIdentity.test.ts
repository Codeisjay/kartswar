import assert from "node:assert/strict";
import { identityFor } from "./cloudflareMultiplayerClient";

function createSessionStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  };
}

const firstTabStorage = createSessionStorage();
const secondTabStorage = createSessionStorage();
const firstTabIdentity = identityFor("ABCDE", firstTabStorage);
const secondTabIdentity = identityFor("ABCDE", secondTabStorage);

assert.notEqual(firstTabIdentity.playerId, secondTabIdentity.playerId, "different tabs must get different player IDs");
assert.notEqual(firstTabIdentity.resumeToken, secondTabIdentity.resumeToken, "different tabs must get different resume tokens");
assert.deepEqual(identityFor("ABCDE", firstTabStorage), firstTabIdentity, "reloading the same tab must retain its identity");

console.log("Cloudflare multiplayer identities are isolated per tab and stable within a tab.");
