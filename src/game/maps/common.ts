import * as THREE from "three";
import { surfaceHeight, type Circle, type PickupZone, type SpawnPoint, type Surface } from "../arena";

export type MapQuality = "low" | "medium" | "high";

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTex(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
  repeatX = 1,
  repeatY = 1,
  aniso = 4,
) {
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

export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
};

const wedgeCache = new Map<string, THREE.BufferGeometry>();
export function wedgeGeo(len: number, h: number, wid: number): THREE.BufferGeometry {
  const key = `${len.toFixed(1)}_${h.toFixed(1)}_${wid.toFixed(1)}`;
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
  return geo;
}

/** Rectangular gameplay zone. */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
export const inAny = (rects: Rect[] | undefined, x: number, z: number) => !!rects && rects.some((r) => inRect(r, x, z));

// ---------------------------------------------------------------- sky & ground

export function makeSky(
  scene: THREE.Scene,
  o: { top: number; mid: number; horizon: number; sunDir: [number, number, number]; sunColor: number; stars: number },
) {
  const cTop = new THREE.Color(o.top);
  const cMid = new THREE.Color(o.mid);
  const cHor = new THREE.Color(o.horizon);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      cTop: { value: new THREE.Vector3(cTop.r, cTop.g, cTop.b) },
      cMid: { value: new THREE.Vector3(cMid.r, cMid.g, cMid.b) },
      cHor: { value: new THREE.Vector3(cHor.r, cHor.g, cHor.b) },
      sunDir: { value: new THREE.Vector3(...o.sunDir).normalize() },
      sunCol: { value: new THREE.Color(o.sunColor) },
      starAmt: { value: o.stars },
    },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: `varying vec3 vP;
      uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cHor;
      uniform vec3 sunDir; uniform vec3 sunCol; uniform float starAmt;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
      void main(){
        float h = clamp(vP.y, 0.0, 1.0);
        vec3 c = mix(cHor, cMid, smoothstep(0.0, 0.25, h));
        c = mix(c, cTop, smoothstep(0.2, 0.8, h));
        vec3 sd = normalize(sunDir);
        float s = smoothstep(0.988, 0.992, dot(vP, sd));
        c += sunCol * s;
        c += sunCol * pow(max(dot(vP, sd), 0.0), 24.0) * 0.5;
        vec3 q = floor(vP * 160.0);
        float st = step(0.9985, hash(q)) * smoothstep(0.25, 0.6, h) * starAmt;
        c += vec3(st);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), mat);
  sky.renderOrder = -10;
  scene.add(sky);
}

export function makeGround(root: THREE.Group, hx: number, hz: number, paint: (g: CanvasRenderingContext2D) => void, tile: number, aniso: number) {
  const tex = canvasTex(512, 512, paint, (hx * 2 + 8) / tile, (hz * 2 + 8) / tile, aniso);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(hx * 2 + 8, hz * 2 + 8),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.3 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);
}

export function makeWalls(kit: Kit, hx: number, hz: number, h: number, wallMat: THREE.Material, stripMat: THREE.Material) {
  const { box } = GEO;
  const mk = (x: number, z: number, len: number, rot: number) => {
    const w = kit.mesh(box, wallMat, x, h / 2, z, len, h, 2.5);
    w.rotation.y = rot;
    kit.mesh(box, stripMat, x, h + 0.1, z, rot === 0 ? len : 0.3, 0.22, rot === 0 ? 0.3 : len, kit.root, false);
  };
  mk(0, hz + 1.5, hx * 2 + 6, 0);
  mk(0, -hz - 1.5, hx * 2 + 6, 0);
  mk(hx + 1.5, 0, hz * 2 + 6, Math.PI / 2);
  mk(-hx - 1.5, 0, hz * 2 + 6, Math.PI / 2);
}

// ---------------------------------------------------------------- animated lava

const LAVA_FRAG = `
  uniform float uTime; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
  float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
  void main(){
    vec2 p = vUv * 7.0;
    float flow  = fbm(p + vec2(uTime*0.055, uTime*0.042));
    float flow2 = fbm(p*1.9 - vec2(uTime*0.075, uTime*0.02));
    float heat = smoothstep(0.30, 0.86, flow*0.62 + flow2*0.48);
    float crust = smoothstep(0.42, 0.30, heat);
    vec3 hot  = vec3(1.0, 0.76, 0.16);
    vec3 mid  = vec3(0.95, 0.20, 0.02);
    vec3 dark = vec3(0.18, 0.035, 0.02);
    vec3 c = mix(dark, mid, smoothstep(0.16, 0.58, heat));
    c = mix(c, hot, smoothstep(0.56, 0.96, heat));
    c = mix(c, dark*1.2, crust*0.55);
    gl_FragColor = vec4(c * (1.1 + heat*1.05), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const LAVA_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

export interface LavaField {
  mats: THREE.ShaderMaterial[];
  newMat(): THREE.ShaderMaterial;
  update(t: number): void;
  dispose(): void;
}

/** Animated molten-lava shader material (flowing crust + hot seams, emissive). */
export function makeLava(): LavaField {
  const mats: THREE.ShaderMaterial[] = [];
  const make = () => {
    const m = new THREE.ShaderMaterial({
      vertexShader: LAVA_VERT,
      fragmentShader: LAVA_FRAG,
      uniforms: { uTime: { value: 0 } },
    });
    mats.push(m);
    return m;
  };
  mats.push(make());
  return {
    mats,
    newMat: make,
    update(t: number) {
      for (const m of mats) m.uniforms.uTime.value = t;
    },
    dispose() {
      mats.forEach((m) => m.dispose());
    },
  };
}

/** Irregular flat lava pool/river outline -> geometry. */
export function lavaShape(points: [number, number][], y: number) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  // normalize UVs into 0..1 so the lava shader tiles at a natural scale
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const sx = Math.max(0.001, bb.max.x - bb.min.x);
  const sz = Math.max(0.001, bb.max.y - bb.min.y);
  const uv = geo.attributes.uv.array as Float32Array;
  const pos = geo.attributes.position.array as Float32Array;
  for (let i = 0; i < uv.length / 2; i++) {
    uv[i * 2] = (pos[i * 3] - bb.min.x) / sx;
    uv[i * 2 + 1] = (pos[i * 3 + 1] - bb.min.y) / sz;
  }
  (geo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
  const mesh = new THREE.Mesh(geo);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

/** Wobbly closed outline around a center, for natural-looking pools. */
export function blob(cx: number, cz: number, rx: number, rz: number, seed: () => number, n = 22, wob = 0.18): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (seed() - 0.5) * wob * 2;
    pts.push([cx + Math.cos(a) * rx * k, cz + Math.sin(a) * rz * k]);
  }
  return pts;
}

/** Rock rim ring around a lava body: low (drivable) collars that keep karts out. */
export function rockRim(kit: Kit, pts: [number, number][], mat: THREE.Material, gap: (x: number, z: number) => boolean, h = 0.55) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cx = (a[0] + b[0]) / 2;
    const cz = (a[1] + b[1]) / 2;
    if (gap(cx, cz)) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.6;
    const m = kit.mesh(GEO.box, mat, cx, h / 2, cz, len, h, 1.5);
    m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
}

