import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicBot, toPublicMessage } from "@/lib/publish/public";
import { visitorIdSchema } from "@/lib/publish/schema";
import { visitorConversation } from "@/lib/publish/visitor";
import type { Message } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Riwayat percakapan pengunjung (untuk melanjutkan setelah halaman dimuat ulang). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const p = z.object({ visitorId: visitorIdSchema, conversationId: z.string().uuid() }).safeParse({
    visitorId: url.searchParams.get("visitorId"),
    conversationId: url.searchParams.get("conversationId"),
  });
  if (!p.success) return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  const bot = await getPublicBot(slug).catch(() => null);
  if (!bot) return Response.json({ error: "Bot tidak ditemukan." }, { status: 404 });
  const convId = await visitorConversation(bot.id, p.data.visitorId, p.data.conversationId);
  if (!convId) return Response.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
  const { data, error } = await createAdminClient()
    .from("messages")
    .select("id, role, content, status, feedback")
    .eq("conversation_id", convId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    console.error("[public conversation] gagal", error);
    return Response.json({ error: "Riwayat gagal dimuat." }, { status: 500 });
  }
  return Response.json({ messages: ((data ?? []) as Message[]).map(toPublicMessage) }, { headers: { "Cache-Control": "no-store" } });
}
