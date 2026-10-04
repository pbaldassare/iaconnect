import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Workspace packages are plain TypeScript source (no build step).
  transpilePackages: ["@ia-connect/core", "@ia-connect/connectors", "@ia-connect/ai"],
  // Node-only libraries used by connectors/ai: keep them out of the server bundle.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "playwright", "@anthropic-ai/sdk"],
  // Monorepo root, so file tracing sees the workspace packages.
  outputFileTracingRoot: path.join(here, "../.."),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
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
