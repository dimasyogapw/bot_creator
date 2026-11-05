import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embed } from "@/lib/llm/provider";

export interface KnowledgeHit {
  id: string;
  source_id: string;
  source_title: string;
  chunk_index: number;
  content: string;
  metadata: { pages?: number[] } | null;
  score: number;
}

export const SEARCH_TOP_K = 6;

/** Apakah bot punya minimal satu sumber knowledge yang siap dipakai. */
export async function hasReadyKnowledge(db: SupabaseClient, botId: string): Promise<boolean> {
  const { count, error } = await db
    .from("knowledge_sources")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId)
    .eq("status", "ready");
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Pencarian hybrid (vektor + full-text, RRF) lewat fungsi SQL match_knowledge. */
export async function searchKnowledge(db: SupabaseClient, botId: string, query: string, k = SEARCH_TOP_K): Promise<KnowledgeHit[]> {
  const res = await embed([query]);
  const vector = res.data[0]?.embedding;
  if (!vector) throw new Error("embedding kueri kosong");
  const { data, error } = await db.rpc("match_knowledge", {
    p_bot_id: botId,
    p_query_embedding: JSON.stringify(vector),
    p_query_text: query,
    p_match_count: k,
  });
  if (error) throw error;
  return (data ?? []) as KnowledgeHit[];
}
