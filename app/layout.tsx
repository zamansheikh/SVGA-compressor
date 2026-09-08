import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://svga-compressor.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "SVGA Studio — Compress and edit .svga animations in your browser",
    template: "%s · SVGA Studio",
  },
  description:
    "Preview, compress, watermark and edit the text of SVGA animation files (.svga) entirely in your browser. No uploads to any server, no sign-up, free.",
  keywords: [
    "SVGA",
    "SVGA compressor",
    "SVGA editor",
    "edit svga text",
    "svga shrink",
    "svga optimizer",
    "animation compressor",
    "svga player",
    "svgaplayerweb",
    "gift animation",
    "live stream animation",
  ],
  authors: [{ name: "SVGA Studio" }],
  creator: "SVGA Studio",
  applicationName: "SVGA Studio",
  category: "utilities",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/favicon.svg",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "SVGA Studio",
    title: "SVGA Studio — Compress and edit .svga animations in your browser",
    description:
      "Preview, compress, watermark and edit the text of SVGA animations (.svga) entirely in your browser. No uploads, no sign-up.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "SVGA Studio",
    description:
      "Compress and edit SVGA animations in your browser. 100% client-side.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: { canonical: siteUrl },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070914" },
    { media: "(prefers-color-scheme: light)", color: "#070914" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
