"use client";

import protobuf from "protobufjs";
import { decodeSvga, sniffImageMime, type MovieFile } from "./svga";
import { SVGA_SPRITE_PROTO } from "./svga-proto";

type Frame = {
  alpha: number;
  transform: { a: number; b: number; c: number; d: number; tx: number; ty: number };
  layout: { x: number; y: number; width: number; height: number };
  clipPath: string;
};

type Sprite = {
  imageKey: string;
  frames: Frame[];
};

export type Renderer = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  isPlaying: () => boolean;
  seek: (frame: number) => void;
  currentFrame: () => number;
  onFrame?: (f: number) => void;
  destroy: () => void;
};

let spriteTypePromise: Promise<protobuf.Type> | null = null;
function getSpriteType(): Promise<protobuf.Type> {
  if (!spriteTypePromise) {
    spriteTypePromise = Promise.resolve().then(() => {
      const { root } = protobuf.parse(SVGA_SPRITE_PROTO, { keepCase: true });
      return root.lookupType("com.opensource.svga.SpriteEntity");
    });
  }
  return spriteTypePromise;
}

export async function createRenderer(
  bytes: Uint8Array,
  canvas: HTMLCanvasElement,
): Promise<Renderer> {
  const movie = await decodeSvga(bytes);
  return createRendererFromMovie(movie, canvas);
}

export async function createRendererFromMovie(
  movie: MovieFile,
  canvas: HTMLCanvasElement,
): Promise<Renderer> {
  const { viewBoxWidth, viewBoxHeight, fps, frames } = movie.params;

  // Decode each sprite individually so one bad sprite doesn't kill the whole preview.
  const SpriteType = await getSpriteType();
  const sprites: Sprite[] = [];
  for (const raw of movie.spriteBytes) {
    try {
      const msg = SpriteType.decode(raw);
      const obj = SpriteType.toObject(msg, { defaults: true }) as {
        imageKey?: string;
        frames?: Frame[];
      };
      sprites.push(normalizeSprite(obj));
    } catch {
      // Skip sprites that don't match our minimal schema; preview still renders the rest.
    }
  }

  // Load images
  const imageMap = new Map<string, ImageBitmap | HTMLImageElement>();
  await Promise.all(
    Object.entries(movie.images).map(async ([key, bytes]) => {
      const mime = sniffImageMime(bytes);
      if (mime === "application/octet-stream") return;
      const blob = new Blob([bytes], { type: mime });
      try {
        const bmp = await createImageBitmap(blob);
        imageMap.set(key, bmp);
        const stripped = key.replace(/\.[^.]+$/, "");
        if (stripped !== key && !imageMap.has(stripped)) imageMap.set(stripped, bmp);
      } catch {
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error(`Failed to load image ${key}`));
        });
        imageMap.set(key, img);
        const stripped = key.replace(/\.[^.]+$/, "");
        if (stripped !== key && !imageMap.has(stripped)) imageMap.set(stripped, img);
      }
    }),
  );

  // Fit canvas to device pixel ratio. Guard against zero-size viewBox.
  const safeW = viewBoxWidth > 0 ? viewBoxWidth : 300;
  const safeH = viewBoxHeight > 0 ? viewBoxHeight : 300;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(safeW * dpr));
  canvas.height = Math.max(1, Math.round(safeH * dpr));
  canvas.style.aspectRatio = `${safeW} / ${safeH}`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not obtain 2D canvas context");
  ctx.scale(dpr, dpr);

  let playing = false;
  let currentFrame = 0;
  let lastTs = 0;
  let rafId = 0;

  const totalFrames = Math.max(1, frames);
  const frameInterval = 1000 / Math.max(1, fps || 24);

  function draw(frameIdx: number) {
    if (!ctx) return;
    ctx.clearRect(0, 0, safeW, safeH);

    for (const sprite of sprites) {
      const frame = sprite.frames[frameIdx];
      if (!frame || frame.alpha <= 0) continue;

      const img =
        imageMap.get(sprite.imageKey) ??
        imageMap.get(sprite.imageKey.replace(/\.[^.]+$/, ""));
      if (!img) continue;

      ctx.save();
      ctx.globalAlpha = frame.alpha;
      const t = frame.transform;
      ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);

      if (frame.clipPath) {
        const p = parseSvgPath(frame.clipPath);
        if (p) ctx.clip(p);
      }

      const w =
        frame.layout.width > 0
          ? frame.layout.width
          : (img as ImageBitmap).width;
      const h =
        frame.layout.height > 0
          ? frame.layout.height
          : (img as ImageBitmap).height;
      try {
        ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
      } catch {
        /* closed bitmap / cross-origin edge cases */
      }
      ctx.restore();
    }
  }

  function tick(ts: number) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    const elapsed = ts - lastTs;
    if (elapsed >= frameInterval) {
      const steps = Math.floor(elapsed / frameInterval);
      currentFrame = (currentFrame + steps) % totalFrames;
      draw(currentFrame);
      api.onFrame?.(currentFrame);
      lastTs = ts - (elapsed % frameInterval);
    }
    rafId = requestAnimationFrame(tick);
  }

  draw(0);

  const api: Renderer = {
    canvas,
    width: safeW,
    height: safeH,
    fps,
    totalFrames,
    play() {
      if (playing) return;
      playing = true;
      lastTs = 0;
      rafId = requestAnimationFrame(tick);
    },
    pause() {
      playing = false;
      cancelAnimationFrame(rafId);
    },
    toggle() {
      playing ? api.pause() : api.play();
    },
    isPlaying() {
      return playing;
    },
    seek(f: number) {
      currentFrame = Math.max(0, Math.min(totalFrames - 1, Math.floor(f)));
      draw(currentFrame);
      api.onFrame?.(currentFrame);
    },
    currentFrame() {
      return currentFrame;
    },
    destroy() {
      api.pause();
      imageMap.forEach((img) => (img as ImageBitmap).close?.());
      imageMap.clear();
    },
  };

  return api;
}

function normalizeSprite(obj: { imageKey?: string; frames?: Frame[] }): Sprite {
  return {
    imageKey: obj.imageKey ?? "",
    frames: (obj.frames ?? []).map((f) => ({
      alpha: f?.alpha ?? 0,
      transform: {
        a: f?.transform?.a ?? 1,
        b: f?.transform?.b ?? 0,
        c: f?.transform?.c ?? 0,
        d: f?.transform?.d ?? 1,
        tx: f?.transform?.tx ?? 0,
        ty: f?.transform?.ty ?? 0,
      },
      layout: {
        x: f?.layout?.x ?? 0,
        y: f?.layout?.y ?? 0,
        width: f?.layout?.width ?? 0,
        height: f?.layout?.height ?? 0,
      },
      clipPath: f?.clipPath ?? "",
    })),
  };
}

function parseSvgPath(d: string): Path2D | null {
  try {
    return new Path2D(d);
  } catch {
    return null;
  }
}
