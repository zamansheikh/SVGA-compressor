"use client";

import { useEffect, useRef, useState } from "react";
import { createRendererFromMovie, type Renderer } from "@/lib/renderer";
import type { MovieEntity } from "@/lib/svga";

type Props = {
  movie: MovieEntity | null;
  label: string;
  accent?: "brand" | "violet";
};

export default function SvgaPreview({ movie, label, accent = "brand" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [frame, setFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
        <canvas
          ref={canvasRef}
          className={`${movie ? "block" : "hidden"} max-w-full max-h-[50vh] w-auto h-auto rounded-lg`}
          style={{ imageRendering: "auto" }}
        />
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
        </div>
      )}
    </div>
  );
}
