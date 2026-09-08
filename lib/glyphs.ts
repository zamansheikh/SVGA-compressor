/**
 * Glyphs lifted from a set of sibling files.
 *
 * A level set (level-41 … level-50) differs only in the digits painted on one
 * bitmap. Given those files and the text each carries (from its name), this
 * module reconstructs the background under the digits, lifts every digit as
 * an anti-aliased glyph — text colour per row, plus the faint dark shadow
 * every digit casts — and composes any new text from them. The result uses
 * the set's own lettering, pixel for pixel, rather than a substitute font.
 */
import type { Raster, Rect } from "./text-edit";

export type GlyphSample = { text: string; raster: Raster };

type Glyph = { a: Float32Array; b: Float32Array; w: number; padL: number; padR: number };

export type GlyphLibrary = {
  key: string;
  /** Characters available, in order. */
  chars: string;
  /** The rows and columns of the bitmap that were rebuilt. */
  band: Rect;
  /** A copy of `base` with `text` painted in the set's own glyphs. Throws when a character is missing. */
  compose(text: string, base: Raster): Raster;
};

/** The text a file name carries: its last run of digits ("level-41.svga" → "41"). */
export function textFromName(name: string): string | null {
  const m = name.replace(/\.[^.]+$/, "").match(/(\d+)(?!.*\d)/);
  return m ? m[1] : null;
}

/* ---------- small array helpers (H×W×4 float bands) ---------- */

type Band = { data: Float32Array; h: number; w: number };

function crop(r: Raster, x0: number, y0: number, x1: number, y1: number): Band {
  const w = x1 - x0, h = y1 - y0;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y + y0) * r.width + x0) * 4;
    data.set(r.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { data, h, w };
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((m, n) => m - n);
  return s[Math.floor(s.length / 2)];
}

function dilate(m: Uint8Array, h: number, w: number, r: number): Uint8Array {
  const out = new Uint8Array(m);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 1;
    }
  }
  return out;
}

/** Fill masked pixels of each row by interpolating between the nearest unmasked ones. */
function fillRows(bg: Band, mask: Uint8Array) {
  const { data, h, w } = bg;
  for (let y = 0; y < h; y++) {
    const ok: number[] = [];
    for (let x = 0; x < w; x++) if (!mask[y * w + x]) ok.push(x);
    if (!ok.length || ok.length === w) continue;
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      // nearest known columns either side
      let lo = -1, hi = -1;
      for (const k of ok) { if (k < x) lo = k; else { hi = k; break; } }
      const src = lo < 0 ? hi : hi < 0 ? lo : -1;
      for (let c = 0; c < 4; c++) {
        const o = (y * w + x) * 4 + c;
        if (src >= 0) data[o] = data[(y * w + src) * 4 + c];
        else { const t = (x - lo) / (hi - lo); data[o] = data[(y * w + lo) * 4 + c] * (1 - t) + data[(y * w + hi) * 4 + c] * t; }
      }
    }
  }
}

/* ---------- backgrounds ---------- */

/** Rough background for a wide band: per-pixel median across files, then whatever deviates from a rolling row median is filled in. */
function bgMedian(bands: Band[]): Band {
  const { h, w } = bands[0];
  const n = bands.length;
  const data = new Float32Array(w * h * 4);
  const tmp = new Float32Array(n);
  for (let i = 0; i < w * h * 4; i++) {
    for (let k = 0; k < n; k++) tmp[k] = bands[k].data[i];
    data[i] = median(Array.from(tmp));
  }
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2];
  const mask = new Uint8Array(w * h);
  const win = Math.max(10, Math.floor(h / 2));
  for (let y = 0; y < h; y++) {
    const row = Array.from(lum.subarray(y * w, y * w + w));
    for (let x = 0; x < w; x++) {
      const base = median(row.slice(Math.max(0, x - win), x + win + 1));
      if (Math.abs(row[x] - base) > 45) mask[y * w + x] = 1;
    }
  }
  const bg = { data, h, w };
  fillRows(bg, dilate(mask, h, w, 2));
  return bg;
}

