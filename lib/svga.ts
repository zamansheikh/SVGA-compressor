"use client";

import pako from "pako";
import { Reader, Writer } from "protobufjs/minimal";

/**
 * An SVGA 2.x file decomposed into the parts we actually touch.
 *
 * We deliberately do NOT use protobufjs with a full schema for the outer
 * MovieEntity — real-world SVGA exporters add extra fields / shape variants
 * that break a strictly-typed decoder. Instead we read the outer message with
 * raw wire-format rules (only field numbers + wire types), and keep every
 * sprite / audio / params sub-message as an opaque byte buffer that we
 * splice back in unchanged when we re-encode. That way the compressor only
 * needs to understand the `images` map, and every other part of the file
 * round-trips byte-for-byte.
 */
export type MovieFile = {
  version: string;
  /** Raw bytes of the MovieParams sub-message — re-emitted unchanged. */
  paramsBytes: Uint8Array;
  /** Convenience fields parsed from paramsBytes. */
  params: {
    viewBoxWidth: number;
    viewBoxHeight: number;
    fps: number;
    frames: number;
  };
  images: Record<string, Uint8Array>;
  /** Raw bytes of each SpriteEntity — preserved untouched. */
  spriteBytes: Uint8Array[];
  /** Raw bytes of each AudioEntity — preserved untouched. */
  audioBytes: Uint8Array[];
};

/** Decode a .svga file (gzipped protobuf) into a MovieFile. */
export async function decodeSvga(bytes: Uint8Array): Promise<MovieFile> {
  // SVGA 1.x is a ZIP archive — detect and reject with a clear message.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  ) {
    throw new Error(
      "This looks like an SVGA 1.x file (ZIP-based). Only SVGA 2.x is supported — " +
        "please re-export from a newer version of your SVGA tooling.",
    );
  }

  let inflated: Uint8Array;
  try {
    inflated = pako.inflate(bytes);
  } catch {
    throw new Error(
      "Couldn't inflate this file — it doesn't look like a gzipped SVGA 2.x animation.",
    );
  }

  const reader = Reader.create(inflated);

  let version = "";
  let paramsBytes: Uint8Array = new Uint8Array();
  const images: Record<string, Uint8Array> = {};
  const spriteBytes: Uint8Array[] = [];
  const audioBytes: Uint8Array[] = [];

  try {
    while (reader.pos < reader.len) {
      const tag = reader.uint32();
      const fieldNum = tag >>> 3;
      const wireType = tag & 7;

      if (fieldNum === 1 && wireType === 2) {
        version = reader.string();
      } else if (fieldNum === 2 && wireType === 2) {
        paramsBytes = copyOut(reader.bytes());
      } else if (fieldNum === 3 && wireType === 2) {
        // map<string, bytes> — each entry is itself a length-delimited message.
        const entryBytes = reader.bytes();
        const entry = parseMapEntry(entryBytes);
        if (entry && entry.key) images[entry.key] = entry.value;
      } else if (fieldNum === 4 && wireType === 2) {
        spriteBytes.push(copyOut(reader.bytes()));
      } else if (fieldNum === 5 && wireType === 2) {
        audioBytes.push(copyOut(reader.bytes()));
      } else {
        // Unknown top-level field — safely skip whatever wire type it is.
        reader.skipType(wireType);
      }
    }
  } catch (e) {
    throw new Error(
      `Failed to parse SVGA structure: ${(e as Error).message}. The file may be corrupted.`,
    );
  }

  return {
    version: version || "2.0.0",
    paramsBytes,
    params: parseParams(paramsBytes),
    images,
    spriteBytes,
    audioBytes,
  };
}

/** Re-serialize a MovieFile back into a gzipped SVGA byte stream. */
export async function encodeSvga(movie: MovieFile): Promise<Uint8Array> {
  const w = Writer.create();

  // field 1 (string version), wire type 2
  w.uint32((1 << 3) | 2).string(movie.version || "2.0.0");
  // field 2 (MovieParams), wire type 2 — emitted verbatim
  w.uint32((2 << 3) | 2).bytes(movie.paramsBytes);
  // field 3 (map entries), wire type 2
  for (const [key, val] of Object.entries(movie.images)) {
    const entry = Writer.create();
    entry.uint32((1 << 3) | 2).string(key);
    entry.uint32((2 << 3) | 2).bytes(val);
    w.uint32((3 << 3) | 2).bytes(entry.finish());
  }
  // field 4 (sprites) — raw passthrough
  for (const s of movie.spriteBytes) w.uint32((4 << 3) | 2).bytes(s);
  // field 5 (audios) — raw passthrough
  for (const a of movie.audioBytes) w.uint32((5 << 3) | 2).bytes(a);

  return pako.deflate(w.finish(), { level: 9 });
}

