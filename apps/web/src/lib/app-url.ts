/**
 * Public base URL of the app. Pure (no `server-only`): unit tested.
 *
 * The address ends up in mail links and in OAuth return addresses, so in production it comes
 * from APP_URL only: `Host` and `X-Forwarded-Host` are written by whoever sends the request
 * and would let a stranger point those links at a site of their own.
 */
export class MissingAppUrlError extends Error {
  constructor() {
    super(
      "Configurazione mancante: imposta APP_URL (indirizzo pubblico dell'app, ad esempio https://app.esempio.it) nell'ambiente del server.",
    );
    this.name = "MissingAppUrlError";
  }
}

export function resolveAppUrl(input: {
  appUrl: string | undefined;
  nodeEnv: string | undefined;
  /** Request headers, used only outside production. */
  host?: string | null;
  forwardedProto?: string | null;
}): string {
  const configured = input.appUrl?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (input.nodeEnv === "production") throw new MissingAppUrlError();
  const host = input.host || "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = input.forwardedProto ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
