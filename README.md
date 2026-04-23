# SVGA Compressor

Modern, 100% client-side compressor for **SVGA 2.x** animation files (`.svga`).
Built with Next.js 15, React 19, TypeScript, Tailwind. Deploys to Vercel in one click.

> Note: this is for **SVGA** (bitmap-based animation format used by live-streaming gift effects,
> stickers, etc.) — not for static SVG. For SVG, use SVGO.

## Features

- Drag-and-drop upload (or tap on mobile)
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
bitmap images are touched.

## Compatibility

- **WebP** — smallest with transparency. Supported by SVGAPlayer v2.x on Android / iOS / Web.
- **PNG** — lossless. Safe for any SVGA 2.x player, but may shrink less.
- **JPEG** — drops transparency. Only for opaque animations.

## License

MIT
