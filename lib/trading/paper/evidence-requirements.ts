export const PAPER_EVIDENCE_REQUIREMENTS = {
  minimumRuns: 30,
  minimumClosedTrades: 20,
  minimumCalendarDays: 7,
} as const;

export type PaperForwardEvidenceStatus = "NOT_CONFIGURED" | "COLLECTING" | "PASS";

export function evaluatePaperForwardEvidence(input: {
  totalRuns: number;
  closedTrades: number;
  calendarDays: number;
  unresolvedDataErrors: number;
  systemAvailable: boolean;
}): {
  status: PaperForwardEvidenceStatus;
  note: string;
  progress: {
    runs: { current: number; required: number };
    closedTrades: { current: number; required: number };
    calendarDays: { current: number; required: number };
  };
} {
  const { minimumRuns, minimumClosedTrades, minimumCalendarDays } = PAPER_EVIDENCE_REQUIREMENTS;

  if (!input.systemAvailable) {
    return {
      status: "NOT_CONFIGURED",
      note: "Paper-forward evidence system not configured",
      progress: {
        runs: { current: 0, required: minimumRuns },
        closedTrades: { current: 0, required: minimumClosedTrades },
        calendarDays: { current: 0, required: minimumCalendarDays },
      },
    };
  }

  const progress = {
    runs: { current: input.totalRuns, required: minimumRuns },
    closedTrades: { current: input.closedTrades, required: minimumClosedTrades },
    calendarDays: { current: input.calendarDays, required: minimumCalendarDays },
  };

  if (input.unresolvedDataErrors > 0) {
    return {
      status: "COLLECTING",
      note: `${input.unresolvedDataErrors} unresolved market data error(s) — resolve before PASS`,
      progress,
    };
  }

  const meetsThreshold =
    input.totalRuns >= minimumRuns &&
    input.closedTrades >= minimumClosedTrades &&
    input.calendarDays >= minimumCalendarDays;

  if (meetsThreshold) {
    return {
      status: "PASS",
      note: "Paper-forward evidence thresholds met — still simulated, not live proof",
      progress,
    };
  }

  return {
    status: "COLLECTING",
    note: "Collecting paper-forward evidence — simulated P&L only",
    progress,
  };
}
