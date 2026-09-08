"use client";

import type { MovieFile } from "./svga";
import { sniffImageMime } from "./svga";
import { decodeSprites, parseSvgPath, type Sprite } from "./renderer";
import { canvasToPngBytes, get2dCtx, makeCanvas } from "./watermark";
import { buildGlyphLibrary, textFromName, type GlyphLibrary, type GlyphSample } from "./glyphs";

/**
 * Replace the text painted into an SVGA — a level number, a rank label, the
 * word on a ribbon.
 *
 * Finding the text, in order of trust:
 *
 *   1. diff     - sibling files from the same export with different text
 *                 (level-41 beside level-50). The bitmaps that differ carry
 *                 the text; the union of differing pixels is where it sits.
 *                 Only same-design siblings count: a neighbour from another
 *                 colour band lights up the whole badge and is discarded.
 *   2. detect   - render a frame, find light glyph strokes against a darker
 *                 backing, cluster them into a line, then map the line back
 *                 through each sprite's transform to the bitmap that owns
 *                 those pixels. Works on a single file.
 *   3. guess    - a box where badge text usually is, labelled as a guess.
 *
 * Then, how to change it:
 *
 *   swap    - the bitmap is only text: re-render it at that size.
 *   repaint - the text is painted into a larger bitmap: paint the backing
 *             over the region, draw the new text on top. When that bitmap is
 *             one frame of a sequence, every frame of the sequence gets the
 *             same treatment, or the text would flicker.
 *
 * Everything but the edited bitmaps round-trips as the original bytes.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Raster = { data: Uint8ClampedArray; width: number; height: number };

export type LookPreset = "auto" | "white" | "white-outline" | "gold" | "silver" | "red" | "black" | "custom";

export type TextLook = {
  preset: LookPreset;
  color: string;
  gradient: boolean;
  secondColor: string;
  stroke: boolean;
  strokeColor: string;
  /** As a fraction of the font size. */
  strokeWidth: number;
};

export type EditMode = "auto" | "swap" | "repaint";
/** "set": the set's own glyphs lifted from sibling files (exact); "render": draw with a font. */
export type FontMode = "set" | "render";

export type TextEditConfig = {
  enabled: boolean;
  text: string;
  look: TextLook;
  /** "auto" or an image key. */
  target: string;
  mode: EditMode;
  /** Manual region inside the target bitmap; overrides detection. */
  region: Rect | null;
  /** The region was placed by a guess, not by the user or a measurement. */
  regionGuessed: boolean;
  /** Image keys to drop entirely, with every sprite drawn from them. */
  remove: string[];
  /** Which lettering to use when a set of siblings is loaded. */
  font: FontMode;
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
  look: { preset: "auto", color: "#ffffff", gradient: false, secondColor: "#e39b12", stroke: false, strokeColor: "#1a1a2e", strokeWidth: 0.07 },
  target: "auto",
  mode: "auto",
  region: null,
  regionGuessed: false,
  remove: [],
  font: "set",
};

export type SiblingFile = { name: string; movie: MovieFile };

export type BitmapInfo = {
  index: number;
  key: string;
  width: number;
  height: number;
  bytes: number;
  isBitmap: boolean;
  frames: number;
  totalFrames: number;
  placement: { x: number; y: number; scale: number } | null;
  ink: Rect | null;
  diff: Rect | null;
  /** Keys of the frame sequence this bitmap belongs to (itself included), if any. */
  sequence: string[] | null;
};

export type PlanSource = "diff" | "detected" | "manual" | "none";

export type Plan = {
  key: string;
  mode: "swap" | "repaint";
  region: Rect;
  /** Every bitmap the edit applies to — the sequence, or just the key. */
  keys: string[];
  /** Other layers that carry the same text (a shadow, a glow, a shine copy) — repainted with their own colour. */
  companions?: { key: string; region: Rect }[];
};

export type Analysis = {
  bitmaps: BitmapInfo[];
  sibling: string | null;
  siblingsUsed: number;
  plans: Plan[];
  source: PlanSource;
  reason: string;
  /** The frame the detector looked at, when it did. */
  detectedOnFrame: number | null;
  /** Detected text that looks like real lettering, or a weaker candidate the user should check. */
  confidence: "high" | "low";
  /** The set's own glyphs, when siblings with numbered names are loaded. */
  glyphs: GlyphLibrary | null;
  glyphsNote: string;
};

export type EditResult = { key: string; mode: "swap" | "repaint" | "glyphs"; region: Rect; fill: string; fontSize: number; frames: number };

/* ------------------------------------------------------------------ */
/* Decoding + caches                                                     */
/* ------------------------------------------------------------------ */

const rasterCache = new WeakMap<MovieFile, Map<string, Raster | null>>();
const bitmapCache = new WeakMap<MovieFile, Map<string, ImageBitmap | null>>();
const spriteCache = new WeakMap<MovieFile, Promise<Sprite[]>>();

const isImage = (bytes: Uint8Array | undefined) => !!bytes && sniffImageMime(bytes) !== "application/octet-stream";

export async function decodeRaster(bytes: Uint8Array): Promise<Raster> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: sniffImageMime(bytes) }));
  // Read the size before close(): a closed ImageBitmap reports 0x0.
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
  if (!cache) rasterCache.set(movie, (cache = new Map()));
  if (cache.has(key)) return cache.get(key)!;
  let raster: Raster | null = null;
  if (isImage(movie.images[key])) {
    try {
      raster = await decodeRaster(movie.images[key]);
    } catch {
      raster = null;
    }
  }
  cache.set(key, raster);
  return raster;
}

async function bitmapOf(movie: MovieFile, key: string): Promise<ImageBitmap | null> {
  let cache = bitmapCache.get(movie);
  if (!cache) bitmapCache.set(movie, (cache = new Map()));
  if (cache.has(key)) return cache.get(key)!;
  let bmp: ImageBitmap | null = null;
  if (isImage(movie.images[key])) {
    try {
      bmp = await createImageBitmap(new Blob([movie.images[key] as BlobPart], { type: sniffImageMime(movie.images[key]) }));
    } catch {
      bmp = null;
    }
  }
  cache.set(key, bmp);
  return bmp;
}

function spritesOf(movie: MovieFile): Promise<Sprite[]> {
  let p = spriteCache.get(movie);
  if (!p) spriteCache.set(movie, (p = decodeSprites(movie)));
  return p;
}

/** Sprite imageKeys sometimes carry an extension the images map lacks. */
function resolveKey(movie: MovieFile, key: string): string | null {
  if (movie.images[key]) return key;
  const bare = key.replace(/\.[^.]+$/, "");
  return movie.images[bare] ? bare : null;
}

/* ------------------------------------------------------------------ */
/* Pixel measurement — pure functions                                     */
/* ------------------------------------------------------------------ */

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
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Premultiplied diff bbox; transparent pixels' undefined colour never counts. */
export function diffRegion(a: Raster, b: Raster, threshold = 40, pad = 2): Rect | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  const { width, height } = a;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const aa = a.data[i + 3] / 255, ab = b.data[i + 3] / 255;
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
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  return { x, y, width: Math.min(width, maxX + 1 + pad) - x, height: Math.min(height, maxY + 1 + pad) - y };
}

