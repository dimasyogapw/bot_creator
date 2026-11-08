import { after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONNECTION_COLUMNS, loadSecrets, type ConnectionRow } from "@/lib/channels/telegram/connection";
import { handleUpdate } from "@/lib/channels/telegram/handler";
import { parseUpdate, safeEqual } from "@/lib/channels/telegram/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Jawaban dikirim lewat after() setelah 200 dibalas; batas waktu fungsi berlaku untuk seluruhnya.
export const maxDuration = 60;

const MAX_BODY_BYTES = 200_000;

function json(data: unknown, status: number) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

/**
 * Penerima webhook Telegram. Tanpa login: keaslian dibuktikan oleh kode rahasia di header
 * X-Telegram-Bot-Api-Secret-Token (dibandingkan dengan aman). Telegram mengirim ulang jika tidak dibalas 200,
 * jadi setiap update_id hanya diproses sekali.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: "Tidak ditemukan." }, 404);

  const db = createAdminClient();
  const { data: conn, error } = await db.from("channel_connections").select(CONNECTION_COLUMNS).eq("id", id).eq("channel", "telegram").maybeSingle<ConnectionRow>();
  if (error) {
    console.error("[telegram webhook] gagal memuat koneksi", error);
    return json({ error: "Layanan bermasalah." }, 500); // Telegram akan mencoba lagi
  }
  if (!conn) return json({ error: "Tidak ditemukan." }, 404);

  let secrets;
  try {
    secrets = await loadSecrets(db, id);
  } catch (e) {
    console.error("[telegram webhook] gagal membaca rahasia", e);
    return json({ error: "Layanan bermasalah." }, 500);
  }
  const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secrets.webhookSecret || !secrets.token || !safeEqual(header, secrets.webhookSecret)) return json({ error: "Tidak diizinkan." }, 401);

  if (!conn.enabled) return json({ ok: true, ignored: "nonaktif" }, 200);

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ ok: true, ignored: "terlalu besar" }, 200);
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: true, ignored: "terlalu besar" }, 200);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: true, ignored: "bukan json" }, 200);
  }
  const update = parseUpdate(body);
  if (!update) return json({ ok: true, ignored: "bentuk tidak dikenal" }, 200);

  const claimed = await db.rpc("claim_channel_update", { p_connection_id: id, p_update_id: update.updateId });
  if (claimed.error) {
    console.error("[telegram webhook] gagal klaim update", claimed.error);
    return json({ error: "Layanan bermasalah." }, 500);
  }
  if (claimed.data === false) return json({ ok: true, ignored: "duplikat" }, 200);
  if (update.kind === "ignore") return json({ ok: true, ignored: "bukan chat pribadi" }, 200);

  const token = secrets.token;
  after(async () => {
    await handleUpdate({ conn, token, update });
    // Bersihkan catatan anti-ganda yang lama sesekali (dikerjakan aplikasi, bukan SQL).
    if (Math.random() < 0.02) {
      const { error: cleanErr } = await db.from("channel_updates").delete().lt("created_at", new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString());
      if (cleanErr) console.error("[telegram webhook] gagal membersihkan catatan lama", cleanErr);
    }
  });
  return json({ ok: true }, 200);
}
