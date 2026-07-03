import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  credentialStatusLabel,
  isEnabledCredentialStatus,
  resolveVerifyCredentialSelection,
} from "@/lib/vault/credential-status";
import { formatVerifyReasonMessage } from "@/lib/utils/verify-readonly-messages";
import { validatePermissionsForStorage } from "@/lib/vault/permissions";

describe("credential enable/disable status", () => {
  it("treats ACTIVE and PERMISSION_UNKNOWN as enabled", () => {
    expect(isEnabledCredentialStatus("ACTIVE")).toBe(true);
    expect(isEnabledCredentialStatus("PERMISSION_UNKNOWN")).toBe(true);
    expect(credentialStatusLabel("ACTIVE")).toBe("ENABLED");
  });

  it("treats DISABLED and EMERGENCY_DISABLED as disabled", () => {
    expect(isEnabledCredentialStatus("DISABLED")).toBe(false);
    expect(isEnabledCredentialStatus("EMERGENCY_DISABLED")).toBe(false);
    expect(credentialStatusLabel("DISABLED")).toBe("DISABLED");
    expect(credentialStatusLabel("EMERGENCY_DISABLED")).toBe("DISABLED");
  });

  it("newly saved read-only credentials default to enabled status", () => {
    const validation = validatePermissionsForStorage({
      canRead: true,
      canTrade: false,
      canWithdraw: false,
      detected: false,
      reasonCode: "READ_ONLY_ATTESTATION_ONLY",
    });
    expect(validation.allowed).toBe(true);
    expect(validation.status).toBe("PERMISSION_UNKNOWN");
    expect(isEnabledCredentialStatus(validation.status)).toBe(true);
  });
});

describe("verify credential selection", () => {
  it("returns NO_CREDENTIAL_CONFIGURED when nothing is stored", () => {
    expect(
      resolveVerifyCredentialSelection({
        credentialFound: false,
        credentialEnabled: false,
        anyExchangeCredentialExists: false,
      }),
    ).toEqual({ kind: "no_credential", reasonCode: "NO_CREDENTIAL_CONFIGURED" });
  });

  it("returns NO_ENABLED_CREDENTIAL when only disabled credentials exist", () => {
    expect(
      resolveVerifyCredentialSelection({
        credentialFound: false,
        credentialEnabled: false,
        anyExchangeCredentialExists: true,
      }),
    ).toEqual({ kind: "no_enabled", reasonCode: "NO_ENABLED_CREDENTIAL" });
  });

  it("returns CREDENTIAL_DISABLED when an explicit disabled credential is selected", () => {
    expect(
      resolveVerifyCredentialSelection({
        credentialFound: true,
        credentialEnabled: false,
        anyExchangeCredentialExists: true,
      }),
    ).toEqual({ kind: "disabled", reasonCode: "CREDENTIAL_DISABLED" });
  });

  it("uses enabled credentials for verification", () => {
    expect(
      resolveVerifyCredentialSelection({
        credentialFound: true,
        credentialEnabled: true,
        anyExchangeCredentialExists: true,
      }),
    ).toEqual({ kind: "use", reasonCode: null });
  });
});

describe("verify readonly user messages", () => {
  it("shows disabled credential guidance", () => {
    expect(formatVerifyReasonMessage("CREDENTIAL_DISABLED")).toContain("disabled");
    expect(formatVerifyReasonMessage("NO_ENABLED_CREDENTIAL")).toContain("Delete them");
  });

  it("never includes secret-like placeholders in messages", () => {
    const codes = [
      "NO_CREDENTIAL_CONFIGURED",
      "NO_ENABLED_CREDENTIAL",
      "CREDENTIAL_DISABLED",
      "CREDENTIAL_DECRYPT_FAILED",
      "READ_ONLY_KEY_READY",
    ] as const;
    const serialized = codes.map((code) => formatVerifyReasonMessage(code)).join(" ");
    expect(serialized).not.toMatch(/api[_-]?secret|password/i);
  });
});

describe("dashboard-shell HTML validity", () => {
  it("does not render Badge inside p tags", () => {
    const source = readFileSync(resolve(process.cwd(), "components/dashboard-shell.tsx"), "utf8");
    const jsx = source.slice(source.indexOf("return ("));
    const pBlocks = jsx.match(/<p[\s>][\s\S]*?<\/p>/g) ?? [];
    const nested = pBlocks.filter((block) => /<Badge/.test(block));
    expect(nested).toEqual([]);
  });

  it("uses div wrapper for verify result Badge row", () => {
    const source = readFileSync(resolve(process.cwd(), "components/dashboard-shell.tsx"), "utf8");
    expect(source).toContain('className="flex items-center gap-2"');
    expect(source).toContain("<span>Result:</span>");
  });
});

describe("delete credential API contract", () => {
  it("delete route returns metadata only shape", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/vault/[id]/route.ts"), "utf8");
    expect(source).toContain("deleteProviderCredential");
    expect(source).not.toContain("encryptedKey");
    expect(source).not.toContain("encryptedSecret");
  });
});
