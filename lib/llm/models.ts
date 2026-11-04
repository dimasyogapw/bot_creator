import "server-only";
import { getLlmConfig, listModels } from "./provider";

let cache: { at: number; models: string[] } | undefined;
const TTL = 10 * 60 * 1000;

/** Daftar model chat dari /models provider (tanpa model embedding), di-cache 10 menit. */
export async function getChatModels(): Promise<{ models: string[]; defaultModel: string; error?: string }> {
  const defaultModel = getLlmConfig().LLM_DEFAULT_MODEL;
  try {
    if (!cache || Date.now() - cache.at > TTL) {
      const all = await listModels();
      cache = { at: Date.now(), models: all.filter((m) => !/embed/i.test(m)) };
    }
    return { models: cache.models, defaultModel };
  } catch (e) {
    console.error("[models] gagal mengambil daftar model", e);
    return { models: [defaultModel], defaultModel, error: "Daftar model tidak bisa diambil, memakai model default." };
  }
}
