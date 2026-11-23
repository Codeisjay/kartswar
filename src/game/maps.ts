import type * as THREE from "three";
import { buildArena, type Arena } from "./arena";
import { auditMap } from "./maps/common";
import type { MapQuality } from "./maps/common";
import { buildCity } from "./maps/city";
import { buildJungle } from "./maps/jungle";
import { buildVolcano } from "./maps/volcano";
import { buildSunbeam } from "./maps/sunbeam";
import { buildAlpine } from "./maps/alpine";
import { MAP_ID } from "./spawns";

export type MapId = "neon" | "city" | "volcano" | "jungle" | "sunbeam" | "alpine";

export interface MapEnv {
  bg: number;
  /** renderer tone-mapping exposure for this map */
  exposure: number;
  fog: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunIntensity: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  tagline: string;
  desc: string;
  difficulty: "Easy" | "Medium" | "Spicy";
  traits: string[];
  image: string;
  env: MapEnv;
}

export const MAPS: MapDef[] = [
  {
    id: "neon",
    name: "Neon Combat Arena",
    tagline: "The classic battleground",
    desc: "Futuristic neon arena with a central energy tower, jump ramps, raised highways and glowing barriers.",
    difficulty: "Easy",
    traits: ["Open center", "Jump ramps", "Highways", "8-kart chaos"],
    image: "/maps/neon.jpg",
    env: { bg: 0x120a2a, exposure: 1.12, fog: [0x1a0f3a, 90, 300], hemiSky: 0x9bb4ff, hemiGround: 0x3a2150, hemi: 1.15, sun: 0xffe2f0, sunIntensity: 2.1 },
  },
  {
    id: "city",
    name: "Cyber City Circuit",
    tagline: "Midnight downtown battle",
    desc: "Neon city avenues, an elevated highway, parking-lot skirmishes and tower podiums under a starry sky.",
    difficulty: "Easy",
    traits: ["Wide avenues", "Elevated highway", "Parking zones", "Towers"],
    image: "/maps/city.jpg",
    env: { bg: 0x05051a, exposure: 1.26, fog: [0x0a0a26, 95, 320], hemiSky: 0x8a9bff, hemiGround: 0x2a1a4a, hemi: 1.45, sun: 0xc4b4ff, sunIntensity: 2.2 },
  },
  {
    id: "volcano",
    name: "Volcano Mayhem",
    tagline: "Fight around the crater",
    desc: "Volcanic island with a lava moat, bridges over molten rock, rocky platforms and glowing crystals. Mind the lava!",
    difficulty: "Spicy",
    traits: ["Lava damage", "Bridges", "Ring road", "Hazards"],
    image: "/maps/volcano.jpg",
    env: { bg: 0x1a0605, exposure: 1.22, fog: [0x331008, 85, 290], hemiSky: 0xff9a6a, hemiGround: 0x3a1420, hemi: 1.1, sun: 0xffb060, sunIntensity: 2.1 },
  },
  {
    id: "jungle",
    name: "Toxic Jungle",
    tagline: "Abandoned facility overrun",
    desc: "Overgrown jungle facility with ruined halls, water crossings, a watchtower and rock tunnels at dusk.",
    difficulty: "Medium",
    traits: ["Ruined halls", "Bridges", "Watchtower", "Tunnels"],
    image: "/maps/jungle.jpg",
    env: { bg: 0x0a2018, exposure: 1.14, fog: [0x143024, 90, 300], hemiSky: 0xaaffcc, hemiGround: 0x2a4a2a, hemi: 1.15, sun: 0xfff2c0, sunIntensity: 2.05 },
  },
  {
    id: "sunbeam",
    name: "Sunbeam Boardwalk",
    tagline: "A bright day at the beach",
    desc: "Race across a sunny sandy arena, weave through the pastel boardwalk and launch onto the raised central pier.",
    difficulty: "Easy",
    traits: ["Bright beach", "Boardwalk", "Four jump ramps", "Open lanes"],
    image: "/maps/sunbeam.svg",
    env: { bg: 0x9bdff3, exposure: 1.08, fog: [0xc6edf5, 150, 440], hemiSky: 0xc7f3ff, hemiGround: 0xb9a57c, hemi: 1.55, sun: 0xfff1cf, sunIntensity: 2.35 },
  },
  {
    id: "alpine",
    name: "Alpine Combat Meadow",
    tagline: "Fight across the foothills",
    desc: "An open Alpine battle plain centered around a deep island lake, with natural plateau ramps, collision-backed rock formations, and evergreen forest.",
    difficulty: "Medium",
    traits: ["Open combat plain", "Natural hill ramps", "Island lake", "Evergreen forest"],
    image: "/maps/alpine.svg",
    env: { bg: 0xb5d2dc, exposure: 1.08, fog: [0xc4d8df, 145, 430], hemiSky: 0xd4efff, hemiGround: 0x53654d, hemi: 1.45, sun: 0xfff0d2, sunIntensity: 2.2 },
  },
];

export function isSupportedMultiplayerMap(id: string) {
  return id === MAP_ID || MAPS.some((map) => map.id === id);
}

export function mapDef(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

export function randomMapId(rnd: () => number = Math.random): MapId {
  return MAPS[Math.floor(rnd() * MAPS.length)].id;
}

export function buildMap(id: string, scene: THREE.Scene, quality: MapQuality): Arena {
  let arena: Arena;
  switch (id) {
    case "city":
      arena = buildCity(scene, quality);
      break;
    case "volcano":
      arena = buildVolcano(scene, quality);
      break;
    case "jungle":
      arena = buildJungle(scene, quality);
      break;
    case "sunbeam":
      arena = buildSunbeam(scene, quality);
      break;
    case "alpine":
      arena = buildAlpine(scene, quality);
      break;
    case "neon":
    default:
      arena = buildArena(scene, quality);
  }
  // Map validation: collision continuity, reachability, spawn/zone safety,
  // lane clearance and wedge traps. Issues are logged so regressions are loud.
  const issues = auditMap({
    name: id,
    hx: arena.hx,
    hz: arena.hz,
    surfaces: arena.surfaces,
    circles: arena.circles,
    spawns: arena.spawns,
    zones: arena.pickupSpots,
    lanes: arena.lanes,
    hazards: arena.hazards,
  });
  if (issues.length) console.warn(`[map-audit] ${id}: ${issues.length} issue(s)`, issues);
  else console.info(`[map-audit] ${id}: ok`);
  return arena;
}
