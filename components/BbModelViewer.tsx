"use client";

import {
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  advanceAnimationTime,
  applyBbmodelAnimation,
  captureRestPoses,
  listBbmodelAnimations,
  resetRestPoses,
  type AnimationInfo,
  type BbmodelData,
  type RestPose,
} from "@/lib/bbmodel-animation";
import {
  buildBbmodelScene,
  disposeBbmodelScene,
  type BuiltBbmodelScene,
} from "@/lib/bbmodel-scene";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/r2-client";

export type BbModelViewerProps = {
  blob: Blob;
  fileName: string;
  className?: string;
};

function formatAnimTime(time: number, length: number): string {
  return `${time.toFixed(2)}s / ${length.toFixed(2)}s`;
}

function frameCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  root: THREE.Object3D,
) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 16;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.6;
  const dir = new THREE.Vector3(1, 0.75, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

export function BbModelViewer({ blob, fileName, className }: BbModelViewerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const builtRef = useRef<BuiltBbmodelScene | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  const modelRef = useRef<BbmodelData | null>(null);
  const nodesRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const restsRef = useRef<Map<string, RestPose>>(new Map());
  const animTimeRef = useRef(0);
  const playingRef = useRef(false);
  const selectedIndexRef = useRef(0);
  const animationsRef = useRef<AnimationInfo[]>([]);
  const lastFrameRef = useRef<number | null>(null);
  const frameIdRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [animations, setAnimations] = useState<AnimationInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const selected = animations[selectedIndex] ?? null;

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    animationsRef.current = animations;
  }, [animations]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
    animTimeRef.current = 0;
    const info = animationsRef.current[selectedIndex];
    if (progressRef.current && info) {
      progressRef.current.textContent = formatAnimTime(0, info.length);
    }
    resetRestPoses(nodesRef.current, restsRef.current);
  }, [selectedIndex]);

  useEffect(() => {
    let cancelled = false;
    const host = canvasHostRef.current;
    if (!host) return;

    setLoading(true);
    setError(null);
    setAnimations([]);
    setSelectedIndex(0);
    setPlaying(false);
    animTimeRef.current = 0;
    nodesRef.current = new Map();
    restsRef.current = new Map();
    modelRef.current = null;

    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#09090b");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10_000);
    camera.position.set(40, 30, 40);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.replaceChildren(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = false;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.65);
    key.position.set(40, 60, 30);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-30, 20, -40);
    scene.add(fill);

    const resizeObserver = new ResizeObserver(() => {
      if (!rendererRef.current || !cameraRef.current || !host) return;
      const w = Math.max(host.clientWidth, 1);
      const h = Math.max(host.clientHeight, 1);
      rendererRef.current.setSize(w, h, false);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    });
    resizeObserver.observe(host);

    const tick = (now: number) => {
      frameIdRef.current = requestAnimationFrame(tick);
      const last = lastFrameRef.current;
      lastFrameRef.current = now;

      const model = modelRef.current;
      const info = animationsRef.current[selectedIndexRef.current];
      if (model && info && playingRef.current && last !== null) {
        const animation = model.animations?.[info.index];
        if (animation) {
          const delta = Math.min(0.05, (now - last) / 1000);
          const advanced = advanceAnimationTime(
            animTimeRef.current,
            delta,
            info.length,
            info.loop,
          );
          animTimeRef.current = advanced.time;
          if (!advanced.playing && playingRef.current) {
            playingRef.current = false;
            setPlaying(false);
          }
          applyBbmodelAnimation(
            model,
            animation,
            advanced.time,
            nodesRef.current,
            restsRef.current,
          );
          if (progressRef.current) {
            progressRef.current.textContent = formatAnimTime(advanced.time, info.length);
          }
        }
      }

      controlsRef.current?.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    frameIdRef.current = requestAnimationFrame(tick);

    void (async () => {
      try {
        const text = await blob.text();
        const data = JSON.parse(text) as BbmodelData;
        if (cancelled) return;

        const built = await buildBbmodelScene(data);
        if (cancelled) {
          disposeBbmodelScene(built);
          return;
        }

        builtRef.current = built;
        modelRef.current = data;
        nodesRef.current = built.nodesByUuid;
        restsRef.current = captureRestPoses(built.nodesByUuid);
        scene.add(built.root);

        const box = new THREE.Box3().setFromObject(built.root);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 16;
        if (gridRef.current) {
          scene.remove(gridRef.current);
          gridRef.current.geometry.dispose();
          (gridRef.current.material as THREE.Material).dispose();
        }
        const grid = new THREE.GridHelper(Math.ceil(maxDim / 16) * 32, Math.ceil(maxDim / 16) * 2, 0x3f3f46, 0x27272a);
        grid.position.y = box.min.y;
        scene.add(grid);
        gridRef.current = grid;

        if (cameraRef.current && controlsRef.current) {
          frameCamera(cameraRef.current, controlsRef.current, built.root);
        }

        const listed = listBbmodelAnimations(data);
        animationsRef.current = listed;
        setAnimations(listed);
        if (listed.length > 0) {
          setSelectedIndex(0);
          selectedIndexRef.current = 0;
          setPlaying(true);
          playingRef.current = true;
          if (progressRef.current) {
            progressRef.current.textContent = formatAnimTime(0, listed[0].length);
          }
        }

        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(errorMessage(err) || `Could not load “${fileName}”.`);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameIdRef.current);
      resizeObserver.disconnect();
      controlsRef.current?.dispose();
      controlsRef.current = null;
      disposeBbmodelScene(builtRef.current);
      builtRef.current = null;
      if (gridRef.current) {
        gridRef.current.geometry.dispose();
        (gridRef.current.material as THREE.Material).dispose();
        gridRef.current = null;
      }
      rendererRef.current?.dispose();
      rendererRef.current?.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      lastFrameRef.current = null;
    };
  }, [blob, fileName]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === shellRef.current;
      setFullscreen(active);
      requestAnimationFrame(() => {
        const host = canvasHostRef.current;
        if (!host || !rendererRef.current || !cameraRef.current) return;
        const w = Math.max(host.clientWidth, 1);
        const h = Math.max(host.clientHeight, 1);
        rendererRef.current.setSize(w, h, false);
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
      });
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (document.fullscreenElement === shellRef.current) {
        void document.exitFullscreen();
        return;
      }
      setFullscreen(false);
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [fullscreen]);

  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell) return;

    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await shell.requestFullscreen();
    } catch {
      setFullscreen((current) => !current);
    }
  }, []);

  const reframing = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !builtRef.current) return;
    frameCamera(cameraRef.current, controlsRef.current, builtRef.current.root);
  }, []);

  const togglePlay = useCallback(() => {
    if (!selected) return;
    if (!playing && animTimeRef.current >= selected.length && selected.loop === "once") {
      animTimeRef.current = 0;
      if (progressRef.current) {
        progressRef.current.textContent = formatAnimTime(0, selected.length);
      }
    }
    setPlaying((current) => !current);
  }, [playing, selected]);

  const onSelectAnimation = useCallback((index: number) => {
    setSelectedIndex(index);
    setPlaying(true);
  }, []);

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative h-full min-h-0 w-full overflow-hidden bg-black",
        fullscreen && "fixed inset-0 z-[70]",
        className,
      )}
    >
      <div ref={canvasHostRef} className="absolute inset-0" />

      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black/50 text-sm text-muted">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Loading 3D model…
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-panel px-6 text-center">
          <TriangleAlert aria-hidden className="size-5 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      ) : null}

      {!error && animations.length > 0 ? (
        <div className="absolute bottom-3 left-3 z-10 flex max-w-[min(100%-6.5rem,22rem)] flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            title={playing ? "Pause animation" : "Play animation"}
            aria-label={playing ? "Pause animation" : "Play animation"}
            className="rounded-md border border-hairline bg-panel/90 p-1.5 text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
          >
            {playing ? (
              <Pause aria-hidden className="size-3.5" />
            ) : (
              <Play aria-hidden className="size-3.5" />
            )}
          </button>
          <select
            value={selectedIndex}
            onChange={(event) => onSelectAnimation(Number(event.target.value))}
            aria-label="Select animation"
            className="h-8 max-w-[12rem] truncate rounded-md border border-hairline bg-panel/90 px-2 text-xs text-ink outline-none hover:bg-raised focus:border-accent"
          >
            {animations.map((animation) => (
              <option key={`${animation.index}-${animation.name}`} value={animation.index}>
                {animation.name}
              </option>
            ))}
          </select>
          <span
            ref={progressRef}
            className="rounded-md border border-hairline bg-panel/90 px-2 py-1.5 font-mono text-[11px] text-muted"
          >
            {selected ? formatAnimTime(0, selected.length) : ""}
          </span>
        </div>
      ) : null}

      {!error ? (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={reframing}
            title="Reset camera"
            aria-label="Reset camera framing"
            className="rounded-md border border-hairline bg-panel/90 p-1.5 text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
          >
            <RotateCcw aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="rounded-md border border-hairline bg-panel/90 p-1.5 text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
          >
            {fullscreen ? (
              <Minimize2 aria-hidden className="size-3.5" />
            ) : (
              <Maximize2 aria-hidden className="size-3.5" />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
