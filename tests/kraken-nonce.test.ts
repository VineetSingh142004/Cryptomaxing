import { describe, expect, it } from "vitest";
import {
  createKrakenNonceManager,
  InMemoryKrakenNonceManager,
  isKrakenInvalidNonceError,
  krakenApiKeyScope,
} from "@/lib/trading/exchange/kraken-nonce";

describe("Kraken nonce manager", () => {
  it("increases nonce across repeated calls", async () => {
    const manager = new InMemoryKrakenNonceManager();
    const first = BigInt(await manager.nextNonce());
    const second = BigInt(await manager.nextNonce());
    expect(second).toBeGreaterThan(first);
  });

  it("bumpNonce guarantees a higher value", async () => {
    const manager = new InMemoryKrakenNonceManager();
    const first = BigInt(await manager.nextNonce());
    const bumped = BigInt(await manager.bumpNonce(first));
    expect(bumped).toBeGreaterThan(first);
  });

  it("scopes keys by hash without exposing raw API key in scope id", () => {
    const scope = krakenApiKeyScope("super-secret-api-key-value");
    expect(scope).not.toContain("super-secret-api-key-value");
    expect(scope).toHaveLength(64);
  });

  it("in-memory manager creates unique nonces within same millisecond", async () => {
    const manager = new InMemoryKrakenNonceManager();
    const values = new Set<string>();
    for (let i = 0; i < 5; i++) {
      values.add(await manager.nextNonce());
    }
    expect(values.size).toBe(5);
  });

  it("createKrakenNonceManager works without credentialId (memory scope)", async () => {
    const manager = createKrakenNonceManager({ apiKey: "test-key-only" });
    const n1 = await manager.nextNonce();
    const n2 = await manager.nextNonce();
    expect(BigInt(n2)).toBeGreaterThan(BigInt(n1));
  });

  it("detects Kraken invalid nonce errors", () => {
    expect(isKrakenInvalidNonceError(["EAPI:Invalid nonce"])).toBe(true);
    expect(isKrakenInvalidNonceError(["EAPI:Invalid key"])).toBe(false);
  });
});
