import type { RevealedSecret } from "@/lib/connections/catalog";

/** Result of the guided connection form (useActionState). Lives outside actions.ts, which may only export async functions. */
export type ConnectState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string>;
      /** Non-secret values typed so far, so the form does not start empty again. */
      values?: Record<string, string>;
    }
  | {
      status: "done";
      connectionId: string;
      name: string;
      message: string;
      /** Address to configure in the other system, when the connector has one per connection. */
      webhookUrl: string | null;
      /** Generated secrets, shown this one time only. */
      secrets: RevealedSecret[];
      /** Copyable example request (webhook mode). */
      example: string | null;
      /** QR pairing data (qr mode). */
      qr: string | null;
      qrMessage: string | null;
      warnings: string[];
    };

export const CONNECT_IDLE: ConnectState = { status: "idle" };
