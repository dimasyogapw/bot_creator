import "server-only";
import { NetError, safeRequest } from "@/lib/net/safe-http";

/**
 * Klien Telegram Bot API. Token ada di alamat URL panggilan, jadi:
 * - URL tidak pernah dilog atau dimasukkan ke pesan galat,
 * - semua teks galat disensor dari token sebelum dikembalikan.
 */

export const TELEGRAM_HOST = "api.telegram.org";
const TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{20,80}$/;

export function isValidToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Alamat dasar API. Hanya test lokal yang boleh menggantinya (server tiruan di localhost);
 * di Vercel selalu alamat resmi Telegram.
 */
export function apiBase(): string {
  if (process.env.VERCEL) return `https://${TELEGRAM_HOST}`;
  return (process.env.TELEGRAM_API_BASE || `https://${TELEGRAM_HOST}`).replace(/\/+$/, "");
}

/** Sensor token (dan potongannya) dari teks apa pun. */
export function redactToken(text: string, token?: string): string {
  let out = text.replace(/\b\d{5,15}:[A-Za-z0-9_-]{20,80}\b/g, "[TOKEN]");
  if (token) out = out.split(token).join("[TOKEN]");
  return out;
}

export class TelegramError extends Error {
  constructor(
    /** Pesan aman ditampilkan ke owner. */
    public userMessage: string,
    public code?: number,
    /** Respons Telegram (sudah disensor). */
    public description?: string,
  ) {
    super(userMessage);
  }
}

interface TelegramReply<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export async function callTelegram<T>(token: string, method: string, params: Record<string, unknown> = {}, opts: { timeoutMs?: number } = {}): Promise<T> {
  if (!/^[A-Za-z]{3,40}$/.test(method)) throw new TelegramError("Metode Telegram tidak valid.");
  const base = apiBase();
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new TelegramError("Alamat API Telegram tidak valid.");
  }
  let res;
  try {
    res = await safeRequest({
      url: `${base}/bot${token}/${method}`,
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(params),
      maxBytes: 512 * 1024,
      timeoutMs: opts.timeoutMs ?? 15_000,
      allowedHosts: [host],
    });
  } catch (e) {
    const kind = e instanceof NetError ? e.kind : "unreachable";
    throw new TelegramError(kind === "timeout" ? "Telegram tidak merespons tepat waktu." : "Telegram tidak bisa dihubungi.");
  }
  let data: TelegramReply<T>;
  try {
    data = JSON.parse(res.body.toString("utf8")) as TelegramReply<T>;
  } catch {
    throw new TelegramError("Respons Telegram tidak bisa dibaca.", res.status);
  }
  if (!data.ok) {
    const desc = redactToken(String(data.description ?? ""), token).slice(0, 300);
    const code = data.error_code ?? res.status;
    const friendly =
      code === 401 || /unauthorized/i.test(desc)
        ? "Token ditolak Telegram. Periksa kembali token dari BotFather."
        : code === 429
          ? "Telegram meminta pelan-pelan (terlalu banyak permintaan). Coba lagi sebentar lagi."
          : "Telegram menolak permintaan.";
    throw new TelegramError(friendly, code, desc);
  }
  return data.result as T;
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export const getMe = (token: string) => callTelegram<TelegramBotInfo>(token, "getMe");

export const setWebhook = (token: string, p: { url: string; secret_token: string }) =>
  callTelegram<true>(token, "setWebhook", { url: p.url, secret_token: p.secret_token, allowed_updates: ["message"], drop_pending_updates: true, max_connections: 10 });

export const deleteWebhook = (token: string) => callTelegram<true>(token, "deleteWebhook", { drop_pending_updates: true });

export const sendChatAction = (token: string, chatId: number, action = "typing") => callTelegram<true>(token, "sendChatAction", { chat_id: chatId, action }, { timeoutMs: 5000 });

/**
 * Kirim satu pesan. Jika format HTML ditolak Telegram (kode 400 "can't parse"), kirim ulang sebagai teks biasa.
 */
export async function sendMessage(token: string, chatId: number, msg: { html: string; plain: string }): Promise<void> {
  try {
    await callTelegram(token, "sendMessage", { chat_id: chatId, text: msg.html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    if (e instanceof TelegramError && e.code === 400 && /parse|entit|tag/i.test(e.description ?? "")) {
      await callTelegram(token, "sendMessage", { chat_id: chatId, text: msg.plain || msg.html, link_preview_options: { is_disabled: true } });
      return;
    }
    throw e;
  }
}
