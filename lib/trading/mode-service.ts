import type { TradingMode, ModeState } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { writeAuditLog } from "@/lib/logger/audit";
import { AppError } from "@/lib/security/errors";
import {
  DEFAULT_SYSTEM_USER_EMAIL,
  type AutoBlockReason,
} from "@/lib/config/constants";
import type { ModeResponse } from "@/lib/types";
import { evaluateAutoExecution } from "@/lib/trading/mode-evaluation";

export { evaluateAutoExecution } from "@/lib/trading/mode-evaluation";

let cachedSystemUserId: string | null = null;

async function getOrCreateSystemUser(): Promise<string> {
  if (cachedSystemUserId) return cachedSystemUserId;

  const user = await prisma.user.upsert({
    where: { email: DEFAULT_SYSTEM_USER_EMAIL },
    create: {
      email: DEFAULT_SYSTEM_USER_EMAIL,
      name: "System",
    },
    update: {},
  });

  cachedSystemUserId = user.id;
  return user.id;
}

function toModeResponse(state: ModeState): ModeResponse {
  return {
    current_mode: state.currentMode.toLowerCase() as ModeResponse["current_mode"],
    paper_enabled: state.paperEnabled,
    manual_enabled: state.manualEnabled,
    auto_visible: state.autoVisible,
    auto_selected: state.autoSelected,
    auto_execution_enabled: state.autoExecutionEnabled,
    auto_blocked_reason: (state.autoBlockedReason as AutoBlockReason | null) ?? null,
    auto_state: state.autoState.toLowerCase() as ModeResponse["auto_state"],
    last_changed_at: state.lastChangedAt.toISOString(),
  };
}

export async function getOrCreateModeState(): Promise<ModeResponse> {
  const userId = await getOrCreateSystemUser();

  let state = await prisma.modeState.findUnique({ where: { userId } });

  if (!state) {
    const autoEval = evaluateAutoExecution({
      emergencyPaused: false,
      autoSelected: false,
      currentMode: "PAPER",
    });

    state = await prisma.modeState.create({
      data: {
        userId,
        currentMode: "PAPER",
        paperEnabled: true,
        manualEnabled: true,
        autoVisible: true,
        autoSelected: false,
        autoExecutionEnabled: autoEval.autoExecutionEnabled,
        autoBlockedReason: autoEval.autoBlockedReason,
        autoState: autoEval.autoState,
        emergencyPaused: false,
        lastChangedAt: new Date(),
      },
    });
  } else {
    const autoEval = evaluateAutoExecution(state);
    if (
      state.autoExecutionEnabled !== autoEval.autoExecutionEnabled ||
      state.autoBlockedReason !== autoEval.autoBlockedReason ||
      state.autoState !== autoEval.autoState
    ) {
      state = await prisma.modeState.update({
        where: { id: state.id },
        data: {
          autoExecutionEnabled: autoEval.autoExecutionEnabled,
          autoBlockedReason: autoEval.autoBlockedReason,
          autoState: autoEval.autoState,
        },
      });
    }
  }

  return toModeResponse(state);
}

export async function setMode(input: {
  mode: "paper" | "manual" | "auto";
  emergencyPause?: boolean;
  changedBy?: string;
  ipAddress?: string;
}): Promise<ModeResponse> {
  const userId = await getOrCreateSystemUser();
  const modeMap: Record<string, TradingMode> = {
    paper: "PAPER",
    manual: "MANUAL",
    auto: "AUTO",
  };

  const targetMode = modeMap[input.mode];
  if (!targetMode) {
    throw new AppError("VALIDATION_ERROR", "Invalid mode", {
      reasonCode: "INVALID_MODE",
      details: { mode: input.mode },
    });
  }

  let state = await prisma.modeState.findUnique({ where: { userId } });
  if (!state) {
    await getOrCreateModeState();
    state = await prisma.modeState.findUnique({ where: { userId } });
  }

  if (!state) {
    throw new AppError("INTERNAL_ERROR", "Failed to initialize mode state");
  }

  const emergencyPaused = input.emergencyPause ?? state.emergencyPaused;
  const autoSelected = targetMode === "AUTO";
  const autoEval = evaluateAutoExecution({
    emergencyPaused,
    autoSelected,
    currentMode: targetMode,
  });

  if (targetMode === "AUTO" && !autoEval.autoExecutionEnabled) {
    await writeAuditLog({
      userId,
      action: "AUTO_BLOCKED",
      entityType: "mode_state",
      entityId: state.id,
      reasonCode: autoEval.autoBlockedReason ?? undefined,
      detail: {
        requestedMode: targetMode,
        message: "Auto mode selectable but execution locked until all gates pass",
      },
      ipAddress: input.ipAddress,
    });
  }

  const updated = await prisma.modeState.update({
    where: { id: state.id },
    data: {
      currentMode: targetMode,
      autoSelected,
      autoExecutionEnabled: autoEval.autoExecutionEnabled,
      autoBlockedReason: autoEval.autoBlockedReason,
      autoState: autoEval.autoState,
      emergencyPaused,
      lastChangedAt: new Date(),
      lastChangedBy: input.changedBy,
    },
  });

  await writeAuditLog({
    userId,
    action: input.emergencyPause ? "EMERGENCY_PAUSE" : "MODE_CHANGED",
    entityType: "mode_state",
    entityId: updated.id,
    reasonCode: autoEval.autoBlockedReason ?? undefined,
    detail: {
      previousMode: state.currentMode,
      newMode: targetMode,
      autoExecutionEnabled: autoEval.autoExecutionEnabled,
      emergencyPaused,
    },
    ipAddress: input.ipAddress,
  });

  return toModeResponse(updated);
}

export { getOrCreateSystemUser };
