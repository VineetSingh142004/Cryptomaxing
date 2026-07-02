import { prisma } from "@/lib/db/client";
import { testPublicProvider, testProviderConnection } from "@/lib/vault/provider-health";
import type { ProviderHealthResult } from "@/lib/vault/types";
import { PROVIDER_METADATA } from "@/lib/vault/types";

export async function checkAllProviderHealth(): Promise<ProviderHealthResult[]> {
  const credentials = await prisma.providerCredential.findMany({
    where: { status: { in: ["ACTIVE", "PERMISSION_UNKNOWN"] } },
  });

  const results: ProviderHealthResult[] = [];

  for (const cred of credentials) {
    const test = await testProviderConnection({
      provider: cred.provider,
      encryptedKey: cred.encryptedKey,
      encryptedSecret: cred.encryptedSecret,
      encryptedPassphrase: cred.encryptedPassphrase,
      encryptionMethod: cred.encryptionMethod,
    });

    await prisma.providerCredential.update({
      where: { id: cred.id },
      data: {
        lastHealthCheckAt: new Date(),
        lastHealthStatus: test.success ? "ok" : "error",
        lastLatencyMs: test.latencyMs,
      },
    });

    await prisma.providerHealthLog.create({
      data: {
        credentialId: cred.id,
        status: test.status,
        latencyMs: test.latencyMs,
        reasonCode: test.reasonCode,
        detail: { message: test.message },
        checkedAt: new Date(),
      },
    });

    results.push({
      provider: cred.provider,
      credentialId: cred.id,
      status: test.success ? "ok" : "error",
      latencyMs: test.latencyMs,
      reasonCode: test.reasonCode,
      message: test.message,
      checkedAt: new Date().toISOString(),
    });
  }

  const credProviders = new Set(credentials.map((c) => c.provider));

  for (const [provider, meta] of Object.entries(PROVIDER_METADATA)) {
    if (credProviders.has(provider as typeof credentials[0]["provider"])) continue;
    if (meta.category === "exchange") continue;

    const test = await testPublicProvider(provider as typeof credentials[0]["provider"]);
    results.push({
      provider: provider as typeof credentials[0]["provider"],
      credentialId: null,
      status: test.success ? "ok" : "degraded",
      latencyMs: test.latencyMs,
      reasonCode: test.reasonCode,
      message: `${meta.label} public endpoint`,
      checkedAt: new Date().toISOString(),
    });
  }

  return results;
}
