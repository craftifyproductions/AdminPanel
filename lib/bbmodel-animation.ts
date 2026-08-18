import type { Object3D, Quaternion, Vector3 } from "three";
import * as THREE from "three";

type Vec3 = [number, number, number];

export type BbmodelKeyframe = {
  channel?: string;
  time?: number;
  interpolation?: string;
  data_points?: Array<{ x?: unknown; y?: unknown; z?: unknown }>;
};

export type BbmodelAnimator = {
  name?: string;
  type?: string;
  keyframes?: BbmodelKeyframe[];
};

export type BbmodelAnimation = {
  uuid?: string;
  name?: string;
  loop?: string;
  length?: number;
  animators?: Record<string, BbmodelAnimator>;
};

export type BbmodelData = {
  meta?: { format_version?: string; model_format?: string; [key: string]: unknown };
  name?: string;
  elements?: Array<{ uuid?: string; visibility?: boolean; [key: string]: unknown }>;
  groups?: Array<{
    uuid?: string;
    visibility?: boolean;
    children?: unknown[];
    [key: string]: unknown;
  }>;
  outliner?: unknown[];
  animations?: BbmodelAnimation[];
  [key: string]: unknown;
};

export type RestPose = {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  euler: THREE.Euler;
};

export type AnimationInfo = {
  index: number;
  name: string;
  length: number;
  loop: "loop" | "once" | "hold";
};

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return 0;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function pointOf(kf: BbmodelKeyframe): Vec3 {
  const point = kf.data_points?.[0];
  return [asNumber(point?.x), asNumber(point?.y), asNumber(point?.z)];
}

/**
 * Pre-5.0 bbmodel files store inverted animation axes. Blockbench flips them on
 * load; we apply the same correction when sampling.
 */
function needsLegacyAxisFlip(model: BbmodelData): boolean {
  const version = model.meta?.format_version;
  if (typeof version !== "string" || version.trim().length === 0) return true;
  const major = Number.parseFloat(version);
  return Number.isFinite(major) && major < 5;
}

function adjustChannel(channel: string, value: Vec3, legacyFlip: boolean): Vec3 {
  if (!legacyFlip) return value;
  if (channel === "position") return [-value[0], value[1], value[2]];
  if (channel === "rotation") return [-value[0], -value[1], value[2]];
  return value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function sampleChannel(
  keyframes: BbmodelKeyframe[],
  channel: string,
  time: number,
  legacyFlip: boolean,
): Vec3 | null {
  const sorted = keyframes
    .filter((kf) => kf.channel === channel)
    .slice()
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  if (sorted.length === 0) return null;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (time <= (first.time ?? 0)) {
    return adjustChannel(channel, pointOf(first), legacyFlip);
  }
  if (time >= (last.time ?? 0)) {
    return adjustChannel(channel, pointOf(last), legacyFlip);
  }

  let prev = first;
  let next = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= (a.time ?? 0) && time <= (b.time ?? 0)) {
      prev = a;
      next = b;
      break;
    }
  }

  const t0 = prev.time ?? 0;
  const t1 = next.time ?? t0;
  if (t1 <= t0 || prev.interpolation === "step") {
    return adjustChannel(channel, pointOf(prev), legacyFlip);
  }

  const alpha = (time - t0) / (t1 - t0);
  return adjustChannel(channel, lerpVec(pointOf(prev), pointOf(next), alpha), legacyFlip);
}

export function captureRestPoses(nodes: Map<string, Object3D>): Map<string, RestPose> {
  const poses = new Map<string, RestPose>();
  for (const [uuid, node] of nodes) {
    const euler = new THREE.Euler().copy(node.rotation);
    poses.set(uuid, {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
      euler,
    });
  }
  return poses;
}

export function listBbmodelAnimations(model: BbmodelData): AnimationInfo[] {
  const animations = model.animations ?? [];
  return animations.map((animation, index) => {
    const loopRaw = animation.loop ?? "loop";
    const loop: AnimationInfo["loop"] =
      loopRaw === "once" || loopRaw === "hold" ? loopRaw : "loop";

    // Prefer declared length; otherwise infer from last keyframe.
    let length = typeof animation.length === "number" && animation.length > 0 ? animation.length : 0;
    if (length <= 0) {
      for (const animator of Object.values(animation.animators ?? {})) {
        for (const kf of animator.keyframes ?? []) {
          if (typeof kf.time === "number" && kf.time > length) length = kf.time;
        }
      }
    }
    if (length <= 0) length = 1;

    return {
      index,
      name: animation.name?.trim() || `Animation ${index + 1}`,
      length,
      loop,
    };
  });
}

export function resetRestPoses(
  nodes: Map<string, Object3D>,
  rests: Map<string, RestPose>,
): void {
  for (const [uuid, node] of nodes) {
    const rest = rests.get(uuid);
    if (!rest) continue;
    node.position.copy(rest.position);
    node.rotation.copy(rest.euler);
    node.scale.copy(rest.scale);
  }
}

/**
 * Apply Blockbench animation the same way BoneAnimator.displayFrame does:
 * additive position/rotation on top of the rest pose, multiplicative scale.
 */
export function applyBbmodelAnimation(
  model: BbmodelData,
  animation: BbmodelAnimation,
  time: number,
  nodes: Map<string, Object3D>,
  rests: Map<string, RestPose>,
): void {
  const legacyFlip = needsLegacyAxisFlip(model);
  const animators = animation.animators ?? {};
  const override = Boolean((animation as { override?: boolean }).override);

  resetRestPoses(nodes, rests);

  for (const [uuid, animator] of Object.entries(animators)) {
    if (animator.type === "effect") continue;
    const node = nodes.get(uuid);
    const rest = rests.get(uuid);
    if (!node || !rest) continue;

    const keyframes = animator.keyframes ?? [];

    const position = sampleChannel(keyframes, "position", time, legacyFlip);
    if (position) {
      if (override) node.position.copy(rest.position);
      node.position.x += position[0];
      node.position.y += position[1];
      node.position.z += position[2];
    }

    const rotation = sampleChannel(keyframes, "rotation", time, legacyFlip);
    if (rotation) {
      if (override) node.rotation.copy(rest.euler);
      node.rotation.x += THREE.MathUtils.degToRad(rotation[0]);
      node.rotation.y += THREE.MathUtils.degToRad(rotation[1]);
      node.rotation.z += THREE.MathUtils.degToRad(rotation[2]);
    }

    const scale = sampleChannel(keyframes, "scale", time, legacyFlip);
    if (scale) {
      // Blockbench: scale.x *= (1 + (arr[0] - 1) * multiplier)
      node.scale.x = (scale[0] || 0) === 0 ? 0.00001 : scale[0];
      node.scale.y = (scale[1] || 0) === 0 ? 0.00001 : scale[1];
      node.scale.z = (scale[2] || 0) === 0 ? 0.00001 : scale[2];
    }
  }
}

export function advanceAnimationTime(
  time: number,
  delta: number,
  length: number,
  loop: AnimationInfo["loop"],
): { time: number; playing: boolean } {
  if (length <= 0) return { time: 0, playing: false };
  let next = time + delta;
  if (next < length) return { time: next, playing: true };

  if (loop === "once") return { time: length, playing: false };
  if (loop === "hold") return { time: length, playing: true };
  next %= length;
  return { time: next, playing: true };
}