function parseMapEntry(bytes: Uint8Array): { key: string; value: Uint8Array } | null {
  try {
    const r = Reader.create(bytes);
    let key = "";
    let value: Uint8Array = new Uint8Array();
    while (r.pos < r.len) {
      const tag = r.uint32();
      const f = tag >>> 3;
      const wt = tag & 7;
      if (f === 1 && wt === 2) key = r.string();
      else if (f === 2 && wt === 2) value = copyOut(r.bytes());
      else r.skipType(wt);
    }
    return { key, value };
  } catch {
    return null;
  }
}

function parseParams(bytes: Uint8Array): MovieFile["params"] {
  const out = { viewBoxWidth: 0, viewBoxHeight: 0, fps: 20, frames: 0 };
  if (!bytes.length) return out;
  try {
    const r = Reader.create(bytes);
    while (r.pos < r.len) {
      const tag = r.uint32();
      const f = tag >>> 3;
      const wt = tag & 7;
      if (f === 1 && wt === 5) out.viewBoxWidth = r.float();
      else if (f === 2 && wt === 5) out.viewBoxHeight = r.float();
      else if (f === 3 && wt === 5) out.fps = r.float();
      else if (f === 4 && wt === 0) out.frames = r.int32();
      else r.skipType(wt);
    }
  } catch {
    /* tolerate partial params */
  }
  return out;
}

/**
 * protobufjs `Reader.bytes()` returns a subarray view into the underlying
 * inflated buffer. We copy it so downstream mutation / buffer re-use is safe
 * and so GC can free the source buffer after decode completes.
 */
function copyOut(view: Uint8Array): Uint8Array {
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out;
}

/** Detect image mime type from magic bytes. */
export function sniffImageMime(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return "application/octet-stream";
}

export function imagesByteSize(movie: MovieFile): number {
  let n = 0;
  for (const k in movie.images) n += movie.images[k].byteLength;
  return n;
}

/* ----------------------------------------------------------------------------
 * Sprite transform rescaling
 *
 * SVGA players render images at the bitmap's *native* dimensions and apply
 * each frame's 2×3 affine transform to position/scale on-canvas. If we
 * downscale a bitmap from W×H to (W·s)×(H·s), the player would render it at
 * s× the intended size in the original transform's reference frame. We
 * compensate by multiplying the transform's 2×2 portion (a, b, c, d) by 1/s
 * so the output pixels end up exactly where the player originally expected.
 *
 * Translations (tx, ty), clip paths and shape layers are all in *output*
 * coordinate space and are deliberately left untouched.
 *
 * Implementation is low-level so any unknown/private sprite fields pass
 * through byte-for-byte.
 * ------------------------------------------------------------------------- */

export type ImageScale = { sx: number; sy: number };

/**
 * Rewrite every FrameEntity.transform inside a raw SpriteEntity byte stream,
 * compensating for image rescaling. Every other field — imageKey, matteKey,
 * layout, clipPath, shapes, and anything unknown — is preserved exactly.
 *
 * @param scaleMap per-imageKey actual scale factors
 * @param fallback optional scale used when the sprite's imageKey doesn't
 *                 resolve in scaleMap (common when an exporter uses image-map
 *                 keys that don't byte-match the sprite's reference).
 */
