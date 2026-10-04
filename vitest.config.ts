import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // apps/web: the `@/…` alias of its tsconfig, and the build-time "server-only" marker.
      // Only the demo tests need them (they load lib/session.ts with the Next modules mocked).
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./apps/web/test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "supabase/test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
