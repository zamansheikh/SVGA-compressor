"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createRendererFromMovie, type Renderer } from "@/lib/renderer";
import type { MovieFile } from "@/lib/svga";
import {
  computeAnimationState,
  renderWatermarkPng,
  resolveWatermarkPosition,
  type WatermarkConfig,
} from "@/lib/watermark";
import WatermarkOverlay from "./WatermarkOverlay";

type Props = {
  movie: MovieFile | null;
  label: string;
  accent?: "brand" | "violet";
  /** When provided, renders an interactive watermark overlay on top. */
  watermark?: WatermarkConfig;
  /** Called when the user drags or nudges the watermark overlay. */
  onWatermarkChange?: (next: WatermarkConfig) => void;
  /** Base filename (without extension) used for exported frames. */
  exportNameBase?: string;
};

export default function SvgaPreview({
  movie,
  label,
  accent = "brand",
  watermark,
  onWatermarkChange,
  exportNameBase,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [frame, setFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!movie || !canvasRef.current) return;
    let cancelled = false;
    let renderer: Renderer | null = null;

    (async () => {
      try {
        renderer = await createRendererFromMovie(movie, canvasRef.current!);
        if (cancelled) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.onFrame = (f) => setFrame(f);
        setTotalFrames(renderer.totalFrames);
        renderer.play();
        setIsPlaying(true);
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, [movie]);

  const togglePlay = () => {
    rendererRef.current?.toggle();
    setIsPlaying(rendererRef.current?.isPlaying() ?? false);
  };

  const restart = () => {
    rendererRef.current?.seek(0);
    rendererRef.current?.play();
    setIsPlaying(true);
  };

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = Number(e.target.value);
    rendererRef.current?.pause();
    setIsPlaying(false);
    rendererRef.current?.seek(f);
  };

  /**
   * Snapshot the currently-displayed frame as a PNG.
   *
   * The canvas already holds whatever the renderer drew for this frame, so
   * we use its bitmap as the starting point. If the watermark is being
   * shown via the live overlay (i.e. this pane drives `onWatermarkChange`
   * — the original pane before bake), we composite the watermark PNG into
   * the snapshot using the exact same animation state the overlay applies
   * on screen. The compressed pane already has the watermark baked into
   * the canvas via the SVGA sprites, so no compositing is needed.
   */
  const exportFrame = useCallback(async () => {
    if (!canvasRef.current || !movie) return;
    setExporting(true);
    try {
      const src = canvasRef.current;
      // Build the export canvas at the source's native pixel resolution.
      const out = document.createElement("canvas");
      out.width = src.width;
      out.height = src.height;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("Failed to get export canvas context");
      ctx.drawImage(src, 0, 0);

      const showsOverlay = !!(watermark?.enabled && onWatermarkChange);
      if (showsOverlay && watermark) {
        const wm = await renderWatermarkPng(watermark, movie.params.viewBoxWidth);
        if (wm) {
          const wmBlob = new Blob([wm.bytes as BlobPart], { type: "image/png" });
          const wmBmp = await createImageBitmap(wmBlob);
          const basePos = resolveWatermarkPosition(
            watermark,
            wm,
            movie.params.viewBoxWidth,
            movie.params.viewBoxHeight,
          );
          const state = computeAnimationState(
            watermark.animation,
            frame,
            wm,
            basePos,
            {
              width: movie.params.viewBoxWidth,
              height: movie.params.viewBoxHeight,
            },
          );

          // The source canvas was scaled by the renderer with DPR ×
          // viewbox→canvas. To draw the watermark in matching coordinates
          // we replicate that scaling.
          const dprX = src.width / movie.params.viewBoxWidth;
          const dprY = src.height / movie.params.viewBoxHeight;
          ctx.save();
          ctx.scale(dprX, dprY);
          ctx.globalAlpha = watermark.opacity * state.alphaMultiplier;
          const px = basePos.x + state.offsetX;
          const py = basePos.y + state.offsetY;
          const cx = wm.width / 2;
          const cy = wm.height / 2;
          // Pivot rotation/scale around the watermark's centre.
          ctx.translate(px + cx, py + cy);
          ctx.rotate(state.rotation);
          ctx.scale(state.scale, state.scale);
          ctx.drawImage(wmBmp, -cx, -cy);
          ctx.restore();
          wmBmp.close?.();
        }
      }

      const blob = await new Promise<Blob | null>((resolve) => {
        out.toBlob(resolve, "image/png");
      });
      if (!blob) throw new Error("toBlob returned null");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeBase =
        (exportNameBase || label).toLowerCase().replace(/[^a-z0-9]+/g, "_") ||
        "frame";
      a.download = `${safeBase}_frame_${String(frame + 1).padStart(3, "0")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error("Frame export failed:", e);
    } finally {
      setExporting(false);
    }
  }, [movie, frame, watermark, onWatermarkChange, label, exportNameBase]);

  const accentClass = accent === "violet" ? "from-violet-500 to-fuchsia-500" : "from-brand-500 to-cyan-400";

  return (
    <div className="glass rounded-2xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full bg-gradient-to-r ${accentClass}`} />
          <span className="text-sm font-medium text-white/80">{label}</span>
        </div>
        {movie && (
          <div className="text-[11px] font-mono text-white/50 tabular-nums">
            {movie.params.viewBoxWidth}×{movie.params.viewBoxHeight} · {movie.params.fps}fps · {totalFrames}f
          </div>
        )}
      </div>

      <div className="relative flex items-center justify-center p-4 min-h-[260px] checkerboard">
        {!movie && !err && (
          <div className="text-center text-white/40 text-sm py-8">
            Drop an SVGA file to preview
          </div>
        )}
        {err && (
          <div className="text-center text-red-400 text-sm py-8 max-w-xs">{err}</div>
        )}
        {/* Wrapper anchors the watermark overlay to the canvas's exact box. */}
        <div className="relative">
          <canvas
            ref={canvasRef}
            className={`${movie ? "block" : "hidden"} max-w-full max-h-[38vh] w-auto h-auto rounded-lg`}
            style={{ imageRendering: "auto" }}
          />
          {movie && watermark?.enabled && onWatermarkChange && (
            <WatermarkOverlay
              anchorRef={canvasRef}
              viewboxWidth={movie.params.viewBoxWidth}
              viewboxHeight={movie.params.viewBoxHeight}
              config={watermark}
              onChange={onWatermarkChange}
              currentFrame={frame}
            />
          )}
        </div>
      </div>

      {movie && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-white/5">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="h-9 w-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 transition"
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M7 5v14l12-7z" /></svg>
            )}
          </button>
          <button
            type="button"
            onClick={restart}
            aria-label="Restart"
            className="h-9 w-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 transition"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
              <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />
            </svg>
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, totalFrames - 1)}
            value={frame}
            onChange={onScrub}
            aria-label="Seek"
          />
          <span className="text-[11px] font-mono text-white/60 tabular-nums w-14 text-right">
            {frame + 1}/{totalFrames}
          </span>
          <button
            type="button"
            onClick={exportFrame}
            disabled={exporting}
            aria-label={`Save frame ${frame + 1} as PNG`}
            title={`Save frame ${frame + 1} as PNG`}
            className="h-9 w-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white animate-spin">
                <path d="M12 4a8 8 0 1 1-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
                <path d="M12 3a1 1 0 0 1 1 1v9.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-5 5a1 1 0 0 1-1.414 0l-5-5a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1Z" />
                <path d="M4 17a1 1 0 0 1 1 1v2h14v-2a1 1 0 1 1 2 0v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
