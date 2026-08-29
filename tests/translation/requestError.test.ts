import { describe, expect, it, test } from "vitest";

import {
  getTranslationRetryDelay,
  isUserCancelledError,
  normalizeTranslationErrorCode,
  readTranslationResponse,
  TranslationRequestError,
} from "@/lib/translation/requestError";

test("structured timeout retains code and retryability", async () => {
  const response = Response.json(
    {
      error: "Gemini timeout",
      code: "GEMINI_TIMEOUT",
      retryable: true,
    },
    { status: 504 },
  );

  const operation = readTranslationResponse(response);

  await expect(operation).rejects.toMatchObject({
    message: "Gemini timeout",
    code: "GEMINI_TIMEOUT",
    category: "timeout",
    retryable: true,
    status: 504,
  });
  await expect(operation).rejects.toBeInstanceOf(TranslationRequestError);
});

test("legacy error responses still preserve the message", async () => {
  const response = Response.json(
    { error: "legacy error" },
    { status: 500 },
  );

  await expect(readTranslationResponse(response)).rejects.toMatchObject({
    message: "legacy error",
    category: "upstream",
    retryable: false,
    status: 500,
  });
});

test("successful responses retain their typed payload", async () => {
  const response = Response.json({ text: '{"bubbles":[]}' });

  await expect(
    readTranslationResponse<{ text: string }>(response),
  ).resolves.toEqual({
    text: '{"bubbles":[]}',
  });
});

test("quota errors use the long retry delay", () => {
  const error = new TranslationRequestError(
    "quota",
    429,
    "GEMINI_QUOTA",
    true,
  );

  expect(getTranslationRetryDelay(error)).toBe(60_000);
});

test("retryable timeout errors use the short retry delay", () => {
  const error = new TranslationRequestError(
    "timeout",
    504,
    "GEMINI_TIMEOUT",
    true,
  );

  expect(getTranslationRetryDelay(error)).toBe(5_000);
});

test("non-retryable errors do not retry", () => {
  const error = new TranslationRequestError(
    "invalid request",
    400,
    "GEMINI_UPSTREAM",
    false,
  );

  expect(getTranslationRetryDelay(error)).toBeNull();
});

describe("normalizeTranslationErrorCode", () => {
  it("normalizes HTTP status codes to standardized error taxonomy", () => {
    expect(normalizeTranslationErrorCode(429)).toBe("quota");
    expect(normalizeTranslationErrorCode(504)).toBe("timeout");
    expect(normalizeTranslationErrorCode(401)).toBe("auth");
    expect(normalizeTranslationErrorCode(404)).toBe("model_unavailable");
    expect(normalizeTranslationErrorCode(413)).toBe("bad_request");
    expect(normalizeTranslationErrorCode(500)).toBe("upstream");
  });

  it("normalizes string error codes and keywords", () => {
    expect(normalizeTranslationErrorCode("GEMINI_TIMEOUT")).toBe("timeout");
    expect(normalizeTranslationErrorCode("GEMINI_QUOTA")).toBe("quota");
    expect(normalizeTranslationErrorCode("SAFETY_VIOLATION")).toBe("safety");
    expect(normalizeTranslationErrorCode("NETWORK_ERROR")).toBe("network");
    expect(normalizeTranslationErrorCode("USER_CANCELLED")).toBe("cancelled");
  });
});

describe("isUserCancelledError", () => {
  it("identifies AbortError DOMException as user cancelled", () => {
    const err = new DOMException("Aborted", "AbortError");
    expect(isUserCancelledError(err)).toBe(true);
  });

  it("identifies TranslationRequestError with category cancelled", () => {
    const err = new TranslationRequestError("cancelled", 0, "cancelled");
    expect(isUserCancelledError(err)).toBe(true);
  });

  it("returns false for ordinary runtime errors", () => {
    expect(isUserCancelledError(new Error("Network failed"))).toBe(false);
  });
});
