"use client";

import UPNG from "upng-js";
import { sniffImageMime, type MovieFile } from "./svga";

export type CompressOptions = {
  /** 0.01..1 — scale factor applied to embedded bitmaps. */
  scale: number;
  /** 0..1 — quality for lossy re-encoding (webp/jpeg). */
  quality: number;
  /** Output format for embedded bitmaps. */
  format: "webp" | "png" | "jpeg";
  /**
   * PNG palette size: 0 = lossless 24-bit PNG, 1..256 = indexed palette
   * (smaller, slight visible quality loss). Only applies when format === "png".
   */
  colors: number;
};

export type CompressProgress = (done: number, total: number, label: string) => void;

/** Re-encode every embedded image in a MovieFile using the browser canvas. */
export async function compressMovieImages(
  movie: MovieFile,
  opts: CompressOptions,
  onProgress?: CompressProgress,
): Promise<MovieFile> {
  const keys = Object.keys(movie.images);
  const out: Record<string, Uint8Array> = {};

  let i = 0;
  for (const key of keys) {
    i++;
    onProgress?.(i - 1, keys.length, `Re-encoding ${key}`);
    const srcBytes = movie.images[key];
    const srcMime = sniffImageMime(srcBytes);

    if (srcMime === "application/octet-stream") {
      // Not a recognized bitmap (e.g. audio payload) — keep as-is.
      out[key] = srcBytes;
      continue;
    }

    try {
      const recoded = await recodeBitmap(srcBytes, srcMime, opts);
      // Safety valve: if re-encoding made the image *larger*, keep the original.
      out[key] = recoded.byteLength < srcBytes.byteLength ? recoded : srcBytes;
    } catch {
      out[key] = srcBytes;
    }
  }

  onProgress?.(keys.length, keys.length, "Done");

  return { ...movie, images: out };
}

async function recodeBitmap(
  bytes: Uint8Array,
  mime: string,
  { scale, quality, format, colors }: CompressOptions,
): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const bmp = await createImageBitmapSafe(blob);

  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : (() => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          return c;
        })();

  const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("2D context unavailable");
  (ctx as CanvasRenderingContext2D).imageSmoothingEnabled = true;
  (ctx as CanvasRenderingContext2D).imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  if (format === "png") {
    // UPNG produces a real compressed PNG: 24-bit lossless (colors=0) or
    // palette (colors=1..256) with alpha. Much smaller than canvas.toBlob.
    const imageData = ctx.getImageData(0, 0, w, h);
    const cnum = Math.max(0, Math.min(256, Math.round(colors)));
    const ab = UPNG.encode([imageData.data.buffer as ArrayBuffer], w, h, cnum);
    return new Uint8Array(ab);
  }

  const outMime = format === "jpeg" ? "image/jpeg" : "image/webp";
  let outBlob: Blob;
  if ("convertToBlob" in canvas) {
    outBlob = await (canvas as OffscreenCanvas).convertToBlob({
      type: outMime,
      quality,
    });
  } else {
    outBlob = await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        outMime,
        quality,
      );
    });
  }
  return new Uint8Array(await outBlob.arrayBuffer());
}

async function createImageBitmapSafe(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "undefined") {
    return createImageBitmap(blob);
  }
  throw new Error("createImageBitmap not available");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