/** Blend across the region from its left neighbour to its right neighbour, per row. */
export function inpaintRegion(r: Raster, region: Rect): void {
  const { data, width, height } = r;
  const x0 = Math.max(0, Math.round(region.x)), x1 = Math.min(width, Math.round(region.x + region.width));
  const y0 = Math.max(0, Math.round(region.y)), y1 = Math.min(height, Math.round(region.y + region.height));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  // Edge samples sit a couple of pixels outside the region, past any
  // glow the letters cast; missing edges (bitmap border) are ignored.
  const gap = 2;
  const pm = (i: number) => { const a = data[i + 3] / 255; return [data[i] * a, data[i + 1] * a, data[i + 2] * a, data[i + 3]]; };
  const sample = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? null : pm((y * width + x) * 4));
  // The region's median colour is its background (letters cover less than
  // half of it); an edge sample far from it is a border or a glow, not
  // something to smear across the fill.
  const med = (() => {
    const ch: number[][] = [[], [], [], []];
    const st = Math.max(1, Math.floor(Math.sqrt((w * h) / 2000)));
    for (let y = y0; y < y1; y += st) for (let x = x0; x < x1; x += st) { const v = pm((y * width + x) * 4); for (let c = 0; c < 4; c++) ch[c].push(v[c]); }
    return ch.map((v) => { v.sort((m, n) => m - n); return v[Math.floor(v.length / 2)] ?? 0; });
  })();
  const plausible = (v: number[] | null) => (v && Math.abs(v[0] - med[0]) + Math.abs(v[1] - med[1]) + Math.abs(v[2] - med[2]) + Math.abs(v[3] - med[3]) <= 220 ? v : null);
  const left = Array.from({ length: h }, (_, k) => plausible(sample(x0 - 1 - gap, y0 + k)) ?? plausible(sample(x0 - 1, y0 + k)));
  const right = Array.from({ length: h }, (_, k) => plausible(sample(x1 + gap, y0 + k)) ?? plausible(sample(x1, y0 + k)));
  const top = Array.from({ length: w }, (_, k) => plausible(sample(x0 + k, y0 - 1 - gap)) ?? plausible(sample(x0 + k, y0 - 1)));
  const bottom = Array.from({ length: w }, (_, k) => plausible(sample(x0 + k, y1 + gap)) ?? plausible(sample(x0 + k, y1)));
  // Smooth each edge along its length: a fill should carry the ribbon's
  // gradient, not every ornament pixel on its border, streaked across.
  const smooth = (arr: (number[] | null)[], win: number) => {
    const out: (number[] | null)[] = [];
    for (let k = 0; k < arr.length; k++) {
      const acc = [0, 0, 0, 0]; let n = 0;
      for (let j = Math.max(0, k - win); j <= Math.min(arr.length - 1, k + win); j++) { const v = arr[j]; if (!v) continue; n++; for (let c = 0; c < 4; c++) acc[c] += v[c]; }
      out.push(n ? acc.map((v) => v / n) : null);
    }
    return out;
  };
  const sm = (arr: (number[] | null)[]) => smooth(arr, Math.max(2, Math.round(arr.length / 6)));
  const L = sm(left), R = sm(right), T = sm(top), B = sm(bottom);
  const acc = [0, 0, 0, 0];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dl = x - x0 + 1, dr = x1 - x, dt = y - y0 + 1, db = y1 - y;
      const edges: [number[] | null, number][] = [[L[y - y0], 1 / (dl * dl)], [R[y - y0], 1 / (dr * dr)], [T[x - x0], 0.3 / (dt * dt)], [B[x - x0], 0.3 / (db * db)]];
      let ws = 0;
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      for (const [e, wgt] of edges) { if (!e) continue; ws += wgt; for (let c = 0; c < 4; c++) acc[c] += e[c] * wgt; }
      const i = (y * width + x) * 4;
      if (!ws) { ws = 1; for (let c = 0; c < 4; c++) acc[c] = med[c]; }
      const alpha = acc[3] / ws;
      const un = alpha > 0 ? 255 / alpha : 0;
      data[i] = Math.round(Math.min(255, (acc[0] / ws) * un)); data[i + 1] = Math.round(Math.min(255, (acc[1] / ws) * un)); data[i + 2] = Math.round(Math.min(255, (acc[2] / ws) * un));
      data[i + 3] = Math.round(alpha);
    }
  }
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function medianColor(picks: number[][]): string | null {
  if (picks.length < 8) return null;
  const med = (k: number) => { const v = picks.map((p) => p[k]).sort((m, n) => m - n); return v[Math.floor(v.length / 2)]; };
  return hex(med(0), med(1), med(2));
}

export function sampleTextColor(original: Raster, background: Raster, region: Rect): string | null {
  const picks: number[][] = [];
  const x0 = Math.round(region.x), y0 = Math.round(region.y);
  for (let y = y0; y < Math.min(original.height, y0 + Math.round(region.height)); y++) {
    for (let x = x0; x < Math.min(original.width, x0 + Math.round(region.width)); x++) {
      const i = (y * original.width + x) * 4;
      if (original.data[i + 3] < 200) continue;
      let delta = 0;
      for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(original.data[i + c] - background.data[i + c]));
      if (delta > 60) picks.push([original.data[i], original.data[i + 1], original.data[i + 2]]);
    }
  }
  return medianColor(picks);
}

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

export function looksLikeLabel(ink: Rect, canvas: { width: number; height: number }, scale = 1): boolean {
  const w = ink.width * scale, h = ink.height * scale;
  const aspect = w / Math.max(1, h);
  const share = (w * h) / Math.max(1, canvas.width * canvas.height);
  return aspect >= 1.2 && aspect <= 10 && share <= 0.3 && share >= 0.01;
}

const unionRect = (a: Rect | undefined, b: Rect): Rect => {
  if (!a) return b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/* ------------------------------------------------------------------ */
/* Text detection in a rendered frame                                     */
/* ------------------------------------------------------------------ */

type Placed = { key: string; t: { a: number; b: number; c: number; d: number; tx: number; ty: number }; alpha: number; clip: Path2D | null };

/** Draw one frame at 1x into a raster, the way the player would. */
async function renderFrameRaster(movie: MovieFile, frame: number): Promise<{ raster: Raster; placed: Placed[] }> {
  const W = Math.max(1, Math.round(movie.params.viewBoxWidth));
  const H = Math.max(1, Math.round(movie.params.viewBoxHeight));
  const canvas = makeCanvas(W, H);
  const ctx = get2dCtx(canvas);
  const placed: Placed[] = [];
  for (const s of await spritesOf(movie)) {
    const f = s.frames[frame];
    if (!f || f.alpha <= 0) continue;
    const key = resolveKey(movie, s.imageKey);
    if (!key) continue;
    const bmp = await bitmapOf(movie, key);
    if (!bmp) continue;
    const clip = f.clipPath ? parseSvgPath(f.clipPath) : null;
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.setTransform(f.transform.a, f.transform.b, f.transform.c, f.transform.d, f.transform.tx, f.transform.ty);
    if (clip) ctx.clip(clip);
    try { ctx.drawImage(bmp, 0, 0); } catch { /* closed bitmap */ }
    ctx.restore();
    placed.push({ key, t: f.transform, alpha: f.alpha, clip });
  }
  const img = ctx.getImageData(0, 0, W, H);
  return { raster: { data: img.data, width: W, height: H }, placed };
}

type Component = { x0: number; y0: number; x1: number; y1: number; area: number; edge: number; pixels: number[]; rgb: [number, number, number]; stroke: { width: number; cv: number } };

/**
 * Stroke statistics of one component: a chamfer distance transform inside
 * its box, then the ridge pixels (local maxima) give the local thickness.
 * Letters keep one thickness; curls, feathers and gems do not.
 */
function strokeStats(pixels: number[], width: number, x0: number, y0: number, x1: number, y1: number): { width: number; cv: number } {
  const bw = x1 - x0 + 3, bh = y1 - y0 + 3; // one-pixel border of background
  const inside = new Uint8Array(bw * bh);
  for (const i of pixels) { const x = i % width - x0 + 1, y = (i - (i % width)) / width - y0 + 1; inside[y * bw + x] = 1; }
  const dist = new Float32Array(bw * bh);
  const INF = 1e9;
  for (let k = 0; k < bw * bh; k++) dist[k] = inside[k] ? INF : 0;
  for (let y = 1; y < bh; y++) for (let x = 1; x < bw - 1; x++) { const k = y * bw + x; if (!inside[k]) continue; dist[k] = Math.min(dist[k], dist[k - 1] + 1, dist[k - bw] + 1, dist[k - bw - 1] + 1.414, dist[k - bw + 1] + 1.414); }
  for (let y = bh - 2; y >= 0; y--) for (let x = bw - 2; x >= 1; x--) { const k = y * bw + x; if (!inside[k]) continue; dist[k] = Math.min(dist[k], dist[k + 1] + 1, dist[k + bw] + 1, dist[k + bw - 1] + 1.414, dist[k + bw + 1] + 1.414); }
  const ridge: number[] = [];
  for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) { const k = y * bw + x; if (!inside[k]) continue; const d = dist[k]; if (d >= dist[k - 1] && d >= dist[k + 1] && d >= dist[k - bw] && d >= dist[k + bw]) ridge.push(d); }
  if (ridge.length < 3) return { width: 0, cv: 1 };
  const mean = ridge.reduce((a, b) => a + b, 0) / ridge.length;
  const sd = Math.sqrt(ridge.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ridge.length);
  return { width: mean * 2, cv: mean ? sd / mean : 1 };
}

/**
 * Light glyph strokes: bright, opaque, and next to something dark. Glows,
 * gems and highlights are bright too, but a stroke is *all* edge — most of
 * its pixels touch a dark neighbour — while a blob is mostly interior.
 */
