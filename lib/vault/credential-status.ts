import type { ProviderKeyStatus } from "@prisma/client";

export function isEnabledCredentialStatus(status: ProviderKeyStatus): boolean {
  return status === "ACTIVE" || status === "PERMISSION_UNKNOWN";
}

export function credentialStatusLabel(status: ProviderKeyStatus): "ENABLED" | "DISABLED" {
  return isEnabledCredentialStatus(status) ? "ENABLED" : "DISABLED";
}

export type VerifyCredentialSelection =
  | { kind: "use"; reasonCode: null }
  | { kind: "no_credential"; reasonCode: "NO_CREDENTIAL_CONFIGURED" }
  | { kind: "no_enabled"; reasonCode: "NO_ENABLED_CREDENTIAL" }
  | { kind: "disabled"; reasonCode: "CREDENTIAL_DISABLED" };

export function resolveVerifyCredentialSelection(input: {
  credentialFound: boolean;
  credentialEnabled: boolean;
  anyExchangeCredentialExists: boolean;
}): VerifyCredentialSelection {
  if (!input.credentialFound) {
    if (input.anyExchangeCredentialExists) {
      return { kind: "no_enabled", reasonCode: "NO_ENABLED_CREDENTIAL" };
    }
    return { kind: "no_credential", reasonCode: "NO_CREDENTIAL_CONFIGURED" };
  }
  if (!input.credentialEnabled) {
    return { kind: "disabled", reasonCode: "CREDENTIAL_DISABLED" };
  }
  return { kind: "use", reasonCode: null };
}
