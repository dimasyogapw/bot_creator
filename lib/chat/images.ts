import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageContent } from "@/lib/db/types";

/** Signed URL (1 jam) untuk menampilkan gambar chat dari bucket privat. */
export async function signImageUrls(db: SupabaseClient, messages: { content: MessageContent }[]): Promise<Map<string, string>> {
  const paths = [...new Set(messages.flatMap((m) => m.content?.images?.map((i) => i.path) ?? []))];
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data, error } = await db.storage.from("chat-uploads").createSignedUrls(paths, 3600);
  if (error) {
    console.error("[images] gagal membuat signed url", error);
    return out;
  }
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

/** Hapus semua gambar chat milik bot (dipanggil saat bot dihapus). */
export async function removeBotImages(db: SupabaseClient, botId: string) {
  for (let i = 0; i < 50; i++) {
    const { data, error } = await db.storage.from("chat-uploads").list(`${botId}/uploads`, { limit: 1000 });
    if (error || !data?.length) return;
    const { error: rmErr } = await db.storage.from("chat-uploads").remove(data.map((f) => `${botId}/uploads/${f.name}`));
    if (rmErr) {
      console.warn("[images] gagal menghapus", rmErr);
      return;
    }
    if (data.length < 1000) return;
  }
}
