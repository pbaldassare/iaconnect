import { describe, expect, it } from "vitest";
import { PrivateHostError, assertPublicHost, isPublicAddress, isPublicHostname } from "../src/index";

describe("address classifier (SSRF guard)", () => {
  it("refuses every non-public IPv4 range", () => {
    for (const address of [
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1", // carrier-grade NAT
      "100.127.255.254",
      "127.0.0.1",
      "127.8.8.8",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "192.0.0.8",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.7",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of [
      "8.8.8.8",
      "1.1.1.1",
      "100.63.255.255",
      "100.128.0.1",
      "172.15.0.1",
      "172.32.0.1",
      "193.0.0.1",
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("refuses every non-public IPv6 range, including IPv4 hidden inside IPv6", () => {
    for (const address of [
      "::",
      "::1",
      "[::1]",
      "::ffff:127.0.0.1", // IPv4-mapped
      "::ffff:7f00:1",
      "[::ffff:a9fe:a9fe]", // 169.254.169.254
      "::ffff:10.0.0.1",
      "::127.0.0.1", // IPv4-compatible
      "64:ff9b::7f00:1", // NAT64 of 127.0.0.1
      "64:ff9b:1::1",
      "2002:7f00:1::", // 6to4 of 127.0.0.1
      "2002:c0a8:101::1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
      "2001:db8::1",
      "fc00::1",
      "fd12:3456:789a::1",
      "fe80::1",
      "fe80::1%eth0",
      "fec0::1",
      "ff02::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of [
      "2606:4700:4700::1111",
      "2a00:1450:4002:402::200e",
      "::ffff:8.8.8.8",
      "64:ff9b::808:808",
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    for (const notAnAddress of [
      "",
      "example.com",
      "1.2.3",
      "1.2.3.4.5",
      "256.1.1.1",
      ":::",
      "g::1",
      "1:2:3:4:5:6:7:8:9",
    ]) {
      expect(isPublicAddress(notAnAddress), notAnAddress).toBe(false);
    }
  });

  it("refuses internal host names", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "localhost.",
      "app.localhost",
      "printer.local",
      "db.internal",
      "host.docker.internal",
      "metadata.google.internal",
      "metadata",
      "instance-data",
      "kubernetes.default.svc",
      "api.default.svc.cluster.local",
      "intranet",
      "nas.lan",
      "router.home.arpa",
      "",
      "2130706433", // 127.0.0.1 as a number
      "0x7f000001",
      "127.1",
      "[::ffff:127.0.0.1]",
      "169.254.169.254",
    ]) {
      expect(isPublicHostname(host), host).toBe(false);
    }
    for (const host of [
      "example.com",
      "gestionale.example.com",
      "portale.test",
      "8.8.8.8",
      "[2606:4700:4700::1111]",
      "internal.example.com",
      "localhost.example.com",
    ]) {
      expect(isPublicHostname(host), host).toBe(true);
    }
    // What the URL parser makes of the odd forms is covered too.
    for (const url of [
      "http://2130706433/",
      "http://0x7f.1/",
      "http://[::ffff:127.0.0.1]/",
      "http://127.1/",
      "http://[::]/",
      "http://0/",
    ]) {
      expect(isPublicHostname(new URL(url).hostname), url).toBe(false);
    }
  });

  it("checks every address a name resolves to", async () => {
    const dns: Record<string, string[]> = {
      "ok.example.com": ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
      "rebind.example.com": ["93.184.216.34", "127.0.0.1"],
      "metadata.example.com": ["169.254.169.254"],
      "mapped.example.com": ["::ffff:10.0.0.5"],
      "empty.example.com": [],
    };
    const resolve = async (host: string) => {
      const found = dns[host];
      if (!found) throw new Error("ENOTFOUND");
      return found;
    };
    expect(await assertPublicHost("ok.example.com", resolve)).toEqual(dns["ok.example.com"]);
    expect(await assertPublicHost("8.8.8.8", resolve)).toEqual(["8.8.8.8"]);
    // Without a resolver only the name is checked (edge function).
    expect(await assertPublicHost("rebind.example.com")).toEqual([]);
    for (const [host, reason] of [
      ["rebind.example.com", "dns"],
      ["metadata.example.com", "dns"],
      ["mapped.example.com", "dns"],
      ["empty.example.com", "unresolved"],
      ["missing.example.com", "unresolved"],
      ["localhost", "hostname"],
      ["10.0.0.1", "hostname"],
    ] as const) {
      const error = await assertPublicHost(host, resolve).catch((caught: unknown) => caught);
      expect(error, host).toBeInstanceOf(PrivateHostError);
      expect((error as PrivateHostError).reason, host).toBe(reason);
    }
  });
});