/** Glowing rock cracks texture (emissive map). */
export function crackTexture(col = "#ff6a10", bg = "#1a1220") {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = col;
    g.shadowColor = col;
    g.shadowBlur = 10;
    g.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      let x = Math.random() * 256;
      let y = Math.random() * 256;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (Math.random() - 0.5) * 90;
        y += (Math.random() - 0.5) * 90;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

/** Rising ember particle field (own lightweight Points cloud). */
export function makeEmbers(scene: THREE.Scene, count: number, area: { x: number; z: number; rx: number; rz: number; top: number }) {
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = area.x + (Math.random() - 0.5) * area.rx * 2;
    pos[i * 3 + 1] = Math.random() * area.top;
    pos[i * 3 + 2] = area.z + (Math.random() - 0.5) * area.rz * 2;
    speed[i] = 0.6 + Math.random() * 1.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({
    color: 0xffa33a,
    size: 0.28,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return {
    points: pts,
    update(dt: number, t: number) {
      const arr = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < count; i++) {
        arr[i * 3 + 1] += speed[i] * dt;
        arr[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.35;
        if (arr[i * 3 + 1] > area.top) {
          arr[i * 3 + 1] = 0;
          arr[i * 3] = area.x + (Math.random() - 0.5) * area.rx * 2;
          arr[i * 3 + 2] = area.z + (Math.random() - 0.5) * area.rz * 2;
        }
      }
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Soft smoke column (layered translucent cones, gently animated). */
export function makeSmokeColumn(x: number, y: number, z: number, h: number, color = 0x3a2c38) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const mats: THREE.Material[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.16 - i * 0.03,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mats.push(m);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.2 + i * 1.4, 0.8 + i * 0.9, h, 10, 1, true), m);
    cone.position.y = (h / 2) * (1 + i * 0.55);
    g.add(cone);
  }
  return {
    group: g,
    update(t: number) {
      g.rotation.y = t * 0.12;
      g.position.y = y + Math.sin(t * 0.5) * 0.4;
    },
    dispose() {
      mats.forEach((m) => m.dispose());
    },
  };
}

// ---------------------------------------------------------------- building kit

export class Kit {
  root = new THREE.Group();
  surfaces: Surface[] = [];
  circles: Circle[] = [];
  spinners: { obj: THREE.Object3D; sx: number; sy: number }[] = [];
  pulsers: { mat: THREE.MeshBasicMaterial; base: THREE.Color; phase: number }[] = [];

  std(color: number, o: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, flatShading: true, ...o });
  }
  basic(color: number) {
    return new THREE.MeshBasicMaterial({ color });
  }
  mesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number, y: number, z: number,
    sx = 1, sy = 1, sz = 1,
    parent: THREE.Object3D = this.root,
    shadow = true,
  ) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** Solid block with drivable top. Height > 0.6 blocks karts (physics rule). */
  block(x0: number, x1: number, z0: number, z1: number, h: number, mats: { base: THREE.Material; top: THREE.Material; trim: THREE.Material }, nav = false) {
    this.surfaces.push({ x0, x1, z0, z1, h, dir: -1, nav });
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    this.mesh(GEO.box, mats.base, cx, h / 2 - 0.05, cz, w, h - 0.1, d);
    this.mesh(GEO.box, mats.top, cx, h - 0.08, cz, w + 0.15, 0.18, d + 0.15);
    const t = 0.12;
    this.mesh(GEO.box, mats.trim, cx, h * 0.5, z0, w, t, t, this.root, false);
    this.mesh(GEO.box, mats.trim, cx, h * 0.5, z1, w, t, t, this.root, false);
    this.mesh(GEO.box, mats.trim, x0, h * 0.5, cz, t, t, d, this.root, false);
    this.mesh(GEO.box, mats.trim, x1, h * 0.5, cz, t, t, d, this.root, false);
  }

  /** Wedge ramp. dir: 0 rises toward +x, 1 toward -x, 2 toward +z, 3 toward -z */
  ramp(
    x0: number, x1: number, z0: number, z1: number, h: number, dir: number,
    mats: { side: THREE.Material; edge: THREE.Material; stripe: THREE.Material },
  ) {
    this.surfaces.push({ x0, x1, z0, z1, h, dir });
    const alongX = dir < 2;
    const len = alongX ? x1 - x0 : z1 - z0;
    const wid = alongX ? z1 - z0 : x1 - x0;
    const g = new THREE.Group();
    g.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    g.rotation.y = [0, Math.PI, -Math.PI / 2, Math.PI / 2][dir];
    this.root.add(g);
    this.mesh(wedgeGeo(len, h, wid), mats.side, 0, 0, 0, 1, 1, 1, g);
    const tilt = new THREE.Group();
    tilt.position.set(0, h / 2 + 0.04, 0);
    tilt.rotation.z = Math.atan2(h, len);
    g.add(tilt);
    const slopeLen = Math.hypot(len, h);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(slopeLen, wid - 0.6), mats.stripe);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    tilt.add(plane);
    for (const sgn of [-1, 1]) this.mesh(GEO.box, mats.edge, 0, 0.12, sgn * (wid / 2 - 0.15), slopeLen, 0.3, 0.3, tilt);
  }

  groundAt(x: number, z: number, yRef: number) {
    let g = 0;
    for (const s of this.surfaces) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const h = surfaceHeight(s, x, z);
      if (h <= yRef + 0.6 && h > g) g = h;
    }
    return g;
  }
  maxHeightAt(x: number, z: number) {
    let g = 0;
    for (const s of this.surfaces) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const h = surfaceHeight(s, x, z);
      if (h > g) g = h;
    }
    return g;
  }
  update(t: number, dt: number) {
    for (const s of this.spinners) {
      if (s.sy) {
        s.obj.rotation.z += s.sy * dt;
        s.obj.rotation.y += s.sx * dt;
      } else s.obj.rotation.z += dt * 0.6;
    }
    for (const p of this.pulsers) {
      const k = 0.85 + Math.sin(t * 2.4 + p.phase) * 0.15;
      p.mat.color.copy(p.base).multiplyScalar(k);
    }
  }
}

