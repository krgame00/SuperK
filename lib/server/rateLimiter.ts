// Server-side security and rate limiting helper

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Clean up stale rate limit records periodically
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanupStaleRecords(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export function checkRateLimit(
  identifier: string,
  limit = 60,
  windowMs = 60_000,
  now = Date.now(),
): RateLimitResult {
  cleanupStaleRecords();

  const record = rateLimitStore.get(identifier);

  if (!record || record.resetAt <= now) {
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetMs: windowMs,
    };
  }

  if (record.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetMs: Math.max(0, record.resetAt - now),
    };
  }

  record.count += 1;
  return {
    allowed: true,
    limit,
    remaining: limit - record.count,
    resetMs: Math.max(0, record.resetAt - now),
  };
}

export function resetRateLimits(): void {
  rateLimitStore.clear();
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",");
    if (ips[0]) return ips[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

export function maskApiKey(key?: string | null): string {
  if (!key) return "[none]";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export function validatePayloadSize(
  base64String?: string | null,
  maxBytes = 25 * 1024 * 1024, // 25MB default max
): boolean {
  if (!base64String) return true;
  // Approximate decoded byte size from base64 length
  const approxBytes = Math.ceil((base64String.length * 3) / 4);
  return approxBytes <= maxBytes;
}
