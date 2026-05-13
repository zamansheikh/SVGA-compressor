"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  clampToViewbox,
  renderWatermarkPng,
  resolveWatermarkPosition,
  type WatermarkConfig,
  type WatermarkDimensions,
} from "@/lib/watermark";

type Props = {
  anchorRef: React.RefObject<HTMLElement | null>;
  viewboxWidth: number;
  viewboxHeight: number;
  config: WatermarkConfig;
  onChange: (next: WatermarkConfig) => void;
};

export default function WatermarkOverlay({
  anchorRef,
  viewboxWidth,
  viewboxHeight,
  config,
  onChange,
}: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [dims, setDims] = useState<WatermarkDimensions | null>(null);
  const [bitmapUrl, setBitmapUrl] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  // Track the canvas's display rect so the overlay aligns when it resizes.
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

  // Render the watermark to a PNG using the *same code path* the baker uses,
  // so the preview is byte-identical to what the player will see.
  // Only re-runs when the SOURCE changes — not when x/y/position change,
  // so dragging is smooth.
  useEffect(() => {
    if (!config.enabled) {
      setDims(null);
      setBitmapUrl(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;

    renderWatermarkPng(config, viewboxWidth)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setDims(null);
          setBitmapUrl(null);
          return;
        }
        const blob = new Blob([result.bytes as BlobPart], { type: "image/png" });
        createdUrl = URL.createObjectURL(blob);
        setBitmapUrl(createdUrl);
        setDims({ width: result.width, height: result.height });
      })
      .catch(() => {
        if (!cancelled) {
          setDims(null);
          setBitmapUrl(null);
        }
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // We intentionally re-render only on source/enabled/viewbox changes so
    // drag (which only touches x/y/position) doesn't thrash blob URLs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enabled, config.source, viewboxWidth]);

  const scale = useMemo(() => {
    if (!rect) return 0;
    return rect.width / viewboxWidth;
  }, [rect, viewboxWidth]);

  if (!config.enabled || !rect || !dims || scale === 0) return null;

  const { x: vbX, y: vbY } = resolveWatermarkPosition(
    config,
    dims,
    viewboxWidth,
    viewboxHeight,
  );

  const left = vbX * scale;
  const top = vbY * scale;
  const width = dims.width * scale;
  const height = dims.height * scale;

  function commitMove(viewboxX: number, viewboxY: number) {
    if (!dims) return;
    const { x, y } = clampToViewbox(viewboxX, viewboxY, dims, viewboxWidth, viewboxHeight);
    onChange({ ...config, position: "custom", x, y });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: vbX,
      startY: vbY,
    };
    overlayRef.current?.focus();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragState.current;
    if (!s || scale === 0) return;
    const dxDisplay = e.clientX - s.startClientX;
    const dyDisplay = e.clientY - s.startClientY;
    commitMove(s.startX + dxDisplay / scale, s.startY + dyDisplay / scale);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragState.current = null;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    commitMove(vbX + dx, vbY + dy);
  }

  return (
    <div
      ref={overlayRef}
      role="button"
      tabIndex={0}
      aria-label="Watermark — drag to position, or arrow keys to nudge"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="absolute select-none cursor-move outline-none ring-2 ring-brand-400/40 hover:ring-brand-400/80 focus:ring-brand-300 transition"
      style={{
        left,
        top,
        width,
        height,
        opacity: config.opacity,
        touchAction: "none",
      }}
    >
      {bitmapUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bitmapUrl}
          alt=""
          draggable={false}
          className="block w-full h-full pointer-events-none"
          style={{ imageRendering: "auto" }}
        />
      )}
    </div>
  );
}
