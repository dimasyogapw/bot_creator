import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatStream } from "@/lib/llm/provider";
import type { Bot, Channel, Citation, Message, ModelPrice } from "@/lib/db/types";
import type { ChatTool } from "@/lib/llm/provider";
import { hasReadyKnowledge, searchKnowledge } from "@/lib/knowledge/search";
import { assignCitations, formatToolResult, usedCitations } from "@/lib/knowledge/format";
import { extractMemories, loadMemories } from "@/lib/memory/extract";
import { maybeSummarize } from "./summary";
import { searchArgsSchema } from "@/lib/knowledge/schema";
import { buildMessages, titleFromMessage, HISTORY_LIMIT } from "./prompt";
import { computeCostUsd, normalizeUsage, type ProviderUsage } from "./pricing";

/**
 * Fungsi inti chat. SEMUA channel (playground, publik, widget, Telegram, WhatsApp)
 * memanggil fungsi ini. Channel hanya adapter yang meneruskan event ke pengguna.
 */

export type BotEvent =
  | { type: "start"; conversationId: string; userMessageId: string | null }
  | { type: "delta"; text: string }
  | { type: "tool"; name: "search_knowledge"; query: string }
  | { type: "citations"; citations: Citation[] }
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
  /** Identitas end user dari channel (playground: owner). Dipakai untuk memory. */
  endUser?: { externalId: string; displayName?: string | null };
  /**
   * Menjadwalkan pekerjaan background (ekstraksi memory, ringkasan) setelah jawaban terkirim.
   * Disediakan channel (mis. Next.js after()). Tanpa ini, pekerjaan background dilewati.
   */
  defer?: (task: () => Promise<void>) => void;
  signal?: AbortSignal;
}

export const PLAYGROUND_END_USER = { externalId: "owner", displayName: "Owner (playground)" };

export const MAX_TOOL_ITERATIONS = 5;

export const SEARCH_KNOWLEDGE_TOOL = {
  type: "function",
  function: {
    name: "search_knowledge",
    description:
      "Cari informasi di dokumen knowledge milik pemilik bot (file, halaman web, teks SOP). Pakai kata kunci yang spesifik dalam bahasa dokumen. Mengembalikan potongan dokumen bernomor untuk dikutip.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Kata kunci atau pertanyaan yang dicari" } },
      required: ["query"],
    },
  },
} satisfies ChatTool;

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return null;
  }
}

