import { handlePlatformApi } from "@/lib/platform-api";
import { platformApiStore } from "@/lib/platform-api-server";

export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "no-store" };

async function respond(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const result = await handlePlatformApi({
    method: request.method,
    pathname: url.pathname,
    authorization: request.headers.get("authorization"),
    search: url.searchParams,
    store: platformApiStore(),
  });
  return Response.json(result.body, { status: result.status, headers: HEADERS });
}

export const GET = respond;
export const POST = respond;
export const PUT = respond;
export const PATCH = respond;
export const DELETE = respond;
