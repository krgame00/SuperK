import crypto from "node:crypto";

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

export function _resetPairingTokenForTest(token?: string | null) {
  cachedToken = token === undefined ? null : token;
}
