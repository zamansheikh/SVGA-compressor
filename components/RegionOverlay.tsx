"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Rect } from "@/lib/text-edit";

/**
 * The text region, drawn on the stage as a box you can move and resize.
 *
 * The region lives in the *bitmap's* pixel space; the bitmap is placed on the
 * canvas by its sprite transform. For the translate-plus-uniform-scale case
 * every badge uses, canvas = placement + region × scale, and that is the
 * mapping used here. A rotated sprite would draw the box slightly off; the
 * numbers in the inspector are still exact.
 */
type Props = {
  anchorRef: React.RefObject<HTMLCanvasElement | null>;
  viewbox: { width: number; height: number };
  /** Where the target bitmap sits on the canvas. */
  placement: { x: number; y: number; scale: number };
  /** Bitmap dimensions, to clamp the box. */
  bitmap: { width: number; height: number };
  region: Rect;
  /** Found by a diff, placed by a guess, or set by the user. */
  state: "detected" | "guess" | "manual";
  onChange: (r: Rect) => void;
};

const STYLE = {
  detected: { border: "border-emerald-400/90", chip: "bg-emerald-400 text-emerald-950", handle: "bg-emerald-400", label: "text found here" },
  guess: { border: "border-amber-400/90 border-dashed", chip: "bg-amber-400 text-amber-950", handle: "bg-amber-400", label: "best guess — drag onto the text" },
  manual: { border: "border-brand-400", chip: "bg-brand-400 text-white", handle: "bg-brand-400", label: "your region" },
};

export default function RegionOverlay({ anchorRef, viewbox, placement, bitmap, region, state, onChange }: Props) {
  const look = STYLE[state];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; start: Rect } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorRef]);

  const display = useMemo(() => (rect ? rect.width / viewbox.width : 0), [rect, viewbox.width]);
  if (!rect || display === 0) return null;

  // bitmap px -> display px
  const k = display * placement.scale;
  const left = (placement.x + region.x * placement.scale) * display;
  const top = (placement.y + region.y * placement.scale) * display;
  const width = region.width * k;
  const height = region.height * k;

  const clamp = (r: Rect): Rect => {
    const w = Math.max(4, Math.min(bitmap.width, r.width));
    const h = Math.max(4, Math.min(bitmap.height, r.height));
    return {
      x: Math.max(0, Math.min(bitmap.width - w, r.x)),
      y: Math.max(0, Math.min(bitmap.height - h, r.y)),
      width: w,
      height: h,
    };
  };

  const onPointerDown = (mode: "move" | "resize") => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: region };
    boxRef.current?.focus();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / k;
    const dy = (e.clientY - d.sy) / k;
    if (d.mode === "move") onChange(clamp({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }));
    else onChange(clamp({ ...d.start, width: d.start.width + dx, height: d.start.height + dy }));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    drag.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const grow = e.altKey;
    let dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    onChange(grow ? clamp({ ...region, width: region.width + dx, height: region.height + dy }) : clamp({ ...region, x: region.x + dx, y: region.y + dy }));
  };

  return (
    <div
      ref={boxRef}
      role="button"
      tabIndex={0}
      aria-label="Text region — drag to move, drag the corner to resize, arrow keys to nudge (Alt = resize, Shift = 10px)"
      onPointerDown={onPointerDown("move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={`absolute select-none cursor-move outline-none rounded-sm border-2 ${look.border} focus:ring-2 focus:ring-white/40`}
      style={{ left, top, width, height, touchAction: "none", boxShadow: "0 0 0 9999px rgba(7,9,20,0.35)" }}
    >
      <span className={`absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${look.chip}`}>
        {look.label} · {Math.round(region.width)}×{Math.round(region.height)}
      </span>
      <div
        onPointerDown={onPointerDown("resize")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-hidden
        className={`absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 rounded-sm cursor-nwse-resize ${look.handle}`}
        style={{ touchAction: "none" }}
      />
    </div>
  );
}
