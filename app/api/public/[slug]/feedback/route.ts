import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicBot } from "@/lib/publish/public";
import { visitorIdSchema } from "@/lib/publish/schema";
import { visitorConversation } from "@/lib/publish/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  visitorId: visitorIdSchema,
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  feedback: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

/** Jempol dari pengunjung, hanya untuk jawaban di percakapannya sendiri. */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  let input: z.infer<typeof schema>;
  try {
    const p = schema.safeParse(await req.json());
    if (!p.success) return Response.json({ error: "Data tidak valid." }, { status: 400 });
    input = p.data;
  } catch {
    return Response.json({ error: "Format permintaan salah." }, { status: 400 });
  }
  const bot = await getPublicBot(slug).catch(() => null);
  if (!bot) return Response.json({ error: "Bot tidak ditemukan." }, { status: 404 });
  const convId = await visitorConversation(bot.id, input.visitorId, input.conversationId);
  if (!convId) return Response.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
  const { error, count } = await createAdminClient()
    .from("messages")
    .update({ feedback: input.feedback }, { count: "exact" })
    .eq("id", input.messageId)
    .eq("conversation_id", convId)
    .eq("role", "assistant");
  if (error) {
    console.error("[public feedback] gagal", error);
    return Response.json({ error: "Gagal menyimpan." }, { status: 500 });
  }
  if (!count) return Response.json({ error: "Pesan tidak ditemukan." }, { status: 404 });
  return Response.json({ ok: true });
}
