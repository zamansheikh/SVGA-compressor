"use client";

import type { MovieFile } from "./svga";
import { sniffImageMime } from "./svga";
import { decodeSprites, type Sprite } from "./renderer";
import { canvasToPngBytes, get2dCtx, makeCanvas } from "./watermark";

/**
 * Replace the text painted into an SVGA — a level number, a rank label.
 *
 * Two kinds of file exist, and they need different surgery:
 *
 *   swap    - the text is its own bitmap (a 68x22 label placed over the
 *             badge). Render new text at that size and replace the bitmap.
 *   repaint - the text is painted INTO a larger bitmap (digits baked onto
 *             the pill). Find the region, paint the background back over it,
 *             draw the new text on top, replace the bitmap.
 *
 * Which applies is measured, not assumed. Given sibling files from the same
 * export (level-41 beside level-50), the bitmap that differs is the one
 * carrying text, and the union of differing pixels is where it sits. Every
 * sibling is tried and the one that differs least wins — a neighbour from a
 * different colour band lights up the whole badge and is discarded. Without
 * siblings, a label-shaped bitmap is swapped; anything else needs a region
 * given by hand.
 *
 * Everything but the edited bitmap round-trips as the original bytes.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Raster = { data: Uint8ClampedArray; width: number; height: number };

export type LookPreset =
  | "auto"
  | "white"
  | "white-outline"
  | "gold"
  | "silver"
  | "red"
  | "black"
  | "custom";

export type TextLook = {
  preset: LookPreset;
  /** Used by "custom". */
  color: string;
  gradient: boolean;
  secondColor: string;
  stroke: boolean;
  strokeColor: string;
  /** As a fraction of the font size. */
  strokeWidth: number;
};

export type EditMode = "auto" | "swap" | "repaint";

export type TextEditConfig = {
  enabled: boolean;
  text: string;
  look: TextLook;
  /** "auto" or an image key. */
  target: string;
  mode: EditMode;
  /** Manual region inside the target bitmap; overrides detection. */
  region: Rect | null;
  /** The region was placed by a guess, not by the user or a diff. */
  regionGuessed: boolean;
  /** Image keys to drop entirely, with every sprite drawn from them. */
  remove: string[];
};

export const LOOK_PRESETS: Record<Exclude<LookPreset, "auto" | "custom">, Partial<TextLook>> = {
  white: { color: "#ffffff", gradient: false, stroke: false },
  "white-outline": { color: "#ffffff", gradient: false, stroke: true, strokeColor: "#1a1a2e", strokeWidth: 0.08 },
  gold: { color: "#fff2b3", gradient: true, secondColor: "#e39b12", stroke: true, strokeColor: "#5a2d00", strokeWidth: 0.07 },
  silver: { color: "#ffffff", gradient: true, secondColor: "#b9c2d0", stroke: true, strokeColor: "#2c3440", strokeWidth: 0.07 },
  red: { color: "#ff8a8a", gradient: true, secondColor: "#c1121f", stroke: true, strokeColor: "#3a0007", strokeWidth: 0.07 },
  black: { color: "#111111", gradient: false, stroke: false },
};

export const defaultTextEdit: TextEditConfig = {
  enabled: false,
  text: "",
  look: {
    preset: "auto",
    color: "#ffffff",
    gradient: false,
    secondColor: "#e39b12",
    stroke: false,
    strokeColor: "#1a1a2e",
    strokeWidth: 0.07,
  },
  target: "auto",
  mode: "auto",
  region: null,
  regionGuessed: false,
  remove: [],
};

/**
 * When nothing can be measured — one file, no siblings, a full-canvas
 * badge — put a box where badge text usually is: the right part of the
 * biggest always-visible bitmap. It is a starting point for dragging, and is
 * labelled as a guess, never presented as a finding.
 */
