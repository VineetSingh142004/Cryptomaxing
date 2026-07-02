export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "NOT_IMPLEMENTED"
  | "AUTO_EXECUTION_BLOCKED"
  | "MODE_CHANGE_BLOCKED"
  | "DATABASE_ERROR";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly reasonCode?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      reasonCode?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.statusCode = options?.statusCode ?? statusCodeFor(code);
    this.reasonCode = options?.reasonCode;
    this.details = options?.details;
  }
}

function statusCodeFor(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "AUTO_EXECUTION_BLOCKED":
    case "MODE_CHANGE_BLOCKED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "NOT_IMPLEMENTED":
      return 501;
    default:
      return 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toErrorResponse(error: unknown): {
  error: {
    code: string;
    message: string;
    reasonCode?: string;
    details?: Record<string, unknown>;
  };
  statusCode: number;
} {
  if (isAppError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        reasonCode: error.reasonCode,
        details: error.details,
      },
      statusCode: error.statusCode,
    };
  }

  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
    statusCode: 500,
  };
}
