import * as THREE from "three";
import { MaterialLibrary } from "bbmodel-viewer";
import type { BbmodelData } from "@/lib/bbmodel-animation";

type Vec3 = [number, number, number];

type BbFace = {
  uv?: [number, number, number, number] | Record<string, [number, number]>;
  texture?: number | string | null | false;
  rotation?: number;
  vertices?: string[];
};

type BbElement = {
  uuid?: string;
  name?: string;
  type?: string;
  color?: number;
  visibility?: boolean;
  from?: Vec3;
  to?: Vec3;
  origin?: Vec3;
  rotation?: Vec3;
  inflate?: number;
  box_uv?: boolean;
  uv_offset?: [number, number];
  faces?: Record<string, BbFace>;
  vertices?: Record<string, Vec3>;
};

type BbGroup = {
  uuid?: string;
  name?: string;
  origin?: Vec3;
  rotation?: Vec3;
  visibility?: boolean;
  children?: unknown[];
};

const EULER_ORDER = "ZYX" as const;
const ORIGIN: Vec3 = [0, 0, 0];
const CUBE_FACE_ORDER = ["north", "east", "south", "west", "up", "down"] as const;

function cubeFaceCorners(
  dir: (typeof CUBE_FACE_ORDER)[number],
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
) {
  switch (dir) {
    case "south":
      return { tl: [x1, y2, z2], tr: [x2, y2, z2], bl: [x1, y1, z2], br: [x2, y1, z2] };
    case "north":
      return { tl: [x2, y2, z1], tr: [x1, y2, z1], bl: [x2, y1, z1], br: [x1, y1, z1] };
    case "east":
      return { tl: [x2, y2, z2], tr: [x2, y2, z1], bl: [x2, y1, z2], br: [x2, y1, z1] };
    case "west":
      return { tl: [x1, y2, z1], tr: [x1, y2, z2], bl: [x1, y1, z1], br: [x1, y1, z2] };
    case "up":
      return { tl: [x1, y2, z1], tr: [x2, y2, z1], bl: [x1, y2, z2], br: [x2, y2, z2] };
    case "down":
      return { tl: [x1, y1, z2], tr: [x2, y1, z2], bl: [x1, y1, z1], br: [x2, y1, z1] };
  }
}

function boxUvRect(
  dir: (typeof CUBE_FACE_ORDER)[number],
  u: number,
  v: number,
  sx: number,
  sy: number,
  sz: number,
): [number, number, number, number] | null {
  switch (dir) {
    case "up":
      return [u + sz, v, u + sz + sx, v + sz];
    case "down":
      return [u + sz + sx, v, u + sz + 2 * sx, v + sz];
    case "east":
      return [u, v + sz, u + sz, v + sz + sy];
    case "north":
      return [u + sz, v + sz, u + sz + sx, v + sz + sy];
    case "west":
      return [u + sz + sx, v + sz, u + 2 * sz + sx, v + sz + sy];
    case "south":
      return [u + 2 * sz + sx, v + sz, u + 2 * sz + 2 * sx, v + sz + sy];
    default:
      return null;
  }
}

