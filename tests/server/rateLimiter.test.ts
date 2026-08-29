import { beforeEach, describe, expect, it } from "vitest";

import {
  checkRateLimit,
  getClientIp,
  maskApiKey,
  resetRateLimits,
  validatePayloadSize,
} from "@/lib/server/rateLimiter";

describe("rateLimiter", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows requests under the limit", () => {
    const r1 = checkRateLimit("127.0.0.1", 3, 1000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit("127.0.0.1", 3, 1000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit("127.0.0.1", 3, 1000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests over the limit", () => {
    checkRateLimit("client-a", 2, 1000);
    checkRateLimit("client-a", 2, 1000);

    const blocked = checkRateLimit("client-a", 2, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after window expires", () => {
    const now = 10_000;
    checkRateLimit("client-b", 1, 1000, now);
    const blocked = checkRateLimit("client-b", 1, 1000, now);
    expect(blocked.allowed).toBe(false);

    const allowedAfterExpiry = checkRateLimit(
      "client-b",
      1,
      1000,
      now + 1500,
    );
    expect(allowedAfterExpiry.allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("extracts from x-forwarded-for header", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" },
    });
    expect(getClientIp(req)).toBe("203.0.113.195");
  });

  it("extracts from x-real-ip header", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "198.51.100.17" },
    });
    expect(getClientIp(req)).toBe("198.51.100.17");
  });

  it("falls back to 127.0.0.1 when headers missing", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("127.0.0.1");
  });
});

describe("maskApiKey", () => {
  it("masks long API keys safely", () => {
    expect(maskApiKey("AIzaSyB1234567890abcdef")).toBe("AIzaSy...cdef");
  });

  it("masks short keys", () => {
    expect(maskApiKey("12345")).toBe("****");
  });

  it("handles empty / null keys", () => {
    expect(maskApiKey(null)).toBe("[none]");
    expect(maskApiKey("")).toBe("[none]");
  });
});

describe("validatePayloadSize", () => {
  it("accepts payloads under size limit", () => {
    expect(validatePayloadSize("abcd", 100)).toBe(true);
    expect(validatePayloadSize(null)).toBe(true);
  });

  it("rejects oversized base64 payloads", () => {
    const large = "A".repeat(1000);
    expect(validatePayloadSize(large, 500)).toBe(false);
  });
});
