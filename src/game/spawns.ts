import type { SpawnPoint } from "./arena";

export const MAP_ID = "neon-city-v1";

export function getSpawnPoints(): SpawnPoint[] {
  return Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const x = Math.cos(angle) * 58;
    const z = Math.sin(angle) * 58;
    return { x, z, heading: Math.atan2(-x, -z) };
  });
}
