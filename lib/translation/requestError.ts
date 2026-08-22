interface TranslationErrorBody {
  error?: string;
  code?: string;
  retryable?: boolean;
}

export class TranslationRequestError extends Error {
  readonly code?: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    message: string,
    status: number,
    code?: string,
    retryable = false,
  ) {
    super(message);
    this.name = "TranslationRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export async function readTranslationResponse<T>(
  response: Response,
): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    const error = data as TranslationErrorBody;
    throw new TranslationRequestError(
      error.error || `Translation request failed (${response.status})`,
      response.status,
      error.code,
      error.retryable === true,
    );
  }
  return data as T;
}

export function getTranslationRetryDelay(
  error: unknown,
  attempt: number = 0,
): number | null {
  if (
    !(error instanceof TranslationRequestError)
    || !error.retryable
  ) {
    return null;
  }
  if (error.code === "GEMINI_QUOTA") {
    return 60_000;
  }
  if (error.code === "GEMINI_TIMEOUT") {
    return 5_000;
  }
  return Math.min(30_000, 2000 * Math.pow(2, attempt));
}