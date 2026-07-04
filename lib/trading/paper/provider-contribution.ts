import { fetchDexScreenerSummary } from "@/lib/trading/data/providers/dexscreener";
import type { DefiLlamaSummary } from "@/lib/trading/data/providers/defillama";
import { getProviderEnvSettings } from "@/lib/vault/provider-settings";

export type ProviderSkipReason =
  | "MAPPING_UNKNOWN"
  | "NOT_RELEVANT"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "SKIPPED_BY_PIPELINE_STAGE"
  | "PROVIDER_DISABLED"
  | "DATA_NOT_AVAILABLE";

export interface ProviderContribution {
  dataSourcesUsed: string[];
  coingeckoUsed: boolean;
  krakenUsed: boolean;
  dexscreenerUsed: boolean;
  defillamaUsed: boolean;
  lunarcrushUsed: boolean;
  dexscreenerLiquidity: number | null;
  dexscreenerVolume24h: number | null;
  dexscreenerBuyPressure: number | null;
  defillamaTvl: number | null;
  defillamaChainActivity: number | null;
  providerWarnings: string[];
  dexscreenerSkipReason?: ProviderSkipReason;
  defillamaSkipReason?: ProviderSkipReason;
}

export interface RunProviderContributions {
  coingeckoContributed: boolean;
  krakenContributed: boolean;
  dexscreenerContributed: boolean;
  defillamaContributed: boolean;
  lunarcrushContributed: boolean;
  dexscreenerCandidatesEnriched: number;
  defillamaGlobalAvailable: boolean;
}

export const DEXSCREENER_ENRICH_LIMIT = 8;

export function emptyProviderContribution(
  partial?: Partial<ProviderContribution>,
): ProviderContribution {
  return {
    dataSourcesUsed: [],
    coingeckoUsed: false,
    krakenUsed: false,
    dexscreenerUsed: false,
    defillamaUsed: false,
    lunarcrushUsed: false,
    dexscreenerLiquidity: null,
    dexscreenerVolume24h: null,
    dexscreenerBuyPressure: null,
    defillamaTvl: null,
    defillamaChainActivity: null,
    providerWarnings: [],
    ...partial,
  };
}

function buyPressure(buys: number | null, sells: number | null): number | null {
  if (buys == null || sells == null) return null;
  const total = buys + sells;
  if (total <= 0) return null;
  return Math.round((buys / total) * 100);
}

export async function enrichCandidateWithDexScreener(
  baseAsset: string,
): Promise<ProviderContribution> {
  const env = getProviderEnvSettings();
  if (!env.dexscreenerEnabled) {
    return emptyProviderContribution({
      dexscreenerSkipReason: "PROVIDER_DISABLED",
      providerWarnings: ["DexScreener disabled via DEXSCREENER_ENABLED=false"],
    });
  }

  const dex = await fetchDexScreenerSummary(baseAsset);
  if (dex.status === "unavailable") {
    return emptyProviderContribution({
      dexscreenerSkipReason: "PROVIDER_UNAVAILABLE",
      providerWarnings: [`DexScreener unavailable: ${dex.error ?? "unknown"}`],
    });
  }
  if (dex.status === "not_found") {
    return emptyProviderContribution({
      dexscreenerSkipReason: "MAPPING_UNKNOWN",
      providerWarnings: [`No DexScreener pair mapping for ${baseAsset}`],
    });
  }

  const pressure = buyPressure(dex.buys24h, dex.sells24h);
  return emptyProviderContribution({
    dataSourcesUsed: ["dexscreener"],
    dexscreenerUsed: true,
    dexscreenerLiquidity: dex.liquidityUsd,
    dexscreenerVolume24h: dex.volume24hUsd,
    dexscreenerBuyPressure: pressure,
  });
}

