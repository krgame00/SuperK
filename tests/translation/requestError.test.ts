import { describe, expect, it, test } from "vitest";

import {
  getAbortReason,
  getTranslationRetryDelay,
  isExplicitUserCancelError,
  isIntentionalAbortInterruption,
  isSilentAbortError,
  isUserCancelledError,
  normalizeTranslationErrorCode,
  readTranslationResponse,
  shouldAutoRetryTranslation,
  TRANSLATION_ABORT_REASON,
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

test("structured route cooldown preserves retry timing and selected model", async () => {
  const response = Response.json(
    {
      error: "cooling down",
      code: "GEMINI_ROUTE_COOLDOWN",
      retryable: true,
      retryAfterMs: 12_000,
      nextRetryAt: 42_000,
      model: "gemini-a",
    },
    { status: 503 },
  );

  await expect(readTranslationResponse(response)).rejects.toMatchObject({
    code: "GEMINI_ROUTE_COOLDOWN",
    retryAfterMs: 12_000,
    nextRetryAt: 42_000,
    model: "gemini-a",
  });
});

test("streamed translation reports model switches before its final payload", async () => {
  const encoder = new TextEncoder();
  let releaseFinal!: () => void;
  const finalGate = new Promise<void>((resolve) => { releaseFinal = resolve; });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode('{"type":"model-switch","model":"gemini-next","fallbackCount":1}\n'));
      await finalGate;
      controller.enqueue(encoder.encode('{"type":"result","status":200,"data":{"text":"ok"}}\n'));
      controller.close();
    },
  });
  const events: string[] = [];
  const result = readTranslationResponse<{ text: string }>(
    new Response(stream, { headers: { "content-type": "application/x-ndjson" } }),
    (event) => events.push(event.model),
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(events).toEqual(["gemini-next"]);
  releaseFinal();
  await expect(result).resolves.toEqual({ text: "ok" });
});

test("streamed final routing errors keep their actionable status and retry timing", async () => {
  const response = new Response(
    '{"type":"model-switch","model":"gemini-next","fallbackCount":1}\n' +
      '{"type":"result","status":503,"data":{"error":"cooling down","code":"GEMINI_ROUTE_COOLDOWN","retryAfterMs":12000}}\n',
    { headers: { "content-type": "application/x-ndjson" } },
  );
  await expect(readTranslationResponse(response)).rejects.toMatchObject({
    message: "cooling down",
    status: 503,
    code: "GEMINI_ROUTE_COOLDOWN",
    retryAfterMs: 12_000,
  });
});

test("an interrupted translation stream is a retryable network error", async () => {
  const response = new Response(
    '{"type":"model-switch","model":"gemini-next","fallbackCount":1}\n',
    { headers: { "content-type": "application/x-ndjson" } },
  );
  await expect(readTranslationResponse(response)).rejects.toMatchObject({
    category: "network",
    retryable: true,
    status: 0,
  });
});

test("automatic retry is limited to one extra network attempt", () => {
  const network = new TranslationRequestError(
    "network",
    502,
    "NETWORK_ERROR",
    true,
  );
  const timeout = new TranslationRequestError(
    "timeout",
    504,
    "GEMINI_TIMEOUT",
    true,
  );

  expect(shouldAutoRetryTranslation(network, 0)).toBe(true);
  expect(shouldAutoRetryTranslation(network, 1)).toBe(false);
  expect(shouldAutoRetryTranslation(timeout, 0)).toBe(false);
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

  it("identifies an explicit abort reason string as user cancelled (loop control)", () => {
    expect(isUserCancelledError(TRANSLATION_ABORT_REASON.userCancel)).toBe(true);
  });
});

describe("abort reason taxonomy (P0-5)", () => {
  it("does not treat a bare AbortError as a silent abort", () => {
    const err = new DOMException("The user aborted a request.", "AbortError");
    expect(isSilentAbortError(err)).toBe(false);
    expect(isExplicitUserCancelError(err)).toBe(false);
    expect(getAbortReason(err)).toBeNull();
  });

  it("does not treat a bare AbortError as silent when the signal aborted without a known reason", () => {
    const controller = new AbortController();
    controller.abort();
    const err = new DOMException("Aborted", "AbortError");
    expect(isSilentAbortError(err, controller.signal)).toBe(false);
    expect(isExplicitUserCancelError(err, controller.signal)).toBe(false);
  });

  it("recognises the user-cancel reason when it is thrown as the error itself", () => {
    expect(isExplicitUserCancelError(TRANSLATION_ABORT_REASON.userCancel)).toBe(true);
    expect(isSilentAbortError(TRANSLATION_ABORT_REASON.userCancel)).toBe(true);
  });

  it("recognises the user-cancel reason carried by the signal", () => {
    const signal = {
      aborted: true,
      reason: TRANSLATION_ABORT_REASON.userCancel,
    } as AbortSignal;
    expect(isExplicitUserCancelError(new Error("fetch failed"), signal)).toBe(true);
    expect(getAbortReason(new Error("fetch failed"), signal)).toBe(
      TRANSLATION_ABORT_REASON.userCancel,
    );
  });

  it("treats unmount, quota, and batch-complete aborts as silent but not user cancels", () => {
    for (const reason of [
      TRANSLATION_ABORT_REASON.unmount,
      TRANSLATION_ABORT_REASON.quota,
      TRANSLATION_ABORT_REASON.batchComplete,
    ]) {
      expect(isSilentAbortError(reason)).toBe(true);
      expect(isExplicitUserCancelError(reason)).toBe(false);
    }
  });

  it("treats TranslationRequestError with cancelled code as an explicit user cancel", () => {
    const err = new TranslationRequestError("cancelled", 0, "cancelled");
    expect(isExplicitUserCancelError(err)).toBe(true);
    expect(isSilentAbortError(err)).toBe(true);
  });

  it("does not treat a server REQUEST_ABORTED error as a cancel", () => {
    const err = new TranslationRequestError(
      "Translation request was aborted",
      499,
      "REQUEST_ABORTED",
    );
    expect(isSilentAbortError(err)).toBe(false);
    expect(isExplicitUserCancelError(err)).toBe(false);
  });

  it("returns no reason for unrelated errors", () => {
    expect(getAbortReason(new Error("boom"))).toBeNull();
    expect(isSilentAbortError(new Error("boom"))).toBe(false);
  });

  it("distinguishes the failure that caused a quota stop from bystander interruptions", () => {
    const quotaSignal = {
      aborted: true,
      reason: TRANSLATION_ABORT_REASON.quota,
    } as AbortSignal;
    // The page that hit quota produced a real request error: not an interruption.
    const quotaError = new TranslationRequestError("quota", 429, "GEMINI_QUOTA");
    expect(isIntentionalAbortInterruption(quotaError, quotaSignal)).toBe(false);
    // Bystander pages aborted BY the stop: interruptions, in both shapes.
    expect(
      isIntentionalAbortInterruption(TRANSLATION_ABORT_REASON.quota, quotaSignal),
    ).toBe(true);
    expect(
      isIntentionalAbortInterruption(
        new DOMException("Aborted", "AbortError"),
        quotaSignal,
      ),
    ).toBe(true);
    // A bare AbortError with no known reason anywhere: not intentional.
    const bareSignal = { aborted: true, reason: new DOMException("Aborted", "AbortError") } as unknown as AbortSignal;
    expect(
      isIntentionalAbortInterruption(new DOMException("Aborted", "AbortError"), bareSignal),
    ).toBe(false);
  });
});