function glyphComponents(r: Raster): Component[] {
  const { data, width, height } = r;
  const n = width * height;
  const luma = new Uint8Array(n);
  const bright = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = data[o + 3];
    const l = a >= 200 ? (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000 : 0;
    luma[i] = l;
    // "Light" includes saturated brights — pink or gold lettering has a
    // middling luma but a channel near full.
    const peak = Math.max(data[o], data[o + 1], data[o + 2]);
    bright[i] = a >= 200 && (l >= 165 || (peak >= 200 && l >= 125)) ? 1 : 0;
  }
  // A neighbour counts as "dark" when it is dark outright, or clearly
  // darker than the stroke — white lettering on a beige ribbon still reads.
  const dark = (i: number, l: number) => data[i * 4 + 3] >= 160 && (luma[i] <= 110 || luma[i] <= l - 85);
  const edge = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!bright[i]) continue;
      let e = 0;
      for (let dy = -2; dy <= 2 && !e; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          if (dark(yy * width + xx, luma[i])) { e = 1; break; }
        }
      }
      edge[i] = e;
    }
  }
  // Connected components of bright pixels (4-neighbour flood fill).
  const seen = new Uint8Array(n);
  const comps: Component[] = [];
  const stack: number[] = [];
  const maxArea = n * 0.08;
  for (let start = 0; start < n; start++) {
    if (!bright[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const c: Component = { x0: width, y0: height, x1: -1, y1: -1, area: 0, edge: 0, pixels: [], rgb: [0, 0, 0], stroke: { width: 0, cv: 1 } };
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i - x) / width;
      c.area++;
      c.edge += edge[i];
      c.rgb[0] += data[i * 4]; c.rgb[1] += data[i * 4 + 1]; c.rgb[2] += data[i * 4 + 2];
      if (c.area <= maxArea) c.pixels.push(i);
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      const nb = [i - 1, i + 1, i - width, i + width];
      if (x === 0) nb[0] = -1; if (x === width - 1) nb[1] = -1;
      for (const j of nb) if (j >= 0 && j < n && bright[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    c.rgb = [c.rgb[0] / c.area, c.rgb[1] / c.area, c.rgb[2] / c.area];
    if (c.area <= maxArea && c.area >= 12) c.stroke = strokeStats(c.pixels, width, c.x0, c.y0, c.x1, c.y1);
    comps.push(c);
  }
  return comps;
}

export type Detected = { box: Rect; count: number; score: number; pixels: number[]; confident: boolean };
export type GroupDebug = { box: Rect; n: number; reject: string | null; score: number; cv?: number; sw?: number };

/** The most text-like line of components in a frame, in canvas pixels. */
export function detectTextLine(r: Raster, groupsDebug?: GroupDebug[]): Detected | null {
  const { width, height } = r;
  const area = width * height;
  // Glyph height limits: relative to the canvas height, but a wide banner
  // is short, so let its text reach further up.
  const maxGlyphH = Math.min(height * 0.5, Math.max(width, height) * 0.3);
  const compReject = (c: Component, why: string) => { if (groupsDebug && c.area >= area * 0.001) groupsDebug.push({ box: { x: c.x0, y: c.y0, width: c.x1 - c.x0 + 1, height: c.y1 - c.y0 + 1 }, n: 0, reject: `comp: ${why} (edge ${(c.edge / c.area).toFixed(2)} fill ${(c.area / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1))).toFixed(2)})`, score: 0 }); return false; };
  const comps = glyphComponents(r).filter((c) => {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (c.area < area * 0.00025 || c.area > area * 0.08) return compReject(c, "area");
    if (h < height * 0.03 || h > maxGlyphH || w > width * 0.6) return compReject(c, "size");
    if (c.edge / c.area < (h > 40 ? 0.22 : 0.35)) return compReject(c, "blob"); // a blob, not a stroke
    if (h > 30) {
      // A big shape must still read as strokes: crossing a letter meets
      // several of them, crossing a solid ornament meets one.
      const set = new Set(c.pixels);
      let transitions = 0;
      for (const fy of [0.35, 0.5, 0.65]) {
        const y = Math.round(c.y0 + (c.y1 - c.y0) * fy);
        let inside = false;
        for (let x = c.x0; x <= c.x1; x++) { const on = set.has(y * width + x); if (on !== inside) { transitions++; inside = on; } }
      }
      if (transitions / 3 < 4) return compReject(c, "thick-blob");
    }
    if (c.area / (w * h) > 0.85) return compReject(c, "solid"); // a solid rectangle, not a glyph
    // Bold letters often touch, so a component may be a whole word; a
    // hairline swoosh or a long feather is longer still.
    if (w > h * 6 || h > w * 6) return compReject(c, "aspect");
    return true;
  });
  if (!comps.length) return null;

  // Group into lines: vertical overlap, similar height, and a gap no wider
  // than a couple of glyphs — that is a word space, not a different element.
  const parent = comps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      const a = comps[i], b = comps[j];
      const ha = a.y1 - a.y0 + 1, hb = b.y1 - b.y0 + 1;
      const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
      if (overlap < Math.min(ha, hb) * 0.5) continue;
      if (Math.max(ha, hb) > Math.min(ha, hb) * 2) continue;
      const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      if (gap > Math.max(ha, hb) * 2.2) continue;
      parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Component[]>();
  comps.forEach((c, i) => { const g = find(i); (groups.get(g) ?? groups.set(g, []).get(g)!).push(c); });

  // Links chain: a letter touches an ornament that touches the next
  // ornament, and the whole ribbon becomes one group. Walk each group left
  // to right and cut it into runs that keep one height and one baseline.
  const runs: Component[][] = [];
  for (const grp of groups.values()) {
    const sorted = [...grp].sort((m, n) => m.x0 - n.x0);
    let run: Component[] = [];
    const median = (vals: number[]) => { const v = [...vals].sort((m, n) => m - n); return v[Math.floor(v.length / 2)]; };
    for (const c of sorted) {
      if (run.length) {
        const mh = median(run.map((k) => k.y1 - k.y0 + 1));
        const mid = median(run.map((k) => (k.y0 + k.y1) / 2));
        const ch = c.y1 - c.y0 + 1;
        // Centre lines, not baselines: a "g" hangs below its neighbours and still belongs.
        const fits = ch >= mh * 0.5 && ch <= mh * 1.6 && Math.abs((c.y0 + c.y1) / 2 - mid) <= mh * 0.45 && c.x0 - Math.max(...run.map((k) => k.x1)) <= mh * 2.2;
        if (!fits) { runs.push(run); run = []; }
      }
      run.push(c);
    }
    if (run.length) runs.push(run);
  }

  // Frames and badges are symmetric: an ornament on the left has a mirror
  // twin on the right, pixel for pixel. Lettering has no twin. Mark every
  // component whose mirror image matches another component.
  const mirrored = new Set<Component>();
  {
    const axis = width / 2;
    const masks = new Map<Component, Set<number>>();
    const maskOf = (c: Component) => { let m = masks.get(c); if (!m) { m = new Set(c.pixels.map((i) => { const x = i % width, y = (i - x) / width; return (y - c.y0) * 4096 + (x - c.x0); })); masks.set(c, m); } return m; };
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        const a = comps[i], b = comps[j];
        const wa = a.x1 - a.x0 + 1, ha = a.y1 - a.y0 + 1, wb = b.x1 - b.x0 + 1, hb = b.y1 - b.y0 + 1;
        if (Math.abs(wa - wb) > wa * 0.25 || Math.abs(ha - hb) > ha * 0.25 || Math.abs(a.y0 - b.y0) > ha * 0.25) continue;
        if (Math.abs((a.x0 + a.x1) / 2 + (b.x0 + b.x1) / 2 - 2 * axis) > width * 0.06) continue;
        if (a.x1 >= b.x0 && b.x1 >= a.x0) continue; // overlapping: not a pair
        if (!a.pixels.length || !b.pixels.length) continue;
        // Mirror a into b's box and count the overlap.
        const mb = maskOf(b);
        let hit = 0;
        for (const i2 of a.pixels) { const x = i2 % width, y = (i2 - x) / width; const mx = wb - 1 - (x - a.x0), my = y - a.y0; if (mb.has(my * 4096 + mx)) hit++; }
        const iou = hit / (a.area + b.area - hit);
        if (iou >= 0.55) { mirrored.add(a); mirrored.add(b); }
      }
    }
  }

  let best: Detected | null = null;
  for (const all of runs) {
    const dbgBox = () => ({ x: Math.min(...all.map((c) => c.x0)), y: Math.min(...all.map((c) => c.y0)), width: Math.max(...all.map((c) => c.x1)) - Math.min(...all.map((c) => c.x0)) + 1, height: Math.max(...all.map((c) => c.y1)) - Math.min(...all.map((c) => c.y0)) + 1 });
    const reject = (why: string) => { groupsDebug?.push({ box: dbgBox(), n: all.length, reject: why, score: 0 }); };
    // Members of a text line share a height; drop the odd ones (a gem above
    // the ribbon, a sparkle) so they neither inflate the box nor the score.
    const hs = all.map((c) => c.y1 - c.y0 + 1).sort((m, n) => m - n);
    const medianH = hs[Math.floor(hs.length / 2)];
    const g = all.filter((c) => { const ch = c.y1 - c.y0 + 1; return ch >= medianH * 0.5 && ch <= medianH * 1.6; });
    const uniform = g.length / all.length;
    if (all.length >= 3 && uniform < 0.6) { reject('all.length >= 3 && uniform < 0.6'); continue; }
    const x0 = Math.min(...g.map((c) => c.x0)), x1 = Math.max(...g.map((c) => c.x1));
    const y0 = Math.min(...g.map((c) => c.y0)), y1 = Math.max(...g.map((c) => c.y1));
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < h * 1.2) { reject('w < h * 1.2'); continue; } // a line of text is wide
    if (h > maxGlyphH * 1.2) { reject('h > maxGlyphH * 1.2'); continue; }
    // Glyphs sit side by side: they neither pile up on each other (feathers
    // of a wing) nor leave the line mostly empty (a few scattered sparks).
    const sorted = [...g].sort((m, n) => m.x0 - n.x0);
    let overlapX = 0, reach = -1, sumW = 0;
    for (const c of sorted) {
      if (reach >= c.x0) overlapX += Math.min(reach, c.x1) - c.x0 + 1;
      reach = Math.max(reach, c.x1);
      sumW += c.x1 - c.x0 + 1;
    }
    if (g.length >= 2 && overlapX > w * 0.5) { reject('overlapX'); continue; }
    if (g.length >= 3 && sumW < w * 0.4) { reject('g.length >= 3 && sumW < w * 0.4'); continue; }
    // Letters fill their line; a crown, a sword tip and two wing points
    // scattered across the same band leave most of it empty.
    const boxArea = g.reduce((sum, c) => sum + (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1), 0);
    if (g.length >= 3 && boxArea < w * h * 0.45) { reject('g.length >= 3 && boxArea < w * h * 0.45'); continue; }
    // A lone component must still read as letters: crossing it on a few
    // scanlines meets many strokes, while a solid ornament band is one run.
    if (g.length === 1) {
      const c = g[0];
      const set = new Set(c.pixels);
      let transitions = 0;
      for (const fy of [0.35, 0.5, 0.65]) {
        const y = Math.round(c.y0 + (c.y1 - c.y0) * fy);
        let inside = false;
        for (let x = c.x0; x <= c.x1; x++) { const on = set.has(y * width + x); if (on !== inside) { transitions++; inside = on; } }
      }
      if (transitions / 3 < 6) { reject('transitions / 3 < 6'); continue; }
    }
    // Letters stand on a common baseline and are about as tall as wide;
    // feathers, rays and crown spikes are neither.
    const bottoms = g.map((c) => c.y1).sort((m, n) => m - n);
    const baseline = bottoms[Math.floor(bottoms.length / 2)];
    const aligned = g.filter((c) => Math.abs(c.y1 - baseline) <= medianH * 0.25).length / g.length;
    if (g.length >= 3 && aligned < 0.6) { reject('g.length >= 3 && aligned < 0.6'); continue; }
    const aspects = g.map((c) => (c.y1 - c.y0 + 1) / (c.x1 - c.x0 + 1)).sort((m, n) => m - n);
    if (aspects[Math.floor(aspects.length / 2)] > 2.2) { reject('aspects[Math.floor(aspects.length / 2)] > 2.2'); continue; }
    // One word, one colour: gems and gilt mixed together are an ornament.
    const med = [0, 1, 2].map((k) => { const v = g.map((c) => c.rgb[k]).sort((m, n) => m - n); return v[Math.floor(v.length / 2)]; });
    const sameColor = g.filter((c) => Math.abs(c.rgb[0] - med[0]) + Math.abs(c.rgb[1] - med[1]) + Math.abs(c.rgb[2] - med[2]) <= 110).length / g.length;
    if (g.length >= 3 && sameColor < 0.6) { reject('g.length >= 3 && sameColor < 0.6'); continue; }
    const ink = g.reduce((s, c) => s + c.area, 0);
    // Lettering keeps one stroke thickness, and a solid one at that — a
    // sixth to a third of its height. Curls, feathers and crowns are thin
    // and uneven, which is the most reliable tell of all.
    const cvs = g.map((c) => c.stroke.cv).sort((m, n) => m - n), sws = g.map((c) => c.stroke.width / (c.y1 - c.y0 + 1)).sort((m, n) => m - n);
    const cv = cvs[Math.floor(cvs.length / 2)], sw = sws[Math.floor(sws.length / 2)];
    if (sw < 0.1) { reject('thin strokes'); continue; }
    const twins = g.filter((c) => mirrored.has(c)).length / g.length;
    if (twins >= 0.5) { reject('mirrored ornament'); continue; }
    const strokeFactor = Math.min(1, Math.max(0.2, (sw - 0.06) / 0.1)) * (cv <= 0.45 ? 1 : Math.max(0.3, 1 - (cv - 0.45))) * (1 - twins);
    // Prefer several glyphs of even height over one big bright shape.
    const score = ink * Math.pow(g.length, 0.8) * (g.length >= 3 ? 1 : g.length === 2 ? 0.5 : 0.25) * (0.5 + uniform / 2) * strokeFactor;
    const confident = g.length >= 3 && sw >= 0.13 && cv <= 0.5;
    groupsDebug?.push({ box: dbgBox(), n: g.length, reject: null, score: Math.round(score), cv: +cv.toFixed(2), sw: +sw.toFixed(2) });
    if (!best || score > best.score) {
      const padY = Math.round(h * 0.2), padX = Math.round(h * 0.25);
      best = {
        box: { x: Math.max(0, x0 - padX), y: Math.max(0, y0 - padY), width: Math.min(width, x1 + 1 + padX) - Math.max(0, x0 - padX), height: Math.min(height, y1 + 1 + padY) - Math.max(0, y0 - padY) },
        count: g.length, score, pixels: g.flatMap((c) => c.pixels), confident,
      };
    }
  }
  return best;
}

