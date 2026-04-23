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
