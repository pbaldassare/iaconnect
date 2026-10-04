import { type ConnectorContext, ConnectorError } from "@ia-connect/core";
import { type HttpOptions, authExpired, errorFromStatus, readJson, requireEnv, send } from "./http.ts";
import { type Json, asRecord, asString } from "./values.ts";

export interface OAuthProvider {
  service: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** Refresh this long before the real expiry. */
const EXPIRY_MARGIN_MS = 60_000;

function tokenSetFrom(service: string, json: Json, nowMs: number): TokenSet {
  const accessToken = asString(json.access_token);
  if (!accessToken) {
    throw new ConnectorError(`${service}: risposta di autorizzazione non valida`, {
      retryable: false,
      code: "oauth_invalid_response",
    });
  }
  const expiresIn = Number(json.expires_in);
  return {
    accessToken,
    refreshToken: asString(json.refresh_token),
    expiresAt: nowMs + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  };
}

/** Exchanges the authorization code received on the redirect for tokens. */
export async function exchangeCode(
  deps: { fetch: typeof fetch; env: Record<string, string | undefined> },
  provider: OAuthProvider,
  input: { code: string; redirectUri: string },
): Promise<TokenSet> {
  const response = await send(deps.fetch, provider.service, provider.tokenUrl, {
    form: {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: requireEnv(deps.env, provider.clientIdEnv),
      client_secret: requireEnv(deps.env, provider.clientSecretEnv),
    },
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new ConnectorError(`${provider.service}: autorizzazione rifiutata, ripeti il collegamento`, {
        retryable: false,
        code: "oauth_exchange_failed",
        status: response.status,
      });
    }
    throw errorFromStatus(provider.service, response.status);
  }
  return tokenSetFrom(provider.service, asRecord(await readJson(response)), Date.now());
}

/**
 * Returns a valid access token, refreshing it when it is about to expire.
 * New secrets are persisted with `context.saveSecrets` and mirrored on `context.secrets`.
 */
export async function getAccessToken(
  context: ConnectorContext,
  provider: OAuthProvider,
  force = false,
): Promise<string> {
  const { accessToken, refreshToken, expiresAt } = context.secrets;
  const nowMs = context.now().getTime();
  if (
    !force &&
    typeof accessToken === "string" &&
    accessToken &&
    typeof expiresAt === "number" &&
    expiresAt - EXPIRY_MARGIN_MS > nowMs
  ) {
    return accessToken;
  }
  if (typeof refreshToken !== "string" || !refreshToken) throw authExpired(provider.service);

  const response = await send(context.fetch, provider.service, provider.tokenUrl, {
    form: {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: requireEnv(context.env, provider.clientIdEnv),
      client_secret: requireEnv(context.env, provider.clientSecretEnv),
    },
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    // invalid_grant (revoked or expired refresh token) comes back as 400 or 401.
    if (response.status === 400 || response.status === 401) throw authExpired(provider.service);
    throw errorFromStatus(provider.service, response.status);
  }
  const tokens = tokenSetFrom(provider.service, asRecord(await readJson(response)), nowMs);
  const next = {
    ...context.secrets,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? refreshToken,
    expiresAt: tokens.expiresAt,
  };
  await context.saveSecrets(next);
  Object.assign(context.secrets, next);
  context.logger.info("oauth token refreshed", { connectionId: context.connection.id });
  return tokens.accessToken;
}

/** Bearer-authenticated request; on a 401 it refreshes the token once and retries. */
export async function authorizedSend(
  context: ConnectorContext,
  provider: OAuthProvider,
  url: string,
  options: HttpOptions = {},
): Promise<Response> {
  const attempt = async (force: boolean) => {
    const token = await getAccessToken(context, provider, force);
    return send(context.fetch, provider.service, url, {
      ...options,
      headers: { ...options.headers, authorization: `Bearer ${token}` },
    });
  };
  let response = await attempt(false);
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    response = await attempt(true);
  }
  return response;
}

export async function authorizedRequest(
  context: ConnectorContext,
  provider: OAuthProvider,
  url: string,
  options: HttpOptions = {},
): Promise<Response> {
  const response = await authorizedSend(context, provider, url, options);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw errorFromStatus(provider.service, response.status);
  }
  return response;
}

export async function authorizedJson(
  context: ConnectorContext,
  provider: OAuthProvider,
  url: string,
  options: HttpOptions = {},
): Promise<Json> {
  return asRecord(await readJson(await authorizedRequest(context, provider, url, options)));
}
