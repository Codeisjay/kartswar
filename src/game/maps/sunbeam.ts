import * as THREE from "three";
import type { Arena, PickupZone } from "../arena";
import {
  GEO, Kit, makeGround, makeSky, makeWalls, mulberry32,
  placeSpawns, validateZones, type MapQuality, type Rect,
} from "./common";

export function buildSunbeam(scene: THREE.Scene, quality: MapQuality): Arena {
  const hx = 64;
  const hz = 58;
  const rnd = mulberry32(7319);
  const kit = new Kit();
  scene.add(kit.root);

  const M = {
    wall: kit.std(0x238b9b, { roughness: 0.72 }),
    deck: kit.std(0xe4a45e, { roughness: 0.82 }),
    deckTop: kit.std(0xffdf9a, { roughness: 0.74 }),
    coral: kit.basic(0xff6f75),
    aqua: kit.basic(0x3bd6d0),
    navy: kit.std(0x27617a, { roughness: 0.76 }),
    palm: kit.std(0x43894b, { roughness: 0.9 }),
    trunk: kit.std(0x9b6944, { roughness: 0.9 }),
    yellow: kit.basic(0xffd75e),
  };

  makeSky(scene, {
    top: 0x60bfea,
    mid: 0x9ce3f4,
    horizon: 0xffe6af,
    sunDir: [0.35, 0.28, 0.55],
    sunColor: 0xfff0c2,
    stars: 0,
  });

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshBasicMaterial({ color: 0x54bfd0 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.3;
  scene.add(ocean);

  makeGround(kit.root, hx, hz, (g) => {
    g.fillStyle = "#f3d996";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 180; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(255,244,198,0.65)" : "rgba(206,161,96,0.28)";
      g.beginPath();
      g.ellipse(rnd() * 512, rnd() * 512, 2 + rnd() * 9, 1 + rnd() * 5, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.lineWidth = 3;
    g.strokeRect(4, 4, 504, 504);
  }, 18, quality === "low" ? 2 : 8);

  makeWalls(kit, hx, hz, 4.5, M.wall, M.aqua);

  const deck = { base: M.navy, top: M.deckTop, trim: M.coral };
  const ramp = { side: M.navy, edge: M.coral, stripe: M.yellow };

  // A raised central pier is accessible from every side without forcing tight turns.
  kit.block(-12, 12, -9, 9, 2.4, deck, true);
  kit.ramp(12, 22, -4, 4, 2.4, 1, ramp);
  kit.ramp(-22, -12, -4, 4, 2.4, 0, ramp);
  kit.ramp(-4, 4, 9, 19, 2.4, 3, ramp);
  kit.ramp(-4, 4, -19, -9, 2.4, 2, ramp);

  // Colorful pier markers and low cabanas give the open beach distinct landmarks.
  for (const [x, z, color] of [
    [-34, -26, M.coral], [34, -26, M.aqua], [-34, 26, M.yellow], [34, 26, M.coral],
  ] as [number, number, THREE.Material][]) {
    kit.mesh(GEO.box, M.deck, x, 0.8, z, 7, 1.6, 5);
    kit.mesh(GEO.box, color, x, 1.7, z, 7.4, 0.25, 5.4, kit.root, false);
    kit.mesh(GEO.box, M.deckTop, x, 2.2, z, 7.4, 0.18, 5.4, kit.root, false);
    kit.circles.push({ x, z, r: 3.8, top: 2.4, kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1 });
  }

  const palmSpots: [number, number][] = [[-52, -42], [52, -42], [-52, 42], [52, 42]];
  for (const [x, z] of palmSpots) {
    const height = 7 + rnd() * 1.5;
    kit.mesh(GEO.cyl, M.trunk, x, height / 2, z, 0.55, height, 0.55);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), M.palm);
    crown.position.set(x, height + 1, z);
    crown.castShadow = true;
    kit.root.add(crown);
    kit.circles.push({ x, z, r: 0.8, top: height, kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1 });
  }

  // Simple colorful gates frame the main cross-arena routes.
  for (const z of [-27, 27]) {
    const gate = new THREE.Group();
    gate.position.set(0, 0, z);
    kit.root.add(gate);
    kit.mesh(GEO.box, M.wall, -7, 2.2, 0, 0.7, 4.4, 0.7, gate);
    kit.mesh(GEO.box, M.wall, 7, 2.2, 0, 0.7, 4.4, 0.7, gate);
    kit.mesh(GEO.box, M.coral, 0, 4.5, 0, 14.7, 0.45, 0.9, gate, false);
    kit.mesh(GEO.box, M.yellow, 0, 4.1, 0, 14.2, 0.12, 1, gate, false);
  }

  const lanes: Rect[] = [
    { x0: -58, x1: 58, z0: -5, z1: 5 },
    { x0: -5, x1: 5, z0: -52, z1: 52 },
    { x0: -22, x1: 22, z0: -7, z1: 7 },
    { x0: -7, x1: 7, z0: -19, z1: 19 },
  ];
  const spawns = placeSpawns(kit, rnd, hx, hz, 12);

  const zones: PickupZone[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = ((i + 0.5) / 8) * Math.PI * 2;
    zones.push({ x: Math.cos(angle) * 38, z: Math.sin(angle) * 34, y: 0, kind: "weapon" });
  }
  zones.push(
    { x: -28, z: 0, y: 0, kind: "weapon" },
    { x: 28, z: 0, y: 0, kind: "weapon" },
    { x: 0, z: -25, y: 0, kind: "weapon" },
    { x: 0, z: 25, y: 0, kind: "weapon" },
  );
  const health: PickupZone[] = [
    { x: -58, z: -50, y: 0, kind: "health" },
    { x: 58, z: 50, y: 0, kind: "health" },
    { x: -58, z: 50, y: 0, kind: "health" },
    { x: 58, z: -50, y: 0, kind: "health" },
  ];
  const valid = validateZones([...zones, ...health], kit.surfaces, kit.circles, hx, hz);

  return {
    half: Math.max(hx, hz),
    hx,
    hz,
    surfaces: kit.surfaces,
    circles: kit.circles,
    pickupSpots: valid.map((zone) => ({ ...zone })),
    spawns,
    zones: valid,
    lanes,
    groundAt: (x, z, y) => kit.groundAt(x, z, y),
    maxHeightAt: (x, z) => kit.maxHeightAt(x, z),
    update: (time, dt) => kit.update(time, dt),
  };
}
