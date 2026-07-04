import "server-only";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderTypeId } from "@/lib/vault/types";
import type { ConnectionTestResult } from "@/lib/vault/types";

export type PublicProviderId = Extract<ProviderTypeId, "DEX_SCREENER" | "DEFILLAMA">;

export interface StoredPublicProviderTest {
  provider: PublicProviderId;
  success: boolean;
  reasonCode: string;
  message: string;
  status: string;
  endpointTested?: string;
  latencyMs: number;
  keyUsed: boolean;
  publicFallbackUsed: boolean;
  rateLimitStatus?: string | null;
  testedAt: string;
}

const STORE_DIR = join(process.cwd(), ".data");
const STORE_FILE = join(STORE_DIR, "public-provider-tests.json");

function readStore(): Record<string, StoredPublicProviderTest> {
  try {
    if (!existsSync(STORE_FILE)) return {};
    return JSON.parse(readFileSync(STORE_FILE, "utf8")) as Record<string, StoredPublicProviderTest>;
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, StoredPublicProviderTest>): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function savePublicProviderTest(
  provider: PublicProviderId,
  test: ConnectionTestResult,
): StoredPublicProviderTest {
  const entry: StoredPublicProviderTest = {
    provider,
    success: test.success,
    reasonCode: test.reasonCode,
    message: test.message,
    status: test.status,
    endpointTested: test.endpointTested,
    latencyMs: test.latencyMs,
    keyUsed: test.keyUsed ?? false,
    publicFallbackUsed: test.publicFallbackUsed ?? true,
    rateLimitStatus: test.rateLimitStatus ?? null,
    testedAt: new Date().toISOString(),
  };
  const store = readStore();
  store[provider] = entry;
  writeStore(store);
  return entry;
}

export function getPublicProviderTest(
  provider: PublicProviderId,
): StoredPublicProviderTest | null {
  return readStore()[provider] ?? null;
}

export function getAllPublicProviderTests(): Partial<
  Record<PublicProviderId, StoredPublicProviderTest>
> {
  const store = readStore();
  return {
    DEX_SCREENER: store.DEX_SCREENER,
    DEFILLAMA: store.DEFILLAMA,
  };
}
