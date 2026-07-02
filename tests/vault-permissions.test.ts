import { describe, expect, it } from "vitest";
import { validatePermissionsForStorage } from "@/lib/vault/permissions";

describe("vault permissions", () => {
  it("blocks withdrawal-enabled keys", () => {
    const result = validatePermissionsForStorage({
      canRead: true,
      canTrade: true,
      canWithdraw: true,
      detected: true,
      reasonCode: "WITHDRAWAL_DETECTED",
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("BLOCKED_WITHDRAWAL");
  });

  it("allows read-only with unknown detection", () => {
    const result = validatePermissionsForStorage({
      canRead: true,
      canTrade: false,
      canWithdraw: false,
      detected: false,
      reasonCode: "PERMISSION_DETECTION_NOT_IMPLEMENTED",
    });
    expect(result.allowed).toBe(true);
    expect(result.status).toBe("PERMISSION_UNKNOWN");
  });
});