export function guessRegion(bitmaps: BitmapInfo[], key?: string): { key: string; region: Rect } | null {
  const pool = bitmaps.filter((b) => b.isBitmap && b.ink && (key ? b.key === key : b.frames >= b.totalFrames * 0.8));
  if (!pool.length) return null;
  const base = pool.sort((a, b) => b.ink!.width * b.ink!.height - a.ink!.width * a.ink!.height)[0];
  const ink = base.ink!;
  const wide = ink.width >= ink.height * 1.6;
  const region = wide
    ? { x: ink.x + ink.width * 0.55, y: ink.y + ink.height * 0.18, width: ink.width * 0.38, height: ink.height * 0.64 }
    : { x: ink.x + ink.width * 0.2, y: ink.y + ink.height * 0.3, width: ink.width * 0.6, height: ink.height * 0.4 };
  return { key: base.key, region: { x: Math.round(region.x), y: Math.round(region.y), width: Math.round(region.width), height: Math.round(region.height) } };
}

export type SiblingFile = { name: string; movie: MovieFile };

export type BitmapInfo = {
  index: number;
  key: string;
  width: number;
  height: number;
  bytes: number;
  isBitmap: boolean;
  /** Frames this bitmap is visible on. */
  frames: number;
  totalFrames: number;
  /** First visible placement, in viewbox pixels, and the transform's scale. */
  placement: { x: number; y: number; scale: number } | null;
  /** Bounding box of the drawn pixels. */
  ink: Rect | null;
  /** Where it differs from the chosen sibling(s). */
  diff: Rect | null;
};

export type Plan = { key: string; mode: "swap" | "repaint"; region: Rect };

export type PlanSource = "diff" | "manual" | "label" | "none";

export type Analysis = {
  bitmaps: BitmapInfo[];
  /** The sibling that differed least, if any. */
  sibling: string | null;
  /** How many same-design siblings contributed to the region. */
  siblingsUsed: number;
  plans: Plan[];
  /** Where the plans came from — a measured diff, the user's own region, or a shape heuristic. */
  source: PlanSource;
  reason: string;
};

export type EditResult = {
  key: string;
  mode: "swap" | "repaint";
  region: Rect;
  fill: string;
  fontSize: number;
};

/* ------------------------------------------------------------------ */
/* Raster decode + cache                                                */
/* ------------------------------------------------------------------ */

const rasterCache = new WeakMap<MovieFile, Map<string, Raster | null>>();

export async function decodeRaster(bytes: Uint8Array): Promise<Raster> {
  const mime = sniffImageMime(bytes);
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const bmp = await createImageBitmap(blob);
  // Read the size before close(): a closed ImageBitmap reports 0x0, and
  // getImageData(0,0,0,0) throws — which silently made every bitmap "not a bitmap".
  const { width, height } = bmp;
  const canvas = makeCanvas(width, height);
  const ctx = get2dCtx(canvas);
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, width, height);
  return { data: img.data, width: img.width, height: img.height };
}

async function rasterOf(movie: MovieFile, key: string): Promise<Raster | null> {
  let cache = rasterCache.get(movie);
  if (!cache) {
    cache = new Map();
    rasterCache.set(movie, cache);
  }
  if (cache.has(key)) return cache.get(key)!;
  const bytes = movie.images[key];
  let raster: Raster | null = null;
  if (bytes && sniffImageMime(bytes) !== "application/octet-stream") {
    try {
      raster = await decodeRaster(bytes);
    } catch {
      raster = null;
    }
  }
  cache.set(key, raster);
  return raster;
}

/* ------------------------------------------------------------------ */
/* Pixel measurement — pure functions, no DOM                            */
/* ------------------------------------------------------------------ */

/** Smallest rectangle containing every pixel with alpha above `threshold`. */
export function alphaBounds(r: Raster, threshold = 8): Rect | null {
  const { data, width, height } = r;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Bounding box of pixels that genuinely differ between two rasters.
 *
 * Compared premultiplied: a fully transparent pixel's RGB is undefined and
 * varies from export to export, so a plain RGB diff lights up the whole
 * transparent margin. `threshold` absorbs re-encoding noise.
 */
export function diffRegion(a: Raster, b: Raster, threshold = 40, pad = 2): Rect | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  const { width, height } = a;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const aa = a.data[i + 3] / 255;
      const ab = b.data[i + 3] / 255;
      let delta = Math.abs(a.data[i + 3] - b.data[i + 3]);
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a.data[i + c] * aa - b.data[i + c] * ab);
        if (d > delta) delta = d;
      }
      if (delta > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return {
    x,
    y,
    width: Math.min(width, maxX + 1 + pad) - x,
    height: Math.min(height, maxY + 1 + pad) - y,
  };
}

