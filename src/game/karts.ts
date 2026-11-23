import * as THREE from "three";
import type { KartPreset } from "./types";
import { DriverCharacter } from "./driver";

export interface KartRig {
  group: THREE.Group;
  body: THREE.Group;
  frontPivots: THREE.Object3D[];
  spinners: THREE.Object3D[];
  flames: THREE.Mesh[];
  shield: THREE.Mesh;
  underglow: THREE.Mesh;
  driver: DriverCharacter;
  bodyMats: THREE.MeshStandardMaterial[];
  primaryMat: THREE.MeshStandardMaterial;
  ringMat: THREE.MeshBasicMaterial;
  ownedMaterials: THREE.Material[];
}

let glowTex: THREE.Texture | null = null;
export function getGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

function numberTexture(num: string, bg: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#111";
  g.font = "italic 900 40px Impact, 'Arial Black', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(num, 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
const sphereGeo = new THREE.SphereGeometry(1, 12, 10);
const coneGeo = new THREE.ConeGeometry(1, 1, 8);
const torusGeo = new THREE.TorusGeometry(1, 0.12, 6, 20);

export interface BuildOpts {
  primary?: number;
  accent?: number;
  glow?: number;
  avatar?: string;
  wheelStyle?: string;
}

export function buildKart(preset: KartPreset, opts: BuildOpts = {}): KartRig {
  const primary = opts.primary ?? preset.primary;
  const glow = opts.glow ?? preset.glow;
  const owned: THREE.Material[] = [];
  const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.25, flatShading: true, ...o });
    owned.push(m);
    return m;
  };
  const basic = (color: number, o: THREE.MeshBasicMaterialParameters = {}) => {
    const m = new THREE.MeshBasicMaterial({ color, ...o });
    owned.push(m);
    return m;
  };
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const frontPivots: THREE.Object3D[] = [];
  const spinners: THREE.Object3D[] = [];
  const flames: THREE.Mesh[] = [];
  let driverCharacter: DriverCharacter | null = null;

  const primaryMat = std(primary, { roughness: 0.35, metalness: 0.35 });
  const accentMat = std(opts.accent ?? preset.accent, { roughness: 0.4 });
  const darkMat = std(0x15171d, { roughness: 0.8, metalness: 0.1 });
  const tireMat = std(0x0e0e10, { roughness: 0.95, metalness: 0 });
  const metalMat = std(0xb9c0cc, { roughness: 0.25, metalness: 0.8 });
  const glowMat = basic(glow);
  const wheelStyleMat = opts.wheelStyle === "gold"
    ? std(0xffc33b, { roughness: 0.22, metalness: 0.85 })
    : opts.wheelStyle === "neon"
      ? basic(0x35f0ff)
      : opts.wheelStyle === "chrome"
        ? std(0xdce5f2, { roughness: 0.16, metalness: 0.95 })
        : null;
  const bodyMats = [primaryMat];

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], s: [number, number, number], parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p);
    m.scale.set(...s);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const wheel = (x: number, z: number, r: number, w: number, front: boolean, rimMat: THREE.Material) => {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, r, z);
    body.add(pivot);
    const spin = new THREE.Object3D();
    pivot.add(spin);
    const tire = new THREE.Mesh(cylGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.scale.set(r, w, r);
    tire.castShadow = true;
    spin.add(tire);
    const hub = new THREE.Mesh(cylGeo, wheelStyleMat ?? rimMat);
    hub.rotation.z = Math.PI / 2;
    hub.scale.set(r * 0.62, w * 1.04, r * 0.62);
    spin.add(hub);
    if (front) frontPivots.push(pivot);
    spinners.push(spin);
  };

  const driver = (y: number, z: number) => {
    driverCharacter = new DriverCharacter(opts.avatar ?? "😎");
    driverCharacter.group.position.set(0, y - 1, z + 0.3);
    body.add(driverCharacter.group);
  };

  const flame = (x: number, y: number, z: number) => {
    const f = new THREE.Mesh(coneGeo, basic(0xffa030, { transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    owned.push(f.material as THREE.Material);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, y, z);
    f.scale.set(0.2, 0.01, 0.2);
    body.add(f);
    flames.push(f);
  };

  if (preset.shape === "kart") {
    // open-wheel go-kart
    add(boxGeo, primaryMat, [0, 0.42, 0], [1.1, 0.14, 2.2]);
    add(boxGeo, metalMat, [0, 0.36, -0.1], [0.95, 0.08, 1.4]);
    add(boxGeo, primaryMat, [0, 0.58, 0.9], [0.7, 0.22, 0.9]);
    add(boxGeo, primaryMat, [0, 0.52, 1.35], [0.5, 0.16, 0.5]);
    add(boxGeo, accentMat, [0, 0.4, 1.78], [1.9, 0.18, 0.38]);
    add(boxGeo, accentMat, [-0.95, 0.52, 1.76], [0.18, 0.3, 0.38]);
    add(boxGeo, accentMat, [0.95, 0.52, 1.76], [0.18, 0.3, 0.38]);
    add(boxGeo, primaryMat, [-0.78, 0.5, -0.1], [0.34, 0.3, 1.5]);
    add(boxGeo, primaryMat, [0.78, 0.5, -0.1], [0.34, 0.3, 1.5]);
    add(boxGeo, accentMat, [-0.78, 0.66, -0.1], [0.36, 0.05, 1.0]);
    add(boxGeo, accentMat, [0.78, 0.66, -0.1], [0.36, 0.05, 1.0]);
    add(boxGeo, darkMat, [0, 0.95, -0.5], [0.8, 0.8, 0.22]);
    add(boxGeo, darkMat, [0, 0.62, -0.25], [0.8, 0.2, 0.6]);
    add(boxGeo, metalMat, [0, 0.62, -1.0], [0.5, 0.45, 0.45]);
    add(cylGeo, metalMat, [0.2, 0.75, -1.25], [0.07, 0.4, 0.07]).rotation.x = Math.PI / 2;
    add(boxGeo, new THREE.MeshBasicMaterial({ map: numberTexture(preset.num, "#ffffff") }), [0, 0.72, 1.38], [0.38, 0.03, 0.38]);
    add(cylGeo, darkMat, [0, 0.9, 0.55], [0.17, 0.05, 0.17]).rotation.x = 0.8;
    driver(1.0, -0.1);
    wheel(-0.95, 1.25, 0.36, 0.3, true, accentMat);
    wheel(0.95, 1.25, 0.36, 0.3, true, accentMat);
    wheel(-1.0, -0.95, 0.42, 0.42, false, accentMat);
    wheel(1.0, -0.95, 0.42, 0.42, false, accentMat);
    flame(0.2, 0.75, -1.5);
  } else if (preset.shape === "buggy") {
    // enclosed neon buggy
    add(boxGeo, primaryMat, [0, 0.62, 0], [1.35, 0.5, 2.5]);
    add(boxGeo, primaryMat, [0, 0.55, 1.35], [1.2, 0.42, 0.7]);
    add(boxGeo, primaryMat, [0, 1.0, -0.3], [0.95, 0.4, 1.3]);
    add(boxGeo, darkMat, [0, 1.03, 0.42], [0.8, 0.28, 0.18]);
    add(boxGeo, glowMat, [0, 0.9, 1.74], [0.95, 0.12, 0.05]);
    add(boxGeo, basic(0xffffff), [-0.4, 0.68, 1.72], [0.3, 0.2, 0.08]);
    add(boxGeo, basic(0xffffff), [0.4, 0.68, 1.72], [0.3, 0.2, 0.08]);
    add(boxGeo, accentMat, [-0.69, 0.62, 0], [0.04, 0.08, 2.3]);
    add(boxGeo, accentMat, [0.69, 0.62, 0], [0.04, 0.08, 2.3]);
    add(boxGeo, accentMat, [0, 1.22, -0.3], [0.05, 0.03, 1.3]);
    add(boxGeo, darkMat, [0, 0.4, 1.7], [1.1, 0.3, 0.2]);
    add(boxGeo, accentMat, [0, 0.9, -1.25], [1.0, 0.07, 0.35]);
    add(cylGeo, metalMat, [-0.3, 1.2, -1.2], [0.07, 0.6, 0.07]);
    add(cylGeo, metalMat, [0.3, 1.2, -1.2], [0.07, 0.6, 0.07]);
    driver(1.2, -0.3);
    const rim = glowMat;
    wheel(-0.95, 1.1, 0.5, 0.4, true, rim);
    wheel(0.95, 1.1, 0.5, 0.4, true, rim);
    wheel(-0.98, -1.0, 0.52, 0.46, false, rim);
    wheel(0.98, -1.0, 0.52, 0.46, false, rim);
    flame(-0.3, 1.0, -1.5);
    flame(0.3, 1.0, -1.5);
  } else {
    // hover saucer
    add(cylGeo, primaryMat, [0, 0.65, 0], [1.45, 0.3, 1.45]);
    add(cylGeo, accentMat, [0, 0.52, 0], [1.55, 0.06, 1.55]);
    add(cylGeo, darkMat, [0, 0.4, 0], [1.0, 0.18, 1.0]);
    add(sphereGeo, std(0x7ad8ff, { transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.6 }), [0, 0.88, -0.1], [0.75, 0.55, 0.85]);
    add(boxGeo, accentMat, [0, 0.84, 1.45], [0.9, 0.1, 0.35]);
    driver(0.95, -0.1);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = Math.cos(a) * 1.15;
      const pz = Math.sin(a) * 1.15;
      add(cylGeo, darkMat, [px, 0.35, pz], [0.28, 0.18, 0.28]);
      add(cylGeo, wheelStyleMat ?? glowMat, [px, 0.24, pz], [0.2, 0.03, 0.2]);
    }
    const ring = new THREE.Mesh(torusGeo, glowMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.55;
    ring.scale.set(1.52, 1.52, 2);
    body.add(ring);
    add(cylGeo, glowMat, [0, 0.62, -1.46], [0.5, 0.08, 0.04]).rotation.x = 0;
    flame(0, 0.7, -1.5);
  }

  // underglow disc
  const ringMat = new THREE.MeshBasicMaterial({
    map: getGlowTexture(),
    color: glow,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(ringMat);
  const underglow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.6), ringMat);
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.06;
  underglow.renderOrder = 1;
  group.add(underglow);

  // shield bubble
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x38e8ff,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  owned.push(shieldMat);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(2.3, 16, 12), shieldMat);
  shield.position.y = 0.9;
  shield.visible = false;
  group.add(shield);

  if (!driverCharacter) throw new Error("Kart preset did not create its driver character.");
  return { group, body, frontPivots, spinners, flames, shield, underglow, driver: driverCharacter, bodyMats, primaryMat, ringMat, ownedMaterials: owned };
}

export function disposeRig(r: KartRig) {
  r.ownedMaterials.forEach((m) => m.dispose());
  (r.underglow.geometry as THREE.BufferGeometry).dispose();
  (r.shield.geometry as THREE.BufferGeometry).dispose();
}
