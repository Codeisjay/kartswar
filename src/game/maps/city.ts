import * as THREE from "three";
import type { Arena, PickupZone } from "../arena";
import {
  GEO, Kit, canvasTex, makeGround, makeSky, makeWalls, mulberry32,
  placeSpawns, scatterProps, validateZones, type MapQuality, type Rect,
} from "./common";

export function buildCity(scene: THREE.Scene, quality: MapQuality): Arena {
  const hx = 78;
  const hz = 58;
  const rnd = mulberry32(2077);
  const aniso = quality === "low" ? 2 : 8;
  const kit = new Kit();
  scene.add(kit.root);

  const M = {
    asphalt: kit.std(0xffffff, { roughness: 0.6, metalness: 0.3 }),
    concrete: kit.std(0x2a2f45, { roughness: 0.7 }),
    dark: kit.std(0x14161f, { roughness: 0.8 }),
    steel: kit.std(0x9aa3b5, { metalness: 0.7, roughness: 0.3 }),
    cyan: kit.basic(0x35e8ff),
    pink: kit.basic(0xff3fb0),
    yellow: kit.basic(0xffd21f),
    magenta: kit.basic(0xc44dff),
    barrel: kit.std(0x1f6fd2, { roughness: 0.45, metalness: 0.4 }),
    band: kit.std(0xffd21f),
    cone: kit.std(0xff6a1a),
  };
  M.cyan.color.multiplyScalar(1.5);
  M.pink.color.multiplyScalar(1.5);

  makeSky(scene, { top: 0x030312, mid: 0x0a1030, horizon: 0x3a1a5e, sunDir: [0.3, 0.25, -0.9], sunColor: 0x8a5cff, stars: 1 });

  // asphalt with subtle tile variation
  makeGround(kit.root, hx, hz, (g) => {
    g.fillStyle = "#191924";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? "#1d1d2a" : "#17171f";
      g.fillRect(i * 256 + 4, j * 256 + 4, 248, 248);
    }
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.lineWidth = 3;
    g.strokeRect(4, 4, 504, 504);
    g.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 40; i++) g.fillRect(rnd() * 512, rnd() * 512, 3, 3);
  }, 18, aniso);

  // avenue center dashes (visual decals)
  const dashTex = canvasTex(64, 16, (g) => {
    g.clearRect(0, 0, 64, 16);
    g.fillStyle = "#ffd21f";
    g.fillRect(4, 6, 40, 4);
  }, 24, 1, aniso);
  const dashMat = new THREE.MeshBasicMaterial({ map: dashTex, transparent: true });
  for (const z of [-18, 18]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(140, 0.7), dashMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(0, 0.03, z);
    kit.root.add(d);
  }
  const d2 = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 100), dashMat);
  d2.rotation.x = -Math.PI / 2;
  d2.rotation.z = Math.PI / 2;
  d2.position.set(0, 0.03, 0);
  kit.root.add(d2);
  // central plaza ring
  const plaza = new THREE.Mesh(new THREE.RingGeometry(9, 9.7, 48), M.magenta);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.03;
  kit.root.add(plaza);

  makeWalls(kit, hx, hz, 5, M.dark, M.cyan);

  const plat = { base: M.concrete, top: M.asphalt, trim: M.cyan };
  const cov = { base: M.dark, top: M.concrete, trim: M.pink };
  const stripe = canvasTex(64, 64, (g) => {
    g.fillStyle = "#20242e";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#ffd21f";
    for (let i = 0; i < 3; i++) g.fillRect(6 + i * 20, 8, 10, 48);
  });

  // elevated highway (north) with ramps at both ends
  kit.block(-40, 40, 38, 46, 2.5, plat, true);
  kit.ramp(40, 50, 38, 46, 2.5, 1, { side: M.concrete, edge: M.yellow, stripe: new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }) });
  kit.ramp(-50, -40, 38, 46, 2.5, 0, { side: M.concrete, edge: M.yellow, stripe: new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }) });
  // south overpass (shorter, with center gap = visual arch road passes under? no: solid, ramps both sides)
  kit.block(-24, 24, -46, -40, 2.5, plat, true);
  kit.ramp(24, 32, -46, -40, 2.5, 1, { side: M.concrete, edge: M.yellow, stripe: new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }) });
  kit.ramp(-32, -24, -46, -40, 2.5, 0, { side: M.concrete, edge: M.yellow, stripe: new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }) });

  // central holo-pillar plaza (tactical cover, routes around it)
  {
    const g = new THREE.Group();
    kit.root.add(g);
    kit.mesh(GEO.cyl, M.dark, 0, 0.5, 0, 3.2, 1, 3.2, g);
    kit.mesh(GEO.cyl, M.steel, 0, 4, 0, 1.1, 8, 1.1, g);
    kit.mesh(GEO.cyl, M.yellow, 0, 8.2, 0, 1.5, 0.5, 1.5, g, false);
    for (const y of [2.4, 4.6, 6.8]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.1, 6, 24), M.magenta);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      g.add(r);
      kit.spinners.push({ obj: r, sx: 0, sy: 0 });
    }
    kit.circles.push({ x: 0, z: 0, r: 2.1, top: 8.5, kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1 });
  }

  // building podiums (solid base + visual tower above = collision matches visuals)
  const winTex = canvasTex(128, 256, (g) => {
    g.fillStyle = "#05060f";
    g.fillRect(0, 0, 128, 256);
    const cols = ["#35e8ff", "#ff3fb0", "#ffd21f", "#9dff3a"];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 8; x++) {
      if (rnd() < 0.4) {
        g.fillStyle = cols[(rnd() * cols.length) | 0];
        g.globalAlpha = 0.5 + rnd() * 0.5;
        g.fillRect(x * 16 + 3, y * 8 + 2, 10, 4);
      }
    }
  });
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x0c0f22, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.7, roughness: 0.9 });
  const podiums: [number, number, number, number][] = [
    [-58, -46, -44, -34], [44, 58, -34, -46], [-58, -44, 34, 46], [44, 58, 34, 46],
    [-14, -6, -34, -26], [6, 14, 26, 34],
  ];
  for (const [x0, x1, z0, z1] of podiums) {
    const w = x1 - x0;
    const d = z1 - z0;
    kit.block(x0, x1, z0, z1, 1.6, cov);
    const h = 14 + rnd() * 22;
    kit.mesh(GEO.box, towerMat, (x0 + x1) / 2, 1.6 + h / 2, (z0 + z1) / 2, Math.min(w - 1, 8), h, Math.min(d - 1, 8));
    kit.mesh(GEO.box, M.magenta, (x0 + x1) / 2, 1.7 + h, (z0 + z1) / 2, Math.min(w - 1, 8) + 0.4, 0.3, Math.min(d - 1, 8) + 0.4, kit.root, false);
  }

  // parking-lot side zones (open combat, low barriers)
  for (const sx of [-1, 1]) {
    const cx = sx * 62;
    kit.mesh(GEO.box, M.concrete, cx, 0.15, 0, 18, 0.3, 30, kit.root, false);
    for (let i = -2; i <= 2; i++) {
      kit.mesh(GEO.box, M.yellow, cx - 8.5, 0.32, i * 5, 0.4, 0.06, 3, kit.root, false);
      kit.mesh(GEO.box, M.yellow, cx + 8.5, 0.32, i * 5, 0.4, 0.06, 3, kit.root, false);
    }
  }

  // visual arch gates over avenues (no collision: drive under freely)
  for (const z of [-18, 18]) {
    for (const x of [-30, 30]) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      kit.root.add(g);
      kit.mesh(GEO.box, M.dark, -4.5, 3, 0, 1, 6, 1, g);
      kit.mesh(GEO.box, M.dark, 4.5, 3, 0, 1, 6, 1, g);
      kit.mesh(GEO.box, M.steel, 0, 6.4, 0, 10, 0.8, 1.2, g);
      kit.mesh(GEO.box, M.cyan, 0, 5.9, 0, 10, 0.15, 1.25, g, false);
    }
  }

  // perimeter skyline backdrop (outside walls)
  const cityCount = quality === "low" ? 30 : 56;
  const city = new THREE.InstancedMesh(GEO.box, towerMat, cityCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < cityCount; i++) {
    const side = i % 4;
    const t = rnd();
    const w = 12 + rnd() * 18;
    const h = 26 + rnd() * 70;
    if (side === 0) dummy.position.set(-hx + t * hx * 2, h / 2 - 2, -hz - 14 - rnd() * 40);
    else if (side === 1) dummy.position.set(-hx + t * hx * 2, h / 2 - 2, hz + 14 + rnd() * 40);
    else if (side === 2) dummy.position.set(-hx - 14 - rnd() * 40, h / 2 - 2, -hz + t * hz * 2);
    else dummy.position.set(hx + 14 + rnd() * 40, h / 2 - 2, -hz + t * hz * 2);
    dummy.scale.set(w, h, w);
    dummy.rotation.y = rnd() * Math.PI;
    dummy.updateMatrix();
    city.setMatrixAt(i, dummy.matrix);
  }
  kit.root.add(city);

  const spawns = placeSpawns(kit, rnd, hx, hz, 12);

  const zones: PickupZone[] = [];
  for (let i = 0; i < 10; i++) {
    const a = ((i + 0.5) / 10) * Math.PI * 2;
    zones.push({ x: Math.cos(a) * 30, z: Math.sin(a) * 26, y: 0, kind: "weapon" });
  }
  zones.push(
    { x: -62, z: 0, y: 0, kind: "weapon" }, { x: 62, z: 0, y: 0, kind: "weapon" },
    { x: -45, z: -18, y: 0, kind: "weapon" }, { x: 45, z: 18, y: 0, kind: "weapon" },
    { x: 0, z: -18, y: 0, kind: "weapon" }, { x: 0, z: 18, y: 0, kind: "weapon" },
    { x: -20, z: 42, y: 2.5, kind: "weapon" }, { x: 20, z: 42, y: 2.5, kind: "weapon" },
    { x: 0, z: -43, y: 2.5, kind: "weapon" }, { x: -10, z: 12, y: 0, kind: "weapon" },
    { x: 10, z: -12, y: 0, kind: "weapon" }, { x: -55, z: 20, y: 0, kind: "weapon" },
    { x: 55, z: -20, y: 0, kind: "weapon" }, { x: 30, z: -30, y: 0, kind: "weapon" },
  );
  const health: PickupZone[] = [
    { x: -70, z: -50, y: 0, kind: "health" }, { x: 70, z: 50, y: 0, kind: "health" },
    { x: -70, z: 50, y: 0, kind: "health" }, { x: 70, z: -50, y: 0, kind: "health" },
  ];

  // navigation zones: driving lanes stay clear, cover lives in combat zones,
  // scenery stays in decorative zones
  const lanes: Rect[] = [
    { x0: -74, x1: 74, z0: -24, z1: -12 },
    { x0: -74, x1: 74, z0: 12, z1: 24 },
    { x0: -8, x1: -3, z0: -54, z1: 54 },
    { x0: 3, x1: 8, z0: -54, z1: 54 },
    { x0: -50, x1: -28, z0: -6, z1: 6 },
    { x0: 28, x1: 50, z0: -6, z1: 6 },
    { x0: -26, x1: -12, z0: -36, z1: -14 },
    { x0: 12, x1: 26, z0: 14, z1: 36 },
  ];
  const combat: Rect[] = [
    { x0: -48, x1: -26, z0: -12, z1: 12 },
    { x0: 26, x1: 48, z0: -12, z1: 12 },
    { x0: -20, x1: 20, z0: -38, z1: -26 },
    { x0: -20, x1: 20, z0: 26, z1: 38 },
    { x0: -74, x1: -52, z0: -32, z1: 32 },
    { x0: 52, x1: 74, z0: -32, z1: 32 },
  ];
  const decor: Rect[] = [
    { x0: -76, x1: -56, z0: -56, z1: -38 },
    { x0: 56, x1: 76, z0: 38, z1: 56 },
    { x0: -76, x1: -56, z0: 38, z1: 56 },
    { x0: 56, x1: 76, z0: -56, z1: -38 },
  ];

  // streetlights along the avenues (visual, outside driving lanes)
  for (const z of [-27, 27]) {
    for (const x of [-60, -36, -12, 12, 36, 60]) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      kit.root.add(g);
      kit.mesh(GEO.cyl, M.dark, 0, 3, 0, 0.16, 6, 0.16, g, false);
      kit.mesh(GEO.box, M.yellow, 0, 6.2, z > 0 ? -0.6 : 0.6, 1.6, 0.12, 0.5, g, false);
    }
  }

  scatterProps(kit, rnd, hx, hz, [
    { kind: "crate", cx: -62, cz: -12, n: 2, spread: 5, zone: "cover" }, { kind: "crate", cx: 62, cz: 12, n: 2, spread: 5, zone: "cover" },
    { kind: "crate", cx: -36, cz: 22, n: 1, spread: 4, zone: "cover" }, { kind: "crate", cx: 36, cz: -22, n: 1, spread: 4, zone: "cover" },
    { kind: "barrel", cx: -36, cz: -8, n: 2, spread: 4, zone: "cover" }, { kind: "barrel", cx: 36, cz: 8, n: 2, spread: 4, zone: "cover" },
    { kind: "barrel", cx: 0, cz: 32, n: 1, spread: 4, zone: "cover" }, { kind: "barrel", cx: 0, cz: -32, n: 1, spread: 4, zone: "cover" },
    { kind: "cone", cx: -62, cz: -24, n: 2, spread: 4, zone: "cover" }, { kind: "cone", cx: 62, cz: 24, n: 2, spread: 4, zone: "cover" },
    { kind: "cone", cx: -14, cz: -32, n: 1, spread: 3, zone: "cover" }, { kind: "cone", cx: 14, cz: 32, n: 1, spread: 3, zone: "cover" },
    { kind: "crate", cx: -66, cz: -48, n: 1, spread: 3, zone: "decor" }, { kind: "crate", cx: 66, cz: 48, n: 1, spread: 3, zone: "decor" },
  ], spawns, [...zones, ...health], null, M, { lanes, combat, decor });

  const valid = validateZones([...zones, ...health], kit.surfaces, kit.circles, hx, hz);
  const groundAt = (x: number, z: number, y: number) => kit.groundAt(x, z, y);
  const maxHeightAt = (x: number, z: number) => kit.maxHeightAt(x, z);
  return {
    half: Math.max(hx, hz), hx, hz,
    surfaces: kit.surfaces, circles: kit.circles,
    pickupSpots: valid.map((v) => ({ ...v })),
    spawns, zones: valid, lanes,
    groundAt, maxHeightAt,
    update: (t, dt) => kit.update(t, dt),
  };
}
