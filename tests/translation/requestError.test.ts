import { expect, test } from "vitest";

import {
  getTranslationRetryDelay,
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
