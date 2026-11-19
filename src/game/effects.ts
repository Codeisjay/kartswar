import * as THREE from "three";

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.12, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const tmpC = new THREE.Color();

export class ParticlePool {
  points: THREE.Points;
  private max: number;
  private cursor = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  setScale(v: number) {
    this.mat.uniforms.uScale.value = v;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, c0: number, c1: number, grav = 0, drag = 0, alpha = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.a0[i] = alpha;
    tmpC.set(c0);
    this.c0[i3] = tmpC.r;
    this.c0[i3 + 1] = tmpC.g;
    this.c0[i3 + 2] = tmpC.b;
    tmpC.set(c1);
    this.c1[i3] = tmpC.r;
    this.c1[i3 + 1] = tmpC.g;
    this.c1[i3 + 2] = tmpC.b;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) {
          this.size[i] = 0;
          this.col[i * 4 + 3] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05 && this.grav[i] > 0) {
        this.pos[i3 + 1] = 0.05;
        this.vel[i3 + 1] *= -0.3;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const i4 = i * 4;
      this.col[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      this.col[i4 + 3] = this.a0[i] * Math.min(1, t * 10) * (1 - t) * (1 - t * 0.2);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  r: number;
}
interface Boom {
  sprite: THREE.Sprite;
  t: number;
  dur: number;
  base: number;
}
interface Debris {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  w: THREE.Vector3;
  life: number;
  max: number;
}
interface FlashLight {
  light: THREE.PointLight;
  t: number;
  dur: number;
  peak: number;
}

const BOOM_WORDS = ["BOOM!", "KABOOM!", "POW!", "BAM!"];

function boomTexture(word: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "italic 900 74px Impact, 'Arial Black', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 16;
  g.strokeStyle = "#7a1d00";
  g.strokeText(word, 128, 66);
  g.lineWidth = 8;
  g.strokeStyle = "#ffffff";
  g.strokeText(word, 128, 62);
  const grad = g.createLinearGradient(0, 30, 0, 100);
  grad.addColorStop(0, "#fff27a");
  grad.addColorStop(0.5, "#ffa21a");
  grad.addColorStop(1, "#ff4a10");
  g.fillStyle = grad;
  g.fillText(word, 128, 62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  add: ParticlePool;
  smoke: ParticlePool;
  private rings: Ring[] = [];
  private booms: Boom[] = [];
  private boomTex: THREE.Texture[] = [];
  private debris: Debris[] = [];
  private debrisCursor = 0;
  private lights: FlashLight[] = [];
  private ringGeo = new THREE.RingGeometry(0.82, 1, 40);
  private debrisGeo = new THREE.BoxGeometry(0.45, 0.3, 0.45);
  private scene: THREE.Scene;
  density: number;

  constructor(scene: THREE.Scene, density: number) {
    this.scene = scene;
    this.density = density;
    this.add = new ParticlePool(1800, true);
    this.smoke = new ParticlePool(900, false);
    scene.add(this.smoke.points);
    scene.add(this.add.points);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.rings.push({ mesh, mat, t: 1, dur: 1, r: 1 });
    }
    BOOM_WORDS.forEach((w) => this.boomTex.push(boomTexture(w)));
    for (let i = 0; i < 4; i++) {
      const sm = new THREE.SpriteMaterial({ map: this.boomTex[0], transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
      const sprite = new THREE.Sprite(sm);
      sprite.visible = false;
      sprite.renderOrder = 10;
      scene.add(sprite);
      this.booms.push({ sprite, t: 1, dur: 1, base: 1 });
    }
    for (let i = 0; i < 48; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true, roughness: 0.7 });
      const mesh = new THREE.Mesh(this.debrisGeo, mat);
      mesh.visible = false;
      mesh.castShadow = false;
      scene.add(mesh);
      this.debris.push({ mesh, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, max: 1 });
    }
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xff9a40, 0, 40, 1.6);
      scene.add(light);
      this.lights.push({ light, t: 1, dur: 1, peak: 0 });
    }
  }

  setScale(v: number) {
    this.add.setScale(v);
    this.smoke.setScale(v);
  }

  ring(x: number, y: number, z: number, r: number, color: number, dur = 0.55) {
    const ring = this.rings.find((q) => q.t >= 1) ?? this.rings[0];
    ring.t = 0;
    ring.dur = dur;
    ring.r = r;
    ring.mat.color.set(color);
    ring.mesh.position.set(x, y + 0.15, z);
    ring.mesh.visible = true;
  }

  boom(x: number, y: number, z: number, size = 1) {
    const b = this.booms.find((q) => q.t >= 1) ?? this.booms[0];
    const mat = b.sprite.material;
    mat.map = this.boomTex[(Math.random() * this.boomTex.length) | 0];
    mat.needsUpdate = true;
    b.t = 0;
    b.dur = 0.9;
    b.base = size * 4.4;
    b.sprite.position.set(x, y + 2, z);
    b.sprite.visible = true;
  }

  flash(x: number, y: number, z: number, color: number, peak: number) {
    const f = this.lights.reduce((a, b) => (a.t > b.t ? a : b));
    f.t = 0;
    f.dur = 0.45;
    f.peak = peak;
    f.light.color.set(color);
    f.light.position.set(x, y + 1.5, z);
  }

