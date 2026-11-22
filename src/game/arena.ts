import * as THREE from "three";
import { getSpawnPoints } from "./spawns";

export interface Surface {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: number;
  /** -1 flat, 0 rises toward +x, 1 toward -x, 2 toward +z, 3 toward -z */
  dir: number;
  /** designed drivable platform (reachability is validated by the map audit) */
  nav?: boolean;
}

export type CircleKind = "static" | "crate" | "barrel" | "cone";
export interface Circle {
  x: number;
  z: number;
  r: number;
  top: number;
  kind: CircleKind;
  alive: boolean;
  mesh: THREE.Object3D | null;
  respawnAt: number;
  pop: number;
  lastHit: number;
  hp: number;
}

export interface PickupSpot {
  x: number;
  z: number;
  y: number;
  kind: "weapon" | "health";
}
export interface SpawnPoint {
  x: number;
  z: number;
  heading: number;
}

/** A candidate weapon/health spawn location. Engine picks a random subset each match. */
export interface PickupZone {
  x: number;
  z: number;
  y: number;
  kind: "weapon" | "health";
}
/** Environmental danger area (e.g. lava). Karts inside take damage per second. */
export interface Hazard {
  x: number;
  z: number;
  r: number;
  dps: number;
}
export interface Arena {
  half: number;
  /** Half-extents of the playable rectangle (defaults to half x half). */
  hx: number;
  hz: number;
  surfaces: Surface[];
  circles: Circle[];
  pickupSpots: PickupSpot[];
  spawns: SpawnPoint[];
  /** Optional candidate pickup zones for the randomized pickup system. */
  zones?: PickupZone[];
  /** Optional environmental hazards (damage areas). */
  hazards?: Hazard[];
  /** Declared driving lanes (kept clear of obstacles, used by map audit). */
  lanes?: { x0: number; x1: number; z0: number; z1: number }[];
  /** Optional cleanup for map-owned dynamic resources. */
  dispose?(): void;
  groundAt(x: number, z: number, yRef: number): number;
  maxHeightAt(x: number, z: number): number;
  update(t: number, dt: number): void;
}

export function surfaceHeight(s: Surface, x: number, z: number): number {
  if (s.dir < 0) return s.h;
  let t: number;
  switch (s.dir) {
    case 0: t = (x - s.x0) / (s.x1 - s.x0); break;
    case 1: t = (s.x1 - x) / (s.x1 - s.x0); break;
    case 2: t = (z - s.z0) / (s.z1 - s.z0); break;
    default: t = (s.z1 - z) / (s.z1 - s.z0);
  }
  return s.h * Math.min(1, Math.max(0, t));
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeatX = 1, repeatY = 1, aniso = 4) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = aniso;
  return t;
}

