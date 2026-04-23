"use client";

import UPNG from "upng-js";
import { sniffImageMime, type MovieFile } from "./svga";

export type CompressOptions = {
  /**
   * 0.25..1 — "detail" factor. At 1.0 the bitmap is re-encoded at full
   * resolution with no quality loss beyond the chosen format/palette.
   * Below 1.0 we shrink the bitmap internally to `scale × original` and
   * then upscale back to the original dimensions before encoding — the
   * output has the *same* pixel dimensions as the input, just with less
   * detail. This means no transform compensation is ever needed and the
   * compressed file plays identically to the original in every SVGA
   * player, while the blurrier content lets PNG palette compression
   * achieve dramatically better ratios.
   */
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
      // Adopt the re-encoded bytes only if they're smaller than the original.
      out[key] = recoded.byteLength < srcBytes.byteLength ? recoded : srcBytes;
    } catch {
      out[key] = srcBytes;
    }
  }

  onProgress?.(keys.length, keys.length, "Done");

  // Bitmap dimensions are preserved, so sprite transforms stay exactly as
  // they were — the compressed file plays identically to the original in
  // every SVGA player.
  return { ...movie, images: out };
}

async function recodeBitmap(
  bytes: Uint8Array,
  mime: string,
  { scale, quality, format, colors }: CompressOptions,
): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const bmp = await createImageBitmapSafe(blob);

  const origWidth = bmp.width;
  const origHeight = bmp.height;

  // Final encoded bitmap always has the original dimensions — that's what
  // keeps sprite transforms valid and playback identical across players.
  const canvas = makeCanvas(origWidth, origHeight);
  const ctx = get2dCtx(canvas);
  (ctx as CanvasRenderingContext2D).imageSmoothingEnabled = true;
  (ctx as CanvasRenderingContext2D).imageSmoothingQuality = "high";

  if (scale >= 1) {
    // Straight re-encode at native size — pure palette/quality compression.
    ctx.drawImage(bmp, 0, 0, origWidth, origHeight);
  } else {
    // Detail-reduction path: draw through a smaller intermediate canvas to
    // strip high-frequency detail, then upscale back to the original
    // dimensions. The output pixel grid is unchanged, but the content is
    // blurrier — which lets PNG palette compression hit much higher ratios.
    const midW = Math.max(1, Math.round(origWidth * scale));
    const midH = Math.max(1, Math.round(origHeight * scale));
    const mid = makeCanvas(midW, midH);
    const midCtx = get2dCtx(mid);
    (midCtx as CanvasRenderingContext2D).imageSmoothingEnabled = true;
    (midCtx as CanvasRenderingContext2D).imageSmoothingQuality = "high";
    midCtx.drawImage(bmp, 0, 0, midW, midH);
    ctx.drawImage(mid as CanvasImageSource, 0, 0, origWidth, origHeight);
  }
  bmp.close?.();

  if (format === "png") {
    const imageData = ctx.getImageData(0, 0, origWidth, origHeight);
    const cnum = Math.max(0, Math.min(256, Math.round(colors)));
    const ab = UPNG.encode([imageData.data.buffer as ArrayBuffer], origWidth, origHeight, cnum);
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

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function get2dCtx(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("2D context unavailable");
  return ctx;
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