// ---------------------------------------------------------------- props & placement

export interface PropDef {
  kind: "crate" | "barrel" | "cone";
  cx: number;
  cz: number;
  n: number;
  spread: number;
  /** cover = combat obstacles, decor = scenery outside driving routes (default cover) */
  zone?: "cover" | "decor";
}

function propMeshes(kit: Kit, kind: "crate" | "barrel" | "cone", tex: THREE.Texture | null, M: Record<string, THREE.Material>) {
  const g = new THREE.Group();
  if (kind === "crate") {
    const mat = new THREE.MeshStandardMaterial({ map: tex ?? undefined, roughness: 0.8, flatShading: true, color: tex ? 0xffffff : 0xb07a3c });
    kit.mesh(new THREE.BoxGeometry(2, 2, 2), mat, 0, 1, 0, 1, 1, 1, g);
    return { g, r: 1.1, top: 2 };
  }
  if (kind === "barrel") {
    kit.mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.8, 14), M.barrel, 0, 0.9, 0, 1, 1, 1, g);
    kit.mesh(new THREE.CylinderGeometry(0.83, 0.83, 0.18, 14), M.band, 0, 0.45, 0, 1, 1, 1, g);
    kit.mesh(new THREE.CylinderGeometry(0.83, 0.83, 0.18, 14), M.band, 0, 1.35, 0, 1, 1, 1, g);
    return { g, r: 0.9, top: 1.8 };
  }
  kit.mesh(new THREE.BoxGeometry(1.1, 0.1, 1.1), M.dark, 0, 0.05, 0, 1, 1, 1, g);
  kit.mesh(new THREE.ConeGeometry(0.5, 1.1, 10), M.cone, 0, 0.65, 0, 1, 1, 1, g);
  return { g, r: 0.55, top: 1.1 };
}

