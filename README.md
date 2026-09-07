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

Where the text lives is *measured*, not guessed. Two kinds of file exist:

- **the text is its own bitmap** — a small label sprite placed over the badge.
  It is re-rendered at the same size and swapped. Nothing else changes.
- **the text is painted into a larger bitmap** — digits baked onto the pill.
  The digit region is located, the pill is painted back over it, and the new
  text is drawn on top.

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