export function buildArena(scene: THREE.Scene, quality: "low" | "medium" | "high"): Arena {
  const half = 70;
  const rnd = mulberry32(1337);
  const surfaces: Surface[] = [];
  const circles: Circle[] = [];
  const spinners: { obj: THREE.Object3D; sx: number; sy: number }[] = [];
  const pulsers: { mat: THREE.MeshBasicMaterial; base: THREE.Color; phase: number }[] = [];
  const root = new THREE.Group();
  scene.add(root);
  const aniso = quality === "low" ? 2 : 8;

  const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, flatShading: true, ...o });
  const basic = (color: number) => new THREE.MeshBasicMaterial({ color });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 16);

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, parent: THREE.Object3D = root, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const M = {
    dark: std(0x1a1d2b, { roughness: 0.8 }),
    navy: std(0x1d2a73),
    blue: std(0x2f4bff, { roughness: 0.4 }),
    white: std(0xe8ecf5, { roughness: 0.5 }),
    orange: std(0xff6a1a),
    gold: std(0xf0b429, { metalness: 0.7, roughness: 0.3 }),
    cyan: basic(0x35e8ff),
    pink: basic(0xff3fb0),
    yellow: basic(0xffd21f),
    steel: std(0x9aa3b5, { metalness: 0.7, roughness: 0.3 }),
  };
  M.cyan.color.multiplyScalar(1.5);
  M.pink.color.multiplyScalar(1.5);
  M.yellow.color.multiplyScalar(1.3);
  pulsers.push({ mat: M.cyan, base: M.cyan.color.clone(), phase: 0 }, { mat: M.pink, base: M.pink.color.clone(), phase: 1.5 });

  // ---------- ground ----------
  const floorTex = canvasTex(512, 512, (g) => {
    g.fillStyle = "#1c1f2e";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? "#252a3d" : "#20243a";
        g.fillRect(i * 256 + 5, j * 256 + 5, 246, 246);
        g.strokeStyle = "rgba(255,255,255,0.05)";
        g.lineWidth = 2;
        for (let k = -256; k < 256; k += 16) {
          g.beginPath();
          g.moveTo(i * 256 + 8 + k, j * 256 + 248);
          g.lineTo(i * 256 + 8 + k + 240, j * 256 + 8);
          g.stroke();
        }
      }
    }
    g.strokeStyle = "rgba(53,232,255,0.55)";
    g.lineWidth = 3;
    g.strokeRect(2, 2, 508, 508);
    g.beginPath();
    g.moveTo(256, 0);
    g.lineTo(256, 512);
    g.moveTo(0, 256);
    g.lineTo(512, 256);
    g.strokeStyle = "rgba(255,63,176,0.25)";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#ffd21f";
    for (let i = 0; i < 6; i++) g.fillRect(24 + i * 14, 24, 7, 7);
  }, half * 2 / 16, half * 2 / 16, aniso);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 8, half * 2 + 8), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // floor decals: center ring & lane markers
  const ringDecal = new THREE.Mesh(new THREE.RingGeometry(26, 27, 64), M.cyan);
  ringDecal.rotation.x = -Math.PI / 2;
  ringDecal.position.y = 0.03;
  root.add(ringDecal);
  const ringDecal2 = new THREE.Mesh(new THREE.RingGeometry(50, 50.6, 64), M.pink);
  ringDecal2.rotation.x = -Math.PI / 2;
  ringDecal2.position.y = 0.03;
  root.add(ringDecal2);
  const hazard = canvasTex(64, 64, (g) => {
    g.fillStyle = "#ffd21f";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#14151c";
    for (let i = -2; i < 6; i++) {
      g.beginPath();
      g.moveTo(i * 16, 0);
      g.lineTo(i * 16 + 8, 0);
      g.lineTo(i * 16 + 8 + 64, 64);
      g.lineTo(i * 16 + 64, 64);
      g.fill();
    }
  }, 12, 1, aniso);
  const hazardMat = new THREE.MeshBasicMaterial({ map: hazard });
  for (const sgn of [-1, 1]) {
    mesh(box, hazardMat, 0, 0.03, sgn * 64, 60, 0.05, 1.2, root, false);
    mesh(box, hazardMat, sgn * 64, 0.03, 0, 1.2, 0.05, 60, root, false);
  }

  // ---------- walls ----------
  const wallTex = canvasTex(256, 128, (g) => {
    g.fillStyle = "#1b2766";
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = "#24348f";
      g.fillRect(i * 64 + 4, 10, 56, 84);
      g.fillStyle = "#0e1233";
      for (let k = 0; k < 6; k++) g.fillRect(i * 64 + 10, 18 + k * 12, 44, 6);
    }
    g.fillStyle = "#ffd21f";
    g.fillRect(0, 108, 256, 6);
    g.fillStyle = "#0b0d22";
    g.fillRect(0, 114, 256, 14);
  }, 1, 1, aniso);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6, metalness: 0.3 });
  const wallLen = half * 2 + 8;
  const wallH = 7;
  const walls: [number, number, number, number][] = [
    [0, half + 2, wallLen, 0], [0, -half - 2, wallLen, 0], [half + 2, 0, wallLen, Math.PI / 2], [-half - 2, 0, wallLen, Math.PI / 2],
  ];
  for (const [x, z, len, rot] of walls) {
    const mat = wallMat.clone();
    mat.map = wallTex.clone();
    mat.map.repeat.set(len / 16, 1);
    mat.map.needsUpdate = true;
    const w = mesh(box, mat, x, wallH / 2, z, len, wallH, 4);
    w.rotation.y = rot;
    const alongX = z !== 0;
    const sgn = alongX ? Math.sign(z) : Math.sign(x);
    const strip = (y: number, m: THREE.Material, th: number) => {
      if (alongX) mesh(box, m, 0, y, sgn * (half - 0.08), len - 8, th, 0.15, root, false);
      else mesh(box, m, sgn * (half - 0.08), y, 0, 0.15, th, len - 8, root, false);
    };
    strip(5.9, M.cyan, 0.3);
    strip(1.2, M.pink, 0.2);
  }
  // corner towers
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * (half + 1), 0, sz * (half + 1));
      root.add(g);
      mesh(cyl, M.white, 0, 6, 0, 3, 12, 3, g);
      mesh(cyl, M.navy, 0, 12.4, 0, 3.4, 1, 3.4, g);
      for (const y of [3, 7, 10]) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.14, 6, 24), M.cyan);
        r.rotation.x = Math.PI / 2;
        r.position.y = y;
        g.add(r);
        spinners.push({ obj: r, sx: 0, sy: 0 });
      }
      mesh(new THREE.SphereGeometry(1.2, 12, 10), M.yellow, 0, 13.6, 0, 1, 1, 1, g, false);
    }
  }

  // ---------- sky + city ----------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: `varying vec3 vP;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
      void main(){
        float h = clamp(vP.y, 0.0, 1.0);
        vec3 c = mix(vec3(1.0,0.32,0.62), vec3(0.28,0.07,0.5), smoothstep(0.0,0.22,h));
        c = mix(c, vec3(0.02,0.03,0.12), smoothstep(0.18,0.75,h));
        vec3 sd = normalize(vec3(0.35,0.16,-0.9));
        float s = smoothstep(0.988,0.992, dot(vP,sd));
        c += vec3(1.0,0.8,0.45)*s;
        c += vec3(1.0,0.5,0.3)*pow(max(dot(vP,sd),0.0),24.0)*0.5;
        vec3 q = floor(vP*160.0);
        float st = step(0.9985, hash(q)) * smoothstep(0.25,0.6,h);
        c += vec3(st);
        gl_FragColor = vec4(c,1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  const winTex = canvasTex(128, 256, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, 128, 256);
    const cols = ["#35e8ff", "#ff3fb0", "#ffd21f", "#9dff3a", "#b64dff"];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 8; x++) {
        if (rnd() < 0.45) {
          g.fillStyle = cols[(rnd() * cols.length) | 0];
          g.globalAlpha = 0.5 + rnd() * 0.5;
          g.fillRect(x * 16 + 3, y * 8 + 2, 10, 4);
        }
      }
    }
  });
  const cityCount = quality === "low" ? 40 : 80;
  const cityMat = new THREE.MeshStandardMaterial({ color: 0x0c0f22, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.5, roughness: 0.9 });
  const city = new THREE.InstancedMesh(box, cityMat, cityCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < cityCount; i++) {
    const a = (i / cityCount) * Math.PI * 2 + rnd() * 0.05;
    const r = 105 + rnd() * 70;
    const w = 14 + rnd() * 22;
    const h = 30 + rnd() * 90;
    dummy.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    dummy.scale.set(w, h, w);
    dummy.rotation.y = rnd() * Math.PI;
    dummy.updateMatrix();
    city.setMatrixAt(i, dummy.matrix);
  }
  root.add(city);

  // ---------- helpers for platforms ----------
  const addSurface = (s: Surface) => surfaces.push(s);

  const trim = (g: THREE.Object3D, x0: number, x1: number, z0: number, z1: number, y: number, mat: THREE.Material) => {
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    mesh(box, mat, cx, y, z0, w, 0.12, 0.14, g, false);
    mesh(box, mat, cx, y, z1, w, 0.12, 0.14, g, false);
    mesh(box, mat, x0, y, cz, 0.14, 0.12, d, g, false);
    mesh(box, mat, x1, y, cz, 0.14, 0.12, d, g, false);
  };

  const block = (x0: number, x1: number, z0: number, z1: number, h: number, style: "platform" | "bench" | "cover") => {
    addSurface({ x0, x1, z0, z1, h, dir: -1, nav: style === "platform" });
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (style === "bench") {
      mesh(box, M.dark, cx, h * 0.17, cz, w, h * 0.34, d);
      mesh(box, M.white, cx, h * 0.54, cz, w + 0.05, h * 0.4, d + 0.05);
      mesh(box, M.blue, cx, h * 0.9, cz, w + 0.3, h * 0.2, d + 0.3);
    } else if (style === "cover") {
      mesh(box, M.navy, cx, h / 2, cz, w, h, d);
      mesh(box, M.orange, cx, h - 0.1, cz, w + 0.2, 0.25, d + 0.2);
      trim(root, x0, x1, z0, z1, h * 0.45, M.cyan);
    } else {
      mesh(box, M.dark, cx, h / 2 - 0.1, cz, w, h - 0.2, d);
      mesh(box, M.navy, cx, h - 0.1, cz, w, 0.2, d);
      trim(root, x0 + 0.1, x1 - 0.1, z0 + 0.1, z1 - 0.1, h + 0.02, M.cyan);
      trim(root, x0 - 0.02, x1 + 0.02, z0 - 0.02, z1 + 0.02, h * 0.5, M.pink);
    }
  };

  const chevron = canvasTex(128, 64, (g) => {
    g.fillStyle = "#14171f";
    g.fillRect(0, 0, 128, 64);
    g.strokeStyle = "#ffd21f";
    g.lineWidth = 9;
    g.lineJoin = "miter";
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      g.moveTo(14 + i * 64, 8);
      g.lineTo(46 + i * 64, 32);
      g.lineTo(14 + i * 64, 56);
      g.stroke();
    }
  }, 1, 1, aniso);
  const chevMat = new THREE.MeshStandardMaterial({ map: chevron, roughness: 0.5, metalness: 0.2, emissive: 0x332200, emissiveMap: chevron, emissiveIntensity: 0.9 });
  const wedgeCache = new Map<string, THREE.BufferGeometry>();
  const ramp = (x0: number, x1: number, z0: number, z1: number, h: number, dir: number, color = 0x252a45) => {
    addSurface({ x0, x1, z0, z1, h, dir });
    const alongX = dir < 2;
    const len = alongX ? x1 - x0 : z1 - z0;
    const wid = alongX ? z1 - z0 : x1 - x0;
    const key = `${len}_${h}_${wid}`;
    let geo = wedgeCache.get(key);
    if (!geo) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(len, 0);
      shape.lineTo(len, h);
      shape.closePath();
      geo = new THREE.ExtrudeGeometry(shape, { depth: wid, bevelEnabled: false });
      geo.translate(-len / 2, 0, -wid / 2);
      wedgeCache.set(key, geo);
    }
    const g = new THREE.Group();
    g.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    g.rotation.y = [0, Math.PI, -Math.PI / 2, Math.PI / 2][dir];
    root.add(g);
    mesh(geo, std(color, { roughness: 0.7 }), 0, 0, 0, 1, 1, 1, g);
    const tilt = new THREE.Group();
    tilt.position.set(0, h / 2 + 0.03, 0);
    tilt.rotation.z = Math.atan2(h, len);
    g.add(tilt);
    const slopeLen = Math.hypot(len, h);
    const cm = chevMat.clone();
    cm.map = chevron.clone();
    cm.emissiveMap = cm.map;
    cm.map.repeat.set(slopeLen / 6, 1);
    cm.map.needsUpdate = true;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(slopeLen, wid - 0.6), cm);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    tilt.add(plane);
    for (const sgn of [-1, 1]) {
      mesh(box, M.orange, 0, 0.12, sgn * (wid / 2 - 0.15), slopeLen, 0.3, 0.3, tilt);
    }
  };

  // ---------- layout ----------
  // central platform with 4 ramps + tower
  block(-12, 12, -12, 12, 2.5, "platform");
  ramp(12, 22, -5, 5, 2.5, 1);
  ramp(-22, -12, -5, 5, 2.5, 0);
  ramp(-5, 5, 12, 22, 2.5, 3);
  ramp(-5, 5, -22, -12, 2.5, 2);
  // tower
  {
    const g = new THREE.Group();
    g.position.set(0, 2.5, 0);
    root.add(g);
    mesh(cyl, M.dark, 0, 0.6, 0, 3.6, 1.2, 3.6, g);
    mesh(cyl, M.white, 0, 6, 0, 2.4, 12, 2.4, g);
    mesh(cyl, M.blue, 0, 12.4, 0, 3.4, 1.2, 3.4, g);
    mesh(cyl, M.cyan, 0, 14, 0, 1.4, 2.4, 1.4, g, false);
    for (const y of [3, 6.5, 10]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.16, 6, 28), M.cyan);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      g.add(r);
      spinners.push({ obj: r, sx: 0, sy: 0 });
    }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.2, 8, 32), M.pink);
    halo.position.y = 15.5;
    halo.rotation.x = Math.PI / 2.4;
    g.add(halo);
    spinners.push({ obj: halo, sx: 0.4, sy: 0.9 });
    const light = new THREE.PointLight(0x35e8ff, 25, 45, 1.5);
    light.position.set(0, 8, 0);
    g.add(light);
    circles.push({ x: 0, z: 0, r: 2.3, top: 18, kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1 });
  }

  // pinwheel jump ramps
  ramp(36, 48, 37.5, 46.5, 3.6, 1);
  ramp(-46.5, -37.5, 36, 48, 3.6, 3);
  ramp(-48, -36, -46.5, -37.5, 3.6, 0);
  ramp(37.5, 46.5, -48, -36, 3.6, 2);

  // highways (raised side lanes)
  for (const sgn of [-1, 1]) {
    const z0 = sgn > 0 ? 47 : -53;
    const z1 = sgn > 0 ? 53 : -47;
    block(-14, 14, z0, z1, 2, "platform");
    ramp(14, 24, z0, z1, 2, 1);
    ramp(-24, -14, z0, z1, 2, 0);
  }

  // benches
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      block(sx * 26 - 1.5, sx * 26 + 1.5, sz * 20 - 5, sz * 20 + 5, 2.2, "bench");
    }
  }
  // (center benches removed to keep the north/south drive lines open)
  // cover blocks (halved: only the outer set, so lanes stay open)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      block(sx * 58 - 2, sx * 58 + 2, sz * 22 - 2, sz * 22 + 2, 1.8, "cover");
    }
  }

  // pillars
  const pillarSpots: [number, number][] = [[34, 10], [34, -10], [-34, 10], [-34, -10], [12, 38], [-12, 38], [12, -38], [-12, -38]];
  for (const [x, z] of pillarSpots) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    root.add(g);
    mesh(cyl, M.dark, 0, 0.4, 0, 1.9, 0.8, 1.9, g);
    mesh(cyl, M.steel, 0, 4.5, 0, 1.0, 9, 1.0, g);
    mesh(cyl, M.yellow, 0, 9.1, 0, 1.25, 0.5, 1.25, g, false);
    for (const y of [2.2, 4.8, 7.2]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 6, 20), M.cyan);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      g.add(r);
      spinners.push({ obj: r, sx: 0, sy: 0 });
    }
    circles.push({ x, z, r: 1.15, top: 9.4, kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1 });
  }

  // ---------- spawns & pickups ----------
  const spawns = getSpawnPoints();
  const pickupSpots: PickupSpot[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    pickupSpots.push({ x: Math.cos(a) * 30, z: Math.sin(a) * 30, y: 0, kind: "weapon" });
  }
  for (const x of [-7, 7]) for (const z of [-50, 50]) pickupSpots.push({ x, z, y: 2, kind: "weapon" });
  for (const x of [-8, 8]) for (const z of [-8, 8]) pickupSpots.push({ x, z, y: 2.5, kind: "weapon" });
  pickupSpots.push({ x: 50, z: 0, y: 0, kind: "health" }, { x: -50, z: 0, y: 0, kind: "health" }, { x: 0, z: 40, y: 0, kind: "health" }, { x: 0, z: -40, y: 0, kind: "health" });

  // ---------- destructibles & props ----------
  // driving lanes kept clear of obstacles (approach roads + corner routes)
  const lanes = [
    { x0: -7, x1: 7, z0: 24, z1: 66 },
    { x0: -7, x1: 7, z0: -66, z1: -24 },
    { x0: 24, x1: 66, z0: -7, z1: 7 },
    { x0: -66, x1: -24, z0: -7, z1: 7 },
    { x0: -58, x1: -32, z0: -58, z1: -32 },
    { x0: 32, x1: 58, z0: 32, z1: 58 },
    { x0: -58, x1: -32, z0: 32, z1: 58 },
    { x0: 32, x1: 58, z0: -58, z1: -32 },
  ];
  const free = (x: number, z: number, margin: number) => {
    if (Math.abs(x) > half - 4 || Math.abs(z) > half - 4) return false;
    for (const l of lanes) {
      if (x > l.x0 - margin - 1.2 && x < l.x1 + margin + 1.2 && z > l.z0 - margin - 1.2 && z < l.z1 + margin + 1.2) return false;
    }
    for (const s of surfaces) if (x > s.x0 - margin - 1 && x < s.x1 + margin + 1 && z > s.z0 - margin - 1 && z < s.z1 + margin + 1) return false;
    for (const c of circles) if (Math.hypot(c.x - x, c.z - z) < c.r + margin + 2.6) return false;
    for (const p of spawns) if (Math.hypot(p.x - x, p.z - z) < 8.5) return false;
    for (const p of pickupSpots) if (Math.hypot(p.x - x, p.z - z) < 5) return false;
    return true;
  };

  const crateTex = canvasTex(128, 128, (g) => {
    g.fillStyle = "#b07a3c";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#c88d4a";
    for (let i = 0; i < 4; i++) g.fillRect(8, 8 + i * 28, 112, 24);
    g.strokeStyle = "#6b4520";
    g.lineWidth = 6;
    g.strokeRect(3, 3, 122, 122);
    g.beginPath();
    g.moveTo(8, 8);
    g.lineTo(120, 120);
    g.moveTo(120, 8);
    g.lineTo(8, 120);
    g.stroke();
    g.fillStyle = "#555b66";
    for (const [x, y] of [[8, 8], [120, 8], [8, 120], [120, 120]]) g.fillRect(x - 8, y - 8, 16, 16);
  }, 1, 1, aniso);
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.8, flatShading: true });
  const crateGeo = new THREE.BoxGeometry(2, 2, 2);
  const barrelBody = new THREE.CylinderGeometry(0.8, 0.8, 1.8, 14);
  const barrelMat = std(0xd2222d, { roughness: 0.45, metalness: 0.4 });
  const bandMat = std(0xffd21f);
  const coneGeo = new THREE.ConeGeometry(0.5, 1.1, 10);
  const coneMat = std(0xff6a1a);
  const coneBaseGeo = new THREE.BoxGeometry(1.1, 0.1, 1.1);
  const bandGeo = new THREE.CylinderGeometry(0.83, 0.83, 0.18, 14);
  const coneBand = new THREE.CylinderGeometry(0.3, 0.38, 0.22, 10);

  const spawnProp = (kind: CircleKind, x: number, z: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    let r = 1.1;
    let top = 2;
    if (kind === "crate") {
      mesh(crateGeo, crateMat, 0, 1, 0, 1, 1, 1, g);
      g.rotation.y = rnd() * Math.PI;
    } else if (kind === "barrel") {
      mesh(barrelBody, barrelMat, 0, 0.9, 0, 1, 1, 1, g);
      mesh(bandGeo, bandMat, 0, 0.45, 0, 1, 1, 1, g);
      mesh(bandGeo, bandMat, 0, 1.35, 0, 1, 1, 1, g);
      r = 0.9;
      top = 1.8;
    } else {
      mesh(coneBaseGeo, M.dark, 0, 0.05, 0, 1, 1, 1, g);
      mesh(coneGeo, coneMat, 0, 0.65, 0, 1, 1, 1, g);
      mesh(coneBand, M.white, 0, 0.62, 0, 1, 1, 1, g);
      r = 0.55;
      top = 1.1;
    }
    root.add(g);
    circles.push({ x, z, r, top, kind, alive: true, mesh: g, respawnAt: 0, pop: 1, lastHit: -1, hp: kind === "crate" ? 20 : kind === "barrel" ? 10 : 1 });
  };

  const scatter = (kind: CircleKind, cx: number, cz: number, n: number, spread: number) => {
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < n; tries++) {
      const x = cx + (rnd() - 0.5) * spread * 2;
      const z = cz + (rnd() - 0.5) * spread * 2;
      if (free(x, z, kind === "crate" ? 1.5 : 1.0)) {
        spawnProp(kind, x, z);
        placed++;
      }
    }
  };

  for (const [x, z] of [[-42, -22], [42, 22], [-42, 24], [42, -24], [0, -64 + 14], [0, 64 - 14], [-30, 0], [30, 0]] as [number, number][]) scatter("crate", x, z, 2, 4);
  for (const [x, z] of [[20, -12], [-20, 12], [22, 38], [-22, -38], [-52, -40], [52, 40], [-8, 0 + 50 - 14], [8, -50 + 14]] as [number, number][]) scatter("barrel", x, z, 2, 3.5);
  for (const [x, z] of [[0, 24], [0, -24], [16, 16], [-16, -16], [16, -16], [-16, 16], [50, 14], [-50, -14], [60, -10], [-60, 10]] as [number, number][]) scatter("cone", x, z, 2, 3);

  // city-style neon signs on the walls
  const signTex = (txt: string, col: string) =>
    canvasTex(256, 64, (g) => {
      g.fillStyle = "#05060f";
      g.fillRect(0, 0, 256, 64);
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.strokeRect(3, 3, 250, 58);
      g.fillStyle = col;
      g.font = "italic 900 40px Impact, 'Arial Black', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.shadowColor = col;
      g.shadowBlur = 12;
      g.fillText(txt, 128, 34);
    });
  const signs: [string, string, number, number, number][] = [
    ["KART WARS", "#35e8ff", 0, half - 0.45, Math.PI],
    ["BOOST", "#ffd21f", 0, -half + 0.45, 0],
    ["ARENA 01", "#ff3fb0", half - 0.45, 0, -Math.PI / 2],
    ["DANGER", "#ff4a3a", -half + 0.45, 0, Math.PI / 2],
  ];
  for (const [txt, col, x, z, rot] of signs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), new THREE.MeshBasicMaterial({ map: signTex(txt, col), toneMapped: false }));
    m.position.set(x, 3.6, z);
    m.rotation.y = rot;
    root.add(m);
  }

  // ---------- queries ----------
  const groundAt = (x: number, z: number, yRef: number) => {
    let g = 0;
    for (let i = 0; i < surfaces.length; i++) {
      const s = surfaces[i];
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const h = surfaceHeight(s, x, z);
      if (h <= yRef + 0.6 && h > g) g = h;
    }
    return g;
  };
  const maxHeightAt = (x: number, z: number) => {
    let g = 0;
    for (let i = 0; i < surfaces.length; i++) {
      const s = surfaces[i];
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const h = surfaceHeight(s, x, z);
      if (h > g) g = h;
    }
    return g;
  };

  const update = (t: number, dt: number) => {
    for (const s of spinners) {
      if (s.sy) {
        s.obj.rotation.z += s.sy * dt;
        s.obj.rotation.y += s.sx * dt;
      } else {
        s.obj.rotation.z += dt * 0.6;
      }
    }
    for (const p of pulsers) {
      const k = 0.85 + Math.sin(t * 2.4 + p.phase) * 0.15;
      p.mat.color.copy(p.base).multiplyScalar(k);
    }
    for (const c of circles) {
      if (c.kind !== "static" && c.alive && c.pop < 1 && c.mesh) {
        c.pop = Math.min(1, c.pop + dt * 3);
        const e = c.pop;
        const s = 1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2);
        c.mesh.scale.setScalar(Math.max(0.01, s));
      }
    }
  };

  return { half, hx: half, hz: half, surfaces, circles, pickupSpots, spawns, lanes, groundAt, maxHeightAt, update };
}