/**
 * Place props with navigation rules:
 * - never inside a driving lane (`lanes`)
 * - `cover` only inside combat zones (`combat`)
 * - `decor` only inside decorative zones (`decor`)
 * - clear of spawns, pickup zones and existing solids
 */
export function scatterProps(
  kit: Kit,
  rnd: () => number,
  hx: number,
  hz: number,
  defs: PropDef[],
  spawns: { x: number; z: number }[],
  zones: { x: number; z: number }[],
  crateTex: THREE.Texture | null,
  M: Record<string, THREE.Material>,
  o: { lanes?: Rect[]; combat?: Rect[]; decor?: Rect[] } = {},
) {
  const free = (x: number, z: number, margin: number, def: PropDef) => {
    if (Math.abs(x) > hx - 4 || Math.abs(z) > hz - 4) return false;
    if (o.lanes && o.lanes.some((l) => x > l.x0 - margin - 1.2 && x < l.x1 + margin + 1.2 && z > l.z0 - margin - 1.2 && z < l.z1 + margin + 1.2)) return false; // driving lanes stay clear
    const zonesOfKind = (def.zone ?? "cover") === "cover" ? o.combat : o.decor;
    if (zonesOfKind && !inAny(zonesOfKind, x, z)) return false;
    for (const s of kit.surfaces)
      if (x > s.x0 - margin - 1 && x < s.x1 + margin + 1 && z > s.z0 - margin - 1 && z < s.z1 + margin + 1) return false;
    for (const c of kit.circles) if (Math.hypot(c.x - x, c.z - z) < c.r + margin + 2.6) return false;
    for (const p of spawns) if (Math.hypot(p.x - x, p.z - z) < 8.5) return false;
    for (const zn of zones) if (Math.hypot(zn.x - x, zn.z - z) < 5) return false;
    return true;
  };
  for (const def of defs) {
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < def.n; tries++) {
      const x = def.cx + (rnd() - 0.5) * def.spread * 2;
      const z = def.cz + (rnd() - 0.5) * def.spread * 2;
      const margin = def.kind === "crate" ? 1.5 : 1.0;
      if (!free(x, z, margin, def)) continue;
      const { g, r, top } = propMeshes(kit, def.kind, crateTex, M);
      g.position.set(x, 0, z);
      if (def.kind === "crate") g.rotation.y = rnd() * Math.PI;
      kit.root.add(g);
      kit.circles.push({
        x, z, r, top, kind: def.kind, alive: true, mesh: g, respawnAt: 0, pop: 1, lastHit: -1,
        hp: def.kind === "crate" ? 20 : def.kind === "barrel" ? 10 : 1,
      });
      placed++;
    }
  }
}

