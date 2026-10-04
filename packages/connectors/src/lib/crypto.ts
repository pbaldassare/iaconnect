/** Web Crypto helpers shared by every connector (Node 22+ and Deno). */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? utf8(input) : input;
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes base64 or base64url into a UTF-8 string. */
export function base64DecodeToString(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decoder.decode(bytes);
}

export async function hmac(
  algorithm: "SHA-256" | "SHA-1",
  secret: string,
  data: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: algorithm }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(data)));
}

export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  return toHex(await hmac("SHA-256", secret, data));
}

export async function hmacSha1Base64(secret: string, data: string): Promise<string> {
  return toBase64(await hmac("SHA-1", secret, data));
}

export async function sha256Hex(data: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(data))));
}

/** Constant-time comparison of two strings (length leaks, content does not). */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = utf8(a);
  const right = utf8(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

export function randomHex(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
