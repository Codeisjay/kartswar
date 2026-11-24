import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { WeaponId } from "./types";

type DriverKind = "human" | "robot" | "alien" | "fox" | "dragon" | "unicorn" | "skeleton" | "panda" | "fire" | "bug" | "frog" | "ninja";
type RotationAxis = "x" | "y" | "z";

interface DriverStyle {
  kind: DriverKind;
  skin: number;
  suit: number;
  trim: number;
  hair: number;
  glove: number;
  eyes: number;
}

interface SwayPart {
  object: THREE.Object3D;
  axis: RotationAxis;
  base: number;
  amount: number;
  speed: number;
  phase: number;
}

const STYLES: Record<string, DriverStyle> = {
  "😎": { kind: "human", skin: 0xf3bd91, suit: 0x2868d8, trim: 0xffc33b, hair: 0x39263c, glove: 0x202c45, eyes: 0x242c38 },
  "🤖": { kind: "robot", skin: 0x9bb7c8, suit: 0x26354f, trim: 0x35e8ff, hair: 0x435979, glove: 0x35e8ff, eyes: 0x53f4ff },
  "👽": { kind: "alien", skin: 0x83df86, suit: 0x633bb5, trim: 0xe7d2ff, hair: 0x63c876, glove: 0x3e9f64, eyes: 0x172b2b },
  "🦊": { kind: "fox", skin: 0xf27b34, suit: 0x233d67, trim: 0xffd15c, hair: 0xd3542d, glove: 0x293653, eyes: 0x412b20 },
  "🐲": { kind: "dragon", skin: 0x55b85c, suit: 0x1e4d44, trim: 0xff8a30, hair: 0x27734b, glove: 0x19453c, eyes: 0xffd35a },
  "🦄": { kind: "unicorn", skin: 0xffd6e8, suit: 0x8c65c7, trim: 0xffdf6c, hair: 0xb882eb, glove: 0x7652af, eyes: 0x593b81 },
  "💀": { kind: "skeleton", skin: 0xe7e2ce, suit: 0x49365f, trim: 0xff4b57, hair: 0x34263f, glove: 0x31243f, eyes: 0x171820 },
  "🐼": { kind: "panda", skin: 0xf3f0e9, suit: 0x303a52, trim: 0xf6c84c, hair: 0x1c2028, glove: 0x222833, eyes: 0x1c2028 },
  "🔥": { kind: "fire", skin: 0xffa34f, suit: 0x8c2935, trim: 0xffda58, hair: 0xf04c24, glove: 0x4c2634, eyes: 0x7d231a },
  "👾": { kind: "bug", skin: 0x9f74e8, suit: 0x32306c, trim: 0x53f1dd, hair: 0x714ac0, glove: 0x34336d, eyes: 0x233b79 },
  "🐸": { kind: "frog", skin: 0x76ce52, suit: 0x235b43, trim: 0xffd34d, hair: 0x47a743, glove: 0x28543e, eyes: 0x28362a },
  "🥷": { kind: "ninja", skin: 0xe9b58e, suit: 0x26263b, trim: 0xe84657, hair: 0x151722, glove: 0x1b1c2b, eyes: 0x281e28 },
};

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
const sphereGeo = new THREE.SphereGeometry(1, 14, 10);
const smallSphereGeo = new THREE.SphereGeometry(1, 10, 8);
const headSphereGeo = new THREE.SphereGeometry(0.225, 16, 12);
const robotHeadGeo = new RoundedBoxGeometry(0.42, 0.39, 0.34, 4, 0.08);
const bugHeadGeo = new RoundedBoxGeometry(0.46, 0.38, 0.36, 5, 0.07);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const mouthGeo = new THREE.BoxGeometry(1, 1, 1);
const torsoGeo = new THREE.CapsuleGeometry(0.18, 0.22, 4, 10);
const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 9);
const earGeo = new THREE.ConeGeometry(0.095, 0.24, 7);
const hornGeo = new THREE.ConeGeometry(0.065, 0.22, 8);
const panelGeo = new RoundedBoxGeometry(0.28, 0.15, 0.035, 3, 0.025);
const eyeGeo = new THREE.SphereGeometry(1, 10, 8);
const flameGeo = new THREE.ConeGeometry(0.11, 0.34, 7);
const toothGeo = new THREE.ConeGeometry(0.035, 0.08, 5);
const upAxis = new THREE.Vector3(0, 1, 0);

const HEAD_SCALE: Record<DriverKind, [number, number, number]> = {
  human: [1.08, 1.08, 1.02],
  robot: [1.05, 1.05, 1.02],
  alien: [1.28, 1.48, 1.08],
  fox: [1.18, 1.12, 1.1],
  dragon: [1.24, 1.15, 1.12],
  unicorn: [1.12, 1.1, 1.08],
  skeleton: [1.08, 1.08, 1.02],
  panda: [1.18, 1.16, 1.1],
  fire: [1.2, 1.2, 1.12],
  bug: [1.08, 1.08, 1.04],
  frog: [1.24, 1.08, 1.16],
  ninja: [1.08, 1.08, 1.04],
};