/** Ring of validated player spawns facing the arena center. */
export function placeSpawns(
  kit: Kit,
  rnd: () => number,
  hx: number,
  hz: number,
  count: number,
  hazards: { x: number; z: number; r: number }[] = [],
): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  const R = Math.min(hx, hz) - 12;
  const clear = (x: number, z: number) => {
    if (Math.abs(x) > hx - 3 || Math.abs(z) > hz - 3) return false;
    for (const h of hazards) if (Math.hypot(h.x - x, h.z - z) < h.r + 4) return false;
    for (const s of kit.surfaces) {
      if (x < s.x0 - 3.5 || x > s.x1 + 3.5 || z < s.z0 - 3.5 || z > s.z1 + 3.5) continue;
      if (surfaceHeight(s, Math.max(s.x0, Math.min(s.x1, x)), Math.max(s.z0, Math.min(s.z1, z))) > 0.6) return false;
    }
    for (const c of kit.circles) {
      if (c.kind === "cone") continue;
      if (Math.hypot(c.x - x, c.z - z) < c.r + 3.5) return false;
    }
    for (const p of spawns) if (Math.hypot(p.x - x, p.z - z) < 9) return false;
    return true;
  };
  for (let i = 0; i < count; i++) {
    let px = 0;
    let pz = 0;
    let ok = false;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      const a = ((i + rnd() * 0.8) / count) * Math.PI * 2;
      const rx = Math.cos(a) * (hx - 10 - rnd() * 4);
      const rz = Math.sin(a) * (hz - 10 - rnd() * 4);
      if (clear(rx, rz)) {
        px = rx;
        pz = rz;
        ok = true;
      }
    }
    if (!ok) {
      // validated fallback: spiral out from the ideal spot for the nearest clear point
      const a = (i / count) * Math.PI * 2;
      for (let step = 0; step < 24 && !ok; step++) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const tx2 = Math.cos(a) * R + dx * step * 3;
          const tz2 = Math.sin(a) * R + dz * step * 3;
          if (clear(tx2, tz2)) {
            px = tx2;
            pz = tz2;
            ok = true;
            break;
          }
        }
      }
    }
    spawns.push({ x: px, z: pz, heading: Math.atan2(-px, -pz) });
  }
  return spawns;
}

