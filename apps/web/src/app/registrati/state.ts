/** State of the registration form (shared by the server actions and the client form). */

export interface RegisterValues {
  full_name: string;
  company_name: string;
  sector: string;
  phone: string;
  email: string;
  message: string;
}

export type RegisterState =
  | {
      step: "form";
      message?: string;
      fieldErrors?: Record<string, string>;
      /** What the person typed, to fill the form again after an error. Never the password. */
      values?: RegisterValues;
    }
  | { step: "sent"; email: string };

export const REGISTER_IDLE: RegisterState = { step: "form" };

export type ResendState = { ok: boolean; message: string } | null;
