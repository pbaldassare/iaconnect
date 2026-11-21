import { z } from "zod";

/**
 * Customer-facing copy of the IMAP/SMTP connector. Kept beside the Node
 * implementation so the web catalog can show the form without loading
 * imapflow, mailparser or nodemailer.
 */
export const IMAP_SMTP_NAME = "Altra casella (IMAP/SMTP)";
export const IMAP_SMTP_DESCRIPTION = "Qualsiasi casella con accesso IMAP e SMTP.";

export const ImapSmtpInput = z.object({
  email: z.string().email().describe("Indirizzo mail della casella"),
  fromName: z.string().optional().describe("Nome mostrato come mittente"),
  username: z.string().min(1).describe("Nome utente (di solito l'indirizzo mail)"),
  password: z.string().min(1).describe("Password o password per le app"),
  imapHost: z.string().min(1).describe("Server IMAP (posta in arrivo)"),
  imapPort: z.number().int().positive().default(993).describe("Porta IMAP"),
  imapSecure: z.boolean().default(true).describe("Connessione IMAP cifrata (TLS)"),
  smtpHost: z.string().min(1).describe("Server SMTP (posta in uscita)"),
  smtpPort: z.number().int().positive().default(465).describe("Porta SMTP"),
  smtpSecure: z.boolean().default(true).describe("Connessione SMTP cifrata (TLS)"),
});