/** Drop zones that are inside solids, floating, or out of bounds. */
export function validateZones(zones: PickupZone[], surfaces: Surface[], circles: Circle[], hx: number, hz: number): PickupZone[] {
  return zones.filter((zn) => {
    if (Math.abs(zn.x) > hx - 2 || Math.abs(zn.z) > hz - 2) return false;
    let top = 0;
    for (const s of surfaces) {
      if (zn.x < s.x0 || zn.x > s.x1 || zn.z < s.z0 || zn.z > s.z1) continue;
      const h = surfaceHeight(s, zn.x, zn.z);
      if (h > zn.y + 0.6) return false;
      if (h > top) top = h;
    }
    if (zn.y > 0.1 && top < zn.y - 0.5) return false;
    for (const c of circles) {
      if (c.kind === "cone" || c.top < zn.y + 0.3) continue;
      if (Math.hypot(c.x - zn.x, c.z - zn.z) < c.r + 1.6) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- map audit

export interface AuditInput {
  name: string;
  hx: number;
  hz: number;
  surfaces: Surface[];
  circles: Circle[];
  spawns: SpawnPoint[];
  zones: PickupZone[];
  lanes?: Rect[];
  hazards?: { x: number; z: number; r: number }[];
}

/**
 * Automated map validation: collision continuity, reachability of elevated
 * surfaces, spawn/zone safety, driving-lane clearance and wedge traps.
 * Returns a list of issues (empty = map passes).
 */
export function auditMap(a: AuditInput): string[] {
  const issues: string[] = [];
  const isElev = (s: Surface) => s.h >= 0.6;

  // 1. every designed platform (nav) must be reachable via ramps / neighbours.
  // Ramps and low cover are always considered reachable (drivable / walkable).
  const elevated = a.surfaces.filter((s) => isElev(s) && s.nav === true);
  const ramps = a.surfaces.filter((s) => s.dir >= 0);
  for (const ramp of ramps) {
    const edgeClearance = Math.min(ramp.x0 + a.hx, a.hx - ramp.x1, ramp.z0 + a.hz, a.hz - ramp.z1);
    if (edgeClearance < 10) {
      issues.push(`ramp too close to arena edge (${edgeClearance.toFixed(1)}m clearance)`);
    }
  }
  const reachable = new Set<Surface>(a.surfaces.filter((s) => !isElev(s) || s.dir >= 0 || s.nav !== true));
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of elevated) {
      if (reachable.has(s)) continue;
      for (const r of reachable) {
        const gapX = Math.max(0, Math.max(r.x0 - s.x1, s.x0 - r.x1));
        const gapZ = Math.max(0, Math.max(r.z0 - s.z1, s.z0 - r.z1));
        const gap = Math.hypot(gapX, gapZ);
        const dh = Math.abs(r.h - s.h);
        if (gap < 2.0 && dh < 0.9) {
          reachable.add(s);
          changed = true;
          break;
        }
      }
    }
  }
  for (const s of elevated) {
    if (reachable.has(s)) continue;
    const hasRamp = ramps.some((r) => {
      const gapX = Math.max(0, Math.max(r.x0 - s.x1, s.x0 - r.x1));
      const gapZ = Math.max(0, Math.max(r.z0 - s.z1, s.z0 - r.z1));
      return Math.hypot(gapX, gapZ) < 2.5 && Math.abs(r.h - s.h) < 0.9;
    });
    issues.push(`unreachable platform [${s.x0.toFixed(0)}..${s.x1.toFixed(0)}, ${s.z0.toFixed(0)}..${s.z1.toFixed(0)}] h=${s.h}${hasRamp ? " (ramp present but not connected)" : " (no ramp)"}`);
  }

  // 2. spawns
  a.spawns.forEach((sp, i) => {
    if (Math.abs(sp.x) > a.hx - 2 || Math.abs(sp.z) > a.hz - 2) issues.push(`spawn ${i} out of bounds`);
    const solid = a.surfaces.some((s) => {
      if (sp.x < s.x0 - 2 || sp.x > s.x1 + 2 || sp.z < s.z0 - 2 || sp.z > s.z1 + 2) return false;
      return surfaceHeight(s, Math.max(s.x0, Math.min(s.x1, sp.x)), Math.max(s.z0, Math.min(s.z1, sp.z))) > 0.6;
    });
    if (solid) issues.push(`spawn ${i} inside solid geometry`);
    for (const h of a.hazards ?? []) {
      if (Math.hypot(h.x - sp.x, h.z - sp.z) < h.r + 4) issues.push(`spawn ${i} inside hazard`);
    }
    for (let j = i + 1; j < a.spawns.length; j++) {
      const q = a.spawns[j];
      if (Math.hypot(q.x - sp.x, q.z - sp.z) < 6) issues.push(`spawns ${i}/${j} overlap`);
    }
  });

  // 3. pickup zones
  const valid = validateZones(a.zones, a.surfaces, a.circles, a.hx, a.hz);
  if (valid.length < a.zones.length) issues.push(`${a.zones.length - valid.length} pickup zones invalid (inside geometry / floating)`);
  for (const zn of a.zones) {
    for (const h of a.hazards ?? []) {
      if (Math.hypot(h.x - zn.x, h.z - zn.z) < h.r + 2) issues.push(`pickup zone inside hazard at ${zn.x.toFixed(0)},${zn.z.toFixed(0)}`);
    }
  }

  // 4. driving lanes must be free of blocking obstacles
  for (const lane of a.lanes ?? []) {
    for (const c of a.circles) {
      if (c.kind === "cone") continue;
      const cx = Math.max(lane.x0, Math.min(lane.x1, c.x));
      const cz = Math.max(lane.z0, Math.min(lane.z1, c.z));
      if (Math.hypot(c.x - cx, c.z - cz) < c.r + 0.4) {
        issues.push(`${c.kind} (r${c.r.toFixed(1)}) blocks lane at ${c.x.toFixed(0)},${c.z.toFixed(0)}`);
        break;
      }
    }
    for (const s of a.surfaces) {
      if (s.dir >= 0 || s.h < 1.0 || s.nav === true) continue; // ramps + designed platforms are fine on lanes
      const overlapX = Math.min(lane.x1, s.x1) - Math.max(lane.x0, s.x0);
      const overlapZ = Math.min(lane.z1, s.z1) - Math.max(lane.z0, s.z0);
      if (overlapX > 3 && overlapZ > 3 && s.h > 0.6) {
        const laneW = Math.min(lane.x1 - lane.x0, lane.z1 - lane.z0);
        const sW = Math.min(s.x1 - s.x0, s.z1 - s.z0);
        if (sW > laneW * 0.55) issues.push(`solid block spans driving lane at ${s.x0.toFixed(0)},${s.z0.toFixed(0)}`);
      }
    }
  }

  // 5. wedge traps: two obstacles too close for a kart (2.5 wide)
  const blockers = a.circles.filter((c) => c.kind !== "cone" && c.top > 0.6);
  for (let i = 0; i < blockers.length; i++) {
    for (let j = i + 1; j < blockers.length; j++) {
      const d = Math.hypot(blockers[i].x - blockers[j].x, blockers[i].z - blockers[j].z) - blockers[i].r - blockers[j].r;
      if (d > 0.4 && d < 2.5) issues.push(`narrow gap (${d.toFixed(1)}m) between ${blockers[i].kind}/${blockers[j].kind} traps karts`);
    }
  }

  return issues;
}
