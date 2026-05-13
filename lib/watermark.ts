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

export type WatermarkAnimationType =
  | "none"
  | "fadeIn"
  | "fadeOut"
  | "pulse"
  | "blink"
  | "glow"
  | "flash"
  | "heartbeat"
  | "strobe"
  | "twinkle"
  | "slideInLeft"
  | "slideInRight"
  | "slideInTop"
  | "slideInBottom"
  | "bounce"
  | "spin"
  | "scalePulse";

export type WatermarkAnimation = {
  type: WatermarkAnimationType;
  /** Length of the animation in movie frames. */
  duration: number;
  /** Frames to wait before the animation starts. */
  delay: number;
  /** When true, looping animations cycle for the entire movie. */
  loop: boolean;
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
  animation: WatermarkAnimation;
};

export type WatermarkDimensions = { width: number; height: number };

export type AnimationState = {
  alphaMultiplier: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  /** Rotation in radians, clockwise. */
  rotation: number;
};

export const IDENTITY_ANIM_STATE: AnimationState = {
  alphaMultiplier: 1,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
};

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

export const defaultAnimation: WatermarkAnimation = {
  type: "none",
  duration: 24,
  delay: 0,
  loop: true,
};

export const defaultWatermark: WatermarkConfig = {
  enabled: false,
  source: defaultTextWatermark,
  position: "bottom-right",
  x: 0,
  y: 0,
  margin: 24,
  opacity: 0.85,
  animation: defaultAnimation,
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

  const basePos = resolveWatermarkPosition(
    cfg,
    wm,
    movie.params.viewBoxWidth,
    movie.params.viewBoxHeight,
  );

  const imageKey = uniqueImageKey(movie.images);
  const spriteBytes = buildAnimatedWatermarkSprite(
    imageKey,
    Math.max(1, movie.params.frames),
    basePos,
    wm,
    {
      width: movie.params.viewBoxWidth,
      height: movie.params.viewBoxHeight,
    },
    cfg.opacity,
    cfg.animation,
  );

  return {
    ...movie,
    images: { ...movie.images, [imageKey]: wm.bytes },
    spriteBytes: [...movie.spriteBytes, spriteBytes],
  };
}

/* ---------- Animation calculator (shared by overlay + baker) ---------- */

/**
 * Compute the watermark's transform/alpha contribution for a specific movie
 * frame. The result modifies a base identity state — callers add the offset
 * to the base position, multiply alpha, apply rotation/scale around centre.
 */
export function computeAnimationState(
  anim: WatermarkAnimation,
  frameIdx: number,
  wmDims: WatermarkDimensions,
  basePos: { x: number; y: number },
  viewbox: { width: number; height: number },
): AnimationState {
  if (anim.type === "none") return { ...IDENTITY_ANIM_STATE };

  const isIn =
    anim.type === "fadeIn" ||
    anim.type === "slideInLeft" ||
    anim.type === "slideInRight" ||
    anim.type === "slideInTop" ||
    anim.type === "slideInBottom";
  const isOut = anim.type === "fadeOut";
  const isLoop =
    anim.type === "pulse" ||
    anim.type === "blink" ||
    anim.type === "glow" ||
    anim.type === "flash" ||
    anim.type === "heartbeat" ||
    anim.type === "strobe" ||
    anim.type === "twinkle" ||
    anim.type === "bounce" ||
    anim.type === "spin" ||
    anim.type === "scalePulse";

  const dur = Math.max(1, anim.duration);
  const local = frameIdx - anim.delay;

  let t: number;
  if (local < 0) {
    // Before the animation starts: "in" animations show their start state,
    // everything else shows the static base.
    if (isIn) t = 0;
    else return { ...IDENTITY_ANIM_STATE };
  } else if (isLoop && anim.loop) {
    t = (local % dur) / dur;
  } else if (local >= dur) {
    // Finished one-shot animation: lock to end state.
    if (isIn) return { ...IDENTITY_ANIM_STATE };
    if (isOut) t = 1;
    else return { ...IDENTITY_ANIM_STATE };
  } else {
    t = local / dur;
  }

  return stateAt(anim.type, t, wmDims, basePos, viewbox);
}

