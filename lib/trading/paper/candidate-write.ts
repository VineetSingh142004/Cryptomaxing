import { Prisma } from "@prisma/client";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import type { RiskTier } from "@/lib/trading/paper/scanner-config";
import { isPrismaStaleError } from "@/lib/trading/paper/prisma-health";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";
import { sanitizeChange24hPct } from "@/lib/trading/paper/field-sanitization";

const MAX_SYMBOL_LEN = 32;
const MAX_SOURCE_LEN = 64;
const MAX_REASON_CODE_LEN = 64;
const MAX_REASON_TEXT_LEN = 500;
const MAX_ACTION_LEN = 32;

/** Decimal(24, 12) — max 12 digits before the decimal point. */
export const DECIMAL_24_12_MAX = 999_999_999_999.999999;
/** Decimal(36, 12) — supports large market caps (e.g. BTC ~$2T). */
export const DECIMAL_36_12_MAX = 999_999_999_999_999_999_999_999_999_999.999999;
/** Decimal(12, 6) — max 6 digits before the decimal point. */
export const DECIMAL_12_6_MAX = 999_999.999999;

const VALID_RISK_TIERS = new Set<RiskTier>([
  "MAJOR",
  "ALT_LIQUID",
  "HIGH_VOLATILITY",
  "EXTREME_RISK",
]);
const VALID_ACTION_TYPES = new Set([
  "OPEN_PAPER_TRADE",
  "WATCHLIST_ONLY",
  "REJECTED",
  "SKIPPED",
]);

export interface CandidateWriteFailure {
  ok: false;
  reasonCode: "CANDIDATE_WRITE_FAILED" | "PRISMA_CLIENT_STALE";
  reasonText: string;
  displayMessage: string;
  fieldErrors: Record<string, string>;
  symbol: string;
}

export interface CandidateWriteSuccess {
  ok: true;
  data: Prisma.PaperScanCandidateCreateInput;
  fieldWarnings: Record<string, string>;
}

export type CandidateWriteResult = CandidateWriteSuccess | CandidateWriteFailure;

