import { describe, expect, it } from "vitest";
import { AppError, isAppError, toErrorResponse } from "@/lib/security/errors";

describe("AppError", () => {
  it("maps AUTO_EXECUTION_BLOCKED to 403", () => {
    const err = new AppError("AUTO_EXECUTION_BLOCKED", "Auto blocked", {
      reasonCode: "PROOF_GATES_NOT_IMPLEMENTED",
    });
    expect(err.statusCode).toBe(403);
    expect(isAppError(err)).toBe(true);
  });

  it("formats unknown errors safely", () => {
    const response = toErrorResponse(new Error("boom"));
    expect(response.statusCode).toBe(500);
    expect(response.error.code).toBe("INTERNAL_ERROR");
    expect(response.error.message).not.toContain("boom");
  });
});
