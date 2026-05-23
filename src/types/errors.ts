export type ErrorCode =
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "EXTERNAL_SERVICE_ERROR"
  | "TRANSIENT_EXTERNAL_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "SAFETY_VIOLATION"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    input?: {
      code?: ErrorCode;
      statusCode?: number;
      isOperational?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    }
  ) {
    super(message, input?.cause ? { cause: input.cause } : undefined);
    this.name = "AppError";
    this.code = input?.code ?? "INTERNAL_ERROR";
    this.statusCode = input?.statusCode ?? 500;
    this.isOperational = input?.isOperational ?? true;
    this.details = input?.details;
  }
}

export function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error) {
    return new AppError(error.message || fallbackMessage, {
      code: "INTERNAL_ERROR",
      statusCode: 500,
      cause: error
    });
  }
  return new AppError(fallbackMessage, {
    code: "INTERNAL_ERROR",
    statusCode: 500,
    details: { raw: String(error) }
  });
}
