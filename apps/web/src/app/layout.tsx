import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

// Google Fonts sometimes returns these families from extension-less URLs.
// next/font 15 only accepts a file URL that ends in .woff2, so the build
// keeps the latin subsets in the repository instead of fetching them.
const display = localFont({
  src: "../fonts/bricolage-grotesque-latin.woff2",
  weight: "200 800",
  variable: "--font-bricolage",
  display: "swap",
});
const body = localFont({
  src: "../fonts/figtree-latin.woff2",
  weight: "300 900",
  variable: "--font-figtree",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-mono-latin-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ibm-plex-mono-latin-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "IA Connect", template: "%s · IA Connect" },
  description: "Collega mail, WhatsApp e gestionale e fai lavorare i flussi automatici.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="it"
      data-theme={theme ?? undefined}
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
