import type { Mode, ResultRow } from "./types";

export function selectMatchWinner(
  mode: Mode,
  draw: boolean,
  win: boolean,
  teamScores: [number, number],
  rows: ResultRow[],
): ResultRow | null {
  if (draw) return null;
  if (mode === "ffa") return rows[0] ?? null;
  if (mode === "team") {
    const winningTeam = teamScores[0] > teamScores[1] ? 0 : 1;
    return rows.find((row) => row.team === winningTeam) ?? null;
  }
  return win ? rows.find((row) => row.isPlayer) ?? null : null;
}
