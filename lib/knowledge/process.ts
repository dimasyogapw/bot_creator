import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embed } from "@/lib/llm/provider";
import type { KnowledgeSource } from "@/lib/db/types";
import { chunkSegments } from "./chunk";
import { extractByMime, extractHtml, extractPdf, extractPlain, KnowledgeError, type Extracted } from "./extract";
import { fetchUrl } from "./fetch-url";
import { FILE_TYPES } from "./schema";

/**
 * Pemrosesan bertahap, aman terhadap batas waktu fungsi (Vercel):
 * setiap panggilan processStep mengerjakan SATU langkah kecil lalu kembali.
 *   1. pending -> processing: ekstrak teks + potong chunk (progress 10%)
 *   2. processing: embedding satu batch chunk (progress naik sampai 100%)
 *   3. semua chunk ber-embedding -> ready
 * Client memanggil berulang sampai ready/error. Jika halaman ditutup, lanjut saat dibuka lagi.
 */

export const BUCKET = "knowledge";
export const EMBED_BATCH = 64;
const INSERT_BATCH = 200;
const MAX_CHUNKS = 3000;
/** Ekstraksi yang macet (mis. fungsi kehabisan waktu) boleh diulang setelah ini. */
const STALE_EXTRACT_MS = 3 * 60_000;

export const SOURCE_COLUMNS =
  "id, bot_id, type, title, status, error_message, storage_path, url, mime, size_bytes, chunk_count, progress, created_at, updated_at";

async function getSource(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("knowledge_sources").select(SOURCE_COLUMNS).eq("id", id).maybeSingle<KnowledgeSource>();
  if (error) throw error;
  return data;
}

async function fail(db: SupabaseClient, id: string, message: string) {
  const { data } = await db
    .from("knowledge_sources")
    .update({ status: "error", error_message: message.slice(0, 500), progress: 0 })
    .eq("id", id)
    .select(SOURCE_COLUMNS)
    .maybeSingle<KnowledgeSource>();
  return data;
}

async function extractSource(db: SupabaseClient, s: KnowledgeSource): Promise<Extracted> {
  if (s.type === "url") {
    const page = await fetchUrl(s.url!);
    const ct = page.contentType.split(";")[0].trim();
    if (ct === "application/pdf") return extractPdf(new Uint8Array(page.body));
    if (ct === "text/plain" || ct === "text/markdown") return extractPlain(new Uint8Array(page.body));
    if (ct === "text/html" || ct === "application/xhtml+xml" || ct === "") return extractHtml(page.body.toString("utf8"), page.finalUrl);
    throw new KnowledgeError(`Jenis konten "${ct}" tidak didukung. Gunakan halaman web, teks, atau PDF.`);
  }
  if (!s.storage_path) throw new KnowledgeError("File sumber tidak ditemukan. Hapus lalu upload ulang.");
  const { data, error } = await db.storage.from(BUCKET).download(s.storage_path);
  if (error || !data) throw new KnowledgeError("File belum terupload atau sudah terhapus. Hapus lalu upload ulang.", error);
  const buf = Buffer.from(await data.arrayBuffer());
  return extractByMime(buf, s.mime ?? FILE_TYPES.txt);
}

async function runExtraction(db: SupabaseClient, s: KnowledgeSource): Promise<KnowledgeSource | null> {
  let extracted: Extracted;
  try {
    extracted = await extractSource(db, s);
  } catch (e) {
    if (e instanceof KnowledgeError) {
      console.warn("[knowledge] ekstraksi gagal", s.id, e.cause ?? e.message);
      return fail(db, s.id, e.userMessage);
    }
    console.error("[knowledge] ekstraksi error tak terduga", s.id, e);
    return fail(db, s.id, "Dokumen tidak bisa dibaca. Coba proses ulang atau upload file lain.");
  }

  const chunks = chunkSegments(extracted.segments);
  if (!chunks.length) return fail(db, s.id, "Dokumen tidak berisi teks yang bisa dipakai.");
  if (chunks.length > MAX_CHUNKS) return fail(db, s.id, "Dokumen terlalu panjang. Pecah menjadi beberapa file.");

  // Ulangi dari awal dengan bersih (mis. proses ulang).
  const { error: delErr } = await db.from("knowledge_chunks").delete().eq("source_id", s.id);
  if (delErr) throw delErr;
  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    const rows = chunks.slice(i, i + INSERT_BATCH).map((c, j) => ({
      source_id: s.id,
      bot_id: s.bot_id,
      chunk_index: i + j,
      content: c.content,
      token_count: c.tokenCount,
      metadata: c.pages ? { pages: c.pages } : {},
    }));
    const { error } = await db.from("knowledge_chunks").insert(rows);
    if (error) throw error;
  }

  const patch: Record<string, unknown> = { chunk_count: chunks.length, progress: 10 };
  if (s.type === "url" && extracted.title && s.title === s.url) patch.title = extracted.title.slice(0, 300);
  const { data, error } = await db.from("knowledge_sources").update(patch).eq("id", s.id).select(SOURCE_COLUMNS).maybeSingle<KnowledgeSource>();
  if (error) throw error;
  return data;
}

