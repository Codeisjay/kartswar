import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createPickupMesh, disposeScene, surfaceHeight, type Arena, type Circle, type PickupZone } from "./arena";
import { buildMap, mapDef } from "./maps";
import { RoomNet, type KartState, type NetEvent, type NetPlayer, type NetRoom } from "./net";
import { mulberry32 } from "./maps/common";

const iconMats = new Map<string, THREE.SpriteMaterial>();
function weaponIconMat(icon: string): THREE.SpriteMaterial {
  let m = iconMats.get(icon);
  if (!m) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.font = "96px serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "#000";
    g.shadowBlur = 10;
    g.fillText(icon, 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false });
    iconMats.set(icon, m);
  }

  return m;
}
import { buildKart, disposeRig, type KartRig } from "./karts";
import { Effects } from "./effects";
import { audio, type SfxName } from "./audio";
import { newBotState, updateBot, type BotState } from "./ai";
import {
  BOT_NAMES, KART_PRESETS, TEAM_COLORS, WEAPONS, WEAPON_IDS,
  type GameCallbacks, type GameConfig, type HudRow, type HudState, type KartPreset, type MatchResult, type TutorialState,
  type Mode, type ResultRow, type TouchInput, type WeaponId,
} from "./types";

export interface Input {
  throttle: number;
  steer: number;
  drift: boolean;
  boost: boolean;
  fire: boolean;
  aimX: number;
  aimZ: number;
}

export interface Kart {
  id: number;
  name: string;
  avatar: string;
  isPlayer: boolean;
  /** Visible weapon mount. Yaws toward the aim point; the kart heading is untouched. */
  turret: THREE.Group;
  turretBarrel: THREE.Mesh;
  turretTipMat: THREE.MeshBasicMaterial;
  turretKick: number;
  /** Human opponent driven by network state (multiplayer). */
  isRemote: boolean;
  tutorialTarget: boolean;
  remoteId?: string;
  netSamples: NetKartState[];
  spawnSlot: number | null;
  /** seconds spent out of bounds / buried before recovery triggers */
  recoverT: number;
  team: number;
  preset: KartPreset;
  rig: KartRig;
  tag: HTMLDivElement;
  tagBar: HTMLElement;
  x: number; z: number; y: number; vy: number;
  vx: number; vz: number;
  heading: number;
  grounded: boolean;
  slopeVy: number;
  steerCur: number;
  pitch: number;
  roll: number;
  speedF: number;
  stats: { speed: number; handling: number; armor: number };
  hp: number;
  maxHp: number;
  shield: number;
  boostT: number;
  boostMeter: number;
  boosting: boolean;
  drifting: boolean;
  driftDir: number;
  driftT: number;
  driftLevel: number;
  weapon: WeaponId | null;
  ammo: number;
  cooldown: number;
  alive: boolean;
  noRespawn: boolean;
  respawnT: number;
  invuln: number;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
  lastHitBy: number;
  lastHitT: number;
  lastHitWeapon: string;
  input: Input;
  ai: BotState | null;
  trailT: number;
  mgSide: number;
}

/** Latest network snapshot for a remote (human) kart. */
export interface NetKartState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  pitch: number;
  roll: number;
  boosting: boolean;
  drifting: boolean;
  driftDir: number;
  aimX: number;
  aimZ: number;
  weapon: WeaponId | null;
  ammo: number;
  alive: boolean;
  hp: number;
  score: number;
  kills: number;
  deaths: number;
  serverTime: number;
}

export type PickupLoad = WeaponId | "health";
export interface Pickup {
  zone: PickupZone;
  load: PickupLoad;
  mesh: THREE.Group;
  spin: THREE.Object3D;
  icon: THREE.Sprite | null;
  active: boolean;
  respawnT: number;
  appear: number;
}

interface Rocket {
  owner: Kart; mesh: THREE.Object3D; x: number; y: number; z: number; dir: number; speed: number; life: number; age: number; target: Kart | null; trailT: number;
}
interface Bullet {
  owner: Kart; mesh: THREE.Mesh; x: number; y: number; z: number; dx: number; dz: number; life: number;
}
interface Bomb {
  owner: Kart; mesh: THREE.Group; marker: THREE.Mesh; sx: number; sy: number; sz: number; tx: number; ty: number; tz: number; t: number; T: number; trailT: number;
}
interface Mine {
  owner: Kart; mesh: THREE.Group; light: THREE.Mesh; x: number; y: number; z: number; arm: number; life: number; fuse: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

const KART_R = 1.25;
const INTRO_TIME = 3.5;

const bulletGeo = new THREE.BoxGeometry(0.14, 0.14, 1.8);
const bulletMats = [new THREE.MeshBasicMaterial({ color: 0xffe14d }), new THREE.MeshBasicMaterial({ color: 0x6fd8ff }), new THREE.MeshBasicMaterial({ color: 0xff7a7a })];

// Weapon mount shared assets. The mount rides on the kart body and yaws toward
// the aim point so the firing direction is visible (drive direction is separate).
const TURRET_MOUNT_Y = 0.9;
const TURRET_MOUNT_Z = 0.55;
const TURRET_BARREL_LEN = 1.35;
const turretBaseGeo = new THREE.CylinderGeometry(0.22, 0.3, 0.22, 10);
const turretBarrelGeo = new THREE.BoxGeometry(0.2, 0.2, 1.3);
const turretTipGeo = new THREE.BoxGeometry(0.26, 0.26, 0.22);
const turretDarkMat = new THREE.MeshStandardMaterial({ color: 0x1c1f2a, roughness: 0.5, metalness: 0.6, flatShading: true });
const turretMetalMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b5, roughness: 0.3, metalness: 0.8, flatShading: true });

function buildTurret(): { group: THREE.Group; barrel: THREE.Mesh; tipMat: THREE.MeshBasicMaterial } {
  const group = new THREE.Group();
  group.position.set(0, TURRET_MOUNT_Y, TURRET_MOUNT_Z);
  const base = new THREE.Mesh(turretBaseGeo, turretDarkMat);
  base.castShadow = true;
  group.add(base);
  const barrel = new THREE.Mesh(turretBarrelGeo, turretMetalMat);
  barrel.position.set(0, 0.12, 0.65);
  barrel.castShadow = true;
  group.add(barrel);
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
  const tip = new THREE.Mesh(turretTipGeo, tipMat);
  tip.position.set(0, 0.12, TURRET_BARREL_LEN);
  group.add(tip);
  return { group, barrel, tipMat };
}

/** Normalized firing direction from a kart toward its aim point. Falls back to kart heading. */
function kartAim(k: Pick<Kart, "x" | "z" | "heading" | "input">): { dx: number; dz: number; dir: number; len: number } {
  const dx = k.input.aimX - k.x;
  const dz = k.input.aimZ - k.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.6) return { dx: Math.sin(k.heading), dz: Math.cos(k.heading), dir: k.heading, len: 0 };
  return { dx: dx / len, dz: dz / len, dir: Math.atan2(dx, dz), len };
}

function rocketProto(): THREE.Group {
  const g = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x4fbf2a, roughness: 0.5, flatShading: true });
  const red = new THREE.MeshStandardMaterial({ color: 0xd9341f, roughness: 0.5, flatShading: true });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.5, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.5, 10), green);
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 10), red);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.05;
  g.add(body, nose);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.4), yellow);
    fin.position.z = -0.65;
    const holder = new THREE.Group();
    holder.rotation.z = (i * Math.PI) / 2;
    fin.position.y = 0.3;
    holder.add(fin);
    g.add(holder);
  }
  return g;
}

export class Game {
  readonly cfg: GameConfig;
  private cb: GameCallbacks;
  private container: HTMLElement;
  private overlay: HTMLElement;
  private minimap: HTMLCanvasElement | null;
  private mm: CanvasRenderingContext2D | null;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private useBloom = false;
  private level: "low" | "medium" | "high" = "high";
  private sun: THREE.DirectionalLight;
  arena: Arena;
  private fx: Effects;
  karts: Kart[] = [];
  private retired: ResultRow[] = [];
  player!: Kart;
  pickups: Pickup[] = [];
  rockets: Rocket[] = [];
  private bullets: Bullet[] = [];
  private bombs: Bomb[] = [];
  mines: Mine[] = [];
  private rocketProtoMesh = rocketProto();
  private reticle: THREE.Group;
  private reticleMat: THREE.MeshBasicMaterial;
  private aimLine: THREE.Line;

  mode: Mode;
  time = 0;
  phase: "intro" | "playing" | "ended" = "intro";
  private introT = INTRO_TIME;
  private lastCount = 99;
  private goT = 0;
  private timeLeft: number;
  private elapsed = 0;
  private endDelay = -1;
  private endPending = -1;
  private result: MatchResult | null = null;
  teamScores: [number, number] = [0, 0];
  private lives = 3;
  private wave = 0;
  private waveState: "between" | "fighting" = "between";
  private waveTimer = 2.5;
  private nextId = 1;
  private killSeq = 1;

  private paused = false;
  private raf = 0;
  private lastT = 0;
  private hudT = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 60;
  private fpsAvgT = 0;
  private fpsAvgN = 0;
  private disposed = false;

  // input
  private keys = new Set<string>();
  private touch: TouchInput | null = null;
  private tmpV = new THREE.Vector3();
  private tutorialTarget: Kart | null = null;
  private tutorialTargetPosition: { x: number; z: number } | null = null;
  private tutorialDistance = 0;
  private tutorialStepIndex = 0;
  private tutorialStepDistance = 0;
  private tutorialLastPosition: { x: number; z: number } | null = null;
  private tutorialFireCount = 0;
  private tutorialStepFireCount = 0;
  private tutorialPickupCount = 0;
  private tutorialStepPickupCount = 0;
  private tutorialTargetHits = 0;
  private tutorialStepTargetHits = 0;
  private tutorialSteeredLeft = false;
  private tutorialSteeredRight = false;
  private tutorialReversed = false;
  private tutorialBoosted = false;

  // camera
  private camHeading = 0;
  private camInit = false;
  private camOrbit = 0;
  private trauma = 0;
  private fov = 68;
  private deathPos = new THREE.Vector3();
  private camPos = new THREE.Vector3();

