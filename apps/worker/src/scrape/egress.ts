import { lookup } from "node:dns/promises";
import { type IncomingMessage, type Server, type ServerResponse, createServer, request } from "node:http";
import { type AddressInfo, type Socket, connect } from "node:net";
import { type HostResolver, assertPublicHost } from "@ia-connect/core";

/**
 * Where the scraping browser may connect. Returns the addresses a host may be reached at
 * and throws when the host is not allowed. Default: DNS lookup, every address must be public.
 */
export type EgressPolicy = (hostname: string) => Promise<string[]>;

export const nodeResolveHost: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/** The production policy: the shared classifier of packages/core over every resolved address. */
export function publicOnly(resolveHost: HostResolver = nodeResolveHost): EgressPolicy {
  return (hostname) => assertPublicHost(hostname, resolveHost);
}

export interface EgressProxy {
  /** `http://127.0.0.1:<port>`, to hand to the browser as its proxy. */
  url: string;
  /** Hosts refused so far. */
  blocked: string[];
  close(): Promise<void>;
}

/**
 * A forward proxy on loopback through which the scraping browser makes EVERY connection:
 * navigations, redirects, subresources, frames, workers, WebSockets. For each one the host
 * is vetted by the policy and the proxy connects to the vetted address itself, so the name
 * cannot resolve to something else between the check and the connection (no DNS rebinding).
 *
 * Playwright's request interception alone is not enough: its handler is not called for the
 * hops of a redirect, so a public page could still redirect the browser to a private address.
 */
export async function startEgressProxy(policy: EgressPolicy): Promise<EgressProxy> {
  const blocked: string[] = [];
  const sockets = new Set<Socket>();
  const vet = async (hostname: string): Promise<string | undefined> => {
    try {
      const addresses = await policy(hostname.replace(/^\[|\]$/g, ""));
      if (addresses[0]) return addresses[0];
    } catch {
      // refused below
    }
    if (!blocked.includes(hostname)) blocked.push(hostname);
    return undefined;
  };

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Plain http: the request line carries the absolute URL.
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400).end();
      return;
    }
    const address = await vet(target.hostname);
    if (!address) {
      // No answer at all: the browser reports a failed request instead of rendering ours.
      req.socket.destroy();
      return;
    }
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: target.host };
    for (const name of ["proxy-connection", "proxy-authorization"]) delete headers[name];
    const upstream = request(
      {
        host: address,
        port: Number(target.port) || 80,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  // https (and WebSockets): a tunnel to host:port, opened only towards a vetted address.
  server.on("connect", async (req: IncomingMessage, client: Socket, head: Buffer) => {
    client.on("error", () => undefined);
    const match = /^(.+):(\d+)$/.exec(req.url ?? "");
    const address = match ? await vet(match[1]!) : undefined;
    if (!match || !address) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = connect(Number(match[2]), address, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on("error", () => client.destroy());
    upstream.on("close", () => {
      sockets.delete(upstream);
      client.destroy();
    });
    client.on("close", () => upstream.destroy());
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    blocked,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
