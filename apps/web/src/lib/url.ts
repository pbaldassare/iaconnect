import "server-only";
import { resolveAppUrl } from "@/lib/app-url";
import { headers } from "next/headers";

/**
 * Public base URL of the app, no trailing slash. APP_URL; outside production it falls back to
 * the request's own host (never to `X-Forwarded-Host`). In production a missing APP_URL is an
 * error with an Italian message (see lib/app-url.ts).
 */
export async function appUrl(): Promise<string> {
  const configured = process.env.APP_URL;
  if (configured || process.env.NODE_ENV === "production") {
    return resolveAppUrl({ appUrl: configured, nodeEnv: process.env.NODE_ENV });
  }
  const h = await headers();
  return resolveAppUrl({
    appUrl: configured,
    nodeEnv: process.env.NODE_ENV,
    host: h.get("host"),
    forwardedProto: h.get("x-forwarded-proto"),
  });
}
