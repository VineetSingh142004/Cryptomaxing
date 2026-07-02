import type { BacktestTrade, SessionEdgeStats } from "@/lib/trading/research/types";

const SESSION_LABELS: Record<number, string> = {
  0: "asia_late",
  4: "asia",
  8: "europe_open",
  12: "us_pre",
  14: "us_open",
  18: "us_afternoon",
  22: "us_close",
};

function sessionLabel(hour: number): string {
  const keys = Object.keys(SESSION_LABELS).map(Number).sort((a, b) => b - a);
  for (const k of keys) {
    if (hour >= k) return SESSION_LABELS[k];
  }
  return "asia_late";
}

export function analyzeSessionEdge(trades: BacktestTrade[]): SessionEdgeStats[] {
  const byHour = new Map<number, BacktestTrade[]>();

  for (const t of trades) {
    const list = byHour.get(t.sessionHour) ?? [];
    list.push(t);
    byHour.set(t.sessionHour, list);
  }

  const stats: SessionEdgeStats[] = [];

  for (const [hour, hourTrades] of byHour.entries()) {
    const wins = hourTrades.filter((t) => t.netPnl > 0);
    const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
    const grossLoss = Math.abs(
      hourTrades.filter((t) => t.netPnl <= 0).reduce((s, t) => s + t.netPnl, 0),
    );
    const expectancy =
      hourTrades.length > 0
        ? hourTrades.reduce((s, t) => s + t.netPnl, 0) / hourTrades.length
        : null;

    const fakeouts = hourTrades.filter((t) => t.exitReason === "stop").length;
    const fakeoutRate = hourTrades.length > 0 ? fakeouts / hourTrades.length : null;

    const reasonCodes: string[] = [];
    let recommendation: SessionEdgeStats["recommendation"] = "NEUTRAL";

    if (expectancy !== null && expectancy > 0 && (fakeoutRate ?? 1) < 0.5) {
      recommendation = "PREFER";
    } else if (expectancy !== null && expectancy < 0) {
      recommendation = "BLOCK";
      reasonCodes.push("NEGATIVE_SESSION_EXPECTANCY");
    } else if ((fakeoutRate ?? 0) > 0.6) {
      recommendation = "REDUCE_RISK";
      reasonCodes.push("HIGH_FAKEOUT_RATE");
    }

    if (hourTrades.length < 3) {
      recommendation = "NEUTRAL";
      reasonCodes.push("LOW_SESSION_SAMPLE");
    }

    stats.push({
      hour,
      sessionLabel: sessionLabel(hour),
      tradeCount: hourTrades.length,
      winRate: hourTrades.length > 0 ? wins.length / hourTrades.length : null,
      expectancy,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      avgSpreadBps: null,
      fakeoutRate,
      recommendation,
      reasonCodes,
    });
  }

  return stats.sort((a, b) => a.hour - b.hour);
}

export function getBlockedHours(stats: SessionEdgeStats[]): number[] {
  return stats.filter((s) => s.recommendation === "BLOCK").map((s) => s.hour);
}

export function getPreferredHours(stats: SessionEdgeStats[]): number[] {
  return stats.filter((s) => s.recommendation === "PREFER").map((s) => s.hour);
}
