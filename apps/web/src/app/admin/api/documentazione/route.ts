import { apiDocumentationResponse, isPdf, pdfBytesFromModule } from "@/lib/api-doc";
import { apiDocumentationPdfBase64 } from "@/lib/api-doc-pdf.gen";
import { requirePlatformAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

const UNAVAILABLE = "Documentazione non disponibile.";

/**
 * Download of the programmer PDF. Platform admins only: the same check as /admin/api.
 * The file is the generated module from scripts/build-api-pdf.py, so the worker has the
 * bytes without reading a path at runtime. It contains no keys.
 */
export async function GET(): Promise<Response> {
  await requirePlatformAdmin();
  const bytes = pdfBytesFromModule(apiDocumentationPdfBase64);
  if (!isPdf(bytes)) {
    console.error("[admin/api] documentation payload is not a PDF");
    return new Response(UNAVAILABLE, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return apiDocumentationResponse(bytes);
}