export function createPickupMesh(kind: "weapon" | "health", accent?: number): THREE.Group {
  const g = new THREE.Group();
  const isW = kind === "weapon";
  const bodyMat = new THREE.MeshStandardMaterial({ color: isW ? 0x0f4a63 : 0x1b7a3a, roughness: 0.35, metalness: 0.6, flatShading: true, emissive: isW ? 0x06202c : 0x082a12 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0b429, metalness: 0.8, roughness: 0.3, flatShading: true });
  const glowCol = accent ?? (isW ? 0x35e8ff : 0x6dff6d);
  const glow = new THREE.MeshBasicMaterial({ color: glowCol });
  const inner = new THREE.Group();
  inner.name = "spin";
  g.add(inner);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), bodyMat);
  body.castShadow = true;
  inner.add(body);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), gold);
    c.position.set(sx * 0.55, sy * 0.55, sz * 0.55);
    inner.add(c);
  }
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.1, 1.16), glow);
  inner.add(band);
  if (isW) {
    for (const rot of [0, Math.PI / 2]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.16, 0.1), glow);
      s.position.set(rot ? 0.58 : -0.58, 0, rot ? 0.58 : 0.58);
      inner.add(s);
    }
  } else {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    inner.add(v, h);
  }
  const base = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 6, 28), glow);
  base.rotation.x = Math.PI / 2;
  base.position.y = -0.85;
  g.add(base);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.0, 5, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: glowCol, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 1.6;
  g.add(beam);
  return g;
}

export function disposeScene(scene: THREE.Scene) {
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => mats.add(x));
  });
  mats.forEach((m) => {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) texs.add(v);
    m.dispose();
  });
  texs.forEach((t) => t.dispose());
}
