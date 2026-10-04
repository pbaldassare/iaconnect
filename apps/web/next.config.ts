import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Content-Security-Policy of every page.
 *
 * Not nonce-based: the App Router writes its hydration data in inline scripts and a nonce
 * would force every page to be rendered per request (no static pages, a middleware on every
 * route). So scripts and styles keep `'unsafe-inline'`; everything else is closed: no
 * third-party scripts, no frames, no plugins, forms and `<base>` only towards the app,
 * network calls only to the app and to Supabase. `'unsafe-eval'` only in development
 * (React refresh).
 */
export function contentSecurityPolicy(options: { supabaseUrl?: string; development?: boolean } = {}): string {
  const connect = ["'self'", "https://*.supabase.co", "wss://*.supabase.co"];
  try {
    // A self-hosted or local Supabase is not under supabase.co.
    const supabase = new URL(options.supabaseUrl ?? "");
    if (!supabase.hostname.endsWith(".supabase.co")) {
      connect.push(supabase.origin, supabase.origin.replace(/^http/, "ws"));
    }
  } catch {
    // not configured: the defaults stay
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${options.development ? " 'unsafe-eval'" : ""}`,
    // Google Fonts: the presentation page at "/" loads its typefaces from there.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connect.join(" ")}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function securityHeaders(
  options: { supabaseUrl?: string; development?: boolean } = {},
): { key: string; value: string }[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    // Two years; browsers ignore it over plain http (local development).
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
  ];
}

const nextConfig: NextConfig = {
  // Workspace packages are plain TypeScript source (no build step).
  transpilePackages: ["@ia-connect/core", "@ia-connect/connectors", "@ia-connect/ai"],
  // Node-only libraries used by connectors/ai: keep them out of the server bundle.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "playwright", "@anthropic-ai/sdk"],
  // Monorepo root, so file tracing sees the workspace packages.
  outputFileTracingRoot: path.join(here, "../.."),
  poweredByHeader: false,
  // The presentation site is a static page copied into public/ by scripts/sync-site.mjs.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/index.html" }], afterFiles: [], fallback: [] };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          development: process.env.NODE_ENV !== "production",
        }),
      },
    ];
  },
  webpack(config) {
    // packages/* use explicit `.ts` extensions in relative imports; also let
    // `.js` specifiers resolve to TypeScript sources.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
