import * as THREE from "three";
import type { Arena, Hazard, PickupZone, SpawnPoint } from "../arena";
import {
  Kit, canvasTex, makeSky, mulberry32, validateZones, type MapQuality,
} from "./common";

const HALF_X = 112;
const HALF_Z = 92;
const WATER_LEVEL = 0.08;

const ALPINE_HILLS = [
  { x: -58, z: -54, rx: 31, rz: 28, height: 10 },
  { x: 58, z: -54, rx: 31, rz: 28, height: 10 },
  { x: -58, z: 54, rx: 31, rz: 28, height: 10 },
  { x: 58, z: 54, rx: 31, rz: 28, height: 10 },
  { x: 0, z: -57, rx: 26, rz: 20, height: 6 },
  { x: 0, z: 57, rx: 26, rz: 20, height: 6 },
] as const;

export const ALPINE_LAKES = [
  { x: 0, z: 0, rx: 25, rz: 24, depth: 4.2, seed: 2.6 },
] as const;

export const ALPINE_ISLANDS = [
  { x: -8, z: -5, rx: 4.6, rz: 3.8, height: 6.4 },
  { x: 8, z: 7, rx: 3.6, rz: 3.2, height: 5.8 },
] as const;
const TREE_HEIGHTS = [7.6, 8.3, 6.9] as const;

export function alpineTerrainHeight(x: number, z: number) {
  let height = 0;
  for (const hill of ALPINE_HILLS) {
    const dx = (x - hill.x) / hill.rx;
    const dz = (z - hill.z) / hill.rz;
    const falloff = Math.max(0, 1 - dx * dx - dz * dz);
    height += hill.height * THREE.MathUtils.smoothstep(falloff, 0, 0.72);
  }
  for (const lake of ALPINE_LAKES) {
    const dx = (x - lake.x) / lake.rx;
    const dz = (z - lake.z) / lake.rz;
    const falloff = Math.max(0, 1 - dx * dx - dz * dz);
    height -= lake.depth * falloff * falloff;
  }
  for (const island of ALPINE_ISLANDS) {
    const dx = (x - island.x) / island.rx;
    const dz = (z - island.z) / island.rz;
    const falloff = Math.max(0, 1 - dx * dx - dz * dz);
    height += island.height * THREE.MathUtils.smoothstep(falloff, 0, 0.72);
  }
  return height;
}

