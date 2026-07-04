export interface LunarCrushSummary {
  symbol: string;
  galaxyScore: number | null;
  altRank: number | null;
  socialVolume: number | null;
  sentiment: number | null;
  trending: boolean | null;
  status: "ok" | "unavailable" | "disabled" | "no_key";
  error?: string;
}

export async function fetchLunarCrushSummary(baseAsset: string): Promise<LunarCrushSummary> {
  const symbol = baseAsset.toUpperCase();
  if (process.env.LUNARCRUSH_ENABLED !== "true") {
    return {
      symbol,
      galaxyScore: null,
      altRank: null,
      socialVolume: null,
      sentiment: null,
      trending: null,
      status: "disabled",
    };
  }
  const apiKey = process.env.LUNARCRUSH_API_KEY?.trim();
  if (!apiKey) {
    return {
      symbol,
      galaxyScore: null,
      altRank: null,
      socialVolume: null,
      sentiment: null,
      trending: null,
      status: "no_key",
    };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(
      `https://lunarcrush.com/api4/public/coins/${encodeURIComponent(symbol.toLowerCase())}/v1`,
      {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    clearTimeout(timeout);
    if (!res.ok) {
      return {
        symbol,
        galaxyScore: null,
        altRank: null,
        socialVolume: null,
        sentiment: null,
        trending: null,
        status: "unavailable",
        error: `HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as {
      data?: {
        galaxy_score?: number;
        alt_rank?: number;
        social_volume?: number;
        sentiment?: number;
        topic?: string;
      };
    };
    const d = json.data;
    return {
      symbol,
      galaxyScore: d?.galaxy_score ?? null,
      altRank: d?.alt_rank ?? null,
      socialVolume: d?.social_volume ?? null,
      sentiment: d?.sentiment ?? null,
      trending: d?.alt_rank !== undefined ? (d.alt_rank ?? 9999) <= 100 : null,
      status: "ok",
    };
  } catch (err) {
    return {
      symbol,
      galaxyScore: null,
      altRank: null,
      socialVolume: null,
      sentiment: null,
      trending: null,
      status: "unavailable",
      error: err instanceof Error ? err.message : "LunarCrush fetch failed",
    };
  }
}
