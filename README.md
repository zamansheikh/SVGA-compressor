# SVGA Compressor

Modern, 100% client-side compressor for **SVGA 2.x** animation files (`.svga`).
Built with Next.js 15, React 19, TypeScript, Tailwind. Deploys to Vercel in one click.

> Note: this is for **SVGA** (bitmap-based animation format used by live-streaming gift effects,
> stickers, etc.) — not for static SVG. For SVG, use SVGO.

## Features

- Drag-and-drop upload (or tap on mobile) — drop a whole set of files at once
- **Replace the text** painted into an animation (a level number, a rank label) — see below
- Remove a bitmap and every sprite drawn from it
- Merge identical bitmaps; strip hidden exporter metadata (tool, author email, timestamp)
- Side-by-side original vs compressed preview, with play/pause/seek
- Quality (1–100), scale (25–100%), and output format (WebP / PNG / JPEG) controls
- File-size stats and per-image progress
- One-click download of the compressed `.svga`
- Nothing leaves your browser — decode, re-encode, and gzip happen on-device
- Mobile-first, dark, responsive UI
- Proper favicon, web manifest, Open Graph + Twitter cards, robots, sitemap
- Edge-generated PNG OG image via Next's `next/og`

## Tech

- `next@15` (App Router) · `react@19`
- `protobufjs` — parses the SVGA 2.x protobuf schema at runtime (no codegen step)
- `pako` — gzip inflate/deflate in the browser
- Canvas / OffscreenCanvas — image re-encoding and preview rendering
- `tailwindcss@3`

## Local development

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Build

```bash
npm run build
npm start
```

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import into Vercel — the framework is detected automatically.
3. (Optional) set `NEXT_PUBLIC_SITE_URL` to your production URL so sitemap / robots / OG URLs
   reference the right origin.

Or just:

```bash
npx vercel
```

## Layout

Three columns. **Files** on the left lists everything you dropped and marks
which ones are siblings of the file being edited. The **Stage** in the middle
is one large player with three views — *Original*, *Edited* (your text, live),
*Result* (what you will download); keys 1/2/3 switch, space plays. The
**Inspector** on the right has three tabs — *Text*, *Compress*, *Watermark* —
and a footer with before/after size and a single *Build → Download* action.
When the text has been located, its region is drawn on the stage as a box you
can drag and resize.

## Replacing text

Open a file, type the new text in the *Text* tab. The stage switches to
*Edited* and updates as you type; *Build result* bakes it into the download.

Where the text lives is worked out in three ways, tried in this order:

1. **Comparing siblings.** Load the whole set (level-41 … level-50) and the
   bitmaps that differ between files are the text. Exact, and the status says
   *Found it*.
2. **Reading the frames.** With a single file, a few frames are rendered and
   scanned for lettering: light strokes with dark edges, sitting on one line,
   of one height, one colour and one stroke thickness. The sprite that owns
   those pixels (top-most, clip paths honoured) becomes the target. Layers
   that carry the same letters — a drop shadow, a glow, a clipped shine sweep,
   a copy baked into the ribbon — are repainted too, each in its own colour.
   Clean lettering shows a green *text found here* box; a weaker candidate
   shows an amber *best guess* box and the status reads *Probably here*.
3. **A plain guess.** Nothing text-like at all: the box lands where badge
   text usually is. Drag it.

Two kinds of edit follow:

- **the text is its own bitmap** — a small label sprite placed over the badge.
  It is re-rendered at the same size and swapped. Nothing else changes.
- **the text is painted into a larger bitmap** — digits baked onto the pill.
  The region is painted back over from its surroundings and the new text is
  drawn on top, in the colour the old text had.

Whatever was found, the box on the stage can be dragged and resized. A box
moved by hand keeps the companion layers found for that bitmap, so the shadow
under the new text moves with it.

In a batch of sixteen assets of mixed kinds (role frames, VIP/SVIP badges,
tags, medals, banners, a chat bubble, a gift) eleven were edited correctly
without touching the box; the other five needed the box dragged onto the
text — a tiny label inside an emblem, calligraphic script, a banner whose
text has no dark edge, and a gift with 3-D digits.

To locate it, drop the file's **siblings** — other files from the same export
with different text (`level-41.svga` … `level-49.svga` beside `level-50.svga`).
Dropping the whole set onto the main dropzone does this automatically; a
picker lets you choose which one to edit. The bitmap that differs between
siblings is the one carrying text, and the union of the differing pixels is
where it sits. Every sibling is tried and the one that differs least wins —
a file from a different colour band lights up the whole badge and is
discarded. Transparent pixels are ignored (their colour is undefined and
varies between exports), and re-encoding noise is thresholded away.

Without siblings, a label-shaped bitmap is swapped; anything else needs a
bitmap picked and a region set by hand.

The new text takes the old text's colour, sampled from the bitmap, unless you
pick a look (gold, silver, white with outline, …) or set your own. Text is set
in the system font through Canvas, and the edited bitmap goes through the
same compression as the rest.

## How compression works

1. Read the uploaded `.svga` file.
2. `pako.inflate` the gzip, decode the `MovieEntity` protobuf (version, params, sprites,
   `images: map<string, bytes>`).
3. For each embedded bitmap (PNG/JPEG/WebP): decode it with `createImageBitmap`, draw it into
   a resized canvas, and export via `toBlob` at the chosen format/quality. If the re-encoded
   output is larger than the original, the original is kept.
4. Re-serialize the `MovieEntity` and `pako.deflate` at max level.
5. Offer the result as `filename.min.svga`.

Animation timing, sprite transforms and shape layers are preserved exactly — only the embedded
bitmap images are touched. With **Merge identical bitmaps** on, byte-identical images are
stored once and their sprites re-pointed. **Strip exporter metadata** drops unknown header
fields — some exporters put a base64 JSON tag there with the tool name, author email and
timestamp.

## Compatibility

- **WebP** — smallest with transparency. Supported by SVGAPlayer v2.x on Android / iOS / Web.
- **PNG** — lossless. Safe for any SVGA 2.x player, but may shrink less.
- **JPEG** — drops transparency. Only for opaque animations.

## License

MIT
