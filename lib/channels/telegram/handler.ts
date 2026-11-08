import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runBot } from "@/lib/bot/runBot";
import { checkLimits, getBotForChannel } from "@/lib/publish/public";
import type { Message } from "@/lib/db/types";
import { redactToken, sendChatAction, sendMessage, TelegramError } from "./api";
import { toTelegramMessages } from "./format";
import { parseCommand, type ParsedUpdate } from "./parse";
import type { ConnectionRow } from "./connection";

/**
 * Adapter channel Telegram: pesan masuk -> runBot (channel "telegram") -> jawaban dikirim balik.
 * Tidak ada logika chat di sini; semuanya di lib/bot/runBot.ts.
 */

export const NON_TEXT_REPLY = "Maaf, saat ini aku hanya bisa membaca pesan teks.";
export const NEW_CHAT_REPLY = "Percakapan baru dimulai. Silakan kirim pertanyaanmu.";
export const DEFAULT_WELCOME = "Halo! Aku siap membantu. Silakan kirim pertanyaanmu.";
export const SLOW_REPLY = "Maaf, jawabannya memakan waktu terlalu lama. Coba kirim lagi, ya.";
export const FALLBACK_ERROR = "Maaf, bot sedang tidak bisa menjawab. Silakan coba lagi sebentar lagi.";
/** Jawaban dihentikan sebelum batas fungsi serverless (60 detik) habis. */
export const ANSWER_TIMEOUT_MS = 50_000;

type Actionable = Exclude<ParsedUpdate, { kind: "ignore" }>;

export async function handleUpdate(p: { conn: ConnectionRow; token: string; update: Actionable }): Promise<void> {
  const { conn, token, update } = p;
  const db = createAdminClient();
  const chatId = update.chatId;
  const reply = async (text: string, sources?: { title: string; pages?: number[] }[]) => {
    for (const m of toTelegramMessages(text, sources)) await sendMessage(token, chatId, m);
  };

  try {
    const bot = await getBotForChannel(conn.bot_id);
    if (!bot) return;

    // Batas pemakaian dicek dulu: model tidak dipanggil jika tercapai.
    const limit = await checkLimits(bot, `tg:${chatId}`, null);
    if (!limit.ok) return void (await reply(limit.message));

    await db.from("channel_connections").update({ last_message_at: new Date().toISOString() }).eq("id", conn.id);

    if (update.kind === "unsupported") return void (await reply(NON_TEXT_REPLY));

    const cmd = parseCommand(update.text, conn.bot_username);
    if (cmd?.name === "start") return void (await reply(bot.welcome_message?.trim() || DEFAULT_WELCOME));
    if (cmd?.name === "baru") {
      await setPointer(db, conn.id, chatId, null);
      return void (await reply(NEW_CHAT_REPLY));
    }

    await answer({ db, conn, token, chatId, displayName: update.displayName, text: update.text, reply });
  } catch (e) {
    await onFailure(db, conn, token, e);
  }
}

async function getPointer(db: ReturnType<typeof createAdminClient>, connId: string, chatId: number): Promise<string | null> {
  const { data } = await db.from("channel_chats").select("conversation_id").eq("connection_id", connId).eq("chat_id", chatId).maybeSingle<{ conversation_id: string | null }>();
  return data?.conversation_id ?? null;
}

async function setPointer(db: ReturnType<typeof createAdminClient>, connId: string, chatId: number, conversationId: string | null) {
  const { error } = await db.from("channel_chats").upsert({ connection_id: connId, chat_id: chatId, conversation_id: conversationId, updated_at: new Date().toISOString() }, { onConflict: "connection_id,chat_id" });
  if (error) console.error("[telegram] gagal menyimpan penunjuk percakapan", error);
}

async function answer(a: {
  db: ReturnType<typeof createAdminClient>;
  conn: ConnectionRow;
  token: string;
  chatId: number;
  displayName: string | null;
  text: string;
  reply: (text: string, sources?: { title: string; pages?: number[] }[]) => Promise<void>;
}) {
  const { db, conn, token, chatId } = a;
  const tasks: (() => Promise<void>)[] = [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ANSWER_TIMEOUT_MS);
  void sendChatAction(token, chatId).catch(() => undefined);
  const typing = setInterval(() => void sendChatAction(token, chatId).catch(() => undefined), 4500);

  let done: Message | null = null;
  let errorText: string | null = null;
  try {
    let convId = await getPointer(db, conn.id, chatId);
    for (let attempt = 0; attempt < 2; attempt++) {
      done = null;
      errorText = null;
      for await (const ev of runBot({
        db,
        botId: conn.bot_id,
        conversationId: convId,
        userMessage: a.text,
        channel: "telegram",
        endUser: { externalId: `tg:${chatId}`, displayName: a.displayName },
        defer: (t) => tasks.push(t),
        signal: ac.signal,
      })) {
        if (ev.type === "start") {
          if (ev.conversationId !== convId) {
            convId = ev.conversationId;
            await setPointer(db, conn.id, chatId, convId);
          }
        } else if (ev.type === "done") done = ev.message;
        else if (ev.type === "error") errorText = ev.message;
      }
      // Percakapan lama hilang/tidak cocok: mulai yang baru sekali.
      if (!done && errorText === "Percakapan tidak ditemukan." && convId && attempt === 0) {
        convId = null;
        await setPointer(db, conn.id, chatId, null);
        continue;
      }
      break;
    }
  } finally {
    clearTimeout(timer);
    clearInterval(typing);
  }

  if (done) {
    const msg = done as Message;
    const text = msg.content.text + (msg.status === "stopped" ? "\n\n(Jawaban terpotong karena terlalu lama.)" : "");
    await a.reply(text, (msg.content.citations ?? []).map((c) => ({ title: c.title, pages: c.pages })));
  } else {
    await a.reply(errorText ?? (ac.signal.aborted ? SLOW_REPLY : FALLBACK_ERROR));
  }
  // Memory dan ringkasan di latar belakang (setelah jawaban terkirim). Galat hanya dicatat oleh runBot.
  for (const t of tasks) await t();
}

/** Galat pengiriman: token dicabut -> tandai koneksi error; pengguna memblokir bot -> abaikan; lainnya -> catat (disensor). */
async function onFailure(db: ReturnType<typeof createAdminClient>, conn: ConnectionRow, token: string, e: unknown) {
  if (e instanceof TelegramError) {
    if (e.code === 401) {
      await db.from("channel_connections").update({ status: "error", last_error: "Token ditolak Telegram (mungkin dicabut di BotFather). Hubungkan ulang dengan token baru." }).eq("id", conn.id);
    } else if (e.code !== 403) {
      console.error("[telegram] gagal mengirim:", e.userMessage, redactToken(e.description ?? "", token));
    }
    return;
  }
  console.error("[telegram] galat tak terduga:", redactToken(e instanceof Error ? (e.stack ?? e.message) : String(e), token));
}
