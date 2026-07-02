/**
 * Worker registry for deployment readiness.
 * Workers are defined but require Redis queue wiring to run as separate processes.
 */

export type WorkerStatus = "DEFINED" | "NOT_IMPLEMENTED" | "ACTIVE";

export interface WorkerDefinition {
  id: string;
  description: string;
  status: WorkerStatus;
  schedule?: string;
}

export const WORKER_REGISTRY: WorkerDefinition[] = [
  { id: "market_ingest_worker", description: "Ingest live market snapshots", status: "DEFINED" },
  { id: "universe_selection_worker", description: "Rank tradable universe", status: "DEFINED" },
  { id: "feature_worker", description: "Compute features on candle/book data", status: "DEFINED" },
  { id: "scanner_worker", description: "Scan for explosive moves", status: "DEFINED" },
  { id: "alpha_research_worker", description: "Run alpha research jobs", status: "DEFINED" },
  { id: "parameter_optimization_worker", description: "Grid/walk-forward optimization", status: "DEFINED" },
  { id: "monte_carlo_worker", description: "Monte Carlo risk simulation", status: "DEFINED" },
  { id: "adversarial_test_worker", description: "Adversarial market scenarios", status: "DEFINED" },
  { id: "benchmark_alpha_worker", description: "Benchmark vs random/B&H", status: "DEFINED" },
  { id: "session_edge_worker", description: "Session edge statistics", status: "DEFINED" },
  { id: "microstructure_worker", description: "Microstructure edge scoring", status: "DEFINED" },
  { id: "venue_routing_worker", description: "Venue quality routing", status: "DEFINED" },
  { id: "opportunity_router_worker", description: "Profit router scoring", status: "DEFINED" },
  { id: "risk_worker", description: "Risk limits and sizing", status: "DEFINED" },
  { id: "risk_of_ruin_worker", description: "Risk of ruin calculation", status: "DEFINED" },
  { id: "today_market_proof_worker", description: "End-of-day market proof", status: "DEFINED", schedule: "0 0 * * *" },
  { id: "today_alpha_beta_worker", description: "Today alpha vs beta", status: "DEFINED", schedule: "0 0 * * *" },
  { id: "today_go_no_go_worker", description: "Today go/no-go decision", status: "DEFINED", schedule: "0 0 * * *" },
  { id: "profitability_scorecard_worker", description: "Daily scorecard", status: "DEFINED", schedule: "0 1 * * *" },
  { id: "money_protected_worker", description: "Blocked trade outcomes", status: "DEFINED" },
  { id: "manual_card_worker", description: "Manual trade card generation", status: "DEFINED" },
  { id: "online_shadow_experiment_worker", description: "Shadow A/B experiments", status: "DEFINED" },
  { id: "auto_execution_worker", description: "Auto order execution (gated)", status: "NOT_IMPLEMENTED" },
  { id: "paper_execution_worker", description: "Paper trade execution", status: "DEFINED" },
  { id: "exit_worker", description: "Exit management", status: "DEFINED" },
  { id: "live_drift_worker", description: "Live drift detection", status: "DEFINED" },
  { id: "edge_decay_worker", description: "Edge decay analysis", status: "DEFINED" },
  { id: "exchange_failure_worker", description: "Exchange failure monitoring", status: "DEFINED" },
  { id: "reconciliation_worker", description: "Live reconciliation", status: "DEFINED" },
  { id: "api_health_worker", description: "API health checks", status: "DEFINED" },
  { id: "backtest_worker", description: "Async backtests", status: "DEFINED" },
  { id: "learning_worker", description: "Bounded learning observations", status: "DEFINED" },
  { id: "notification_worker", description: "Alerts and notifications", status: "DEFINED" },
  { id: "profitability_report_worker", description: "Profitability reports", status: "DEFINED", schedule: "0 2 * * *" },
];

export const DEPLOYMENT_SERVICES = {
  frontend: { status: "ACTIVE" as const, note: "Next.js App Router" },
  backend: { status: "ACTIVE" as const, note: "API routes in Next.js" },
  tradingWorkers: { status: "DEFINED" as const, note: "Registry only — Redis queue not wired" },
  redis: { status: "NOT_IMPLEMENTED" as const, note: "Config placeholder" },
  postgresql: { status: "ACTIVE" as const, note: "Prisma + PostgreSQL" },
  monitoring: { status: "PARTIAL" as const, note: "Health endpoint + Pino logs" },
  errorTracking: { status: "PARTIAL" as const, note: "Structured logs only" },
  scheduler: { status: "NOT_IMPLEMENTED" as const, note: "Cron schedules defined on workers" },
} as const;

export const WORKER_STATUS = "DEFINED" as const;

export async function startWorkers(): Promise<{ started: string[]; skipped: string[] }> {
  const started: string[] = [];
  const skipped = WORKER_REGISTRY.filter((w) => w.status !== "ACTIVE").map((w) => w.id);
  return { started, skipped };
}

export function getWorkerRegistrySummary(): {
  total: number;
  defined: number;
  notImplemented: number;
  active: number;
} {
  return {
    total: WORKER_REGISTRY.length,
    defined: WORKER_REGISTRY.filter((w) => w.status === "DEFINED").length,
    notImplemented: WORKER_REGISTRY.filter((w) => w.status === "NOT_IMPLEMENTED").length,
    active: WORKER_REGISTRY.filter((w) => w.status === "ACTIVE").length,
  };
}
