import { NextRequest, NextResponse } from "next/server";
import { getOrCreatePairingToken } from "@/lib/server/pairing";

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isAuthorizedPairingOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || "";
  const hostName = host.split(":")[0];

  if (!origin) {
    // If no Origin header, only permit if Host or request URL is loopback
    if (isLoopbackHostname(hostName)) {
      return true;
    }
    try {
      const reqUrl = new URL(request.url);
      if (isLoopbackHostname(reqUrl.hostname)) {
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  try {
    const originUrl = new URL(origin);
    // Only the app page's own origin, as served by this listener: the origin
    // host must equal the request Host header and be a loopback hostname. A
    // DNS-rebound public domain points at 127.0.0.1 but keeps its hostname,
    // so requiring the loopback hostname here defeats reading the token.
    return (
      host !== "" &&
      originUrl.host === host &&
      isLoopbackHostname(originUrl.hostname)
    );
  } catch {
    return false;
  }

  return false;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedPairingOrigin(request)) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  const token = getOrCreatePairingToken();
  return NextResponse.json({
    success: true,
    pairingToken: token,
  });
}
