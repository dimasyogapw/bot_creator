import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelPrice } from "@/lib/db/types";
import { computeCostUsd, normalizeUsage, type ProviderUsage } from "@/lib/bot/pricing";

/**
 * Pencatat biaya panggilan model di luar jawaban bot (jawaban bot tersimpan di messages).
 * Ke tabel llm_usage: ringkasan percakapan, ekstraksi memory, embedding, asisten persona, juri eval, dst.
 * Gagal mencatat TIDAK PERNAH menghentikan pekerjaan utama (hanya di-log).
 */

export type UsagePurpose = "memory" | "summary" | "embedding" | "persona" | "web_search_test" | "eval_judge" | "eval_suggest";

export interface UsageScope {
  db: SupabaseClient;
  botId?: string | null;
  conversationId?: string | null;
  evalRunId?: string | null;
  evalResultId?: string | null;
}

/** Catat satu panggilan model. Mengembalikan biaya USD (0 jika tidak diketahui). */
export async function recordLlmUsage(
  scope: UsageScope | undefined,
  purpose: UsagePurpose,
  model: string,
  usage: ProviderUsage | null | undefined,
): Promise<number> {
  if (!scope) return 0;
  try {
    const { data: price } = await scope.db.from("model_prices").select("*").eq("model", model).maybeSingle<ModelPrice>();
    const cost = computeCostUsd(usage, price ?? null);
    const n = normalizeUsage(usage);
    const { error } = await scope.db.from("llm_usage").insert({
      bot_id: scope.botId ?? null,
      conversation_id: scope.conversationId ?? null,
      eval_run_id: scope.evalRunId ?? null,
      eval_result_id: scope.evalResultId ?? null,
      purpose,
      model,
      tokens_in: n.tokensIn,
      tokens_out: n.tokensOut,
      tokens_cached: n.tokensCached,
      cost_usd: cost,
    });
    if (error) console.error("[usage] gagal mencatat biaya", purpose, error);
    return cost ?? 0;
  } catch (e) {
    console.error("[usage] gagal mencatat biaya", purpose, e);
    return 0;
  }
}
