import * as THREE from "three";
import type { Arena, Hazard, PickupZone } from "../arena";
import {
  GEO, Kit, blob, crackTexture, makeEmbers, makeGround, makeLava, makeSky, makeSmokeColumn, makeWalls, mulberry32,
  placeSpawns, rockRim, scatterProps, validateZones, lavaShape, type MapQuality, type Rect,
} from "./common";

/**
 * VOLCANO MAYHEM — volcanic island arena.
 * Layout: 4 large lava pools around a central volcano, two lava rivers with rock
 * bridges, ring road, elevated rocky platforms with ramps, erupting background
 * volcano, lava waterfall, embers + smoke. Lava is a real damage hazard and its
 * visual body matches the hazard volume exactly.
 */
export function buildVolcano(scene: THREE.Scene, quality: MapQuality): Arena {
  const hx = 66;
  const hz = 66;
  const rnd = mulberry32(9001);
  const aniso = quality === "low" ? 2 : 8;
  const kit = new Kit();
  scene.add(kit.root);
  const lava = makeLava();
  const lavaMat = lava.mats[0];
  const disposables: { dispose(): void }[] = [lava];
  const anim: ((t: number, dt: number) => void)[] = [];

  const crack = crackTexture("#ff6a10", "#221327");
  const M = {
    rock: kit.std(0x2e2138, { roughness: 0.9, emissive: 0x2a0d06, emissiveMap: crack, emissiveIntensity: 0.55 }),
    darkRock: kit.std(0x1c1424, { roughness: 0.95 }),
    basalt: kit.std(0x3a3348, { roughness: 0.8 }),
    rim: kit.std(0x4a2c30, { roughness: 0.85, emissive: 0x521205, emissiveIntensity: 0.6 }),
    orange: kit.basic(0xff7a1a),
    yellow: kit.basic(0xffd21f),
    barrel: kit.std(0x6b3210, { roughness: 0.5, metalness: 0.4 }),
    band: kit.std(0xffd21f),
    cone: kit.std(0xff6a1a),
    dark: kit.std(0x241a2e),
  };
  M.orange.color.multiplyScalar(1.4);

  makeSky(scene, { top: 0x12030a, mid: 0x5c1108, horizon: 0xff5a10, sunDir: [-0.4, 0.12, -0.6], sunColor: 0xff8a2a, stars: 0.25 });

  // continuous cracked-rock driving surface (full plane = no holes possible)
  makeGround(kit.root, hx, hz, (g) => {
    g.fillStyle = "#241a2e";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? "#2c1f38" : "#201627";
      g.fillRect(i * 256 + 4, j * 256 + 4, 248, 248);
    }
    g.strokeStyle = "#ff6a10";
    g.lineWidth = 3;
    g.shadowColor = "#ff5a10";
    g.shadowBlur = 8;
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      let x = rnd() * 512;
      let y = rnd() * 512;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rnd() - 0.5) * 160;
        y += (rnd() - 0.5) * 160;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, 16, aniso);

  makeWalls(kit, hx, hz, 4, M.darkRock, M.orange);

  // ---------------- lava pools (visual + hazard, exactly aligned) ----------
  const hazards: Hazard[] = [];
  const poolCenters: [number, number, number, number][] = [
    [21, 21, 9, 7.5], [-21, 21, 8, 7], [-21, -21, 8.5, 7.5], [21, -21, 9, 7],
    [0, -30, 7, 5.5], [0, 30, 7, 5.5],
  ];
  for (const [cx, cz, rx, rz] of poolCenters) {
    const pts = blob(cx, cz, rx, rz, rnd, 24, 0.16);
    const mesh = lavaShape(pts, 0.06);
    mesh.material = lavaMat;
    kit.root.add(mesh);
    // shallow rock basin lip so the pool reads as 3D
    const inner = blob(cx, cz, rx + 1.1, rz + 1.1, () => 0.5, 24, 0.02);
    rockRim(kit, inner, M.rim, () => false, 0.5);
    hazards.push({ x: cx, z: cz, r: Math.max(rx, rz) + 1.2, dps: 24 });
    const light = new THREE.PointLight(0xff5a12, 42, 34, 1.8);
    light.position.set(cx, 3.2, cz);
    kit.root.add(light);
  }

  // ---------------- lava rivers with rock bridges -------------------------
  const river: [number, number, number][] = [
    [-21, 21, 0], [-8, 24, 0], [6, 23, 0], [21, 21, 0], // north river linking pools
  ];
  const riverPts: [number, number][] = [];
  for (let i = 0; i < river.length; i++) {
    const [x, z] = river[i];
    riverPts.push([x - 2.6, z + 2.2], [x + 2.6, z - 2.2]);
  }
  const riverShape: [number, number][] = [...riverPts.slice(0, riverPts.length / 2).reverse(), ...riverPts.slice(riverPts.length / 2)];
  const riverMesh = lavaShape(riverShape, 0.055);
  riverMesh.material = lavaMat;
  kit.root.add(riverMesh);
  for (const hz of [-21, 21]) {
    hazards.push({ x: 0, z: hz + 1.5, r: 5.5, dps: 22 });
    rockRim(kit, [[-16, hz + 3.4], [16, hz + 3.4]], M.rim, (x) => Math.abs(x) < 4, 0.5);
    rockRim(kit, [[-16, hz - 1.6], [16, hz - 1.6]], M.rim, (x) => Math.abs(x) < 4, 0.5);
    // two flat rock bridges crossing the river
    for (const bx of [-11, 11]) {
      kit.mesh(GEO.box, M.basalt, bx, 0.28, hz + 1.2, 7.5, 0.56, 7.5);
      kit.mesh(GEO.box, M.rim, bx, 0.62, hz + 1.2, 7.8, 0.16, 7.8, kit.root, false);
    }
    // soft rim along the river banks
    rockRim(kit, [[-24, hz + 4.4], [24, hz + 4.4]], M.rim, () => false, 0.5);
    rockRim(kit, [[-24, hz - 4.4], [24, hz - 4.4]], M.rim, () => false, 0.5);
  }

  // ---------------- central volcano --------------------------------------
  {
    const g = new THREE.Group();
    kit.root.add(g);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(11.5, 26, 22), M.rock);
    cone.position.y = 13;
    cone.castShadow = true;
    cone.receiveShadow = true;
    g.add(cone);
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 3.4, 2, 20), lavaMat);
    crater.position.y = 25.2;
    g.add(crater);
    const glow = new THREE.PointLight(0xff6a10, 70, 90, 1.6);
    glow.position.set(0, 27, 0);
    g.add(glow);
    kit.circles.push({ x: 0, z: 0, r: 11, top: 26, kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1 });
    // lava streaks down the cone flank
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2;
      const streak = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 14), lavaMat);
      streak.position.set(Math.cos(a) * 7.2, 12, Math.sin(a) * 7.2);
      streak.lookAt(0, 12, 0);
      streak.rotateX(-0.32);
      g.add(streak);
    }
    const smoke1 = makeSmokeColumn(0, 26, 0, 16, 0x4a2028);
    g.add(smoke1.group);
    anim.push((t) => smoke1.update(t));
    disposables.push(smoke1);
  }

  // ---------------- background erupting volcano (outside the arena) ------
  {
    const g = new THREE.Group();
    g.position.set(-118, 0, -96);
    kit.root.add(g);
    const m = kit.std(0x3a1c22, { roughness: 1, emissive: 0x5a1206, emissiveIntensity: 0.45 });
    const big = new THREE.Mesh(new THREE.ConeGeometry(62, 96, 20), m);
    big.position.y = 44;
    g.add(big);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(12, 8, 6, 18), lavaMat);
    cap.position.y = 92;
    g.add(cap);
    const plume = makeSmokeColumn(0, 92, 0, 60, 0x7a2c1c);
    g.add(plume.group);
    anim.push((t) => plume.update(t));
    disposables.push(plume);
    const emberGlow = new THREE.PointLight(0xff7a22, 120, 260, 1.4);
    emberGlow.position.set(0, 96, 0);
    g.add(emberGlow);
    const emberField = makeEmbers(scene, 90, { x: -118, z: -96, rx: 60, rz: 60, top: 130 });
    anim.push((t, dt) => emberField.update(dt, t));
    disposables.push(emberField);
  }

  // ---------------- lava waterfall (west cliff) --------------------------
  {
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(10, 16), lava.newMat());
    fall.position.set(-58, 8, 26);
    fall.rotation.y = Math.PI / 2;
    kit.root.add(fall);
    const basinPts = blob(-53, 26, 7, 5.5, rnd, 20, 0.18);
    const basin = lavaShape(basinPts, 0.06);
    basin.material = lavaMat;
    kit.root.add(basin);
    hazards.push({ x: -53, z: 26, r: 7.5, dps: 22 });
    rockRim(kit, blob(-53, 26, 8.2, 6.6, () => 0.5, 20, 0.02), M.rim, () => false, 0.5);
    // cliff face behind the fall
    kit.block(-66, -58, 18, 34, 8, { base: M.darkRock, top: M.basalt, trim: M.orange });
    const light = new THREE.PointLight(0xff5a12, 40, 30, 1.8);
    light.position.set(-52, 6, 26);
    kit.root.add(light);
    const smoke = makeSmokeColumn(-53, 1, 26, 12, 0x6a2c22);
    kit.root.add(smoke.group);
    anim.push((t) => smoke.update(t));
    disposables.push(smoke);
  }

  // ---------------- elevated rock platforms + ramps ----------------------
  const plat = { base: M.darkRock, top: M.basalt, trim: M.orange };
  const rampM = { side: M.darkRock, edge: M.orange, stripe: M.basalt };
  for (const [cx, cz, rot] of [[-44, -44, 0], [44, 44, 0], [-44, 44, 1], [44, -44, 1]] as [number, number, number][]) {
    kit.block(cx - 7, cx + 7, cz - 6, cz + 6, 1.7, plat, true);
    if (rot === 0) {
      kit.ramp(cx + 7, cx + 15, cz - 6, cz + 6, 1.7, 1, rampM);
      kit.ramp(cx - 15, cx - 7, cz - 6, cz + 6, 1.7, 0, rampM);
    } else {
      kit.ramp(cx - 7, cx + 7, cz + 6, cz + 14, 1.7, 3, rampM);
      kit.ramp(cx - 7, cx + 7, cz - 14, cz - 6, 1.7, 2, rampM);
    }
    // glow strip on the platform edge
    kit.mesh(GEO.box, M.orange, cx, 1.85, cz, 14.2, 0.12, 12.2, kit.root, false);
  }

  // driving lanes (kept clear of props): 4 radial routes + ring segments
  const lanes: Rect[] = [
    { x0: -6, x1: 6, z0: -60, z1: -13 }, { x0: -6, x1: 6, z0: 13, z1: 60 },
    { x0: -60, x1: -13, z0: -6, z1: 6 }, { x0: 13, x1: 60, z0: -6, z1: 6 },
    { x0: -50, x1: -30, z0: -50, z1: -30 }, { x0: 30, x1: 50, z0: 30, z1: 50 },
    { x0: -50, x1: -30, z0: 30, z1: 50 }, { x0: 30, x1: 50, z0: -50, z1: -30 },
    { x0: -24, x1: 24, z0: -28, z1: -16 }, { x0: -24, x1: 24, z0: 16, z1: 28 },
  ];

  // basalt cliff pillars (decor, only outside driving lanes)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.35;
    const r = 56;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (lanes.some((l) => x > l.x0 - 4 && x < l.x1 + 4 && z > l.z0 - 4 && z < l.z1 + 4)) continue;
    const h = 5 + rnd() * 7;
    kit.mesh(GEO.box, M.darkRock, x, h / 2, z, 3.2, h, 3.2);
    kit.mesh(GEO.box, M.rim, x, h + 0.15, z, 3.4, 0.3, 3.4, kit.root, false);
    kit.circles.push({ x, z, r: 1.9, top: h, kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1 });
  }

  // ember fields over the lava regions
  const ember1 = makeEmbers(scene, quality === "low" ? 60 : 130, { x: 0, z: 0, rx: 34, rz: 34, top: 22 });
  anim.push((t, dt) => ember1.update(dt, t));
  disposables.push(ember1);

  // ---------------- gameplay layout: spawns, zones, props ----------------
  const spawns = placeSpawns(kit, rnd, hx, hz, 12, hazards);

  const zones: PickupZone[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.25;
    zones.push({ x: Math.cos(a) * 43, z: Math.sin(a) * 43, y: 0, kind: "weapon" });
  }
  zones.push(
    { x: -8, z: 0, y: 0, kind: "weapon" }, { x: 8, z: 0, y: 0, kind: "weapon" },
    { x: 0, z: -44, y: 0, kind: "weapon" }, { x: 0, z: 44, y: 0, kind: "weapon" },
    { x: -44, z: 0, y: 0, kind: "weapon" }, { x: 44, z: 0, y: 0, kind: "weapon" },
    { x: -44, z: -44, y: 1.7, kind: "weapon" }, { x: 44, z: 44, y: 1.7, kind: "weapon" },
    { x: 44, z: -44, y: 1.7, kind: "weapon" }, { x: -44, z: 44, y: 1.7, kind: "weapon" },
    { x: -33, z: 33, y: 0, kind: "weapon" }, { x: 33, z: -33, y: 0, kind: "weapon" },
  );
  const health: PickupZone[] = [
    { x: -52, z: -8, y: 0, kind: "health" }, { x: 52, z: 8, y: 0, kind: "health" },
    { x: -8, z: 52, y: 0, kind: "health" }, { x: 8, z: -52, y: 0, kind: "health" },
  ];

  const combat: Rect[] = [
    { x0: -34, x1: -12, z0: -34, z1: -12 }, { x0: 12, x1: 34, z0: 12, z1: 34 },
    { x0: -34, x1: -12, z0: 12, z1: 34 }, { x0: 12, x1: 34, z0: -34, z1: -12 },
    { x0: -18, x1: 18, z0: -56, z1: -40 }, { x0: -18, x1: 18, z0: 40, z1: 56 },
  ];
  const decor: Rect[] = [
    { x0: -62, x1: -44, z0: -62, z1: -44 }, { x0: 44, x1: 62, z0: 44, z1: 62 },
    { x0: -62, x1: -44, z0: 44, z1: 62 }, { x0: 44, x1: 62, z0: -62, z1: -44 },
    { x0: -64, x1: -50, z0: -14, z1: 14 }, { x0: 50, x1: 64, z0: -14, z1: 14 },
  ];

  scatterProps(kit, rnd, hx, hz, [
    { kind: "crate", cx: -23, cz: -23, n: 2, spread: 5, zone: "cover" },
    { kind: "crate", cx: 23, cz: 23, n: 2, spread: 5, zone: "cover" },
    { kind: "barrel", cx: -23, cz: 23, n: 2, spread: 5, zone: "cover" },
    { kind: "barrel", cx: 23, cz: -23, n: 2, spread: 5, zone: "cover" },
    { kind: "cone", cx: 0, cz: -48, n: 2, spread: 5, zone: "cover" },
    { kind: "cone", cx: 0, cz: 48, n: 2, spread: 5, zone: "cover" },
    { kind: "crate", cx: -53, cz: -53, n: 1, spread: 3, zone: "decor" },
    { kind: "crate", cx: 53, cz: 53, n: 1, spread: 3, zone: "decor" },
  ], spawns, [...zones, ...health], null, M, { lanes, combat, decor });

  const valid = validateZones([...zones, ...health], kit.surfaces, kit.circles, hx, hz);
  return {
    half: Math.max(hx, hz), hx, hz,
    surfaces: kit.surfaces, circles: kit.circles,
    pickupSpots: valid.map((v) => ({ ...v })),
    spawns, zones: valid, hazards,
    lanes,
    groundAt: (x, z, y) => kit.groundAt(x, z, y),
    maxHeightAt: (x, z) => kit.maxHeightAt(x, z),
    update: (t, dt) => {
      kit.update(t, dt);
      lava.update(t);
      for (const fn of anim) fn(t, dt);
      // pulsing heat glow on the lava lights
      const k = 0.85 + Math.sin(t * 1.7) * 0.15;
      for (const child of kit.root.children) {
        const l = child as THREE.PointLight;
        if (l.isPointLight) l.intensity = l.intensity * 0.98 + 42 * k * 0.02;
      }
    },
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
