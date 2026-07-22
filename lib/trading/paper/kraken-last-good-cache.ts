import fs from "node:fs";
import path from "node:path";
import type { KrakenPairInfo } from "@/lib/trading/paper/kraken-universe";

const CACHE_DIR = path.join(process.cwd(), ".paper-cache");
const CACHE_FILE = path.join(CACHE_DIR, "kraken-last-good.json");

const FRESH_TTL_MS = 15 * 60 * 1000;
const DEGRADED_TTL_MS = 60 * 60 * 1000;

export type KrakenCacheLabel =
  | "USING_LAST_GOOD_KRAKEN_UNIVERSE"
  | "KRAKEN_CACHE_STALE"
  | "KRAKEN_CACHE_MISSING";

export interface KrakenCacheStatus {
  label: KrakenCacheLabel;
  ageSeconds: number;
  fetchedAt: string;
  canUseForTradability: boolean;
  canOpenTrades: boolean;
  pairCount: number;
  symbolCount: number;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface KrakenLastGoodSnapshot {
  fetchedAt: string;
  assetPairs: Array<[string, KrakenPairInfo]>;
  tradableSymbols: string[];
  pairMapEntries: Array<[string, KrakenPairInfo]>;
}

let memoryCache: KrakenLastGoodSnapshot | null = null;

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function saveKrakenLastGoodCache(input: {
  pairMap: Map<string, KrakenPairInfo>;
  tradableSymbols: Set<string> | string[];
  fetchedAt?: Date;
}): void {
  const fetchedAt = (input.fetchedAt ?? new Date()).toISOString();
  const snapshot: KrakenLastGoodSnapshot = {
    fetchedAt,
    assetPairs: [...input.pairMap.entries()],
    tradableSymbols: [...(input.tradableSymbols instanceof Set ? input.tradableSymbols : input.tradableSymbols)],
    pairMapEntries: [...input.pairMap.entries()],
  };
  memoryCache = snapshot;
  try {
    ensureCacheDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(snapshot), "utf8");
  } catch {
    /* memory-only fallback */
  }
}

export function loadKrakenLastGoodCache(): KrakenLastGoodSnapshot | null {
  if (memoryCache) return memoryCache;
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as KrakenLastGoodSnapshot;
    memoryCache = raw;
    return raw;
  } catch {
    return null;
  }
}

export function clearKrakenLastGoodCache(): void {
  memoryCache = null;
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {
    /* ignore */
  }
}

export function resolveKrakenCacheStatus(now = Date.now()): KrakenCacheStatus {
  const snap = loadKrakenLastGoodCache();
  if (!snap) {
    return {
      label: "KRAKEN_CACHE_MISSING",
      ageSeconds: Infinity,
      fetchedAt: "never",
      canUseForTradability: false,
      canOpenTrades: false,
      pairCount: 0,
      symbolCount: 0,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }
  const ageMs = now - new Date(snap.fetchedAt).getTime();
  const ageSeconds = Math.round(ageMs / 1000);
  const fresh = ageMs <= FRESH_TTL_MS;
  const degraded = ageMs <= DEGRADED_TTL_MS;
  const label: KrakenCacheLabel = fresh
    ? "USING_LAST_GOOD_KRAKEN_UNIVERSE"
    : degraded
      ? "USING_LAST_GOOD_KRAKEN_UNIVERSE"
      : "KRAKEN_CACHE_STALE";
  return {
    label,
    ageSeconds,
    fetchedAt: snap.fetchedAt,
    canUseForTradability: degraded,
    canOpenTrades: fresh,
    pairCount: snap.pairMapEntries.length,
    symbolCount: snap.tradableSymbols.length,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function restorePairMapFromCache(): Map<string, KrakenPairInfo> | null {
  const snap = loadKrakenLastGoodCache();
  if (!snap) return null;
  const status = resolveKrakenCacheStatus();
  if (!status.canUseForTradability) return null;
  return new Map(snap.pairMapEntries);
}

export function restoreTradableSymbolSetFromCache(): Set<string> | null {
  const snap = loadKrakenLastGoodCache();
  if (!snap) return null;
  const status = resolveKrakenCacheStatus();
  if (!status.canUseForTradability) return null;
  return new Set(snap.tradableSymbols);
}
