"use client";

import { Writer } from "protobufjs/minimal";
import type { MovieFile } from "./svga";

export type WatermarkPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center";

export type WatermarkAnchor = WatermarkPosition | "custom";

export type TextWatermark = {
  kind: "text";
  text: string;
  fontSize: number;
  color: string;
  stroke: boolean;
  bg: boolean;
  /** Background colour in `#rrggbb` form when `bg` is true. */
  bgColor: string;
  /** 0..1 alpha multiplier for the background fill. */
  bgOpacity: number;
};

export type ImageWatermark = {
  kind: "image";
  /** Raw bytes of an uploaded PNG/JPEG/WebP. */
  imageBytes: Uint8Array;
  mime: string;
  /** Target width as a fraction (0..1) of the viewbox width. */
  widthFraction: number;
};

export type WatermarkConfig = {
  enabled: boolean;
  source: TextWatermark | ImageWatermark;
  /**
   * Either a named preset corner or "custom" (explicit x/y, set when the
   * user drags the overlay or nudges with arrow keys).
   */
  position: WatermarkAnchor;
  /** Explicit top-left position in viewbox pixels; used when `position === "custom"`. */
  x: number;
  y: number;
  /** Margin from the edge in viewbox pixels — only consulted for presets. */
  margin: number;
  /** 0..1 alpha. */
  opacity: number;
};

export type WatermarkDimensions = { width: number; height: number };

export const defaultWatermark: WatermarkConfig = {
  enabled: false,
  source: {
    kind: "text",
    text: "© Your Brand",
    fontSize: 32,
    color: "#ffffff",
    stroke: true,
    bg: false,
    bgColor: "#000000",
    bgOpacity: 0.5,
  },
  position: "bottom-right",
  x: 0,
  y: 0,
  margin: 24,
  opacity: 0.85,
};

/* ---------- Dimension measurement (shared by overlay + baker) ---------- */

/** Measure how big the watermark will be in viewbox pixels. */
export async function measureWatermark(
  cfg: WatermarkConfig,
  viewboxWidth: number,
): Promise<WatermarkDimensions | null> {
  if (!cfg.enabled) return null;
  if (cfg.source.kind === "text") return measureText(cfg.source);
  return measureImage(cfg.source, viewboxWidth);
}

function measureText(t: TextWatermark): WatermarkDimensions | null {
  if (!t.text.trim()) return null;
  const canvas = makeCanvas(10, 10);
  const ctx = get2dCtx(canvas);
  ctx.font = textFont(t.fontSize);
  const metrics = ctx.measureText(t.text);
  const ascent = metrics.actualBoundingBoxAscent || t.fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || t.fontSize * 0.2;
  const padding = Math.ceil(t.fontSize * 0.35);
  return {
    width: Math.ceil(metrics.width + padding * 2),
    height: Math.ceil(ascent + descent + padding * 2),
  };
}

async function measureImage(
  i: ImageWatermark,
  viewboxWidth: number,
): Promise<WatermarkDimensions | null> {
  if (!i.imageBytes.byteLength) return null;
  const blob = new Blob([i.imageBytes as BlobPart], { type: i.mime });
  const bmp = await createImageBitmap(blob);
  const w = Math.max(8, Math.round(viewboxWidth * i.widthFraction));
  const h = Math.max(8, Math.round((bmp.height / bmp.width) * w));
  bmp.close?.();
  return { width: w, height: h };
}

/* ---------- Position resolution ---------- */

/** Compute the effective top-left position given current dims + config. */
export function resolveWatermarkPosition(
  cfg: WatermarkConfig,
  dims: WatermarkDimensions,
  viewboxWidth: number,
  viewboxHeight: number,
): { x: number; y: number } {
  if (cfg.position === "custom") {
    return clampToViewbox(cfg.x, cfg.y, dims, viewboxWidth, viewboxHeight);
  }
  const x = positionX(cfg.position, viewboxWidth, dims.width, cfg.margin);
  const y = positionY(cfg.position, viewboxHeight, dims.height, cfg.margin);
  return { x, y };
}

export function clampToViewbox(
  x: number,
  y: number,
  dims: WatermarkDimensions,
  viewboxWidth: number,
  viewboxHeight: number,
) {
  return {
    x: Math.max(0, Math.min(viewboxWidth - dims.width, x)),
    y: Math.max(0, Math.min(viewboxHeight - dims.height, y)),
  };
}

function positionX(
  p: WatermarkPosition,
  viewboxW: number,
  wmW: number,
  margin: number,
) {
  if (p === "top-left" || p === "bottom-left") return margin;
  if (p === "top-right" || p === "bottom-right") return viewboxW - wmW - margin;
  return (viewboxW - wmW) / 2;
}
function positionY(
  p: WatermarkPosition,
  viewboxH: number,
  wmH: number,
  margin: number,
) {
  if (p === "top-left" || p === "top-right") return margin;
  if (p === "bottom-left" || p === "bottom-right") return viewboxH - wmH - margin;
  return (viewboxH - wmH) / 2;
}

/* ---------- Bake watermark into a MovieFile ---------- */

export type RenderedWatermark = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

/**
 * Render the watermark to a PNG bitmap. Shared by the bake path and the
 * live overlay so what the user sees matches the file pixel-for-pixel.
 */
