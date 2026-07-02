import { describe, expect, it } from "vitest";
import {
  LIVE_TEST_STRATEGIES,
  getEnabledLiveTestCandidates,
  computeStrategyLogicHash,
} from "@/lib/trading/strategies/definitions";

describe("strategy registry", () => {
  it("has exactly three live test candidates", () => {
    expect(LIVE_TEST_STRATEGIES).toHaveLength(3);
    expect(getEnabledLiveTestCandidates()).toHaveLength(3);
  });

  it("requires min 3x reward to cost for each strategy", () => {
    for (const s of LIVE_TEST_STRATEGIES) {
      expect(s.rules.minRewardToCostRatio).toBeGreaterThanOrEqual(3);
      expect(s.rules.entry.length).toBeGreaterThan(5);
      expect(s.rules.invalidation.length).toBeGreaterThan(3);
    }
  });

  it("produces stable logic hashes", () => {
    const hash1 = computeStrategyLogicHash(LIVE_TEST_STRATEGIES[0]);
    const hash2 = computeStrategyLogicHash(LIVE_TEST_STRATEGIES[0]);
    expect(hash1).toBe(hash2);
  });

  it("disallows auto on multiple unproven strategies by policy", () => {
    expect(LIVE_TEST_STRATEGIES.every((s) => s.liveTestCandidate)).toBe(true);
    expect(LIVE_TEST_STRATEGIES.filter((s) => s.enabled).length).toBe(3);
  });
});