async function runEmbedding(db: SupabaseClient, s: KnowledgeSource): Promise<KnowledgeSource | null> {
  const { data: todo, error } = await db
    .from("knowledge_chunks")
    .select("id, content")
    .eq("source_id", s.id)
    .is("embedding", null)
    .order("chunk_index")
    .limit(EMBED_BATCH);
  if (error) throw error;

  if (todo?.length) {
    let vectors: number[][];
    try {
      const res = await embed(todo.map((c) => `${s.title}\n\n${c.content}`));
      vectors = [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length !== todo.length) throw new Error(`embedding count mismatch ${vectors.length}/${todo.length}`);
    } catch (e) {
      console.error("[knowledge] embedding gagal", s.id, e);
      return fail(db, s.id, "Gagal membuat embedding (layanan AI tidak merespons). Klik Proses ulang.");
    }
    const { error: upErr } = await db.rpc("set_chunk_embeddings", {
      p_ids: todo.map((c) => c.id),
      p_embeddings: vectors.map((v) => JSON.stringify(v)),
    });
    if (upErr) throw upErr;
  }

  const { count, error: cntErr } = await db
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("source_id", s.id)
    .is("embedding", null);
  if (cntErr) throw cntErr;
  const total = s.chunk_count || 1;
  const remaining = count ?? 0;
  const patch =
    remaining === 0
      ? { status: "ready", progress: 100, error_message: null }
      : { progress: Math.min(99, 10 + Math.floor((90 * (total - remaining)) / total)) };
  const { data, error: upErr } = await db.from("knowledge_sources").update(patch).eq("id", s.id).eq("status", "processing").select(SOURCE_COLUMNS).maybeSingle<KnowledgeSource>();
  if (upErr) throw upErr;
  return data ?? getSource(db, s.id);
}

/** Kerjakan satu langkah pemrosesan. Mengembalikan kondisi sumber terbaru (null jika sudah dihapus). */
export async function processStep(db: SupabaseClient, sourceId: string): Promise<KnowledgeSource | null> {
  const s = await getSource(db, sourceId);
  if (!s) return null;
  if (s.status === "ready" || s.status === "error" || s.status === "uploading") return s;

  const staleBefore = new Date(Date.now() - STALE_EXTRACT_MS).toISOString();
  const needsExtract = s.status === "pending" || (s.status === "processing" && s.chunk_count === null && Date.parse(s.updated_at) < Date.parse(staleBefore));
  if (needsExtract) {
    // Klaim atomik: hanya satu pemanggil yang mengekstrak.
    const { data: claimed, error } = await db
      .from("knowledge_sources")
      .update({ status: "processing", progress: 5, error_message: null, chunk_count: null })
      .eq("id", s.id)
      .or(`status.eq.pending,and(status.eq.processing,chunk_count.is.null,updated_at.lt."${staleBefore}")`)
      .select(SOURCE_COLUMNS)
      .maybeSingle<KnowledgeSource>();
    if (error) throw error;
    if (!claimed) return getSource(db, s.id);
    try {
      return await runExtraction(db, claimed);
    } catch (e) {
      console.error("[knowledge] gagal menyimpan chunk", s.id, e);
      return fail(db, s.id, "Gagal menyimpan hasil pemrosesan. Klik Proses ulang.");
    }
  }

  if (s.status === "processing" && s.chunk_count === null) return s; // sedang diekstrak pemanggil lain
  return runEmbedding(db, s);
}
