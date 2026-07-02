/** Safe client-side parser for API error JSON bodies */

export interface ApiErrorInfo {
  reasonCode: string;
  message: string;
  httpStatus: number;
}

export async function parseApiError(response: Response): Promise<ApiErrorInfo> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      reasonCode: "API_ROUTE_FAILED",
      message: `HTTP ${response.status}: request failed`,
      httpStatus: response.status,
    };
  }

  const nested = body.error as Record<string, unknown> | undefined;
  const code = String(nested?.reasonCode ?? body.reasonCode ?? "API_ROUTE_FAILED");
  const message = String(
    nested?.message ?? body.message ?? `HTTP ${response.status}: request failed`,
  );

  return { reasonCode: code, message, httpStatus: response.status };
}

export function formatApiError(info: ApiErrorInfo, context: string): string {
  return `${context}: [${info.reasonCode}] ${info.message}`;
}
