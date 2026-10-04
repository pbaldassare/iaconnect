import { base64UrlEncode, randomHex, toBase64, utf8 } from "./crypto.ts";

export interface MimeMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
}

/** Header values come from flow data: strip line breaks to prevent header injection. */
function clean(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeaderText(value: string): string {
  const cleaned = clean(value);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: detecting non-ASCII header text
  if (/^[\x00-\x7f]*$/.test(cleaned)) return cleaned;
  return `=?UTF-8?B?${toBase64(utf8(cleaned))}?=`;
}

function base64Lines(text: string): string {
  return (toBase64(utf8(text)).match(/.{1,76}/g) ?? []).join("\r\n");
}

function angle(messageId: string): string {
  const cleaned = clean(messageId);
  return cleaned.startsWith("<") ? cleaned : `<${cleaned}>`;
}

/** Builds an RFC 822 message (text, or multipart/alternative when `html` is given). */
export function buildRfc822(message: MimeMessage): string {
  const headers = [
    `From: ${clean(message.from)}`,
    `To: ${clean(message.to)}`,
    `Subject: ${encodeHeaderText(message.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (message.inReplyTo) {
    headers.push(`In-Reply-To: ${angle(message.inReplyTo)}`, `References: ${angle(message.inReplyTo)}`);
  }
  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.text),
  ];
  if (!message.html) return [...headers, ...textPart].join("\r\n");

  const boundary = `ia_${randomHex(12)}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPart,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.html),
    `--${boundary}--`,
  ].join("\r\n");
}

export function buildRawBase64Url(message: MimeMessage): string {
  return base64UrlEncode(buildRfc822(message));
}

/** Splits `Mario Rossi <mario@example.com>` into name and address. */
export function parseAddress(value: string | undefined): { name?: string; email: string } {
  const raw = (value ?? "").trim();
  const match = /^(.*)<([^>]+)>\s*$/.exec(raw);
  if (!match) return { email: raw };
  const name = (match[1] ?? "").trim().replace(/^"|"$/g, "");
  return { name: name || undefined, email: (match[2] ?? "").trim() };
}
