"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.1;

export type ImagePaneProps = {
  src: string;
  alt: string;
};

export function ImagePane({ src, alt }: ImagePaneProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState({ scale: 1, panX: 0, panY: 0 });
  const [dragging, setDragging] = useState(false);

  const resetView = useCallback(() => {
    setView({ scale: 1, panX: 0, panY: 0 });
  }, []);

  useEffect(() => {
    setView({ scale: 1, panX: 0, panY: 0 });
  }, [src]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const ox = event.clientX - rect.left - rect.width / 2;
      const oy = event.clientY - rect.top - rect.height / 2;
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;

      setView((prev) => {
        const nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.scale * factor));
        if (nextScale === prev.scale) return prev;
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          panX: ox - (ox - prev.panX) * ratio,
          panY: oy - (oy - prev.panY) * ratio,
        };
      });
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: MouseEvent) => {
      const origin = dragRef.current;
      if (!origin) return;
      setView((prev) => ({
        ...prev,
        panX: event.clientX - origin.x,
        panY: event.clientY - origin.y,
      }));
    };

    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  function onPointerDown(event: ReactMouseEvent) {
    if (view.scale <= 1 || event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { x: event.clientX - view.panX, y: event.clientY - view.panY };
    setDragging(true);
  }

  const percent = Math.round(view.scale * 100);

  return (
    <div
      ref={stageRef}
      className="relative h-full overflow-hidden bg-black/30"
      onMouseDown={onPointerDown}
    >
      <div
        className="flex h-full w-full items-center justify-center p-4"
        style={{
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`,
          cursor: view.scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onDoubleClick={resetView}
          className="max-h-full max-w-full select-none object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
      <button
        type="button"
        onClick={resetView}
        onMouseDown={(event) => event.stopPropagation()}
        title="Reset zoom"
        aria-label="Reset zoom to 100%"
        className="absolute bottom-3 right-3 rounded-md border border-hairline bg-panel/90 px-2 py-1 font-mono text-[11px] text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
      >
        {percent === 100 ? "100%" : `${percent}%`}
      </button>
    </div>
  );
}
