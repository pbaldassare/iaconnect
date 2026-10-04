import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connectorEnv } from "../src/deps.ts";

/**
 * `src/main.ts` as the container starts it (`tsx apps/worker/src/main.ts`), in a child
 * process: the whole module graph loads (pg, Playwright, connectors, Anthropic SDK) and
 * the wiring survives realistic environment variables. The database is unreachable on
 * purpose: nothing is read or sent.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function startWorker(env: Record<string, string>, until: (output: string) => boolean) {
  return new Promise<{ code: number | null; output: string; stoppedInMs: number }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "apps/worker/src/main.ts"], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    });
    let output = "";
    let signalledAt = 0;
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (!signalledAt && until(output)) {
        signalledAt = Date.now();
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`worker did not stop in time. Output:\n${output}`));
    }, 25_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output, stoppedInMs: signalledAt ? Date.now() - signalledAt : 0 });
    });
  });
}

describe("worker startup", () => {
  it("starts with real-looking environment variables and stops promptly on SIGTERM", async () => {
    const result = await startWorker(
      {
        DATABASE_URL: "postgres://worker:db-password-123@127.0.0.1:9/postgres",
        DATABASE_SSL: "false",
        ANTHROPIC_API_KEY: "sk-ant-api03-not-a-real-key",
        AI_MODEL_SMART: "claude-opus-5-5",
        WORKER_CONCURRENCY: "2",
        OUTBOUND_OVERRIDE_RECIPIENT: "+393331234567,prova@example.com",
        META_APP_SECRET: "meta-app-secret",
        GOOGLE_CLIENT_ID: "google-client-id",
      },
      // Started, and the first database error has been reported: every loop is now asleep.
      (output) => output.includes("worker started") && output.includes("ensure pass failed"),
    );
    expect(result.output).toContain('"message":"worker started"');
    expect(result.output).toContain('"ai":true');
    expect(result.output).toContain('"outboundOverride":true');
    expect(result.output).toContain('"message":"worker stopped"');
    expect(result.output).not.toContain("worker crashed");
    expect(result.code).toBe(0);
    // The ensure loop sleeps a minute between passes: stop must wake it, not wait for it.
    expect(result.stoppedInMs).toBeLessThan(8_000);
    // No credential in the log lines.
    expect(result.output).not.toContain("db-password-123");
    expect(result.output).not.toContain("sk-ant-api03");
  }, 30_000);

  it("refuses to start without DATABASE_URL, with one clear log line", async () => {
    const result = await startWorker({}, () => false);
    expect(result.code).toBe(1);
    expect(result.output).toContain("DATABASE_URL is required");
  }, 30_000);

  it("hands connectors only the platform settings they need", () => {
    expect(
      connectorEnv({
        DATABASE_URL: "postgres://secret",
        ANTHROPIC_API_KEY: "sk-ant",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        GOOGLE_CLIENT_ID: "g",
        GOOGLE_CLIENT_SECRET: "gs",
        MICROSOFT_CLIENT_ID: "m",
        META_APP_SECRET: "ms",
        META_GRAPH_VERSION: "v21.0",
        WAWEBAPI_BASE_URL: "https://wa.example.com",
        WEBHOOK_PUBLIC_URL: "https://hooks.example.com",
      }),
    ).toEqual({
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "gs",
      MICROSOFT_CLIENT_ID: "m",
      META_APP_SECRET: "ms",
      META_GRAPH_VERSION: "v21.0",
      WAWEBAPI_BASE_URL: "https://wa.example.com",
      WEBHOOK_PUBLIC_URL: "https://hooks.example.com",
    });
  });
});
