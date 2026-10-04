import "server-only";
import { ORG_COOKIE } from "@/lib/org-selection";
import { cookies } from "next/headers";

/** Remembers the current organization. Only callable from server actions and route handlers. */
export async function setOrgCookie(organizationId: string): Promise<void> {
  (await cookies()).set(ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearOrgCookie(): Promise<void> {
  (await cookies()).delete(ORG_COOKIE);
}
