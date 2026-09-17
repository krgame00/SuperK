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
    // Allow loopback origins
    if (isLoopbackHostname(originUrl.hostname)) {
      return true;
    }
    // Allow exact same host for self-hosted instances
    if (host && (originUrl.host === host || originUrl.hostname === hostName)) {
      return true;
    }
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