/** Strip Turbopack/Prisma boilerplate for dashboard display. */
export function sanitizeCandidateErrorMessage(msg: string): string {
  return msg
    .replace(/__TURBOPACK__imported__module__[^\s]+/g, "prisma")
    .replace(/Invalid `prisma\.[^`]+` invocation\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatCandidateWriteFailureForDisplay(input: {
  symbol: string;
  fieldErrors: Record<string, string>;
}): string {
  const entries = Object.entries(input.fieldErrors);
  if (entries.length > 0) {
    const [field, reason] = entries[0];
    return `CANDIDATE_WRITE_FAILED: ${input.symbol} candidate could not be stored because field ${field} was invalid: ${reason}.`;
  }
  return `CANDIDATE_WRITE_FAILED: ${input.symbol} candidate could not be stored.`;
}

function clampString(value: string, maxLen: number): string {
  return value.slice(0, maxLen);
}

function normalizeRiskTier(tier: string): RiskTier | null {
  const upper = tier.toUpperCase() as RiskTier;
  return VALID_RISK_TIERS.has(upper) ? upper : null;
}

function normalizeActionType(actionType: string): string {
  const upper = actionType.toUpperCase();
  if (VALID_ACTION_TYPES.has(upper)) return upper;
  return "SKIPPED";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Convert a finite number to a Prisma-safe Decimal string.
 * Returns null when non-finite or when abs(value) exceeds schema max (optional fields → null + warning).
 */
export function toSafeDecimalString(
  value: number | null | undefined,
  maxAbs: number,
  fractionDigits: number,
): { decimal: string | null; warning?: string } {
  if (value === null || value === undefined) {
    return { decimal: null };
  }
  if (!Number.isFinite(value)) {
    return { decimal: null, warning: "non-finite value coerced to null" };
  }
  if (Math.abs(value) > maxAbs) {
    return {
      decimal: null,
      warning: `value ${value} exceeds Decimal max ${maxAbs}, stored null`,
    };
  }
  const normalized = Number(value.toFixed(fractionDigits));
  if (!Number.isFinite(normalized)) {
    return { decimal: null, warning: "normalization failed, stored null" };
  }
  return { decimal: normalized.toString() };
}

function parsePrismaFieldErrors(msg: string): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  const clean = sanitizeCandidateErrorMessage(msg);

  const argMatch = clean.match(/argument `(\w+)`/i);
  if (argMatch) {
    fieldErrors[argMatch[1]] = clean.includes("Not a valid Decimal")
      ? "invalid decimal value"
      : "invalid value";
  }

  const pathMatch = clean.match(/Path:\s*\["(\w+)"\]/i);
  if (pathMatch && !fieldErrors[pathMatch[1]]) {
    fieldErrors[pathMatch[1]] = "invalid value";
  }

  if (clean.includes("marketCap") || clean.includes("market_cap")) {
    fieldErrors.marketCap = "exceeds Decimal(36,12) range or invalid";
  }

  if (Object.keys(fieldErrors).length === 0 && clean.includes("Decimal")) {
    fieldErrors.unknown = "invalid decimal value";
  }

  return fieldErrors;
}

/** Safe validation and shaping before prisma.paperScanCandidate.create(). */
export function prepareCandidateWriteData(
  runId: string,
  userId: string,
  c: ScanCandidate,
  recordId?: string | null,
): CandidateWriteResult {
  const fieldErrors: Record<string, string> = {};
  const fieldWarnings: Record<string, string> = {};

  if (!runId?.trim()) fieldErrors.runId = "required";
  if (!userId?.trim()) fieldErrors.userId = "required";
  if (!c.symbol?.trim()) fieldErrors.symbol = "required";
  if (!c.reasonCode?.trim()) fieldErrors.reasonCode = "required";
  if (!c.reasonText?.trim()) fieldErrors.reasonText = "required";

  const requiredNumeric: Array<[string, number | null | undefined]> = [
    ["price", c.price],
    ["spreadBps", c.spreadBps],
    ["volume24hUsd", c.volume24hUsd],
    ["change24hPct", c.change24hPct],
    ["opportunityScore", c.opportunityScore],
  ];

  for (const [name, value] of requiredNumeric) {
    if (value !== null && value !== undefined && !Number.isFinite(value)) {
      fieldErrors[name] = "must be finite number";
    }
  }

  const optionalNumeric: Array<[string, number | null | undefined]> = [
    ["marketCap", c.marketCapUsd],
    ["momentumScore", c.momentumScore],
    ["volumeSpikeScore", c.volumeSpikeScore],
    ["volatilityScore", c.volatilityScore],
    ["liquidityScore", c.liquidityScore],
    ["spreadScore", c.spreadScore],
    ["trendScore", c.trendScore],
    ["dataQualityScore", c.dataQualityScore],
    ["riskPenalty", c.riskPenalty],
    ["pumpRiskPenalty", c.pumpRiskPenalty],
  ];

  for (const [name, value] of optionalNumeric) {
    if (value !== null && value !== undefined && !Number.isFinite(value)) {
      fieldWarnings[name] = "non-finite optional value will be stored as null";
    }
  }

  const riskTier = normalizeRiskTier(c.riskTier);
  if (!riskTier) {
    fieldErrors.riskTier = `invalid enum: ${c.riskTier}`;
  }

  if (c.rank !== undefined && c.rank !== null) {
    if (!Number.isFinite(c.rank)) {
      fieldErrors.rank = "must be finite integer";
    } else if (c.rank < 0) {
      fieldErrors.rank = "must be non-negative integer";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    const fieldErrorsOut = fieldErrors;
    return {
      ok: false,
      reasonCode: "CANDIDATE_WRITE_FAILED",
      reasonText: `Candidate ${c.symbol} failed validation before DB write`,
      displayMessage: formatCandidateWriteFailureForDisplay({
        symbol: c.symbol,
        fieldErrors: fieldErrorsOut,
      }),
      fieldErrors: fieldErrorsOut,
      symbol: c.symbol,
    };
  }

  const source = clampString(c.source?.trim() || "kraken", MAX_SOURCE_LEN);
  const exchange = c.tradableOnConfiguredExchange ? "kraken" : "none";

  function dec24(
    name: string,
    value: number | null | undefined,
    required = false,
  ): string | null {
    const result = toSafeDecimalString(value, DECIMAL_24_12_MAX, 12);
    if (result.warning) {
      if (required) fieldErrors[name] = result.warning;
      else fieldWarnings[name] = result.warning;
    }
    return result.decimal;
  }

  function dec36(name: string, value: number | null | undefined): string | null {
    const result = toSafeDecimalString(value, DECIMAL_36_12_MAX, 12);
    if (result.warning) fieldWarnings[name] = result.warning;
    return result.decimal;
  }

  function dec12(name: string, value: number | null | undefined, clamp = false): string | null {
    const v = value !== null && value !== undefined && clamp ? clampScore(value) : value;
    const result = toSafeDecimalString(v, DECIMAL_12_6_MAX, 6);
    if (result.warning) fieldWarnings[name] = result.warning;
    return result.decimal;
  }

  const price = dec24("price", c.price, true);
  const spreadBps = dec12("spreadBps", c.spreadBps);
  const volume24hUsd = dec24("volume24hUsd", c.volume24hUsd, true);
  const change24hSanitized = sanitizeChange24hPct(c.change24hPct ?? 0);
  const change24hPct = dec12("change24hPct", change24hSanitized.value);
  if (change24hSanitized.outlier) {
    fieldWarnings.push(`change24hPct outlier sanitized (raw ${change24hSanitized.rawValue})`);
  }
  const marketCap = dec36("marketCap", c.marketCapUsd);

  if (fieldErrors.price) {
    return {
      ok: false,
      reasonCode: "CANDIDATE_WRITE_FAILED",
      reasonText: `Candidate ${c.symbol} failed validation before DB write`,
      displayMessage: formatCandidateWriteFailureForDisplay({
        symbol: c.symbol,
        fieldErrors,
      }),
      fieldErrors,
      symbol: c.symbol,
    };
  }

  const rank =
    c.rank !== undefined && c.rank !== null && Number.isFinite(c.rank)
      ? Math.round(c.rank)
      : null;

  return {
    ok: true,
    fieldWarnings,
    data: {
      runId,
      userId,
      symbol: clampString(c.symbol.trim(), MAX_SYMBOL_LEN),
      source,
      exchange,
      price,
      spreadBps,
      volume24hUsd,
      change24hPct,
      marketCap,
      riskTier: riskTier!,
      momentumScore: dec12("momentumScore", c.momentumScore, true),
      volumeSpikeScore: dec12("volumeSpikeScore", c.volumeSpikeScore, true),
      volatilityScore: dec12("volatilityScore", c.volatilityScore, true),
      liquidityScore: dec12("liquidityScore", c.liquidityScore, true),
      spreadScore: dec12("spreadScore", c.spreadScore, true),
      trendScore: dec12("trendScore", c.trendScore, true),
      opportunityScore: dec12("opportunityScore", c.opportunityScore, true),
      dataQualityScore: dec12("dataQualityScore", c.dataQualityScore, true),
      riskPenalty: dec12("riskPenalty", c.riskPenalty, true),
      pumpRiskPenalty: dec12("pumpRiskPenalty", c.pumpRiskPenalty, true),
      tradableOnConfiguredExchange: Boolean(c.tradableOnConfiguredExchange),
      rank,
      action: clampString(normalizeActionType(c.actionType), MAX_ACTION_LEN),
      reasonCode: clampString(c.reasonCode.trim(), MAX_REASON_CODE_LEN),
      reasonText: clampString(c.reasonText.trim(), MAX_REASON_TEXT_LEN),
      strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
      recordId: recordId ?? null,
    },
  };
}

export function classifyCandidateWriteError(
  err: unknown,
  symbol: string,
): Omit<CandidateWriteFailure, "ok"> {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = sanitizeCandidateErrorMessage(raw);
  const fieldErrors = parsePrismaFieldErrors(raw);

  if (isPrismaStaleError(raw)) {
    return {
      reasonCode: "PRISMA_CLIENT_STALE",
      reasonText: msg.slice(0, 300),
      displayMessage: `CANDIDATE_WRITE_FAILED: ${symbol} candidate could not be stored (database client stale).`,
      fieldErrors,
      symbol,
    };
  }

  return {
    reasonCode: "CANDIDATE_WRITE_FAILED",
    reasonText: msg.slice(0, 300),
    displayMessage: formatCandidateWriteFailureForDisplay({ symbol, fieldErrors }),
    fieldErrors,
    symbol,
  };
}