  constructor(container: HTMLElement, overlay: HTMLElement, minimap: HTMLCanvasElement | null, cfg: GameConfig, cb: GameCallbacks) {
    this.cfg = cfg;
    this.cb = cb;
    this.netMatchSeed = cfg.seed;
    this.container = container;
    this.overlay = overlay;
    this.minimap = minimap;
    this.mm = minimap ? minimap.getContext("2d") : null;
    this.mode = cfg.mode;
    this.tutorialStepIndex = cfg.tutorialStep ?? 0;
    this.timeLeft = cfg.settings.matchMinutes * 60;
    const q = cfg.settings.quality;
    this.level = q === "auto" ? (cfg.touch ? "low" : "high") : q;

    this.renderer = new THREE.WebGLRenderer({ antialias: this.level !== "low", powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";

    let seed = (cfg.seed ?? 0) >>> 0;
    if (!seed) {
      seed = (Math.random() * 0xffffffff) >>> 0;
      if (!seed) seed = 1;
    }
    this.rng = mulberry32(seed);

    const map = mapDef(cfg.mapId);
    this.scene.background = new THREE.Color(map.env.bg);
    this.scene.fog = new THREE.Fog(map.env.fog[0], map.env.fog[1], map.env.fog[2]);
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.5, 900);

    const hemi = new THREE.HemisphereLight(map.env.hemiSky, map.env.hemiGround, map.env.hemi);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(map.env.sun, map.env.sunIntensity);
    this.sun.position.set(30, 55, 20);
    this.sun.castShadow = this.level !== "low";
    const sh = this.sun.shadow;
    sh.mapSize.set(this.level === "high" ? 2048 : 1024, this.level === "high" ? 2048 : 1024);
    sh.camera.left = -38;
    sh.camera.right = 38;
    sh.camera.top = 38;
    sh.camera.bottom = -38;
    sh.camera.near = 5;
    sh.camera.far = 140;
    sh.bias = -0.0004;
    sh.normalBias = 0.06;
    this.scene.add(this.sun, this.sun.target);

    this.arena = buildMap(cfg.mapId, this.scene, this.level);
    this.renderer.toneMappingExposure = map.env.exposure ?? 1.1;
    this.fx = new Effects(this.scene, this.level === "low" ? 0.5 : this.level === "medium" ? 0.8 : 1);

    // randomized pickups: random subset of zones, random weapon per box
    this.setupPickups();

    // aim reticle
    this.reticleMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });
    this.reticle = new THREE.Group();
    const rr = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 32), this.reticleMat);
    rr.rotation.x = -Math.PI / 2;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), this.reticleMat);
    dot.rotation.x = -Math.PI / 2;
    this.reticle.add(rr, dot);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.55), this.reticleMat);
      tick.rotation.x = -Math.PI / 2;
      tick.rotation.z = (i * Math.PI) / 2;
      tick.position.set(Math.sin((i * Math.PI) / 2) * 1.5, 0, Math.cos((i * Math.PI) / 2) * 1.5);
      tick.rotation.set(-Math.PI / 2, 0, -(i * Math.PI) / 2);
      this.reticle.add(tick);
    }
    this.reticle.renderOrder = 20;
    this.reticle.traverse((o) => (o.renderOrder = 20));
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.aimLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthTest: false }));
    this.aimLine.frustumCulled = false;
    this.aimLine.visible = false;
    this.scene.add(this.aimLine);

    this.setupKarts();
    this.applyQuality(this.level);
    this.resize();

    // listeners
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("contextmenu", this.onContext);

    audio.init();
    audio.setVolumes(cfg.settings.master, cfg.settings.music, cfg.settings.sfx);
    audio.startEngine();
    audio.startMusic();

    if (cfg.net) {
      this.net = new RoomNet();
      this.net.code = cfg.net.code;
      this.net.playerId = cfg.net.playerId;
      this.net.setServerOffset(cfg.net.serverOffset);
      this.net.cursor = cfg.net.cursor;
      this.introT = cfg.net.startAt ? Math.max(0, (cfg.net.startAt - this.net.serverNow()) / 1_000) : 0;
      const state = cfg.net.initialState;
      if (state && typeof state.x === "number" && typeof state.z === "number") {
        this.player.x = state.x;
        this.player.y = typeof state.y === "number" ? state.y : this.player.y;
        this.player.z = state.z;
        this.player.vx = typeof state.vx === "number" ? state.vx : 0;
        this.player.vz = typeof state.vz === "number" ? state.vz : 0;
        this.player.heading = typeof state.heading === "number" ? state.heading : this.player.heading;
        this.player.hp = typeof state.hp === "number" ? state.hp : this.player.hp;
        this.player.score = typeof state.score === "number" ? state.score : this.player.score;
        this.player.kills = typeof state.kills === "number" ? state.kills : this.player.kills;
        this.player.deaths = typeof state.deaths === "number" ? state.deaths : this.player.deaths;
        this.player.alive = state.alive !== false;
        this.player.rig.group.position.set(this.player.x, this.player.y, this.player.z);
        this.player.rig.group.visible = this.player.alive;
      }
    }
    this.camHeading = this.player.heading;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ setup
  private setupKarts() {
    const cfg = this.cfg;
    const roster = cfg.roster.slice(0, 7);
    const mode = cfg.mode;
    const spawnOrder = this.shuffle([...this.arena.spawns.keys()]);
    const playerTeam = mode === "team" ? (cfg.net ? cfg.net.slot % 2 : 0) : mode === "survival" ? 0 : -1;
    const p = this.makeKart({ name: cfg.profile.name || "Driver", avatar: cfg.profile.avatar, preset: KART_PRESETS[cfg.profile.kartId] ?? KART_PRESETS[0], glow: cfg.profile.glow, isPlayer: true, team: playerTeam, skill: 1, spawnSlot: cfg.net?.slot ?? null });
    this.player = p;
    this.placeKart(p, cfg.net ? cfg.net.slot : spawnOrder[0]);
    if (mode === "survival") {
      this.lives = 3;
      return;
    }
    // real players connected over a room
    const remotes = (cfg.remotes ?? []).slice(0, 7).map((r) => {
      const kart = this.makeKart({
        name: r.name,
        avatar: r.avatar,
        preset: KART_PRESETS[r.kartId % KART_PRESETS.length],
        isPlayer: false,
        team: mode === "team" ? r.team : -1,
        skill: 1,
        remoteId: r.id,
        spawnSlot: r.slot,
        glow: 0x35e8ff,
      });
      if (r.state) this.seedRemote(kart, r.state, r.updatedAt);
      return kart;
    });
    const aiCount = Math.max(0, Math.min(7 - remotes.length, roster.length));
    const team0Bots = Math.max(0, Math.ceil((remotes.length + aiCount + 1) / 2) - 1 - remotes.filter((k) => k.team === 0).length);
    const bots = roster.slice(0, aiCount).map((r, i) => {
      const skill = cfg.settings.difficulty === "easy" ? 0.3 : cfg.settings.difficulty === "hard" ? 0.75 : 0.5;
      const team = mode === "team" ? (r.slot === undefined ? (i < team0Bots ? 0 : 1) : r.slot % 2) : -1;
      return this.makeKart({ name: r.name, avatar: r.avatar, preset: KART_PRESETS[r.kartId % KART_PRESETS.length], isPlayer: false, team, skill: clamp(skill + (this.rng() - 0.5) * 0.18, 0.2, 1), spawnSlot: r.slot ?? null });
    });
    const everyone = [...remotes, ...bots];
    // team battle: interleave teams across spawn slots so neither side clusters
    const ordered = mode === "team"
      ? [...this.interleave(everyone.filter((k) => k.team === 0), everyone.filter((k) => k.team === 1))]
      : everyone;
    if (cfg.net) {
      const occupied = new Set([cfg.net.slot]);
      for (const k of ordered) {
        let slot = k.spawnSlot;
        if (slot === null || slot === undefined) {
          slot = 0;
          while (occupied.has(slot)) slot++;
        }
        occupied.add(slot);
        this.placeKart(k, slot);
      }
    } else {
      ordered.forEach((k, i) => {
        this.placeKart(k, spawnOrder[(i + 1) % spawnOrder.length]);
      });
    }
    if (cfg.tutorial) this.setupTutorialPractice(spawnOrder);
  }

  private setupTutorialPractice(spawnOrder: number[]) {
    const p = this.player;
    const target = this.makeKart({
      name: "Practice Target",
      avatar: "◎",
      preset: KART_PRESETS[0],
      isPlayer: false,
      team: -1,
      skill: 0,
      enemyGlow: true,
      tutorialTarget: true,
    });
    this.placeKart(target, spawnOrder[1] ?? 0);
    const x = clamp(p.x + Math.sin(p.heading) * 32, -this.boundX() + 6, this.boundX() - 6);
    const z = clamp(p.z + Math.cos(p.heading) * 32, -this.boundZ() + 6, this.boundZ() - 6);
    target.x = x;
    target.z = z;
    target.y = this.arena.groundAt(x, z, p.y);
    target.heading = p.heading + Math.PI;
    target.vx = 0;
    target.vz = 0;
    target.invuln = 0;
    target.weapon = null;
    target.ammo = 0;
    target.rig.group.position.set(x, target.y, z);
    target.tag.dataset.trainingTarget = "true";
    this.tutorialTarget = target;
    this.tutorialTargetPosition = { x, z };
    this.tutorialLastPosition = { x: p.x, z: p.z };

    const pickups = this.pickups
      .filter((item) => item.active && item.load !== "health")
      .sort((a, b) => Math.hypot(a.zone.x - p.x, a.zone.z - p.z) - Math.hypot(b.zone.x - p.x, b.zone.z - p.z));
    const pickup = pickups[0];
    for (const other of pickups.slice(1)) {
      other.active = false;
      other.mesh.visible = false;
      other.respawnT = Number.POSITIVE_INFINITY;
    }
    if (pickup) this.relocPickup(pickup, pickup.zone, "shield");
    else {
      const zone = this.weaponZones[0];
      if (zone) this.placePickup(zone, "shield");
    }
  }

  private *interleave<T>(a: T[], b: T[]): Generator<T> {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i < a.length) yield a[i];
      if (i < b.length) yield b[i];
    }
  }

  private makeKart(o: { name: string; avatar: string; preset: KartPreset; glow?: number; isPlayer: boolean; team: number; skill: number; enemyGlow?: boolean; remoteId?: string; tutorialTarget?: boolean; spawnSlot?: number | null }): Kart {
    const teamColor = o.team >= 0 && this.mode === "team" ? TEAM_COLORS[o.team] : undefined;
    const rig = buildKart(o.preset, {
      primary: teamColor,
      glow: teamColor ?? (o.enemyGlow ? 0xff3a4a : o.glow),
      helmet: o.isPlayer ? 0xffffff : [0xf2f2f2, 0xffd21f, 0x35f0ff, 0xff8aa8, 0x9dff3a][Math.floor(Math.random() * 5)],
    });
    this.scene.add(rig.group);
    rig.group.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) m.receiveShadow = false;
    });
    const turret = buildTurret();
    turret.group.visible = false;
    rig.group.add(turret.group);
    const tag = document.createElement("div");
    tag.className = "kw-tag";
    const nm = document.createElement("div");
    nm.className = "kw-tag-name";
    nm.textContent = `${o.avatar} ${o.name}`;
    const bar = document.createElement("div");
    bar.className = "kw-tag-bar";
    const fill = document.createElement("i");
    bar.appendChild(fill);
    tag.append(nm, bar);
    if (o.team >= 0 && this.mode === "team") tag.dataset.team = String(o.team);
    else if (!o.isPlayer) tag.dataset.team = "enemy";
    if (o.isPlayer) tag.style.display = "none";
    this.overlay.appendChild(tag);
    const k: Kart = {
      id: this.nextId++, name: o.name, avatar: o.avatar, isPlayer: o.isPlayer, team: o.team, preset: o.preset, rig, tag, tagBar: fill,
      x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0, heading: 0, grounded: true, slopeVy: 0, steerCur: 0, pitch: 0, roll: 0,
      speedF: o.isPlayer || o.remoteId ? 1 : 0.78 + o.skill * 0.12,
      stats: { speed: o.preset.speed, handling: o.preset.handling, armor: o.preset.armor },
      hp: 100, maxHp: 100, shield: 0, boostT: 0, boostMeter: 0.5, boosting: false, drifting: false, driftDir: 1, driftT: 0, driftLevel: 0,
      weapon: null, ammo: 0, cooldown: 0, alive: false, noRespawn: false, respawnT: 0, invuln: 0,
      kills: 0, deaths: 0, score: 0, streak: 0, lastHitBy: -1, lastHitT: -99, lastHitWeapon: "",
      input: { throttle: 0, steer: 0, drift: false, boost: false, fire: false, aimX: 0, aimZ: 0 },
      ai: o.isPlayer || o.remoteId || o.tutorialTarget ? null : newBotState(o.skill),
      trailT: 0, mgSide: 1,
      turret: turret.group, turretBarrel: turret.barrel, turretTipMat: turret.tipMat, turretKick: 0,
      isRemote: !!o.remoteId, remoteId: o.remoteId, netSamples: [], spawnSlot: o.spawnSlot ?? null, recoverT: 0,
      tutorialTarget: !!o.tutorialTarget,
    };
    this.karts.push(k);
    return k;
  }

  private placeKart(k: Kart, spawnIdx: number, sound = false) {
    const s = this.arena.spawns[spawnIdx % this.arena.spawns.length];
    k.x = s.x;
    k.z = s.z;
    k.y = 0;
    k.vy = 0;
    k.vx = k.vz = 0;
    k.heading = s.heading;
    k.grounded = true;
    k.hp = k.maxHp;
    k.shield = 0;
    k.boostT = 0;
    k.boostMeter = Math.max(k.boostMeter, 0.4);
    k.drifting = false;
    k.driftT = 0;
    k.steerCur = 0;
    k.weapon = "mg";
    k.ammo = 30;
    k.cooldown = 0;
    k.alive = true;
    k.invuln = sound ? 2.5 : 0.5;
    k.rig.group.visible = true;
    k.rig.group.position.set(k.x, 0, k.z);
    // Fresh aim + turret state so firing works immediately after (re)spawning.
    k.input.aimX = k.x + Math.sin(k.heading) * 30;
    k.input.aimZ = k.z + Math.cos(k.heading) * 30;
    k.turretKick = 0;
    k.turret.rotation.y = 0;
    if (!k.isPlayer) k.tag.style.display = "";
    if (sound) {
      this.fx.ring(k.x, 0, k.z, 6, k.rig.ringMat.color.getHex(), 0.6);
      this.fx.sparks(k.x, 1, k.z, 24, 0xffffff, 0x35e8ff, 12);
      this.sfxAt("respawn", k.x, k.z, 0.8);
    }
  }

  private seedRemote(k: Kart, state: Record<string, unknown>, serverTime?: number) {
      if (typeof state.x !== "number" || typeof state.z !== "number") return;
      const sample: NetKartState = {
        x: state.x,
        y: typeof state.y === "number" ? state.y : 0,
        z: state.z,
        vx: typeof state.vx === "number" ? state.vx : 0,
        vz: typeof state.vz === "number" ? state.vz : 0,
        heading: typeof state.heading === "number" ? state.heading : k.heading,
        pitch: typeof state.pitch === "number" ? state.pitch : 0,
        roll: typeof state.roll === "number" ? state.roll : 0,
        boosting: state.boosting === true,
        drifting: state.drifting === true,
        driftDir: typeof state.driftDir === "number" ? state.driftDir : 1,
        aimX: typeof state.aimX === "number" ? state.aimX : state.x,
        aimZ: typeof state.aimZ === "number" ? state.aimZ : state.z,
        weapon: typeof state.weapon === "string" && WEAPON_IDS.includes(state.weapon as WeaponId) ? state.weapon as WeaponId : null,
        ammo: typeof state.ammo === "number" ? state.ammo : 0,
        alive: state.alive !== false,
        hp: typeof state.hp === "number" ? state.hp : 100,
        score: typeof state.score === "number" ? state.score : 0,
        kills: typeof state.kills === "number" ? state.kills : 0,
        deaths: typeof state.deaths === "number" ? state.deaths : 0,
        serverTime: serverTime ?? this.net?.serverNow() ?? Date.now(),
      };
      k.netSamples.push(sample);
      k.x = sample.x;
      k.y = sample.y;
      k.z = sample.z;
      k.vx = sample.vx;
      k.vz = sample.vz;
      k.heading = sample.heading;
      k.alive = sample.alive;
      k.hp = sample.hp;
      k.score = sample.score;
      k.kills = sample.kills;
      k.deaths = sample.deaths;
      k.rig.group.position.set(k.x, k.y, k.z);
      k.rig.group.visible = k.alive;
      k.tag.style.display = k.alive ? "" : "none";
  }

  private pickSpawn(k: Kart): number {
    const scored = this.arena.spawns.map((s, i) => {
      let md = 999;
      for (const o of this.karts) if (o !== k && o.alive) md = Math.min(md, Math.hypot(o.x - s.x, o.z - s.z));
      return { i, d: md + Math.random() * 12 };
    });
    scored.sort((a, b) => b.d - a.d);
    return scored[0].i;
  }

  // ------------------------------------------------------------------ public API
  setTouch(t: TouchInput | null) {
    this.touch = t;
  }
  setTutorialStep(step: number) {
    if (!this.cfg.tutorial || step === this.tutorialStepIndex) return;
    this.tutorialStepIndex = step;
    this.tutorialStepDistance = 0;
    this.tutorialStepFireCount = 0;
    this.tutorialStepPickupCount = 0;
    this.tutorialStepTargetHits = 0;
    this.tutorialSteeredLeft = false;
    this.tutorialSteeredRight = false;
    this.tutorialReversed = false;
    this.tutorialBoosted = false;
  }
  setPaused(p: boolean) {
    this.paused = p;
    if (p) {
      audio.suspend();
      audio.setEngine(0, false, 0, false);
    } else {
      audio.resume();
      this.lastT = performance.now();
    }
  }
  isPaused() {
    return this.paused;
  }
  updateAudioSettings() {
    audio.setVolumes(this.cfg.settings.master, this.cfg.settings.music, this.cfg.settings.sfx);
  }
  setMasterVolume(volume: number) {
    audio.setVolumes(volume, this.cfg.settings.music, this.cfg.settings.sfx);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("contextmenu", this.onContext);
    if (this.netRestartTimer !== null) window.clearTimeout(this.netRestartTimer);
    this.net = null;
    audio.stopEngine();
    audio.stopMusic();
    audio.resume();
    this.karts.forEach((k) => {
      disposeRig(k.rig);
      k.turretTipMat.dispose();
      k.tag.remove();
    });
    this.fx.dispose();
    this.arena.dispose?.();
    disposeScene(this.scene);
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------------ input
  private onKeyDown = (e: KeyboardEvent) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    audio.init();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onBlur = () => {
    this.keys.clear();
  };
  private onContext = (e: Event) => e.preventDefault();

  private resize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.bloom?.resolution.set(w / 2, h / 2);
  };

  private applyQuality(level: "low" | "medium" | "high") {
    this.level = level;
    const pr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(level === "high" ? Math.min(pr, 2) : level === "medium" ? Math.min(pr, 1.5) : Math.min(pr, 1));
    this.sun.castShadow = level !== "low";
    this.fx.density = level === "low" ? 0.5 : level === "medium" ? 0.8 : 1;
    this.useBloom = level === "high";
    if (this.useBloom && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.42, 0.55, 0.78);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  // ---- input: drive, aim and fire are sampled independently so the kart can
  // drive one way while the weapon aims (and fires) another way.
  private sampleDrive() {
    const k = this.keys;
    let throttle = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    let steer = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let drift = k.has("Space");
    let boost = k.has("ShiftLeft") || k.has("ShiftRight");
    if (this.touch) {
      steer = this.touch.steer || steer;
      throttle = this.touch.throttle !== 0 ? this.touch.throttle : throttle;
      drift = drift || this.touch.drift;
      boost = boost || this.touch.boost;
    }
    return { throttle, steer, drift, boost };
  }

  // F key fires on desktop (touch uses its own FIRE button). No mouse input
  // is used at all: driving, drifting, boosting and firing are keyboard-only.
  private sampleFire() {
    if (this.touch) return this.touch.fire;
    return this.keys.has("KeyF");
  }

  private buildTutorialState(): TutorialState {
    const p = this.player;
    const target = this.tutorialTarget;
    const targetDx = target ? target.x - p.x : 0;
    const targetDz = target ? target.z - p.z : 0;
    const targetDistance = Math.hypot(targetDx, targetDz);
    const facingDot = targetDistance > 0
      ? (targetDx * Math.sin(p.heading) + targetDz * Math.cos(p.heading)) / targetDistance
      : -1;
    const pickup = this.pickups
      .filter((item) => item.active && item.load !== "health")
      .map((item) => ({ item, distance: Math.hypot(item.zone.x - p.x, item.zone.z - p.z) }))
      .sort((a, b) => a.distance - b.distance)[0];
    let pickupBearing: number | null = null;
    if (pickup) {
      const dx = pickup.item.zone.x - p.x;
      const dz = pickup.item.zone.z - p.z;
      let angle = Math.atan2(dx, dz) - p.heading;
      while (angle > Math.PI) angle -= Math.PI * 2;
      while (angle < -Math.PI) angle += Math.PI * 2;
      pickupBearing = (angle * 180) / Math.PI;
    }
    let targetBearing: number | null = null;
    if (target) {
      let angle = Math.atan2(targetDx, targetDz) - p.heading;
      while (angle > Math.PI) angle -= Math.PI * 2;
      while (angle < -Math.PI) angle += Math.PI * 2;
      targetBearing = (angle * 180) / Math.PI;
    }
    return {
      throttle: p.input.throttle,
      steer: p.input.steer,
      speed: Math.hypot(p.vx, p.vz) * 4,
      steeredLeft: this.tutorialSteeredLeft,
      steeredRight: this.tutorialSteeredRight,
      reversed: this.tutorialReversed,
      boosting: this.tutorialBoosted,
      distance: this.tutorialStepDistance,
      fireCount: this.tutorialStepFireCount,
      pickupCount: this.tutorialStepPickupCount,
      targetHits: this.tutorialStepTargetHits,
      targetInRange: !!target?.alive && targetDistance > 3 && targetDistance <= 75 && facingDot > Math.cos(0.7),
      targetBearing,
      weapon: p.weapon,
      ammo: p.ammo,
      shield: p.shield,
      pickupBearing,
      pickupDistance: pickup?.distance ?? null,
    };
  }

  // Fixed forward firing: weapons always shoot straight out of the front of
  // the kart, along its current heading. No cursor targeting, no auto-aim —
  // point the kart at the enemy and pull the trigger.
  private updateAim() {
    const p = this.player;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    p.input.aimX = p.x + fx * 30;
    p.input.aimZ = p.z + fz * 30;
  }

  private updatePlayerInput() {
    const p = this.player;
    const d = this.sampleDrive();
    const inp = p.input;
    const active = this.phase === "playing";
    inp.throttle = active ? d.throttle : 0;
    inp.steer = active ? d.steer : 0;
    inp.drift = active && d.drift;
    inp.boost = active && d.boost;
    inp.fire = active && this.sampleFire();
    // Aim is locked to the kart's nose: weapons fire straight ahead.
    if (p.alive || this.phase !== "ended") this.updateAim();
  }

  // ------------------------------------------------------------------ helpers
  isEnemy(a: Kart, b: Kart) {
    return a !== b && (a.team < 0 || b.team < 0 || a.team !== b.team);
  }

  /**
   * Multiplayer seam: plain-data snapshot of every kart's firing state.
   * A network transport can broadcast this (or the underlying per-kart inputs)
   * so remote peers reproduce turret yaw, muzzle flashes, projectile spawns,
   * explosions and hit effects from the same deterministic simulation step.
   */
  netState() {
    return {
      t: this.time,
      karts: this.karts.map((k) => ({
        id: k.id, x: k.x, y: k.y, z: k.z, heading: k.heading,
        aimX: k.input.aimX, aimZ: k.input.aimZ, firing: k.input.fire,
        weapon: k.weapon, ammo: k.ammo, alive: k.alive, hp: k.hp,
      })),
      projectiles: { rockets: this.rockets.length, bullets: this.bullets.length, bombs: this.bombs.length, mines: this.mines.length },
    };
  }

  private kartById(id: number) {
    return this.karts.find((k) => k.id === id) ?? null;
  }

  private sfxAt(name: SfxName, x: number, z: number, vol = 1) {
    const d = Math.hypot(x - this.player.x, z - this.player.z);
    audio.sfx(name, vol * clamp(1.15 - d / 100, 0.12, 1));
  }

  private shake(amount: number, x?: number, z?: number) {
    if (!this.cfg.settings.shake) return;
    let a = amount;
    if (x !== undefined && z !== undefined) a *= clamp(1.1 - Math.hypot(x - this.player.x, z - this.player.z) / 55, 0, 1);
    this.trauma = Math.min(1, this.trauma + a);
  }

  /** Match RNG (seeded when a seed is configured, random otherwise). */
  private rng: () => number = Math.random;
  /** Real multiplayer room connection (null when playing offline / vs AI). */
  net: RoomNet | null = null;
  private netAcc = 0;
  private netFails = 0;
  private netInFlight = false;
  private netMatchSeed: number;
  private netRestartTimer: number | null = null;
  private networkPlayers: NetPlayer[] = [];
  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** Playable half-extents (rectangular arenas supported). */
  boundX() {
    return this.arena.hx ?? this.arena.half;
  }
  boundZ() {
    return this.arena.hz ?? this.arena.half;
  }
  probeBlocked(x: number, z: number, y: number) {
    if (Math.abs(x) > this.boundX() - 2.6 || Math.abs(z) > this.boundZ() - 2.6) return true;
    for (const s of this.arena.surfaces) {
      if (x < s.x0 - 1.3 || x > s.x1 + 1.3 || z < s.z0 - 1.3 || z > s.z1 + 1.3) continue;
      const cx = clamp(x, s.x0, s.x1);
      const cz = clamp(z, s.z0, s.z1);
      if (surfaceHeight(s, cx, cz) > y + 0.6) return true;
    }
    for (const c of this.arena.circles) {
      if (!c.alive || c.top < y + 0.3) continue;
      if (c.kind === "cone") continue;
      const rr = c.r + 1.5;
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  hasLOS(x0: number, z0: number, x1: number, z1: number, y: number) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.ceil(d / 3));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      if (this.arena.maxHeightAt(x, z) > y + 1.0) return false;
      for (const c of this.arena.circles) {
        if (!c.alive || c.kind === "cone" || c.top < y + 0.5) continue;
        const dx = c.x - x;
        const dz = c.z - z;
        if (dx * dx + dz * dz < (c.r + 0.3) * (c.r + 0.3)) return false;
      }
    }
    return true;
  }

  private project(x: number, y: number, z: number) {
    this.tmpV.set(x, y, z).project(this.camera);
    const w = this.overlay.clientWidth;
    const h = this.overlay.clientHeight;
    return { x: (this.tmpV.x * 0.5 + 0.5) * w, y: (-this.tmpV.y * 0.5 + 0.5) * h, vis: this.tmpV.z < 1 && Math.abs(this.tmpV.x) < 1.3 && Math.abs(this.tmpV.y) < 1.3 };
  }

  private floatText(x: number, y: number, z: number, text: string, cls: string) {
    const p = this.project(x, y, z);
    if (!p.vis) return;
    const el = document.createElement("div");
    el.className = `kw-float ${cls}`;
    el.textContent = text;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.addEventListener("animationend", () => el.remove());
    this.overlay.appendChild(el);
  }

  // ------------------------------------------------------------------ main loop
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (!this.paused) {
      this.step(dt);
      // adaptive quality
      if (this.cfg.settings.quality === "auto" && this.time > 4) {
        this.fpsAvgT += dt;
        this.fpsAvgN++;
        if (this.fpsAvgT > 3) {
          const avg = this.fpsAvgN / this.fpsAvgT;
          if (avg < 40 && this.level !== "low") this.applyQuality(this.level === "high" ? "medium" : "low");
          this.fpsAvgT = 0;
          this.fpsAvgN = 0;
        }
      } else this.netTick(dt);
    }
    this.render(dt);
  };

  private render(dt: number) {
    const hpx = this.renderer.domElement.height;
    this.fx.setScale(hpx / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
    if (this.composer && this.useBloom) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private step(dt: number) {
    this.time += dt;
    this.arena.update(this.time, dt);

    if (this.phase === "intro") {
      this.introT -= dt;
      const c = Math.ceil(this.introT);
      if (c !== this.lastCount && c > 0) {
        this.lastCount = c;
        audio.sfx("beep");
      }
      if (this.introT <= 0) {
        this.phase = "playing";
        this.goT = 0.9;
        audio.sfx("go");
        this.cb.onEvent({ type: "banner", text: "GO!", color: "#6dff6d" });
      }
    } else if (this.phase === "playing") {
      this.elapsed += dt;
      if (this.goT > 0) this.goT -= dt;
    }

    this.updatePlayerInput();
    for (const k of this.karts) {
      if (k.ai) updateBot(this, k, k.ai, dt, this.phase === "playing");
    }
    for (const k of this.karts) {
      if (!k.tutorialTarget) this.updateKart(k, dt);
    }
    if (this.cfg.tutorial && this.tutorialLastPosition) {
      const travelled = Math.hypot(this.player.x - this.tutorialLastPosition.x, this.player.z - this.tutorialLastPosition.z);
      this.tutorialDistance += travelled;
      this.tutorialStepDistance += travelled;
      this.tutorialLastPosition = { x: this.player.x, z: this.player.z };
      this.tutorialSteeredLeft ||= this.player.input.steer < -0.2;
      this.tutorialSteeredRight ||= this.player.input.steer > 0.2;
      this.tutorialReversed ||= this.player.input.throttle < 0;
      this.tutorialBoosted ||= this.player.boosting || this.player.boostT > 0;
    }
    this.kartCollisions();
    if (this.tutorialTarget) {
      if (this.tutorialTargetPosition) {
        this.tutorialTarget.x = this.tutorialTargetPosition.x;
        this.tutorialTarget.z = this.tutorialTargetPosition.z;
      }
      this.tutorialTarget.vx = 0;
      this.tutorialTarget.vz = 0;
      this.tutorialTarget.rig.group.position.set(this.tutorialTarget.x, this.tutorialTarget.y, this.tutorialTarget.z);
    }
    this.updateHazards(dt);
    this.updateRecovery(dt);
    for (const k of this.karts) {
      if (!k.alive) continue;
      if (k.input.fire && k.cooldown <= 0 && this.phase === "playing") this.fireWeapon(k);
    }
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updateCircles();
    this.updateRespawns(dt);
    this.updateModeLogic(dt);
    this.fx.update(dt);
    for (const k of this.karts) {
      this.updateTurret(k, dt);
      this.syncRig(k, dt);
    }
    this.updateCamera(dt);
    this.updateTags();
    this.updateReticle();
    this.updateAudio();
    this.drawMinimap();

    this.netTick(dt);
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.066;
      this.cb.onHud(this.buildHud());
      if (this.cfg.tutorial) this.cb.onTutorialState?.(this.buildTutorialState());
    }

    if (this.endPending > 0) {
      this.endPending -= dt;
      if (this.endPending <= 0) this.endMatch();
    }
    if (this.endDelay > 0) {
      this.endDelay -= dt;
      if (this.endDelay <= 0 && this.result) {
        this.endDelay = -1;
        this.cb.onEnd(this.result);
      }
    }
  }

  // ------------------------------------------------------------------ kart physics
  private updateKart(k: Kart, dt: number) {
    if (k.isRemote) {
      this.updateRemote(k, dt);
      return;
    }
    if (!k.alive) return;
    const inp = k.input;
    k.cooldown = Math.max(0, k.cooldown - dt);
    k.invuln = Math.max(0, k.invuln - dt);
    k.shield = Math.max(0, k.shield - dt);
    const sp = k.speedF * k.stats.speed;

    let boosting = false;
    if (k.boostT > 0) {
      k.boostT -= dt;
      boosting = true;
    } else if (inp.boost && k.boostMeter > 0.03) {
      k.boostMeter = Math.max(0, k.boostMeter - dt * 0.42);
      boosting = true;
    }
    if (!boosting) k.boostMeter = Math.min(1, k.boostMeter + dt * 0.06);
    if (boosting && !k.boosting && k.boostT <= 0 && k.isPlayer) audio.sfx("boost", 0.6);
    k.boosting = boosting;
    const maxV = (boosting ? 44 : 27) * sp;

    let fx = Math.sin(k.heading);
    let fz = Math.cos(k.heading);
    let vf = k.vx * fx + k.vz * fz;
    const grounded = k.grounded;

    // drifting
    if (grounded && inp.drift && !k.drifting && vf > 12 && Math.abs(inp.steer) > 0.25) {
      k.drifting = true;
      k.driftDir = Math.sign(inp.steer);
      k.driftT = 0;
      if (k.isPlayer) audio.sfx("click", 0.7);
    }
    if (k.drifting) {
      k.driftT += dt;
      k.driftLevel = k.driftT > 1.5 ? 2 : k.driftT > 0.7 ? 1 : 0;
      if (!inp.drift || vf < 8) this.releaseDrift(k);
    }

    // steering
    let st = inp.steer;
    if (k.drifting) st = clamp(k.driftDir * 0.75 + inp.steer * 0.5, -1, 1);
    k.steerCur += (st - k.steerCur) * Math.min(1, dt * (Math.abs(st) > Math.abs(k.steerCur) ? 7 : 11));
    const spdF = clamp(Math.abs(vf) / 7, 0, 1) * (1 - 0.32 * clamp(Math.abs(vf) / 44, 0, 1));
    const rate = 2.5 * k.stats.handling * (k.drifting ? 1.3 : 1) * spdF * (vf < 0 ? -1 : 1) * (grounded ? 1 : 0.3);
    k.heading -= k.steerCur * rate * dt;
    fx = Math.sin(k.heading);
    fz = Math.cos(k.heading);
    const rx = -fz;
    const rz = fx;
    vf = k.vx * fx + k.vz * fz;
    let vl = k.vx * rx + k.vz * rz;

    if (grounded) {
      const thr = inp.throttle;
      if (thr > 0.01) {
        if (vf < maxV) vf = Math.min(maxV, vf + (boosting ? 60 : 32) * thr * dt);
      } else if (thr < -0.01) {
        if (vf > 0.5) vf -= 62 * dt;
        else vf = Math.max(-11, vf - 22 * -thr * dt);
      } else {
        vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);
      }
      if (boosting && thr >= 0) vf = Math.min(maxV, vf + 55 * dt);
      if (vf > maxV) vf = Math.max(maxV, vf - 24 * dt);
      vl *= Math.exp(-(k.drifting ? 1.7 : 7.5) * dt);
    } else {
      vl *= Math.exp(-0.2 * dt);
      vf *= Math.exp(-0.04 * dt);
    }
    k.vx = fx * vf + rx * vl;
    k.vz = fz * vf + rz * vl;
    const sp2 = Math.hypot(k.vx, k.vz);
    if (sp2 > 62) {
      k.vx *= 62 / sp2;
      k.vz *= 62 / sp2;
    }

    k.x += k.vx * dt;
    k.z += k.vz * dt;
    this.collideStatic(k);

    // vertical
    const gh = this.arena.groundAt(k.x, k.z, k.y);
    if (k.grounded) {
      if (gh >= k.y - 0.02) {
        k.slopeVy = (gh - k.y) / dt;
        k.y = gh;
      } else if (k.y - gh < 0.3) {
        k.y = gh;
        k.slopeVy = 0;
      } else {
        k.grounded = false;
        k.vy = clamp(k.slopeVy, 0, 14);
      }
    }
    if (!k.grounded) {
      k.vy -= 32 * dt;
      k.y += k.vy * dt;
      if (k.y <= gh) {
        const impact = -k.vy;
        k.y = gh;
        k.vy = 0;
        k.grounded = true;
        if (impact > 6) {
          this.fx.sparks(k.x, k.y + 0.3, k.z, 14, 0xffffff, 0x9aa4c8, 7);
          for (let i = 0; i < 6; i++) this.fx.smoke.emit(k.x + (Math.random() - 0.5) * 2, k.y + 0.3, k.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4, 1, (Math.random() - 0.5) * 4, 0.7, 1, 3, 0x6a6f85, 0x30343f, 0, 2, 0.5);
          this.sfxAt("land", k.x, k.z, clamp(impact / 16, 0.3, 1));
          if (k.isPlayer) this.shake(clamp(impact / 40, 0.1, 0.4));
        }
      }
    }

    // visual tilt targets
    const look = 1.4;
    const gA = this.arena.groundAt(k.x + fx * look, k.z + fz * look, k.y + 0.5);
    const gB = this.arena.groundAt(k.x - fx * look, k.z - fz * look, k.y + 0.5);
    const pitchT = k.grounded ? Math.atan2(gA - gB, look * 2) : clamp(k.vy * 0.03, -0.55, 0.55);
    k.pitch += (pitchT - k.pitch) * Math.min(1, dt * 9);
    const rollT = k.steerCur * clamp(Math.abs(vf) / 30, 0, 1) * 0.16;
    k.roll += (rollT - k.roll) * Math.min(1, dt * 8);

    // effects: exhaust, drift sparks, boost trail
    const rearX = k.x - fx * 1.5;
    const rearZ = k.z - fz * 1.5;
    k.trailT -= dt;
    if (k.trailT <= 0) {
      k.trailT = 0.03;
      if (boosting) {
        this.fx.add.emit(rearX + (Math.random() - 0.5) * 0.4, k.y + 0.6, rearZ + (Math.random() - 0.5) * 0.4, -fx * 6 + (Math.random() - 0.5) * 2, 1 + Math.random(), -fz * 6 + (Math.random() - 0.5) * 2, 0.35, 1.0, 0.1, 0xffe27a, 0xff4a10, 0, 2);
      } else if (grounded && Math.abs(vf) > 5 && Math.random() < 0.4) {
        this.fx.smoke.emit(rearX, k.y + 0.4, rearZ, -fx * 1.5 + (Math.random() - 0.5), 0.6, -fz * 1.5 + (Math.random() - 0.5), 0.5, 0.4, 1.4, 0x7a7f95, 0x3a3e4c, 0, 1, 0.35);
      }
      if (k.drifting && grounded) {
        const col0 = k.driftLevel === 2 ? 0xffb347 : k.driftLevel === 1 ? 0x6fd8ff : 0xffffff;
        const col1 = k.driftLevel === 2 ? 0xff3a05 : k.driftLevel === 1 ? 0x2a6bff : 0xaab4d8;
        for (const sgn of [-1, 1]) {
          this.fx.add.emit(k.x - fx * 1.0 + rx * sgn * 0.95, k.y + 0.15, k.z - fz * 1.0 + rz * sgn * 0.95, -fx * 3 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, -fz * 3 + (Math.random() - 0.5) * 4, 0.3, 0.5, 0.08, col0, col1, 18, 0.5);
        }
      }
      if (k.hp < 35) {
        this.fx.smoke.emit(k.x + (Math.random() - 0.5) * 0.6, k.y + 1.0, k.z + (Math.random() - 0.5) * 0.6, 0, 2.2, 0, 0.8, 0.5, 1.8, 0x33333a, 0x111114, 0, 0.5, 0.6);
        if (k.hp < 20) this.fx.add.emit(k.x, k.y + 1.0, k.z, (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.3, 0.6, 0.1, 0xffc060, 0xff3a05, 0, 1);
      }
    }
  }

  private releaseDrift(k: Kart) {
    if (k.driftLevel >= 1) {
      k.boostT = Math.max(k.boostT, k.driftLevel === 2 ? 1.4 : 0.8);
      this.fx.sparks(k.x, k.y + 0.6, k.z, 20, 0xffffff, k.driftLevel === 2 ? 0xff8a1a : 0x35e8ff, 12);
      if (k.isPlayer) {
        audio.sfx("boost", 0.7);
        this.shake(0.12);
      }
    }
    k.drifting = false;
    k.driftT = 0;
    k.driftLevel = 0;
  }

  private impact(k: Kart, spd: number, x: number, z: number) {
    if (spd < 7) return;
    this.fx.sparks(x, k.y + 0.6, z, Math.min(24, spd), 0xfff2a0, 0xff8a1a, 9);
    this.sfxAt("collision", x, z, clamp(spd / 24, 0.2, 1));
    if (k.isPlayer) this.shake(clamp(spd / 55, 0.08, 0.45));
  }

  private collideStatic(k: Kart) {
    const limX = this.boundX() - KART_R - 0.1;
    const limZ = this.boundZ() - KART_R - 0.1;
    if (k.x > limX) { k.x = limX; this.wallBounce(k, -1, 0); }
    else if (k.x < -limX) { k.x = -limX; this.wallBounce(k, 1, 0); }
    if (k.z > limZ) { k.z = limZ; this.wallBounce(k, 0, -1); }
    else if (k.z < -limZ) { k.z = -limZ; this.wallBounce(k, 0, 1); }

    for (const s of this.arena.surfaces) {
      if (k.x < s.x0 - KART_R || k.x > s.x1 + KART_R || k.z < s.z0 - KART_R || k.z > s.z1 + KART_R) continue;
      const cx = clamp(k.x, s.x0, s.x1);
      const cz = clamp(k.z, s.z0, s.z1);
      const dx = k.x - cx;
      const dz = k.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= KART_R * KART_R) continue;
      if (surfaceHeight(s, cx, cz) <= k.y + 0.6) continue;
      let nx: number;
      let nz: number;
      let pen: number;
      if (d2 < 1e-6) {
        const l = k.x - s.x0, r = s.x1 - k.x, b = k.z - s.z0, t = s.z1 - k.z;
        const m = Math.min(l, r, b, t);
        if (m === l) { nx = -1; nz = 0; } else if (m === r) { nx = 1; nz = 0; } else if (m === b) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
        pen = m + KART_R;
      } else {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        pen = KART_R - d;
      }
      k.x += nx * pen;
      k.z += nz * pen;
      this.wallBounce(k, nx, nz);
    }

    for (const c of this.arena.circles) {
      if (!c.alive || k.y >= c.top - 0.2) continue;
      const dx = k.x - c.x;
      const dz = k.z - c.z;
      const rr = KART_R + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const spd = Math.hypot(k.vx, k.vz);
      if (c.kind === "cone" || (c.kind === "crate" && spd > 13) || (c.kind === "barrel" && spd > 11)) {
        c.lastHit = k.id;
        this.destroyCircle(c, k);
        k.vx *= 0.9;
        k.vz *= 0.9;
        continue;
      }
      const d = Math.sqrt(d2) || 0.01;
      const nx = dx / d;
      const nz = dz / d;
      k.x += nx * (rr - d);
      k.z += nz * (rr - d);
      this.wallBounce(k, nx, nz);
    }
  }

  private wallBounce(k: Kart, nx: number, nz: number) {
    const vn = k.vx * nx + k.vz * nz;
    if (vn < 0) {
      k.vx -= 1.35 * vn * nx;
      k.vz -= 1.35 * vn * nz;
      k.vx *= 0.92;
      k.vz *= 0.92;
      this.impact(k, -vn, k.x - nx * KART_R, k.z - nz * KART_R);
    }
  }

  private kartCollisions() {
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) {
      const a = ks[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ks.length; j++) {
        const b = ks[j];
        if (!b.alive || Math.abs(a.y - b.y) > 1.6) continue;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const rr = KART_R * 2;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d;
        const nz = dz / d;
        const pen = (rr - d) / 2;
        a.x += nx * pen;
        a.z += nz * pen;
        b.x -= nx * pen;
        b.z -= nz * pen;
        const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vn < 0) {
          const j2 = (-(1 + 0.6) * vn) / 2;
          a.vx += nx * j2;
          a.vz += nz * j2;
          b.vx -= nx * j2;
          b.vz -= nz * j2;
          const sp = -vn;
          if (sp > 6) {
            this.fx.sparks((a.x + b.x) / 2, a.y + 0.7, (a.z + b.z) / 2, 12, 0xfff2a0, 0xff8a1a, 8);
            this.sfxAt("collision", a.x, a.z, clamp(sp / 22, 0.25, 1));
            if (a.isPlayer || b.isPlayer) this.shake(clamp(sp / 45, 0.1, 0.4));
          }
          if (sp > 15) {
            const dmg = Math.min(9, (sp - 12) * 0.55);
            if (this.isEnemy(a, b)) {
              this.hurt(a, dmg, b, "Crash");
              this.hurt(b, dmg, a, "Crash");
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ weapons
  private fireWeapon(k: Kart) {
    if (!k.weapon) {
      if (k.isPlayer && k.input.fire) {
        k.cooldown = 0.3;
        audio.sfx("empty");
      }
      return;
    }
    const def = WEAPONS[k.weapon];
    if (k.isPlayer && this.cfg.tutorial) {
      this.tutorialFireCount++;
      this.tutorialStepFireCount++;
    }
    // Normalized firing direction from the kart toward its aim point.
    // The kart keeps its own heading: aim and drive are fully independent.
    const aim = kartAim(k);
    if (k.isPlayer && this.net) {
      this.net.push("fire", { weapon: k.weapon, aimX: k.input.aimX, aimZ: k.input.aimZ, ammo: k.ammo });
    }
    const dx = aim.dx;
    const dz = aim.dz;
    const dir = aim.dir;
    k.cooldown = def.cooldown;
    k.turretKick = 1;
    // Spawn at the muzzle tip, ahead of the kart along the firing direction,
    // so projectiles never start inside the kart or travel backward.
    const mhx = Math.sin(k.heading) * TURRET_MOUNT_Z;
    const mhz = Math.cos(k.heading) * TURRET_MOUNT_Z;
    const mx = k.x + mhx + dx * TURRET_BARREL_LEN;
    const mz = k.z + mhz + dz * TURRET_BARREL_LEN;
    const my = k.y + TURRET_MOUNT_Y + 0.12;

    switch (k.weapon) {
      case "rocket": {
        const mesh = this.rocketProtoMesh.clone();
        mesh.position.set(mx, my, mz);
        mesh.rotation.y = dir;
        this.scene.add(mesh);
        let target: Kart | null = null;
        let bestDot = Math.cos(0.7);
        for (const o of this.karts) {
          if (!o.alive || !this.isEnemy(k, o)) continue;
          const ox = o.x - k.x;
          const oz = o.z - k.z;
          const od = Math.hypot(ox, oz);
          if (od > 75 || od < 3) continue;
          const dot = (ox * dx + oz * dz) / od;
          if (dot > bestDot) {
            bestDot = dot;
            target = o;
          }
        }
        this.rockets.push({ owner: k, mesh, x: mx, y: my, z: mz, dir, speed: 50, life: 4, age: 0, target, trailT: 0 });
        this.fx.add.emit(mx, my, mz, 0, 0, 0, 0.2, 3, 0.5, 0xffffff, 0xffa030, 0, 0);
        for (let i = 0; i < 8; i++) this.fx.smoke.emit(mx, my, mz, dx * 6 + (Math.random() - 0.5) * 4, Math.random() * 2, dz * 6 + (Math.random() - 0.5) * 4, 0.6, 0.6, 2.2, 0x9a9aa8, 0x40404a, 0, 2, 0.6);
        k.vx -= dx * 2;
        k.vz -= dz * 2;
        this.sfxAt("rocket", k.x, k.z, 0.9);
        if (k.isPlayer) this.shake(0.2);
        break;
      }
      case "mg": {
        const spread = (Math.random() - 0.5) * 0.07;
        const a = dir + spread;
        const bdx = Math.sin(a);
        const bdz = Math.cos(a);
        k.mgSide = -k.mgSide;
        // Alternate barrels: muzzle point plus a small side offset across the aim.
        const sx = mx + -bdz * 0.35 * k.mgSide;
        const sz = mz + bdx * 0.35 * k.mgSide;
        const mesh = new THREE.Mesh(bulletGeo, bulletMats[k.isPlayer ? 0 : k.team === 1 ? 2 : k.team === 0 ? 1 : 0]);
        mesh.position.set(sx, my, sz);
        mesh.rotation.y = a;
        this.scene.add(mesh);
        this.bullets.push({ owner: k, mesh, x: sx, y: my, z: sz, dx: bdx * 95, dz: bdz * 95, life: 0.8 });
        this.fx.add.emit(sx, my, sz, bdx * 4, 0.5, bdz * 4, 0.08, 0.9, 0.2, 0xfff2a0, 0xff9a20, 0, 0);
        this.sfxAt("mg", k.x, k.z, 0.7);
        if (k.isPlayer) this.shake(0.025);
        break;
      }
      case "mine": {
        const fx = Math.sin(k.heading);
        const fz = Math.cos(k.heading);
        const x = k.x - fx * 2.6;
        const z = k.z - fz * 2.6;
        const y = this.arena.groundAt(x, z, k.y + 0.5);
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 0.35, 12), new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.5, metalness: 0.6, flatShading: true }));
        body.position.y = 0.18;
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a3a }));
        light.position.y = 0.42;
        g.add(body, light);
        for (let i = 0; i < 6; i++) {
          const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 5), body.material);
          const a = (i / 6) * Math.PI * 2;
          sp.position.set(Math.cos(a) * 0.85, 0.3, Math.sin(a) * 0.85);
          g.add(sp);
        }
        g.position.set(x, y, z);
        this.scene.add(g);
        this.mines.push({ owner: k, mesh: g, light, x, y, z, arm: 1.1, life: 45, fuse: -1 });
        this.sfxAt("mine", k.x, k.z, 0.8);
        break;
      }
      case "bomb": {
        let dist = clamp(aim.len, 8, 40);
        if (aim.len < 2) dist = 22;
        const tx = k.x + dx * dist;
        const tz = k.z + dz * dist;
        const cxp = clamp(tx, -this.boundX() + 2, this.boundX() - 2);
        const czp = clamp(tz, -this.boundZ() + 2, this.boundZ() - 2);
        const ty = this.arena.maxHeightAt(cxp, czp);
        const g = new THREE.Group();
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.35, metalness: 0.6 }));
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xb36bff, emissive: 0x6a2bd0 }));
        cap.position.y = 0.75;
        const spark = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
        spark.position.y = 1.0;
        g.add(ball, cap, spark);
        g.position.set(mx, my + 0.2, mz);
        this.scene.add(g);
        const marker = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.8, 36), new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(cxp, ty + 0.12, czp);
        this.scene.add(marker);
        const T = clamp(0.55 + dist / 40, 0.7, 1.4);
        this.bombs.push({ owner: k, mesh: g, marker, sx: mx, sy: my + 0.2, sz: mz, tx: cxp, ty, tz: czp, t: 0, T, trailT: 0 });
        this.sfxAt("bomb", k.x, k.z, 0.9);
        if (k.isPlayer) this.shake(0.1);
        break;
      }
      case "shield":
        k.shield = 7;
        this.fx.ring(k.x, k.y, k.z, 5, 0x38e8ff, 0.5);
        this.sfxAt("shield", k.x, k.z, 0.8);
        if (k.isPlayer) this.cb.onEvent({ type: "pickup", text: "SHIELD UP!", color: "#38e8ff" });
        break;
      case "boost":
        k.boostT = Math.max(k.boostT, 3.5);
        this.fx.ring(k.x, k.y, k.z, 5, 0x6dff6d, 0.5);
        this.fx.sparks(k.x, k.y + 0.6, k.z, 24, 0xffffff, 0x6dff6d, 14);
        this.sfxAt("boost", k.x, k.z, 0.9);
        if (k.isPlayer) this.shake(0.2);
        break;
    }
    k.ammo--;
    if (k.ammo <= 0) k.weapon = null;
  }

  private updateProjectiles(dt: number) {
    const arena = this.arena;
    // rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.age += dt;
      r.life -= dt;
      if (r.target && r.target.alive && r.age > 0.12) {
        const want = Math.atan2(r.target.x - r.x, r.target.z - r.z);
        const da = wrapAngle(want - r.dir);
        r.dir += clamp(da, -2.6 * dt, 2.6 * dt);
      }
      r.speed = Math.min(62, r.speed + 22 * dt);
      const dx = Math.sin(r.dir);
      const dz = Math.cos(r.dir);
      const nx = r.x + dx * r.speed * dt;
      const nz = r.z + dz * r.speed * dt;
      let boom = r.life <= 0;
      if (!boom && (Math.abs(nx) > this.boundX() - 0.5 || Math.abs(nz) > this.boundZ() - 0.5)) boom = true;
      if (!boom && arena.maxHeightAt(nx, nz) > r.y - 0.2) boom = true;
      if (!boom) {
        for (const c of arena.circles) {
          if (!c.alive || c.top < r.y - 0.2) continue;
          const ddx = c.x - nx;
          const ddz = c.z - nz;
          if (ddx * ddx + ddz * ddz < (c.r + 0.3) ** 2) {
            c.lastHit = r.owner.id;
            boom = true;
            break;
          }
        }
      }
      if (!boom) {
        for (const o of this.karts) {
          if (!o.alive || (o === r.owner && r.age < 0.4) || Math.abs(o.y + 0.7 - r.y) > 2.2) continue;
          if (o !== r.owner && !this.isEnemy(r.owner, o)) continue;
          const ddx = o.x - nx;
          const ddz = o.z - nz;
          if (ddx * ddx + ddz * ddz < 1.9 * 1.9) {
            boom = true;
            break;
          }
        }
      }
      r.x = nx;
      r.z = nz;
      r.mesh.position.set(r.x, r.y, r.z);
      r.mesh.rotation.y = r.dir;
      r.trailT -= dt;
      if (r.trailT <= 0) {
        r.trailT = 0.016;
        this.fx.add.emit(r.x - dx * 1.1, r.y, r.z - dz * 1.1, (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5), 0.28, 1.1, 0.15, 0xffe27a, 0xff3a05, 0, 2);
        this.fx.smoke.emit(r.x - dx * 1.3, r.y, r.z - dz * 1.3, (Math.random() - 0.5) * 0.8, 0.4, (Math.random() - 0.5) * 0.8, 0.9, 0.6, 2.4, 0xb8b8c4, 0x50505a, 0, 1, 0.5);
      }
      if (boom) {
        this.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
        this.explode(r.x, r.y, r.z, 7, 55, r.owner, "Rocket", true);
      }
    }
    // bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      const nx = b.x + b.dx * dt;
      const nz = b.z + b.dz * dt;
      let hit = b.life <= 0;
      let hx = nx;
      let hz = nz;
      if (!hit && (Math.abs(nx) > this.boundX() - 0.4 || Math.abs(nz) > this.boundZ() - 0.4 || arena.maxHeightAt(nx, nz) > b.y)) hit = true;
      if (!hit) {
        for (const c of arena.circles) {
          if (!c.alive || c.top < b.y) continue;
          const ddx = c.x - nx;
          const ddz = c.z - nz;
          if (ddx * ddx + ddz * ddz < (c.r + 0.1) ** 2) {
            hit = true;
            if (c.kind !== "static") {
              c.hp -= 5;
              c.lastHit = b.owner.id;
              if (c.hp <= 0) this.destroyCircle(c, b.owner);
            }
            break;
          }
        }
      }
      if (!hit) {
        for (const o of this.karts) {
          if (!o.alive || o === b.owner || !this.isEnemy(b.owner, o) || Math.abs(o.y + 0.7 - b.y) > 1.8) continue;
          // check midpoint and end of segment
          const mx2 = (b.x + nx) / 2;
          const mz2 = (b.z + nz) / 2;
          const r2 = 1.45 * 1.45;
          if ((o.x - nx) ** 2 + (o.z - nz) ** 2 < r2 || (o.x - mx2) ** 2 + (o.z - mz2) ** 2 < r2) {
            hit = true;
            hx = nx;
            hz = nz;
            this.fx.sparks(hx, b.y, hz, 6, 0xfff2a0, 0xff8a1a, 7);
            this.hurt(o, 5, b.owner, "Machine Gun");
            break;
          }
        }
      } else if (b.life > 0) {
        this.fx.sparks(hx, b.y, hz, 4, 0xfff2a0, 0xff8a1a, 6);
      }
      b.x = nx;
      b.z = nz;
      b.mesh.position.set(b.x, b.y, b.z);
      if (hit) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
    // bombs
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt;
      const u = Math.min(1, b.t / b.T);
      const x = b.sx + (b.tx - b.sx) * u;
      const z = b.sz + (b.tz - b.sz) * u;
      const y = b.sy + (b.ty + 0.7 - b.sy) * u + 4 * 9 * u * (1 - u);
      b.mesh.position.set(x, y, z);
      b.mesh.rotation.x += dt * 6;
      b.mesh.rotation.z += dt * 4;
      b.marker.scale.setScalar(1.15 - u * 0.25 + Math.sin(this.time * 18) * 0.04);
      (b.marker.material as THREE.MeshBasicMaterial).opacity = 0.4 + u * 0.5;
      b.trailT -= dt;
      if (b.trailT <= 0) {
        b.trailT = 0.025;
        this.fx.add.emit(x, y + 1, z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.3, 0.7, 0.1, 0xfff2a0, 0xff6a20, 0, 1);
      }
      if (u >= 1) {
        this.scene.remove(b.mesh);
        this.scene.remove(b.marker);
        (b.marker.material as THREE.Material).dispose();
        b.marker.geometry.dispose();
        this.bombs.splice(i, 1);
        this.explode(b.tx, b.ty + 0.4, b.tz, 10, 75, b.owner, "Bomb", true);
      }
    }
    // mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt;
      const wasArming = m.arm > 0;
      m.arm -= dt;
      if (wasArming && m.arm <= 0) this.sfxAt("mineArm", m.x, m.z, 0.5);
      (m.light.material as THREE.MeshBasicMaterial).color.setHex(m.arm > 0 ? (Math.sin(this.time * 30) > 0 ? 0xffaa00 : 0x552200) : Math.sin(this.time * 10) > 0 ? 0xff2a3a : 0x66101a);
      let trig = m.fuse >= 0;
      if (m.fuse >= 0) {
        m.fuse -= dt;
        trig = m.fuse <= 0;
      } else if (m.arm <= 0) {
        for (const o of this.karts) {
          if (!o.alive || o.invuln > 0 || Math.abs(o.y - m.y) > 1.5) continue;
          if (o !== m.owner && !this.isEnemy(m.owner, o)) continue;
          if ((o.x - m.x) ** 2 + (o.z - m.z) ** 2 < 2.7 * 2.7) {
            trig = true;
            break;
          }
        }
      }
      if (trig || m.life <= 0) {
        this.scene.remove(m.mesh);
        this.mines.splice(i, 1);
        this.explode(m.x, m.y + 0.3, m.z, 7, 65, m.owner, "Mine", true);
      }
    }
  }

  explode(x: number, y: number, z: number, R: number, dmg: number, owner: Kart | null, weapon: string, big: boolean) {
    this.fx.explosion(x, y, z, R, big);
    this.sfxAt(big ? "bigExplosion" : "explosion", x, z, 1);
    this.shake(big ? 0.55 : 0.35, x, z);
    for (const v of this.karts) {
      if (!v.alive) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d > R + 1.2 || Math.abs(v.y - y) > R) continue;
      if (owner && v !== owner && !this.isEnemy(owner, v)) continue;
      const f = clamp(1 - d / (R + 1.2), 0, 1);
      const amt = dmg * (0.3 + 0.7 * f) * (v === owner ? 0.5 : 1);
      this.hurt(v, amt, owner, weapon);
      if (v.alive) {
        const nx = d > 0.1 ? (v.x - x) / d : 0;
        const nz = d > 0.1 ? (v.z - z) / d : 1;
        const kb = 6 + 16 * f;
        v.vx += nx * kb;
        v.vz += nz * kb;
        if (f > 0.35 && v.grounded) {
          v.grounded = false;
          v.vy = 5 + 8 * f;
          v.slopeVy = 0;
        }
      }
    }
    for (const c of this.arena.circles) {
      if (!c.alive || c.kind === "static") continue;
      if (Math.hypot(c.x - x, c.z - z) < R + c.r) {
        c.lastHit = owner ? owner.id : c.lastHit;
        this.destroyCircle(c, owner, 0.12 + Math.random() * 0.15);
      }
    }
    for (const m of this.mines) {
      if (m.fuse < 0 && Math.hypot(m.x - x, m.z - z) < R) m.fuse = 0.15 + Math.random() * 0.15;
    }
  }

  private destroyCircle(c: Circle, by: Kart | null, delay = 0) {
    if (!c.alive) return;
    c.alive = false;
    if (c.mesh) c.mesh.visible = false;
    c.respawnAt = this.time + (c.kind === "barrel" ? 26 : c.kind === "crate" ? 16 : 12);
    if (c.kind === "barrel") {
      const owner = by ?? this.kartById(c.lastHit);
      if (delay > 0) {
        window.setTimeout(() => {
          if (!this.disposed && !this.paused) this.explode(c.x, 1, c.z, 7.5, 50, owner, "Barrel", true);
        }, delay * 1000);
      } else {
        this.explode(c.x, 1, c.z, 7.5, 50, owner, "Barrel", true);
      }
    } else {
      this.fx.chunks(c.x, 1, c.z, c.kind === "crate" ? 0xb07a3c : 0xff6a1a, c.kind === "crate" ? 7 : 3, 8);
      this.fx.sparks(c.x, 1, c.z, 8, 0xffe9b0, 0xb07a3c, 6);
      this.sfxAt("crate", c.x, c.z, 0.7);
      if (by?.isPlayer && c.kind === "crate") by.score += 5;
    }
  }

  private updateCircles() {
    for (const c of this.arena.circles) {
      if (c.alive || c.kind === "static" || this.time < c.respawnAt) continue;
      let blocked = false;
      for (const k of this.karts) if (k.alive && Math.hypot(k.x - c.x, k.z - c.z) < 3.5) blocked = true;
      if (blocked) continue;
      c.alive = true;
      c.pop = 0;
      c.hp = c.kind === "crate" ? 20 : c.kind === "barrel" ? 10 : 1;
      if (c.mesh) {
        c.mesh.visible = true;
        c.mesh.scale.setScalar(0.01);
      }
    }
  }

  private hurt(v: Kart, amt: number, atk: Kart | null, weapon: string) {
    if (v.tutorialTarget) {
      if (this.cfg.tutorial && atk?.isPlayer && this.phase === "playing") {
        this.tutorialTargetHits++;
        this.tutorialStepTargetHits++;
      }
      return;
    }
    if (!v.alive || v.invuln > 0 || this.phase !== "playing") return;
    if (atk && atk !== v && !this.isEnemy(atk, v)) return;
    // A remote human's HP lives on their client: send them the damage instead.
    if (v.isRemote) {
      if (atk === this.player && this.net) this.net.push("hit", { target: v.remoteId, dmg: amt, weapon });
      return;
    }
    // Remote shooters deal damage through hit events (already applied there).
    if (atk && atk.isRemote) return;
    if (v.shield > 0) {
      this.fx.sparks(v.x, v.y + 1, v.z, 8, 0x9ff6ff, 0x38e8ff, 9);
      this.sfxAt("shield", v.x, v.z, 0.4);
      return;
    }
    // Bots hit softer against the human player so fights feel fair.
    const soft = atk && !atk.isPlayer && v.isPlayer ? 0.6 : 1;
    const dmg = (amt * soft) / v.stats.armor;
    v.hp -= dmg;
    if (atk && atk !== v) {
      v.lastHitBy = atk.id;
      v.lastHitT = this.time;
      v.lastHitWeapon = weapon;
      atk.score += dmg * 0.5;
      if (atk.isPlayer) {
        this.cb.onEvent({ type: "hit", kill: v.hp <= 0 });
        audio.sfx("hit", 0.8);
        this.floatText(v.x, v.y + 2.2, v.z, `-${Math.round(dmg)}`, "dmg");
      }
    }
    if (v.isPlayer) {
      this.cb.onEvent({ type: "hurt" });
      audio.sfx("hurt", 0.7);
      this.shake(0.2 + Math.min(0.3, dmg / 120));
    }
    this.fx.sparks(v.x, v.y + 1, v.z, 5, 0xfff2a0, 0xff6a20, 7);
    if (v.hp <= 0) {
      let killer = atk;
      if (!killer || killer === v) {
        const l = this.kartById(v.lastHitBy);
        if (l && this.time - v.lastHitT < 6 && l !== v) {
          killer = l;
          weapon = v.lastHitWeapon || weapon;
        } else killer = null;
      }
      this.killKart(v, killer, weapon);
    }
  }

  private killKart(v: Kart, killer: Kart | null, weapon: string, fromNet = false) {
    if (v.isPlayer && this.net && !fromNet) {
      this.net.push("death", {
        victim: this.net.playerId,
        killer: killer && killer.isRemote ? killer.remoteId : "",
        killerName: killer?.name ?? "",
        victimName: v.name,
        weapon,
      });
    }
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    v.streak = 0;
    v.weapon = null;
    v.drifting = false;
    v.rig.group.visible = false;
    v.tag.style.display = "none";
    v.rig.shield.visible = false;
    this.fx.explosion(v.x, v.y + 0.3, v.z, 8, true);
    this.fx.chunks(v.x, v.y + 1, v.z, v.rig.primaryMat.color.getHex(), 8, 12);
    this.sfxAt("bigExplosion", v.x, v.z, 1);
    this.shake(0.5, v.x, v.z);
    if (v.isPlayer) {
      this.deathPos.set(v.x, v.y, v.z);
      this.camOrbit = this.camHeading;
    }
    if (killer && killer !== v) {
      killer.kills++;
      killer.streak++;
      const bonus = killer.streak >= 2 ? 25 * (killer.streak - 1) : 0;
      killer.score += 100 + bonus;
      if (this.mode === "team" && killer.team >= 0) this.teamScores[killer.team as 0 | 1]++;
      if (killer.isPlayer) {
        audio.sfx("kill");
        this.floatText(v.x, v.y + 3, v.z, `+${100 + bonus}`, "kill");
        const names = ["", "", "DOUBLE KILL!", "TRIPLE KILL!", "RAMPAGE!", "UNSTOPPABLE!"];
        if (killer.streak >= 2) this.cb.onEvent({ type: "banner", text: names[Math.min(5, killer.streak)], sub: `${killer.streak} kill streak`, color: "#ffd21f" });
      }
    } else if (!killer) {
      v.score = Math.max(0, v.score - 20);
    }
    const icons: Record<string, string> = { Rocket: "🚀", "Machine Gun": "🔫", Mine: "🧨", Bomb: "💣", Barrel: "🛢️", Crash: "💥" };
    this.cb.onKill({
      id: this.killSeq++, killer: killer && killer !== v ? killer.name : null, killerTeam: killer?.team ?? -1, victim: v.name, victimTeam: v.team,
      icon: icons[weapon] ?? "💥", involvesPlayer: v.isPlayer || killer?.isPlayer === true, t: performance.now(),
    });
    if (this.mode === "survival") {
      if (v.isPlayer) {
        this.lives--;
        if (this.lives <= 0) {
          v.noRespawn = true;
          this.endPending = 1.8;
        } else v.respawnT = 2.5;
      } else v.noRespawn = true;
    } else v.respawnT = 3;
  }

  private updateRespawns(dt: number) {
    for (const k of this.karts) {
      if (k.alive || k.noRespawn || this.phase === "ended") continue;
      k.respawnT -= dt;
      if (k.respawnT <= 0) {
        this.placeKart(k, this.pickSpawn(k), true);
        if (k.isPlayer) {
          this.camHeading = k.heading;
          this.camInit = false;
        }
      }
    }
  }

  // ------------------------------------------------------------------ pickups
  /** Environmental hazards (lava): damage over time + burn particles. */
  private lavaToastT = 0;
  private updateHazards(dt: number) {
    const hazards = this.arena.hazards;
    if (!hazards || !hazards.length || this.phase !== "playing") return;
    this.lavaToastT -= dt;
    for (const k of this.karts) {
      if (!k.alive || k.y > 1.2) continue;
      for (const h of hazards) {
        const dx = k.x - h.x;
        const dz = k.z - h.z;
        if (dx * dx + dz * dz > h.r * h.r) continue;
        this.hurt(k, h.dps * dt, null, "Lava");
        if (this.rng() < dt * 20) {
          this.fx.add.emit(k.x + (this.rng() - 0.5) * 2, k.y + 0.6, k.z + (this.rng() - 0.5) * 2,
            (this.rng() - 0.5) * 2, 3 + this.rng() * 3, (this.rng() - 0.5) * 2, 0.4, 1.2, 0.15, 0xffc060, 0xff3a05, -6, 1);
        }
        if (k.isPlayer && this.lavaToastT <= 0) {
          this.lavaToastT = 3;
          this.cb.onEvent({ type: "banner", text: "LAVA!", sub: "Get back on solid ground", color: "#ff5a10" });
        }
        break;
      }
    }
  }

  // -------------------------------------------------- out-of-bounds recovery
  /**
   * Kill-zone / recovery: karts that leave the playfield, fall beneath the map
   * or end up buried inside terrain are recovered to a safe spawn after a short
   * delay, with orientation + velocity restored and brief invulnerability.
   */
  private updateRecovery(dt: number) {
    const boundX = this.boundX() + 8;
    const boundZ = this.boundZ() + 8;
    for (const k of this.karts) {
      if (!k.alive || k.isRemote) continue;
      const out = Math.abs(k.x) > boundX || Math.abs(k.z) > boundZ;
      const below = k.y < -6;
      const buried = k.y < -0.4 && this.arena.maxHeightAt(k.x, k.z) > k.y + 1.4;
      if (out || below || buried) {
        k.recoverT += dt;
        if (k.recoverT > 0.6) this.recoverKart(k);
      } else if (k.recoverT > 0) {
        k.recoverT = Math.max(0, k.recoverT - dt * 2);
      }
    }
  }

  private recoverKart(k: Kart) {
    const keepWeapon = k.weapon;
    const keepAmmo = k.ammo;
    k.recoverT = 0;
    this.placeKart(k, this.pickSpawn(k), true);
    k.weapon = keepWeapon;
    k.ammo = keepAmmo;
    if (k.isPlayer) {
      this.cb.onEvent({ type: "banner", text: "RECOVERED", sub: "Back on solid ground", color: "#35e8ff" });
      this.shake(0.25);
    }
    this.sfxAt("respawn", k.x, k.z, 0.7);
  }

  // -------------------------------------------------- multiplayer net sync
  private netTick(dt: number) {
    const net = this.net;
    if (!net || this.netInFlight) return;
    this.netAcc += dt;
    const interval = Math.min(1, 0.1 * 2 ** Math.min(this.netFails, 4));
    if (this.netAcc < interval) return;
    this.netAcc = 0;
    this.netInFlight = true;
    const p = this.player;
    const state: KartState = {
      x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz, heading: p.heading,
      pitch: p.pitch, roll: p.roll, boosting: p.boosting, drifting: p.drifting, driftDir: p.driftDir,
      aimX: p.input.aimX, aimZ: p.input.aimZ, weapon: p.weapon, ammo: p.ammo,
      alive: p.alive, hp: p.hp, score: p.score, kills: p.kills, deaths: p.deaths,
    };
    net
      .sync(state)
      .then((r) => {
        if (r.ok) {
          this.netFails = 0;
          this.applyRoomState(r.room ?? null);
          this.applyNet(r.players ?? [], r.events ?? []);
        } else this.netFails++;
      })
      .catch(() => {
        this.netFails++;
      })
      .finally(() => {
        this.netInFlight = false;
      });
  }

  private applyRoomState(room: NetRoom | null) {
    if (!room) return;
    if (this.cfg.net && this.net) {
      const isHost = room.hostId === this.net.playerId;
      this.cfg.net.serverOffset = this.net.serverNow() - Date.now();
      this.cfg.net.cursor = this.net.cursor;
      if (this.cfg.net.isHost !== isHost) {
        this.cfg.net.isHost = isHost;
        this.cb.onNetworkHostChange?.(isHost);
      }
    }
    if (room.status === "ended" && this.phase !== "ended") {
      if (this.paused) {
        this.paused = false;
        this.cb.onNetworkMatchEnd?.();
      }
      this.endMatch();
    }
    if (
      (room.status === "countdown" || room.status === "playing") &&
      room.seed !== this.netMatchSeed &&
      room.startAt &&
      this.phase === "ended"
    ) {
      this.netMatchSeed = room.seed;
      this.net?.clearPendingEvents();
      if (this.netRestartTimer !== null) window.clearTimeout(this.netRestartTimer);
      const { seed, startAt } = room;
      this.cb.onNetworkCountdown?.(startAt);
      this.netRestartTimer = window.setTimeout(() => {
        this.netRestartTimer = null;
        if (!this.disposed) this.cb.onNetworkRestart?.(seed, startAt, this.networkPlayers);
      }, Math.max(0, room.startAt - (this.net?.serverNow() ?? Date.now())));
    }
  }

  private applyNet(players: NetPlayer[], events: NetEvent[]) {
    this.networkPlayers = players;
    const me = this.net?.playerId;
    for (const pl of players) {
      if (pl.id === me || pl.isAi) continue;
      let k = this.karts.find((x) => x.remoteId === pl.id);
      if (!k) {
        k = this.makeKart({
          name: pl.name,
          avatar: pl.avatar,
          preset: KART_PRESETS[pl.kartId % KART_PRESETS.length],
          isPlayer: false,
          team: this.mode === "team" ? pl.slot % 2 : -1,
          skill: 1,
          remoteId: pl.id,
          spawnSlot: pl.slot,
          glow: 0x35e8ff,
        });
        this.placeKart(k, pl.slot);
        this.seedRemote(k, pl.state, pl.updatedAt);
      }
      const st = pl.state as Partial<KartState>;
      if (!k || typeof st.x !== "number") continue;
      if (!k.alive && st.alive) {
        // peer respawned
        k.alive = true;
        k.rig.group.visible = true;
        if (!k.isPlayer) k.tag.style.display = "";
        k.invuln = 1;
      } else if (k.alive && st.alive === false) {
        this.killKart(k, null, "Hit", true);
      }
      const sample: NetKartState = {
        x: st.x, y: st.y ?? k.y, z: st.z ?? k.z,
        vx: st.vx ?? 0, vz: st.vz ?? 0,
        heading: st.heading ?? k.heading, pitch: st.pitch ?? 0, roll: st.roll ?? 0,
        boosting: st.boosting === true, drifting: st.drifting === true, driftDir: st.driftDir ?? 1,
        aimX: st.aimX ?? k.x, aimZ: st.aimZ ?? k.z,
        weapon: (st.weapon as WeaponId) ?? null, ammo: st.ammo ?? 0,
        alive: st.alive !== false, hp: st.hp ?? 100,
        score: st.score ?? k.score, kills: st.kills ?? k.kills, deaths: st.deaths ?? k.deaths,
        serverTime: pl.updatedAt || this.net?.serverNow() || Date.now(),
      };
      const last = k.netSamples[k.netSamples.length - 1];
      if (last && sample.serverTime < last.serverTime) continue;
      if (last && sample.serverTime === last.serverTime) k.netSamples[k.netSamples.length - 1] = sample;
      else k.netSamples.push(sample);
      if (k.netSamples.length > 24) k.netSamples.splice(0, k.netSamples.length - 24);
      k.hp = sample.hp;
      k.score = sample.score;
      k.kills = sample.kills;
      k.deaths = sample.deaths;
    }
    const connected = new Set(players.filter((player) => !player.isAi).map((player) => player.id));
    for (const ev of events) {
      if (ev.type === "leave" && connected.has(String(ev.payload?.playerId ?? ""))) continue;
      this.applyNetEvent(ev);
    }
  }

  private applyNetEvent(ev: NetEvent) {
    const payload = ev.payload ?? {};
    const srcId = typeof payload.source === "string" ? payload.source : "";
    const src = this.karts.find((x) => x.remoteId === srcId) ?? null;
    if (ev.type === "fire" && src) {
      // replay the peer's shot: muzzle flash, projectile, sound
      src.input.aimX = Number(payload.aimX ?? src.x + 30);
      src.input.aimZ = Number(payload.aimZ ?? src.z);
      const w = payload.weapon as WeaponId | null;
      if (w && WEAPONS[w]) {
        src.weapon = w;
        src.ammo = Math.max(1, Number(payload.ammo ?? 1));
        if (src.cooldown <= 0) {
          this.fireWeapon(src);
          src.cooldown = 0.12;
        }
      }
    } else if (ev.type === "hit") {
      if (String(payload.target ?? "") === this.net?.playerId) {
        this.applyNetDamage(Number(payload.dmg ?? 0), src, String(payload.weapon ?? "Hit"));
      }
    } else if (ev.type === "death") {
      const victim = String(payload.victim ?? "");
      const killerIsMe = String(payload.killer ?? "") === this.net?.playerId;
      const vk = this.karts.find((x) => x.remoteId === victim);
      if (killerIsMe) {
        const p = this.player;
        p.kills++;
        p.streak++;
        const bonus = p.streak >= 2 ? 25 * (p.streak - 1) : 0;
        p.score += 100 + bonus;
        audio.sfx("kill");
        this.floatText(vk?.x ?? p.x, (vk?.y ?? 0) + 3, vk?.z ?? p.z, `+${100 + bonus}`, "kill");
        this.cb.onKill({
          id: this.killSeq++, killer: p.name, killerTeam: p.team,
          victim: String(payload.victimName ?? vk?.name ?? "Opponent"), victimTeam: vk?.team ?? -1,
          icon: "💥", involvesPlayer: true, t: performance.now(),
        });
      }
      if (vk && vk.alive) this.killKart(vk, null, String(payload.weapon ?? "Hit"), true);
    } else if (ev.type === "leave") {
      const vk = this.karts.find((x) => x.remoteId === String(payload.playerId ?? ""));
      if (vk) {
        this.retired.push({ name: vk.name, avatar: vk.avatar, kills: vk.kills, deaths: vk.deaths, score: Math.round(vk.score), team: vk.team, isPlayer: false });
        if (vk.alive) this.fx.explosion(vk.x, vk.y + 0.3, vk.z, 7, true);
        this.scene.remove(vk.rig.group);
        disposeRig(vk.rig);
        vk.tag.remove();
        this.karts.splice(this.karts.indexOf(vk), 1);
      }
    }
  }

  /** Damage coming in from a remote player's shot. */
  private applyNetDamage(dmg: number, src: Kart | null, weapon: string) {
    const v = this.player;
    if (!v.alive || this.phase !== "playing") return;
    if (v.shield > 0) {
      this.fx.sparks(v.x, v.y + 1, v.z, 8, 0x9ff6ff, 0x38e8ff, 9);
      this.sfxAt("shield", v.x, v.z, 0.4);
      return;
    }
    const amount = (dmg * 0.75) / v.stats.armor;
    v.hp -= amount;
    v.lastHitBy = src?.id ?? -1;
    v.lastHitT = this.time;
    v.lastHitWeapon = weapon;
    this.cb.onEvent({ type: "hurt" });
    audio.sfx("hurt", 0.7);
    this.shake(0.2 + Math.min(0.3, amount / 120));
    this.fx.sparks(v.x, v.y + 1, v.z, 5, 0xfff2a0, 0xff6a20, 7);
    this.floatText(v.x, v.y + 2.2, v.z, `-${Math.round(amount)}`, "dmg");
    if (v.hp <= 0) this.killKart(v, src, weapon);
  }

  /** Render a short snapshot buffer behind server time and briefly extrapolate gaps. */
  private updateRemote(k: Kart, dt: number) {
    k.invuln = Math.max(0, k.invuln - dt);
    const samples = k.netSamples;
    if (!samples.length) return;
    const targetTime = (this.net?.serverNow() ?? Date.now()) - 120;
    while (samples.length > 2 && samples[1].serverTime <= targetTime) samples.shift();

    const first = samples[0];
    const second = samples[1];
    let x = first.x;
    let y = first.y;
    let z = first.z;
    let vx = first.vx;
    let vz = first.vz;
    let heading = first.heading;
    let pitch = first.pitch;
    let roll = first.roll;
    let boosting = first.boosting;
    let drifting = first.drifting;
    let driftDir = first.driftDir;
    let aimX = first.aimX;
    let aimZ = first.aimZ;
    let state = first;
    if (second && targetTime <= second.serverTime) {
      const span = Math.max(1, second.serverTime - first.serverTime);
      const t = Math.max(0, Math.min(1, (targetTime - first.serverTime) / span));
      x = first.x + (second.x - first.x) * t;
      y = first.y + (second.y - first.y) * t;
      z = first.z + (second.z - first.z) * t;
      vx = first.vx + (second.vx - first.vx) * t;
      vz = first.vz + (second.vz - first.vz) * t;
      heading = lerpAngle(first.heading, second.heading, t);
      pitch = first.pitch + (second.pitch - first.pitch) * t;
      roll = first.roll + (second.roll - first.roll) * t;
      boosting = t < 0.5 ? first.boosting : second.boosting;
      drifting = t < 0.5 ? first.drifting : second.drifting;
      driftDir = t < 0.5 ? first.driftDir : second.driftDir;
      aimX = first.aimX + (second.aimX - first.aimX) * t;
      aimZ = first.aimZ + (second.aimZ - first.aimZ) * t;
      state = t < 0.5 ? first : second;
    } else {
      const latest = second ?? first;
      const age = Math.max(0, Math.min(0.2, (targetTime - latest.serverTime) / 1_000));
      x = latest.x + latest.vx * age;
      y = latest.y;
      z = latest.z + latest.vz * age;
      vx = latest.vx;
      vz = latest.vz;
      heading = latest.heading;
      pitch = latest.pitch;
      roll = latest.roll;
      boosting = latest.boosting;
      drifting = latest.drifting;
      driftDir = latest.driftDir;
      aimX = latest.aimX;
      aimZ = latest.aimZ;
      state = latest;
    }
    k.x = x;
    k.y = y;
    k.z = z;
    k.vx = vx;
    k.vz = vz;
    k.heading = heading;
    k.pitch = pitch;
    k.roll = roll;
    k.boosting = boosting;
    k.drifting = drifting;
    k.driftDir = driftDir;
    k.input.aimX = aimX;
    k.input.aimZ = aimZ;
    k.weapon = state.weapon;
    k.ammo = state.ammo;
    k.hp = state.hp;
    k.cooldown = Math.max(0, k.cooldown - dt);
  }

  // -------------------------------------------------- randomized pickups
  private weaponZones: PickupZone[] = [];
  private healthZones: PickupZone[] = [];
  private zoneLastWeapon = new Map<PickupZone, WeaponId>();

  /** Pick a random subset of zones + a random loadout per box. Runs every match. */
  private setupPickups() {
    const zones = this.arena.zones ?? this.arena.pickupSpots.map((s) => ({ x: s.x, y: s.y, z: s.z, kind: s.kind }));
    this.weaponZones = this.shuffle(zones.filter((z) => z.kind === "weapon"));
    this.healthZones = this.shuffle(zones.filter((z) => z.kind === "health"));
    const activeWeapons = Math.max(8, Math.min(14, this.weaponZones.length));
    for (let i = 0; i < activeWeapons; i++) this.placePickup(this.weaponZones[i], this.rollWeapon(this.weaponZones[i]));
    for (const z of this.healthZones.slice(0, 4)) this.placePickup(z, "health");
  }

  /** Weighted weapon roll (match RNG). Avoids repeating the same weapon at a zone. */
  private rollWeapon(zone: PickupZone): WeaponId {
    let total = 0;
    for (const id of WEAPON_IDS) total += WEAPONS[id].weight;
    const pick = (): WeaponId => {
      let r = this.rng() * total;
      for (const id of WEAPON_IDS) {
        r -= WEAPONS[id].weight;
        if (r <= 0) return id;
      }
      return "mg";
    };
    let w = pick();
    if (this.zoneLastWeapon.get(zone) === w) w = pick();
    return w;
  }

  private zoneOccupied(zone: PickupZone) {
    return this.pickups.some((p) => p.active && p.zone === zone);
  }

  private freeWeaponZone(): PickupZone | null {
    const free = this.weaponZones.filter((z) => !this.zoneOccupied(z));
    if (!free.length) return null;
    return free[Math.floor(this.rng() * free.length)];
  }

  private buildPickupVisual(zone: PickupZone, load: PickupLoad) {
    const kind = load === "health" ? "health" : "weapon";
    const accent = load === "health" ? 0x6dff6d : parseInt(WEAPONS[load].color.slice(1), 16);
    const mesh = createPickupMesh(kind, accent);
    mesh.position.set(zone.x, zone.y + 1.1, zone.z);
    let icon: THREE.Sprite | null = null;
    if (load !== "health") {
      icon = new THREE.Sprite(weaponIconMat(WEAPONS[load].icon));
      icon.scale.set(1.9, 1.9, 1);
      icon.position.y = 1.7;
      icon.renderOrder = 21;
      mesh.add(icon);
    }
    return { mesh, spin: mesh.getObjectByName("spin") ?? mesh, icon };
  }

  private disposePickupVisual(p: Pickup) {
    this.scene.remove(p.mesh);
    p.mesh.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) return; // shared icon materials
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
    });
  }

  private placePickup(zone: PickupZone, load: PickupLoad) {
    const { mesh, spin, icon } = this.buildPickupVisual(zone, load);
    this.scene.add(mesh);
    this.pickups.push({ zone, load, mesh, spin, icon, active: true, respawnT: 0, appear: 1 });
    if (load !== "health") this.zoneLastWeapon.set(zone, load);
  }

  /** Move a collected box to a new random zone with a fresh random weapon. */
  private relocPickup(p: Pickup, zone: PickupZone, load: PickupLoad) {
    this.disposePickupVisual(p);
    const { mesh, spin, icon } = this.buildPickupVisual(zone, load);
    this.scene.add(mesh);
    p.zone = zone;
    p.load = load;
    p.mesh = mesh;
    p.spin = spin;
    p.icon = icon;
    p.active = true;
    p.appear = 0;
    if (load !== "health") this.zoneLastWeapon.set(zone, load);
  }

  private updatePickups(dt: number) {
    for (const p of this.pickups) {
      const zn = p.zone;
      if (!p.active) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          if (zn.kind === "health") {
            p.active = true;
            p.appear = 0;
            p.mesh.visible = true;
            this.fx.sparks(zn.x, zn.y + 1, zn.z, 10, 0xffffff, 0x6dff6d, 6);
          } else {
            // respawn at a new random free zone with a fresh random weapon
            const z = this.freeWeaponZone();
            if (!z) {
              p.respawnT = 2;
              continue;
            }
            this.relocPickup(p, z, this.rollWeapon(z));
            this.fx.sparks(z.x, z.y + 1, z.z, 10, 0xffffff, 0x35e8ff, 6);
          }
        }
        continue;
      }
      p.spin.rotation.y += dt * 1.8;
      p.spin.rotation.x = Math.sin(this.time * 1.5 + zn.x) * 0.15;
      p.mesh.position.y = zn.y + 1.15 + Math.sin(this.time * 2.2 + zn.z) * 0.18;
      if (p.appear < 1) {
        p.appear = Math.min(1, p.appear + dt * 3);
        p.mesh.scale.setScalar(Math.max(0.01, 1 + 2.2 * (p.appear - 1) ** 3 + 1.2 * (p.appear - 1) ** 2));
      }
      for (const k of this.karts) {
        if (!k.alive) continue;
        const dx = k.x - zn.x;
        const dz = k.z - zn.z;
        if (dx * dx + dz * dz > 2.7 * 2.7 || Math.abs(k.y - zn.y) > 2.5) continue;
        const load = p.load;
        if (load === "health") {
          if (k.hp >= k.maxHp - 1) continue;
          k.hp = Math.min(k.maxHp, k.hp + 45);
          if (k.isPlayer) this.cb.onEvent({ type: "pickup", text: "+45 REPAIR", color: "#6dff6d" });
          this.fx.sparks(zn.x, zn.y + 1, zn.z, 16, 0xffffff, 0x6dff6d, 8);
          this.fx.ring(k.x, k.y, k.z, 4, 0x6dff6d, 0.5);
        } else {
          k.weapon = load;
          k.ammo = WEAPONS[load].ammo;
          if (k.isPlayer && this.cfg.tutorial) {
            this.tutorialPickupCount++;
            this.tutorialStepPickupCount++;
          }
          k.cooldown = Math.min(k.cooldown, 0.2);
          if (k.isPlayer) this.cb.onEvent({ type: "pickup", text: `${WEAPONS[load].icon} ${WEAPONS[load].name.toUpperCase()}`, color: WEAPONS[load].color });
          this.fx.sparks(zn.x, zn.y + 1, zn.z, 18, 0xffffff, 0x35e8ff, 9);
          this.fx.ring(zn.x, zn.y, zn.z, 3, 0x35e8ff, 0.4);
        }
        if (k.isPlayer) audio.sfx("pickup");
        p.active = false;
        p.mesh.visible = false;
        p.respawnT = load === "health" ? 14 : 8;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ modes
  private updateModeLogic(dt: number) {
    if (this.cfg.tutorial) return;
    if (this.phase !== "playing") return;
    if (this.mode !== "survival") {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.cb.onEvent({ type: "banner", text: "TIME!", color: "#ffd21f" });
        this.endMatch();
      } else if (this.timeLeft < 10.5 && Math.ceil(this.timeLeft) !== this.lastCount) {
        this.lastCount = Math.ceil(this.timeLeft);
        audio.sfx("beep", 0.5);
      }
      return;
    }
    // survival
    const botsAlive = this.karts.filter((k) => !k.isPlayer && k.alive).length;
    if (this.waveState === "fighting" && botsAlive === 0) {
      this.waveState = "between";
      this.waveTimer = 4;
      this.player.score += this.wave * 150;
      if (this.player.alive) this.player.hp = Math.min(this.player.maxHp, this.player.hp + 35);
      this.cb.onEvent({ type: "banner", text: `WAVE ${this.wave} CLEARED`, sub: `+${this.wave * 150} bonus`, color: "#6dff6d" });
      audio.sfx("victory", 0.35);
      // retire dead bots
      for (let i = this.karts.length - 1; i >= 0; i--) {
        const k = this.karts[i];
        if (!k.isPlayer && !k.alive) {
          this.retired.push({ name: k.name, avatar: k.avatar, kills: k.kills, deaths: k.deaths, score: Math.round(k.score), team: k.team, isPlayer: false });
          this.scene.remove(k.rig.group);
          disposeRig(k.rig);
          k.tag.remove();
          this.karts.splice(i, 1);
        }
      }
      // clear leftover projectiles' owners irrelevant
    } else if (this.waveState === "between") {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.spawnWave();
    }
  }

  private spawnWave() {
    this.wave++;
    this.waveState = "fighting";
    const n = Math.min(2 + this.wave, 7);
    const skill = clamp(0.25 + this.wave * 0.06, 0.25, 0.85);
    const pool = this.cfg.roster.length ? this.cfg.roster : [{ name: "Bot", avatar: "🤖", kartId: 1 }];
    const spawns = [...this.arena.spawns.keys()].sort((a, b) => {
      const pa = this.arena.spawns[a];
      const pb = this.arena.spawns[b];
      return Math.hypot(pb.x - this.player.x, pb.z - this.player.z) - Math.hypot(pa.x - this.player.x, pa.z - this.player.z);
    });
    for (let i = 0; i < n; i++) {
      const r = pool[(this.wave * 3 + i) % pool.length];
      const k = this.makeKart({ name: r.name, avatar: r.avatar, preset: KART_PRESETS[(r.kartId + i) % KART_PRESETS.length], isPlayer: false, team: 1, skill: clamp(skill + (Math.random() - 0.5) * 0.15, 0.25, 1), enemyGlow: true });
      k.maxHp = 80 + this.wave * 6;
      this.placeKart(k, spawns[i % spawns.length], true);
      k.hp = k.maxHp;
      k.invuln = 1.2;
    }
    this.cb.onEvent({ type: "banner", text: `WAVE ${this.wave}`, sub: `${n} enemies incoming`, color: "#ff5a6a" });
    audio.sfx("go", 0.6);
  }

  private endMatch() {
    if (this.phase === "ended") return;
    this.phase = "ended";
    const rows: ResultRow[] = [
      ...this.karts.map((k) => ({ name: k.name, avatar: k.avatar, kills: k.kills, deaths: k.deaths, score: Math.round(k.score), team: k.team, isPlayer: k.isPlayer })),
      ...this.retired,
    ];
    const compareFfa = (a: ResultRow, b: ResultRow) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths;
    rows.sort(compareFfa);
    const p = this.player;
    const playerRow = rows.find((r) => r.isPlayer);
    const rank = playerRow ? 1 + rows.filter((r) => compareFfa(r, playerRow) < 0).length : rows.length;
    const tiedForFirst = this.mode === "ffa" && !!playerRow && rows.some((r) => !r.isPlayer && compareFfa(r, playerRow) === 0 && compareFfa(r, rows[0]) === 0);
    let win = false;
    let draw = false;
    if (this.mode === "ffa") {
      draw = rank === 1 && tiedForFirst;
      win = rank === 1 && !tiedForFirst;
    }
    else if (this.mode === "team") win = this.teamScores[p.team as 0 | 1] > this.teamScores[(1 - p.team) as 0 | 1];
    else win = this.wave >= 5;
    if (this.mode === "team") draw = this.teamScores[0] === this.teamScores[1];
    this.result = {
      mode: this.mode, rows, score: Math.round(p.score), kills: p.kills, deaths: p.deaths, win, draw, rank, teamScores: [...this.teamScores] as [number, number],
      wave: this.wave, duration: this.elapsed, playerTeam: p.team,
    };
    for (const k of this.karts) {
      k.input.fire = false;
      k.input.throttle = 0;
      k.input.boost = false;
      k.input.drift = false;
    }
    audio.sfx(win ? "victory" : "defeat");
    this.cb.onEvent({ type: "banner", text: this.mode === "survival" ? "GAME OVER" : win ? "VICTORY!" : "MATCH OVER", color: win ? "#ffd21f" : "#ff5a6a" });
    this.endDelay = 2.2;
    this.camOrbit = this.camHeading;
  }

  // ------------------------------------------------------------------ visuals
  // Visible weapon mount: yaws toward the kart's aim point so the firing
  // direction is readable on every kart (including to remote peers, which can
  // reproduce it from the aim fields in netState()). Fast-lerped so it stays
  // responsive yet smooth; firing uses the true aim vector, never the visual.
  private updateTurret(k: Kart, dt: number) {
    const t = k.turret;
    t.visible = k.alive && !!k.weapon;
    if (!t.visible) return;
    const aim = kartAim(k);
    if (aim.len > 0.6) {
      const want = wrapAngle(aim.dir - k.heading);
      t.rotation.y += wrapAngle(want - t.rotation.y) * Math.min(1, dt * 18);
    }
    k.turretKick = Math.max(0, k.turretKick - dt * 6);
    k.turretBarrel.position.z = 0.65 - k.turretKick * 0.28;
    const col = k.weapon ? WEAPONS[k.weapon].color : "#ffffff";
    if (k.turretTipMat.color.getHex() !== new THREE.Color(col).getHex()) k.turretTipMat.color.set(col);
  }

  private syncRig(k: Kart, dt: number) {
    const r = k.rig;
    if (!k.alive) return;
    r.group.position.set(k.x, k.y, k.z);
    r.group.rotation.y = k.heading;
    r.body.rotation.set(-k.pitch, 0, k.roll);
    const vf = k.vx * Math.sin(k.heading) + k.vz * Math.cos(k.heading);
    const bump = k.grounded ? Math.sin(this.time * 38 + k.id) * 0.012 * clamp(Math.abs(vf) / 25, 0, 1) : 0;
    r.body.position.y = bump;
    for (const s of r.spinners) s.rotation.x += (vf * dt) / 0.45;
    for (const f of r.frontPivots) f.rotation.y = -k.steerCur * 0.45;
    const fl = k.boosting ? 1 : 0;
    for (const f of r.flames) {
      const target = fl * (1.2 + Math.random() * 0.8);
      f.scale.y += (target - f.scale.y) * Math.min(1, dt * 20);
      f.scale.x = f.scale.z = 0.18 + f.scale.y * 0.08;
      f.position.z = -1.5 - f.scale.y * 0.5;
    }
    const sh = k.shield > 0;
    r.shield.visible = sh;
    if (sh) {
      const blink = k.shield < 1.5 ? (Math.sin(this.time * 30) > 0 ? 1 : 0.3) : 1;
      (r.shield.material as THREE.MeshBasicMaterial).opacity = (0.22 + Math.sin(this.time * 6) * 0.05) * blink;
      r.shield.scale.setScalar(1 + Math.sin(this.time * 8) * 0.03);
    }
    r.group.visible = !k.isRemote && k.invuln > 0 && k.invuln < 2.5 && !sh
      ? Math.sin(this.time * 40) > -0.3
      : true;
    r.ringMat.opacity = 0.55 + (k.boosting ? 0.35 : 0) + Math.sin(this.time * 4 + k.id) * 0.08;
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const cam = this.camera;
    const spd = Math.hypot(p.vx, p.vz);
    let targetFov = 68 + clamp(spd / 44, 0, 1) * 10 + (p.boosting ? 8 : 0);
    const lookAt = new THREE.Vector3();
    const want = new THREE.Vector3();

    if (this.phase === "ended") {
      this.camOrbit += dt * 0.35;
      const c = p.alive ? p : { x: this.deathPos.x, y: this.deathPos.y, z: this.deathPos.z };
      want.set(c.x + Math.sin(this.camOrbit) * 15, c.y + 6.5, c.z + Math.cos(this.camOrbit) * 15);
      lookAt.set(c.x, c.y + 1, c.z);
      targetFov = 60;
    } else if (!p.alive) {
      this.camOrbit += dt * 0.5;
      want.set(this.deathPos.x + Math.sin(this.camOrbit) * 16, this.deathPos.y + 9, this.deathPos.z + Math.cos(this.camOrbit) * 16);
      lookAt.copy(this.deathPos).add(new THREE.Vector3(0, 1, 0));
    } else {
      this.camHeading = lerpAngle(this.camHeading, p.heading, 1 - Math.exp(-4.2 * dt));
      if (!this.camInit) {
        this.camHeading = p.heading;
        this.camInit = true;
      }
      const dist = 9.8 + spd * 0.05 + (p.boosting ? 1.5 : 0);
      const height = 4.7 + spd * 0.02 + Math.max(0, p.y) * 0.5;
      const fx = Math.sin(this.camHeading);
      const fz = Math.cos(this.camHeading);
      const side = p.drifting ? p.driftDir * 1.6 : 0;
      want.set(p.x - fx * dist - fz * side, p.y + height, p.z - fz * dist + fx * side);
      lookAt.set(p.x + fx * 5.5, p.y + 1.1, p.z + fz * 5.5);
      if (this.phase === "intro") {
        const t = clamp(1 - this.introT / INTRO_TIME, 0, 1);
        const e = t * t * (3 - 2 * t);
        const a = p.heading + Math.PI * (1.15 - 1.15 * e) + 0.4;
        const rad = 34 - 24 * e;
        const hh = 20 - 15 * e;
        const ox = p.x + Math.sin(a) * rad;
        const oz = p.z + Math.cos(a) * rad;
        want.lerpVectors(new THREE.Vector3(ox, hh + p.y, oz), want, e * e);
        targetFov = 55 + 13 * e;
      }
    }
    want.x = clamp(want.x, -this.boundX() + 1, this.boundX() - 1);
    want.z = clamp(want.z, -this.boundZ() + 1, this.boundZ() - 1);
    want.y = Math.max(1.8, want.y);
    if (this.camPos.lengthSq() === 0 || this.phase === "intro") this.camPos.copy(want);
    else {
      const k = 1 - Math.exp(-(p.alive ? 11 : 3) * dt);
      this.camPos.lerp(want, k);
    }
    cam.position.copy(this.camPos);
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const sh = this.trauma * this.trauma;
    const t = this.time * 38;
    cam.position.x += (Math.sin(t * 1.3) + Math.sin(t * 0.7 + 2)) * 0.5 * sh * 1.2;
    cam.position.y += (Math.sin(t * 1.1 + 1) + Math.sin(t * 1.9)) * 0.5 * sh * 0.9;
    cam.position.z += (Math.sin(t * 0.9 + 4) + Math.sin(t * 1.7)) * 0.5 * sh * 1.2;
    cam.lookAt(lookAt);
    cam.rotateZ(Math.sin(t * 0.8) * sh * 0.05);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    // light follows focus
    const fx = p.alive ? p.x : this.deathPos.x;
    const fz = p.alive ? p.z : this.deathPos.z;
    this.sun.position.set(fx + 28, 52, fz + 18);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.target.updateMatrixWorld();
  }

  private updateTags() {
    const p = this.player;
    for (const k of this.karts) {
      if (k.isPlayer || !k.alive) continue;
      const d = Math.hypot(k.x - p.x, k.z - p.z);
      const pr = this.project(k.x, k.y + 2.8, k.z);
      if (!pr.vis || d > 75) {
        k.tag.style.opacity = "0";
        continue;
      }
      k.tag.style.opacity = String(clamp(1.4 - d / 60, 0.35, 1));
      k.tag.style.transform = `translate(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px) translate(-50%, -100%)`;
      k.tagBar.style.width = `${clamp((k.hp / k.maxHp) * 100, 0, 100).toFixed(0)}%`;
    }
  }

  private updateReticle() {
    const p = this.player;
    const show = p.alive && this.phase === "playing" && !this.touch;
    this.reticle.visible = show;
    this.aimLine.visible = show;
    if (!show) return;
    const ax = p.input.aimX;
    const az = p.input.aimZ;
    const gy = this.arena.maxHeightAt(ax, az);
    this.reticle.position.set(ax, Math.max(gy, p.y) + 0.15, az);
    const pulse = 1 + Math.sin(this.time * 8) * 0.06 + (p.cooldown > 0 ? 0.25 * Math.min(1, p.cooldown * 3) : 0);
    this.reticle.scale.setScalar(pulse);
    this.reticle.rotation.y += 0.02;
    this.reticleMat.color.set(p.weapon ? WEAPONS[p.weapon].color : "#ffffff");
    const pos = this.aimLine.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, p.x, p.y + 0.9, p.z);
    pos.setXYZ(1, ax, Math.max(gy, p.y) + 0.3, az);
    pos.needsUpdate = true;
  }

  private updateAudio() {
    const p = this.player;
    const vf = Math.hypot(p.vx, p.vz);
    audio.setEngine(vf / 36, p.boosting, p.drifting && p.grounded ? clamp(vf / 30, 0, 1) : 0, p.alive && this.phase !== "intro");
  }

  private drawMinimap() {
    const g = this.mm;
    const cv = this.minimap;
    if (!g || !cv) return;
    const W = cv.width;
    const H = cv.height;
    const R = 52; // world radius shown
    const sc = W / 2 / R;
    const p = this.player;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const tx = (x: number, z: number): [number, number] => {
      const dx = x - p.x;
      const dz = z - p.z;
      const right = dx * -fz + dz * fx;
      const up = dx * fx + dz * fz;
      return [W / 2 + right * sc, H / 2 - up * sc];
    };
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath();
    g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "rgba(8,10,28,0.82)";
    g.fillRect(0, 0, W, H);
    // arena bounds
    const hfx = this.boundX();
    const hfz = this.boundZ();
    g.strokeStyle = "rgba(53,232,255,0.9)";
    g.lineWidth = 2;
    g.beginPath();
    [[-hfx, -hfz], [hfx, -hfz], [hfx, hfz], [-hfx, hfz]].forEach(([x, z], i) => {
      const [px, py] = tx(x, z);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
    g.stroke();
    // surfaces
    for (const s of this.arena.surfaces) {
      g.fillStyle = s.dir < 0 ? (s.h > 2.1 ? "rgba(120,140,255,0.5)" : "rgba(120,140,255,0.35)") : "rgba(255,170,60,0.45)";
      g.beginPath();
      [[s.x0, s.z0], [s.x1, s.z0], [s.x1, s.z1], [s.x0, s.z1]].forEach(([x, z], i) => {
        const [px, py] = tx(x, z);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.closePath();
      g.fill();
    }
    for (const pk of this.pickups) {
      if (!pk.active) continue;
      const [px, py] = tx(pk.zone.x, pk.zone.z);
      g.fillStyle = pk.load === "health" ? "#6dff6d" : WEAPONS[pk.load].color;
      g.fillRect(px - 2, py - 2, 4, 4);
    }
    for (const m of this.mines) {
      if (m.owner !== p && m.owner.team !== p.team) continue;
      const [px, py] = tx(m.x, m.z);
      g.fillStyle = "#ff3b5c";
      g.beginPath();
      g.arc(px, py, 2.2, 0, 7);
      g.fill();
    }
    for (const k of this.karts) {
      if (!k.alive || k === p) continue;
      const [px, py] = tx(k.x, k.z);
      const ally = p.team >= 0 && k.team === p.team;
      g.fillStyle = ally ? "#4aa8ff" : "#ff4a5a";
      g.beginPath();
      g.arc(px, py, 4, 0, 7);
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.6)";
      g.lineWidth = 1;
      g.stroke();
    }
    // player arrow
    g.fillStyle = "#ffe14d";
    g.beginPath();
    g.moveTo(W / 2, H / 2 - 8);
    g.lineTo(W / 2 + 6, H / 2 + 6);
    g.lineTo(W / 2, H / 2 + 3);
    g.lineTo(W / 2 - 6, H / 2 + 6);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = "rgba(53,232,255,0.8)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    g.stroke();
  }

  private buildHud(): HudState {
    const p = this.player;
    const rows: HudRow[] = this.karts
      .filter((k) => !k.tutorialTarget)
      .map((k) => ({ name: k.name, avatar: k.avatar, score: Math.round(k.score), kills: k.kills, team: k.team, isPlayer: k.isPlayer }))
      .sort((a, b) => b.score - a.score);
    let top = rows.slice(0, 5);
    if (!top.some((r) => r.isPlayer)) {
      const pr = rows.find((r) => r.isPlayer);
      if (pr) top = [...top.slice(0, 4), pr];
    }
    const def = p.weapon ? WEAPONS[p.weapon] : null;
    return {
      phase: this.phase,
      countdown: this.phase === "intro" ? Math.ceil(this.introT) : this.goT > 0 ? 0 : -1,
      timeLeft: this.mode === "survival" ? this.elapsed : this.timeLeft,
      hp: Math.max(0, p.hp),
      maxHp: p.maxHp,
      shield: p.shield,
      boostMeter: p.boostMeter,
      boosting: p.boosting,
      speed: Math.round(Math.hypot(p.vx, p.vz) * 4),
      weapon: def && p.weapon ? { id: p.weapon, ammo: p.ammo, maxAmmo: def.ammo } : null,
      cooldownFrac: def ? clamp(p.cooldown / def.cooldown, 0, 1) : 0,
      kills: p.kills,
      deaths: p.deaths,
      score: Math.round(p.score),
      streak: p.streak,
      alive: p.alive,
      respawnIn: p.alive ? 0 : Math.max(0, p.respawnT),
      lives: this.lives,
      wave: this.wave,
      mode: this.mode,
      teamScores: [this.teamScores[0], this.teamScores[1]],
      top,
      fps: Math.round(this.fps),
      driftLevel: p.drifting ? p.driftLevel + 1 : 0,
      playerTeam: p.team,
    };
  }
}

export { BOT_NAMES };
