import crypto from "node:crypto";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/llm/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  mime: z.enum(Object.keys(IMAGE_TYPES) as [keyof typeof IMAGE_TYPES, ...(keyof typeof IMAGE_TYPES)[]]),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES),
});

/** Signed upload URL untuk gambar chat: browser upload langsung ke Storage (bucket privat chat-uploads). */
export async function POST(req: Request, ctx: { params: Promise<{ botId: string }> }) {
  const { botId } = await ctx.params;
  if (!z.string().uuid().safeParse(botId).success) return Response.json({ error: "Bot tidak valid." }, { status: 400 });
  let input: z.infer<typeof schema>;
  try {
    const p = schema.safeParse(await req.json());
    if (!p.success) return Response.json({ error: "Gambar harus JPG, PNG, WebP, atau GIF, maksimal 5 MB." }, { status: 400 });
    input = p.data;
  } catch {
    return Response.json({ error: "Format permintaan salah." }, { status: 400 });
  }
  const { supabase: db, user } = await getUser();
  if (!user) return Response.json({ error: "Sesi berakhir. Silakan login lagi." }, { status: 401 });
  const { data: bot } = await db.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return Response.json({ error: "Bot tidak ditemukan." }, { status: 404 });
  const path = `${botId}/uploads/${crypto.randomUUID()}.${IMAGE_TYPES[input.mime]}`;
  const { data, error } = await db.storage.from("chat-uploads").createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[uploads] gagal membuat signed url", error);
    return Response.json({ error: "Gambar gagal diupload. Coba lagi." }, { status: 500 });
  }
  return Response.json({ path, url: data.signedUrl, mime: input.mime }, { status: 201 });
}
