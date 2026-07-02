import type { ReconciliationInput, ReconciliationResult } from "@/lib/trading/live/types";

const BALANCE_TOLERANCE = 0.01;

export function reconcileLiveAccounts(input: ReconciliationInput): ReconciliationResult {
  const mismatches: string[] = [];
  const reasonCodes: string[] = [];

  const discrepancy = input.internalLedgerBalance - input.exchangeBalance;
  const balanceMatch = Math.abs(discrepancy) <= BALANCE_TOLERANCE;

  if (!balanceMatch) {
    mismatches.push("BALANCE_MISMATCH");
    reasonCodes.push("INTERNAL_VS_EXCHANGE_MISMATCH");
  }

  const uncertainOrders = input.openOrders.filter(
    (o) => !["open", "filled", "cancelled", "closed"].includes(o.status.toLowerCase()),
  );
  if (uncertainOrders.length > 0) {
    mismatches.push("UNCERTAIN_ORDER_STATUS");
    reasonCodes.push("ORDER_STATUS_UNCERTAIN");
  }

  const uncertainPositions = input.openPositions.filter(
    (p) => p.status !== "open" && p.status !== "closed",
  );
  if (uncertainPositions.length > 0) {
    mismatches.push("UNCERTAIN_POSITION");
    reasonCodes.push("POSITION_UNCERTAIN");
  }

  if (!input.fillDataComplete) {
    mismatches.push("MISSING_FILL_DATA");
    reasonCodes.push("FILL_DATA_MISSING");
  }

  if (!input.feeDataComplete) {
    mismatches.push("MISSING_FEE_DATA");
    reasonCodes.push("FEE_DATA_MISSING");
  }

  if (input.leveraged && !input.fundingDataComplete) {
    mismatches.push("MISSING_FUNDING_DATA");
    reasonCodes.push("FUNDING_DATA_MISSING");
  }

  const blockNewTrades =
    !balanceMatch ||
    uncertainOrders.length > 0 ||
    uncertainPositions.length > 0 ||
    !input.fillDataComplete;

  const blockPnlApproval = !input.fillDataComplete || !input.feeDataComplete;
  const blockProofUpgrade = blockPnlApproval || (input.leveraged && !input.fundingDataComplete);
  const autoLocked = input.afterRestart === true && mismatches.length > 0;

  let status: ReconciliationResult["status"] = "RECONCILED";
  if (mismatches.some((m) => m.includes("MISSING"))) status = "INCOMPLETE";
  else if (!balanceMatch) status = "MISMATCH";
  else if (uncertainOrders.length > 0 || uncertainPositions.length > 0) status = "UNCERTAIN";

  if (blockPnlApproval) reasonCodes.push("NEVER_SHOW_UNVERIFIED_PNL");

  return {
    status,
    balanceMatch,
    discrepancy,
    mismatches,
    blockNewTrades,
    blockPnlApproval,
    blockProofUpgrade,
    autoLocked,
    reasonCodes,
    reconciledAt: new Date().toISOString(),
  };
}
