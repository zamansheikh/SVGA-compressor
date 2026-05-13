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

export type GradientFill = {
  enabled: boolean;
  /** Secondary colour blended with the parent's primary colour. */
  secondColor: string;
  /** Direction in degrees: 0° = left→right, 90° = top→bottom. */
  angle: number;
};

export type TextShadow = {
  enabled: boolean;
  color: string;
  /** Blur radius in viewbox pixels. */
  blur: number;
  offsetX: number;
  offsetY: number;
};

export type TextBackground = {
  enabled: boolean;
  color: string;
  opacity: number;
  gradient: GradientFill;
  /** Corner radius in viewbox pixels. */
  radius: number;
};

export type TextWatermark = {
  kind: "text";
  text: string;
  fontSize: number;
  color: string;
  gradient: GradientFill;
  stroke: boolean;
  shadow: TextShadow;
  bg: TextBackground;
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

export const defaultTextWatermark: TextWatermark = {
  kind: "text",
  text: "© Your Brand",
  fontSize: 32,
  color: "#ffffff",
  gradient: { enabled: false, secondColor: "#8b5cf6", angle: 90 },
  stroke: true,
  shadow: {
    enabled: false,
    color: "#000000",
    blur: 8,
    offsetX: 0,
    offsetY: 2,
  },
  bg: {
    enabled: false,
    color: "#000000",
    opacity: 0.5,
    gradient: { enabled: false, secondColor: "#3066ff", angle: 90 },
    radius: 12,
  },
};

export const defaultWatermark: WatermarkConfig = {
  enabled: false,
  source: defaultTextWatermark,
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

type TextLayout = {
  /** Full bitmap size (content + shadow extents). */
  width: number;
  height: number;
  /** Content rectangle inside the bitmap (where bg pill + text sit). */
  contentX: number;
  contentY: number;
  contentW: number;
  contentH: number;
  /** Baseline position for ctx.fillText / strokeText. */
  baselineX: number;
  baselineY: number;
};

function layoutText(t: TextWatermark): TextLayout | null {
  if (!t.text.trim()) return null;
  const canvas = makeCanvas(10, 10);
  const ctx = get2dCtx(canvas);
  ctx.font = textFont(t.fontSize);
  const metrics = ctx.measureText(t.text);
  const ascent = metrics.actualBoundingBoxAscent || t.fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || t.fontSize * 0.2;
  const padding = Math.ceil(t.fontSize * 0.35);
  const contentW = Math.ceil(metrics.width + padding * 2);
  const contentH = Math.ceil(ascent + descent + padding * 2);

  // Shadow extends the bitmap beyond the content rectangle. We need to grow
  // the bitmap on each side so the shadow isn't clipped.
  const sh = t.shadow;
  let padLeft = 0, padTop = 0, padRight = 0, padBottom = 0;
  if (sh.enabled) {
    const grow = sh.blur;
    padLeft = Math.max(0, grow - sh.offsetX);
    padTop = Math.max(0, grow - sh.offsetY);
    padRight = Math.max(0, grow + sh.offsetX);
    padBottom = Math.max(0, grow + sh.offsetY);
  }

  const width = contentW + padLeft + padRight;
  const height = contentH + padTop + padBottom;
  return {
    width,
    height,
    contentX: padLeft,
    contentY: padTop,
    contentW,
    contentH,
    baselineX: padLeft + padding,
    baselineY: padTop + padding + ascent,
  };
}

function measureText(t: TextWatermark): WatermarkDimensions | null {
  const layout = layoutText(t);
  return layout && { width: layout.width, height: layout.height };
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
  const layout = layoutText(t);
  if (!layout) return null;

  const canvas = makeCanvas(layout.width, layout.height);
  const ctx = get2dCtx(canvas);

  // 1) Background pill — drawn first so everything else lands on top.
  if (t.bg.enabled) {
    const radius = Math.max(
      0,
      Math.min(t.bg.radius, layout.contentW / 2, layout.contentH / 2),
    );
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, t.bg.opacity));
    ctx.fillStyle = t.bg.gradient.enabled
      ? linearGradientFromAngle(
          ctx,
          layout.contentX,
          layout.contentY,
          layout.contentW,
          layout.contentH,
          t.bg.gradient.angle,
          t.bg.color,
          t.bg.gradient.secondColor,
        )
      : t.bg.color;
    pathRoundedRect(
      ctx,
      layout.contentX,
      layout.contentY,
      layout.contentW,
      layout.contentH,
      radius,
    );
    ctx.fill();
    ctx.restore();
  }

  // 2) Configure font / baseline.
  ctx.font = textFont(t.fontSize);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // 3) Drop shadow — Canvas applies shadowColor/shadowBlur/offsets to every
  //    drawing operation until we clear them. We set this BEFORE drawing the
  //    text so the shadow appears around (or behind) the text glyphs.
  if (t.shadow.enabled) {
    ctx.shadowColor = t.shadow.color;
    ctx.shadowBlur = t.shadow.blur;
    ctx.shadowOffsetX = t.shadow.offsetX;
    ctx.shadowOffsetY = t.shadow.offsetY;
  }

  // 4) Stroke — keeps the dark outline regardless of fill colour / gradient.
  if (t.stroke) {
    ctx.lineWidth = Math.max(2, t.fontSize / 10);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(t.text, layout.baselineX, layout.baselineY);
  }

  // 5) Fill — solid colour or linear gradient across the text bounding box.
  if (t.gradient.enabled) {
    // The gradient maps onto the visible text rectangle, NOT the whole bitmap,
    // so the colour transition isn't squashed when the shadow extends the bitmap.
    ctx.fillStyle = linearGradientFromAngle(
      ctx,
      layout.contentX,
      layout.contentY,
      layout.contentW,
      layout.contentH,
      t.gradient.angle,
      t.color,
      t.gradient.secondColor,
    );
  } else {
    ctx.fillStyle = t.color;
  }
  ctx.fillText(t.text, layout.baselineX, layout.baselineY);

  // Reset shadow state in case any downstream code reuses ctx.
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  return {
    bytes: await canvasToPngBytes(canvas),
    width: layout.width,
    height: layout.height,
  };
}

/** Build a linear gradient that spans an axis-aligned box at the given angle. */
function linearGradientFromAngle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  angleDeg: number,
  startColor: string,
  endColor: string,
): CanvasGradient {
  // 0° = left→right; 90° = top→bottom; rotates clockwise.
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const projLen = Math.abs(w * cos) + Math.abs(h * sin);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const x0 = cx - (cos * projLen) / 2;
  const y0 = cy - (sin * projLen) / 2;
  const x1 = cx + (cos * projLen) / 2;
  const y1 = cy + (sin * projLen) / 2;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, startColor);
  g.addColorStop(1, endColor);
  return g;
}

/** Trace a rounded rectangle as the current path. Caller fills or strokes. */
function pathRoundedRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  if (typeof (ctx as CanvasRenderingContext2D).roundRect === "function") {
    (ctx as CanvasRenderingContext2D).roundRect(x, y, w, h, r);
    return;
  }
  // Manual fallback for older runtimes.
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
