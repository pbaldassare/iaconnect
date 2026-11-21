/** Programmer PDF served from the admin API page. Pure: no session and no secrets. */

export const API_DOC_FILENAME = "ia-connect-api-v1.pdf";
export const API_DOC_HREF = "/admin/api/documentazione";

/** Bytes of a base64 payload, or of a `data:` URL produced by a bundler. Whitespace is ignored. */
export function pdfBytesFromModule(source: string): Uint8Array {
  const comma = source.indexOf(",");
  const base64 = (comma === -1 ? source : source.slice(comma + 1)).replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** A copy whose backing buffer is a plain ArrayBuffer, which Response accepts. */
function bodyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Attachment response. The caller has already checked that the viewer is a platform admin. */
export function apiDocumentationResponse(bytes: Uint8Array): Response {
  return new Response(bodyBuffer(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${API_DOC_FILENAME}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