function invert(t: Placed["t"]) {
  const det = t.a * t.d - t.b * t.c;
  if (Math.abs(det) < 1e-9) return null;
  return (x: number, y: number) => {
    const dx = x - t.tx, dy = y - t.ty;
    return { x: (t.d * dx - t.c * dy) / det, y: (-t.b * dx + t.a * dy) / det };
  };
}

type Owner = { key: string; region: Rect; placed: Placed; colors: number[]; companions: Placed[] };

/**
 * Which bitmap owns the detected glyphs? For each glyph pixel, the
 * *last-drawn* sprite that is opaque there — painter's order, clip paths
 * honoured — and the sprite owning the most glyph pixels wins. Counting
 * only the ink matters: the ribbon under a label covers the whole box, but
 * not the letters. The region is the bounds of the owned ink in bitmap
 * space; the ink colours come along so the region can be grown to letters
 * the frame scan missed. Other sprites whose opacity follows the glyphs
 * (a shadow, a glow, a clipped shine copy) are reported as companions.
 */
async function ownerOf(movie: MovieFile, placed: Placed[], line: Detected, canvasWidth: number): Promise<Owner | null> {
  const sprites: { p: Placed; raster: Raster; inv: NonNullable<ReturnType<typeof invert>> }[] = [];
  for (const p of placed) {
    const raster = await rasterOf(movie, p.key);
    const inv = invert(p.t);
    if (raster && inv) sprites.push({ p, raster, inv });
  }
  const clipCtx = get2dCtx(makeCanvas(1, 1));
  const opaqueAt = (s: (typeof sprites)[number], x: number, y: number): { bx: number; by: number } | null => {
    const { raster, inv, p } = s;
    const q = inv(x + 0.5, y + 0.5);
    const bx = Math.floor(q.x), by = Math.floor(q.y);
    if (bx < 0 || by < 0 || bx >= raster.width || by >= raster.height) return null;
    if (raster.data[(by * raster.width + bx) * 4 + 3] < 128) return null;
    if (p.clip) {
      clipCtx.setTransform(p.t.a, p.t.b, p.t.c, p.t.d, p.t.tx, p.t.ty);
      if (!clipCtx.isPointInPath(p.clip, x + 0.5, y + 0.5)) return null;
    }
    return { bx, by };
  };

  const step = Math.max(1, Math.floor(line.pixels.length / 3000));
  const owned = new Map<number, { hits: number; x0: number; y0: number; x1: number; y1: number; colors: number[] }>();
  const inkHits = new Map<number, number>();
  let inkSamples = 0;
  for (let k = 0; k < line.pixels.length; k += step) {
    const i = line.pixels[k];
    const x = i % canvasWidth, y = (i - x) / canvasWidth;
    inkSamples++;
    let owner = -1, bx = 0, by = 0;
    for (let s = 0; s < sprites.length; s++) {
      const hit = opaqueAt(sprites[s], x, y);
      if (!hit) continue;
      inkHits.set(s, (inkHits.get(s) ?? 0) + 1);
      if (sprites[s].p.alpha >= 0.5) { owner = s; bx = hit.bx; by = hit.by; }
    }
    if (owner < 0) continue;
    let o = owned.get(owner);
    if (!o) owned.set(owner, (o = { hits: 0, x0: bx, y0: by, x1: bx, y1: by, colors: [] }));
    o.hits++;
    if (bx < o.x0) o.x0 = bx; if (bx > o.x1) o.x1 = bx; if (by < o.y0) o.y0 = by; if (by > o.y1) o.y1 = by;
    const { raster } = sprites[owner];
    const off = (by * raster.width + bx) * 4;
    if (o.colors.length < 4000) o.colors.push((raster.data[off] << 16) | (raster.data[off + 1] << 8) | raster.data[off + 2]);
  }
  if (!owned.size) return null;
  const [idx, o] = [...owned.entries()].sort((a, b) => b[1].hits - a[1].hits)[0];
  const { p, raster } = sprites[idx];
  const h = o.y1 - o.y0 + 1;
  const padY = Math.max(1, Math.round(h * 0.15)), padX = Math.max(1, Math.round(h * 0.25));
  const region = {
    x: Math.max(0, o.x0 - padX), y: Math.max(0, o.y0 - padY),
    width: Math.min(raster.width, o.x1 + 1 + padX) - Math.max(0, o.x0 - padX),
    height: Math.min(raster.height, o.y1 + 1 + padY) - Math.max(0, o.y0 - padY),
  };
  if (region.width <= 2 || region.height <= 2) return null;

  // Companions: opaque under most of the ink, but not under the box as a
  // whole — that is a layer shaped like the letters, not the ribbon.
  const { box } = line;
  const bgSamples: [number, number][] = [];
  const inkSet = new Set(line.pixels);
  const bgStep = Math.max(1, Math.floor(Math.sqrt((box.width * box.height) / 1500)));
  for (let y = box.y; y < box.y + box.height; y += bgStep) for (let x = box.x; x < box.x + box.width; x += bgStep) if (!inkSet.has(y * canvasWidth + x)) bgSamples.push([x, y]);
  const companions: Placed[] = [];
  const lumaAt = (sp: (typeof sprites)[number], bx: number, by: number) => { const off = (by * sp.raster.width + bx) * 4; const d = sp.raster.data; return (d[off] * 299 + d[off + 1] * 587 + d[off + 2] * 114) / 1000; };
  for (let s = 0; s < sprites.length; s++) {
    if (s === idx || sprites[s].p.key === p.key) continue;
    const fInk = (inkHits.get(s) ?? 0) / Math.max(1, inkSamples);
    if (fInk < 0.5) continue;
    let bg = 0, bgLuma = 0;
    for (const [x, y] of bgSamples) { const hit = opaqueAt(sprites[s], x, y); if (hit) { bg++; bgLuma += lumaAt(sprites[s], hit.bx, hit.by); } }
    const fBg = bg / Math.max(1, bgSamples.length);
    if (fInk >= fBg + 0.25) { companions.push(sprites[s].p); continue; }
    // Opaque under the whole box — a ribbon, unless the letters are baked
    // into it too, in which case it is brighter (or darker) under the ink.
    let ink = 0, inkLuma = 0;
    for (let k = 0; k < line.pixels.length; k += step) { const i = line.pixels[k]; const x = i % canvasWidth, y = (i - x) / canvasWidth; const hit = opaqueAt(sprites[s], x, y); if (hit) { ink++; inkLuma += lumaAt(sprites[s], hit.bx, hit.by); } }
    if (ink && bg && Math.abs(inkLuma / ink - bgLuma / bg) >= 45) companions.push(sprites[s].p);
  }
  return { key: p.key, region, placed: p, colors: o.colors, companions };
}

