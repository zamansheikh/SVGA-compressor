"use client";

import { useCallback, useMemo, useState } from "react";
import Dropzone from "./Dropzone";
import SvgaPreview from "./SvgaPreview";
import Controls from "./Controls";
import Stats from "./Stats";
import {
  compressMovieImages,
  formatBytes,
  type CompressOptions,
} from "@/lib/compress";
import {
  decodeSvga,
  encodeSvga,
  imagesByteSize,
  type MovieFile,
} from "@/lib/svga";

type Progress = { done: number; total: number; label: string };

export default function Compressor() {
  const [file, setFile] = useState<File | null>(null);
  const [originalMovie, setOriginalMovie] = useState<MovieFile | null>(null);
  const [compressedMovie, setCompressedMovie] = useState<MovieFile | null>(null);
  const [originalSize, setOriginalSize] = useState<number | null>(null);
  const [compressedSize, setCompressedSize] = useState<number | null>(null);
  const [compressedBytes, setCompressedBytes] = useState<Uint8Array | null>(null);
  const [options, setOptions] = useState<CompressOptions>({
    scale: 0.75,
    quality: 0.8,
    format: "png",
    colors: 128,
  });
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = useCallback(async (f: File) => {
    setError(null);
    setFile(f);
    setCompressedMovie(null);
    setCompressedBytes(null);
    setCompressedSize(null);
    setOriginalSize(f.size);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const movie = await decodeSvga(bytes);
      setOriginalMovie(movie);
    } catch (e) {
      setError((e as Error).message);
      setOriginalMovie(null);
    }
  }, []);

  const totalImageBytes = useMemo(
    () => (originalMovie ? imagesByteSize(originalMovie) : 0),
    [originalMovie],
  );

  const compress = useCallback(async () => {
    if (!originalMovie) return;
    setWorking(true);
    setError(null);
    setProgress({ done: 0, total: Object.keys(originalMovie.images).length, label: "Starting" });
    try {
      const next = await compressMovieImages(originalMovie, options, (done, total, label) =>
        setProgress({ done, total, label }),
      );
      setProgress({ done: 1, total: 1, label: "Encoding SVGA" });
      const bytes = await encodeSvga(next);
      setCompressedMovie(next);
      setCompressedBytes(bytes);
      setCompressedSize(bytes.byteLength);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }, [originalMovie, options]);

  const download = useCallback(() => {
    if (!compressedBytes || !file) return;
    const blob = new Blob([compressedBytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name.replace(/\.svga$/i, "") + ".min.svga";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [compressedBytes, file]);

  const reset = useCallback(() => {
    setFile(null);
    setOriginalMovie(null);
    setCompressedMovie(null);
    setOriginalSize(null);
    setCompressedSize(null);
    setCompressedBytes(null);
    setError(null);
    setProgress(null);
  }, []);

  return (
    <div className="space-y-6">
      {!file && <Dropzone onFile={onFile} />}

      {file && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{file.name}</div>
            <div className="text-xs text-white/50">
              {formatBytes(file.size)}
              {originalMovie && (
                <>
                  {" · "}
                  {Object.keys(originalMovie.images).length} image
                  {Object.keys(originalMovie.images).length === 1 ? "" : "s"}
                  {" · "}
                  {formatBytes(totalImageBytes)} bitmaps
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={reset}
            className="shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1.5 text-white/80"
          >
            Clear
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {originalMovie && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <SvgaPreview movie={originalMovie} label="Original" />
            <SvgaPreview
              movie={compressedMovie ?? null}
              label={compressedMovie ? "Compressed" : "Compressed (run to preview)"}
              accent="violet"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_320px]">
            <Controls value={options} onChange={setOptions} disabled={working} />
            <Stats
              originalSize={originalSize}
              compressedSize={compressedSize}
              progress={progress}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={compress}
              disabled={working}
              className="flex-1 rounded-2xl px-6 py-3.5 text-sm font-semibold text-white bg-gradient-to-r from-brand-500 to-violet-500 shadow-lg shadow-brand-500/30 hover:shadow-brand-500/50 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {working ? "Compressing…" : "Compress"}
            </button>
            <button
              type="button"
              onClick={download}
              disabled={!compressedBytes || working}
              className="flex-1 rounded-2xl px-6 py-3.5 text-sm font-semibold text-white bg-white/10 hover:bg-white/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Download .svga
            </button>
          </div>
        </>
      )}
    </div>
  );
}