function makeTerrain(
  root: THREE.Group,
  quality: MapQuality,
  rnd: () => number,
) {
  const texture = canvasTex(
    512,
    512,
    (g) => {
      g.fillStyle = "#78945e";
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 1250; i++) {
        const green = rnd() < 0.56;
        g.fillStyle = green ? "rgba(45,91,55,0.3)" : "rgba(191,176,121,0.2)";
        g.beginPath();
        g.ellipse(rnd() * 512, rnd() * 512, 2 + rnd() * 12, 1 + rnd() * 5, rnd() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "rgba(230,235,197,0.22)";
      for (let i = 0; i < 240; i++) {
        g.fillRect(rnd() * 512, rnd() * 512, 1, 2 + rnd() * 3);
      }
    },
    (HALF_X * 2) / 24,
    (HALF_Z * 2) / 24,
    quality === "low" ? 2 : 8,
  );
  const segmentsX = quality === "low" ? 80 : 112;
  const segmentsZ = quality === "low" ? 64 : 96;
  const row = segmentsX + 1;
  const positions = new Float32Array(row * (segmentsZ + 1) * 3);
  const indices: number[] = [];

  for (let iz = 0; iz <= segmentsZ; iz++) {
    const z = -HALF_Z + (iz / segmentsZ) * HALF_Z * 2;
    for (let ix = 0; ix <= segmentsX; ix++) {
      const x = -HALF_X + (ix / segmentsX) * HALF_X * 2;
      const vertex = iz * row + ix;
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = alpineTerrainHeight(x, z);
      positions[vertex * 3 + 2] = z;
      if (ix < segmentsX && iz < segmentsZ) {
        const a = vertex;
        const b = vertex + 1;
        const c = vertex + row;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.96, metalness: 0 });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  root.add(terrain);
  return { texture, material };
}

function makeLake(
  kit: Kit,
  lake: (typeof ALPINE_LAKES)[number],
  waterMaterial: THREE.Material,
  shoreMaterial: THREE.Material,
  rippleMaterial: THREE.Material,
): THREE.Mesh {
  const shape = new THREE.Shape();
  const segments = 40;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const wobble = 1 + 0.075 * Math.sin(angle * 3 + lake.seed) + 0.035 * Math.cos(angle * 5 - lake.seed);
    const x = Math.cos(angle) * lake.rx * wobble;
    const z = Math.sin(angle) * lake.rz * wobble;
    if (i === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  shape.closePath();

  const water = new THREE.Mesh(new THREE.ShapeGeometry(shape, segments), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.set(lake.x, WATER_LEVEL, lake.z);
  kit.root.add(water);

  const shore = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.1, segments), shoreMaterial);
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(lake.x, 0.025, lake.z);
  shore.scale.set(lake.rx, lake.rz, 1);
  kit.root.add(shore);

  const ripple = new THREE.Mesh(
    new THREE.RingGeometry(0.63, 0.65, segments),
    rippleMaterial,
  );
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(lake.x - lake.rx * 0.12, WATER_LEVEL + 0.015, lake.z + lake.rz * 0.08);
  ripple.scale.set(lake.rx * 0.6, lake.rz * 0.6, 1);
  kit.root.add(ripple);
  return ripple;
}

function appendGeometry(
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  color: THREE.Color,
  positions: number[],
  colors: number[],
  indices: number[],
) {
  const position = source.getAttribute("position");
  const offset = positions.length / 3;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
    positions.push(vertex.x, vertex.y, vertex.z);
    colors.push(color.r, color.g, color.b);
  }
  const sourceIndex = source.getIndex();
  if (sourceIndex) {
    for (let i = 0; i < sourceIndex.count; i++) indices.push(offset + sourceIndex.getX(i));
  } else {
    for (let i = 0; i < position.count; i++) indices.push(offset + i);
  }
}

function finishVertexColorGeometry(positions: number[], colors: number[], indices: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createEvergreenGeometry(style: number, seed: number) {
  const rnd = mulberry32(seed);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.42, 1, 7, 3);
  const branch = new THREE.CylinderGeometry(0.025, 0.12, 1, 5, 1);
  const leafCluster = new THREE.IcosahedronGeometry(1, 0);
  const height = [7.6, 8.3, 6.9][style];
  const width = [1, 1.18, 0.9][style];
  const trunkMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0, height / 2, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(1, height, 1),
  );
  appendGeometry(trunk, trunkMatrix, new THREE.Color(0x594534), positions, colors, indices);

  const up = new THREE.Vector3(0, 1, 0);
  const tierCount = style === 1 ? 5 : 6;
  const armCount = style === 1 ? 5 : style === 2 ? 7 : 6;
  for (let tier = 0; tier < tierCount; tier++) {
    const t = (tier + 0.35) / tierCount;
    const y = height * (0.22 + t * 0.68);
    const radius = height * (0.34 - t * 0.22) * width;
    const innerColor = new THREE.Color(tier % 2 ? 0x285846 : 0x1e4a3e);
    const coreMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(0, y, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(radius * 0.66, height * 0.15, radius * 0.66),
    );
    appendGeometry(leafCluster, coreMatrix, innerColor, positions, colors, indices);

    for (let armIndex = 0; armIndex < armCount; armIndex++) {
      const angle = (armIndex / armCount) * Math.PI * 2 + tier * 0.39 + rnd() * 0.28;
      const length = radius * (0.74 + rnd() * 0.48);
      const rise = height * (0.045 + rnd() * 0.035);
      const direction = new THREE.Vector3(Math.cos(angle) * length, rise, Math.sin(angle) * length);
      const branchRotation = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
      const branchMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(direction.x * 0.48, y + rise * 0.48, direction.z * 0.48),
        branchRotation,
        new THREE.Vector3(1, direction.length(), 1),
      );
      appendGeometry(branch, branchMatrix, new THREE.Color(0x604832), positions, colors, indices);

      const clusterPosition = new THREE.Vector3(direction.x * 0.66, y + rise * 0.66, direction.z * 0.66);
      const clusterRotation = new THREE.Quaternion().setFromAxisAngle(up, -angle);
      const clusterScale = new THREE.Vector3(
        length * (0.42 + rnd() * 0.14),
        height * (0.08 + rnd() * 0.035),
        length * (0.22 + rnd() * 0.08),
      );
      const clusterMatrix = new THREE.Matrix4().compose(clusterPosition, clusterRotation, clusterScale);
      const green = new THREE.Color().setHSL(
        0.36 + rnd() * 0.035,
        0.35 + rnd() * 0.18,
        0.19 + rnd() * 0.13,
      );
      appendGeometry(leafCluster, clusterMatrix, green, positions, colors, indices);
    }
  }

  const top = new THREE.Matrix4().compose(
    new THREE.Vector3(0, height * 0.98, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(0.52 * width, height * 0.09, 0.48 * width),
  );
  appendGeometry(leafCluster, top, new THREE.Color(0x32674d), positions, colors, indices);
  trunk.dispose();
  branch.dispose();
  leafCluster.dispose();
  return finishVertexColorGeometry(positions, colors, indices);
}

function createShrubGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const cluster = new THREE.IcosahedronGeometry(1, 1);
  for (const [x, y, z, scale, color] of [
    [-0.38, 0.42, 0, 0.62, 0x386c43],
    [0.35, 0.38, 0.12, 0.68, 0x477b49],
    [0, 0.68, -0.28, 0.72, 0x578450],
  ] as [number, number, number, number, number][]) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(y * 0.8, x, z)),
      new THREE.Vector3(scale, scale * 0.72, scale),
    );
    appendGeometry(cluster, matrix, new THREE.Color(color), positions, colors, indices);
  }
  cluster.dispose();
  return finishVertexColorGeometry(positions, colors, indices);
}

function createGrassTuftGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < 5; blade++) {
    const angle = blade * 2.4;
    const dx = Math.cos(angle) * 0.15;
    const dz = Math.sin(angle) * 0.15;
    const height = 0.36 + (blade % 3) * 0.12;
    const base = positions.length / 3;
    positions.push(-dz * 0.1, 0, dx * 0.1, dz * 0.1, 0, -dx * 0.1, dx, height, dz);
    const color = new THREE.Color(blade % 2 ? 0x66934c : 0x8eaa59);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
    indices.push(base, base + 1, base + 2);
  }
  const geometry = finishVertexColorGeometry(positions, colors, indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createMountainGeometry(seed: number, width: number, depth: number, height: number, segments: number) {
  const rnd = mulberry32(seed);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const peaks = [
    { x: -0.34 + rnd() * 0.12, z: -0.12, w: 0.46, d: 0.52, h: 0.92 },
    { x: 0.2 + rnd() * 0.13, z: 0.2, w: 0.42, d: 0.46, h: 0.78 },
    { x: -0.02, z: 0.39 + rnd() * 0.08, w: 0.34, d: 0.38, h: 0.56 },
  ];
  const baseColor = new THREE.Color(0x536d5b);
  const rockColor = new THREE.Color(0x737d79);
  const highRockColor = new THREE.Color(0xa1abad);
  const snowColor = new THREE.Color(0xe4eeed);
  const row = segments + 1;

  for (let iz = 0; iz <= segments; iz++) {
    const v = (iz / segments) * 2 - 1;
    for (let ix = 0; ix <= segments; ix++) {
      const u = (ix / segments) * 2 - 1;
      let ridge = 0;
      for (const peak of peaks) {
        const px = (u - peak.x) / peak.w;
        const pz = (v - peak.z) / peak.d;
        ridge += peak.h * Math.exp(-2.2 * (px * px + pz * pz));
      }
      const edge = Math.max(0, 1 - Math.max(Math.abs(u), Math.abs(v)));
      const envelope = edge * edge * (3 - 2 * edge);
      const roughness = (Math.sin(u * 15 + v * 8 + seed) * 0.035 + Math.sin(v * 21 - u * 11) * 0.022) * Math.sqrt(ridge);
      const elevation = Math.max(0, Math.min(1, (ridge + roughness) * envelope));
      const x = u * width * 0.5;
      const z = v * depth * 0.5;
      const y = elevation * height;
      positions.push(x, y, z);

      const color = baseColor.clone();
      color.lerp(rockColor, THREE.MathUtils.smoothstep(elevation, 0.13, 0.38));
      color.lerp(highRockColor, THREE.MathUtils.smoothstep(elevation, 0.42, 0.72) * 0.7);
      color.lerp(snowColor, THREE.MathUtils.smoothstep(elevation, 0.72, 0.86));
      color.multiplyScalar(0.94 + rnd() * 0.12);
      colors.push(color.r, color.g, color.b);

      if (ix < segments && iz < segments) {
        const a = iz * row + ix;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  return finishVertexColorGeometry(positions, colors, indices);
}

export function buildAlpine(scene: THREE.Scene, quality: MapQuality): Arena {
  const hx = HALF_X;
  const hz = HALF_Z;
  const rnd = mulberry32(24861);
  const treeRnd = mulberry32(24862);
  const rockRnd = mulberry32(24863);
  const kit = new Kit();
  scene.add(kit.root);

  const M = {
    darkRock: kit.std(0xffffff, { roughness: 0.9 }),
    turquoise: new THREE.MeshPhysicalMaterial({
      color: 0x37b9c3, roughness: 0.16, metalness: 0.08, clearcoat: 0.85,
      transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    }),
    shore: kit.std(0x9b9474, { roughness: 0.94 }),
  };

  makeSky(scene, {
    top: 0x5ca8d2,
    mid: 0xb9d9e8,
    horizon: 0xe9e5d7,
    sunDir: [-0.38, 0.54, 0.42],
    sunColor: 0xfff4da,
    stars: 0,
  });

  const terrainResources = makeTerrain(kit.root, quality, rnd);
  const waterTexture = canvasTex(256, 256, (g) => {
    const gradient = g.createLinearGradient(0, 0, 256, 256);
    gradient.addColorStop(0, "#75dce0");
    gradient.addColorStop(0.5, "#3ab5c5");
    gradient.addColorStop(1, "#207b8a");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(223,255,247,0.42)";
    g.lineWidth = 2;
    for (let i = -256; i < 512; i += 28) {
      g.beginPath();
      g.moveTo(i, 0);
      g.bezierCurveTo(i + 50, 70, i - 40, 180, i + 20, 256);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.16)";
    for (let i = 0; i < 24; i++) {
      g.beginPath();
      g.ellipse(rnd() * 256, rnd() * 256, 5 + rnd() * 16, 1 + rnd() * 3, rnd(), 0, Math.PI * 2);
      g.fill();
    }
  }, 0.16, 0.16, quality === "low" ? 2 : 8);
  M.turquoise.map = waterTexture;
  M.turquoise.color.set(0xd5ffff);

  // The lake is a deep, lethal water hazard with two exposed grass islands.
  const waterMaterial = M.turquoise;
  const rippleMaterial = new THREE.MeshBasicMaterial({
    color: 0xc5f4ed, transparent: true, opacity: 0.34, side: THREE.DoubleSide,
  });
  const lakeRipples = ALPINE_LAKES.map((lake) => makeLake(kit, lake, waterMaterial, M.shore, rippleMaterial));
  const hazards: Hazard[] = ALPINE_LAKES.map((lake) => ({
    x: lake.x,
    z: lake.z,
    r: Math.max(lake.rx, lake.rz) * 1.1,
    dps: 420,
    kind: "water",
  }));

  const treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const treeCount = 230;
  const treeGeometries = [
    createEvergreenGeometry(0, 901),
    createEvergreenGeometry(1, 902),
    createEvergreenGeometry(2, 903),
  ];
  const treeMeshes = treeGeometries.map((geometry) => new THREE.InstancedMesh(geometry, treeMaterial, treeCount));
  const treeIndices = [0, 0, 0];
  const treeInstances: {
    style: number; index: number; x: number; y: number; z: number; scale: number; yaw: number; phase: number;
  }[] = [];
  const treePatches = [
    { x: -98, z: -60, r: 22 }, { x: 98, z: -60, r: 22 },
    { x: -98, z: 60, r: 22 }, { x: 98, z: 60, r: 22 },
    { x: -86, z: 2, r: 16 }, { x: -45, z: -77, r: 14 },
    { x: 18, z: 78, r: 13 }, { x: 99, z: 29, r: 12 },
    { x: -101, z: -12, r: 14 }, { x: -60, z: 76, r: 14 },
  ];
  const dummy = new THREE.Object3D();
  for (let attempt = 0; attempt < treeCount * 30 && treeIndices.reduce((sum, count) => sum + count, 0) < treeCount; attempt++) {
    const patch = treePatches[Math.floor(treeRnd() * treePatches.length)];
    const x = patch.x + (treeRnd() + treeRnd() - 1) * patch.r;
    const z = patch.z + (treeRnd() + treeRnd() - 1) * patch.r;
    if (Math.abs(x) > hx - 4 || Math.abs(z) > hz - 4) continue;
    if (ALPINE_LAKES.some((lake) => Math.hypot(x - lake.x, z - lake.z) < Math.max(lake.rx, lake.rz) + 8)) continue;
    const scale = 0.72 + treeRnd() * 0.62;
    const trunkRadius = 0.36 * scale;
    if (kit.circles.some((circle) => Math.hypot(x - circle.x, z - circle.z) < circle.r + trunkRadius + 2.7)) continue;
    const style = Math.floor(treeRnd() * treeMeshes.length);
    const instance = treeIndices[style];
    if (instance >= treeCount) continue;
    const ground = alpineTerrainHeight(x, z);
    const yaw = treeRnd() * Math.PI * 2;
    const phase = treeRnd() * Math.PI * 2;
    dummy.position.set(x, ground, z);
    dummy.scale.setScalar(scale);
    dummy.rotation.y = yaw;
    dummy.updateMatrix();
    treeMeshes[style].setMatrixAt(instance, dummy.matrix);
    treeMeshes[style].setColorAt(instance, new THREE.Color().setHSL(0.34 + treeRnd() * 0.045, 0.32, 0.86 + treeRnd() * 0.14));
    treeIndices[style]++;
    treeInstances.push({ style, index: instance, x, y: ground, z, scale, yaw, phase });
    kit.circles.push({
      x, z, r: trunkRadius, top: ground + TREE_HEIGHTS[style] * scale,
      kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1,
    });
  }
  for (let i = 0; i < treeMeshes.length; i++) {
    treeMeshes[i].count = treeIndices[i];
    treeMeshes[i].castShadow = true;
    treeMeshes[i].receiveShadow = true;
    kit.root.add(treeMeshes[i]);
  }

  // Distant ranges are irregular terrain meshes with ridges, valleys and elevation-based snow.
  const mountainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, flatShading: true });
  const mountainGeometries: THREE.BufferGeometry[] = [];
  const mountainCount = quality === "low" ? 8 : 13;
  const mountainSegments = quality === "low" ? 24 : quality === "medium" ? 36 : 48;
  for (let i = 0; i < mountainCount; i++) {
    const farRange = i >= 7;
    const ringIndex = farRange ? i - 7 : i;
    const ringCount = farRange ? mountainCount - 7 : 7;
    const angle = (ringIndex / ringCount) * Math.PI * 2 + (farRange ? 0.18 : 0);
    const distance = farRange ? 285 + rnd() * 25 : 178 + rnd() * 24;
    const width = (farRange ? 190 : 145) + rnd() * 60;
    const depth = (farRange ? 120 : 105) + rnd() * 45;
    const height = (farRange ? 38 : 42) + rnd() * 38;
    const geometry = createMountainGeometry(1200 + i * 19, width, depth, height, mountainSegments);
    mountainGeometries.push(geometry);
    const mountain = new THREE.Mesh(geometry, mountainMaterial);
    mountain.position.set(Math.sin(angle) * distance, -3, Math.cos(angle) * distance * 0.82);
    mountain.rotation.y = angle * 0.43;
    mountain.castShadow = false;
    mountain.receiveShadow = false;
    kit.root.add(mountain);
  }

  const rockGeometry = new THREE.DodecahedronGeometry(1, 1);
  const rockCount = 52;
  const boulders = new THREE.InstancedMesh(rockGeometry, M.darkRock, rockCount);
  const rockPatches = [
    { x: -88, z: -58, r: 14 }, { x: -67, z: 42, r: 13 },
    { x: -44, z: -73, r: 12 }, { x: 25, z: 70, r: 13 },
    { x: -88, z: 10, r: 12 }, { x: 45, z: -48, r: 12 },
    { x: 98, z: -54, r: 13 }, { x: 100, z: 36, r: 11 },
  ];
  let rockIndex = 0;
  for (let attempt = 0; attempt < rockCount * 16 && rockIndex < rockCount; attempt++) {
    const patch = rockPatches[Math.floor(rockRnd() * rockPatches.length)];
    const x = patch.x + (rockRnd() + rockRnd() - 1) * patch.r;
    const z = patch.z + (rockRnd() + rockRnd() - 1) * patch.r;
    if (Math.abs(x) > hx - 10 || Math.abs(z) > hz - 10) continue;
    if (Math.hypot(x, z) < 30) continue;
    if (ALPINE_LAKES.some((lake) => Math.hypot(x - lake.x, z - lake.z) < Math.max(lake.rx, lake.rz) + 4)) continue;
    const radius = 0.8 + rockRnd() * 2.8;
    const scaleX = radius * (0.72 + rockRnd() * 0.68);
    const scaleY = radius * (0.55 + rockRnd() * 0.3);
    const scaleZ = radius * (0.75 + rockRnd() * 0.5);
    const collisionRadius = Math.max(scaleX, scaleZ) * 0.78;
    if (kit.circles.some((circle) => Math.hypot(x - circle.x, z - circle.z) < circle.r + collisionRadius + 2.7)) continue;
    const ground = alpineTerrainHeight(x, z);
    const centerY = ground + radius * 0.48;
    dummy.position.set(x, centerY, z);
    dummy.scale.set(scaleX, scaleY, scaleZ);
    dummy.rotation.set(rockRnd(), rockRnd() * Math.PI, rockRnd());
    dummy.updateMatrix();
    boulders.setMatrixAt(rockIndex++, dummy.matrix);
    boulders.setColorAt(rockIndex - 1, new THREE.Color().setHSL(0.35 + rockRnd() * 0.08, 0.08 + rockRnd() * 0.12, 0.35 + rockRnd() * 0.22));
    if (collisionRadius >= 1.55) {
      kit.circles.push({
        x, z, r: collisionRadius, top: centerY + scaleY,
        kind: "static", alive: true, mesh: null, respawnAt: 0, pop: 1, lastHit: -1, hp: 1,
      });
    }
  }
  boulders.count = rockIndex;
  boulders.castShadow = boulders.receiveShadow = true;
  kit.root.add(boulders);

  const shrubGeometry = createShrubGeometry();
  const shrubMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, flatShading: true });
  const shrubCount = quality === "low" ? 100 : quality === "medium" ? 180 : 260;
  const shrubs = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, shrubCount);
  let shrubIndex = 0;
  for (let attempt = 0; attempt < shrubCount * 16 && shrubIndex < shrubCount; attempt++) {
    const x = (rnd() * 2 - 1) * (hx - 10);
    const z = (rnd() * 2 - 1) * (hz - 10);
    if (Math.hypot(x, z) < 28) continue;
    if (ALPINE_LAKES.some((lake) => Math.hypot(x - lake.x, z - lake.z) < Math.max(lake.rx, lake.rz) + 3)) continue;
    dummy.position.set(x, alpineTerrainHeight(x, z), z);
    dummy.scale.setScalar(0.62 + rnd() * 0.62);
    dummy.rotation.y = rnd() * Math.PI * 2;
    dummy.updateMatrix();
    shrubs.setMatrixAt(shrubIndex, dummy.matrix);
    shrubs.setColorAt(shrubIndex, new THREE.Color().setHSL(0.31 + rnd() * 0.08, 0.35 + rnd() * 0.18, 0.82 + rnd() * 0.16));
    shrubIndex++;
  }
  shrubs.count = shrubIndex;
  shrubs.castShadow = shrubs.receiveShadow = true;
  kit.root.add(shrubs);

  const grassGeometry = createGrassTuftGeometry();
  const grassMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.98, side: THREE.DoubleSide, flatShading: true,
  });
  const grassCount = quality === "low" ? 550 : quality === "medium" ? 1050 : 1750;
  const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount);
  let grassIndex = 0;
  for (let attempt = 0; attempt < grassCount * 8 && grassIndex < grassCount; attempt++) {
    const x = (rnd() * 2 - 1) * (hx - 6);
    const z = (rnd() * 2 - 1) * (hz - 6);
    if (Math.hypot(x, z) < 22) continue;
    if (ALPINE_LAKES.some((lake) => Math.hypot(x - lake.x, z - lake.z) < Math.max(lake.rx, lake.rz) + 3)) continue;
    dummy.position.set(x, alpineTerrainHeight(x, z) + 0.02, z);
    const size = 0.7 + rnd() * 0.8;
    dummy.scale.set(size, size, size);
    dummy.rotation.y = rnd() * Math.PI * 2;
    dummy.updateMatrix();
    grass.setMatrixAt(grassIndex, dummy.matrix);
    grass.setColorAt(grassIndex, new THREE.Color().setHSL(0.25 + rnd() * 0.08, 0.34 + rnd() * 0.22, 0.82 + rnd() * 0.15));
    grassIndex++;
  }
  grass.count = grassIndex;
  grass.receiveShadow = true;
  kit.root.add(grass);

  const reedCount = quality === "low" ? 70 : quality === "medium" ? 120 : 180;
  const shoreReeds = new THREE.InstancedMesh(grassGeometry, grassMaterial, reedCount);
  let reedIndex = 0;
  const lake = ALPINE_LAKES[0];
  for (let i = 0; i < reedCount; i++) {
    const angle = (i / reedCount) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
    const scale = 1.17 + rnd() * 0.12;
    const x = lake.x + Math.cos(angle) * lake.rx * scale;
    const z = lake.z + Math.sin(angle) * lake.rz * scale;
    if (Math.hypot(x - lake.x, z - lake.z) < hazards[0].r + 0.6) continue;
    dummy.position.set(x, alpineTerrainHeight(x, z) + 0.02, z);
    dummy.scale.set(1.2 + rnd() * 0.9, 1.4 + rnd() * 1.1, 1.2 + rnd() * 0.9);
    dummy.rotation.y = rnd() * Math.PI * 2;
    dummy.updateMatrix();
    shoreReeds.setMatrixAt(reedIndex, dummy.matrix);
    shoreReeds.setColorAt(reedIndex, new THREE.Color().setHSL(0.26 + rnd() * 0.06, 0.42, 0.62 + rnd() * 0.16));
    reedIndex++;
  }
  shoreReeds.count = reedIndex;
  kit.root.add(shoreReeds);

  const flowerCount = quality === "low" ? 180 : quality === "medium" ? 350 : 600;
  const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 5), kit.basic(0xfff0bd), flowerCount);
  let flowerIndex = 0;
  for (let attempt = 0; attempt < flowerCount * 8 && flowerIndex < flowerCount; attempt++) {
    const x = (rnd() * 2 - 1) * (hx - 8);
    const z = (rnd() * 2 - 1) * (hz - 8);
    if (Math.hypot(x, z) < 20) continue;
    if (ALPINE_LAKES.some((lake) => Math.hypot(x - lake.x, z - lake.z) < Math.max(lake.rx, lake.rz) + 3)) continue;
    dummy.position.set(x, alpineTerrainHeight(x, z) + 0.16, z);
    dummy.scale.set(0.7 + rnd(), 0.7 + rnd(), 0.7 + rnd());
    dummy.updateMatrix();
    flowers.setMatrixAt(flowerIndex++, dummy.matrix);
  }
  flowers.count = flowerIndex;
  kit.root.add(flowers);

  const waterfallCanvas = document.createElement("canvas");
  waterfallCanvas.width = 32;
  waterfallCanvas.height = 128;
  const waterfallContext = waterfallCanvas.getContext("2d");
  if (!waterfallContext) throw new Error("Could not create Alpine waterfall texture");
  const waterfallGradient = waterfallContext.createLinearGradient(0, 0, 32, 0);
  waterfallGradient.addColorStop(0, "rgba(170,245,251,0.05)");
  waterfallGradient.addColorStop(0.45, "rgba(227,255,255,0.86)");
  waterfallGradient.addColorStop(1, "rgba(120,226,240,0.16)");
  waterfallContext.fillStyle = waterfallGradient;
  waterfallContext.fillRect(0, 0, 32, 128);
  for (let i = 0; i < 16; i++) {
    waterfallContext.fillStyle = `rgba(255,255,255,${0.12 + rnd() * 0.3})`;
    waterfallContext.fillRect(rnd() * 32, 0, 1 + rnd() * 2, 128);
  }
  const waterfallTexture = new THREE.CanvasTexture(waterfallCanvas);
  waterfallTexture.wrapT = THREE.RepeatWrapping;
  waterfallTexture.colorSpace = THREE.SRGBColorSpace;
  const waterfallMaterial = new THREE.MeshBasicMaterial({
    map: waterfallTexture, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false,
  });
  for (const [x, z, height] of [[-8, -22.5, 5], [8, -22.5, 4]] as [number, number, number][]) {
    const cascade = new THREE.Mesh(new THREE.PlaneGeometry(4, height), waterfallMaterial);
    cascade.position.set(x, WATER_LEVEL + height / 2, z);
    kit.root.add(cascade);
  }

  const clouds: THREE.Group[] = [];
  const cloudMaterials: THREE.Material[] = [];
  for (let i = 0; i < 7; i++) {
    const cloud = new THREE.Group();
    cloud.position.set((rnd() * 2 - 1) * 100, 43 + rnd() * 28, (rnd() * 2 - 1) * 85);
    const puffMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.46 });
    cloudMaterials.push(puffMaterial);
    for (let p = 0; p < 5; p++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(4 + rnd() * 3, 8, 6), puffMaterial);
      puff.position.set((p - 2) * 4.4, rnd() * 2.4, Math.sin(p) * 2);
      puff.scale.y = 0.55;
      cloud.add(puff);
    }
    kit.root.add(cloud);
    clouds.push(cloud);
  }

  const birdBodyGeometry = new THREE.ConeGeometry(0.12, 0.75, 5);
  const birdWingShape = new THREE.Shape();
  birdWingShape.moveTo(0, 0);
  birdWingShape.quadraticCurveTo(0.25, 0.3, 0.86, 0.2);
  birdWingShape.lineTo(0.55, 0.04);
  birdWingShape.lineTo(0.82, -0.12);
  birdWingShape.quadraticCurveTo(0.28, -0.1, 0, 0);
  const birdWingGeometry = new THREE.ShapeGeometry(birdWingShape);
  const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x263b3b, side: THREE.DoubleSide });
  const birdFlocks: { group: THREE.Group; phase: number; speed: number; wings: { left: THREE.Group; right: THREE.Group; phase: number }[] }[] = [];
  for (let flockIndex = 0; flockIndex < 3; flockIndex++) {
    const group = new THREE.Group();
    const wings: { left: THREE.Group; right: THREE.Group; phase: number }[] = [];
    for (let birdIndex = 0; birdIndex < 4; birdIndex++) {
      const bird = new THREE.Group();
      bird.position.set((birdIndex - 1.5) * 1.5, Math.sin(birdIndex * 1.7) * 0.35, (birdIndex % 2) * 1.8);
      bird.scale.setScalar(0.72 + rnd() * 0.3);
      const body = new THREE.Mesh(birdBodyGeometry, birdMaterial);
      body.rotation.x = Math.PI / 2;
      bird.add(body);
      const left = new THREE.Group();
      left.position.x = -0.08;
      left.scale.x = -1;
      left.add(new THREE.Mesh(birdWingGeometry, birdMaterial));
      const right = new THREE.Group();
      right.position.x = 0.08;
      right.add(new THREE.Mesh(birdWingGeometry, birdMaterial));
      bird.add(left, right);
      group.add(bird);
      wings.push({ left, right, phase: birdIndex * 0.55 + rnd() * Math.PI });
    }
    kit.root.add(group);
    birdFlocks.push({
      group,
      phase: (flockIndex / 3) * Math.PI * 2,
      speed: 0.72 + rnd() * 0.3,
      wings,
    });
  }

  const spawns: SpawnPoint[] = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const x = Math.cos(angle) * 36;
    const z = Math.sin(angle) * 36;
    return { x, z, heading: -angle };
  });
  const zones: PickupZone[] = [];
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const x = Math.cos(angle) * 46;
    const z = Math.sin(angle) * 46;
    if (alpineTerrainHeight(x, z) > 0.1) continue;
    if (hazards.some((hazard) => Math.hypot(x - hazard.x, z - hazard.z) < hazard.r + 2)) continue;
    zones.push({ x, z, y: 0, kind: "weapon" });
  }
  for (const [x, z] of [[-70, -10], [-70, 10], [70, -10], [70, 10]]) {
    zones.push({ x, z, y: 0, kind: "health" });
  }
  const validPickups = validateZones(zones, kit.surfaces, kit.circles, hx, hz);
  const groundAt = (x: number, z: number, yRef: number) => {
    return Math.max(alpineTerrainHeight(x, z), kit.groundAt(x, z, yRef));
  };

  const update = (time: number, dt: number) => {
    kit.update(time, dt);
    waterfallTexture.offset.y = (time * 0.38) % 1;
    waterTexture.offset.x = (time * 0.006) % 1;
    waterTexture.offset.y = (time * 0.012) % 1;
    for (let i = 0; i < lakeRipples.length; i++) {
      const rippleScale = 0.58 + Math.sin(time * 1.8 + i * 1.3) * 0.035;
      lakeRipples[i].scale.set(ALPINE_LAKES[i].rx * rippleScale, ALPINE_LAKES[i].rz * rippleScale, 1);
    }
    rippleMaterial.opacity = 0.28 + Math.sin(time * 1.5) * 0.06;
    for (const tree of treeInstances) {
      const sway = Math.sin(time * 0.8 + tree.phase) * 0.018;
      dummy.position.set(tree.x, tree.y, tree.z);
      dummy.scale.setScalar(tree.scale);
      dummy.rotation.set(sway, tree.yaw, -sway * 0.55);
      dummy.updateMatrix();
      treeMeshes[tree.style].setMatrixAt(tree.index, dummy.matrix);
    }
    for (const mesh of treeMeshes) mesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i];
      cloud.position.x += dt * (1.2 + (i % 3) * 0.28);
      if (cloud.position.x > 145) cloud.position.x = -145;
    }
    for (const flock of birdFlocks) {
      const angle = time * 0.035 * flock.speed + flock.phase;
      flock.group.position.set(
        Math.sin(angle) * 78,
        29 + Math.sin(time * 0.72 + flock.phase) * 1.6,
        Math.cos(angle * 0.82) * 70,
      );
      flock.group.rotation.y = Math.atan2(Math.cos(angle), -Math.sin(angle * 0.82) * 0.82);
      for (const wings of flock.wings) {
        const flap = Math.sin(time * 8 + wings.phase) * 0.52;
        wings.left.rotation.z = flap;
        wings.right.rotation.z = -flap;
      }
    }
  };

  return {
    half: Math.max(hx, hz),
    hx,
    hz,
    surfaces: kit.surfaces,
    circles: kit.circles,
    pickupSpots: validPickups,
    spawns,
    zones: validPickups,
    hazards,
    groundAt,
    maxHeightAt: (x, z) => Math.max(alpineTerrainHeight(x, z), kit.maxHeightAt(x, z)),
    update,
    dispose: () => {
      terrainResources.texture.dispose();
      terrainResources.material.dispose();
      waterTexture.dispose();
      waterfallTexture.dispose();
      waterfallMaterial.dispose();
      M.turquoise.dispose();
      M.shore.dispose();
      rippleMaterial.dispose();
      birdMaterial.dispose();
      birdBodyGeometry.dispose();
      birdWingGeometry.dispose();
      treeMaterial.dispose();
      mountainMaterial.dispose();
      shrubMaterial.dispose();
      grassMaterial.dispose();
      for (const geometry of treeGeometries) geometry.dispose();
      for (const geometry of mountainGeometries) geometry.dispose();
      shrubGeometry.dispose();
      grassGeometry.dispose();
      rockGeometry.dispose();
      for (const material of cloudMaterials) material.dispose();
    },
  };
}
