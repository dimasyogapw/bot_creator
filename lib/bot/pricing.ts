import type { ModelPrice } from "@/lib/db/types";

/** Bentuk usage dari provider OpenAI-compatible (SumoPod menambah field Anthropic). */
export interface ProviderUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
  cost?: number;
}

export interface NormalizedUsage {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  tokensCacheWrite: number;
}

export function normalizeUsage(u: ProviderUsage | null | undefined): NormalizedUsage {
  return {
    tokensIn: u?.prompt_tokens ?? 0,
    tokensOut: u?.completion_tokens ?? 0,
    tokensCached: u?.cache_read_input_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0,
    tokensCacheWrite: u?.cache_creation_input_tokens ?? u?.prompt_tokens_details?.cache_write_tokens ?? 0,
  };
}

/**
 * Biaya USD. Angka `cost` dari provider dipakai jika ada (SumoPod hanya mengirimnya pada respons stream,
 * yaitu jawaban bot). Jika tidak ada (panggilan non-stream: juri eval, memory, ringkasan, persona),
 * biaya dihitung dari usage x harga di tabel model_prices.
 * prompt_tokens sudah termasuk token cache, jadi dipisah supaya tidak dihitung dua kali.
 * Tanpa keduanya: null (biaya tidak diketahui, dihitung 0 di total).
 */
export function computeCostUsd(usage: ProviderUsage | null | undefined, price: ModelPrice | null): number | null {
  if (!usage) return null;
  const n = normalizeUsage(usage);
  if (typeof usage.cost === "number") return round6(usage.cost);
  if (!price) return null;
  const plainIn = Math.max(0, n.tokensIn - n.tokensCached - n.tokensCacheWrite);
  const cost =
    plainIn * Number(price.input_per_mtok) +
    n.tokensCached * Number(price.cache_read_per_mtok ?? price.input_per_mtok) +
    n.tokensCacheWrite * Number(price.cache_write_per_mtok ?? price.input_per_mtok) +
    n.tokensOut * Number(price.output_per_mtok);
  return round6(cost / 1_000_000);
}

function round6(x: number) {
  return Math.round(x * 1e6) / 1e6;
}
