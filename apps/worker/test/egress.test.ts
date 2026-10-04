import { type AddressInfo, type Server, connect, createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicOnly, startEgressProxy } from "../src/scrape/egress.ts";

/** The https side of the scraping proxy (CONNECT tunnels), without a browser. */

let echo: Server;
let echoPort = 0;
const received: string[] = [];

beforeAll(async () => {
  echo = createServer((socket) => {
    socket.on("data", (chunk) => {
      received.push(chunk.toString());
      socket.write(`echo:${chunk.toString()}`);
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
  echoPort = (echo.address() as AddressInfo).port;
});
afterAll(() => new Promise((resolve) => echo.close(resolve)));

/** Sends a CONNECT, then `payload` once the tunnel is up; resolves with everything read. */
function tunnel(proxyUrl: string, target: string, payload = "ping"): Promise<string> {
  return new Promise((resolve) => {
    const { hostname, port } = new URL(proxyUrl);
    let data = "";
    const socket = connect(Number(port), hostname, () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      const first = data === "";
      data += chunk.toString();
      if (first && data.startsWith("HTTP/1.1 200")) socket.write(payload);
      if (data.includes("echo:")) socket.end();
    });
    socket.on("close", () => resolve(data));
    socket.on("error", () => resolve(data));
  });
}

describe("egress proxy", () => {
  it("opens a tunnel only towards a vetted address, and connects to that address", async () => {
    const asked: string[] = [];
    const proxy = await startEgressProxy(async (hostname) => {
      asked.push(hostname);
      // The name is made up: the tunnel works only because the proxy uses the vetted address.
      if (hostname === "public.test") return ["127.0.0.1"];
      throw new Error("refused");
    });
    try {
      const ok = await tunnel(proxy.url, `public.test:${echoPort}`);
      expect(ok).toContain("200 Connection Established");
      expect(ok).toContain("echo:ping");

      received.length = 0;
      for (const target of [
        `internal.test:${echoPort}`,
        `127.0.0.1:${echoPort}`,
        `[::1]:${echoPort}`,
        `localhost:${echoPort}`,
        "not-a-target",
      ]) {
        const refused = await tunnel(proxy.url, target);
        expect(refused, target).toContain("403");
        expect(refused, target).not.toContain("echo:");
      }
      expect(received).toEqual([]);
      expect(asked).toContain("::1");
      expect(proxy.blocked).toEqual(expect.arrayContaining(["internal.test", "127.0.0.1", "localhost"]));
    } finally {
      await proxy.close();
    }
  });

  it("the default policy refuses names that resolve to a private address", async () => {
    const policy = publicOnly(async (hostname) =>
      hostname === "ok.example.com" ? ["93.184.216.34"] : ["93.184.216.34", "10.0.0.8"],
    );
    expect(await policy("ok.example.com")).toEqual(["93.184.216.34"]);
    await expect(policy("rebind.example.com")).rejects.toThrow();
    await expect(policy("169.254.169.254")).rejects.toThrow();
    await expect(policy("metadata.google.internal")).rejects.toThrow();
  });
});
