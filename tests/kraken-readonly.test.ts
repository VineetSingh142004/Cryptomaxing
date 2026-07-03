import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildKrakenSignedRequestShape,
  krakenPrivateRequest,
  ReadOnlyApiForbidsMutationError,
  signKrakenRequest,
  verifyKrakenReadOnlyKey,
} from "@/lib/trading/exchange/kraken-readonly";
import { InMemoryKrakenNonceManager } from "@/lib/trading/exchange/kraken-nonce";

const TEST_SECRET = Buffer.from("test-secret-key-for-kraken-signing!!").toString("base64");
const TEST_KEY = "test-api-key";

function mockFetch(response: { error?: string[]; result?: unknown }, ok = true) {
  return vi.fn(async () => ({
    ok,
    text: async () => JSON.stringify(response),
  })) as unknown as typeof fetch;
}

describe("Kraken read-only client", () => {
  it("rejects forbidden mutation endpoints", async () => {
    await expect(
      krakenPrivateRequest("AddOrder", { apiKey: TEST_KEY, apiSecret: TEST_SECRET }),
    ).rejects.toBeInstanceOf(ReadOnlyApiForbidsMutationError);

    await expect(
      krakenPrivateRequest("CancelOrder", { apiKey: TEST_KEY, apiSecret: TEST_SECRET }),
    ).rejects.toBeInstanceOf(ReadOnlyApiForbidsMutationError);

    await expect(
      krakenPrivateRequest("Withdraw", { apiKey: TEST_KEY, apiSecret: TEST_SECRET }),
    ).rejects.toBeInstanceOf(ReadOnlyApiForbidsMutationError);
  });

  it("does not call AddOrder, CancelOrder, or Withdraw", async () => {
    const fetchImpl = mockFetch({ result: {} });
    try {
      await krakenPrivateRequest("AddOrder", { apiKey: TEST_KEY, apiSecret: TEST_SECRET }, {}, { fetchImpl });
    } catch {
      // expected
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("URL-encoded body includes nonce", () => {
    const shape = buildKrakenSignedRequestShape("Balance", TEST_SECRET, {}, "1234567890000");
    expect(shape.path).toBe("/0/private/Balance");
    expect(shape.bodyKeys).toContain("nonce");
    expect(shape.postData.startsWith("nonce=")).toBe(true);
    expect(shape.apiSignLength).toBeGreaterThan(0);
  });

  it("signKrakenRequest uses path and hash separately", () => {
    const path = "/0/private/Balance";
    const nonce = "1234567890000";
    const postData = "nonce=1234567890000";
    const sig = signKrakenRequest(path, nonce, postData, TEST_SECRET);
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("signs requests server-side and calls mocked balance endpoint", async () => {
    const nonceManager = new InMemoryKrakenNonceManager();
    const fetchImpl = mockFetch({ result: { ZUSD: "100.0000" } });
    const result = await krakenPrivateRequest(
      "Balance",
      { apiKey: TEST_KEY, apiSecret: TEST_SECRET },
      {},
      { fetchImpl, nonceManager },
    );
    expect(result.success).toBe(true);
    expect(result.reasonCode).toBe("READ_ONLY_KEY_READY");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain("/Balance");
    expect(call[1].headers).toMatchObject({ "API-Key": TEST_KEY });
    expect((call[1].headers as Record<string, string>)["API-Sign"]).toBeTruthy();
    expect(String(call[1].body)).toContain("nonce=");
  });

  it("handles invalid key with Kraken error code", async () => {
    const fetchImpl = mockFetch({ error: ["EAPI:Invalid key"] });
    const result = await krakenPrivateRequest(
      "Balance",
      { apiKey: "bad", apiSecret: TEST_SECRET },
      {},
      { fetchImpl, nonceManager: new InMemoryKrakenNonceManager() },
    );
    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe("KRAKEN_EAPI_INVALID_KEY");
    expect(result.krakenErrorCode).toBe("EAPI:Invalid key");
  });

  it("handles invalid nonce with retry", async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return { ok: true, text: async () => JSON.stringify({ error: ["EAPI:Invalid nonce"] }) };
      }
      return { ok: true, text: async () => JSON.stringify({ result: { ZUSD: "1" } }) };
    }) as unknown as typeof fetch;

    const result = await krakenPrivateRequest(
      "Balance",
      { apiKey: TEST_KEY, apiSecret: TEST_SECRET },
      {},
      { fetchImpl, nonceManager: new InMemoryKrakenNonceManager() },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.nonceRetryRequired).toBe(true);
  });

  it("maps invalid nonce after retry failure", async () => {
    const fetchImpl = mockFetch({ error: ["EAPI:Invalid nonce"] });
    const result = await krakenPrivateRequest(
      "Balance",
      { apiKey: TEST_KEY, apiSecret: TEST_SECRET },
      {},
      { fetchImpl, nonceManager: new InMemoryKrakenNonceManager() },
    );
    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe("KRAKEN_EAPI_INVALID_NONCE");
  });

  it("verifyKrakenReadOnlyKey checks endpoints sequentially with increasing nonces", async () => {
    const nonces: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const match = body.match(/nonce=([^&]+)/);
      if (match?.[1]) nonces.push(match[1]);
      const endpoint = String(_url).split("/").pop() ?? "";
      if (endpoint === "TradesHistory") {
        return { ok: true, text: async () => JSON.stringify({ result: { trades: {} } }) };
      }
      return { ok: true, text: async () => JSON.stringify({ result: {} }) };
    }) as unknown as typeof fetch;

    const result = await verifyKrakenReadOnlyKey(
      { apiKey: TEST_KEY, apiSecret: TEST_SECRET },
      { fetchImpl, nonceManager: new InMemoryKrakenNonceManager() },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(nonces.length).toBe(4);
    for (let i = 1; i < nonces.length; i++) {
      expect(BigInt(nonces[i]!)).toBeGreaterThan(BigInt(nonces[i - 1]!));
    }
    expect(result.verificationStatus).toBe("READY");
  });

  it("empty TradesHistory response counts as readable EMPTY", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const endpoint = String(url).split("/").pop() ?? "";
      if (endpoint === "TradesHistory") {
        return { ok: true, text: async () => JSON.stringify({ result: { trades: {} } }) };
      }
      return { ok: true, text: async () => JSON.stringify({ result: {} }) };
    }) as unknown as typeof fetch;

    const result = await verifyKrakenReadOnlyKey(
      { apiKey: TEST_KEY, apiSecret: TEST_SECRET },
      { fetchImpl, nonceManager: new InMemoryKrakenNonceManager() },
    );
    expect(result.canReadTradeHistory).toBe(true);
    expect(result.tradeHistoryReadStatus).toBe("EMPTY");
    expect(result.tradeHistoryCount).toBe(0);
  });

  it("private verification does not use Promise.all", () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/trading/exchange/kraken-readonly.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/Promise\.all\([\s\S]*KRAKEN_VERIFY_ENDPOINTS/);
  });

  it("never returns API secret in error messages", async () => {
    const fetchImpl = mockFetch({ error: [`bad ${TEST_SECRET}`] });
    const result = await krakenPrivateRequest(
      "Balance",
      { apiKey: TEST_KEY, apiSecret: TEST_SECRET },
      {},
      { fetchImpl, nonceManager: new InMemoryKrakenNonceManager() },
    );
    expect(result.message).not.toContain(TEST_SECRET);
    expect(result.message).toContain("[REDACTED]");
  });
});
