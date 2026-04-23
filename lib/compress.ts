"use client";

import { sniffImageMime, type MovieFile } from "./svga";

export type CompressOptions = {
  /** 0.01..1 — scale factor applied to embedded bitmaps. */
  scale: number;
  /** 0..1 — quality for lossy re-encoding (webp/jpeg). */
  quality: number;
  /** Output format for embedded bitmaps. */
  format: "webp" | "png" | "jpeg";
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
      // Not a recognized bitmap — keep as-is (e.g. audio tracks live here sometimes).
      out[key] = srcBytes;
      continue;
    }

    try {
      const recoded = await recodeBitmap(srcBytes, srcMime, opts);
      // Safety valve: if re-encoding made the image *larger*, keep the original.
      out[key] = recoded.byteLength < srcBytes.byteLength ? recoded : srcBytes;
    } catch {
      // If canvas fails for any reason, keep the original so the animation still plays.
      out[key] = srcBytes;
    }
  }

  onProgress?.(keys.length, keys.length, "Done");

  return { ...movie, images: out };
}

async function recodeBitmap(
  bytes: Uint8Array,
  mime: string,
  { scale, quality, format }: CompressOptions,
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

  const outMime =
    format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";

  let outBlob: Blob;
  if ("convertToBlob" in canvas) {
    outBlob = await (canvas as OffscreenCanvas).convertToBlob({
      type: outMime,
      quality: format === "png" ? undefined : quality,
    });
  } else {
    outBlob = await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        outMime,
        format === "png" ? undefined : quality,
      );
    });
  }
  return new Uint8Array(await outBlob.arrayBuffer());
}

async function createImageBitmapSafe(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "undefined") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // fall through to image element
    }
  }
  // Fallback: HTMLImageElement → ImageBitmap-like wrapper isn't straightforward,
  // so we rethrow and callers will keep the original bytes.
  throw new Error("createImageBitmap not available");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
