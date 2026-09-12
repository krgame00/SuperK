import { describe, expect, it } from "vitest";
import {
  classifyTranslationError,
  DIAGNOSTIC_TAXONOMY,
} from "../../lib/translation/diagnostics";
import { parseRetryAfter } from "../../lib/translation/requestError";

describe("Translation Failure Diagnostics Taxonomy", () => {
  it("classifies missing API key correctly", () => {
    const res = classifyTranslationError(
      new Error("Server missing API Key. Please add GEMINI_API_KEY to .env or enter your own in Settings"),
      500
    );
    expect(res.code).toBe("MISSING_KEY");
    expect(res.recommendedAction).toBe("open_settings_api_key");
    expect(res.retryable).toBe(false);
  });

  it("classifies safety/nsfw filter block correctly", () => {
    const res = classifyTranslationError(
      new Error("เนื้อหาถูกแบนโดยระบบ Safety ของ AI"),
      400,
      "SAFETY_BLOCKED"
    );
    expect(res.code).toBe("SAFETY_BLOCKED");
    expect(res.recommendedAction).toBe("enable_nsfw_bypass");
    expect(res.retryable).toBe(true);
  });

  it("classifies 429 quota exhaustion correctly", () => {
    const res = classifyTranslationError(
      new Error("Resource exhausted: Rate limit exceeded"),
      429,
      "GEMINI_QUOTA"
    );
    expect(res.code).toBe("QUOTA_EXHAUSTED");
    expect(res.recommendedAction).toBe("retry_cooldown");
    expect(res.retryable).toBe(true);
  });

  it("classifies local sidecar cleaner offline correctly", () => {
    const res = classifyTranslationError(
      new Error("connect ECONNREFUSED 127.0.0.1:8765")
    );
    expect(res.code).toBe("LOCAL_SIDECAR_OFFLINE");
    expect(res.recommendedAction).toBe("restart_cleaner");
  });

  it("classifies a reachable sidecar cleaner/model failure separately from offline", () => {
    const res = classifyTranslationError(
      new Error("LamaLarge model inference failed"),
      500,
      "LOCAL_CLEANER_FAILED",
    );
    expect(res.code).toBe("LOCAL_CLEANER_FAILED");
    expect(res.recommendedAction).toBe("retry_failed");
  });

  it("classifies timeout or network failure correctly", () => {
    const res = classifyTranslationError(
      new Error("Gemini ตอบสนองช้าเกินกำหนด กรุณาลองใหม่หรือเปลี่ยนโมเดล"),
      504
    );
    expect(res.code).toBe("NETWORK_OR_TIMEOUT");
    expect(res.recommendedAction).toBe("retry_failed");
  });

  it("classifies malformed AI payloads as provider response failures instead of unknown", () => {
    const res = classifyTranslationError(
      new Error("Translation response malformed: invalid JSON."),
      502,
      "PROVIDER_RESPONSE_INVALID",
    );
    expect(res.code).toBe("PROVIDER_RESPONSE_INVALID");
    expect(res.recommendedAction).toBe("retry_failed");
    expect(res.retryable).toBe(true);
  });

  it("classifies translation image loading failures instead of unknown", () => {
    const res = classifyTranslationError(new Error("โหลดรูปภาพไม่สำเร็จ"));
    expect(res.code).toBe("IMAGE_LOAD_FAILED");
    expect(res.recommendedAction).toBe("retry_failed");
  });

  it("classifies upstream and transport failures instead of unknown", () => {
    expect(
      classifyTranslationError(
        new Error("Bad Gateway"),
        503,
        "GEMINI_UPSTREAM",
      ).code,
    ).toBe("NETWORK_OR_TIMEOUT");
    expect(
      classifyTranslationError(
        new Error("Network error"),
        0,
        "NETWORK",
      ).code,
    ).toBe("NETWORK_OR_TIMEOUT");
    expect(
      classifyTranslationError(new Error("Internal Server Error"), 500).code,
    ).toBe("NETWORK_OR_TIMEOUT");
  });

  it("keeps auth precedence when Gemini reports a generic upstream code with 403", () => {
    const res = classifyTranslationError(
      new Error("Permission denied"),
      403,
      "GEMINI_UPSTREAM",
    );
    expect(res.code).toBe("MISSING_KEY");
    expect(res.recommendedAction).toBe("open_settings_api_key");
  });

  it("classifies page awaiting review / 422 cleaning verification as CLEANING_REVIEW_REQUIRED", () => {
    const res1 = classifyTranslationError(
      new Error("Page awaiting review after local cleaning verification."),
      422,
      "CLEANING_REVIEW_REQUIRED",
    );
    expect(res1.code).toBe("CLEANING_REVIEW_REQUIRED");
    expect(res1.recommendedAction).toBe("retry_failed");
    expect(res1.actionLabel).toBe("ยืนยันและดำเนินการแปลต่อ");
    expect(res1.retryable).toBe(true);

    const res2 = classifyTranslationError(
      new Error("Page awaiting review after local cleaning verification."),
      422,
    );
    expect(res2.code).toBe("CLEANING_REVIEW_REQUIRED");
  });

  it("normalizes Retry-After seconds, dates, malformed values, and caps", () => {
    expect(parseRetryAfter("12", 0)).toBe(12_000);
    expect(parseRetryAfter(new Date(90_000).toUTCString(), 0)).toBe(90_000);
    expect(parseRetryAfter("not-a-date", 0)).toBe(60_000);
    expect(parseRetryAfter("   ", 0)).toBe(60_000);
    expect(parseRetryAfter("-1", 0)).toBe(60_000);
    expect(parseRetryAfter(new Date(-1_000).toUTCString(), 0)).toBe(60_000);
    expect(parseRetryAfter("999999", 0)).toBe(15 * 60_000);
  });
});
