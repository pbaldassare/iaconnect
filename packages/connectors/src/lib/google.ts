import { requireEnv, send } from "./http.ts";
import type { OAuthProvider } from "./oauth.ts";

export function googleOAuth(service: string): OAuthProvider {
  return {
    service,
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  };
}

export function googleAuthorizationUrl(
  scopes: string[],
  input: { redirectUri: string; state: string; env: Record<string, string | undefined> },
): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: requireEnv(input.env, "GOOGLE_CLIENT_ID"),
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    // offline + consent: Google returns a refresh token only on an explicit consent.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
  }).toString();
  return url.toString();
}

/** Best-effort revocation on disconnect: failures are ignored. */
export async function revokeGoogleToken(
  fetchFn: typeof fetch,
  service: string,
  token: unknown,
): Promise<void> {
  if (typeof token !== "string" || !token) return;
  try {
    const response = await send(fetchFn, service, "https://oauth2.googleapis.com/revoke", {
      form: { token },
    });
    await response.body?.cancel();
  } catch {
    // Nothing to do: the customer can also revoke access from the Google account page.
  }
}
