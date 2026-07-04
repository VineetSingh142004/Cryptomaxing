export interface DefiLlamaSummary {
  symbol: string;
  totalTvlUsd: number | null;
  protocolCount: number | null;
  chainCount: number | null;
  status: "ok" | "unavailable" | "disabled";
  error?: string;
}

export async function fetchDefiLlamaSummary(): Promise<DefiLlamaSummary> {
  if (process.env.DEFILLAMA_ENABLED === "false") {
    return {
      symbol: "GLOBAL",
      totalTvlUsd: null,
      protocolCount: null,
      chainCount: null,
      status: "disabled",
    };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const [chainsRes, protocolsRes] = await Promise.all([
      fetch("https://api.llama.fi/v2/chains", { signal: controller.signal }),
      fetch("https://api.llama.fi/protocols", { signal: controller.signal }),
    ]);
    clearTimeout(timeout);
    if (!chainsRes.ok || !protocolsRes.ok) {
      return {
        symbol: "GLOBAL",
        totalTvlUsd: null,
        protocolCount: null,
        chainCount: null,
        status: "unavailable",
        error: "DeFiLlama HTTP error",
      };
    }
    const chains = (await chainsRes.json()) as Array<{ tvl?: number }>;
    const protocols = (await protocolsRes.json()) as unknown[];
    const totalTvlUsd = chains.reduce((s, c) => s + (c.tvl ?? 0), 0);
    return {
      symbol: "GLOBAL",
      totalTvlUsd,
      protocolCount: protocols.length,
      chainCount: chains.length,
      status: "ok",
    };
  } catch (err) {
    return {
      symbol: "GLOBAL",
      totalTvlUsd: null,
      protocolCount: null,
      chainCount: null,
      status: "unavailable",
      error: err instanceof Error ? err.message : "DeFiLlama fetch failed",
    };
  }
}
