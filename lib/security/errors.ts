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

function isPrismaError(error: unknown): error is Error & { name: string; code?: string } {
  return error instanceof Error && error.name.startsWith("PrismaClient");
}

function prismaReasonCode(error: Error & { code?: string; meta?: { target?: string[] } }): string {
  const msg = error.message;
  if (msg.includes("Can't reach database server") || error.name === "PrismaClientInitializationError") {
    return "DB_CONNECTION_FAILED";
  }
  if (error.code === "P2021" || msg.includes("does not exist")) {
    return "PRISMA_SCHEMA_NOT_PUSHED";
  }
  if (error.code === "P1001") {
    return "DB_CONNECTION_FAILED";
  }
  if (error.code === "P2002") {
    return "UNIQUE_CONSTRAINT_FAILED";
  }
  return "DATABASE_WRITE_FAILED";
}

function safePrismaMessage(error: Error & { code?: string }): string {
  if (error.message.includes("Can't reach database server")) {
    return "Database connection failed — check DATABASE_URL and restart the dev server after changing .env";
  }
  if (error.message.includes("does not exist") || error.code === "P2021") {
    return "Database write failed — run: npm run db:push";
  }
  if (error.code === "P2002") {
    return "A credential with this label already exists for your account";
  }
  if (error.message.includes("sslmode") || error.message.includes("SSL")) {
    return "Supabase connection requires sslmode=require in DATABASE_URL";
  }
  return "Database write failed — run npm run db:push and restart the dev server";
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

  if (isPrismaError(error)) {
    const reasonCode = prismaReasonCode(error);
    return {
      error: {
        code: "DATABASE_ERROR",
        message: safePrismaMessage(error),
        reasonCode,
      },
      statusCode: reasonCode === "UNIQUE_CONSTRAINT_FAILED" ? 409 : 503,
    };
  }

  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      reasonCode: "UNKNOWN_VAULT_SAVE_ERROR",
    },
    statusCode: 500,
  };
}

export function apiErrorJson(error: unknown): { body: { error: ReturnType<typeof toErrorResponse>["error"] }; statusCode: number } {
  const { error: errBody, statusCode } = toErrorResponse(error);
  return { body: { error: errBody }, statusCode };
}
