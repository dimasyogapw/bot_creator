import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatStream } from "@/lib/llm/provider";
import type { Bot, Channel, Message, ModelPrice } from "@/lib/db/types";
import { buildMessages, titleFromMessage, HISTORY_LIMIT } from "./prompt";
import { computeCostUsd, normalizeUsage, type ProviderUsage } from "./pricing";

/**
 * Fungsi inti chat. SEMUA channel (playground, publik, widget, Telegram, WhatsApp)
 * memanggil fungsi ini. Channel hanya adapter yang meneruskan event ke pengguna.
 */

export type BotEvent =
  | { type: "start"; conversationId: string; userMessageId: string | null }
  | { type: "delta"; text: string }
  | { type: "done"; message: Message }
  | { type: "error"; message: string };

export interface RunBotParams {
  /** Client yang dipakai untuk baca/tulis. Playground: client owner (RLS). */
  db: SupabaseClient;
  botId: string;
  conversationId?: string | null;
  /** Pesan baru dari pengguna. Kosongkan bila regenerate. */
  userMessage?: string;
  /** Ulangi jawaban terakhir: hapus jawaban bot terakhir, jawab ulang pesan user terakhir. */
  regenerate?: boolean;
  channel: Channel;
  signal?: AbortSignal;
}

export const FRIENDLY_ERROR = "Maaf, bot sedang tidak bisa menjawab. Silakan coba lagi sebentar lagi.";

export async function* runBot(p: RunBotParams): AsyncGenerator<BotEvent> {
  const { db } = p;

  // 1. Konfigurasi bot
  const { data: bot, error: botErr } = await db.from("bots").select("*").eq("id", p.botId).maybeSingle<Bot>();
  if (botErr || !bot) {
    if (botErr) console.error("[runBot] gagal mengambil bot", botErr);
    yield { type: "error", message: "Bot tidak ditemukan." };
    return;
  }

  // 2. Percakapan
  let conversationId = p.conversationId ?? null;
  if (conversationId) {
    const { data: conv } = await db.from("conversations").select("id").eq("id", conversationId).eq("bot_id", bot.id).maybeSingle();
    if (!conv) {
      yield { type: "error", message: "Percakapan tidak ditemukan." };
      return;
    }
  } else {
    if (p.regenerate || !p.userMessage) {
      yield { type: "error", message: "Tidak ada pesan untuk dijawab." };
      return;
    }
    const { data: conv, error } = await db
      .from("conversations")
      .insert({ bot_id: bot.id, channel: p.channel, title: titleFromMessage(p.userMessage) })
      .select("id")
      .single();
    if (error || !conv) {
      console.error("[runBot] gagal membuat percakapan", error);
      yield { type: "error", message: FRIENDLY_ERROR };
      return;
    }
    conversationId = conv.id as string;
  }

  // 3. Pesan user / regenerate
  let userMessageId: string | null = null;
  if (p.regenerate) {
    const { data: last } = await db
      .from("messages")
      .select("id, role")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; role: string }>();
    if (last?.role === "assistant") await db.from("messages").delete().eq("id", last.id);
  } else {
    const { data: um, error } = await db
      .from("messages")
      .insert({ conversation_id: conversationId, role: "user", content: { text: p.userMessage } })
      .select("id")
      .single();
    if (error || !um) {
      console.error("[runBot] gagal menyimpan pesan user", error);
      yield { type: "error", message: FRIENDLY_ERROR };
      return;
    }
    userMessageId = um.id as string;
  }

  yield { type: "start", conversationId: conversationId!, userMessageId };

  // 4. Riwayat
  const { data: rows, error: histErr } = await db
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (histErr) {
    console.error("[runBot] gagal mengambil riwayat", histErr);
    yield { type: "error", message: FRIENDLY_ERROR };
    return;
  }
  const history = (rows ?? []).reverse() as Pick<Message, "role" | "content">[];
  if (!history.length || history[history.length - 1].role !== "user") {
    yield { type: "error", message: "Tidak ada pesan untuk dijawab." };
    return;
  }

  // 5. Kirim ke model + stream jawaban
  const t0 = Date.now();
  let ttft: number | undefined;
  let text = "";
  let usage: ProviderUsage | undefined;
  let status: Message["status"] = "complete";

  try {
    const stream = await chatStream({
      model: bot.model,
      messages: buildMessages(bot, history),
      temperature: Number(bot.temperature),
      maxTokens: bot.max_tokens,
      signal: p.signal,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        if (ttft === undefined) ttft = Date.now() - t0;
        text += delta;
        yield { type: "delta", text: delta };
      }
      if (chunk.usage) usage = chunk.usage as ProviderUsage;
    }
  } catch (e) {
    if (p.signal?.aborted) {
      status = "stopped";
    } else {
      console.error("[runBot] panggilan LLM gagal", e);
      yield { type: "error", message: FRIENDLY_ERROR };
      return;
    }
  }

  if (!text.trim()) {
    if (status === "stopped") return;
    yield { type: "error", message: "Bot tidak menghasilkan jawaban. Coba ulangi." };
    return;
  }

  // 6. Simpan jawaban + token, biaya, latensi
  const { data: price } = await db.from("model_prices").select("*").eq("model", bot.model).maybeSingle<ModelPrice>();
  const n = normalizeUsage(usage);
  const { data: saved, error: saveErr } = await db
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content: { text, ttft_ms: ttft },
      model: bot.model,
      tokens_in: usage ? n.tokensIn : null,
      tokens_out: usage ? n.tokensOut : null,
      tokens_cached: usage ? n.tokensCached : null,
      cost_usd: computeCostUsd(usage, price ?? null),
      latency_ms: Date.now() - t0,
      status,
    })
    .select("*")
    .single<Message>();
  if (saveErr || !saved) {
    console.error("[runBot] gagal menyimpan jawaban", saveErr);
    yield { type: "error", message: "Jawaban tidak tersimpan. Coba ulangi." };
    return;
  }
  await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

  yield { type: "done", message: saved };
}
