export interface PaperEvidenceCountSnapshot {
  paperRuns: number;
  candidatesStored: number;
  signalsStored: number;
  snapshotsStored: number;
}

export type RunOutcomeStatus = "COMPLETED" | "PARTIAL" | "FAILED" | "NOOP";

export function computePaperEvidenceCountTotal(counts: PaperEvidenceCountSnapshot): number {
  return (
    counts.paperRuns + counts.candidatesStored + counts.signalsStored + counts.snapshotsStored
  );
}

export function usefulEvidenceSaved(input: {
  candidatesStored: number;
  signalsStored: number;
  snapshotsStored: number;
  tradesOpened: number;
  tradesUpdated: number;
  tradesClosed: number;
}): boolean {
  return (
    input.candidatesStored > 0 ||
    input.signalsStored > 0 ||
    input.snapshotsStored > 0 ||
    input.tradesOpened > 0 ||
    input.tradesClosed > 0 ||
    input.tradesUpdated > 0
  );
}

export function classifyRunStatus(input: {
  runRecordCreated: boolean;
  countDelta: number;
  candidatesStored: number;
  signalsStored: number;
  snapshotsStored: number;
  tradesOpened: number;
  tradesUpdated: number;
  tradesClosed: number;
  candidateWriteFailures: number;
  snapshotWriteFailures: number;
  failedFetches: number;
  errorCount: number;
  marketDataStatus: string;
  prismaCriticalFailure: boolean;
}): RunOutcomeStatus {
  if (!input.runRecordCreated) return "FAILED";

  const saved = usefulEvidenceSaved(input);

  if (input.prismaCriticalFailure && !saved) return "FAILED";

  if (input.marketDataStatus === "MARKET_DATA_FAILED" && !saved) return "FAILED";

  const onlyRunRecord =
    input.countDelta <= 1 &&
    input.candidatesStored === 0 &&
    input.signalsStored === 0 &&
    input.snapshotsStored === 0 &&
    input.tradesOpened === 0 &&
    input.tradesClosed === 0 &&
    input.tradesUpdated === 0;

  if (onlyRunRecord) return "NOOP";

  const hasWarnings =
    input.failedFetches > 0 ||
    input.errorCount > 0 ||
    input.candidateWriteFailures > 0 ||
    input.snapshotWriteFailures > 0 ||
    input.marketDataStatus === "MARKET_DATA_PARTIAL";

  if (hasWarnings) return saved ? "PARTIAL" : "FAILED";

  return "COMPLETED";
}

export function resolveZeroCountDeltaReason(input: {
  countDelta: number;
  tradesOpened: number;
  tradesUpdated: number;
  snapshotsStored: number;
  candidatesStored: number;
  signalsStored: number;
  paperRunsDelta: number;
  maxOpenTradesReached: boolean;
  prismaCriticalFailure: boolean;
  databaseWriteFailed: boolean;
  runAlreadyInProgress?: boolean;
  requestTimeout?: boolean;
}): string | undefined {
  if (input.countDelta !== 0) return undefined;
  if (input.runAlreadyInProgress) return "RUN_ALREADY_IN_PROGRESS";
  if (input.requestTimeout) return "REQUEST_TIMEOUT";
  if (input.prismaCriticalFailure) return "PRISMA_CLIENT_STALE";
  if (input.databaseWriteFailed) return "DATABASE_WRITE_FAILED";
  if (
    input.tradesUpdated > 0 &&
    input.tradesOpened === 0 &&
    input.maxOpenTradesReached
  ) {
    return "MAX_OPEN_TRADES_REACHED";
  }
  if (input.tradesUpdated > 0 && input.tradesOpened === 0) {
    return "ONLY_UPDATED_EXISTING_TRADES";
  }
  if (
    input.paperRunsDelta === 0 &&
    input.candidatesStored === 0 &&
    input.signalsStored === 0 &&
    input.snapshotsStored === 0
  ) {
    return "NO_NEW_RECORDS_CREATED";
  }
  return "NO_NEW_RECORDS_CREATED";
}

export function resolveRunReasonCode(input: {
  status: string;
  countDelta: number;
  tradesOpened: number;
  tradesUpdated: number;
  snapshotsStored: number;
  candidatesStored: number;
  signalsStored: number;
  paperRunsDelta: number;
  maxOpenTradesReached: boolean;
  prismaCriticalFailure: boolean;
  databaseWriteFailed: boolean;
  snapshotWriteFailed: boolean;
  candidateWriteFailures?: number;
  explicitReasonCode?: string;
}): string {
  if (input.explicitReasonCode) return input.explicitReasonCode;
  if (input.prismaCriticalFailure) return "PRISMA_CLIENT_STALE";
  if (input.databaseWriteFailed) return "DATABASE_WRITE_FAILED";
  if (input.snapshotWriteFailed && input.snapshotsStored === 0) return "SNAPSHOT_WRITE_FAILED";
  if (input.status === "NOOP") return "NO_NEW_RECORDS_CREATED";
  if (input.status === "FAILED") return "DATABASE_WRITE_FAILED";

  const zeroDelta = resolveZeroCountDeltaReason({
    countDelta: input.countDelta,
    tradesOpened: input.tradesOpened,
    tradesUpdated: input.tradesUpdated,
    snapshotsStored: input.snapshotsStored,
    candidatesStored: input.candidatesStored,
    signalsStored: input.signalsStored,
    paperRunsDelta: input.paperRunsDelta,
    maxOpenTradesReached: input.maxOpenTradesReached,
    prismaCriticalFailure: input.prismaCriticalFailure,
    databaseWriteFailed: input.databaseWriteFailed,
  });
  if (zeroDelta) return zeroDelta;

  if (input.maxOpenTradesReached && input.tradesUpdated > 0 && input.tradesOpened === 0) {
    return "MAX_OPEN_TRADES_REACHED";
  }
  if (input.status === "PARTIAL") {
    if (input.explicitReasonCode === "KRAKEN_UNAVAILABLE_COINGECKO_FALLBACK_USED") {
      return "KRAKEN_UNAVAILABLE_COINGECKO_FALLBACK_USED";
    }
    if (input.explicitReasonCode === "MARKET_DATA_PARTIAL") return "MARKET_DATA_PARTIAL";
    return "PARTIAL_RUN";
  }
  return "COMPLETED";
}

export function detectRunContradiction(input: {
  status: string | null;
  countDelta: number | null;
  candidatesStored: number;
  signalsStored: number;
  snapshotsStored: number;
  reasonCode: string | null;
  stalePrismaDetectedNow: boolean;
}): { contradictionDetected: boolean; explanation: string | null } {
  const saved =
    input.candidatesStored > 0 ||
    input.signalsStored > 0 ||
    input.snapshotsStored > 0;

  if (
    input.status === "FAILED" &&
    (input.countDelta ?? 0) > 0 &&
    saved
  ) {
    return {
      contradictionDetected: true,
      explanation: "Run status is FAILED but countDelta is positive and DB writes succeeded.",
    };
  }

  if (input.stalePrismaDetectedNow && saved) {
    return {
      contradictionDetected: true,
      explanation: "Prisma stale warning is active but recent DB writes succeeded.",
    };
  }

  if (
    input.reasonCode === "PRISMA_CLIENT_STALE" &&
    (input.countDelta ?? 0) > 0 &&
    saved
  ) {
    return {
      contradictionDetected: true,
      explanation: "reasonCode is PRISMA_CLIENT_STALE but evidence count increased with saved writes.",
    };
  }

  return { contradictionDetected: false, explanation: null };
}
