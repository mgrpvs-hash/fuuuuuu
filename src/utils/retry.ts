import { AppError } from "../types/errors.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(input: {
  attempts: number;
  minDelayMs: number;
  maxDelayMs: number;
  operationName: string;
  operation: (attempt: number) => Promise<T>;
  shouldRetry: (error: unknown) => boolean;
}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= input.attempts; attempt += 1) {
    try {
      return await input.operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= input.attempts || !input.shouldRetry(error)) {
        break;
      }
      const delay = Math.min(input.minDelayMs * 2 ** (attempt - 1), input.maxDelayMs);
      await sleep(delay);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new AppError(`Operation failed: ${input.operationName}`, {
    code: "INTERNAL_ERROR",
    details: { reason: String(lastError) }
  });
}