/**
 * Grow a region along its line to letters the frame scan missed (a glyph
 * hidden under a sparkle, a bold word that ran into the ornament filter).
 * In the bitmap, pixels close in colour to the found ink are grouped, and
 * groups that sit on the same line within a couple of glyph heights are
 * pulled in, repeatedly, until nothing more fits.
 */
export function growRegion(raster: Raster, region: Rect, colors: number[]): Rect {
  if (!colors.length) return region;
  const { data, width, height } = raster;
  // A small palette of the ink: coarse bins with enough votes.
  const bins = new Map<number, number>();
  for (const c of colors) { const b = ((c >> 19) << 10) | (((c >> 11) & 31) << 5) | ((c >> 3) & 31); bins.set(b, (bins.get(b) ?? 0) + 1); }
  const palette = [...bins.entries()].filter(([, n]) => n >= colors.length * 0.03).map(([b]) => [((b >> 10) & 31) * 8 + 4, ((b >> 5) & 31) * 8 + 4, (b & 31) * 8 + 4]);
  if (!palette.length) return region;
  const near = (r: number, g: number, b: number) => palette.some(([pr, pg, pb]) => Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb) <= 90);

  // Only the band around the line is worth scanning.
  const bandY0 = Math.max(0, Math.floor(region.y - region.height * 0.5)), bandY1 = Math.min(height, Math.ceil(region.y + region.height * 1.5));
  const bw = width, bh = bandY1 - bandY0;
  if (bh <= 0) return region;
  const mask = new Uint8Array(bw * bh);
  for (let y = bandY0; y < bandY1; y++) {
    for (let x = 0; x < bw; x++) {
      const off = (y * width + x) * 4;
      if (data[off + 3] >= 200 && near(data[off], data[off + 1], data[off + 2])) mask[(y - bandY0) * bw + x] = 1;
    }
  }
  // Components of the mask.
  type Box = { x0: number; y0: number; x1: number; y1: number; area: number };
  const seen = new Uint8Array(bw * bh);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let start = 0; start < bw * bh; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1; stack.push(start);
    const b: Box = { x0: bw, y0: bh, x1: -1, y1: -1, area: 0 };
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % bw, y = (i - x) / bw;
      b.area++;
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      const nb = [i - 1, i + 1, i - bw, i + bw];
      if (x === 0) nb[0] = -1; if (x === bw - 1) nb[1] = -1;
      for (const j of nb) if (j >= 0 && j < bw * bh && mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    b.y0 += bandY0; b.y1 += bandY0;
    boxes.push(b);
  }
  const lineH = region.height / 1.4; // undo the padding for the glyph height
  let { x: rx0, y: ry0 } = region;
  let rx1 = region.x + region.width, ry1 = region.y + region.height;
  const used = new Set<number>();
  const maxWidth = region.width + lineH * 5;
  const midY = region.y + region.height / 2;
  for (let changed = true; changed;) {
    changed = false;
    for (const [i, b] of boxes.entries()) {
      if (used.has(i)) continue;
      const h = b.y1 - b.y0 + 1, w = b.x1 - b.x0 + 1;
      if (b.area < lineH * 0.5) continue; // speck
      // A letter, or a pair of touching letters — not a ribbon border.
      if (h > lineH * 1.3 || h < lineH * 0.4 || w > lineH * 1.8) continue;
      if (b.area / (w * h) > 0.85) continue;
      if (Math.abs((b.y0 + b.y1) / 2 - midY) > lineH * 0.35) continue; // on the same line
      const gap = Math.max(b.x0 - rx1, rx0 - (b.x1 + 1));
      if (gap > lineH * 1.6) continue;
      if (Math.max(rx1, b.x1 + 1) - Math.min(rx0, b.x0) > maxWidth) continue;
      used.add(i);
      changed = true;
      rx0 = Math.min(rx0, b.x0); rx1 = Math.max(rx1, b.x1 + 1);
      ry0 = Math.max(region.y - lineH * 0.3, Math.min(ry0, b.y0)); ry1 = Math.min(region.y + region.height + lineH * 0.3, Math.max(ry1, b.y1 + 1));
    }
  }
  const padX = Math.round(lineH * 0.25), padY = Math.round(lineH * 0.15);
  rx0 = Math.max(0, Math.min(region.x, rx0 - padX)); rx1 = Math.min(width, Math.max(region.x + region.width, rx1 + padX));
  ry0 = Math.max(0, Math.min(region.y, ry0 - padY)); ry1 = Math.min(height, Math.max(region.y + region.height, ry1 + padY));
  return { x: rx0, y: ry0, width: rx1 - rx0, height: ry1 - ry0 };
}

