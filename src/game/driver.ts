import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { WeaponId } from "./types";

type DriverKind = "human" | "robot" | "alien" | "fox" | "dragon" | "unicorn" | "skeleton" | "panda" | "fire" | "bug" | "frog" | "ninja";

interface DriverStyle {
  kind: DriverKind;
  skin: number;
  suit: number;
  trim: number;
  hair: number;
  glove: number;
  eyes: number;
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
const mouthGeo = new THREE.BoxGeometry(1, 1, 1);
const torsoGeo = new THREE.CapsuleGeometry(0.18, 0.22, 4, 10);
const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 9);
const earGeo = new THREE.ConeGeometry(0.095, 0.24, 7);
const hornGeo = new THREE.ConeGeometry(0.065, 0.22, 8);
const panelGeo = new RoundedBoxGeometry(0.28, 0.15, 0.035, 3, 0.025);
const eyeGeo = new THREE.SphereGeometry(1, 10, 8);
const upAxis = new THREE.Vector3(0, 1, 0);

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

    this.headPivot.position.set(0, 0.43, 0.01);
    this.torsoPivot.add(this.headPivot);
    const headGeometry = this.style.kind === "robot" ? robotHeadGeo : headSphereGeo;
    this.headMesh = addMesh(this.headPivot, headGeometry, material(this.style.skin, this.style.kind === "robot" ? 0.42 : 0.03), [0, 0.04, 0], [1, 1.04, 0.96]);
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
    const blink = blinkPhase < 0.18 ? 1 - 0.88 * (1 - Math.abs(blinkPhase - 0.09) / 0.09) : 1;
    for (const eye of this.eyes) eye.scale.y = eye.userData.baseY * blink;
    for (const pupil of this.pupils) pupil.scale.y = pupil.userData.baseY * blink;
    this.mouth.scale.y = 0.018 * (1 + fire * 0.45 + this.landingPulse * 0.7 + hit * 0.25);

    this.layoutLimbs(this.smoothedTurn, fire, defeat);
    const pedal = THREE.MathUtils.clamp(Math.abs(this.smoothedAcceleration), 0, 1) * 0.025;
    this.kneeLeft.z = 0.18 + pedal + this.jumpPulse * 0.025;
    this.kneeRight.z = 0.18 + pedal + this.jumpPulse * 0.025;
    this.updateLegs();
  }

  private addHeadDetails() {
    const kind = this.style.kind;
    const skin = material(this.style.skin);
    const dark = material(this.style.hair, 0.04, 0.65);
    const white = material(0xfff7e9, 0.02, 0.35);
    const pupilMat = material(
      this.style.eyes,
      kind === "robot" ? 0.15 : 0.02,
      0.25,
      kind === "robot" || kind === "alien" ? this.style.eyes : 0,
      kind === "robot" || kind === "alien" ? 0.7 : 0,
    );

    if (["fox", "dragon", "unicorn", "panda", "frog"].includes(kind)) {
      for (const side of [-1, 1]) {
        const earMaterial = kind === "panda" ? dark : material(kind === "dragon" ? this.style.trim : this.style.hair);
        const earGeometry = kind === "panda" ? sphereGeo : earGeo;
        const ear = addMesh(this.headPivot, earGeometry, earMaterial, [side * 0.155, 0.2, -0.015], kind === "panda" ? [0.11, 0.11, 0.09] : [0.78, 0.9, 0.78]);
        ear.rotation.z = side * -0.22;
        if (kind === "fox") {
          addMesh(this.headPivot, earGeo, material(0xffdfcf), [side * 0.155, 0.21, 0.012], [0.35, 0.5, 0.38]);
        }
      }
    } else if (kind === "human" || kind === "ninja") {
      addMesh(this.headPivot, sphereGeo, dark, [0, 0.165, -0.035], [0.235, 0.12, 0.22]);
      if (kind === "ninja") {
        addMesh(this.headPivot, panelGeo, material(this.style.hair), [0, -0.075, 0.158], [0.92, 0.45, 0.65]);
        addMesh(this.headPivot, smallSphereGeo, material(this.style.trim), [0.17, 0.18, 0.02], [0.035, 0.035, 0.035]);
      }
    } else if (kind === "robot") {
      addMesh(this.headPivot, panelGeo, material(0x13233a, 0.36, 0.28), [0, 0.035, 0.169], [0.9, 0.78, 0.52]);
      addMesh(this.headPivot, cylinderGeo, material(this.style.trim, 0.4), [0, 0.285, -0.015], [0.025, 0.12, 0.025]);
      addMesh(this.headPivot, smallSphereGeo, material(0xff5d68, 0.1, 0.28, 0xff2535, 1.3), [0, 0.36, -0.015], [0.055, 0.055, 0.055]);
    } else if (kind === "alien" || kind === "bug") {
      for (const side of [-1, 1]) {
        addMesh(this.headPivot, cylinderGeo, material(this.style.hair), [side * 0.15, 0.235, -0.01], [0.018, 0.11, 0.018]);
        addMesh(this.headPivot, smallSphereGeo, material(this.style.trim), [side * 0.15, 0.3, -0.01], [0.045, 0.045, 0.045]);
      }
    }

    if (kind === "dragon" || kind === "fire" || kind === "unicorn") {
      addMesh(this.headPivot, hornGeo, material(this.style.trim, 0.28, 0.32), [0, 0.25, 0.015], [1, kind === "unicorn" ? 1.35 : 1, 1]);
      if (kind !== "unicorn") {
        for (const side of [-1, 1]) {
          const horn = addMesh(this.headPivot, hornGeo, material(this.style.hair), [side * 0.15, 0.2, -0.015], [0.72, 0.8, 0.72]);
          horn.rotation.z = side * -0.4;
        }
      }
    }

    if (kind === "panda" || kind === "skeleton") {
      for (const side of [-1, 1]) {
        addMesh(this.headPivot, sphereGeo, dark, [side * 0.078, 0.075, 0.155], [0.085, 0.09, 0.045]);
      }
    }

    const eyeScale: [number, number, number] = kind === "alien" || kind === "frog" ? [0.062, 0.068, 0.026] : [0.045, 0.052, 0.024];
    for (const side of [-1, 1]) {
      const eyeMaterial = kind === "robot" ? pupilMat : white;
      const eye = addMesh(this.headPivot, eyeGeo, eyeMaterial, [side * 0.078, 0.075, 0.195], eyeScale);
      eye.userData.baseY = eye.scale.y;
      this.eyes.push(eye);
      if (kind !== "robot") {
        const pupil = addMesh(this.headPivot, eyeGeo, pupilMat, [side * 0.078, 0.074, 0.218], [0.023, 0.028, 0.012]);
        pupil.userData.baseY = pupil.scale.y;
        this.pupils.push(pupil);
      }
    }

    if (["fox", "dragon", "unicorn", "panda", "frog"].includes(kind)) {
      addMesh(this.headPivot, sphereGeo, kind === "fox" ? white : skin, [0, -0.025, 0.19], [0.12, 0.075, 0.075]);
      addMesh(this.headPivot, smallSphereGeo, material(0x39242a), [0, -0.005, 0.252], [0.028, 0.02, 0.018]);
    } else if (kind !== "robot" && kind !== "ninja") {
      addMesh(this.headPivot, smallSphereGeo, skin, [0, 0.005, 0.207], [0.035, 0.04, 0.035]);
    }

    if (kind === "skeleton") {
      addMesh(this.headPivot, panelGeo, dark, [0, -0.11, 0.16], [0.72, 0.36, 0.42]);
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
