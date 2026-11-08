import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteWebhook, getMe, isValidToken, redactToken, setWebhook, TelegramError } from "./api";
import { newWebhookSecret } from "./parse";

/**
 * Koneksi Telegram per bot. Token dan kode rahasia webhook hanya ada di Vault (fungsi khusus server).
 * Pemanggil WAJIB sudah membuktikan kepemilikan bot (lewat RLS) sebelum memanggil fungsi di sini.
 * Rahasia tidak dihapus lewat SQL: saat diputus, nilainya ditimpa kosong, lalu baris koneksi dihapus.
 */

export interface ConnectionRow {
  id: string;
  bot_id: string;
  channel: string;
  enabled: boolean;
  status: "connected" | "error";
  bot_username: string | null;
  last_error: string | null;
  last_message_at: string | null;
}

export const CONNECTION_COLUMNS = "id, bot_id, channel, enabled, status, bot_username, last_error, last_message_at";

export async function loadSecrets(db: SupabaseClient, connectionId: string): Promise<{ token: string | null; webhookSecret: string | null }> {
  const { data, error } = await db.rpc("get_channel_secrets", { p_connection_id: connectionId });
  if (error) throw error;
  const map = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return { token: map.get("token") || null, webhookSecret: map.get("webhook_secret") || null };
}

async function setSecret(db: SupabaseClient, connectionId: string, key: "token" | "webhook_secret", value: string) {
  const { error } = await db.rpc("set_channel_secret", { p_connection_id: connectionId, p_key: key, p_value: value });
  if (error) throw error;
}

/** Timpa token dan kode rahasia dengan nilai kosong (rahasia lama hilang). */
async function blankSecrets(db: SupabaseClient, connectionId: string) {
  await setSecret(db, connectionId, "token", "");
  await setSecret(db, connectionId, "webhook_secret", "");
}

export async function getConnectionByBot(db: SupabaseClient, botId: string): Promise<ConnectionRow | null> {
  const { data, error } = await db.from("channel_connections").select(CONNECTION_COLUMNS).eq("bot_id", botId).eq("channel", "telegram").maybeSingle<ConnectionRow>();
  if (error) throw error;
  return data;
}

export type ConnectResult = { ok: true; connection: ConnectionRow } | { ok: false; error: string };

/**
 * Hubungkan bot ke Telegram: cek token (getMe), simpan rahasia, daftarkan webhook, tandai tersambung.
 * @param webhookBase alamat dasar aplikasi (https) tempat Telegram mengirim pesan.
 */
export async function connectTelegram(botId: string, rawToken: string, webhookBase: string): Promise<ConnectResult> {
  const token = rawToken.trim();
  if (!isValidToken(token)) return { ok: false, error: "Bentuk token tidak sesuai. Salin utuh dari BotFather (angka, titik dua, lalu huruf dan angka)." };
  const db = createAdminClient();

  let me;
  try {
    me = await getMe(token);
  } catch (e) {
    return { ok: false, error: e instanceof TelegramError ? e.userMessage : "Token gagal diperiksa. Coba lagi." };
  }
  if (!me.is_bot) return { ok: false, error: "Token ini bukan milik bot Telegram." };

  // Satu koneksi per bot: pakai yang ada (ganti token) atau buat baru.
  const existing = await getConnectionByBot(db, botId);
  let connectionId = existing?.id;
  const created = !existing;
  if (!connectionId) {
    const { data, error } = await db
      .from("channel_connections")
      .insert({ bot_id: botId, channel: "telegram", enabled: true, status: "connected", bot_username: me.username ?? null, external_bot_id: me.id })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) {
      console.error("[telegram] gagal membuat koneksi", error);
      return { ok: false, error: "Koneksi gagal dibuat. Coba lagi." };
    }
    connectionId = data.id;
  }

  const secret = newWebhookSecret();
  try {
    // Webhook lama (jika token diganti) dilepas dulu, lalu rahasia diganti dan webhook baru didaftarkan.
    if (existing) {
      const old = await loadSecrets(db, connectionId).catch(() => ({ token: null, webhookSecret: null }));
      if (old.token && old.token !== token) await deleteWebhook(old.token).catch(() => undefined);
    }
    await setSecret(db, connectionId, "token", token);
    await setSecret(db, connectionId, "webhook_secret", secret);
    await setWebhook(token, { url: `${webhookBase.replace(/\/+$/, "")}/api/telegram/webhook/${connectionId}`, secret_token: secret });
  } catch (e) {
    const message = e instanceof TelegramError ? e.userMessage : "Webhook gagal didaftarkan. Coba lagi.";
    console.error("[telegram] hubungkan gagal:", redactToken(e instanceof Error ? e.message : String(e), token));
    // Bersihkan: rahasia ditimpa kosong; koneksi baru dihapus, koneksi lama ditandai error.
    await blankSecrets(db, connectionId).catch(() => undefined);
    if (created) await db.from("channel_connections").delete().eq("id", connectionId);
    else await db.from("channel_connections").update({ status: "error", last_error: message }).eq("id", connectionId);
    return { ok: false, error: message };
  }

  const { data: row, error: upErr } = await db
    .from("channel_connections")
    .update({ enabled: true, status: "connected", last_error: null, bot_username: me.username ?? null, external_bot_id: me.id })
    .eq("id", connectionId)
    .select(CONNECTION_COLUMNS)
    .single<ConnectionRow>();
  if (upErr || !row) {
    console.error("[telegram] gagal menyimpan status koneksi", upErr);
    return { ok: false, error: "Koneksi tersambung tapi statusnya gagal disimpan. Muat ulang halaman." };
  }
  return { ok: true, connection: row };
}

/** Putuskan: lepas webhook di Telegram (jika bisa), timpa rahasia kosong, hapus koneksi. */
export async function disconnectTelegram(botId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createAdminClient();
  const conn = await getConnectionByBot(db, botId);
  if (!conn) return { ok: true };
  const { token } = await loadSecrets(db, conn.id).catch(() => ({ token: null }));
  if (token) await deleteWebhook(token).catch((e) => console.error("[telegram] deleteWebhook gagal:", redactToken(e instanceof Error ? e.message : String(e), token)));
  try {
    await blankSecrets(db, conn.id);
  } catch (e) {
    console.error("[telegram] gagal menghapus rahasia", e);
    return { ok: false, error: "Rahasia koneksi gagal dihapus. Koneksi dibiarkan; coba lagi." };
  }
  const { error } = await db.from("channel_connections").delete().eq("id", conn.id);
  if (error) {
    console.error("[telegram] gagal menghapus koneksi", error);
    return { ok: false, error: "Koneksi gagal dihapus. Coba lagi." };
  }
  return { ok: true };
}

export async function setTelegramEnabled(botId: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient();
  const { error, count } = await db.from("channel_connections").update({ enabled }, { count: "exact" }).eq("bot_id", botId).eq("channel", "telegram");
  if (error) {
    console.error("[telegram] gagal mengubah saklar", error);
    return { ok: false, error: "Gagal menyimpan. Coba lagi." };
  }
  return count ? { ok: true } : { ok: false, error: "Telegram belum terhubung." };
}