export type DetectDebug = { frame: number; ms: number; box: Rect | null; owner: string | null; count: number; placed: Placed[]; groups: GroupDebug[] };

export type DetectResult = { key: string; region: Rect; frame: number; count: number; confident: boolean; companions: { key: string; region: Rect }[]; placement: { x: number; y: number; scale: number } };

type Remembered = { key: string; t: Placed["t"]; companions: Placed[] };
const lastDetection = new WeakMap<MovieFile, Remembered>();

/** Map a region on the owner bitmap onto each companion layer (bitmap → canvas → its bitmap). */
async function companionRegions(movie: MovieFile, t: Placed["t"], region: Rect, companions: Placed[], skip: string): Promise<{ key: string; region: Rect }[]> {
  const fwd = (x: number, y: number) => ({ x: t.a * x + t.c * y + t.tx, y: t.b * x + t.d * y + t.ty });
  const corners = [fwd(region.x, region.y), fwd(region.x + region.width, region.y), fwd(region.x, region.y + region.height), fwd(region.x + region.width, region.y + region.height)];
  const out: { key: string; region: Rect }[] = [];
  const seenKeys = new Set<string>([skip]);
  for (const c of companions) {
    if (seenKeys.has(c.key)) continue;
    const inv = invert(c.t);
    const r = await rasterOf(movie, c.key);
    if (!inv || !r) continue;
    const q = corners.map((k) => inv(k.x, k.y));
    const x0 = Math.max(0, Math.floor(Math.min(...q.map((k) => k.x)))), y0 = Math.max(0, Math.floor(Math.min(...q.map((k) => k.y))));
    const x1 = Math.min(r.width, Math.ceil(Math.max(...q.map((k) => k.x)))), y1 = Math.min(r.height, Math.ceil(Math.max(...q.map((k) => k.y))));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    seenKeys.add(c.key);
    out.push({ key: c.key, region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
  }
  return out;
}

export async function detectText(movie: MovieFile, debug?: DetectDebug[]): Promise<DetectResult | null> {
  const total = Math.max(1, movie.params.frames);
  // A few frames: intros are often empty and outros fade.
  const frames = [...new Set([Math.floor(total / 2), Math.floor(total * 0.75), Math.floor(total * 0.25), total - 1, 0])].filter((f) => f >= 0 && f < total);
  let best: (Owner & { frame: number; count: number; score: number; confident: boolean }) | null = null;
  for (const frame of frames) {
    const t0 = performance.now();
    const { raster, placed } = await renderFrameRaster(movie, frame);
    const groups: GroupDebug[] = [];
    const line = detectTextLine(raster, debug ? groups : undefined);
    const owner = line ? await ownerOf(movie, placed, line, raster.width) : null;
    debug?.push({ frame, ms: Math.round(performance.now() - t0), box: line?.box ?? null, owner: owner?.key ?? null, count: line?.count ?? 0, placed, groups });
    if (!line || !owner) continue;
    if (!best || line.score > best.score) best = { ...owner, frame, count: line.count, score: line.score, confident: line.confident };
    if (best && best.confident) break;
  }
  if (!best) return null;
  const raster = await rasterOf(movie, best.key);
  const region = raster ? growRegion(raster, best.region, best.colors) : best.region;
  const t = best.placed.t;
  lastDetection.set(movie, { key: best.key, t, companions: best.companions });
  const companions = await companionRegions(movie, t, region, best.companions, best.key);
  return { key: best.key, region, frame: best.frame, count: best.count, confident: best.confident, companions, placement: { x: t.tx, y: t.ty, scale: Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1 } };
}

/* ------------------------------------------------------------------ */
/* Usage, sequences, siblings                                              */
/* ------------------------------------------------------------------ */

type Usage = { frames: number[]; placement: { x: number; y: number; scale: number } | null };

async function imageUsage(movie: MovieFile): Promise<Map<string, Usage>> {
  const usage = new Map<string, Usage>();
  for (const sprite of await spritesOf(movie)) {
    const key = resolveKey(movie, sprite.imageKey);
    if (!key) continue;
    let u = usage.get(key);
    if (!u) usage.set(key, (u = { frames: [], placement: null }));
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

/**
 * Frame sequences: many same-size bitmaps, each on a frame or two, that
 * together cover the movie. Text baked into one of them is baked into all.
 */
function sequences(bitmaps: BitmapInfo[]): Map<string, string[]> {
  const total = Math.max(1, bitmaps[0]?.totalFrames ?? 1);
  const bySize = new Map<string, BitmapInfo[]>();
  for (const b of bitmaps) {
    if (!b.isBitmap || b.frames === 0 || b.frames > Math.max(2, total * 0.25)) continue;
    const k = `${b.width}x${b.height}`;
    (bySize.get(k) ?? bySize.set(k, []).get(k)!).push(b);
  }
  const out = new Map<string, string[]>();
  for (const group of bySize.values()) {
    if (group.length < 3) continue;
    const keys = group.map((b) => b.key);
    for (const k of keys) out.set(k, keys);
  }
  return out;
}

export function isSibling(movie: MovieFile, other: MovieFile): boolean {
  if (other === movie) return false;
  if (Math.round(other.params.viewBoxWidth) !== Math.round(movie.params.viewBoxWidth)) return false;
  if (Math.round(other.params.viewBoxHeight) !== Math.round(movie.params.viewBoxHeight)) return false;
  return Object.keys(other.images).join("\n") === Object.keys(movie.images).join("\n");
}

const SAME_DESIGN_MAX_COVER = 0.6;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Diff against every sibling; keep only same-design ones and union their
 * regions. One neighbour only shows the digits that differ from *it*; the
 * union is the text's full extent. A neighbour that differs everywhere is a
 * different design and tells us nothing — it is not used as a fallback.
 */
async function chooseSibling(movie: MovieFile, siblings: SiblingFile[], keys: string[], canvas: { width: number; height: number }, usage: Map<string, Usage>) {
  const same: { name: string; regions: Map<string, Rect>; area: number }[] = [];
  for (const s of siblings.filter((c) => isSibling(movie, c.movie))) {
    const regions = new Map<string, Rect>();
    let area = 0, mismatch = false;
    for (const key of keys) {
      const mine = movie.images[key], theirs = s.movie.images[key];
      if (!theirs || bytesEqual(mine, theirs)) continue;
      const a = await rasterOf(movie, key), b = await rasterOf(s.movie, key);
      if (!a || !b) continue;
      const region = diffRegion(a, b);
      if (!region) continue;
      regions.set(key, region);
      area += region.width * region.height;
      const ink = alphaBounds(a) ?? { x: 0, y: 0, width: a.width, height: a.height };
      if (region.width * region.height > SAME_DESIGN_MAX_COVER * ink.width * ink.height && !looksLikeLabel(ink, canvas, usage.get(key)?.placement?.scale ?? 1)) mismatch = true;
    }
    if (regions.size && !mismatch) same.push({ name: s.name, regions, area });
  }
  if (!same.length) return { sibling: null as string | null, regions: new Map<string, Rect>(), used: 0, names: [] as string[] };
  const regions = new Map<string, Rect>();
  for (const e of same) for (const [k, r] of e.regions) regions.set(k, unionRect(regions.get(k), r));
  return { sibling: same.reduce((a, b) => (b.area < a.area ? b : a)).name, regions, used: same.length, names: same.map((c) => c.name) };
}

/* ------------------------------------------------------------------ */
/* Analysis                                                                */
/* ------------------------------------------------------------------ */

export async function analyzeMovie(
  movie: MovieFile,
  siblings: SiblingFile[],
  config: Pick<TextEditConfig, "target" | "mode" | "region"> = defaultTextEdit,
  /** The active file's name — its digits tell which glyphs it carries. */
  activeName = "",
): Promise<Analysis> {
  const canvas = { width: movie.params.viewBoxWidth, height: movie.params.viewBoxHeight };
  const usage = await imageUsage(movie);
  const keys = Object.keys(movie.images);
  const bitmapKeys = keys.filter((k) => isImage(movie.images[k]));
  const chosen = await chooseSibling(movie, siblings, bitmapKeys, canvas, usage);

  const bitmaps: BitmapInfo[] = [];
  for (const [index, key] of keys.entries()) {
    const raster = await rasterOf(movie, key);
    const u = usage.get(key);
    bitmaps.push({
      index, key,
      width: raster?.width ?? 0, height: raster?.height ?? 0,
      bytes: movie.images[key].byteLength, isBitmap: !!raster,
      frames: u?.frames.length ?? 0, totalFrames: Math.max(1, movie.params.frames),
      placement: u?.placement ?? null,
      ink: raster ? alphaBounds(raster) : null,
      diff: chosen.regions.get(key) ?? null,
      sequence: null,
    });
  }
  const seq = sequences(bitmaps);
  for (const b of bitmaps) b.sequence = seq.get(b.key) ?? null;

  let { plans, source, reason } = suggestPlans(bitmaps, canvas, config);
  // A box dragged on the bitmap the text was found in still carries the
  // shadow / glow / shine layers along.
  const remembered = lastDetection.get(movie);
  if (source === "manual" && remembered && plans.length === 1 && plans[0].key === remembered.key && plans[0].mode === "repaint") {
    plans[0].companions = await companionRegions(movie, remembered.t, plans[0].region, remembered.companions, remembered.key);
  }
  let detectedOnFrame: number | null = null;
  let confidence: "high" | "low" = "high";
  if (!plans.length && source === "none" && config.target === "auto" && !config.region) {
    const dbg: DetectDebug[] = [];
    const d = await detectText(movie, dbg);
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __svgaDetect?: DetectDebug[] }).__svgaDetect = dbg;
    if (d) {
      const info = bitmaps.find((b) => b.key === d.key);
      if (info) info.placement = d.placement; // where it sat on the frame the text was found
      plans = [{ key: d.key, mode: "repaint", region: d.region, keys: info?.sequence ?? [d.key], companions: d.companions.filter((c) => !(info?.sequence ?? []).includes(c.key)) }];
      source = "detected";
      detectedOnFrame = d.frame;
      confidence = d.confident ? "high" : "low";
      reason = `${d.confident ? "lettering" : "something text-like"} found on frame ${d.frame + 1}${info?.sequence ? ` — applies to all ${info.sequence.length} frames of that sequence` : ""}${d.companions.length ? `, plus ${d.companions.length} matching layer${d.companions.length > 1 ? "s" : ""}` : ""}`;
    }
  }
  // With a numbered set loaded, lift the set's own glyphs so new text can
  // be written in exactly the original lettering.
  let glyphs: GlyphLibrary | null = null;
  let glyphsNote = "";
  if (source === "diff" && plans.length === 1 && chosen.names.length) {
    const key = plans[0].key;
    const named = [{ name: activeName, movie }, ...siblings.filter((c) => chosen.names.includes(c.name))]
      .map((f) => ({ text: textFromName(f.name), movie: f.movie }));
    const usable = named.filter((f): f is { text: string; movie: MovieFile } => !!f.text);
    if (!textFromName(activeName)) glyphsNote = "The file name carries no number, so the set's own digits can't be matched to it.";
    else if (usable.length < 2) glyphsNote = "The sibling names carry no numbers, so their digits can't be told apart.";
    else {
      try {
        const samples: GlyphSample[] = [];
        for (const f of usable) { const r = await rasterOf(f.movie, key); if (r) samples.push({ text: f.text, raster: r }); }
        const region = bitmaps.find((b) => b.key === key)?.diff ?? plans[0].region;
        glyphs = buildGlyphLibrary(key, samples, region);
        glyphsNote = `digits ${glyphs.chars.split("").join(" ")} lifted from ${samples.length} files`;
      } catch (e) {
        glyphsNote = `couldn't lift the set's glyphs: ${(e as Error).message}`;
      }
    }
  }
  const analysis: Analysis = { bitmaps, sibling: chosen.sibling, siblingsUsed: chosen.used, plans, source, reason, detectedOnFrame, confidence, glyphs, glyphsNote };
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __svgaLast?: unknown }).__svgaLast = { movie, analysis };
  return analysis;
}

