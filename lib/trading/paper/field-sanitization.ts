export const ABSURD_CHANGE24H_PCT_THRESHOLD = 5000;
export const DECIMAL_12_6_MAX = 999_999.999999;

export interface SanitizedChange24h {
  value: number;
  rawValue: number;
  sanitized: boolean;
  outlier: boolean;
  reasonCode: string | null;
  watchlistOnly: boolean;
}

export function sanitizeChange24hPct(raw: number): SanitizedChange24h {
  if (!Number.isFinite(raw)) {
    return {
      value: 0,
      rawValue: raw,
      sanitized: true,
      outlier: true,
      reasonCode: "DATA_OUTLIER_SANITIZED",
      watchlistOnly: true,
    };
  }
  const abs = Math.abs(raw);
  if (abs > ABSURD_CHANGE24H_PCT_THRESHOLD) {
    const clamped = Math.sign(raw) * ABSURD_CHANGE24H_PCT_THRESHOLD;
    return {
      value: clamped,
      rawValue: raw,
      sanitized: true,
      outlier: true,
      reasonCode: "DATA_OUTLIER_SANITIZED",
      watchlistOnly: true,
    };
  }
  if (abs > DECIMAL_12_6_MAX) {
    return {
      value: Math.sign(raw) * DECIMAL_12_6_MAX,
      rawValue: raw,
      sanitized: true,
      outlier: true,
      reasonCode: "DATA_OUTLIER_SANITIZED",
      watchlistOnly: true,
    };
  }
  return {
    value: raw,
    rawValue: raw,
    sanitized: false,
    outlier: false,
    reasonCode: null,
    watchlistOnly: false,
  };
}

export function shouldExcludeFromScoring(flags: { outlier?: boolean; watchlistOnly?: boolean }): boolean {
  return Boolean(flags.outlier || flags.watchlistOnly);
}
