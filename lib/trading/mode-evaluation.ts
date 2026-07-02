import type { AutoState, TradingMode } from "@prisma/client";

import {

  AUTO_BLOCK_REASONS,

  type AutoBlockReason,

} from "@/lib/config/constants";

import type { EvidenceLevelNumber } from "@/lib/trading/proof/types";

import { evaluateAutoUnlock, type AutoUnlockInput } from "@/lib/trading/auto";



export interface AutoExecutionInput {

  emergencyPaused: boolean;

  autoSelected: boolean;

  currentMode: TradingMode;

  evidenceLevel?: EvidenceLevelNumber;

  evidenceAutoAllowed?: boolean;

  sameDayEvidencePresent?: boolean;

  liveEvidencePresent?: boolean;

  reconciliationPassed?: boolean;

  /** Full unlock gate input — when provided, strict unlock is evaluated */

  unlockInput?: Partial<AutoUnlockInput>;

}



export interface AutoExecutionResult {

  autoExecutionEnabled: boolean;

  autoBlockedReason: AutoBlockReason | null;

  autoState: AutoState;

  unlockDecision?: string;

  failedGates?: string[];

}



/**

 * Evaluates whether Auto execution is allowed via strict unlock gates.

 * Auto order placement remains NOT_IMPLEMENTED until execution engine is wired.

 */