export function attachDefiLlamaContext(
  defiGlobal: DefiLlamaSummary | null,
  baseAsset: string,
): ProviderContribution {
  const env = getProviderEnvSettings();
  if (!env.defillamaEnabled || defiGlobal?.status === "disabled") {
    return emptyProviderContribution({
      defillamaSkipReason: "PROVIDER_DISABLED",
    });
  }
  if (!defiGlobal || defiGlobal.status === "unavailable") {
    return emptyProviderContribution({
      defillamaSkipReason: "PROVIDER_UNAVAILABLE",
      providerWarnings: ["DeFiLlama global data unavailable"],
    });
  }

  return emptyProviderContribution({
    defillamaSkipReason: "MAPPING_UNKNOWN",
    defillamaTvl: defiGlobal.totalTvlUsd,
    defillamaChainActivity: defiGlobal.chainCount,
    providerWarnings: [
      `DeFiLlama global ecosystem data available; no per-coin protocol mapping for ${baseAsset}`,
    ],
  });
}

export function mergeContributions(
  ...parts: ProviderContribution[]
): ProviderContribution {
  const merged = emptyProviderContribution();
  for (const p of parts) {
    merged.dataSourcesUsed = [...new Set([...merged.dataSourcesUsed, ...p.dataSourcesUsed])];
    merged.coingeckoUsed ||= p.coingeckoUsed;
    merged.krakenUsed ||= p.krakenUsed;
    merged.dexscreenerUsed ||= p.dexscreenerUsed;
    merged.defillamaUsed ||= p.defillamaUsed;
    merged.lunarcrushUsed ||= p.lunarcrushUsed;
    if (p.dexscreenerLiquidity != null) merged.dexscreenerLiquidity = p.dexscreenerLiquidity;
    if (p.dexscreenerVolume24h != null) merged.dexscreenerVolume24h = p.dexscreenerVolume24h;
    if (p.dexscreenerBuyPressure != null) merged.dexscreenerBuyPressure = p.dexscreenerBuyPressure;
    if (p.defillamaTvl != null) merged.defillamaTvl = p.defillamaTvl;
    if (p.defillamaChainActivity != null) merged.defillamaChainActivity = p.defillamaChainActivity;
    merged.providerWarnings.push(...p.providerWarnings);
    merged.dexscreenerSkipReason ??= p.dexscreenerSkipReason;
    merged.defillamaSkipReason ??= p.defillamaSkipReason;
  }
  return merged;
}

export async function enrichRankedCandidates(
  symbols: string[],
  defiGlobal: DefiLlamaSummary | null,
  options?: { dexLimit?: number; enrichDex?: boolean },
): Promise<Map<string, ProviderContribution>> {
  const limit = options?.dexLimit ?? DEXSCREENER_ENRICH_LIMIT;
  const enrichDex = options?.enrichDex ?? getProviderEnvSettings().dexscreenerEnabled;
  const out = new Map<string, ProviderContribution>();

  for (let i = 0; i < symbols.length; i++) {
    const baseAsset = symbols[i]!.split("/")[0] ?? symbols[i]!;
    const defiPart = attachDefiLlamaContext(defiGlobal, baseAsset);
    let dexPart = emptyProviderContribution();

    if (enrichDex && i < limit) {
      dexPart = await enrichCandidateWithDexScreener(baseAsset);
    } else if (enrichDex) {
      dexPart = emptyProviderContribution({
        dexscreenerSkipReason: "SKIPPED_BY_PIPELINE_STAGE",
      });
    } else {
      dexPart = emptyProviderContribution({
        dexscreenerSkipReason: "PROVIDER_DISABLED",
      });
    }

    out.set(symbols[i]!, mergeContributions(defiPart, dexPart));
  }

  return out;
}

export function buildRunProviderContributions(input: {
  coingeckoStatus: string;
  krakenStatus: string;
  dexscreenerStatus: string;
  defillamaStatus: string;
  lunarcrushStatus: string;
  candidateContributions: Iterable<ProviderContribution>;
}): RunProviderContributions {
  let dexCount = 0;
  for (const c of input.candidateContributions) {
    if (c.dexscreenerUsed) dexCount++;
  }

  return {
    coingeckoContributed: input.coingeckoStatus === "ok",
    krakenContributed: input.krakenStatus === "ok",
    dexscreenerContributed: dexCount > 0 || input.dexscreenerStatus === "ok",
    defillamaContributed: input.defillamaStatus === "ok",
    lunarcrushContributed: input.lunarcrushStatus === "ok",
    dexscreenerCandidatesEnriched: dexCount,
    defillamaGlobalAvailable: input.defillamaStatus === "ok",
  };
}