function material(color: number, metalness = 0.06, roughness = 0.48, emissive = 0, emissiveIntensity = 0) {
  const key = `${color}:${metalness}:${roughness}:${emissive}:${emissiveIntensity}`;
  let result = materialCache.get(key);
  if (!result) {
    result = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      flatShading: false,
      emissive,
      emissiveIntensity,
    });
    materialCache.set(key, result);
  }
  return result;
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addInstancedMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, name: string) {
  const mesh = new THREE.InstancedMesh(geometry, mat, 2);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

export class DriverCharacter {
  readonly group = new THREE.Group();
  readonly torsoPivot = new THREE.Group();
  readonly headPivot = new THREE.Group();
  private readonly headMesh: THREE.Mesh;
  private readonly eyes: THREE.Mesh[] = [];
  private readonly pupils: THREE.Mesh[] = [];
  private readonly mouth: THREE.Mesh;
  private readonly upperArms: THREE.InstancedMesh;
  private readonly forearms: THREE.InstancedMesh;
  private readonly elbows: THREE.InstancedMesh;
  private readonly hands: THREE.InstancedMesh;
  private readonly thighs: THREE.InstancedMesh;
  private readonly shins: THREE.InstancedMesh;
  private readonly knees: THREE.InstancedMesh;
  private readonly boots: THREE.InstancedMesh;
  private readonly upperLeft = new THREE.Vector3();
  private readonly elbowLeft = new THREE.Vector3();
  private readonly handLeft = new THREE.Vector3();
  private readonly upperRight = new THREE.Vector3();
  private readonly elbowRight = new THREE.Vector3();
  private readonly handRight = new THREE.Vector3();
  private readonly hipLeft = new THREE.Vector3();
  private readonly kneeLeft = new THREE.Vector3();
  private readonly ankleLeft = new THREE.Vector3();
  private readonly hipRight = new THREE.Vector3();
  private readonly kneeRight = new THREE.Vector3();
  private readonly ankleRight = new THREE.Vector3();
  private readonly leftBootPosition = new THREE.Vector3(-0.12, 0.49, 0.45);
  private readonly rightBootPosition = new THREE.Vector3(0.12, 0.49, 0.45);
  private readonly segmentDirection = new THREE.Vector3();
  private readonly instanceTransform = new THREE.Object3D();
  private readonly style: DriverStyle;
  private readonly swayParts: SwayPart[] = [];
  private readonly flameTips: { mesh: THREE.Mesh; baseY: number; phase: number }[] = [];
  private smoothedAcceleration = 0;
  private smoothedTurn = 0;
  private wasGrounded = true;
  private jumpPulse = 0;
  private landingPulse = 0;
  private defeatTime = 0;
  readonly rightHandPosition = new THREE.Vector3();

  constructor(avatar: string) {
    this.style = STYLES[avatar] ?? STYLES["😎"];
    this.group.name = `driver-${this.style.kind}`;
    this.torsoPivot.position.set(0, 0.82, -0.08);
    this.group.add(this.torsoPivot);

    addMesh(this.torsoPivot, torsoGeo, material(this.style.suit), [0, 0.02, 0], [1, 1, 0.9]);
    addMesh(this.torsoPivot, panelGeo, material(this.style.trim, 0.22, 0.34), [0, 0.09, 0.16], [0.78, 0.78, 0.75]);
    addMesh(this.torsoPivot, cylinderGeo, material(this.style.trim, 0.18), [0, 0.3, 0.01], [0.1, 0.09, 0.1]);
    addMesh(this.torsoPivot, smallSphereGeo, material(this.style.trim, 0.28, 0.34), [0, 0.04, 0.19], [0.045, 0.045, 0.028]);
    this.addTorsoDetails();

    this.headPivot.position.set(0, 0.43, 0.01);
    this.torsoPivot.add(this.headPivot);
    const headGeometry = this.style.kind === "robot" ? robotHeadGeo : this.style.kind === "bug" ? bugHeadGeo : headSphereGeo;
    const headMaterial = this.style.kind === "fire"
      ? material(this.style.skin, 0.02, 0.3, 0xff5a12, 1.15)
      : material(this.style.skin, this.style.kind === "robot" ? 0.42 : 0.03);
    this.headMesh = addMesh(this.headPivot, headGeometry, headMaterial, [0, 0.04, 0], HEAD_SCALE[this.style.kind]);
    this.addHeadDetails();

    this.upperArms = addInstancedMesh(this.torsoPivot, cylinderGeo, material(this.style.suit), "driver-upper-arms");
    this.forearms = addInstancedMesh(this.torsoPivot, cylinderGeo, material(this.style.trim, 0.16), "driver-forearms");
    this.elbows = addInstancedMesh(this.torsoPivot, smallSphereGeo, material(this.style.suit), "driver-elbows");
    this.hands = addInstancedMesh(this.torsoPivot, sphereGeo, material(this.style.glove, 0.12), "driver-hands");

    const pants = material(this.style.hair, 0.04, 0.7);
    this.thighs = addInstancedMesh(this.group, cylinderGeo, pants, "driver-thighs");
    this.shins = addInstancedMesh(this.group, cylinderGeo, pants, "driver-shins");
    this.knees = addInstancedMesh(this.group, smallSphereGeo, pants, "driver-knees");
    const bootMat = material(0x171c2a, 0.18, 0.42);
    this.boots = addInstancedMesh(this.group, sphereGeo, bootMat, "driver-boots");

    this.mouth = addMesh(this.headPivot, mouthGeo, material(0x40252d), [0, -0.075, 0.19], [0.075, 0.018, 0.018]);
    this.mouth.name = "driver-mouth";
    if (this.style.kind === "frog" || this.style.kind === "dragon") this.mouth.scale.x = 0.18;
    if (this.style.kind === "fire") this.mouth.scale.x = 0.1;
    this.layoutLimbs(0, 0, 0);
    this.updateLegs();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.frustumCulled = true;
    });
    this.headMesh.name = "driver-head";
  }

  update(
    dt: number,
    time: number,
    acceleration: number,
    turn: number,
    verticalVelocity: number,
    grounded: boolean,
    weaponKick: number,
    hitAge: number,
    alive: boolean,
    weapon: WeaponId | null,
  ) {
    const safeDt = Math.max(0, Math.min(0.05, dt));
    const blend = 1 - Math.exp(-safeDt * 7);
    this.smoothedAcceleration += (THREE.MathUtils.clamp(acceleration / 28, -1, 1) - this.smoothedAcceleration) * blend;
    this.smoothedTurn += (THREE.MathUtils.clamp(turn, -1, 1) - this.smoothedTurn) * blend;

    if (this.wasGrounded && !grounded) this.jumpPulse = 1;
    if (!this.wasGrounded && grounded) this.landingPulse = 1;
    this.wasGrounded = grounded;
    this.jumpPulse *= Math.exp(-safeDt * 2.7);
    this.landingPulse *= Math.exp(-safeDt * 8);

    if (alive) this.defeatTime = 0;
    else this.defeatTime += safeDt;
    const defeat = alive ? 0 : THREE.MathUtils.smoothstep(this.defeatTime, 0, 0.72);
    const hit = hitAge >= 0 && hitAge < 0.7 ? Math.exp(-hitAge * 7) : 0;
    const fire = THREE.MathUtils.clamp(weaponKick, 0, 1) * (weapon === "mg" ? 0.62 : 1);
    const air = grounded ? 0 : THREE.MathUtils.clamp(verticalVelocity / 14, -1, 1);
    const breath = Math.sin(time * 2.5) * 0.012;

    this.torsoPivot.position.y = 0.82 + breath + this.jumpPulse * 0.055 - this.landingPulse * 0.06 - defeat * 0.08;
    this.torsoPivot.rotation.x = -this.smoothedAcceleration * 0.12 - air * 0.075 + this.landingPulse * 0.13 + hit * 0.15 + defeat * 0.34;
    this.torsoPivot.rotation.z = -this.smoothedTurn * 0.15 + hit * 0.12 + defeat * 0.24;
    this.torsoPivot.scale.y = 1 - this.landingPulse * 0.08 - defeat * 0.1;
    this.headPivot.rotation.x = -this.torsoPivot.rotation.x * 0.32 - this.jumpPulse * 0.08 + hit * 0.18 + defeat * 0.28;
    this.headPivot.rotation.y = this.smoothedTurn * 0.08;
    this.headPivot.rotation.z = -this.smoothedTurn * 0.1 + hit * 0.18 + defeat * 0.3;

    const blinkPhase = time % 4.8;
    const blink = blinkPhase < 0.18 ? 0.72 + 0.28 * (Math.abs(blinkPhase - 0.09) / 0.09) : 1;
    for (const eye of this.eyes) eye.scale.y = eye.userData.baseY * blink;
    for (const pupil of this.pupils) pupil.scale.y = pupil.userData.baseY * blink;
    this.mouth.scale.y = 0.018 * (1 + fire * 0.45 + this.landingPulse * 0.7 + hit * 0.25);
    this.headPivot.position.y = 0.43 + breath * 0.6 + this.jumpPulse * 0.025 - defeat * 0.035;
    const signatureMotion = 0.3 + Math.min(1, Math.abs(this.smoothedAcceleration) * 0.45 + Math.abs(this.smoothedTurn) * 0.35 + fire * 0.3 + hit * 0.25);
    for (const part of this.swayParts) {
      const angle = part.base + Math.sin(time * part.speed + part.phase) * part.amount * signatureMotion;
      if (part.axis === "x") part.object.rotation.x = angle;
      else if (part.axis === "y") part.object.rotation.y = angle;
      else part.object.rotation.z = angle;
    }
    for (const tip of this.flameTips) {
      tip.mesh.scale.y = tip.baseY * (0.9 + Math.sin(time * 17 + tip.phase) * 0.12 + fire * 0.12 + hit * 0.06);
      tip.mesh.rotation.z = Math.sin(time * 12 + tip.phase) * 0.08;
    }

    this.layoutLimbs(this.smoothedTurn, fire, defeat);
    const pedal = THREE.MathUtils.clamp(Math.abs(this.smoothedAcceleration), 0, 1) * 0.025;
    this.kneeLeft.z = 0.18 + pedal + this.jumpPulse * 0.025;
    this.kneeRight.z = 0.18 + pedal + this.jumpPulse * 0.025;
    this.updateLegs();
  }

  private addSway(object: THREE.Object3D, axis: RotationAxis, amount: number, speed: number, phase = this.swayParts.length * 1.73) {
    const base = axis === "x" ? object.rotation.x : axis === "y" ? object.rotation.y : object.rotation.z;
    this.swayParts.push({ object, axis, base, amount, speed, phase });
  }

  private addTorsoDetails() {
    const kind = this.style.kind;
    const trim = material(this.style.trim, 0.18, 0.38);
    const skin = material(this.style.skin);
    if (kind === "robot") {
      const core = addMesh(this.torsoPivot, sphereGeo, material(this.style.eyes, 0.15, 0.24, this.style.eyes, 0.9), [0, 0.08, 0.222], [0.075, 0.075, 0.035]);
      core.name = "driver-robot-chest-core";
      for (const side of [-1, 1]) {
        const shoulder = addMesh(this.torsoPivot, sphereGeo, skin, [side * 0.2, 0.15, 0], [0.13, 0.13, 0.13]);
        shoulder.name = `driver-robot-shoulder-${side}`;
      }
    } else if (kind === "alien") {
      const badge = addMesh(this.torsoPivot, sphereGeo, material(0x9cff73, 0.1, 0.3, 0x53ff53, 0.65), [0, 0.08, 0.22], [0.09, 0.07, 0.035]);
      badge.name = "driver-alien-chest-badge";
    } else if (kind === "fox" || kind === "panda") {
      const bib = addMesh(this.torsoPivot, sphereGeo, material(kind === "fox" ? 0xffe6c6 : 0xf3f0e9), [0, -0.045, 0.18], [0.13, 0.17, 0.055]);
      bib.name = `driver-${kind}-chest-bib`;
      if (kind === "fox") {
        const tail = new THREE.Group();
        tail.name = "driver-fox-tail";
        tail.position.set(0, -0.06, -0.22);
        this.torsoPivot.add(tail);
        addMesh(tail, sphereGeo, material(this.style.hair), [0, 0, -0.12], [0.14, 0.15, 0.27]);
        const tip = addMesh(tail, sphereGeo, material(0xffe6c6), [0, 0, -0.32], [0.105, 0.11, 0.12]);
        tip.name = "driver-fox-tail-tip";
        this.addSway(tail, "x", 0.2, 4.4);
      }
    } else if (kind === "dragon") {
      for (let row = 0; row < 3; row++) {
        const scale = 0.055 - row * 0.008;
        const plate = addMesh(this.torsoPivot, smallSphereGeo, trim, [0, 0.12 - row * 0.075, 0.21], [scale, scale, 0.025]);
        plate.name = `driver-dragon-chest-scale-${row}`;
      }
      for (const side of [-1, 1]) {
        const wing = addMesh(this.torsoPivot, earGeo, material(this.style.hair), [side * 0.22, 0.13, -0.015], [1.25, 1.35, 0.6]);
        wing.rotation.z = side * -0.8;
        wing.name = `driver-dragon-wing-${side}`;
        this.addSway(wing, "z", 0.28, 8, side * 0.7);
      }
    } else if (kind === "unicorn") {
      const jewel = addMesh(this.torsoPivot, smallSphereGeo, material(0xffe67b, 0.28, 0.26, 0xffbf38, 0.45), [0, 0.08, 0.22], [0.06, 0.07, 0.035]);
      jewel.name = "driver-unicorn-jewel";
    } else if (kind === "skeleton") {
      for (let row = 0; row < 3; row++) {
        const rib = addMesh(this.torsoPivot, panelGeo, material(0xe7e2ce), [0, 0.13 - row * 0.085, 0.17], [0.62 - row * 0.06, 0.38, 0.5]);
        rib.name = `driver-skeleton-rib-${row}`;
      }
    } else if (kind === "fire") {
      const ember = addMesh(this.torsoPivot, sphereGeo, material(0xffdd56, 0.02, 0.25, 0xff6a00, 1.1), [0, 0.08, 0.22], [0.085, 0.1, 0.04]);
      ember.name = "driver-fire-ember";
    } else if (kind === "bug") {
      for (const side of [-1, 1]) {
        const plate = addMesh(this.torsoPivot, sphereGeo, trim, [side * 0.17, 0.07, 0.11], [0.13, 0.18, 0.06]);
        plate.name = `driver-bug-chitin-${side}`;
      }
    } else if (kind === "frog") {
      const throat = addMesh(this.torsoPivot, sphereGeo, material(0x9ce65e), [0, -0.06, 0.19], [0.14, 0.15, 0.045]);
      throat.name = "driver-frog-throat";
      this.addSway(throat, "y", 0.08, 3.2);
    } else if (kind === "ninja") {
      const sash = addMesh(this.torsoPivot, panelGeo, material(this.style.trim), [0, -0.12, 0.2], [0.92, 0.62, 0.7]);
      sash.rotation.z = -0.12;
      sash.name = "driver-ninja-sash";
    } else if (kind === "human") {
      const zipper = addMesh(this.torsoPivot, cylinderGeo, trim, [0, 0.04, 0.22], [0.018, 0.2, 0.018]);
      zipper.name = "driver-human-suit-zipper";
    }
  }

  private addHeadDetails() {
    const kind = this.style.kind;
    const skin = material(this.style.skin, kind === "fire" ? 0.02 : 0.03, kind === "fire" ? 0.3 : 0.48, kind === "fire" ? 0xff5a12 : 0, kind === "fire" ? 0.8 : 0);
    const dark = material(this.style.hair, 0.04, 0.65);
    const white = material(0xfff7e9, 0.02, 0.35);
    const alienEye = material(0x111a2b, 0.12, 0.16, 0x31526d, 0.22);
    const fireEye = material(0xffdc59, 0.02, 0.22, 0xff8a18, 1.4);
    const pupilMat = material(
      kind === "alien" ? 0x111a2b : kind === "fire" ? 0xffdc59 : this.style.eyes,
      kind === "robot" ? 0.15 : 0.02,
      0.22,
      kind === "robot" ? this.style.eyes : kind === "fire" ? 0xff8a18 : 0,
      kind === "robot" ? 0.7 : kind === "fire" ? 1.4 : 0,
    );

    if (kind === "human") {
      const hair = addMesh(this.headPivot, sphereGeo, dark, [0, 0.17, -0.035], [0.235, 0.12, 0.22]);
      hair.name = "driver-human-hair";
      for (const side of [-1, 1]) {
        const lens = addMesh(this.headPivot, panelGeo, material(0x101c2c, 0.35, 0.18), [side * 0.078, 0.075, 0.274], [0.68, 0.7, 0.72]);
        lens.name = `driver-human-sunglasses-${side}`;
        this.addSway(lens, "y", 0.018, 2.4, side * 0.8);
        addMesh(this.headPivot, smallSphereGeo, material(0xffffff, 0.1, 0.12, 0x83eaff, 0.35), [side * 0.078 - 0.018, 0.092, 0.299], [0.018, 0.012, 0.008]);
      }
      const bridge = addMesh(this.headPivot, boxGeo, dark, [0, 0.08, 0.276], [0.08, 0.025, 0.025]);
      bridge.name = "driver-human-glasses-bridge";
    } else if (kind === "robot") {
      const face = addMesh(this.headPivot, panelGeo, material(0x13233a, 0.36, 0.28), [0, 0.035, 0.169], [0.9, 0.78, 0.52]);
      face.name = "driver-robot-face-screen";
      for (const side of [-1, 1]) {
        const ear = addMesh(this.headPivot, sphereGeo, material(this.style.hair, 0.48, 0.28), [side * 0.22, 0.02, 0], [0.07, 0.11, 0.09]);
        ear.name = `driver-robot-ear-${side}`;
      }
      const antenna = new THREE.Group();
      antenna.name = "driver-robot-antenna";
      antenna.position.set(0, 0.23, -0.01);
      this.headPivot.add(antenna);
      addMesh(antenna, cylinderGeo, material(this.style.trim, 0.4), [0, 0.07, 0], [0.025, 0.14, 0.025]);
      addMesh(antenna, smallSphereGeo, material(0xff5d68, 0.1, 0.28, 0xff2535, 1.3), [0, 0.16, 0], [0.055, 0.055, 0.055]);
      this.addSway(antenna, "z", 0.12, 5);
    } else if (kind === "alien") {
      for (const side of [-1, 1]) {
        const antenna = new THREE.Group();
        antenna.name = `driver-alien-antenna-${side}`;
        antenna.position.set(side * 0.14, 0.31, -0.01);
        this.headPivot.add(antenna);
        const stem = addMesh(antenna, cylinderGeo, material(this.style.hair), [0, 0.055, 0], [0.018, 0.11, 0.018]);
        stem.rotation.z = side * -0.2;
        const tip = addMesh(antenna, smallSphereGeo, material(this.style.trim, 0.08, 0.25, this.style.trim, 0.5), [side * 0.018, 0.12, 0], [0.04, 0.04, 0.04]);
        tip.name = `driver-alien-antenna-tip-${side}`;
        this.addSway(antenna, "z", 0.16, 3.5, side * 0.8);
      }
    } else if (kind === "fox" || kind === "dragon" || kind === "unicorn") {
      for (const side of [-1, 1]) {
        const earMaterial = kind === "dragon" ? material(this.style.trim) : material(this.style.hair);
        const ear = addMesh(this.headPivot, earGeo, earMaterial, [side * 0.155, 0.2, -0.015], [kind === "fox" ? 1.05 : 0.82, kind === "dragon" ? 0.95 : 1.05, 0.8]);
        ear.rotation.z = side * -0.22;
        ear.name = `driver-${kind}-ear-${side}`;
        this.addSway(ear, "z", 0.045, 3.1, side);
        if (kind === "fox") {
          const innerEar = addMesh(this.headPivot, earGeo, material(0xffdfcf), [side * 0.155, 0.21, 0.018], [0.38, 0.58, 0.42]);
          innerEar.rotation.z = side * -0.22;
        }
      }
      if (kind === "dragon") {
        const centerHorn = addMesh(this.headPivot, hornGeo, material(this.style.trim, 0.28, 0.32), [0, 0.25, 0.015], [1, 1.35, 1]);
        centerHorn.name = "driver-dragon-center-horn";
        for (const side of [-1, 1]) {
          const horn = addMesh(this.headPivot, hornGeo, dark, [side * 0.15, 0.2, -0.015], [0.72, 0.8, 0.72]);
          horn.rotation.z = side * -0.4;
          horn.name = `driver-dragon-horn-${side}`;
        }
      } else if (kind === "unicorn") {
        const horn = addMesh(this.headPivot, hornGeo, material(this.style.trim, 0.35, 0.24, 0xffd24f, 0.35), [0, 0.27, 0.015], [1, 1.55, 1]);
        horn.name = "driver-unicorn-horn";
        for (const side of [-1, 1]) {
          const curl = addMesh(this.headPivot, sphereGeo, dark, [side * 0.17, 0.1, -0.07], [0.1, 0.15, 0.12]);
          curl.name = `driver-unicorn-mane-${side}`;
          this.addSway(curl, "z", 0.07, 2.8, side);
        }
        const forelock = addMesh(this.headPivot, sphereGeo, dark, [0, 0.18, 0.12], [0.16, 0.09, 0.12]);
        forelock.name = "driver-unicorn-forelock";
      }
    } else if (kind === "skeleton") {
      for (const side of [-1, 1]) {
        const socket = addMesh(this.headPivot, sphereGeo, dark, [side * 0.078, 0.075, 0.225], [0.085, 0.09, 0.045]);
        socket.name = `driver-skeleton-eye-socket-${side}`;
      }
      const nose = addMesh(this.headPivot, toothGeo, dark, [0, -0.005, 0.205], [0.75, 0.65, 0.75]);
      nose.rotation.x = Math.PI / 2;
      nose.name = "driver-skeleton-nose";
      for (let tooth = 0; tooth < 4; tooth++) {
        const fang = addMesh(this.headPivot, toothGeo, white, [-0.07 + tooth * 0.047, -0.105, 0.205], [0.7, 0.55, 0.5]);
        fang.name = `driver-skeleton-tooth-${tooth}`;
      }
    } else if (kind === "panda") {
      for (const side of [-1, 1]) {
        const ear = addMesh(this.headPivot, sphereGeo, dark, [side * 0.17, 0.2, -0.02], [0.105, 0.11, 0.09]);
        ear.name = `driver-panda-ear-${side}`;
        this.addSway(ear, "z", 0.04, 2.8, side);
        const patch = addMesh(this.headPivot, sphereGeo, dark, [side * 0.078, 0.075, 0.225], [0.084, 0.096, 0.045]);
        patch.rotation.z = side * -0.25;
        patch.name = `driver-panda-eye-patch-${side}`;
      }
    } else if (kind === "fire") {
      const fireCore = addMesh(this.headPivot, sphereGeo, material(0xffc33c, 0.02, 0.25, 0xff7a12, 1.1), [0, 0.02, 0.202], [0.13, 0.105, 0.035]);
      fireCore.name = "driver-fire-face-glow";
      for (let index = 0; index < 4; index++) {
        const side = index < 2 ? -1 : 1;
        const tip = addMesh(
          this.headPivot,
          flameGeo,
          material(index === 1 || index === 2 ? 0xffd34d : this.style.hair, 0.02, 0.25, 0xff4b0d, 1.4),
          [side * (index % 2 ? 0.09 : 0.16), index % 2 ? 0.23 : 0.17, -0.035],
          [index % 2 ? 0.82 : 1, index % 2 ? 0.85 : 1, 0.9],
        );
        tip.rotation.z = side * (index % 2 ? 0.25 : -0.18);
        tip.name = `driver-fire-tip-${index}`;
        this.flameTips.push({ mesh: tip, baseY: tip.scale.y, phase: index * 1.57 });
      }
    } else if (kind === "bug") {
      for (const side of [-1, 1]) {
        const antenna = new THREE.Group();
        antenna.name = `driver-bug-antenna-${side}`;
        antenna.position.set(side * 0.15, 0.22, -0.005);
        this.headPivot.add(antenna);
        const stem = addMesh(antenna, cylinderGeo, dark, [side * 0.025, 0.09, 0], [0.018, 0.18, 0.018]);
        stem.rotation.z = side * -0.2;
        const tip = addMesh(antenna, sphereGeo, material(this.style.trim, 0.12, 0.24, this.style.trim, 0.5), [side * 0.055, 0.18, 0], [0.06, 0.045, 0.045]);
        tip.name = `driver-bug-antenna-tip-${side}`;
        const sideEye = addMesh(this.headPivot, eyeGeo, pupilMat, [side * 0.18, 0.015, 0.205], [0.035, 0.035, 0.025]);
        sideEye.name = `driver-bug-side-eye-${side}`;
        this.addSway(antenna, "z", 0.15, 4.1, side);
      }
      for (const side of [-1, 1]) {
        const mandible = addMesh(this.headPivot, hornGeo, material(this.style.trim), [side * 0.07, -0.105, 0.12], [0.5, 0.65, 0.55]);
        mandible.rotation.z = side * -0.6;
        mandible.name = `driver-bug-mandible-${side}`;
      }
    } else if (kind === "frog") {
      for (const side of [-1, 1]) {
        const eyePod = addMesh(this.headPivot, sphereGeo, skin, [side * 0.115, 0.155, 0.225], [0.092, 0.105, 0.09]);
        eyePod.name = `driver-frog-eye-stalk-${side}`;
        this.addSway(eyePod, "z", 0.035, 3.5, side * 0.8);
      }
    } else if (kind === "ninja") {
      const hood = addMesh(this.headPivot, sphereGeo, dark, [0, 0.07, -0.035], [0.245, 0.235, 0.22]);
      hood.name = "driver-ninja-hood";
      const mask = addMesh(this.headPivot, panelGeo, material(this.style.hair), [0, -0.075, 0.17], [1.0, 0.58, 0.65]);
      mask.name = "driver-ninja-face-wrap";
      const headband = addMesh(this.headPivot, panelGeo, material(this.style.trim), [0, 0.17, 0.085], [1.35, 0.3, 0.6]);
      headband.name = "driver-ninja-headband";
      for (const side of [-1, 1]) {
        const tail = addMesh(this.headPivot, panelGeo, material(this.style.trim), [side * 0.19, 0.13, -0.075], [1.15, 0.28, 0.45]);
        tail.rotation.y = side * -0.65;
        tail.rotation.z = side * 0.12;
        tail.name = `driver-ninja-headband-tail-${side}`;
        this.addSway(tail, "z", 0.3, 7, side * 0.8);
      }
    }

    const eyeX = kind === "alien" || kind === "frog" ? 0.105 : kind === "bug" ? 0.085 : 0.078;
    const eyeY = kind === "frog" ? 0.155 : kind === "alien" ? 0.065 : 0.075;
    const eyeZ = kind === "robot" ? 0.195 : kind === "bug" ? 0.215 : kind === "panda" || kind === "skeleton" ? 0.285 : 0.245;
    const eyeScale: [number, number, number] = kind === "alien"
      ? [0.065, 0.11, 0.032]
      : kind === "frog"
        ? [0.054, 0.059, 0.028]
        : kind === "ninja"
          ? [0.047, 0.035, 0.026]
          : [0.045, 0.052, 0.024];

    for (const side of [-1, 1]) {
      const eyeMaterial = kind === "robot" ? pupilMat : kind === "alien" ? alienEye : kind === "fire" ? fireEye : white;
      const eye = addMesh(this.headPivot, eyeGeo, eyeMaterial, [side * eyeX, eyeY, eyeZ], eyeScale);
      eye.name = `driver-eye-${side}`;
      eye.userData.baseY = eye.scale.y;
      this.eyes.push(eye);
      if (kind !== "robot" && kind !== "alien" && kind !== "fire") {
        const pupil = addMesh(this.headPivot, eyeGeo, pupilMat, [side * eyeX, eyeY, eyeZ + 0.023], [0.023, 0.028, 0.012]);
        pupil.name = `driver-pupil-${side}`;
        pupil.userData.baseY = pupil.scale.y;
        this.pupils.push(pupil);
      } else if (kind === "alien") {
        addMesh(this.headPivot, smallSphereGeo, white, [side * eyeX - 0.018, eyeY + 0.028, eyeZ + 0.024], [0.014, 0.018, 0.01]);
      }
    }

    if (kind === "fox" || kind === "dragon" || kind === "panda" || kind === "frog") {
      const muzzleColor = kind === "fox" ? white : kind === "panda" ? white : skin;
      const muzzle = addMesh(this.headPivot, sphereGeo, muzzleColor, [0, -0.025, 0.19], [kind === "frog" ? 0.16 : 0.12, 0.075, 0.075]);
      muzzle.name = `driver-${kind}-muzzle`;
      const nose = addMesh(this.headPivot, smallSphereGeo, material(kind === "frog" ? 0x327b32 : 0x39242a), [0, -0.005, 0.252], [0.028, 0.02, 0.018]);
      nose.name = `driver-${kind}-nose`;
    } else if (kind === "human") {
      const nose = addMesh(this.headPivot, smallSphereGeo, skin, [0, 0.005, 0.207], [0.035, 0.04, 0.035]);
      nose.name = "driver-human-nose";
    }

    if (kind === "skeleton") {
      const jaw = addMesh(this.headPivot, panelGeo, dark, [0, -0.105, 0.16], [0.76, 0.36, 0.44]);
      jaw.name = "driver-skeleton-jaw";
      this.addSway(jaw, "x", 0.09, 4.5);
    }
  }

  private layoutLimbs(turn: number, fire: number, defeat: number) {
    const leftSide = -1;
    const rightSide = 1;
    const wheelAngle = turn * 0.28;
    const c = Math.cos(wheelAngle);
    const s = Math.sin(wheelAngle);
    this.upperLeft.set(leftSide * 0.2, 0.2, -0.015);
    this.elbowLeft.set(leftSide * 0.31 + turn * 0.035, 0.07 - defeat * 0.1, 0.25);
    this.handLeft.set(leftSide * 0.23 * c, 0.1 + leftSide * 0.23 * s, 0.57);
    this.upperRight.set(rightSide * 0.2, 0.2, -0.015);
    this.elbowRight.set(rightSide * 0.31 + turn * 0.035, 0.07 - defeat * 0.1, 0.25);
    this.handRight.set(
      rightSide * (0.23 * c * (1 - fire * 0.65) + 0.09 * fire),
      0.1 + rightSide * 0.23 * s + fire * 0.12 - defeat * 0.15,
      0.57 - fire * 0.2,
    );

    if (defeat > 0) {
      this.handLeft.x += defeat * -0.16;
      this.handLeft.z -= defeat * 0.18;
      this.handRight.x += defeat * 0.16;
      this.handRight.z -= defeat * 0.18;
    }
    this.setInstanceBone(this.upperArms, 0, this.upperLeft, this.elbowLeft, 0.072);
    this.setInstanceBone(this.forearms, 0, this.elbowLeft, this.handLeft, 0.058);
    this.setInstanceBone(this.upperArms, 1, this.upperRight, this.elbowRight, 0.072);
    this.setInstanceBone(this.forearms, 1, this.elbowRight, this.handRight, 0.058);
    this.setInstanceSphere(this.elbows, 0, this.elbowLeft, [0.082, 0.082, 0.082]);
    this.setInstanceSphere(this.elbows, 1, this.elbowRight, [0.082, 0.082, 0.082]);
    this.setInstanceSphere(this.hands, 0, this.handLeft, [0.09, 0.075, 0.09]);
    this.setInstanceSphere(this.hands, 1, this.handRight, [0.09, 0.075, 0.09]);
    this.rightHandPosition.copy(this.handRight);
  }

  private updateLegs() {
    this.hipLeft.set(-0.11, 0.77, -0.06);
    this.hipRight.set(0.11, 0.77, -0.06);
    this.kneeLeft.y = 0.64;
    this.kneeRight.y = 0.64;
    this.ankleLeft.set(-0.12, 0.51, 0.38);
    this.ankleRight.set(0.12, 0.51, 0.38);
    this.setInstanceBone(this.thighs, 0, this.hipLeft, this.kneeLeft, 0.095);
    this.setInstanceBone(this.thighs, 1, this.hipRight, this.kneeRight, 0.095);
    this.setInstanceBone(this.shins, 0, this.kneeLeft, this.ankleLeft, 0.068);
    this.setInstanceBone(this.shins, 1, this.kneeRight, this.ankleRight, 0.068);
    this.setInstanceSphere(this.knees, 0, this.kneeLeft, [0.09, 0.09, 0.09]);
    this.setInstanceSphere(this.knees, 1, this.kneeRight, [0.09, 0.09, 0.09]);
    this.setInstanceSphere(this.boots, 0, this.leftBootPosition, [0.11, 0.07, 0.18]);
    this.setInstanceSphere(this.boots, 1, this.rightBootPosition, [0.11, 0.07, 0.18]);
  }

  private setInstanceBone(mesh: THREE.InstancedMesh, index: number, start: THREE.Vector3, end: THREE.Vector3, radius: number) {
    this.segmentDirection.subVectors(end, start);
    const length = this.segmentDirection.length();
    this.instanceTransform.position.copy(start).add(end).multiplyScalar(0.5);
    if (length > 0.0001) {
      this.instanceTransform.quaternion.setFromUnitVectors(upAxis, this.segmentDirection.multiplyScalar(1 / length));
      this.instanceTransform.scale.set(radius, length, radius);
    }
    this.instanceTransform.updateMatrix();
    mesh.setMatrixAt(index, this.instanceTransform.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private setInstanceSphere(mesh: THREE.InstancedMesh, index: number, position: THREE.Vector3, scale: [number, number, number]) {
    this.instanceTransform.position.copy(position);
    this.instanceTransform.quaternion.identity();
    this.instanceTransform.scale.set(...scale);
    this.instanceTransform.updateMatrix();
    mesh.setMatrixAt(index, this.instanceTransform.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }
}