export function evaluateAutoExecution(input: AutoExecutionInput): AutoExecutionResult {

  if (input.emergencyPaused) {

    return {

      autoExecutionEnabled: false,

      autoBlockedReason: AUTO_BLOCK_REASONS.EMERGENCY_PAUSED,

      autoState: "EMERGENCY_STOP",

    };

  }



  if (input.currentMode !== "AUTO" && !input.autoSelected) {

    return {

      autoExecutionEnabled: false,

      autoBlockedReason: AUTO_BLOCK_REASONS.NO_TRADE_PERMISSION,

      autoState: "LOCKED",

    };

  }



  const level = input.evidenceLevel ?? 0;



  if (level < 10 || !input.evidenceAutoAllowed) {

    return {

      autoExecutionEnabled: false,

      autoBlockedReason: AUTO_BLOCK_REASONS.PROOF_GATES_NOT_IMPLEMENTED,

      autoState: "LOCKED",

      unlockDecision: "PAPER_ONLY",

    };

  }



  if (!input.sameDayEvidencePresent) {

    return {

      autoExecutionEnabled: false,

      autoBlockedReason: AUTO_BLOCK_REASONS.SAME_DAY_EVIDENCE_MISSING,

      autoState: "LOCKED",

      unlockDecision: "WAIT",

    };

  }



  if (level >= 11 && !input.liveEvidencePresent) {

    return {

      autoExecutionEnabled: false,

      autoBlockedReason: AUTO_BLOCK_REASONS.LIVE_EVIDENCE_MISSING,

      autoState: "LOCKED",

    };

  }



  if (input.reconciliationPassed === false) {

    return {

      autoExecutionEnabled: false,

      autoBlockedReason: AUTO_BLOCK_REASONS.DATA_QUALITY_NOT_VERIFIED,

      autoState: "LOCKED",

      unlockDecision: "REVALIDATION_REQUIRED",

    };

  }



  const unlock = evaluateAutoUnlock({

    emergencyPaused: input.emergencyPaused,

    paperRealistic: true,

    manualWorking: true,

    apiSecure: input.unlockInput?.apiSecure ?? false,

    noWithdrawalPermission: input.unlockInput?.noWithdrawalPermission ?? false,

    exactStrategyApproved: input.unlockInput?.exactStrategyApproved ?? false,

    parametersApproved: input.unlockInput?.parametersApproved ?? false,

    dataQualityPasses: input.unlockInput?.dataQualityPasses ?? false,

    alphaResearchSupportsEdge: input.unlockInput?.alphaResearchSupportsEdge ?? false,

    todayMarketProofAvailable: input.sameDayEvidencePresent,

    todayAlphaBetaPasses: input.unlockInput?.todayAlphaBetaPasses ?? false,

    todayExecutionRealismPasses: input.unlockInput?.todayExecutionRealismPasses ?? false,

    todayCostSurvivalPasses: input.unlockInput?.todayCostSurvivalPasses ?? false,

    todayFillRealismPasses: input.unlockInput?.todayFillRealismPasses ?? false,

    todayGoNoGoAllows: input.unlockInput?.todayGoNoGoAllows ?? false,

    scorecardAllowsStage: input.unlockInput?.scorecardAllowsStage ?? false,

    moneyProtectedEngineActive: true,

    sameDayRealityCheckVisible: true,

    benchmarkAlphaPasses: input.unlockInput?.benchmarkAlphaPasses ?? false,

    monteCarloSurvivalPasses: input.unlockInput?.monteCarloSurvivalPasses ?? false,

    adversarialSurvivalPasses: input.unlockInput?.adversarialSurvivalPasses ?? false,

    microstructureConflictClear: input.unlockInput?.microstructureConflictClear ?? true,

    backtestPasses: level >= 2,

    validationPasses: level >= 3,

    outOfSamplePasses: level >= 4,

    walkForwardPasses: level >= 5,

    stressTestPasses: input.unlockInput?.stressTestPasses ?? false,

    paperForwardPasses: level >= 8,

    shadowLivePasses: level >= 9,

    tinyLiveCanaryPasses: level >= 10,

    liveExecutionAuditPasses: input.unlockInput?.liveExecutionAuditPasses ?? false,

    liveSlippageAuditPasses: input.unlockInput?.liveSlippageAuditPasses ?? false,

    liveFeeFundingAuditPasses: input.unlockInput?.liveFeeFundingAuditPasses ?? false,

    liveReconciliationPasses: input.reconciliationPassed === true,

    liveSampleSizePasses: input.unlockInput?.liveSampleSizePasses ?? false,

    evidenceLevelAllowsSize: level >= 10,

    strategyNotDegraded: input.unlockInput?.strategyNotDegraded ?? true,

    edgeDecayClear: input.unlockInput?.edgeDecayClear ?? true,

    liveDriftClear: input.unlockInput?.liveDriftClear ?? true,

    sessionEdgePositiveOrAPlus: input.unlockInput?.sessionEdgePositiveOrAPlus ?? false,

    riskOfRuinAcceptable: input.unlockInput?.riskOfRuinAcceptable ?? false,

    profitAttributionSupportsEdge: input.unlockInput?.profitAttributionSupportsEdge ?? false,

    profitDensityAcceptable: input.unlockInput?.profitDensityAcceptable ?? false,

    executionQualityAcceptable: input.unlockInput?.executionQualityAcceptable ?? false,

    venueQualityAcceptable: input.unlockInput?.venueQualityAcceptable ?? false,

    exchangeHealthAcceptable: input.unlockInput?.exchangeHealthAcceptable ?? true,

    opportunityCostAcceptable: input.unlockInput?.opportunityCostAcceptable ?? true,

    stopExecutable: input.unlockInput?.stopExecutable ?? true,

    exitReady: input.unlockInput?.exitReady ?? true,

    killSwitchClear: input.unlockInput?.killSwitchClear ?? true,

    dailyWeeklyLossAvailable: input.unlockInput?.dailyWeeklyLossAvailable ?? true,

    userApprovedAutoStage: input.unlockInput?.userApprovedAutoStage ?? false,

    executionEngineWired: false,

    evidenceLevel: level,

    ...input.unlockInput,

  });



  if (!unlock.autoExecutionEnabled) {

    const reasonMap: Record<string, AutoBlockReason> = {

      BLOCK: AUTO_BLOCK_REASONS.SURVIVAL_GATES_NOT_PASSED,

      REVALIDATION_REQUIRED: AUTO_BLOCK_REASONS.DATA_QUALITY_NOT_VERIFIED,

      WAIT: AUTO_BLOCK_REASONS.SAME_DAY_EVIDENCE_MISSING,

      PAPER_ONLY: AUTO_BLOCK_REASONS.PROOF_GATES_NOT_IMPLEMENTED,

      TINY_CANARY_ONLY: AUTO_BLOCK_REASONS.ALPHA_NOT_PROVEN,

      MANUAL_ONLY: AUTO_BLOCK_REASONS.NO_TRADE_PERMISSION,

      WATCH: AUTO_BLOCK_REASONS.ALPHA_NOT_PROVEN,

    };



    return {

      autoExecutionEnabled: false,

      autoBlockedReason:

        reasonMap[unlock.decision] ?? AUTO_BLOCK_REASONS.EXECUTION_QUALITY_NOT_VERIFIED,

      autoState: "LOCKED",

      unlockDecision: unlock.decision,

      failedGates: unlock.failedGateIds,

    };

  }



  return {

    autoExecutionEnabled: true,

    autoBlockedReason: null,

    autoState: "READY",

    unlockDecision: unlock.decision,

    failedGates: [],

  };

}

