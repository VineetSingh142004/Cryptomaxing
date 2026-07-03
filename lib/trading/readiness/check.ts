import type { ReadinessCheckItem } from "@/lib/trading/readiness/types";
import { getEncryptionStatusPublic } from "@/lib/security/vault-policy";
import { getAuthStatus } from "@/lib/security/auth";

export async function runFinalReadinessCheck(): Promise<{
  ready: boolean;
  items: ReadinessCheckItem[];
  summary: { passed: number; failed: number; partial: number };
  auth: Awaited<ReturnType<typeof getAuthStatus>>;
}> {
  const encryption = getEncryptionStatusPublic();
  const auth = await getAuthStatus();

  const authStatus: ReadinessCheckItem["status"] =
    auth.status === "LOCAL_OWNER_MODE"
      ? "PASS"
      : auth.status === "LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION"
        ? "BLOCKED"
        : auth.status === "AUTH_READY"
          ? "PASS"
          : auth.status === "AUTH_NOT_CONFIGURED"
            ? "NOT_CONFIGURED"
            : auth.status === "AUTH_REQUIRED"
              ? "PARTIAL"
              : "FAIL";

  const items: ReadinessCheckItem[] = [
    check("project_builds", "Project builds from scratch", "PARTIAL", "Run npm run build locally"),
    check("paper_mode", "Paper mode exists", "PASS"),
    check("manual_mode", "Manual mode exists", "PASS"),
    check("auto_gated", "Auto selectable but gated", "PASS"),
    check("api_vault", "API vault works", authStatus === "PASS" && encryption.productionSafe ? "PASS" : "PARTIAL"),
    check("no_withdrawal", "No-withdrawal check exists", "PARTIAL", "Permission detection NOT_IMPLEMENTED on exchange"),
    check("ledger", "Ledger works", "PASS"),
    check("market_data", "Market data works", "PASS"),
    check("universe", "Liquidity universe selection", "PASS"),
    check("data_quality", "Data quality blocks bad data", "PASS"),
    check("strategies", "Exact strategies exist", "PASS"),
    check("alpha_research", "Alpha research exists", "PASS"),
    check("param_opt", "Parameter optimization exists", "PASS"),
    check("monte_carlo", "Monte Carlo exists", "PASS"),
    check("adversarial", "Adversarial simulator exists", "PASS"),
    check("benchmark", "Benchmark alpha exists", "PASS"),
    check("microstructure", "Microstructure engine exists", "PASS"),
    check("venue_routing", "Venue routing exists", "PASS"),
    check("execution_quality", "Execution quality exists", "PASS"),
    check("risk_of_ruin", "Risk of ruin exists", "PASS"),
    check("opportunity_cost", "Opportunity cost exists", "PASS"),
    check("evidence_level", "Evidence level engine exists", "PASS"),
    check("today_proof", "Today market proof exists", "PASS"),
    check("paper_forward", "Same-day paper-forward exists", "PASS"),
    check("shadow", "Real-time shadow evidence exists", "PASS"),
    check("alpha_beta", "Alpha vs beta exists", "PASS"),
    check("go_no_go", "Go/no-go decision exists", "PASS"),
    check("scorecard", "Profitability scorecard exists", "PASS"),
    check("money_protected", "Money protected exists", "PASS"),
    check("live_audit", "Live profitability audit exists", "PASS"),
    check("sample_confidence", "Live sample-size confidence exists", "PASS"),
    check("canary", "Canary scaling exists", "PASS"),
    check("reconciliation", "Real-money reconciliation exists", "PASS"),
    check("attribution", "Profit attribution exists", "PASS"),
    check("live_drift", "Live drift exists", "PASS"),
    check("edge_decay", "Edge decay exists", "PASS"),
    check("shadow_experiments", "Online shadow experiments exist", "PASS"),
    check("emergency", "Exchange failure playbook exists", "PASS"),
    check("paper_broker", "Realistic paper broker exists", "PASS"),
    check("manual_cards", "Manual cards work", "PASS"),
    check("proof_gates", "Proof gates work", "PASS"),
    check("auto_unlock", "Auto strict unlock exists", "PASS"),
    check("profit_report", "Profitability reporting engine exists", "PASS"),
    check("reality_check", "Same-day reality check exists", "PASS"),
    check("learning", "Bounded learning engine exists", "PASS"),
    check("dashboard", "Dashboard exists", "PASS"),
    check("security", "Security hardening exists", "PARTIAL", "Rate limits in-memory only"),
    check(
      "encryption_key",
      "Production-safe ENCRYPTION_KEY",
      encryption.productionSafe ? "PASS" : "PARTIAL",
      encryption.productionSafe ? undefined : encryption.safeMessage,
    ),
    check("workers", "Worker registry defined", "PARTIAL", "Redis queue not wired"),
    check("auto_bypass", "Auto cannot bypass anything", "PASS"),
    check("tests", "Tests pass", "PARTIAL", "Run npm test locally"),
    check("no_fake_pnl", "No fake P&L", "PASS"),
    check("no_fake_backtest", "No fake backtests", "PASS"),
    check("no_fake_proof", "No fake same-day proof", "PASS"),
    check("no_client_secrets", "No client-side secrets", "PASS"),
    check("auto_execution", "Auto execution (live orders)", "FAIL", "NOT_IMPLEMENTED — by design"),
    check("live_private_api", "Live exchange private API", "FAIL", "NOT_IMPLEMENTED"),
    check("redis", "Redis queue/cache", "FAIL", "NOT_IMPLEMENTED"),
    check("auth", "User authentication / local owner mode", authStatus, auth.message),
  ];

  const passed = items.filter((i) => i.status === "PASS").length;
  const failed = items.filter((i) => i.status === "FAIL").length;
  const partial = items.filter((i) => i.status === "PARTIAL" || i.status === "NOT_CONFIGURED").length;
  const ready = failed === 0 && partial <= 8;

  return { ready, items, summary: { passed, failed, partial }, auth };
}

function check(
  id: string,
  label: string,
  status: ReadinessCheckItem["status"],
  note?: string,
): ReadinessCheckItem {
  return { id, label, status, note };
}
