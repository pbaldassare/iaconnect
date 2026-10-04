import { canConnect } from "@/lib/connections/access";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS, createOAuthState } from "@/lib/connections/oauth-state";
import { connectorEnv, oauthStateSecret } from "@/lib/connections/server";
import { DEMO_READ_ONLY_MESSAGE } from "@/lib/demo/client";
import { isUuid } from "@/lib/org-selection";
import { requireOrgManager } from "@/lib/session";
import { hasServiceKey } from "@/lib/supabase/service";
import { appUrl } from "@/lib/url";
import { getConnector } from "@ia-connect/connectors";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Starts an OAuth connection: signs the state (organization, connector, user,
 * nonce) into an httpOnly cookie and sends the manager to the provider.
 * Only the nonce travels through the provider.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ connector: string }> }) {
  const context = await requireOrgManager();
  // Closed in the demo (the middleware already keeps demo visitors out of /api).
  if (context.demo) return new Response(DEMO_READ_ONLY_MESSAGE, { status: 403 });
  const { connector: key } = await params;
  const base = await appUrl();
  const back = (outcome: string) => NextResponse.redirect(`${base}/app/collegamenti?esito=${outcome}`);

  const connector = getConnector(key);
  if (!connector || connector.connectMode !== "oauth" || !connector.startOAuth) return back("errore");
  if (!(await canConnect(context, connector.key))) return back("permesso");
  const secret = oauthStateSecret();
  if (!secret) return back("segreto");
  if (!hasServiceKey()) return back("chiave");

  const reconnect = request.nextUrl.searchParams.get("ricollega");
  const page = request.nextUrl.searchParams.get("pagina");
  const { cookie, nonce } = createOAuthState(
    {
      org: context.org.organization.id,
      connector: connector.key,
      user: context.session.user.id,
      ...(isUuid(reconnect) ? { reconnect } : {}),
      ...(page && /^\d{1,32}$/.test(page) ? { extra: { pageId: page } } : {}),
    },
    secret,
  );

  let authorizationUrl: string;
  try {
    authorizationUrl = connector.startOAuth({
      redirectUri: `${base}/api/oauth/${connector.key}/callback`,
      state: nonce,
      env: connectorEnv(),
    }).authorizationUrl;
  } catch {
    // The platform's OAuth application for this provider is not configured.
    return back("configurazione");
  }

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax: the cookie must come back on the provider's top-level redirect.
    sameSite: "lax",
    path: "/api/oauth",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return response;
}
