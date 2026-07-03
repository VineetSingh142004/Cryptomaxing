import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logger";

export type AuditAction =
  | "MODE_CHANGED"
  | "AUTO_BLOCKED"
  | "AUTO_SELECTED"
  | "EMERGENCY_PAUSE"
  | "TRADE_PERMISSION"
  | "NO_TRADE_DECISION"
  | "RISK_EVENT"
  | "PROOF_GATE_EVALUATED"
  | "STRATEGY_CHANGED"
  | "PARAMETER_CHANGED"
  | "RECONCILIATION"
  | "HEALTH_CHECK"
  | "API_KEY_CREATED"
  | "API_KEY_DISABLED"
  | "API_KEY_DELETED"
  | "API_KEY_EMERGENCY_DISABLE"
  | "API_KEY_CONNECTION_TEST";

export interface AuditLogInput {
  userId?: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  reasonCode?: string;
  detail?: Record<string, unknown>;
  ipAddress?: string;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const occurredAt = new Date();

  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        reasonCode: input.reasonCode,
        detail: input.detail ? (input.detail as Prisma.InputJsonValue) : undefined,
        ipAddress: input.ipAddress,
        occurredAt,
      },
    });
  } catch (error) {
    logger.error(
      { err: error, action: input.action, reasonCode: input.reasonCode },
      "Failed to persist audit log",
    );
  }

  logger.info(
    {
      audit: true,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reasonCode: input.reasonCode,
    },
    `Audit: ${input.action}`,
  );
}
