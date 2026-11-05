import crypto from "node:crypto";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import type { KnowledgeSource } from "@/lib/db/types";
import { createSourceSchema, fileValidationError, MAX_SOURCES_PER_BOT, mimeFor, safeFileName } from "@/lib/knowledge/schema";
import { assertAllowedUrl } from "@/lib/knowledge/fetch-url";
import { KnowledgeError } from "@/lib/knowledge/extract";
import { BUCKET, SOURCE_COLUMNS } from "@/lib/knowledge/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tambah sumber knowledge. File: kembalikan signed upload URL (browser upload langsung ke Storage). */
export async function POST(req: Request, ctx: { params: Promise<{ botId: string }> }) {
  const { botId } = await ctx.params;
  if (!z.string().uuid().safeParse(botId).success) return json({ error: "Bot tidak valid." }, 400);

  let input: z.infer<typeof createSourceSchema>;
  try {
    const parsed = createSourceSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Data tidak valid." }, 400);
    input = parsed.data;
  } catch {
    return json({ error: "Format permintaan salah." }, 400);
  }

  const { supabase: db, user } = await getUser();
  if (!user) return json({ error: "Sesi berakhir. Silakan login lagi." }, 401);

  try {
    const { data: bot } = await db.from("bots").select("id").eq("id", botId).maybeSingle();
    if (!bot) return json({ error: "Bot tidak ditemukan." }, 404);
    const { count } = await db.from("knowledge_sources").select("id", { count: "exact", head: true }).eq("bot_id", botId);
    if ((count ?? 0) >= MAX_SOURCES_PER_BOT) return json({ error: `Maksimal ${MAX_SOURCES_PER_BOT} sumber per bot.` }, 400);

    const id = crypto.randomUUID();

    if (input.type === "file") {
      const err = fileValidationError(input.name, input.size);
      if (err) return json({ error: err }, 400);
      const mime = mimeFor(input.name)!;
      const path = `${botId}/${id}/${safeFileName(input.name)}`;
      const { data: signed, error: signErr } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (signErr || !signed) throw signErr ?? new Error("signed url kosong");
      const { data: source, error } = await db
        .from("knowledge_sources")
        .insert({ id, bot_id: botId, type: "file", title: input.name.slice(0, 300), status: "uploading", storage_path: path, mime, size_bytes: input.size })
        .select(SOURCE_COLUMNS)
        .single<KnowledgeSource>();
      if (error) throw error;
      return json({ source, upload: { url: signed.signedUrl, contentType: mime } }, 201);
    }

    if (input.type === "url") {
      try {
        assertAllowedUrl(input.url);
      } catch (e) {
        if (e instanceof KnowledgeError) return json({ error: e.userMessage }, 400);
        throw e;
      }
      const { data: source, error } = await db
        .from("knowledge_sources")
        .insert({ id, bot_id: botId, type: "url", title: input.url.slice(0, 300), status: "pending", url: input.url })
        .select(SOURCE_COLUMNS)
        .single<KnowledgeSource>();
      if (error) throw error;
      return json({ source }, 201);
    }

    // Teks manual disimpan sebagai file .txt supaya bisa diproses ulang seperti file lain.
    const path = `${botId}/${id}/teks.txt`;
    const body = Buffer.from(input.content, "utf8");
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, body, { contentType: "text/plain", upsert: false });
    if (upErr) throw upErr;
    const { data: source, error } = await db
      .from("knowledge_sources")
      .insert({ id, bot_id: botId, type: "text", title: input.title, status: "pending", storage_path: path, mime: "text/plain", size_bytes: body.length })
      .select(SOURCE_COLUMNS)
      .single<KnowledgeSource>();
    if (error) {
      await db.storage.from(BUCKET).remove([path]);
      throw error;
    }
    return json({ source }, 201);
  } catch (e) {
    console.error("[knowledge] gagal menambah sumber", e);
    return json({ error: "Sumber gagal ditambahkan. Silakan coba lagi." }, 500);
  }
}

function json(data: unknown, status: number) {
  return Response.json(data, { status });
}
