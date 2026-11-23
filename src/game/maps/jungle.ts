import * as THREE from "three";
import type { Arena, PickupZone } from "../arena";
import {
  GEO, Kit, makeGround, makeSky, makeWalls, mulberry32,
  placeSpawns, scatterProps, validateZones, type MapQuality, type Rect,
} from "./common";

export function buildJungle(scene: THREE.Scene, quality: MapQuality): Arena {
  const hx = 74;
  const hz = 62;
  const rnd = mulberry32(5150);
  const aniso = quality === "low" ? 2 : 8;
  const kit = new Kit();
  scene.add(kit.root);

  const M = {
    leaf: kit.std(0x2f7a3a, { roughness: 0.9 }),
    leafDark: kit.std(0x1d4a26, { roughness: 0.9 }),
    trunk: kit.std(0x5a4128, { roughness: 0.9 }),
    rock: kit.std(0x6a6f75, { roughness: 0.85, metalness: 0.05 }),
    rust: kit.std(0x8a4a1a, { roughness: 0.7, metalness: 0.4 }),
    metal: kit.std(0x4a5a68, { roughness: 0.4, metalness: 0.7 }),
    dark: kit.std(0x1a2018, { roughness: 0.85 }),
    toxic: kit.basic(0x9dff3a),
    cyan: kit.basic(0x35e8ff),
    yellow: kit.basic(0xffd21f),
    barrel: kit.std(0x2f7a3a, { roughness: 0.5, metalness: 0.4 }),
    band: kit.std(0xffd21f),
    cone: kit.std(0xff6a1a),
  };
  M.toxic.color.multiplyScalar(1.3);

  makeSky(scene, { top: 0x062a2a, mid: 0x0f4a3a, horizon: 0xd8e06a, sunDir: [0.5, 0.18, 0.4], sunColor: 0xfff2a0, stars: 0.35 });

  // mossy ground with dirt patches and metal plates near the facility
  makeGround(kit.root, hx, hz, (g) => {
    g.fillStyle = "#2a4a22";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? "#2f5226" : "#26401e";
      g.fillRect(i * 256 + 4, j * 256 + 4, 248, 248);
    }
    for (let i = 0; i < 26; i++) {
      g.fillStyle = rnd() < 0.5 ? "#5a4a2a" : "#3a5a2a";
      g.globalAlpha = 0.5;
      g.beginPath();
      g.ellipse(rnd() * 512, rnd() * 512, 12 + rnd() * 30, 8 + rnd() * 20, rnd() * 3, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  }, 16, aniso);

  makeWalls(kit, hx, hz, 4, M.dark, M.toxic);

  const plat = { base: M.rock, top: M.metal, trim: M.toxic };
  const ruin = { base: M.dark, top: M.rust, trim: M.yellow };

  // ruined facility: broken walls (solid, low) forming 3 combat rooms
  kit.block(-34, -22, -30, -18, 2.2, ruin);
  kit.block(-34, -22, 18, 30, 2.2, ruin);
  kit.block(22, 34, -30, -18, 2.2, ruin);
  kit.block(22, 34, 18, 30, 2.2, ruin);
  // rusted container stacks (cover)
  for (const [cx, cz, rot] of [[-50, -30, 0.2], [50, 30, -0.15], [-50, 30, 0.1], [50, -30, 0]] as [number, number, number][]) {
    kit.block(cx - 3, cx + 3, cz - 1.5, cz + 1.5, 1.8, ruin);
    const g = new THREE.Group();
    g.position.set(cx, 1.8, cz);
    g.rotation.y = rot;
    kit.root.add(g);
    kit.mesh(GEO.box, M.rust, 0, 1.2, 0, 5.6, 2.4, 2.6, g);
    kit.mesh(GEO.box, M.metal, 0, 2.5, 0, 5.6, 0.2, 2.6, g);
  }

  // water ponds (visual) with bridges over them
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x1a6a8a, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.85 });
  for (const [px, pz] of [[-8, -28], [8, 28]] as [number, number][]) {
    const pond = new THREE.Mesh(new THREE.CircleGeometry(9, 28), waterMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(px, 0.04, pz);
    kit.root.add(pond);
    kit.block(px - 2.5, px + 2.5, pz - 11, pz + 11, 1.2, plat, true);
    kit.ramp(px - 2.5, px + 2.5, pz + 11, pz + 17, 1.2, 3, { side: M.rock, edge: M.toxic, stripe: M.metal });
    kit.ramp(px - 2.5, px + 2.5, pz - 17, pz - 11, 1.2, 2, { side: M.rock, edge: M.toxic, stripe: M.metal });
  }

  // watchtower platform (elevated combat spot) with two ramps
  kit.block(-6, 6, 36, 44, 2.4, plat, true);
  kit.ramp(-6, 6, 30, 36, 2.4, 2, { side: M.rock, edge: M.toxic, stripe: M.metal });
  kit.ramp(-14, -6, 36, 44, 2.4, 0, { side: M.rock, edge: M.toxic, stripe: M.metal });
  {
    const g = new THREE.Group();
    g.position.set(0, 2.4, 40);
    kit.root.add(g);
    for (const [lx, lz] of [[-4, -2], [4, -2], [-4, 2], [4, 2]] as [number, number][])
      kit.mesh(GEO.cyl, M.metal, lx, 2.5, lz, 0.3, 5, 0.3, g);
    kit.mesh(GEO.box, M.rust, 0, 5.2, 0, 9, 0.5, 5, g);
    kit.mesh(GEO.box, M.toxic, 0, 5.6, 0, 9.2, 0.15, 5.2, g, false);
    kit.pulsers.push({ mat: M.toxic, base: M.toxic.color.clone(), phase: 1 });
  }

  // rock arch tunnels over the main lanes (visual: drive under freely)
  for (const [x, z, rot] of [[-44, 0, 0], [44, 0, 0], [0, -20, 1], [0, 20, 1]] as [number, number, number][]) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot * Math.PI / 2;
    kit.root.add(g);
    kit.mesh(GEO.box, M.rock, -5, 2.5, 0, 2, 5, 3, g);
    kit.mesh(GEO.box, M.rock, 5, 2.5, 0, 2, 5, 3, g);
    kit.mesh(GEO.box, M.rock, 0, 5.6, 0, 12, 1.4, 3.2, g);
    kit.mesh(GEO.box, M.leafDark, 0, 6.5, 0, 12.4, 0.5, 3.4, g, false);
  }

  // navigation zones: lanes clear, cover in combat areas, scenery outside routes
  const lanes: Rect[] = [
    { x0: -72, x1: 72, z0: -9, z1: 9 },
    { x0: -9, x1: 9, z0: -60, z1: 60 },
    { x0: -11, x1: -5, z0: -52, z1: -18 },
    { x0: 5, x1: 11, z0: 18, z1: 52 },
    { x0: -16, x1: 16, z0: 26, z1: 46 },
    { x0: -46, x1: -22, z0: -10, z1: 10 },
    { x0: 22, x1: 46, z0: -10, z1: 10 },
  ];

  const laneBlocked = (x: number, z: number, pad: number) =>
    lanes.some((l) => x > l.x0 - pad && x < l.x1 + pad && z > l.z0 - pad && z < l.z1 + pad);

  // big trees (solid trunks) + canopy
  const treeSpots: [number, number][] = [[-20, -34], [20, 34], [-58, 16], [58, -16], [-24, 40], [24, -40], [-64, -18], [64, 18]];
  for (const [x, z] of treeSpots) {
    if (kit.maxHeightAt(x, z) > 0.3 || laneBlocked(x, z, 3)) continue;
    const h = 7 + rnd() * 3;
    kit.mesh(GEO.cyl, M.trunk, x, h / 2, z, 0.9, h, 0.9);
    const c = new THREE.Mesh(new THREE.SphereGeometry(3.4 + rnd(), 8, 6), rnd() < 0.5 ? M.leaf : M.leafDark);
    c.position.set(x, h + 1.5, z);
    c.castShadow = true;
    kit.root.add(c);
    kit.circles.push({ x, z, r: 1.1, top: h, kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1 });
  }
  // rocks
  for (let i = 0; i < 12; i++) {
    const x = (rnd() - 0.5) * (hx * 2 - 20);
    const z = (rnd() - 0.5) * (hz * 2 - 20);
    if (kit.maxHeightAt(x, z) > 0.3 || laneBlocked(x, z, 3)) continue;
    let near = false;
    for (const c of kit.circles) if (Math.hypot(c.x - x, c.z - z) < c.r + 2) near = true;
    if (near) continue;
    const r = 1 + rnd() * 1.6;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), M.rock);
    rock.position.set(x, r * 0.6, z);
    rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    kit.root.add(rock);
    kit.circles.push({ x, z, r: r * 0.9, top: r * 1.4, kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1 });
  }

  // toxic glow pools (visual, safe)
  for (const [px, pz] of [[-56, -44], [56, 44]] as [number, number][]) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(4, 20), M.toxic);
    p.rotation.x = -Math.PI / 2;
    p.position.set(px, 0.05, pz);
    kit.root.add(p);
  }

  const spawns = placeSpawns(kit, rnd, hx, hz, 12);

  const zones: PickupZone[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    zones.push({ x: Math.cos(a) * 44, z: Math.sin(a) * 36, y: 0, kind: "weapon" });
  }
  zones.push(
    { x: -28, z: 0, y: 0, kind: "weapon" }, { x: 28, z: 0, y: 0, kind: "weapon" },
    { x: 0, z: -34, y: 0, kind: "weapon" }, { x: 0, z: 34, y: 0, kind: "weapon" },
    { x: -8, z: -28, y: 1.2, kind: "weapon" }, { x: 8, z: 28, y: 1.2, kind: "weapon" },
    { x: 0, z: 40, y: 2.4, kind: "weapon" },
    { x: -50, z: 0, y: 0, kind: "weapon" }, { x: 50, z: 0, y: 0, kind: "weapon" },
    { x: -20, z: 20, y: 0, kind: "weapon" }, { x: 20, z: -20, y: 0, kind: "weapon" },
  );
  const health: PickupZone[] = [
    { x: -64, z: -52, y: 0, kind: "health" }, { x: 64, z: 52, y: 0, kind: "health" },
    { x: -64, z: 52, y: 0, kind: "health" }, { x: 64, z: -52, y: 0, kind: "health" },
  ];

  const combat: Rect[] = [
    { x0: -40, x1: -18, z0: -34, z1: -14 },
    { x0: -40, x1: -18, z0: 14, z1: 34 },
    { x0: 18, x1: 40, z0: -34, z1: -14 },
    { x0: 18, x1: 40, z0: 14, z1: 34 },
    { x0: -20, x1: 20, z0: -34, z1: -18 },
    { x0: -20, x1: 20, z0: 18, z1: 34 },
    { x0: -70, x1: -50, z0: -16, z1: 16 },
    { x0: 50, x1: 70, z0: -16, z1: 16 },
  ];
  const decor: Rect[] = [
    { x0: -72, x1: -52, z0: -58, z1: -38 },
    { x0: 52, x1: 72, z0: 38, z1: 58 },
    { x0: -72, x1: -52, z0: 38, z1: 58 },
    { x0: 52, x1: 72, z0: -58, z1: -38 },
    { x0: -30, x1: -14, z0: 42, z1: 58 },
    { x0: 14, x1: 30, z0: -58, z1: -42 },
  ];

  scatterProps(kit, rnd, hx, hz, [
    { kind: "crate", cx: -26, cz: -20, n: 1, spread: 4, zone: "cover" }, { kind: "crate", cx: 26, cz: 20, n: 1, spread: 4, zone: "cover" },
    { kind: "crate", cx: -24, cz: 26, n: 1, spread: 4, zone: "cover" }, { kind: "crate", cx: 24, cz: -26, n: 1, spread: 4, zone: "cover" },
    { kind: "barrel", cx: -60, cz: 8, n: 2, spread: 4, zone: "cover" }, { kind: "barrel", cx: 60, cz: -8, n: 2, spread: 4, zone: "cover" },
    { kind: "cone", cx: -12, cz: -26, n: 1, spread: 3, zone: "cover" }, { kind: "cone", cx: 12, cz: 26, n: 1, spread: 3, zone: "cover" },
    { kind: "cone", cx: -28, cz: 24, n: 1, spread: 3, zone: "cover" }, { kind: "cone", cx: 28, cz: -24, n: 1, spread: 3, zone: "cover" },
    { kind: "crate", cx: -62, cz: -48, n: 1, spread: 3, zone: "decor" }, { kind: "crate", cx: 62, cz: 48, n: 1, spread: 3, zone: "decor" },
  ], spawns, [...zones, ...health], null, M, { lanes, combat, decor });

  const valid = validateZones([...zones, ...health], kit.surfaces, kit.circles, hx, hz);
  return {
    half: Math.max(hx, hz), hx, hz,
    surfaces: kit.surfaces, circles: kit.circles,
    pickupSpots: valid.map((v) => ({ ...v })),
    spawns, zones: valid, lanes,
    groundAt: (x, z, y) => kit.groundAt(x, z, y),
    maxHeightAt: (x, z) => kit.maxHeightAt(x, z),
    update: (t, dt) => kit.update(t, dt),
  };
}