export function suggestPlans(
  bitmaps: BitmapInfo[],
  canvas: { width: number; height: number },
  config: Pick<TextEditConfig, "target" | "mode" | "region">,
): { plans: Plan[]; source: PlanSource; reason: string } {
  const explicit = config.target !== "auto" ? bitmaps.find((b) => b.key === config.target) : null;
  const group = (b: BitmapInfo) => b.sequence ?? [b.key];

  if (explicit && config.region) {
    return { plans: [{ key: explicit.key, mode: config.mode === "swap" ? "swap" : "repaint", region: config.region, keys: group(explicit) }], source: "manual", reason: "region set by hand" };
  }
  if (explicit && config.mode === "swap" && explicit.ink) {
    return { plans: [{ key: explicit.key, mode: "swap", region: explicit.ink, keys: group(explicit) }], source: "manual", reason: "swap chosen by hand" };
  }

  const pool = explicit ? [explicit] : bitmaps;
  const plans: Plan[] = [];
  for (const b of pool) {
    if (!b.diff || !b.ink) continue;
    const cover = (b.diff.width * b.diff.height) / Math.max(1, b.ink.width * b.ink.height);
    if (cover >= 0.7) {
      if (looksLikeLabel(b.ink, canvas, b.placement?.scale ?? 1)) plans.push({ key: b.key, mode: "swap", region: b.ink, keys: [b.key] });
    } else {
      plans.push({ key: b.key, mode: config.mode === "swap" ? "swap" : "repaint", region: config.mode === "swap" ? b.ink : b.diff, keys: [b.key] });
    }
  }
  if (plans.length) return { plans, source: "diff", reason: `matches the sibling files everywhere except ${plans.length === 1 ? "one bitmap" : `${plans.length} bitmaps`}` };
  if (explicit) return { plans: [], source: "none", reason: `"${explicit.key}" needs a region` };
  return { plans: [], source: "none", reason: "no siblings to compare and no text found in the frames — pick a bitmap or drag a box" };
}