/**
 * Paint the background back over `region`, row by row, blending from the
 * pixel just left of it to the pixel just right of it. Reproduces a flat
 * fill or a horizontal gradient — exactly enough for text on a pill, and it
 * only has to be right in the gaps the new glyphs leave open.
 */
export function inpaintRegion(r: Raster, region: Rect): void {
  const { data, width, height } = r;
  const x0 = Math.max(0, Math.round(region.x));
  const x1 = Math.min(width, Math.round(region.x + region.width));
  const y0 = Math.max(0, Math.round(region.y));
  const y1 = Math.min(height, Math.round(region.y + region.height));
  const span = x1 - x0;
  if (span <= 0) return;
  for (let y = y0; y < y1; y++) {
    const row = y * width * 4;
    const li = x0 - 1 >= 0 ? row + (x0 - 1) * 4 : -1;
    const ri = x1 < width ? row + x1 * 4 : -1;
    for (let x = x0; x < x1; x++) {
      const t = span > 1 ? (x - x0 + 0.5) / span : 0.5;
      const i = row + x * 4;
      for (let c = 0; c < 4; c++) {
        const l = li >= 0 ? data[li + c] : ri >= 0 ? data[ri + c] : 0;
        const rr = ri >= 0 ? data[ri + c] : l;
        data[i + c] = Math.round(l + (rr - l) * t);
      }
    }
  }
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function medianColor(picks: number[][]): string | null {
  if (picks.length < 8) return null;
  const med = (k: number) => {
    const v = picks.map((p) => p[k]).sort((m, n) => m - n);
    return v[Math.floor(v.length / 2)];
  };
  return hex(med(0), med(1), med(2));
}

/** The colour the old text was drawn in: pixels that stand apart from the inpainted background. */
export function sampleTextColor(original: Raster, background: Raster, region: Rect): string | null {
  const picks: number[][] = [];
  const x0 = Math.round(region.x), y0 = Math.round(region.y);
  for (let y = y0; y < y0 + Math.round(region.height); y++) {
    for (let x = x0; x < x0 + Math.round(region.width); x++) {
      const i = (y * original.width + x) * 4;
      if (original.data[i + 3] < 200) continue;
      let delta = 0;
      for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(original.data[i + c] - background.data[i + c]));
      if (delta > 60) picks.push([original.data[i], original.data[i + 1], original.data[i + 2]]);
    }
  }
  return medianColor(picks);
}

/** Dominant colour of a label sprite's own ink. */
export function sampleSpriteColor(r: Raster, ink: Rect): string | null {
  const picks: number[][] = [];
  for (let y = ink.y; y < ink.y + ink.height; y++) {
    for (let x = ink.x; x < ink.x + ink.width; x++) {
      const i = (y * r.width + x) * 4;
      if (r.data[i + 3] >= 200) picks.push([r.data[i], r.data[i + 1], r.data[i + 2]]);
    }
  }
  return medianColor(picks);
}

/**
 * A label-shaped bitmap: wide, and small *on the canvas*. Judged by the
 * placed footprint — an 88x92 digit sprite drawn at 0.4 scale covers a tenth
 * of a 145x54 badge, though its raw size says 60%.
 */
export function looksLikeLabel(ink: Rect, canvas: { width: number; height: number }, scale = 1): boolean {
  const w = ink.width * scale;
  const h = ink.height * scale;
  const aspect = w / Math.max(1, h);
  const share = (w * h) / Math.max(1, canvas.width * canvas.height);
  return aspect >= 1.2 && aspect <= 10 && share <= 0.3;
}