/**
 * Background for a band whose margins are pill: a per-row linear prior
 * between the margins says roughly what each pixel should be; every file's
 * pixel that agrees with it (and is not next to ink) is a pill sample, and
 * the background is their median. Pixels no file shows as pill take the prior.
 */
function bgPrior(bands: Band[]): Band {
  const { h, w } = bands[0];
  const n = bands.length;
  const margin = Math.min(5, Math.floor(w / 4));
  const left = new Float32Array(h * 4), right = new Float32Array(h * 4);
  for (let y = 0; y < h; y++) for (let c = 0; c < 4; c++) {
    const l: number[] = [], r: number[] = [];
    for (const b of bands) for (let k = 0; k < margin; k++) { l.push(b.data[(y * w + k) * 4 + c]); r.push(b.data[(y * w + w - 1 - k) * 4 + c]); }
    left[y * 4 + c] = median(l); right[y * 4 + c] = median(r);
  }
  const prior = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const t = w > 1 ? x / (w - 1) : 0; for (let c = 0; c < 4; c++) prior[(y * w + x) * 4 + c] = left[y * 4 + c] * (1 - t) + right[y * 4 + c] * t; }
  const pass = (guess: Float32Array, tol: number) => {
    const pill: Uint8Array[] = bands.map((b) => {
      const m = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const dev = Math.abs(b.data[i * 4] - guess[i * 4]) + Math.abs(b.data[i * 4 + 1] - guess[i * 4 + 1]) + Math.abs(b.data[i * 4 + 2] - guess[i * 4 + 2]);
        m[i] = dev < tol ? 1 : 0;
      }
      // keep clear of the digits' anti-aliased edges and shadow halo
      const notPill = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) notPill[i] = m[i] ? 0 : 1;
      const grown = dilate(notPill, h, w, 3);
      for (let i = 0; i < w * h; i++) if (grown[i]) m[i] = 0;
      return m;
    });
    const data = new Float32Array(w * h * 4);
    const vals: number[] = [];
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < 4; c++) {
        vals.length = 0;
        for (let k = 0; k < n; k++) if (pill[k][i]) vals.push(bands[k].data[i * 4 + c]);
        data[i * 4 + c] = vals.length ? median(vals) : guess[i * 4 + c];
      }
    }
    return data;
  };
  // A linear prior is only roughly right on a curved gradient, so take a
  // loose first pass, smooth it along the rows, and let that be the prior
  // for a strict second pass. Pixels no file shows as pill end up smooth.
  const rough = pass(prior, 60);
  const smooth = new Float32Array(w * h * 4);
  const r = Math.max(4, Math.round(w / 8));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let sum = 0, cnt = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { sum += rough[(y * w + k) * 4 + c]; cnt++; }
    smooth[(y * w + x) * 4 + c] = sum / cnt;
  }
  return { data: pass(smooth, 36), h, w };
}

/* ---------- analysis ---------- */

type Slot = [number, number];
type Analysis = { bg: Band; G: Float32Array; rowHasText: Uint8Array; alphas: { a: Float32Array; b: Float32Array }[]; slots: Slot[][] };

