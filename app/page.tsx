import Compressor from "@/components/Compressor";
import Link from "next/link";

export default function Home() {
  return (
    <main className="grid-bg relative min-h-dvh">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-8 sm:py-14">
        {/* Header */}
        <header className="flex items-center justify-between mb-10 sm:mb-14">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 grid place-items-center shadow-lg shadow-brand-500/30">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden>
                <path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" />
              </svg>
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">SVGA Compressor</div>
              <div className="text-[11px] text-white/50">for .svga animations</div>
            </div>
          </div>
          <a
            href="https://github.com/svga/SVGA-Format"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition"
          >
            SVGA format spec
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
              <path d="M14 3h7v7h-2V6.414l-8.293 8.293-1.414-1.414L17.586 5H14V3zM5 5h5v2H7v10h10v-3h2v5H5V5z" />
            </svg>
          </a>
        </header>

        {/* Hero */}
        <section className="mb-8 sm:mb-10">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
            Shrink <span className="gradient-text">.svga</span>
            <br className="sm:hidden" /> animations,
            <br />
            in your browser.
          </h1>
          <p className="mt-5 max-w-2xl text-base sm:text-lg text-white/60">
            Upload an SVGA file, preview it, tune quality and scale, then download a smaller .svga.
            Nothing is uploaded anywhere — all compression happens on-device.
          </p>
        </section>

        {/* Tool */}
        <Compressor />

        {/* Feature strip */}
        <section className="mt-16 grid gap-4 sm:grid-cols-3">
          <Feature
            title="Private by default"
            body="Files never leave your browser. No backend, no tracking."
            icon={
              <path d="M12 1 3 5v6c0 5.25 3.75 10.16 9 11 5.25-.84 9-5.75 9-11V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
            }
          />
          <Feature
            title="Preview before & after"
            body="A lightweight WebGL-free canvas renderer plays your animation at native fps."
            icon={<path d="M8 5v14l11-7z" />}
          />
          <Feature
            title="Mobile friendly"
            body="Responsive, touch-optimized UI. Works on phones, tablets and desktops."
            icon={
              <path d="M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm-5 21c-.83 0-1.5-.67-1.5-1.5S11.17 19 12 19s1.5.67 1.5 1.5S12.83 22 12 22zm5-4H7V4h10v14z" />
            }
          />
        </section>

        {/* FAQ */}
        <section className="mt-16 space-y-6">
          <h2 className="text-xl font-semibold">FAQ</h2>
          <Faq q="What is an SVGA file?">
            SVGA is a bitmap-based animation format (.svga) used widely for live-streaming gifts,
            stickers, and in-app effects. Inside each file is a gzipped protobuf containing
            movie params, transformed sprite frames, and one or more embedded bitmap images.
          </Faq>
          <Faq q="How does compression work here?">
            The tool decodes your file, re-encodes each embedded bitmap using the browser's
            Canvas APIs (optional resize, WebP / PNG / JPEG), then re-serializes the protobuf
            and re-gzips it. Animation timing and transforms are preserved exactly.
          </Faq>
          <Faq q="Will the output still play in my player?">
            If your player is SVGAPlayer 2.x on Android / iOS / Web, WebP embeds are supported.
            If you target older players, choose PNG to stay fully lossless and compatible.
          </Faq>
          <Faq q="Is SVG supported?">
            No — this tool is specifically for SVGA (animation). For static SVG files, use a
            different optimizer such as SVGO.
          </Faq>
        </section>

        {/* Footer */}
        <footer className="mt-16 border-t border-white/5 pt-6 text-xs text-white/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            Built with Next.js 15, React 19, Tailwind. Deploy to{" "}
            <Link href="https://vercel.com" className="underline hover:text-white/70">
              Vercel
            </Link>{" "}
            in one click.
          </div>
          <div>© {new Date().getFullYear()} SVGA Compressor</div>
        </footer>
      </div>
    </main>
  );
}

function Feature({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="h-9 w-9 rounded-lg bg-white/5 grid place-items-center mb-3">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white/80">
          {icon}
        </svg>
      </div>
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="text-xs text-white/60 mt-1 leading-relaxed">{body}</div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="glass rounded-2xl px-5 py-4 group">
      <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-medium text-white">
        {q}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 fill-white/60 transition-transform group-open:rotate-180"
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </summary>
      <p className="mt-3 text-sm text-white/60 leading-relaxed">{children}</p>
    </details>
  );
}
