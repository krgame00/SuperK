import crypto from "node:crypto";

import { NextResponse } from "next/server";

let cachedToken: string | null = null;

export function getOrCreatePairingToken(): string {
  if (process.env.SUPERK_PAIRING_TOKEN) {
    return process.env.SUPERK_PAIRING_TOKEN.trim();
  }
  if (!cachedToken) {
    cachedToken = crypto.randomUUID();
  }
  return cachedToken;
}

export function verifyPairingToken(token: string | null | undefined): boolean {
  if (!token || typeof token !== "string") return false;
  const expected = getOrCreatePairingToken();
  const trimmed = token.trim();
  if (trimmed.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(trimmed), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function extractPairingToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const headerToken = request.headers.get("x-superk-pairing-token");
  if (headerToken) return headerToken.trim();
  return null;
}

// Returns a 401 response when the request lacks a valid pairing token, or
// null when it is authenticated. Pass CORS headers via errorHeaders so
// extension callers can still read the 401.
export function requirePairingAuth(
  request: Request,
  errorHeaders?: Record<string, string>,
): NextResponse | null {
  if (verifyPairingToken(extractPairingToken(request))) return null;
  return NextResponse.json(
    { error: "Unauthorized: Invalid or missing pairing token" },
    { status: 401, headers: errorHeaders },
  );
}

export function _resetPairingTokenForTest(token?: string | null) {
  cachedToken = token === undefined ? null : token;
}