function analyse(bands: Band[], texts: string[], narrow: boolean, gcols: [number, number] = [0, bands[0].w]): Analysis {
  const { h, w } = bands[0];
  const bg = narrow ? bgPrior(bands) : bgMedian(bands);
  // Text colour per row: the median of the strongest ink pixels of that row
  // over all files — looking only at columns known to hold text, so a gem
  // beside the digits cannot pass for their colour.
  const G = new Float32Array(h * 4);
  const rowHasText = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    const d: number[] = [], px: number[][] = [];
    for (const b of bands) for (let x = gcols[0]; x < gcols[1]; x++) {
      const o = (y * w + x) * 4;
      const dist = Math.hypot(b.data[o] - bg.data[o], b.data[o + 1] - bg.data[o + 1], b.data[o + 2] - bg.data[o + 2]);
      d.push(dist); px.push([b.data[o], b.data[o + 1], b.data[o + 2], b.data[o + 3]]);
    }
    const sorted = [...d].sort((m, n) => m - n);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const max = sorted[sorted.length - 1];
    rowHasText[y] = max > 90 ? 1 : 0;
    if (rowHasText[y]) {
      const chosen = px.filter((_, i) => d[i] >= p90 && d[i] > 90);
      for (let c = 0; c < 4; c++) G[y * 4 + c] = median(chosen.map((p) => p[c]));
    } else {
      const o = (y * w + Math.floor(w / 2)) * 4;
      for (let c = 0; c < 4; c++) G[y * 4 + c] = bg.data[o + c];
    }
  }
  const alphas = bands.map((b) => alphaOf(b, bg, G, rowHasText));
  const slots = alphas.map((al, i) => slotsOf(al.a, h, w, texts[i].length, !narrow));
  return { bg, G, rowHasText, alphas, slots };
}

/** Per-pixel coverage of (text colour, black shadow) over the background: p = bg + a (G − bg) + b (S − bg), S = black; least squares over RGB. */
function alphaOf(img: Band, bg: Band, G: Float32Array, rowHasText: Uint8Array) {
  const { h, w } = img;
  const a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    if (!rowHasText[y]) continue;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let uu = 0, vv = 0, uv = 0, du = 0, dv = 0;
      for (let c = 0; c < 3; c++) {
        const d = img.data[o + c] - bg.data[o + c];
        const u = G[y * 4 + c] - bg.data[o + c];
        const v = -bg.data[o + c];
        uu += u * u; vv += v * v; uv += u * v; du += d * u; dv += d * v;
      }
      const det = uu * vv - uv * uv;
      if (det <= 1) continue;
      let A = (du * vv - dv * uv) / det, B = (dv * uu - du * uv) / det;
      A = Math.min(1, Math.max(0, A)); B = Math.min(1 - A, Math.max(0, B));
      if (B < 0.03) B = 0;
      a[y * w + x] = A; b[y * w + x] = B;
    }
  }
  return { a, b };
}

