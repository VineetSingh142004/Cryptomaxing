export type KrakenFetchReasonCode =
  | "KRAKEN_TIMEOUT"
  | "KRAKEN_RATE_LIMITED"
  | "KRAKEN_NETWORK_FAILED"
  | "KRAKEN_INVALID_RESPONSE"
  | "KRAKEN_UNAVAILABLE";

export class KrakenFetchError extends Error {
  readonly endpoint: string;
  readonly reasonCode: KrakenFetchReasonCode;
  readonly httpStatus: number | null;
  readonly latencyMs: number;

  constructor(input: {
    endpoint: string;
    reasonCode: KrakenFetchReasonCode;
    message: string;
    httpStatus?: number | null;
    latencyMs?: number;
    cause?: unknown;
  }) {
    super(input.message, input.cause ? { cause: input.cause } : undefined);
    this.name = "KrakenFetchError";
    this.endpoint = input.endpoint;
    this.reasonCode = input.reasonCode;
    this.httpStatus = input.httpStatus ?? null;
    this.latencyMs = input.latencyMs ?? 0;
  }
}

function classifyFetchFailure(
  err: unknown,
  httpStatus: number | null,
): KrakenFetchReasonCode {
  if (httpStatus === 429) return "KRAKEN_RATE_LIMITED";
  if (err instanceof Error && err.name === "AbortError") return "KRAKEN_TIMEOUT";
  if (httpStatus !== null && httpStatus >= 400) return "KRAKEN_INVALID_RESPONSE";
  if (
    err instanceof TypeError ||
    (err instanceof Error &&
      /fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|abort/i.test(err.message))
  ) {
    return "KRAKEN_NETWORK_FAILED";
  }
  return "KRAKEN_UNAVAILABLE";
}

export async function resilientKrakenFetch<T>(input: {
  url: string;
  endpoint: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
}): Promise<{ data: T; latencyMs: number; attempts: number }> {
  const timeoutMs = input.timeoutMs ?? 10_000;
  const maxAttempts = input.maxAttempts ?? 2;
  const backoffMs = input.backoffMs ?? 400;
  let lastError: unknown;
  let totalLatency = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let httpStatus: number | null = null;

    try {
      const res = await fetch(input.url, { signal: controller.signal });
      httpStatus = res.status;
      totalLatency += Date.now() - start;

      if (!res.ok) {
        const reasonCode = classifyFetchFailure(null, httpStatus);
        throw new KrakenFetchError({
          endpoint: input.endpoint,
          reasonCode,
          message: `${input.endpoint}: HTTP ${httpStatus}`,
          httpStatus,
          latencyMs: totalLatency,
        });
      }

      const json = (await res.json()) as { error?: string[]; result?: T };
      if (json.error?.length) {
        throw new KrakenFetchError({
          endpoint: input.endpoint,
          reasonCode: "KRAKEN_INVALID_RESPONSE",
          message: `${input.endpoint}: ${json.error.join(", ")}`,
          httpStatus,
          latencyMs: totalLatency,
        });
      }

      return { data: json.result as T, latencyMs: totalLatency, attempts: attempt };
    } catch (err) {
      lastError = err;
      totalLatency += Date.now() - start;
      if (err instanceof KrakenFetchError) {
        if (attempt < maxAttempts && err.reasonCode !== "KRAKEN_INVALID_RESPONSE") {
          await new Promise((r) => setTimeout(r, backoffMs * attempt));
          continue;
        }
        throw err;
      }

      const reasonCode = classifyFetchFailure(err, httpStatus);
      if (attempt < maxAttempts && reasonCode !== "KRAKEN_INVALID_RESPONSE") {
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
        continue;
      }

      throw new KrakenFetchError({
        endpoint: input.endpoint,
        reasonCode,
        message: `${input.endpoint}: ${err instanceof Error ? err.message : "fetch failed"}`,
        httpStatus,
        latencyMs: totalLatency,
        cause: err,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new KrakenFetchError({
    endpoint: input.endpoint,
    reasonCode: "KRAKEN_UNAVAILABLE",
    message: `${input.endpoint}: ${lastError instanceof Error ? lastError.message : "fetch failed"}`,
    latencyMs: totalLatency,
    cause: lastError,
  });
}

export function formatKrakenFetchError(err: unknown): string {
  if (err instanceof KrakenFetchError) {
    return `${err.reasonCode}: ${err.message}`;
  }
  return err instanceof Error ? err.message : "Kraken fetch failed";
}
