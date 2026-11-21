import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_DOC_FILENAME,
  API_DOC_HREF,
  apiDocumentationResponse,
  isPdf,
  pdfBytesFromModule,
} from "../src/lib/api-doc";
import { apiDocumentationPdfBase64 } from "../src/lib/api-doc-pdf.gen";

const root = fileURLToPath(new URL("../../..", import.meta.url));

vi.mock("@/lib/session", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ supabase: {}, session: { user: { id: "admin" } } })),
}));

describe("api documentation download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves the bytes as a pdf attachment", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const response = apiDocumentationResponse(bytes);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${API_DOC_FILENAME}"`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(isPdf(bytes)).toBe(true);
    expect(isPdf(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false);
  });

  it("decodes a data url, including a zero byte", () => {
    const raw = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    const source = `data:application/pdf;base64,${Buffer.from(raw).toString("base64")}`;
    expect(pdfBytesFromModule(source)).toEqual(raw);
  });

  it("embeds the same pdf the generator writes, and the admin page links to it", () => {
    const onDisk = readFileSync(join(root, "docs/api", API_DOC_FILENAME));
    const embedded = pdfBytesFromModule(apiDocumentationPdfBase64);
    expect(isPdf(embedded)).toBe(true);
    expect(Buffer.from(embedded).equals(onDisk)).toBe(true);
    expect(onDisk.length).toBeGreaterThan(50_000);
    const page = readFileSync(join(root, "apps/web/src/app/admin/api/page.tsx"), "utf8");
    expect(page).toContain("API_DOC_HREF");
    expect(page).toContain("Scarica la documentazione (PDF)");
    expect(API_DOC_HREF).toBe("/admin/api/documentazione");
  });

  it("returns the pdf only after the platform-admin check", async () => {
    const { requirePlatformAdmin } = await import("@/lib/session");
    const { GET } = await import("../src/app/admin/api/documentazione/route");
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error("REDIRECT /accedi"));
    await expect(GET()).rejects.toThrow("REDIRECT /accedi");

    const response = await GET();
    expect(requirePlatformAdmin).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(isPdf(body)).toBe(true);
    expect(body.length).toBeGreaterThan(50_000);
  });
});