/** Jumlahkan usage dari beberapa panggilan model (loop tool). */
export function addUsage(a: ProviderUsage | undefined, b: ProviderUsage): ProviderUsage {
  if (!a) return b;
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  return {
    prompt_tokens: sum(a.prompt_tokens, b.prompt_tokens),
    completion_tokens: sum(a.completion_tokens, b.completion_tokens),
    cache_read_input_tokens: sum(a.cache_read_input_tokens ?? a.prompt_tokens_details?.cached_tokens, b.cache_read_input_tokens ?? b.prompt_tokens_details?.cached_tokens),
    cache_creation_input_tokens: sum(
      a.cache_creation_input_tokens ?? a.prompt_tokens_details?.cache_write_tokens,
      b.cache_creation_input_tokens ?? b.prompt_tokens_details?.cache_write_tokens,
    ),
    cost: sum(a.cost, b.cost),
  };
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

  // 2. End user (untuk memory). Gagal di sini tidak menghentikan chat.
  let endUserId: string | null = null;
  if (p.endUser) {
    const { data: eu, error: euErr } = await db
      .from("end_users")
      .upsert(
        { bot_id: bot.id, channel: p.channel, external_id: p.endUser.externalId, display_name: p.endUser.displayName ?? null, last_seen_at: new Date().toISOString() },
        { onConflict: "bot_id,channel,external_id" },
      )
      .select("id")
      .single();
    if (euErr || !eu) console.error("[runBot] gagal menyimpan end user", euErr);
    else endUserId = eu.id as string;
  }

  // 3. Percakapan
  let conversationId = p.conversationId ?? null;
  let summary: string | null = null;
  let summaryUntil: string | null = null;
  if (conversationId) {
    const { data: conv } = await db
      .from("conversations")
      .select("id, end_user_id, summary, summary_until")
      .eq("id", conversationId)
      .eq("bot_id", bot.id)
      .maybeSingle<{ id: string; end_user_id: string | null; summary: string | null; summary_until: string | null }>();
    // Percakapan milik end user lain tidak boleh dilanjutkan.
    if (!conv || (endUserId && conv.end_user_id && conv.end_user_id !== endUserId)) {
      yield { type: "error", message: "Percakapan tidak ditemukan." };
      return;
    }
    summary = conv.summary;
    summaryUntil = conv.summary_until;
    if (endUserId && !conv.end_user_id) await db.from("conversations").update({ end_user_id: endUserId }).eq("id", conversationId);
  } else {
    if (p.regenerate || !p.userMessage) {
      yield { type: "error", message: "Tidak ada pesan untuk dijawab." };
      return;
    }
    const { data: conv, error } = await db
      .from("conversations")
      .insert({ bot_id: bot.id, channel: p.channel, title: titleFromMessage(p.userMessage), end_user_id: endUserId })
      .select("id")
      .single();
    if (error || !conv) {
      console.error("[runBot] gagal membuat percakapan", error);
      yield { type: "error", message: FRIENDLY_ERROR };
      return;
    }
    conversationId = conv.id as string;
  }

  // 4. Pesan user / regenerate
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

  // 5. Riwayat: pesan setelah bagian yang sudah diringkas.
  let histQ = db
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (summaryUntil) histQ = histQ.gt("created_at", summaryUntil);
  const { data: rows, error: histErr } = await histQ;
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

  // 6. Memory end user (hanya jika memory bot aktif).
  let memories: { content: string }[] = [];
  if (bot.memory_enabled && endUserId) {
    try {
      memories = await loadMemories(db, bot.id, endUserId);
    } catch (e) {
      console.error("[runBot] gagal memuat memory", e);
    }
  }

  // 7. Knowledge aktif jika bot punya sumber ready (agentic RAG lewat tool).
  let knowledgeOn = false;
  try {
    knowledgeOn = await hasReadyKnowledge(db, bot.id);
  } catch (e) {
    console.error("[runBot] gagal cek knowledge", e);
  }
  const tools = knowledgeOn ? [SEARCH_KNOWLEDGE_TOOL] : undefined;
  const messages = buildMessages(bot, history, { knowledge: knowledgeOn, memories, summary });

  // 8. Kirim ke model + stream jawaban, dengan loop tool maksimal MAX_TOOL_ITERATIONS.
  const t0 = Date.now();
  let ttft: number | undefined;
  let text = "";
  let usage: ProviderUsage | undefined;
  let status: Message["status"] = "complete";
  let citations: Citation[] = [];
  const searches: string[] = [];

  try {
    for (let iter = 0; iter <= MAX_TOOL_ITERATIONS; iter++) {
      const stream = await chatStream({
        model: bot.model,
        messages,
        temperature: Number(bot.temperature),
        maxTokens: bot.max_tokens,
        tools,
        // Iterasi terakhir: paksa model menjawab tanpa memanggil tool lagi.
        toolChoice: tools ? (iter === MAX_TOOL_ITERATIONS ? "none" : "auto") : undefined,
        signal: p.signal,
      });
      let iterText = "";
      const calls: { id: string; name: string; args: string }[] = [];
      for await (const chunk of stream) {
        const d = chunk.choices[0]?.delta;
        if (d?.content) {
          let piece = d.content;
          if (!iterText && text) piece = "\n\n" + piece; // pisahkan teks antar-iterasi
          if (ttft === undefined) ttft = Date.now() - t0;
          iterText += d.content;
          text += piece;
          yield { type: "delta", text: piece };
        }
        for (const tc of d?.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
        }
        if (chunk.usage) usage = addUsage(usage, chunk.usage as ProviderUsage);
      }

      const toolCalls = calls.filter(Boolean);
      if (!toolCalls.length || !tools) break;

      messages.push({
        role: "assistant",
        content: iterText || null,
        tool_calls: toolCalls.map((c, i) => ({
          id: c.id || `call_${iter}_${i}`,
          type: "function" as const,
          function: { name: c.name, arguments: c.args || "{}" },
        })),
      });
      for (const [i, c] of toolCalls.entries()) {
        const callId = c.id || `call_${iter}_${i}`;
        let result: string;
        if (c.name !== SEARCH_KNOWLEDGE_TOOL.function.name) {
          result = `Alat "${c.name}" tidak tersedia.`;
        } else {
          const args = searchArgsSchema.safeParse(safeJson(c.args));
          if (!args.success) {
            result = "Argumen tidak valid. Kirim {\"query\": \"kata kunci pencarian\"}.";
          } else {
            const query = args.data.query;
            searches.push(query);
            yield { type: "tool", name: "search_knowledge", query };
            try {
              const hits = await searchKnowledge(db, bot.id, query);
              const r = assignCitations(hits, citations);
              citations = r.citations;
              result = formatToolResult(query, r.numbered);
              yield { type: "citations", citations };
            } catch (e) {
              console.error("[runBot] search_knowledge gagal", e);
              result = "Pencarian knowledge sedang gagal. Beri tahu pengguna bahwa informasinya belum bisa dicari saat ini.";
            }
          }
        }
        messages.push({ role: "tool", tool_call_id: callId, content: result });
      }
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

  // 9. Simpan jawaban + token, biaya, latensi
  const { data: price } = await db.from("model_prices").select("*").eq("model", bot.model).maybeSingle<ModelPrice>();
  const n = normalizeUsage(usage);
  const { data: saved, error: saveErr } = await db
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content: {
        text,
        ttft_ms: ttft,
        ...(citations.length ? { citations: usedCitations(text, citations) } : {}),
        ...(searches.length ? { searches } : {}),
      },
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

  // 10. Background: ekstraksi memory dan ringkasan riwayat panjang. Error hanya dicatat.
  if (p.defer) {
    const convId = conversationId!;
    if (bot.memory_enabled && endUserId) {
      const euId = endUserId;
      p.defer(async () => {
        try {
          await extractMemories({ db, botId: bot.id, endUserId: euId, conversationId: convId });
        } catch (e) {
          console.error("[runBot] ekstraksi memory gagal", e);
        }
      });
    }
    p.defer(async () => {
      try {
        await maybeSummarize(db, convId);
      } catch (e) {
        console.error("[runBot] ringkasan gagal", e);
      }
    });
  }

  yield { type: "done", message: saved };
}
