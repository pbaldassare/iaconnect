import { canConnect } from "@/lib/connections/access";
import { availablePages } from "@/lib/connections/catalog";
import { OAUTH_STATE_COOKIE, verifyOAuthState } from "@/lib/connections/oauth-state";
import {
  AccountAlreadyConnectedError,
  connectDeps,
  oauthStateSecret,
  saveConnection,
} from "@/lib/connections/server";
import { requireOrgManager } from "@/lib/session";
import { hasServiceKey } from "@/lib/supabase/service";
import { appUrl } from "@/lib/url";
import { getConnector } from "@ia-connect/connectors";
import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Where the provider sends the manager back. The state cookie must be signed
 * by us, not expired, carry the nonce that came back, and belong to the
 * signed-in user and the current organization. Only then the code is exchanged
 * and the connection stored.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ connector: string }> }) {
  const context = await requireOrgManager();
  const { connector: key } = await params;
  const base = await appUrl();
  const query = request.nextUrl.searchParams;

  const finish = (path: string) => {
    const response = NextResponse.redirect(`${base}${path}`);
    response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/oauth", maxAge: 0 });
    return response;
  };
  const back = (outcome: string) => finish(`/app/collegamenti?esito=${outcome}`);

  const secret = oauthStateSecret();
  if (!secret) return back("segreto");
  if (!hasServiceKey()) return back("chiave");
  const check = verifyOAuthState(
    request.cookies.get(OAUTH_STATE_COOKIE)?.value,
    { nonce: query.get("state"), connector: key },
    secret,
  );
  if (
    !check.ok ||
    check.state.user !== context.session.user.id ||
    check.state.org !== context.org.organization.id
  ) {
    return back("stato");
  }
  // The customer pressed "cancel" on the provider's page.
  if (query.get("error")) return back("annullato");
  const code = query.get("code");
  if (!code) return back("errore");

  const connector = getConnector(key);
  if (!connector || connector.connectMode !== "oauth") return back("errore");
  if (!(await canConnect(context, connector.key))) return back("permesso");

  let result: Awaited<ReturnType<typeof connector.connect>>;
  try {
    result = await connector.connect(
      {
        ...(check.state.extra ?? {}),
        code,
        redirectUri: `${base}/api/oauth/${connector.key}/callback`,
      },
      connectDeps(),
    );
  } catch (error) {
    const codeOf = (error as { options?: { code?: string } })?.options?.code;
    console.error("[oauth] connect failed", connector.key, codeOf ?? "");
    return back(codeOf === "missing_env" ? "configurazione" : "errore");
  }

  try {
    const saved = await saveConnection(context, {
      connector,
      result,
      reconnectId: check.state.reconnect,
    });
    revalidatePath("/app/collegamenti");
    const pages = availablePages(saved.connection.config);
    const choosePage = pages.length > 1 && !check.state.extra?.pageId;
    return finish(
      `/app/collegamenti/${saved.connection.id}?esito=${check.state.reconnect ? "ricollegato" : "collegato"}${choosePage ? "&passo=pagina" : ""}`,
    );
  } catch (error) {
    if (error instanceof AccountAlreadyConnectedError) return back("gia_collegato");
    console.error("[oauth] save failed", connector.key, (error as { code?: string })?.code ?? "");
    return back("errore");
  }
}
