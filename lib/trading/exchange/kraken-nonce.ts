import "server-only";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/client";

const memoryLastNonce = new Map<string, bigint>();
const memoryLocks = new Map<string, Promise<void>>();

export function krakenApiKeyScope(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function timeBasedNonce(): bigint {
  return BigInt(Date.now()) * 1000n;
}

async function withNonceLock<T>(scope: string, fn: () => Promise<T>): Promise<T> {
  const prev = memoryLocks.get(scope) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  memoryLocks.set(scope, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function readStoredNonce(credentialId: string): Promise<bigint> {
  const row = await prisma.providerCredential.findUnique({
    where: { id: credentialId },
    select: { lastKrakenNonce: true },
  });
  if (!row?.lastKrakenNonce) return 0n;
  try {
    return BigInt(row.lastKrakenNonce);
  } catch {
    return 0n;
  }
}

async function writeStoredNonce(credentialId: string, nonce: bigint): Promise<void> {
  await prisma.providerCredential.update({
    where: { id: credentialId },
    data: { lastKrakenNonce: nonce.toString() },
  });
}

export interface KrakenNonceManager {
  nextNonce(): Promise<string>;
  bumpNonce(floor?: bigint): Promise<string>;
}

export function createKrakenNonceManager(input: {
  apiKey: string;
  credentialId?: string;
}): KrakenNonceManager {
  const scope = input.credentialId ?? krakenApiKeyScope(input.apiKey);

  async function allocateNonce(floor?: bigint): Promise<string> {
    return withNonceLock(scope, async () => {
      const timeNonce = timeBasedNonce();
      const mem = memoryLastNonce.get(scope) ?? 0n;
      const stored = input.credentialId ? await readStoredNonce(input.credentialId) : 0n;
      let last = mem > stored ? mem : stored;
      if (floor !== undefined && floor > last) last = floor;

      let next = timeNonce > last ? timeNonce : last + 1n;
      if (floor !== undefined && next <= floor) next = floor + 1n;

      memoryLastNonce.set(scope, next);
      if (input.credentialId) {
        await writeStoredNonce(input.credentialId, next);
      }
      return next.toString();
    });
  }

  return {
    nextNonce: () => allocateNonce(),
    bumpNonce: (floor) => allocateNonce(floor),
  };
}

/** Test/dev nonce manager without database persistence. */
export class InMemoryKrakenNonceManager implements KrakenNonceManager {
  private last = 0n;

  async nextNonce(): Promise<string> {
    const timeNonce = timeBasedNonce();
    this.last = timeNonce > this.last ? timeNonce : this.last + 1n;
    return this.last.toString();
  }

  async bumpNonce(floor?: bigint): Promise<string> {
    if (floor !== undefined && floor >= this.last) this.last = floor;
    const timeNonce = timeBasedNonce();
    this.last = timeNonce > this.last ? timeNonce : this.last + 1n;
    if (floor !== undefined && this.last <= floor) this.last = floor + 1n;
    return this.last.toString();
  }
}

export function isKrakenInvalidNonceError(errors: string[] | undefined): boolean {
  return (errors?.[0] ?? "").toUpperCase().includes("EAPI:INVALID NONCE");
}