export function rescaleSpriteTransforms(
  spriteBytes: Uint8Array,
  scaleMap: Map<string, ImageScale>,
  fallback?: ImageScale,
): Uint8Array {
  // First pass: find the imageKey so we know which scale to apply.
  const imageKey = readSpriteImageKey(spriteBytes);
  const matchedKey =
    scaleMap.has(imageKey)
      ? imageKey
      : scaleMap.has(imageKey.replace(/\.[^.]+$/, ""))
        ? imageKey.replace(/\.[^.]+$/, "")
        : scaleMap.has(imageKey + ".png")
          ? imageKey + ".png"
          : scaleMap.has(imageKey + ".webp")
            ? imageKey + ".webp"
            : scaleMap.has(imageKey + ".jpg")
              ? imageKey + ".jpg"
              : scaleMap.has(imageKey + ".jpeg")
                ? imageKey + ".jpeg"
                : null;
  const scale = matchedKey ? scaleMap.get(matchedKey) : fallback;

  // Dev-only trace so `scale < 1` experiments are debuggable from DevTools.
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.debug(
      `[svga] sprite imageKey="${imageKey}" matched="${matchedKey ?? "(fallback)"}" scale=${
        scale ? `${scale.sx.toFixed(3)}×${scale.sy.toFixed(3)}` : "none"
      }`,
    );
  }

  if (!scale || (scale.sx === 1 && scale.sy === 1)) return spriteBytes;

  const invSx = 1 / scale.sx;
  const invSy = 1 / scale.sy;

  const reader = Reader.create(spriteBytes);
  const writer = Writer.create();

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;

    if (fieldNum === 2 && wireType === 2) {
      // FrameEntity — patch its transform and re-emit.
      const frameBytes = reader.bytes();
      const rewritten = rewriteFrame(toStandalone(frameBytes), invSx, invSy);
      writer.uint32(tag).bytes(rewritten);
    } else if (wireType === 2) {
      // imageKey, matteKey, or unknown length-delimited field — pass through.
      writer.uint32(tag).bytes(reader.bytes());
    } else if (wireType === 0) {
      writer.uint32(tag).int64(reader.int64());
    } else if (wireType === 1) {
      writer.uint32(tag).fixed64(reader.fixed64());
    } else if (wireType === 5) {
      writer.uint32(tag).fixed32(reader.fixed32());
    } else {
      reader.skipType(wireType);
    }
  }

  return writer.finish();
}

function readSpriteImageKey(spriteBytes: Uint8Array): string {
  const r = Reader.create(spriteBytes);
  while (r.pos < r.len) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const wt = tag & 7;
    if (f === 1 && wt === 2) return r.string();
    r.skipType(wt);
  }
  return "";
}

function rewriteFrame(frameBytes: Uint8Array, invSx: number, invSy: number): Uint8Array {
  const reader = Reader.create(frameBytes);
  const writer = Writer.create();

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;

    if (fieldNum === 3 && wireType === 2) {
      // Transform — read 6 floats, scale 2×2, re-emit.
      const tBytes = reader.bytes();
      writer.uint32(tag).bytes(rewriteTransform(toStandalone(tBytes), invSx, invSy));
    } else if (wireType === 2) {
      // layout, clipPath, shapes, or unknown — pass through.
      writer.uint32(tag).bytes(reader.bytes());
    } else if (wireType === 0) {
      writer.uint32(tag).int64(reader.int64());
    } else if (wireType === 1) {
      writer.uint32(tag).fixed64(reader.fixed64());
    } else if (wireType === 5) {
      // alpha (fixed32 float) — preserve exact bit pattern.
      writer.uint32(tag).fixed32(reader.fixed32());
    } else {
      reader.skipType(wireType);
    }
  }

  return writer.finish();
}

function rewriteTransform(
  transformBytes: Uint8Array,
  invSx: number,
  invSy: number,
): Uint8Array {
  // proto3 scalar defaults are 0.
  let a = 0, b = 0, c = 0, d = 0, tx = 0, ty = 0;
  const reader = Reader.create(transformBytes);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 5) {
      const v = reader.float();
      if (fieldNum === 1) a = v;
      else if (fieldNum === 2) b = v;
      else if (fieldNum === 3) c = v;
      else if (fieldNum === 4) d = v;
      else if (fieldNum === 5) tx = v;
      else if (fieldNum === 6) ty = v;
    } else {
      reader.skipType(wireType);
    }
  }

  // Matrix applied as: x' = a·x + c·y + tx  /  y' = b·x + d·y + ty
  // Shrinking the source bitmap by (sx, sy) means new source coords relate
  // to old by x_old = x_new / sx, so the equivalent output-preserving matrix
  // has each column scaled by 1/sx (x-column: a, b) and 1/sy (y-column: c, d).
  a *= invSx;
  b *= invSx;
  c *= invSy;
  d *= invSy;

  const w = Writer.create();
  w.uint32((1 << 3) | 5).float(a);
  w.uint32((2 << 3) | 5).float(b);
  w.uint32((3 << 3) | 5).float(c);
  w.uint32((4 << 3) | 5).float(d);
  w.uint32((5 << 3) | 5).float(tx);
  w.uint32((6 << 3) | 5).float(ty);
  return w.finish();
}

/**
 * protobufjs `Reader.bytes()` returns a subarray view. Copy it into a fresh
 * buffer so `Reader.create` on the result works independently of how the
 * original buffer gets aliased later.
 */
function toStandalone(view: Uint8Array): Uint8Array {
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out;
}
