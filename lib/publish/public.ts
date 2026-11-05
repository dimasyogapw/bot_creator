import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Bot, Citation, Message } from "@/lib/db/types";
import type { BotEvent } from "@/lib/bot/runBot";

/**
 * Channel publik (link dan widget). Pengunjung tidak login, jadi server memakai secret key
 * dengan pengecekan eksplisit: bot harus is_public, percakapan harus milik bot dan pengunjung itu.
 */

export type PublicBot = Pick<
  Bot,
  "id" | "name" | "slug" | "avatar_url" | "welcome_message" | "daily_cost_limit_usd" | "daily_message_limit" | "per_minute_limit" | "limit_message" | "widget" | "allowed_domains"
>;

const PUBLIC_COLUMNS = "id, name, slug, avatar_url, welcome_message, daily_cost_limit_usd, daily_message_limit, per_minute_limit, limit_message, widget, allowed_domains";

export async function getPublicBot(slug: string): Promise<PublicBot | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return null;
  const { data, error } = await createAdminClient().from("bots").select(PUBLIC_COLUMNS).eq("slug", slug).eq("is_public", true).maybeSingle<PublicBot>();
  if (error) {
    console.error("[public] gagal memuat bot", error);
    throw error;
  }
  return data;
}

/** IP pengunjung dari header proxy standar (Vercel, Nginx, Coolify). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export type LimitResult = { ok: true } | { ok: false; reason: "per_minute" | "daily_messages" | "daily_cost"; message: string };

/** Cek semua batas sebelum memanggil model. Batas harian hanya menghitung channel publik. */
export async function checkLimits(bot: PublicBot, visitorId: string, ip: string): Promise<LimitResult> {
  const db = createAdminClient();
  const per = Number(bot.per_minute_limit);
  const [byIp, byVisitor] = await Promise.all([
    db.rpc("hit_rate_limit", { p_key: `ip:${bot.id}:${ip}`, p_window_seconds: 60, p_max: per }),
    db.rpc("hit_rate_limit", { p_key: `visitor:${bot.id}:${visitorId}`, p_window_seconds: 60, p_max: per }),
  ]);
  if (byIp.error || byVisitor.error) throw byIp.error ?? byVisitor.error;
  if (byIp.data === false || byVisitor.data === false)
    return { ok: false, reason: "per_minute", message: "Pesanmu terlalu cepat. Tunggu sebentar (sekitar satu menit) lalu coba lagi, ya." };

  const { data: usage, error } = await db.rpc("bot_public_usage_today", { p_bot_id: bot.id }).single<{ messages: number; cost_usd: number }>();
  if (error) throw error;
  if (Number(usage?.messages ?? 0) >= Number(bot.daily_message_limit)) return { ok: false, reason: "daily_messages", message: bot.limit_message };
  if (Number(usage?.cost_usd ?? 0) >= Number(bot.daily_cost_limit_usd)) return { ok: false, reason: "daily_cost", message: bot.limit_message };
  return { ok: true };
}

export async function publicUsageToday(botId: string) {
  const { data, error } = await createAdminClient().rpc("bot_public_usage_today", { p_bot_id: botId }).single<{ messages: number; cost_usd: number }>();
  if (error) throw error;
  return { messages: Number(data?.messages ?? 0), costUsd: Number(data?.cost_usd ?? 0) };
}

/** Sitasi untuk pengunjung: judul, halaman, kutipan. Tanpa id internal. */
export function publicCitations(c: Citation[] | undefined) {
  return (c ?? []).map((x) => ({ n: x.n, title: x.title, snippet: x.snippet, ...(x.pages ? { pages: x.pages } : {}) }));
}

export interface PublicMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: Message["status"];
  feedback: Message["feedback"];
  citations?: ReturnType<typeof publicCitations>;
}

export function toPublicMessage(m: Pick<Message, "id" | "role" | "content" | "status" | "feedback">): PublicMessage {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    text: m.content?.text ?? "",
    status: m.status,
    feedback: m.feedback,
    ...(m.content?.citations?.length ? { citations: publicCitations(m.content.citations) } : {}),
  };
}

/**
 * Event untuk pengunjung: hanya teks, label skill, sitasi, dan status.
 * Tidak pernah: system prompt, nama fungsi/argumen skill, model, token, biaya.
 */
export function toPublicEvent(e: BotEvent): Record<string, unknown> | null {
  switch (e.type) {
    case "start":
      return { type: "start", conversationId: e.conversationId, userMessageId: e.userMessageId };
    case "delta":
      return { type: "delta", text: e.text };
    case "tool":
      return { type: "tool", name: "skill", label: e.label };
    case "citations":
      return { type: "citations", citations: publicCitations(e.citations) };
    case "done":
      return { type: "done", message: { id: e.message.id, content: { text: e.message.content.text, citations: publicCitations(e.message.content.citations) }, status: e.message.status, feedback: e.message.feedback } };
    case "error":
      return { type: "error", message: e.message };
  }
}
