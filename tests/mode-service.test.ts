import { describe, expect, it } from "vitest";
import { evaluateAutoExecution } from "@/lib/trading/mode-evaluation";
import { AUTO_BLOCK_REASONS } from "@/lib/config/constants";

describe("evaluateAutoExecution", () => {
  it("blocks Auto when emergency paused", () => {
    const result = evaluateAutoExecution({
      emergencyPaused: true,
      autoSelected: true,
      currentMode: "AUTO",
    });

    expect(result.autoExecutionEnabled).toBe(false);
    expect(result.autoBlockedReason).toBe(AUTO_BLOCK_REASONS.EMERGENCY_PAUSED);
    expect(result.autoState).toBe("EMERGENCY_STOP");
  });

  it("blocks Auto execution even when Auto is selected — proof gates NOT_IMPLEMENTED", () => {
    const result = evaluateAutoExecution({
      emergencyPaused: false,
      autoSelected: true,
      currentMode: "AUTO",
    });

    expect(result.autoExecutionEnabled).toBe(false);
    expect(result.autoBlockedReason).toBe(AUTO_BLOCK_REASONS.PROOF_GATES_NOT_IMPLEMENTED);
    expect(result.autoState).toBe("LOCKED");
  });

  it("blocks Auto when not selected and not in AUTO mode", () => {
    const result = evaluateAutoExecution({
      emergencyPaused: false,
      autoSelected: false,
      currentMode: "PAPER",
    });

    expect(result.autoExecutionEnabled).toBe(false);
    expect(result.autoBlockedReason).toBe(AUTO_BLOCK_REASONS.NO_TRADE_PERMISSION);
    expect(result.autoState).toBe("LOCKED");
  });
});
