import { ImageResponse } from "next/og";

export const dynamic = "force-dynamic";
export const alt = "SVGA Compressor — shrink .svga animations in your browser";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 80,
          background:
            "radial-gradient(1200px 600px at 10% -10%, rgba(48,102,255,0.55), transparent 60%)," +
            "radial-gradient(900px 500px at 110% 10%, rgba(139,92,246,0.45), transparent 60%)," +
            "linear-gradient(135deg, #070914, #131c54)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "linear-gradient(135deg, #3066ff, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontWeight: 800,
              fontSize: 34,
            }}
          >
            S
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 24, fontWeight: 600 }}>SVGA Compressor</div>
            <div style={{ fontSize: 16, opacity: 0.6 }}>
              client-side · no uploads · free
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 100,
            fontSize: 104,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -4,
            display: "flex",
          }}
        >
          Shrink&nbsp;
          <span
            style={{
              background: "linear-gradient(90deg, #5890ff, #a78bfa, #ec4899)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            .svga
          </span>
        </div>
        <div
          style={{
            fontSize: 104,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -4,
          }}
        >
          animations.
        </div>

        <div style={{ marginTop: 42, fontSize: 26, opacity: 0.72, maxWidth: 900 }}>
          Upload. Preview. Compress. Download. All in your browser.
        </div>
      </div>
    ),
    { ...size },
  );
}
