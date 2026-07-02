import type {
  EvidenceAssessmentInput,
  EvidenceAssessmentResult,
  EvidenceLevelName,
  EvidenceLevelNumber,
} from "@/lib/trading/proof/types";

const LEVEL_NAMES: EvidenceLevelName[] = [
  "IDEA_ONLY",
  "FORMULA_DEFINED",
  "BACKTESTED",
  "VALIDATED",
  "OUT_OF_SAMPLE_PASSED",
  "WALK_FORWARD_PASSED",
  "MONTE_CARLO_PASSED",
  "ADVERSARIAL_PASSED",
  "PAPER_FORWARD_PASSED",
  "SHADOW_LIVE_PASSED",
  "TINY_LIVE_CANARY_PASSED",
  "LIVE_EXECUTION_VERIFIED",
  "LIVE_EXPECTANCY_VERIFIED",
  "REGIME_SURVIVAL_VERIFIED",
  "SCALABLE_LIVE_EDGE",
];

function hasMockedArtifacts(input: EvidenceAssessmentInput): boolean {
  return (input.artifacts ?? []).some((a) => a.mocked === true);
}

function computeMaxLevel(input: EvidenceAssessmentInput): EvidenceLevelNumber {
  if (hasMockedArtifacts(input)) return 0;

  const gates: [boolean | undefined, EvidenceLevelNumber][] = [
    [input.scalableLiveEdge && input.regimeSurvivalVerified, 14],
    [input.regimeSurvivalVerified, 13],
    [input.liveExpectancyVerified, 12],
    [input.liveExecutionVerified, 11],
    [input.tinyLiveCanaryPassed, 10],
    [input.shadowLivePassed, 9],
    [input.paperForwardPassed, 8],
    [input.adversarialPassed, 7],
    [input.monteCarloPassed, 6],
    [input.walkForwardPassed, 5],
    [input.outOfSamplePassed, 4],
    [input.validated, 3],
    [input.backtestCompleted, 2],
    [input.formulaDefined, 1],
  ];

  for (const [passed, level] of gates) {
    if (passed) return level;
  }
  return 0;
}

export function autoSizeBandForLevel(level: EvidenceLevelNumber): EvidenceAssessmentResult["autoMaxSizeBand"] {
  if (level <= 9) return "NONE";
  if (level <= 11) return "TINY";
  if (level === 12) return "SMALL";
  return "NORMAL_WITH_APPROVAL";
}

export function assessEvidenceLevel(
  input: EvidenceAssessmentInput,
  previousLevel: EvidenceLevelNumber | null = null,
): EvidenceAssessmentResult {
  const reasonCodes: string[] = [];
  let level = computeMaxLevel(input);

  if (hasMockedArtifacts(input)) {
    level = 0;
    reasonCodes.push("MOCKED_DATA_REJECTED");
  }

  if (input.livePerformanceDecay || input.edgeDecayDetected) {
    const demoted = Math.max(0, level - 2) as EvidenceLevelNumber;
    if (demoted < level) {
      reasonCodes.push("LIVE_PERFORMANCE_DECAY");
      level = demoted;
    }
  }

  if (input.unreconciledPnL && level >= 10) {
    level = Math.min(level, 9) as EvidenceLevelNumber;
    reasonCodes.push("UNRECONCILED_PNL_DEMOTION");
  }

  const levelName = LEVEL_NAMES[level]!;
  const autoMaxSizeBand = autoSizeBandForLevel(level);
  const autoAllowed = level >= 10 && autoMaxSizeBand !== "NONE";
  const manualAllowed = level >= 8;

  if (level <= 7) reasonCodes.push("NO_LIVE_AUTO");
  if (level === 8) reasonCodes.push("MANUAL_ONLY_STAGE");
  if (level >= 14) reasonCodes.push("REQUIRES_USER_APPROVAL_FOR_NORMAL_AUTO");

  let direction: EvidenceAssessmentResult["direction"] = "INITIAL";
  if (previousLevel !== null) {
    if (level > previousLevel) direction = "PROMOTED";
    else if (level < previousLevel) direction = "DEMOTED";
    else direction = "UNCHANGED";
  }

  return {
    entityType: input.entityType,
    entityId: input.entityId,
    level,
    levelName,
    previousLevel,
    direction,
    autoAllowed,
    autoMaxSizeBand,
    manualAllowed,
    reasonCodes,
    artifacts: input.artifacts ?? [],
    assessedAt: new Date().toISOString(),
  };
}

export function canPromoteOneStage(
  current: EvidenceLevelNumber,
  proposed: EvidenceLevelNumber,
): boolean {
  return proposed <= current + 1;
}