export async function renderWatermarkPng(
  cfg: WatermarkConfig,
  viewboxWidth: number,
): Promise<RenderedWatermark | null> {
  return renderWatermark(cfg, viewboxWidth);
}

export async function applyWatermark(
  movie: MovieFile,
  cfg: WatermarkConfig,
): Promise<MovieFile> {
  if (!cfg.enabled) return movie;

  const wm = await renderWatermark(cfg, movie.params.viewBoxWidth);
  if (!wm) return movie;

  const { x: tx, y: ty } = resolveWatermarkPosition(
    cfg,
    wm,
    movie.params.viewBoxWidth,
    movie.params.viewBoxHeight,
  );

  const imageKey = uniqueImageKey(movie.images);
  const spriteBytes = buildWatermarkSprite(
    imageKey,
    Math.max(1, movie.params.frames),
    { a: 1, b: 0, c: 0, d: 1, tx, ty },
    cfg.opacity,
  );

  return {
    ...movie,
    images: { ...movie.images, [imageKey]: wm.bytes },
    spriteBytes: [...movie.spriteBytes, spriteBytes],
  };
}

async function renderWatermark(
  cfg: WatermarkConfig,
  viewboxWidth: number,
): Promise<RenderedWatermark | null> {
  if (cfg.source.kind === "text") return renderTextWatermark(cfg.source);
  return renderImageWatermark(cfg.source, viewboxWidth);
}

async function renderTextWatermark(t: TextWatermark): Promise<RenderedWatermark | null> {
  const dims = measureText(t);
  if (!dims) return null;

  const canvas = makeCanvas(dims.width, dims.height);
  const ctx = get2dCtx(canvas);

  // Background pill (if enabled) — drawn before the text so the text sits on top.
  if (t.bg) {
    const radius = Math.min(dims.height / 2, t.fontSize * 0.35);
    fillRoundedRect(ctx, 0, 0, dims.width, dims.height, radius, t.bgColor, t.bgOpacity);
  }

  ctx.font = textFont(t.fontSize);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const padding = Math.ceil(t.fontSize * 0.35);
  const ascent = dims.height - padding * 2 - Math.ceil(t.fontSize * 0.2);
  const baselineY = padding + ascent;

  if (t.stroke) {
    ctx.lineWidth = Math.max(2, t.fontSize / 10);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(t.text, padding, baselineY);
  }
  ctx.fillStyle = t.color;
  ctx.fillText(t.text, padding, baselineY);

  return { bytes: await canvasToPngBytes(canvas), width: dims.width, height: dims.height };
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  opacity: number,
) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.fillStyle = color;
  ctx.beginPath();
  if (typeof (ctx as CanvasRenderingContext2D).roundRect === "function") {
    (ctx as CanvasRenderingContext2D).roundRect(x, y, w, h, r);
  } else {
    // Manual rounded-rect fallback for older browsers.
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

async function renderImageWatermark(
  i: ImageWatermark,
  viewboxWidth: number,
): Promise<RenderedWatermark | null> {
  if (!i.imageBytes.byteLength) return null;
  const blob = new Blob([i.imageBytes as BlobPart], { type: i.mime });
  const bmp = await createImageBitmap(blob);

  const targetW = Math.max(8, Math.round(viewboxWidth * i.widthFraction));
  const targetH = Math.max(8, Math.round((bmp.height / bmp.width) * targetW));

  const canvas = makeCanvas(targetW, targetH);
  const ctx = get2dCtx(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, targetW, targetH);
  bmp.close?.();

  return { bytes: await canvasToPngBytes(canvas), width: targetW, height: targetH };
}

function uniqueImageKey(existing: Record<string, Uint8Array>): string {
  let n = 0;
  let key = "__wm__";
  while (key in existing) {
    n++;
    key = `__wm_${n}__`;
  }
  return key;
}

type Transform = { a: number; b: number; c: number; d: number; tx: number; ty: number };

function buildWatermarkSprite(
  imageKey: string,
  frameCount: number,
  transform: Transform,
  alpha: number,
): Uint8Array {
  const transformW = Writer.create();
  transformW.uint32((1 << 3) | 5).float(transform.a);
  transformW.uint32((2 << 3) | 5).float(transform.b);
  transformW.uint32((3 << 3) | 5).float(transform.c);
  transformW.uint32((4 << 3) | 5).float(transform.d);
  transformW.uint32((5 << 3) | 5).float(transform.tx);
  transformW.uint32((6 << 3) | 5).float(transform.ty);
  const transformBytes = transformW.finish();

  const frameW = Writer.create();
  frameW.uint32((1 << 3) | 5).float(alpha);
  frameW.uint32((3 << 3) | 2).bytes(transformBytes);
  const frameBytes = frameW.finish();

  const spriteW = Writer.create();
  spriteW.uint32((1 << 3) | 2).string(imageKey);
  for (let i = 0; i < frameCount; i++) {
    spriteW.uint32((2 << 3) | 2).bytes(frameBytes);
  }
  return spriteW.finish();
}

/* ---------- canvas helpers ---------- */

export function textFont(size: number): string {
  return `bold ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
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

async function canvasToPngBytes(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Uint8Array> {
  let blob: Blob;
  if ("convertToBlob" in canvas) {
    blob = await (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" });
  } else {
    blob = await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/png",
      );
    });
  }
  return new Uint8Array(await blob.arrayBuffer());
}
