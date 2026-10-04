export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/** Keys whose values never reach the logs: secrets and anything a person wrote. */
const REDACTED =
  /secret|token|password|authorization|api_?key|cookie|^(text|body|content|html|subject|payload)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = REDACTED.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

/** Structured JSON lines on stdout/stderr. */
export function createJsonLogger(write: (line: string, level: string) => void = defaultWrite): Logger {
  const log = (level: string) => (message: string, data?: Record<string, unknown>) =>
    write(
      JSON.stringify({ time: new Date().toISOString(), level, message, ...(redact(data ?? {}) as object) }),
      level,
    );
  return { info: log("info"), warn: log("warn"), error: log("error") };
}

function defaultWrite(line: string, level: string) {
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