const unionRect = (a: Rect | undefined, b: Rect): Rect => {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/* ------------------------------------------------------------------ */
/* Sprite usage                                                          */
/* ------------------------------------------------------------------ */

type Usage = { frames: number[]; placement: { x: number; y: number; scale: number } | null };

async function imageUsage(movie: MovieFile): Promise<Map<string, Usage>> {
  const sprites: Sprite[] = await decodeSprites(movie);
  const usage = new Map<string, Usage>();
  for (const sprite of sprites) {
    const key = movie.images[sprite.imageKey] ? sprite.imageKey : sprite.imageKey.replace(/\.[^.]+$/, "");
    if (!movie.images[key]) continue;
    let u = usage.get(key);
    if (!u) {
      u = { frames: [], placement: null };
      usage.set(key, u);
    }
    sprite.frames.forEach((f, i) => {
      if (f.alpha <= 0.004 || f.layout.width <= 0 || f.layout.height <= 0) return;
      u!.frames.push(i);
      if (!u!.placement) {
        const t = f.transform;
        u!.placement = { x: t.tx, y: t.ty, scale: Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1 };
      }
    });
  }
  return usage;
}

/** Siblings share this movie's canvas and image keys — same export, different text. */
export function isSibling(movie: MovieFile, other: MovieFile): boolean {
  if (other === movie) return false;
  if (Math.round(other.params.viewBoxWidth) !== Math.round(movie.params.viewBoxWidth)) return false;
  if (Math.round(other.params.viewBoxHeight) !== Math.round(movie.params.viewBoxHeight)) return false;
  return Object.keys(other.images).join("\n") === Object.keys(movie.images).join("\n");
}

/* ------------------------------------------------------------------ */
/* Analysis                                                              */
/* ------------------------------------------------------------------ */

const SAME_DESIGN_MAX_COVER = 0.6;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Diff this movie against every sibling; keep the one that differs least and
 * union the regions of every same-design sibling. One neighbour only shows
 * the digits that differ from *it* (51 against 52 is just the ones column,
 * and the baked "5" would survive the repaint); the union is the text's full
 * extent.
 */
async function chooseSibling(
  movie: MovieFile,
  siblings: SiblingFile[],
  keys: string[],
  canvas: { width: number; height: number },
  usage: Map<string, Usage>,
): Promise<{ sibling: string | null; regions: Map<string, Rect>; used: number }> {
  let best: { name: string; regions: Map<string, Rect>; area: number } | null = null;
  const same: { name: string; regions: Map<string, Rect>; area: number }[] = [];

  for (const s of siblings.filter((c) => isSibling(movie, c.movie))) {
    const regions = new Map<string, Rect>();
    let area = 0;
    let mismatch = false;
    for (const key of keys) {
      const mine = movie.images[key];
      const theirs = s.movie.images[key];
      if (!theirs || bytesEqual(mine, theirs)) continue;
      const a = await rasterOf(movie, key);
      const b = await rasterOf(s.movie, key);
      if (!a || !b) continue;
      const region = diffRegion(a, b);
      if (!region) continue;
      regions.set(key, region);
      area += region.width * region.height;
      const ink = alphaBounds(a) ?? { x: 0, y: 0, width: a.width, height: a.height };
      const placed = usage.get(key)?.placement;
      if (
        region.width * region.height > SAME_DESIGN_MAX_COVER * ink.width * ink.height &&
        !looksLikeLabel(ink, canvas, placed?.scale ?? 1)
      ) {
        mismatch = true;
      }
    }
    if (!regions.size) continue;
    const entry = { name: s.name, regions, area };
    if (!best || area < best.area) best = entry;
    if (!mismatch) same.push(entry);
  }

  if (!same.length) return best ? { sibling: best.name, regions: best.regions, used: 0 } : { sibling: null, regions: new Map(), used: 0 };
  const regions = new Map<string, Rect>();
  for (const e of same) for (const [k, r] of e.regions) regions.set(k, unionRect(regions.get(k), r));
  const tightest = same.reduce((a, b) => (b.area < a.area ? b : a));
  return { sibling: tightest.name, regions, used: same.length };
}

export async function analyzeMovie(
  movie: MovieFile,
  siblings: SiblingFile[],
  config: Pick<TextEditConfig, "target" | "mode" | "region"> = defaultTextEdit,
): Promise<Analysis> {
  const canvas = { width: movie.params.viewBoxWidth, height: movie.params.viewBoxHeight };
  const usage = await imageUsage(movie);
  const keys = Object.keys(movie.images);
  const bitmapKeys = keys.filter((k) => sniffImageMime(movie.images[k]) !== "application/octet-stream");
  const chosen = await chooseSibling(movie, siblings, bitmapKeys, canvas, usage);

  const bitmaps: BitmapInfo[] = [];
  for (const [index, key] of keys.entries()) {
    const raster = await rasterOf(movie, key);
    const u = usage.get(key);
    bitmaps.push({
      index,
      key,
      width: raster?.width ?? 0,
      height: raster?.height ?? 0,
      bytes: movie.images[key].byteLength,
      isBitmap: !!raster,
      frames: u?.frames.length ?? 0,
      totalFrames: Math.max(1, movie.params.frames),
      placement: u?.placement ?? null,
      ink: raster ? alphaBounds(raster) : null,
      diff: chosen.regions.get(key) ?? null,
    });
  }

  const { plans, source, reason } = suggestPlans(bitmaps, canvas, config);
  return { bitmaps, sibling: chosen.sibling, siblingsUsed: chosen.used, plans, source, reason };
}

/**
 * With a usable sibling diff: the differing bitmaps, repainted inside the
 * differing region — unless the region is nearly the whole bitmap and the
 * bitmap is label-shaped, in which case the bitmap *is* the text and is
 * swapped. A whole-bitmap difference on a big bitmap means the sibling is a
 * different design (level-0 has no twin) and is discarded, not trusted.
 * Without one: a small, wide bitmap on screen every frame is swapped.
 */
export function suggestPlans(
  bitmaps: BitmapInfo[],
  canvas: { width: number; height: number },
  config: Pick<TextEditConfig, "target" | "mode" | "region">,
): { plans: Plan[]; source: PlanSource; reason: string } {
  const explicit = config.target !== "auto" ? bitmaps.find((b) => b.key === config.target) : null;

  if (explicit && config.region) {
    return { plans: [{ key: explicit.key, mode: config.mode === "swap" ? "swap" : "repaint", region: config.region }], source: "manual", reason: "region set by hand" };
  }
  if (explicit && config.mode === "swap" && explicit.ink) {
    return { plans: [{ key: explicit.key, mode: "swap", region: explicit.ink }], source: "manual", reason: "swap chosen by hand" };
  }

  const pool = explicit ? [explicit] : bitmaps;
  const plans: Plan[] = [];
  for (const b of pool) {
    if (!b.diff || !b.ink) continue;
    const cover = (b.diff.width * b.diff.height) / Math.max(1, b.ink.width * b.ink.height);
    if (cover >= 0.7) {
      if (looksLikeLabel(b.ink, canvas, b.placement?.scale ?? 1)) plans.push({ key: b.key, mode: "swap", region: b.ink });
    } else {
      plans.push({ key: b.key, mode: config.mode === "swap" ? "swap" : "repaint", region: config.mode === "swap" ? b.ink : b.diff });
    }
  }
  if (plans.length) {
    return { plans, source: "diff", reason: `differs from the sibling files in ${plans.length === 1 ? "one bitmap" : `${plans.length} bitmaps`}` };
  }

  if (explicit && config.mode === "repaint") {
    return { plans: [], source: "none", reason: `"${explicit.key}" needs a region — no sibling shows where its text is` };
  }

  const labels = pool
    .filter((b) => b.isBitmap && b.ink && b.frames >= b.totalFrames * 0.8 && looksLikeLabel(b.ink!, canvas, b.placement?.scale ?? 1))
    .sort((a, b) => a.ink!.width * a.ink!.height - b.ink!.width * b.ink!.height);
  if (labels.length) {
    return { plans: [{ key: labels[0].key, mode: "swap", region: labels[0].ink! }], source: "label", reason: "small, wide, on every frame — looks like a label" };
  }
  return { plans: [], source: "none", reason: "no sibling to diff against and no label-shaped bitmap — add sibling files or set a region" };
}

/* ------------------------------------------------------------------ */
/* Text rendering                                                        */
/* ------------------------------------------------------------------ */

export function textFont(size: number): string {
  return `800 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
}

function resolveLook(look: TextLook, sampled: string | null): TextLook {
  if (look.preset === "custom") return look;
  if (look.preset === "auto") {
    return { ...look, color: sampled ?? "#ffffff", gradient: false, stroke: false };
  }
  return { ...look, ...LOOK_PRESETS[look.preset] };
}

/**
 * Render text into a transparent bitmap of exactly width x height, sized to
 * fit and centred on its glyphs. Two passes: measure at a probe size, scale,
 * measure again, place — so it centres the ink, not the em box.
 */
export async function renderTextBitmap(opts: {
  text: string;
  width: number;
  height: number;
  look: TextLook;
  padding?: number;
}): Promise<{ bytes: Uint8Array; ink: Rect; fontSize: number }> {
  const { text, width, height, look } = opts;
  const padding = opts.padding ?? 0.06;
  const availW = Math.max(1, width * (1 - 2 * padding));
  const availH = Math.max(1, height * (1 - 2 * padding));

  const probe = makeCanvas(8, 8);
  const pctx = get2dCtx(probe);
  const measure = (size: number) => {
    pctx.font = textFont(size);
    const m = pctx.measureText(text);
    const asc = m.actualBoundingBoxAscent || size * 0.8;
    const desc = m.actualBoundingBoxDescent || size * 0.2;
    const left = m.actualBoundingBoxLeft || 0;
    const right = m.actualBoundingBoxRight || m.width;
    return { w: left + right, h: asc + desc, asc, left };
  };
  const probeSize = height;
  const p = measure(probeSize);
  const strokePad = look.stroke ? look.strokeWidth * probeSize : 0;
  const scale = Math.min(availW / (p.w + strokePad), availH / (p.h + strokePad));
  const fontSize = Math.max(1, probeSize * scale);
  const m = measure(fontSize);
  const sw = look.stroke ? look.strokeWidth * fontSize : 0;

  const canvas = makeCanvas(width, height);
  const ctx = get2dCtx(canvas);
  ctx.font = textFont(fontSize);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const inkW = m.w + sw;
  const inkH = m.h + sw;
  const x = (width - inkW) / 2 + m.left + sw / 2;
  const y = (height - inkH) / 2 + m.asc + sw / 2;

  if (look.stroke && sw > 0) {
    ctx.lineWidth = sw;
    ctx.lineJoin = "round";
    ctx.strokeStyle = look.strokeColor;
    ctx.strokeText(text, x, y);
  }
  if (look.gradient) {
    const g = ctx.createLinearGradient(0, y - m.asc, 0, y + (m.h - m.asc));
    g.addColorStop(0, look.color);
    g.addColorStop(1, look.secondColor);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = look.color;
  }
  ctx.fillText(text, x, y);

  return {
    bytes: await canvasToPngBytes(canvas),
    ink: { x: Math.round((width - inkW) / 2), y: Math.round((height - inkH) / 2), width: Math.round(inkW), height: Math.round(inkH) },
    fontSize,
  };
}

async function rasterToPng(r: Raster): Promise<Uint8Array> {
  const canvas = makeCanvas(r.width, r.height);
  const ctx = get2dCtx(canvas);
  ctx.putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
  return canvasToPngBytes(canvas);
}

async function compositeOnto(base: Raster, overlay: Uint8Array, left: number, top: number): Promise<Uint8Array> {
  const canvas = makeCanvas(base.width, base.height);
  const ctx = get2dCtx(canvas);
  ctx.putImageData(new ImageData(base.data, base.width, base.height), 0, 0);
  const bmp = await createImageBitmap(new Blob([overlay as BlobPart], { type: "image/png" }));
  ctx.drawImage(bmp, left, top);
  bmp.close?.();
  return canvasToPngBytes(canvas);
}

/* ------------------------------------------------------------------ */
/* Apply                                                                 */
/* ------------------------------------------------------------------ */

export async function applyTextEdit(
  movie: MovieFile,
  siblings: SiblingFile[],
  config: TextEditConfig,
  analysis?: Analysis,
): Promise<{ movie: MovieFile; edits: EditResult[]; analysis: Analysis }> {
  let out = movie;
  if (config.remove.length) out = removeBitmaps(out, config.remove);
  if (!config.enabled || !config.text.trim()) return { movie: out, edits: [], analysis: analysis ?? (await analyzeMovie(movie, siblings, config)) };

  const a = analysis ?? (await analyzeMovie(movie, siblings, config));
  if (!a.plans.length) throw new Error(`Could not work out where the text is: ${a.reason}.`);

  const images: Record<string, Uint8Array> = { ...out.images };
  const edits: EditResult[] = [];

  for (const plan of a.plans) {
    const raw = await rasterOf(movie, plan.key);
    if (!raw) continue;

    if (plan.mode === "swap") {
      const box = plan.region;
      const look = resolveLook(config.look, config.look.preset === "auto" ? sampleSpriteColor(raw, box) : null);
      const rendered = await renderTextBitmap({ text: config.text, width: box.width, height: box.height, look, padding: 0.02 });
      const blank: Raster = { data: new Uint8ClampedArray(raw.width * raw.height * 4), width: raw.width, height: raw.height };
      images[plan.key] = await compositeOnto(blank, rendered.bytes, box.x, box.y);
      edits.push({ key: plan.key, mode: "swap", region: box, fill: look.color, fontSize: rendered.fontSize });
    } else {
      const region = plan.region;
      const background: Raster = { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
      inpaintRegion(background, region);
      const look = resolveLook(config.look, config.look.preset === "auto" ? sampleTextColor(raw, background, region) : null);
      const rendered = await renderTextBitmap({
        text: config.text,
        width: Math.round(region.width),
        height: Math.round(region.height),
        look,
      });
      images[plan.key] = await compositeOnto(background, rendered.bytes, Math.round(region.x), Math.round(region.y));
      edits.push({ key: plan.key, mode: "repaint", region, fill: look.color, fontSize: rendered.fontSize });
    }
  }

  return { movie: { ...out, images }, edits, analysis: a };
}

/** Drop bitmaps and every sprite drawn from them. */
export function removeBitmaps(movie: MovieFile, keys: string[]): MovieFile {
  const drop = new Set(keys);
  const images: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(movie.images)) if (!drop.has(k)) images[k] = v;
  const spriteBytes = movie.spriteBytes.filter((s) => {
    const key = readSpriteImageKeyFast(s);
    return !(drop.has(key) || drop.has(key.replace(/\.[^.]+$/, "")));
  });
  return { ...movie, images, spriteBytes };
}

/** Field 1 of a SpriteEntity without a full decode. */
function readSpriteImageKeyFast(bytes: Uint8Array): string {
  let pos = 0;
  const varint = () => {
    let result = 0, shift = 0;
    for (;;) {
      const b = bytes[pos++];
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result;
      shift += 7;
    }
  };
  while (pos < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8), wire = tag % 8;
    if (wire === 2) {
      const len = varint();
      if (field === 1) return new TextDecoder().decode(bytes.subarray(pos, pos + len));
      pos += len;
    } else if (wire === 0) varint();
    else if (wire === 5) pos += 4;
    else if (wire === 1) pos += 8;
    else return "";
  }
  return "";
}

/** Build a bitmap thumbnail data URL for the picker. */
export async function bitmapThumbnail(movie: MovieFile, key: string, size = 96): Promise<string | null> {
  const bytes = movie.images[key];
  if (!bytes || sniffImageMime(bytes) === "application/octet-stream") return null;
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: sniffImageMime(bytes) }));
    const s = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const canvas = makeCanvas(w, h);
    const ctx = get2dCtx(canvas);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const png = await canvasToPngBytes(canvas);
    return URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
  } catch {
    return null;
  }
}