/** Column runs of ink, adjusted to exactly `count` glyphs: merge the closest pair, or split the widest run at its thinnest interior column. */
function slotsOf(a: Float32Array, h: number, w: number, count: number, strict = false): Slot[] {
  // A column belongs to a glyph when a stem's worth of its rows are inked;
  // a few stray rows are background error, not lettering. The first pass
  // works on a rough background, so it only trusts solid ink.
  const need = strict ? Math.max(6, Math.round(h * 0.25)) : Math.max(3, Math.round(h * 0.08));
  const min = strict ? 0.5 : 0.3;
  const cols = new Uint8Array(w), prof = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let rows = 0, sum = 0;
    for (let y = 0; y < h; y++) { const v = a[y * w + x]; sum += v; if (v > min) rows++; }
    cols[x] = rows >= need ? 1 : 0; prof[x] = sum;
  }
  let runs: Slot[] = [];
  let start = -1, prev = -1;
  for (let x = 0; x < w; x++) {
    if (!cols[x]) continue;
    if (start < 0) start = x;
    else if (x - prev > 4) { runs.push([start, prev]); start = x; }
    prev = x;
  }
  if (start >= 0) runs.push([start, prev]);
  runs = runs.filter((r) => r[1] - r[0] >= 3);
  if (!runs.length) throw new Error("no digits found in the band");
  // Too many runs: ornaments sit apart from the digits, so cut at the
  // widest gap and keep the side with more runs (the digits huddle
  // together). Only when that no longer helps, merge the closest pair —
  // a glyph broken into pieces.
  while (runs.length > count) {
    // Pieces of one glyph sit closer than two glyphs ever do: merge those first.
    let best = 0, closest = Infinity;
    for (let i = 0; i + 1 < runs.length; i++) { const g = runs[i + 1][0] - runs[i][1] - 1; if (g < closest) { closest = g; best = i; } }
    if (closest <= Math.max(4, h * 0.1)) { runs.splice(best, 2, [runs[best][0], runs[best + 1][1]]); continue; }
    let cut = -1, gap = -1;
    for (let i = 0; i + 1 < runs.length; i++) { const g = runs[i + 1][0] - runs[i][1]; if (g > gap) { gap = g; cut = i; } }
    const left = runs.slice(0, cut + 1), right = runs.slice(cut + 1);
    const width = (rs: Slot[]) => rs.reduce((s, r) => s + r[1] - r[0] + 1, 0);
    const keep = left.length > right.length || (left.length === right.length && width(left) > width(right)) ? left : right;
    if (keep.length >= count) { runs = keep; continue; }
    runs.splice(best, 2, [runs[best][0], runs[best + 1][1]]);
  }
  while (runs.length < count) {
    let widest = 0;
    for (let i = 1; i < runs.length; i++) if (runs[i][1] - runs[i][0] > runs[widest][1] - runs[widest][0]) widest = i;
    const [x0, x1] = runs[widest];
    if (x1 - x0 < 6) throw new Error("fewer digits found than the name says");
    const lo = x0 + Math.floor((x1 - x0) * 0.3), hi = x0 + Math.floor((x1 - x0) * 0.7);
    let cut = lo;
    for (let x = lo; x <= hi; x++) if (prof[x] < prof[cut]) cut = x;
    runs.splice(widest, 1, [x0, cut - 1], [cut, x1]);
  }
  return runs;
}

/* ---------- the library ---------- */

/**
 * Build the glyph library of a set. `samples` are the files of one design
 * with the text each carries; `region` is where they differ on the bitmap.
 */
