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

export function getTranslationRetryDelay(error: unknown): number | null {
  if (
    !(error instanceof TranslationRequestError)
    || !error.retryable
  ) {
    return null;
  }
  return error.code === "GEMINI_QUOTA" ? 60_000 : 5_000;
}