/** A box where badge text usually is: the right part of the biggest always-visible bitmap, or of the frame sequence. */
export function guessRegion(bitmaps: BitmapInfo[], key?: string): { key: string; region: Rect } | null {
  let pool = bitmaps.filter((b) => b.isBitmap && b.ink && (key ? b.key === key : b.frames >= b.totalFrames * 0.8));
  if (!pool.length && !key) {
    // No static bitmap: the largest frame sequence is the artwork.
    const seqs = new Map<string, BitmapInfo[]>();
    for (const b of bitmaps) if (b.sequence && b.ink) (seqs.get(b.sequence[0]) ?? seqs.set(b.sequence[0], []).get(b.sequence[0])!).push(b);
    const biggest = [...seqs.values()].sort((a, b) => b.length - a.length)[0];
    if (biggest) pool = [biggest[Math.floor(biggest.length / 2)]];
  }
  if (!pool.length) return null;
  const base = pool.sort((a, b) => b.ink!.width * b.ink!.height - a.ink!.width * a.ink!.height)[0];
  const ink = base.ink!;
  const wide = ink.width >= ink.height * 1.6;
  const r = wide
    ? { x: ink.x + ink.width * 0.55, y: ink.y + ink.height * 0.18, width: ink.width * 0.38, height: ink.height * 0.64 }
    : { x: ink.x + ink.width * 0.25, y: ink.y + ink.height * 0.68, width: ink.width * 0.5, height: ink.height * 0.2 };
  return { key: base.key, region: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
}

/* ------------------------------------------------------------------ */
/* Text rendering                                                          */
/* ------------------------------------------------------------------ */

export function textFont(size: number): string {
  return `800 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
}

function resolveLook(look: TextLook, sampled: string | null): TextLook {
  if (look.preset === "custom") return look;
  if (look.preset === "auto") return { ...look, color: sampled ?? "#ffffff", gradient: false, stroke: false };
  return { ...look, ...LOOK_PRESETS[look.preset] };
}

export async function renderTextBitmap(opts: { text: string; width: number; height: number; look: TextLook; padding?: number }): Promise<{ bytes: Uint8Array; ink: Rect; fontSize: number }> {
  const { text, width, height, look } = opts;
  const padding = opts.padding ?? 0.06;
  const availW = Math.max(1, width * (1 - 2 * padding)), availH = Math.max(1, height * (1 - 2 * padding));
  const pctx = get2dCtx(makeCanvas(8, 8));
  const measure = (size: number) => {
    pctx.font = textFont(size);
    const m = pctx.measureText(text);
    const asc = m.actualBoundingBoxAscent || size * 0.8, desc = m.actualBoundingBoxDescent || size * 0.2;
    const left = m.actualBoundingBoxLeft || 0, right = m.actualBoundingBoxRight || m.width;
    return { w: left + right, h: asc + desc, asc, left };
  };
  const probeSize = height;
  const p = measure(probeSize);
  const strokePad = look.stroke ? look.strokeWidth * probeSize : 0;
  const fontSize = Math.max(1, probeSize * Math.min(availW / (p.w + strokePad), availH / (p.h + strokePad)));
  const m = measure(fontSize);
  const sw = look.stroke ? look.strokeWidth * fontSize : 0;

  const canvas = makeCanvas(width, height);
  const ctx = get2dCtx(canvas);
  ctx.font = textFont(fontSize);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const inkW = m.w + sw, inkH = m.h + sw;
  const x = (width - inkW) / 2 + m.left + sw / 2, y = (height - inkH) / 2 + m.asc + sw / 2;
  if (look.stroke && sw > 0) {
    ctx.lineWidth = sw; ctx.lineJoin = "round"; ctx.strokeStyle = look.strokeColor;
    ctx.strokeText(text, x, y);
  }
  if (look.gradient) {
    const g = ctx.createLinearGradient(0, y - m.asc, 0, y + (m.h - m.asc));
    g.addColorStop(0, look.color); g.addColorStop(1, look.secondColor);
    ctx.fillStyle = g;
  } else ctx.fillStyle = look.color;
  ctx.fillText(text, x, y);
  return { bytes: await canvasToPngBytes(canvas), ink: { x: Math.round((width - inkW) / 2), y: Math.round((height - inkH) / 2), width: Math.round(inkW), height: Math.round(inkH) }, fontSize };
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
/* Apply                                                                   */
/* ------------------------------------------------------------------ */

export async function applyTextEdit(movie: MovieFile, siblings: SiblingFile[], config: TextEditConfig, analysis?: Analysis): Promise<{ movie: MovieFile; edits: EditResult[]; analysis: Analysis }> {
  let out = movie;
  if (config.remove.length) out = removeBitmaps(out, config.remove);
  const a = analysis ?? (await analyzeMovie(movie, siblings, config));
  if (!config.enabled || !config.text.trim()) return { movie: out, edits: [], analysis: a };
  if (!a.plans.length) throw new Error(`Could not work out where the text is: ${a.reason}.`);

  const images: Record<string, Uint8Array> = { ...out.images };
  const edits: EditResult[] = [];
  for (const plan of a.plans) {
    if (config.font === "set" && a.glyphs && a.glyphs.key === plan.key && !config.region) {
      const raw = await rasterOf(movie, plan.key);
      if (raw) {
        images[plan.key] = await rasterToPng(a.glyphs.compose(config.text.trim(), raw));
        edits.push({ key: plan.key, mode: "glyphs", region: a.glyphs.band, fill: "", fontSize: 0, frames: 1 });
        continue;
      }
    }
    let fill: string | null = null;
    let fontSize = 0;
    let done = 0;
    for (const key of plan.keys) {
      const raw = await rasterOf(movie, key);
      if (!raw) continue;
      if (plan.mode === "swap") {
        const box = plan.region;
        const look = resolveLook(config.look, config.look.preset === "auto" ? sampleSpriteColor(raw, box) : null);
        const r = await renderTextBitmap({ text: config.text, width: box.width, height: box.height, look, padding: 0.02 });
        const blank: Raster = { data: new Uint8ClampedArray(raw.width * raw.height * 4), width: raw.width, height: raw.height };
        images[key] = await compositeOnto(blank, r.bytes, box.x, box.y);
        fill = look.color; fontSize = r.fontSize;
      } else {
        const region = { x: Math.max(0, plan.region.x), y: Math.max(0, plan.region.y), width: Math.min(raw.width - Math.max(0, plan.region.x), plan.region.width), height: Math.min(raw.height - Math.max(0, plan.region.y), plan.region.height) };
        if (region.width < 2 || region.height < 2) continue;
        const background: Raster = { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
        inpaintRegion(background, region);
        // Sample the colour once, on the first frame that has text there; the rest reuse it.
        if (!fill) fill = resolveLook(config.look, config.look.preset === "auto" ? sampleTextColor(raw, background, region) : null).color;
        const look = { ...resolveLook(config.look, fill), color: config.look.preset === "auto" ? fill : resolveLook(config.look, fill).color };
        const r = await renderTextBitmap({ text: config.text, width: Math.round(region.width), height: Math.round(region.height), look });
        images[key] = await compositeOnto(background, r.bytes, Math.round(region.x), Math.round(region.y));
        fontSize = r.fontSize;
      }
      done++;
    }
    for (const c of plan.companions ?? []) {
      const raw = await rasterOf(movie, c.key);
      if (!raw || c.region.width < 2 || c.region.height < 2) continue;
      const background: Raster = { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
      inpaintRegion(background, c.region);
      // A shadow layer is dark, a glow layer is light: each keeps its own colour.
      const own = config.look.preset === "auto" ? sampleTextColor(raw, background, c.region) : null;
      const look = own ? { ...resolveLook(config.look, own), color: own } : resolveLook(config.look, fill);
      const r = await renderTextBitmap({ text: config.text, width: Math.round(c.region.width), height: Math.round(c.region.height), look });
      images[c.key] = await compositeOnto(background, r.bytes, Math.round(c.region.x), Math.round(c.region.y));
      done++;
    }
    edits.push({ key: plan.key, mode: plan.mode, region: plan.region, fill: fill ?? "#ffffff", fontSize, frames: done });
  }
  const edited = { movie: { ...out, images }, edits, analysis: a };
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __svgaEdited?: unknown }).__svgaEdited = edited;
  return edited;
}

export function removeBitmaps(movie: MovieFile, keys: string[]): MovieFile {
  const drop = new Set(keys);
  const images: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(movie.images)) if (!drop.has(k)) images[k] = v;
  const spriteBytes = movie.spriteBytes.filter((s) => { const k = readSpriteImageKeyFast(s); return !(drop.has(k) || drop.has(k.replace(/\.[^.]+$/, ""))); });
  return { ...movie, images, spriteBytes };
}

function readSpriteImageKeyFast(bytes: Uint8Array): string {
  let pos = 0;
  const varint = () => { let result = 0, shift = 0; for (;;) { const b = bytes[pos++]; result += (b & 0x7f) * 2 ** shift; if (!(b & 0x80)) return result; shift += 7; } };
  while (pos < bytes.length) {
    const tag = varint(); const field = Math.floor(tag / 8), wire = tag % 8;
    if (wire === 2) { const len = varint(); if (field === 1) return new TextDecoder().decode(bytes.subarray(pos, pos + len)); pos += len; }
    else if (wire === 0) varint(); else if (wire === 5) pos += 4; else if (wire === 1) pos += 8; else return "";
  }
  return "";
}

async function rasterToPng(r: Raster): Promise<Uint8Array> {
  const canvas = makeCanvas(r.width, r.height);
  get2dCtx(canvas).putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
  return canvasToPngBytes(canvas);
}

export async function bitmapThumbnail(movie: MovieFile, key: string, size = 96): Promise<string | null> {
  const bytes = movie.images[key];
  if (!isImage(bytes)) return null;
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: sniffImageMime(bytes) }));
    const s = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const canvas = makeCanvas(w, h);
    get2dCtx(canvas).drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return URL.createObjectURL(new Blob([(await canvasToPngBytes(canvas)) as BlobPart], { type: "image/png" }));
  } catch {
    return null;
  }
}
