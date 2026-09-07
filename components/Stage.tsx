"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createRendererFromMovie, type Renderer } from "@/lib/renderer";
import type { MovieFile } from "@/lib/svga";
import type { Rect } from "@/lib/text-edit";
import type { WatermarkConfig } from "@/lib/watermark";
import WatermarkOverlay from "./WatermarkOverlay";
import RegionOverlay from "./RegionOverlay";

export type StageView = "original" | "edited" | "result";

type Props = {
  movies: { original: MovieFile; edited: MovieFile | null; result: MovieFile | null };
  view: StageView;
  onView: (v: StageView) => void;
  watermark: WatermarkConfig;
  onWatermarkChange: (w: WatermarkConfig) => void;
  /** Text-region editing, shown on the Original view. */
  region: {
    rect: Rect;
    state: "detected" | "guess" | "manual";
    placement: { x: number; y: number; scale: number };
    bitmap: { width: number; height: number };
    onChange: (r: Rect) => void;
  } | null;
  fileName: string;
  building: boolean;
};

const VIEWS: { id: StageView; label: string; hint: string }[] = [
  { id: "original", label: "Original", hint: "the file as loaded" },
  { id: "edited", label: "Edited", hint: "with your text, before compression" },
  { id: "result", label: "Result", hint: "what you will download" },
];

export default function Stage({ movies, view, onView, watermark, onWatermarkChange, region, fileName, building }: Props) {
  const movie = view === "result" ? movies.result : view === "edited" ? movies.edited : movies.original;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [frame, setFrame] = useState(0);
  const [total, setTotal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Keep the frame position across view switches so Original/Edited compare like-for-like.
  const lastFrame = useRef(0);

  useEffect(() => {
    if (!movie || !canvasRef.current) return;
    let cancelled = false;
    let r: Renderer | null = null;
    (async () => {
      try {
        r = await createRendererFromMovie(movie, canvasRef.current!);
        if (cancelled) return r.destroy();
        rendererRef.current = r;
        r.onFrame = (f) => {
          lastFrame.current = f;
          setFrame(f);
        };
        setTotal(r.totalFrames);
        r.seek(Math.min(lastFrame.current, r.totalFrames - 1));
        if (!region) {
          r.play();
          setPlaying(true);
        } else {
          setPlaying(false);
        }
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      r?.destroy();
      rendererRef.current = null;
    };
    // Pausing while a region is being edited is decided at load; toggling
    // the region afterwards should not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movie]);

  // Hold still while the user is placing the region.
  useEffect(() => {
    if (region && rendererRef.current?.isPlaying()) {
      rendererRef.current.pause();
      setPlaying(false);
    }
  }, [region]);

  const toggle = () => {
    rendererRef.current?.toggle();
    setPlaying(rendererRef.current?.isPlaying() ?? false);
  };
  const scrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    rendererRef.current?.pause();
    setPlaying(false);
    rendererRef.current?.seek(Number(e.target.value));
  };

  const savePng = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName.replace(/\.svga$/i, "")}_${view}_frame_${String(frame + 1).padStart(3, "0")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }, [fileName, view, frame]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.key === "1") onView("original");
      else if (e.key === "2" && movies.edited) onView("edited");
      else if (e.key === "3" && movies.result) onView("result");
      else if (e.key === " " && !e.shiftKey) { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movies.edited, movies.result, onView]);

  const showWatermark = view !== "result" && watermark.enabled && !!movies.original;

  return (
    <section className="glass rounded-2xl overflow-hidden flex flex-col min-h-[420px]" aria-label="Preview">
      {/* View switcher */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5">
        <div className="flex gap-1 rounded-lg bg-white/5 p-1" role="tablist" aria-label="Preview view">
          {VIEWS.map((v, i) => {
            const available = v.id === "original" || (v.id === "edited" ? !!movies.edited : !!movies.result);
            const active = view === v.id;
            return (
              <button
                key={v.id}
                role="tab"
                aria-selected={active}
                disabled={!available}
                onClick={() => onView(v.id)}
                title={`${v.hint} (${i + 1})`}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  active ? "bg-white text-[#070914] shadow" : available ? "text-white/70 hover:text-white hover:bg-white/10" : "text-white/25 cursor-not-allowed"
                }`}
              >
                {v.label}
                {v.id === "result" && building && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse" />}
              </button>
            );
          })}
        </div>
        {movie && (
          <div className="text-[11px] font-mono text-white/50 tabular-nums hidden sm:block">
            {Math.round(movie.params.viewBoxWidth)}×{Math.round(movie.params.viewBoxHeight)} · {movie.params.fps}fps · {total}f
          </div>
        )}
      </div>

      {/* Canvas */}
      <div className="relative flex-1 flex items-center justify-center p-4 sm:p-6 checkerboard min-h-[300px]">
        {err && <div className="text-center text-red-400 text-sm max-w-xs">{err}</div>}
        {!movie && !err && <div className="text-white/40 text-sm">Nothing to show yet</div>}
        <div className="relative max-w-full">
          <canvas
            ref={canvasRef}
            className={`${movie ? "block" : "hidden"} max-w-full max-h-[52vh] w-auto h-auto rounded-lg`}
            style={{ imageRendering: "auto" }}
          />
          {movie && showWatermark && (
            <WatermarkOverlay
              anchorRef={canvasRef}
              viewboxWidth={movie.params.viewBoxWidth}
              viewboxHeight={movie.params.viewBoxHeight}
              config={watermark}
              onChange={onWatermarkChange}
              currentFrame={frame}
            />
          )}
          {movie && region && view !== "result" && (
            <RegionOverlay
              anchorRef={canvasRef}
              viewbox={{ width: movie.params.viewBoxWidth, height: movie.params.viewBoxHeight }}
              placement={region.placement}
              bitmap={region.bitmap}
              region={region.rect}
              state={region.state}
              onChange={region.onChange}
            />
          )}
        </div>
        {region && view !== "result" && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[#070914]/80 backdrop-blur px-3 py-1 text-[11px] text-white/70 whitespace-nowrap">
            {region.state === "guess" ? "That box is a guess — drag it onto the text" : "Drag the box onto the text"} · corner to resize · arrow keys to nudge
          </div>
        )}
      </div>

      {/* Transport */}
      {movie && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-white/5">
          <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="h-9 w-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 transition">
            {playing ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M7 5v14l12-7z" /></svg>
            )}
          </button>
          <input type="range" min={0} max={Math.max(0, total - 1)} value={frame} onChange={scrub} aria-label="Seek" />
          <span className="text-[11px] font-mono text-white/60 tabular-nums w-14 text-right">{frame + 1}/{total}</span>
          <button type="button" onClick={savePng} title="Save this frame as PNG" aria-label="Save this frame as PNG" className="h-9 w-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 transition">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
              <path d="M12 3a1 1 0 0 1 1 1v9.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-5 5a1 1 0 0 1-1.414 0l-5-5a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1Z" />
              <path d="M4 17a1 1 0 0 1 1 1v2h14v-2a1 1 0 1 1 2 0v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
            </svg>
          </button>
        </div>
      )}
    </section>
  );
}
