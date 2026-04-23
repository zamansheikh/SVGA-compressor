"use client";

import UPNG from "upng-js";
import {
  rescaleSpriteTransforms,
  sniffImageMime,
  type ImageScale,
  type MovieFile,
} from "./svga";

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

type RecodedBitmap = {
  bytes: Uint8Array;
  outWidth: number;
  outHeight: number;
  origWidth: number;
  origHeight: number;
};

/** Re-encode every embedded image in a MovieFile using the browser canvas. */
export async function compressMovieImages(
  movie: MovieFile,
  opts: CompressOptions,
  onProgress?: CompressProgress,
): Promise<MovieFile> {
  const keys = Object.keys(movie.images);
  const out: Record<string, Uint8Array> = {};
  const scaleMap = new Map<string, ImageScale>();

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
      const result = await recodeBitmap(srcBytes, srcMime, opts);
      // Adopt the re-encoded bytes only if they're smaller than the original.
      const adopted = result.bytes.byteLength < srcBytes.byteLength;
      out[key] = adopted ? result.bytes : srcBytes;

      // Record an entry for *every* image — use 1×1 for images whose bitmap
      // dimensions didn't actually change, so sprites referencing them are
      // correctly left alone during transform compensation. This is what
      // prevents the fallback scale from over-compensating sprites bound to
      // images we decided to keep at original size.
      const entry: ImageScale = adopted
        ? {
            sx: result.outWidth / result.origWidth,
            sy: result.outHeight / result.origHeight,
          }
        : { sx: 1, sy: 1 };
      registerScale(scaleMap, key, entry);
    } catch {
      out[key] = srcBytes;
      registerScale(scaleMap, key, { sx: 1, sy: 1 });
    }
  }

  // Was at least one image actually resized? If not, all sprite transforms
  // stay as-is.
  const anyScaled = [...scaleMap.values()].some((s) => s.sx !== 1 || s.sy !== 1);

  // Fallback scale: applied only to sprites whose imageKey *doesn't* resolve
  // in scaleMap at all — a defence against exporter-specific key naming
  // (keys with exotic extensions, hashes, or byte-level mismatches).
  // Sprites referencing images we deliberately kept at original size are
  // safe because those images have a sx=sy=1 entry, so lookup succeeds and
  // the fallback never fires.
  const fallback: ImageScale | undefined =
    anyScaled && opts.scale < 1 ? { sx: opts.scale, sy: opts.scale } : undefined;

  const spriteBytes = anyScaled
    ? movie.spriteBytes.map((sb) => rescaleSpriteTransforms(sb, scaleMap, fallback))
    : movie.spriteBytes;

  onProgress?.(keys.length, keys.length, "Done");

  return { ...movie, images: out, spriteBytes };
}

async function recodeBitmap(
  bytes: Uint8Array,
  mime: string,
  { scale, quality, format, colors }: CompressOptions,
): Promise<RecodedBitmap> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const bmp = await createImageBitmapSafe(blob);

  const origWidth = bmp.width;
  const origHeight = bmp.height;
  const w = Math.max(1, Math.round(origWidth * scale));
  const h = Math.max(1, Math.round(origHeight * scale));

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

  let outBytes: Uint8Array;
  if (format === "png") {
    const imageData = ctx.getImageData(0, 0, w, h);
    const cnum = Math.max(0, Math.min(256, Math.round(colors)));
    const ab = UPNG.encode([imageData.data.buffer as ArrayBuffer], w, h, cnum);
    outBytes = new Uint8Array(ab);
  } else {
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
    outBytes = new Uint8Array(await outBlob.arrayBuffer());
  }

  return {
    bytes: outBytes,
    outWidth: w,
    outHeight: h,
    origWidth,
    origHeight,
  };
}

async function createImageBitmapSafe(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "undefined") {
    return createImageBitmap(blob);
  }
  throw new Error("createImageBitmap not available");
}

/**
 * Register a scale entry under every key shape a sprite might reference:
 * the raw key, the key without its extension, and the key with common image
 * extensions appended. Sprites and image-map entries don't always agree on
 * how to spell the same identifier.
 */
function registerScale(
  map: Map<string, ImageScale>,
  key: string,
  entry: ImageScale,
) {
  map.set(key, entry);
  const stripped = key.replace(/\.[^.]+$/, "");
  if (stripped !== key) map.set(stripped, entry);
  for (const ext of [".png", ".webp", ".jpg", ".jpeg"]) {
    if (!map.has(stripped + ext)) map.set(stripped + ext, entry);
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
