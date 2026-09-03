const DEFAULT_CLEANER_URL = "http://127.0.0.1:8765";
export const MAX_PROXY_BODY_BYTES = 80 * 1024 * 1024;

interface CleanRouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(
  request: Request,
  context: CleanRouteContext,
): Promise<Response> {
  return forward(request, context, false);
}

export async function POST(
  request: Request,
  context: CleanRouteContext,
): Promise<Response> {
  return forward(request, context, true);
}

async function forward(
  request: Request,
  context: CleanRouteContext,
  includeBody: boolean,
): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    includeBody &&
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROXY_BODY_BYTES
  ) {
    return tooLarge();
  }

  const body = includeBody ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > MAX_PROXY_BODY_BYTES) return tooLarge();

  const { path } = await context.params;
  const encodedPath = path.map(encodeURIComponent).join("/");
  const base = (
    process.env.SUPERK_CLEANER_URL ?? DEFAULT_CLEANER_URL
  ).replace(/\/+$/, "");
  const target = new URL(`${base}/${encodedPath}`);
  target.search = new URL(request.url).search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const attempts = request.method === "GET" ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const upstream = await fetch(target.toString(), {
        method: request.method,
        headers,
        body,
        cache: "no-store",
      });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set("cache-control", "no-store");
      responseHeaders.delete("connection");
      responseHeaders.delete("transfer-encoding");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch {
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }

  return Response.json(
    {
      detail:
        "Local cleaning service is unavailable. Start it and try again.",
    },
    {
      status: 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

function tooLarge(): Response {
  return Response.json(
    { detail: "Image is too large. Maximum upload size is 80 MB." },
    { status: 413, headers: { "cache-control": "no-store" } },
  );
}