export function buildGlyphLibrary(key: string, samples: GlyphSample[], region: Rect): GlyphLibrary {
  if (samples.length < 2) throw new Error("at least two files are needed");
  const W = samples[0].raster.width, H = samples[0].raster.height;
  if (samples.some((s) => s.raster.width !== W || s.raster.height !== H)) throw new Error("the files' bitmaps differ in size");
  const texts = samples.map((s) => s.text);
  const y0 = Math.max(0, Math.round(region.y) - 3), y1 = Math.min(H, Math.round(region.y + region.height) + 4);
  // First pass on a generous band to find the glyph slots, then a second
  // pass on just the slots, so the background never sees ornaments.
  const wx0 = Math.max(0, Math.round(region.x) - Math.round(1.2 * (y1 - y0)));
  const wx1 = Math.min(W, Math.round(region.x + region.width) + 6);
  const first = analyse(samples.map((s) => crop(s.raster, wx0, y0, wx1, y1)), texts, false, [Math.round(region.x) - wx0, Math.round(region.x + region.width) - wx0]);
  // The band's margins must be pill in every file: step outward over any
  // column some file inks (a crossbar or serif reaching past the slot).
  const ww = wx1 - wx0;
  const inked = new Uint8Array(ww);
  for (const al of first.alphas) for (let x = 0; x < ww; x++) { let rows = 0; for (let y = 0; y < y1 - y0; y++) if (al.a[y * ww + x] > 0.5) rows++; if (rows >= 3) inked[x] = 1; }
  let l = Math.min(...first.slots.map((s) => s[0][0]));
  let r = Math.max(...first.slots.map((s) => s[s.length - 1][1]));
  const reach = Math.round((y1 - y0) * 0.2); // an overhang is short; an ornament is not
  for (let k = 0; k < reach && l > 0 && inked[l - 1]; k++) l--;
  for (let k = 0; k < reach && r < ww - 1 && inked[r + 1]; k++) r++;
  const bx0 = Math.max(0, wx0 + l - 7), bx1 = Math.min(W, wx0 + r + 8);
  const bands = samples.map((s) => crop(s.raster, bx0, y0, bx1, y1));
  const { bg, G, alphas, slots } = analyse(bands, texts, true);
  const h = y1 - y0, w = bx1 - bx0;

  const glyphs = new Map<string, Glyph>();
  const centres: number[] = [], gaps: number[] = [];
  samples.forEach((s, i) => {
    const runs = slots[i];
    centres.push((runs[0][0] + runs[runs.length - 1][1] + 1) / 2);
    for (let k = 0; k + 1 < runs.length; k++) gaps.push(runs[k + 1][0] - runs[k][1] - 1);
    [...s.text].forEach((ch, k) => {
      if (glyphs.has(ch)) return;
      const [x0, x1] = runs[k];
      const gx0 = Math.max(0, x0 - 2), gx1 = Math.min(w, x1 + 3);
      const gw = gx1 - gx0;
      const a = new Float32Array(gw * h), b = new Float32Array(gw * h);
      for (let y = 0; y < h; y++) { a.set(alphas[i].a.subarray(y * w + gx0, y * w + gx1), y * gw); b.set(alphas[i].b.subarray(y * w + gx0, y * w + gx1), y * gw); }
      glyphs.set(ch, { a, b, w: gw, padL: x0 - gx0, padR: gx1 - 1 - x1 });
    });
  });
  const cx = median(centres);
  const gap = Math.max(0, Math.round(gaps.length ? median(gaps) : h * 0.12));
  const chars = [...glyphs.keys()].sort().join("");

  const compose = (text: string, base: Raster): Raster => {
    const missing = [...text].filter((ch) => !glyphs.has(ch));
    if (missing.length) throw new Error(`This set has no glyph for "${missing.join("")}" — only ${chars.split("").join(" ")} appear in the loaded files.`);
    const parts = [...text].map((ch) => glyphs.get(ch)!);
    const total = parts.reduce((s, g) => s + g.w - g.padL - g.padR, 0) + gap * (parts.length - 1);
    const out: Raster = { data: new Uint8ClampedArray(base.data), width: base.width, height: base.height };
    const margin = 28;
    const cx0 = Math.max(0, bx0 - margin), cx1 = Math.min(W, bx1 + margin);
    const cw = cx1 - cx0;
    const canvas = crop(out, cx0, y0, cx1, y1);
    // the rebuilt background over the band, untouched pill on either side
    for (let y = 0; y < h; y++) canvas.data.set(bg.data.subarray(y * w * 4, (y + 1) * w * 4), (y * cw + (bx0 - cx0)) * 4);
    let x = Math.round(cx - total / 2) + (bx0 - cx0);
    for (const g of parts) {
      const gx = x - g.padL;
      if (gx < 0 || gx + g.w > cw) throw new Error(`"${text}" does not fit on the pill`);
      for (let y = 0; y < h; y++) for (let k = 0; k < g.w; k++) {
        const A = g.a[y * g.w + k], B = g.b[y * g.w + k];
        if (!A && !B) continue;
        const o = (y * cw + gx + k) * 4;
        for (let c = 0; c < 3; c++) canvas.data[o + c] = canvas.data[o + c] * (1 - A - B) + A * G[y * 4 + c];
        canvas.data[o + 3] = Math.max(canvas.data[o + 3], (A + B) * 255);
      }
      x += g.w - g.padL - g.padR + gap;
    }
    for (let y = 0; y < h; y++) for (let k = 0; k < cw * 4; k++) out.data[((y + y0) * W + cx0) * 4 + k] = Math.round(canvas.data[y * cw * 4 + k]);
    return out;
  };

  return { key, chars, band: { x: bx0, y: y0, width: w, height: h }, compose };
}

/** Test hook. */
export const _internal = { crop, analyse, bgMedian, bgPrior, slotsOf };