  chunks(x: number, y: number, z: number, color: number, count: number, speed: number) {
    const n = Math.max(2, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const d = this.debris[this.debrisCursor];
      this.debrisCursor = (this.debrisCursor + 1) % this.debris.length;
      (d.mesh.material as THREE.MeshStandardMaterial).color.set(i % 3 === 0 ? 0x222222 : color);
      d.mesh.position.set(x, y, z);
      d.mesh.scale.setScalar(0.6 + Math.random() * 0.9);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      d.v.set(Math.cos(a) * s, speed * (0.5 + Math.random() * 0.7), Math.sin(a) * s);
      d.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      d.life = d.max = 1.2 + Math.random() * 0.8;
      d.mesh.visible = true;
    }
  }

  /** Full explosion visuals: fireball, smoke, sparks, shockwave, light. */
  explosion(x: number, y: number, z: number, radius: number, big: boolean) {
    const k = this.density;
    const fire = Math.round((big ? 60 : 36) * k);
    for (let i = 0; i < fire; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * 0.9;
      const s = (3 + Math.random() * radius * 1.1) * (big ? 1.2 : 1);
      this.add.emit(x, y + 0.5, z, Math.cos(a) * s, e * s + 2, Math.sin(a) * s, 0.4 + Math.random() * 0.5, 2.6 + Math.random() * 2, 0.4, 0xffe27a, 0xff3a05, 0, 3.2);
    }
    const sm = Math.round((big ? 34 : 20) * k);
    for (let i = 0; i < sm; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * radius * 0.5;
      this.smoke.emit(x, y + 0.8, z, Math.cos(a) * s, 1.5 + Math.random() * 3, Math.sin(a) * s, 1.1 + Math.random() * 1.2, 2.4, 6 + Math.random() * 3, 0x3b3b44, 0x15151a, -0.4, 1.5, 0.75);
    }
    const sp = Math.round((big ? 46 : 28) * k);
    for (let i = 0; i < sp; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 8 + Math.random() * 18;
      this.add.emit(x, y + 0.5, z, Math.cos(a) * s, 5 + Math.random() * 12, Math.sin(a) * s, 0.5 + Math.random() * 0.6, 0.55, 0.1, 0xfff2a0, 0xff8a1a, 28, 0.6);
    }
    this.ring(x, y, z, radius * 1.15, 0xffb050, 0.5);
    if (big) this.ring(x, y, z, radius * 0.7, 0xffffff, 0.35);
    this.flash(x, y, z, 0xff9a40, big ? 90 : 55);
    this.boom(x, y, z, big ? 1.35 : 0.95);
    this.chunks(x, y + 0.6, z, 0x555560, big ? 6 : 3, 9);
  }

  sparks(x: number, y: number, z: number, count: number, c0 = 0xfff2a0, c1 = 0xff8a1a, speed = 8) {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      this.add.emit(x, y, z, Math.cos(a) * s, Math.random() * s, Math.sin(a) * s, 0.25 + Math.random() * 0.3, 0.4, 0.08, c0, c1, 24, 0.5);
    }
  }

  update(dt: number) {
    this.add.update(dt);
    this.smoke.update(dt);
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.dur);
      const e = 1 - Math.pow(1 - r.t, 3);
      r.mesh.scale.setScalar(0.5 + e * r.r);
      r.mat.opacity = (1 - r.t) * 0.9;
      if (r.t >= 1) r.mesh.visible = false;
    }
    for (const b of this.booms) {
      if (b.t >= 1) continue;
      b.t = Math.min(1, b.t + dt / b.dur);
      const pop = b.t < 0.18 ? 0.4 + (b.t / 0.18) * 0.9 : 1.3 - (b.t - 0.18) * 0.3;
      const wob = 1 + Math.sin(b.t * 24) * 0.04 * (1 - b.t);
      b.sprite.scale.set(b.base * pop * wob, b.base * 0.5 * pop * wob, 1);
      b.sprite.position.y += dt * 1.8;
      b.sprite.material.opacity = b.t > 0.65 ? 1 - (b.t - 0.65) / 0.35 : 1;
      if (b.t >= 1) b.sprite.visible = false;
    }
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= 28 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.w.x * dt;
      d.mesh.rotation.y += d.w.y * dt;
      d.mesh.rotation.z += d.w.z * dt;
      if (d.mesh.position.y < 0.2) {
        d.mesh.position.y = 0.2;
        d.v.y *= -0.4;
        d.v.x *= 0.7;
        d.v.z *= 0.7;
        d.w.multiplyScalar(0.7);
      }
      if (d.life < 0.3) d.mesh.scale.multiplyScalar(0.9);
      if (d.life <= 0) d.mesh.visible = false;
    }
    for (const f of this.lights) {
      if (f.t >= 1) {
        f.light.intensity = 0;
        continue;
      }
      f.t = Math.min(1, f.t + dt / f.dur);
      f.light.intensity = f.peak * (1 - f.t) * (1 - f.t);
    }
  }

  dispose() {
    this.add.dispose();
    this.smoke.dispose();
    this.ringGeo.dispose();
    this.debrisGeo.dispose();
    this.rings.forEach((r) => r.mat.dispose());
    this.booms.forEach((b) => b.sprite.material.dispose());
    this.boomTex.forEach((t) => t.dispose());
    this.debris.forEach((d) => (d.mesh.material as THREE.Material).dispose());
    this.lights.forEach((l) => l.light.dispose());
  }
}