function rectToCornerUvs(
  rect: [number, number, number, number],
  uvWidth: number,
  uvHeight: number,
  rotation = 0,
) {
  const [u1, v1, u2, v2] = rect;
  const uMin = u1 / uvWidth;
  const uMax = u2 / uvWidth;
  const vTop = 1 - v1 / uvHeight;
  const vBot = 1 - v2 / uvHeight;
  let corners = {
    tl: [uMin, vTop] as [number, number],
    tr: [uMax, vTop] as [number, number],
    bl: [uMin, vBot] as [number, number],
    br: [uMax, vBot] as [number, number],
  };
  const steps = (((rotation / 90) % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) {
    corners = { tl: corners.bl, tr: corners.tl, br: corners.tr, bl: corners.br };
  }
  return corners;
}

class MeshAssembler {
  positions: number[] = [];
  uvs: number[] = [];
  materials: THREE.Material[] = [];
  materialIndex = new Map<THREE.Material, number>();
  groups: Array<{ start: number; count: number; index: number }> = [];
  vertexCount = 0;

  indexOf(material: THREE.Material) {
    let idx = this.materialIndex.get(material);
    if (idx === undefined) {
      idx = this.materials.length;
      this.materials.push(material);
      this.materialIndex.set(material, idx);
    }
    return idx;
  }

  addQuad(
    c: { tl: number[]; tr: number[]; bl: number[]; br: number[] },
    uv: { tl: [number, number]; tr: [number, number]; bl: [number, number]; br: [number, number] },
    material: THREE.Material,
  ) {
    const start = this.vertexCount;
    this.pushVertex(c.tl, uv.tl);
    this.pushVertex(c.bl, uv.bl);
    this.pushVertex(c.tr, uv.tr);
    this.pushVertex(c.tr, uv.tr);
    this.pushVertex(c.bl, uv.bl);
    this.pushVertex(c.br, uv.br);
    this.groups.push({ start, count: 6, index: this.indexOf(material) });
  }

  addTriangle(p: number[][], uv: [number, number][], material: THREE.Material) {
    const start = this.vertexCount;
    this.pushVertex(p[0], uv[0]);
    this.pushVertex(p[1], uv[1]);
    this.pushVertex(p[2], uv[2]);
    this.groups.push({ start, count: 3, index: this.indexOf(material) });
  }

  pushVertex(pos: number[], uv: [number, number]) {
    this.positions.push(pos[0], pos[1], pos[2]);
    this.uvs.push(uv[0], uv[1]);
    this.vertexCount++;
  }

  build(name: string) {
    if (this.vertexCount === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    for (const g of this.groups) geometry.addGroup(g.start, g.count, g.index);
    geometry.computeVertexNormals();
    const material = this.materials.length === 1 ? this.materials[0] : this.materials;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  }
}

type Library = {
  resolve: (ref: BbFace["texture"]) => { material: THREE.Material; uvWidth: number; uvHeight: number } | null;
  renderUntextured: () => boolean;
  fallbackUvSpace: { width: number; height: number };
  colorMaterial: (colorIndex?: number) => THREE.Material;
};

function buildCubeElement(element: BbElement, library: Library) {
  const from = element.from ?? [0, 0, 0];
  const to = element.to ?? [0, 0, 0];
  const origin = element.origin ?? [0, 0, 0];
  const inflate = element.inflate ?? 0;
  const x1 = Math.min(from[0], to[0]) - inflate - origin[0];
  const x2 = Math.max(from[0], to[0]) + inflate - origin[0];
  const y1 = Math.min(from[1], to[1]) - inflate - origin[1];
  const y2 = Math.max(from[1], to[1]) + inflate - origin[1];
  const z1 = Math.min(from[2], to[2]) - inflate - origin[2];
  const z2 = Math.max(from[2], to[2]) + inflate - origin[2];
  const sx = Math.abs(to[0] - from[0]);
  const sy = Math.abs(to[1] - from[1]);
  const sz = Math.abs(to[2] - from[2]);
  const uvOffset = element.uv_offset ?? [0, 0];
  const faces = element.faces ?? {};
  const assembler = new MeshAssembler();

  for (const dir of CUBE_FACE_ORDER) {
    const face = faces[dir];
    const corners = cubeFaceCorners(dir, x1, y1, z1, x2, y2, z2);
    if (element.faces && !face) continue;
    const texMeta = library.resolve(face?.texture);
    if (!texMeta && !library.renderUntextured()) continue;
    const material = texMeta ? texMeta.material : library.colorMaterial(element.color ?? 0);
    const uvWidth = texMeta ? texMeta.uvWidth : library.fallbackUvSpace.width;
    const uvHeight = texMeta ? texMeta.uvHeight : library.fallbackUvSpace.height;
    const faceUv = Array.isArray(face?.uv) ? face.uv : null;
    const rect =
      faceUv ??
      boxUvRect(dir, uvOffset[0], uvOffset[1], sx, sy, sz) ??
      ([0, 0, uvWidth, uvHeight] as [number, number, number, number]);
    const uv = rectToCornerUvs(rect, uvWidth, uvHeight, face?.rotation ?? 0);
    assembler.addQuad(corners, uv, material);
  }

  return assembler.build(element.name ?? "cube");
}

function buildMeshElement(element: BbElement, library: Library) {
  const vertices = element.vertices ?? {};
  const faces = element.faces ?? {};
  const assembler = new MeshAssembler();

  // Mesh vertices are already stored relative to the element origin.
  const posOf = (key: string): Vec3 | null => {
    const v = vertices[key];
    return v ? [v[0], v[1], v[2]] : null;
  };

  for (const face of Object.values(faces)) {
    const keys = face.vertices ?? [];
    if (keys.length < 3) continue;
    const texMeta = library.resolve(face.texture);
    if (!texMeta && !library.renderUntextured()) continue;
    const material = texMeta ? texMeta.material : library.colorMaterial(element.color ?? 0);
    const uvWidth = texMeta ? texMeta.uvWidth : library.fallbackUvSpace.width;
    const uvHeight = texMeta ? texMeta.uvHeight : library.fallbackUvSpace.height;
    const uvMap =
      face.uv && !Array.isArray(face.uv) ? (face.uv as Record<string, [number, number]>) : null;
    const uvOf = (key: string): [number, number] => {
      const raw = uvMap?.[key];
      if (!raw) return [0, 0];
      return [raw[0] / uvWidth, 1 - raw[1] / uvHeight];
    };

    for (let i = 1; i < keys.length - 1; i++) {
      const a = posOf(keys[0]);
      const b = posOf(keys[i]);
      const c = posOf(keys[i + 1]);
      if (!a || !b || !c) continue;
      assembler.addTriangle([a, b, c], [uvOf(keys[0]), uvOf(keys[i]), uvOf(keys[i + 1])], material);
    }
  }

  return assembler.build(element.name ?? "mesh");
}

function buildElementMesh(element: BbElement, library: Library) {
  if (element.type === "mesh" && element.vertices) {
    return buildMeshElement(element, library);
  }
  return buildCubeElement(element, library);
}

function applyTransform(
  node: THREE.Object3D,
  origin: Vec3,
  parentOrigin: Vec3,
  rotation?: Vec3,
) {
  node.position.set(
    origin[0] - parentOrigin[0],
    origin[1] - parentOrigin[1],
    origin[2] - parentOrigin[2],
  );
  if (rotation) {
    node.rotation.set(
      THREE.MathUtils.degToRad(rotation[0]),
      THREE.MathUtils.degToRad(rotation[1]),
      THREE.MathUtils.degToRad(rotation[2]),
      EULER_ORDER,
    );
  }
}

/**
 * Expand Blockbench 5+ outliner stubs (`{uuid, children}`) with full group
 * data from `groups[]` so origins/rotations are preserved.
 */
export function normalizeBbmodel(model: BbmodelData): BbmodelData {
  const groupsByUuid = new Map<string, BbGroup>();
  for (const group of (model.groups ?? []) as BbGroup[]) {
    if (group.uuid) groupsByUuid.set(group.uuid, group);
  }

  function expand(node: unknown): unknown {
    if (typeof node === "string") return node;
    if (typeof node !== "object" || node === null) return node;

    const stub = node as BbGroup & { children?: unknown[] };
    const full = stub.uuid ? groupsByUuid.get(stub.uuid) : undefined;
    const childrenSource = stub.children ?? full?.children ?? [];
    const children = childrenSource.map(expand);

    if (full) {
      return {
        ...full,
        ...stub,
        // Prefer authored transform fields from the groups table.
        name: full.name ?? stub.name,
        origin: full.origin ?? stub.origin,
        rotation: full.rotation ?? stub.rotation,
        visibility: full.visibility ?? stub.visibility,
        children,
      };
    }

    return { ...stub, children };
  }

  return {
    ...model,
    outliner: (model.outliner ?? []).map(expand),
  };
}

export type BuiltBbmodelScene = {
  root: THREE.Group;
  nodesByUuid: Map<string, THREE.Object3D>;
  materials: InstanceType<typeof MaterialLibrary>;
};

export async function buildBbmodelScene(model: BbmodelData): Promise<BuiltBbmodelScene> {
  const normalized = normalizeBbmodel(model);
  const materials = new MaterialLibrary(normalized as never, {
    alphaTest: 0.02,
    side: THREE.DoubleSide,
    showUntexturedFaces: true,
  });
  await materials.load();

  const nodesByUuid = new Map<string, THREE.Object3D>();
  const elementsByUuid = new Map<string, BbElement>();
  for (const el of (normalized.elements ?? []) as BbElement[]) {
    if (el.uuid) elementsByUuid.set(el.uuid, el);
  }
  const groupsByUuid = new Map<string, BbGroup>();
  for (const g of (normalized.groups ?? []) as BbGroup[]) {
    if (g.uuid) groupsByUuid.set(g.uuid, g);
  }

  const usedElements = new Set<string>();
  const visitedGroups = new Set<string>();
  const root = new THREE.Group();
  root.name = normalized.name ?? "bbmodel";

  function buildElementNode(element: BbElement, parentOrigin: Vec3) {
    if (element.visibility === false) return null;
    const mesh = buildElementMesh(element, materials as unknown as Library);
    if (!mesh) return null;
    const origin = element.origin ?? parentOrigin;
    const node = new THREE.Group();
    node.name = element.name ?? "element";
    if (element.uuid) {
      node.userData.bbUuid = element.uuid;
      nodesByUuid.set(element.uuid, node);
    }
    applyTransform(node, origin, parentOrigin, element.rotation);
    node.add(mesh);
    return node;
  }

  function buildGroupNode(group: BbGroup, parentOrigin: Vec3) {
    if (group.visibility === false) return null;
    if (group.uuid) {
      if (visitedGroups.has(group.uuid)) return null;
      visitedGroups.add(group.uuid);
    }

    const origin = group.origin ?? parentOrigin;
    const node = new THREE.Group();
    node.name = group.name ?? "group";
    if (group.uuid) {
      node.userData.bbUuid = group.uuid;
      nodesByUuid.set(group.uuid, node);
    }
    applyTransform(node, origin, parentOrigin, group.rotation);

    for (const child of group.children ?? []) {
      const built = buildNode(child, origin);
      if (built) node.add(built);
    }
    return node;
  }

  function buildNode(node: unknown, parentOrigin: Vec3): THREE.Object3D | null {
    if (typeof node === "string") {
      const element = elementsByUuid.get(node);
      if (element) {
        usedElements.add(node);
        return buildElementNode(element, parentOrigin);
      }
      const group = groupsByUuid.get(node);
      if (group) return buildGroupNode(group, parentOrigin);
      return null;
    }

    if (typeof node === "object" && node !== null) {
      return buildGroupNode(node as BbGroup, parentOrigin);
    }
    return null;
  }

  for (const node of normalized.outliner ?? []) {
    const built = buildNode(node, ORIGIN);
    if (built) root.add(built);
  }

  for (const el of (normalized.elements ?? []) as BbElement[]) {
    if (el.uuid && usedElements.has(el.uuid)) continue;
    const built = buildElementNode(el, ORIGIN);
    if (built) root.add(built);
  }

  return { root, nodesByUuid, materials };
}

export function disposeBbmodelScene(scene: BuiltBbmodelScene | null) {
  if (!scene) return;
  scene.root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
    }
  });
  scene.materials.dispose();
}