function stateAt(
  type: WatermarkAnimationType,
  t: number,
  wmDims: WatermarkDimensions,
  basePos: { x: number; y: number },
  viewbox: { width: number; height: number },
): AnimationState {
  const base = { ...IDENTITY_ANIM_STATE };
  switch (type) {
    case "fadeIn":
      return { ...base, alphaMultiplier: clamp01(t) };
    case "fadeOut":
      return { ...base, alphaMultiplier: 1 - clamp01(t) };
    case "pulse": {
      // Smooth oscillation between 0.3 and 1.0 alpha.
      const wave = Math.sin(t * 2 * Math.PI) * 0.5 + 0.5;
      return { ...base, alphaMultiplier: 0.3 + 0.7 * wave };
    }
    case "blink":
      return { ...base, alphaMultiplier: t < 0.5 ? 1 : 0 };
    case "glow": {
      // Gentle breathing — never goes below 0.65 so the text never
      // disappears, just brightens and softens.
      const wave = Math.sin(t * 2 * Math.PI) * 0.5 + 0.5;
      return { ...base, alphaMultiplier: 0.65 + 0.35 * wave };
    }
    case "flash": {
      // One quick high-contrast spike per cycle then back to a quiet base.
      if (t < 0.08) return { ...base, alphaMultiplier: 1 };
      if (t < 0.16) return { ...base, alphaMultiplier: 0 };
      if (t < 0.24) return { ...base, alphaMultiplier: 1 };
      return { ...base, alphaMultiplier: 0.85 };
    }
    case "heartbeat": {
      // Two close thumps then a longer rest — like a medical heart-rate pulse.
      if (t < 0.10) return { ...base, alphaMultiplier: 1 };
      if (t < 0.16) return { ...base, alphaMultiplier: 0.45 };
      if (t < 0.26) return { ...base, alphaMultiplier: 1 };
      if (t < 0.32) return { ...base, alphaMultiplier: 0.45 };
      return { ...base, alphaMultiplier: 0.75 };
    }
    case "strobe": {
      // Fast on/off — 8 hard blinks per cycle.
      const phase = (t * 8) % 1;
      return { ...base, alphaMultiplier: phase < 0.5 ? 1 : 0 };
    }
    case "twinkle": {
      // Irregular shimmer — superimpose two off-tempo sine waves so it
      // doesn't feel as mechanical as a plain pulse.
      const a = Math.sin(t * 2 * Math.PI) * 0.5 + 0.5;
      const b = Math.sin(t * 6 * Math.PI + 1.3) * 0.5 + 0.5;
      const wave = (a * 2 + b) / 3;
      return { ...base, alphaMultiplier: 0.5 + 0.5 * wave };
    }
    case "slideInLeft": {
      const e = easeOutCubic(t);
      return { ...base, offsetX: -(basePos.x + wmDims.width) * (1 - e) };
    }
    case "slideInRight": {
      const e = easeOutCubic(t);
      return { ...base, offsetX: (viewbox.width - basePos.x) * (1 - e) };
    }
    case "slideInTop": {
      const e = easeOutCubic(t);
      return { ...base, offsetY: -(basePos.y + wmDims.height) * (1 - e) };
    }
    case "slideInBottom": {
      const e = easeOutCubic(t);
      return { ...base, offsetY: (viewbox.height - basePos.y) * (1 - e) };
    }
    case "bounce": {
      const wave = Math.abs(Math.sin(t * 2 * Math.PI));
      return { ...base, offsetY: -wmDims.height * 0.15 * wave };
    }
    case "spin":
      return { ...base, rotation: t * 2 * Math.PI };
    case "scalePulse":
      return { ...base, scale: 1 + 0.15 * Math.sin(t * 2 * Math.PI) };
    default:
      return base;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3);
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

/**
 * Build a SpriteEntity that places the watermark on every movie frame.
 * If the animation is "none" we emit one canonical frame and repeat its
 * bytes; otherwise each frame gets its own transform/alpha so the
 * watermark actually moves, fades, spins, etc. in the resulting .svga.
 */
function buildAnimatedWatermarkSprite(
  imageKey: string,
  frameCount: number,
  basePos: { x: number; y: number },
  wmDims: WatermarkDimensions,
  viewbox: { width: number; height: number },
  baseAlpha: number,
  animation: WatermarkAnimation,
): Uint8Array {
  const spriteW = Writer.create();
  spriteW.uint32((1 << 3) | 2).string(imageKey);

  if (animation.type === "none") {
    const staticFrame = buildFrameBytes(
      makeFrameTransform(basePos, wmDims, IDENTITY_ANIM_STATE),
      baseAlpha,
    );
    for (let i = 0; i < frameCount; i++) {
      spriteW.uint32((2 << 3) | 2).bytes(staticFrame);
    }
    return spriteW.finish();
  }

  for (let i = 0; i < frameCount; i++) {
    const state = computeAnimationState(animation, i, wmDims, basePos, viewbox);
    const transform = makeFrameTransform(basePos, wmDims, state);
    const alpha = baseAlpha * state.alphaMultiplier;
    spriteW.uint32((2 << 3) | 2).bytes(buildFrameBytes(transform, alpha));
  }
  return spriteW.finish();
}

/**
 * Compose the affine matrix that:
 *   1. positions the watermark at (basePos + animation offset)
 *   2. rotates by `state.rotation` and scales by `state.scale` about the
 *      bitmap centre (so the visual pivot is the middle of the watermark).
 */
function makeFrameTransform(
  basePos: { x: number; y: number },
  wmDims: WatermarkDimensions,
  state: AnimationState,
): Transform {
  const cx = wmDims.width / 2;
  const cy = wmDims.height / 2;
  const s = state.scale;
  const cosTh = Math.cos(state.rotation);
  const sinTh = Math.sin(state.rotation);

  // 2×2 part — clockwise rotation in screen space, uniform scale.
  const a = s * cosTh;
  const b = s * sinTh;
  const c = -s * sinTh;
  const d = s * cosTh;

  // Translate to (basePos + animation offset), then pre/post translate by
  // the bitmap centre so rotation/scale pivots around the middle.
  const px = basePos.x + state.offsetX;
  const py = basePos.y + state.offsetY;
  const tx = px + cx - a * cx - c * cy;
  const ty = py + cy - b * cx - d * cy;

  return { a, b, c, d, tx, ty };
}

function buildFrameBytes(transform: Transform, alpha: number): Uint8Array {
  const transformW = Writer.create();
  transformW.uint32((1 << 3) | 5).float(transform.a);
  transformW.uint32((2 << 3) | 5).float(transform.b);
  transformW.uint32((3 << 3) | 5).float(transform.c);
  transformW.uint32((4 << 3) | 5).float(transform.d);
  transformW.uint32((5 << 3) | 5).float(transform.tx);
  transformW.uint32((6 << 3) | 5).float(transform.ty);

  const frameW = Writer.create();
  frameW.uint32((1 << 3) | 5).float(alpha);
  frameW.uint32((3 << 3) | 2).bytes(transformW.finish());
  return frameW.finish();
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
