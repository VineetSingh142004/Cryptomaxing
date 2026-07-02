import { prisma } from "@/lib/db/client";
import {
  LIVE_TEST_STRATEGIES,
  computeStrategyLogicHash,
  type StrategyDefinition,
} from "@/lib/trading/strategies/definitions";

export const STRATEGY_ENGINE_STATUS = "ACTIVE" as const;

export async function seedStrategyRegistry(): Promise<void> {
  for (const strategy of LIVE_TEST_STRATEGIES) {
    const library = await prisma.strategyLibrary.upsert({
      where: { name: strategy.name },
      create: {
        name: strategy.name,
        description: strategy.description,
        category: strategy.category,
        isActive: strategy.enabled,
      },
      update: {
        description: strategy.description,
        isActive: strategy.enabled,
      },
    });

    const logicHash = computeStrategyLogicHash(strategy);

    await prisma.strategyVariant.upsert({
      where: {
        libraryId_version: { libraryId: library.id, version: strategy.version },
      },
      create: {
        libraryId: library.id,
        version: strategy.version,
        name: strategy.name,
        description: strategy.description,
        logicHash,
        isActive: strategy.enabled && strategy.liveTestCandidate,
      },
      update: {
        description: strategy.description,
        logicHash,
        isActive: strategy.enabled && strategy.liveTestCandidate,
      },
    });
  }
}

export function listStrategies(): StrategyDefinition[] {
  return LIVE_TEST_STRATEGIES;
}

export function getStrategyRegistrySummary() {
  const candidates = LIVE_TEST_STRATEGIES.filter((s) => s.liveTestCandidate);
  return {
    total: LIVE_TEST_STRATEGIES.length,
    liveTestCandidates: candidates.length,
    enabled: candidates.filter((s) => s.enabled).length,
    disabledBeyondCandidates: 0,
    autoAllowedOnUnproven: false,
    maxUnprovenAutoStrategies: 1,
    strategies: LIVE_TEST_STRATEGIES.map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      enabled: s.enabled,
      liveTestCandidate: s.liveTestCandidate,
      correlationGroup: s.correlationGroup,
      minRewardToCostRatio: s.rules.minRewardToCostRatio,
      logicHash: computeStrategyLogicHash(s),
    })),
  };
}

export * from "@/lib/trading/strategies/definitions";
