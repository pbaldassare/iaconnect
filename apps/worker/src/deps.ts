import type {
  AiService,
  AiUsage,
  BrowserPort,
  Channel,
  Connector,
  HostResolver,
  ScrapeRecipe,
} from "@ia-connect/core";
import type { Sql } from "./db/sql.ts";
import type { Logger } from "./log.ts";
import type { SecretStore } from "./secrets.ts";

export interface ConnectorRegistry {
  get(key: string): Connector | undefined;
  list(): Connector[];
}

export interface TraceInput {
  url: string;
  goal: string;
  browser: BrowserPort;
  hasCredentials: boolean;
  /**
   * Values for the `{{secrets.<name>}}` placeholders. The tracer fills them in the browser
   * and hides them from the model: the one mechanism for credentials while tracing.
   */
  secrets?: Record<string, unknown>;
  previous?: { recipe: ScrapeRecipe; error: string };
}
export interface TraceResult {
  recipe: ScrapeRecipe;
  sampleRows: Record<string, unknown>[];
  usage: AiUsage;
}
/** `traceScrapeRecipe` of `@ia-connect/ai`, with key and model already bound. */
export type ScrapeTracer = (input: TraceInput) => Promise<TraceResult>;

export type ClosableBrowser = BrowserPort & { close(): Promise<void> };

export interface WorkerConfig {
  /** Deliveries of an event or job before it is marked failed. */
  maxAttempts: number;
  /** Executions of one step (retryable errors) before the run fails. */
  maxStepAttempts: number;
  /** First retry delay; doubles at every attempt. */
  backoffBaseMs: number;
  /** How long a claimed event, job or run stays locked before another worker may take it. */
  lockMs: number;
  /** Safety valve against flows that loop forever. */
  maxStepsPerRun: number;
  pollIntervalMinutes: number;
  /**
   * Non-production safety switch. When set, outbound messages go to these recipients
   * instead of the contact; a channel without a test recipient is blocked.
   */
  outboundOverride?: Partial<Record<Channel, string>> & { blockOthers: boolean };
  /** Platform settings handed to connectors (OAuth client ids…). */
  env: Record<string, string | undefined>;
}

export const DEFAULT_CONFIG: WorkerConfig = {
  maxAttempts: 5,
  maxStepAttempts: 4,
  backoffBaseMs: 30_000,
  lockMs: 5 * 60_000,
  maxStepsPerRun: 300,
  pollIntervalMinutes: 5,
  env: {},
};

export interface Deps {
  sql: Sql;
  secrets: SecretStore;
  connectors: ConnectorRegistry;
  ai: AiService;
  now(): Date;
  logger: Logger;
  config: WorkerConfig;
  fetch: typeof fetch;
  /**
   * DNS lookup handed to connectors (`ConnectorContext.resolveHost`): customer-supplied hosts
   * are checked against what they resolve to before any connection. Missing in tests.
   */
  resolveHost?: HostResolver;
  /** Opens a fresh browser for one scrape run. Missing = scraping unavailable. */
  openBrowser?: () => Promise<ClosableBrowser>;
  /** Missing = recipes cannot be traced or repaired (no AI key). */
  tracer?: ScrapeTracer;
}

/** Growing wait between attempts: base, 2×, 4×… capped at one hour. */
export function backoffMs(config: WorkerConfig, attempt: number): number {
  return Math.min(config.backoffBaseMs * 2 ** Math.max(0, attempt - 1), 3_600_000);
}

/** Environment variables connectors may read: platform OAuth apps and webhook settings, nothing else. */
const CONNECTOR_ENV = /^(GOOGLE|MICROSOFT|META|WAWEBAPI|WEBHOOK)_/;

/**
 * What goes into `ConnectorContext.env`. The worker's own secrets (database URL, AI key,
 * Supabase keys) are never handed to connector code.
 */
export function connectorEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => CONNECTOR_ENV.test(name)));
}

/** Parses OUTBOUND_OVERRIDE_RECIPIENT (comma separated phones/mails) and WHATSAPP_TEST_RECIPIENT. */
export function parseOutboundOverride(
  env: Record<string, string | undefined>,
): WorkerConfig["outboundOverride"] {
  const general = (env.OUTBOUND_OVERRIDE_RECIPIENT ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const whatsapp = env.WHATSAPP_TEST_RECIPIENT?.trim();
  if (!general.length && !whatsapp) return undefined;
  const phone = general.find((item) => !item.includes("@"));
  const mail = general.find((item) => item.includes("@"));
  return {
    whatsapp: whatsapp || phone,
    sms: phone,
    mail,
    // Only the general switch declares the whole environment non-production.
    blockOthers: general.length > 0,
  };
}
