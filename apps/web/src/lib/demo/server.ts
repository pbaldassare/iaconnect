import "server-only";
import { DEMO_COOKIE, DEMO_HEADER } from "@/lib/routes";
import { cookies, headers } from "next/headers";
import { DemoReadOnlyError } from "./client";

/**
 * True when the middleware marked this request as a demo request: a visitor with the demo
 * cookie, without a real session, on an address under `/app` (see `demoDecision`).
 * The header is written by the middleware only, which discards whatever the browser sent.
 */
export async function isDemoRequest(): Promise<boolean> {
  return (await headers()).get(DEMO_HEADER) === "1";
}

/**
 * Guard for the real Supabase client factories and for anything that must never run for a
 * demo visitor (connectors, AI, mail). Throws the read-only error, which `errorMessage()`
 * turns into the Italian message.
 */
export async function assertNotDemo(): Promise<void> {
  if (await isDemoRequest()) throw new DemoReadOnlyError();
}

/** Leaves the demo: the cookie is removed (server actions and route handlers only). */
export async function clearDemoCookie(): Promise<void> {
  (await cookies()).delete(DEMO_COOKIE);
}
