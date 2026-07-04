import { describe, expect, it, vi, afterEach } from "vitest";
import {
  enrichCandidateWithDexScreener,
  attachDefiLlamaContext,
  buildRunProviderContributions,
} from "@/lib/trading/paper/provider-contribution";

vi.mock("@/lib/vault/provider-settings", () => ({
  getProviderEnvSettings: () => ({
    dexscreenerEnabled: true,
    defillamaEnabled: true,
    coingeckoApiKey: undefined,
    lunarcrushApiKey: undefined,
    lunarcrushEnabled: false,
  }),
}));

describe("provider contribution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DexScreener mapping unknown does not throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ pairs: [] }), { status: 200 })),
    );
    const result = await enrichCandidateWithDexScreener("NOTREAL");
    expect(result.dexscreenerUsed).toBe(false);
    expect(result.dexscreenerSkipReason).toBe("MAPPING_UNKNOWN");
  });

  it("DexScreener ok marks used with liquidity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            pairs: [
              {
                baseToken: { symbol: "ETH" },
                liquidity: { usd: 1000000 },
                volume: { h24: 500000 },
                txns: { h24: { buys: 60, sells: 40 } },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await enrichCandidateWithDexScreener("ETH");
    expect(result.dexscreenerUsed).toBe(true);
    expect(result.dexscreenerLiquidity).toBe(1000000);
  });

  it("DeFiLlama per-coin uses MAPPING_UNKNOWN with global context", () => {
    const result = attachDefiLlamaContext(
      {
        symbol: "GLOBAL",
        totalTvlUsd: 100,
        protocolCount: 10,
        chainCount: 5,
        status: "ok",
      },
      "BTC",
    );
    expect(result.defillamaUsed).toBe(false);
    expect(result.defillamaSkipReason).toBe("MAPPING_UNKNOWN");
    expect(result.defillamaTvl).toBe(100);
  });

  it("buildRunProviderContributions tracks dex enrichment count", () => {
    const run = buildRunProviderContributions({
      coingeckoStatus: "ok",
      krakenStatus: "ok",
      dexscreenerStatus: "ok",
      defillamaStatus: "ok",
      lunarcrushStatus: "disabled",
      candidateContributions: [
        { dexscreenerUsed: true } as never,
        { dexscreenerUsed: false } as never,
      ],
    });
    expect(run.dexscreenerContributed).toBe(true);
    expect(run.dexscreenerCandidatesEnriched).toBe(1);
  });
});
