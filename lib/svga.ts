"use client";

import pako from "pako";
import protobuf from "protobufjs";
import { SVGA_PROTO } from "./svga-proto";

export type MovieEntity = {
  version: string;
  params: {
    viewBoxWidth: number;
    viewBoxHeight: number;
    fps: number;
    frames: number;
  };
  images: Record<string, Uint8Array>;
  sprites: unknown[];
  audios?: unknown[];
};

let rootPromise: Promise<protobuf.Root> | null = null;

function getRoot(): Promise<protobuf.Root> {
  if (!rootPromise) {
    rootPromise = Promise.resolve().then(() => {
      const parsed = protobuf.parse(SVGA_PROTO, { keepCase: true });
      return parsed.root;
    });
  }
  return rootPromise;
}

async function getMovieType(): Promise<protobuf.Type> {
  const root = await getRoot();
  return root.lookupType("com.opensource.svga.MovieEntity");
}

/** Decode a .svga file (gzip-deflated protobuf) into a MovieEntity. */
export async function decodeSvga(bytes: Uint8Array): Promise<MovieEntity> {
  let inflated: Uint8Array;
  try {
    inflated = pako.inflate(bytes);
  } catch (err) {
    throw new Error(
      "This file isn't a valid SVGA 2.x animation (gzip inflate failed). " +
        "SVGA 1.x (ZIP-based) isn't supported.",
    );
  }

  const Movie = await getMovieType();
  const msg = Movie.decode(inflated);
  const obj = Movie.toObject(msg, {
    longs: Number,
    enums: Number,
    bytes: Array, // we'll coerce below
    defaults: true,
    arrays: true,
    objects: true,
  }) as {
    version: string;
    params: MovieEntity["params"];
    images: Record<string, Uint8Array | number[] | string>;
    sprites: unknown[];
    audios?: unknown[];
  };

  const images: Record<string, Uint8Array> = {};
  for (const [key, value] of Object.entries(obj.images ?? {})) {
    if (value instanceof Uint8Array) {
      images[key] = value;
    } else if (Array.isArray(value)) {
      images[key] = new Uint8Array(value);
    } else if (typeof value === "string") {
      // protobufjs sometimes returns base64 for bytes
      images[key] = base64ToBytes(value);
    }
  }

  return {
    version: obj.version || "2.0.0",
    params: obj.params,
    images,
    sprites: obj.sprites ?? [],
    audios: obj.audios ?? [],
  };
}

/** Encode a MovieEntity back into a gzip-deflated protobuf .svga byte stream. */
export async function encodeSvga(movie: MovieEntity): Promise<Uint8Array> {
  const Movie = await getMovieType();
  const err = Movie.verify(movie as unknown as Record<string, unknown>);
  if (err) throw new Error("SVGA verify failed: " + err);
  const proto = Movie.encode(Movie.create(movie as unknown as Record<string, unknown>)).finish();
  return pako.deflate(proto, { level: 9 });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Detect the image mime type from its magic bytes. */
export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  return "application/octet-stream";
}

/** Total byte size of all embedded images. */
export function imagesByteSize(movie: MovieEntity): number {
  let n = 0;
  for (const k in movie.images) n += movie.images[k].byteLength;
  return n;
}
