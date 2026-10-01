const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/** Reject web-triggered local work before reading or forwarding the body. */
export function requireLocalRequest(request: Request): Response | null {
  let localTarget = false;
  try {
    const host = request.headers.get("host");
    const target = host ? new URL(`http://${host}`) : new URL(request.url);
    localTarget = isLoopback(target.hostname);
  } catch {
    // A malformed Host is not a local target.
  }
  const origin = request.headers.get("origin");
  if (localTarget && !origin) return null;
  if (localTarget && origin) {
    try {
      const parsed = new URL(origin);
      if (
        ((parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopback(parsed.hostname)) ||
        ((parsed.protocol === "chrome-extension:" || parsed.protocol === "moz-extension:") && !!parsed.hostname)
      ) return null;
    } catch {
      // Opaque and malformed origins are denied.
    }
  }
  return Response.json({ detail: "Forbidden origin: local access only." }, {
    status: 403, headers: { "cache-control": "no-store" },
  });
}
