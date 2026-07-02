/** User authentication is NOT implemented — system user only */

export const AUTH_STATUS = "AUTH_NOT_IMPLEMENTED" as const;

export function isAuthImplemented(): boolean {
  return false;
}

export function getAuthStatus(): {
  implemented: boolean;
  status: typeof AUTH_STATUS | "AUTH_READY";
  message: string;
} {
  if (isAuthImplemented()) {
    return {
      implemented: true,
      status: "AUTH_READY",
      message: "Authentication enabled",
    };
  }
  return {
    implemented: false,
    status: AUTH_STATUS,
    message:
      "No user login — API vault writes and live trading require authentication before production use",
  };
}
