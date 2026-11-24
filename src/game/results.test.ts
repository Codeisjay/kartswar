import assert from "node:assert/strict";
import { selectMatchWinner } from "./results";
import type { ResultRow } from "./types";

const row = (name: string, team: number, isPlayer = false): ResultRow => ({
  name,
  avatar: "😎",
  kartId: 0,
  kills: 0,
  deaths: 0,
  score: 0,
  team,
  isPlayer,
});

const blue = row("Blue", 0);
const red = row("Red", 1);
const player = row("Player", 0, true);

assert.equal(selectMatchWinner("ffa", false, true, [0, 0], [red, blue]), red);
assert.equal(selectMatchWinner("ffa", true, false, [0, 0], [red, blue]), null);
assert.equal(selectMatchWinner("team", false, true, [4, 7], [blue, red]), red);
assert.equal(selectMatchWinner("team", true, false, [4, 4], [blue, red]), null);
assert.equal(selectMatchWinner("survival", false, true, [0, 0], [player]), player);
assert.equal(selectMatchWinner("survival", false, false, [0, 0], [player]), null);

console.log("Match winner selection passed.");
