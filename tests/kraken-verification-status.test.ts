import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveOverallReasonCode,
  deriveVerificationStatus,
  isSafeToUseForReadOnly,
} from "@/lib/trading/exchange/verification-status";
import type { KrakenEndpointVerifyResult } from "@/lib/trading/exchange/types";

function endpointResult(
  endpoint: KrakenEndpointVerifyResult["endpoint"],
  success: boolean,
  reasonCode: KrakenEndpointVerifyResult["reasonCode"] = success
    ? "READ_ONLY_KEY_READY"
    : "READ_ONLY_KEY_INVALID",
  readStatus: KrakenEndpointVerifyResult["readStatus"] = success ? "YES" : "NO",
): KrakenEndpointVerifyResult {
  return {
    endpoint,
    attempted: true,
    success,
    readStatus,
    recordCount: endpoint === "TradesHistory" && success ? 0 : null,
    reasonCode,
    krakenErrorCode: success ? null : "EAPI:Invalid key",
    safeMessage: success ? null : "failed",
    latencyMs: 1,
    nonceRetryRequired: false,
  };
}

describe("verification status logic", () => {
  it("Balance success => canReadBalance YES and READY when all pass", () => {
    const results = [
      endpointResult("Balance", true),
      endpointResult("OpenOrders", true),
      endpointResult("ClosedOrders", true),
      endpointResult("TradesHistory", true),
    ];
    expect(deriveVerificationStatus(results)).toBe("READY");
    expect(deriveOverallReasonCode(results, "READY")).toBe("READ_ONLY_KEY_READY");
    expect(isSafeToUseForReadOnly("READY")).toBe(true);
  });

  it("Balance permission denied => FAILED when all fail", () => {
    const results = [
      endpointResult("Balance", false, "READ_ONLY_BALANCE_PERMISSION_MISSING"),
      endpointResult("OpenOrders", false, "READ_ONLY_OPEN_ORDERS_PERMISSION_MISSING"),
      endpointResult("ClosedOrders", false, "READ_ONLY_CLOSED_ORDERS_PERMISSION_MISSING"),
      endpointResult("TradesHistory", false, "READ_ONLY_TRADE_HISTORY_PERMISSION_MISSING"),
    ];
    expect(deriveVerificationStatus(results)).toBe("FAILED");
    expect(deriveOverallReasonCode(results, "FAILED")).toBe("READ_ONLY_BALANCE_PERMISSION_MISSING");
  });

  it("some endpoints pass => PARTIAL", () => {
    const results = [
      endpointResult("Balance", true),
      endpointResult("OpenOrders", false, "READ_ONLY_OPEN_ORDERS_PERMISSION_MISSING"),
      endpointResult("ClosedOrders", false, "READ_ONLY_CLOSED_ORDERS_PERMISSION_MISSING"),
      endpointResult("TradesHistory", false, "READ_ONLY_TRADE_HISTORY_PERMISSION_MISSING"),
    ];
    expect(deriveVerificationStatus(results)).toBe("PARTIAL");
    expect(deriveOverallReasonCode(results, "PARTIAL")).toBe("READ_ONLY_KEY_PARTIAL");
  });

  it("invalid key on all endpoints => verified FAILED", () => {
    const results = [
      endpointResult("Balance", false, "KRAKEN_EAPI_INVALID_KEY"),
      endpointResult("OpenOrders", false, "KRAKEN_EAPI_INVALID_KEY"),
      endpointResult("ClosedOrders", false, "KRAKEN_EAPI_INVALID_KEY"),
      endpointResult("TradesHistory", false, "KRAKEN_EAPI_INVALID_KEY"),
    ];
    expect(deriveVerificationStatus(results)).toBe("FAILED");
    expect(deriveOverallReasonCode(results, "FAILED")).toBe("KRAKEN_EAPI_INVALID_KEY");
  });

  it("invalid nonce on trade history does not map to invalid key", () => {
    const results = [
      endpointResult("Balance", true),
      endpointResult("OpenOrders", true),
      endpointResult("ClosedOrders", true),
      endpointResult("TradesHistory", false, "KRAKEN_EAPI_INVALID_NONCE"),
    ];
    expect(deriveVerificationStatus(results)).toBe("PARTIAL");
    expect(deriveOverallReasonCode(results, "PARTIAL")).toBe("READ_ONLY_KEY_PARTIAL");
  });
});

describe("dashboard-shell HTML validity", () => {
  it("displays EMPTY separately from NO for trade history", () => {
    const source = readFileSync(resolve(process.cwd(), "components/dashboard-shell.tsx"), "utf8");
    expect(source).toContain('if (readStatus === "EMPTY") return "EMPTY"');
    expect(source).toContain("Trade history readable, but no records returned.");
  });
});
