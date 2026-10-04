/**
 * Node-only: the DNS lookup behind `ConnectorContext.resolveHost`. Imported by `index.ts`
 * and by the IMAP/SMTP connector, never by anything reachable from `webhooks.ts` (edge runtime).
 */
import { lookup } from "node:dns/promises";
import type { HostResolver } from "@ia-connect/core";

/** Every address the system resolver returns for the name (A and AAAA), as the sockets would see them. */
export const nodeHostResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};
