/**
 * Rules of the public registration form and of the access request. Pure: unit tested
 * (test/registration.test.ts). The same limits are enforced by the database function
 * `ia_connect.request_access` (migration 20261004002000_access_requests.sql).
 */

export const REQUEST_LIMITS = { fullName: 120, companyName: 120, phone: 40, message: 1000 } as const;
export const COMPANY_NAME_MIN = 2;
export const PASSWORD_MIN = 10;
export const REQUEST_SECTORS = ["insurance", "ecommerce", "real_estate", "other"] as const;
export type RequestSector = (typeof REQUEST_SECTORS)[number];

/** Key of `user_metadata` that carries the form across the confirmation mail. Namespaced:
 * the Auth project is shared with another application that has metadata of its own. */
export const REGISTRATION_METADATA_KEY = "ia_connect_registration";

export interface AccessRequestInput {
  fullName: string | null;
  companyName: string;
  sector: RequestSector;
  phone: string | null;
  message: string | null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

/**
 * The access request saved at sign-up, read back from `user_metadata`. Null when the user
 * never filled the IA Connect form (an account of the other application) or the data is
 * unusable. The metadata is written by the user: everything is re-validated here and again
 * by the database.
 */
export function registrationFromMetadata(metadata: unknown): AccessRequestInput | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const raw = (metadata as Record<string, unknown>)[REGISTRATION_METADATA_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const companyName = text(data.company_name, REQUEST_LIMITS.companyName);
  if (!companyName || companyName.length < COMPANY_NAME_MIN) return null;
  const sector = (REQUEST_SECTORS as readonly string[]).includes(data.sector as string)
    ? (data.sector as RequestSector)
    : "other";
  return {
    fullName: text(data.full_name, REQUEST_LIMITS.fullName),
    companyName,
    sector,
    phone: text(data.phone, REQUEST_LIMITS.phone),
    message: text(data.message, REQUEST_LIMITS.message),
  };
}

/** What goes into `options.data` of `auth.signUp`. */
export function registrationMetadata(
  input: AccessRequestInput,
  privacyAcknowledgedAt: string,
): Record<string, Record<string, string | null>> {
  return {
    [REGISTRATION_METADATA_KEY]: {
      full_name: input.fullName,
      company_name: input.companyName,
      sector: input.sector,
      phone: input.phone,
      message: input.message,
      privacy_acknowledged_at: privacyAcknowledgedAt,
    },
  };
}

/** Arguments of the `request_access` database function. */
export function requestAccessArgs(input: AccessRequestInput) {
  return {
    p_full_name: input.fullName,
    p_company_name: input.companyName,
    p_sector: input.sector,
    p_phone: input.phone,
    p_message: input.message,
  };
}

// ── Abuse checks of the public form ─────────────────────────────────────

/** Name of the field people never see and scripts fill in. */
export const HONEYPOT_FIELD = "reference_code";
/** Name of the hidden field with the time the form was rendered (ms since epoch). */
export const STARTED_AT_FIELD = "started_at";
/** A person needs longer than this to fill eight fields. */
export const MIN_FILL_MS = 3000;
/** A form older than this is stale: ask to reload instead of trusting the timestamp. */
export const MAX_FILL_MS = 24 * 60 * 60 * 1000;

export type FormCheck = "ok" | "honeypot" | "too_fast" | "stale";

/**
 * Cheap filter against scripts, not a defence against a determined attacker (the timestamp
 * is not signed): the real protection is the CAPTCHA of Supabase Auth and its rate limits.
 */
export function checkFormSubmission(input: {
  honeypot: string | null | undefined;
  startedAt: string | null | undefined;
  now: number;
}): FormCheck {
  if ((input.honeypot ?? "").trim() !== "") return "honeypot";
  const started = Number(input.startedAt);
  if (!input.startedAt || !Number.isFinite(started)) return "too_fast";
  const elapsed = input.now - started;
  if (elapsed < MIN_FILL_MS) return "too_fast";
  if (elapsed > MAX_FILL_MS) return "stale";
  return "ok";
}

// ── Messages ────────────────────────────────────────────────────────────

interface ErrorLike {
  code?: string | null;
  message?: string | null;
}

/** Italian message for an error of `request_access` / `decide_access_request`; null = not one of theirs. */
export function accessRequestErrorMessage(error: unknown): string | null {
  const e = (typeof error === "object" && error !== null ? error : {}) as ErrorLike;
  const message = e.message ?? "";
  if (e.code === "IAC10") {
    return "Il tuo indirizzo mail non è ancora confermato. Apri il link che ti abbiamo mandato, poi riprova.";
  }
  if (e.code === "IAC11") {
    return "Hai già un accesso a IA Connect: non serve una nuova richiesta. Ricarica la pagina.";
  }
  if (e.code === "IAC12") {
    return "Questa richiesta è già stata decisa. Ricarica la pagina per vedere lo stato aggiornato.";
  }
  if (e.code === "22023" && /plan|reseller/.test(message)) {
    return "Il piano scelto non esiste o non è attivo. Scegline un altro.";
  }
  if (e.code === "22023") return "Uno dei testi è vuoto o troppo lungo. Controlla i campi e riprova.";
  if (e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42P01" || e.code === "42883") {
    return "Le richieste di accesso non sono ancora attive su questo database (migrazione non applicata). Riprova più tardi.";
  }
  return null;
}

/** Label and tone of a request status. */
export function accessRequestStatus(value: string | null | undefined): {
  label: string;
  tone: "ok" | "warning" | "error" | "neutral";
} {
  if (value === "pending") return { label: "In attesa", tone: "warning" };
  if (value === "approved") return { label: "Approvata", tone: "ok" };
  if (value === "rejected") return { label: "Rifiutata", tone: "error" };
  return { label: value ?? "—", tone: "neutral" };
}
