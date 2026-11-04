import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import type { KnowledgeSource } from "@/lib/db/types";
import { BUCKET, processStep, SOURCE_COLUMNS } from "@/lib/knowledge/process";
import { MAX_FILE_BYTES } from "@/lib/knowledge/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Satu langkah pemrosesan (ekstraksi atau satu batch embedding) harus selesai dalam batas ini.
export const maxDuration = 60;

const paramsSchema = z.object({ botId: z.string().uuid(), sourceId: z.string().uuid() });
const actionSchema = z.object({ action: z.enum(["uploaded", "process", "retry"]) });

type Ctx = { params: Promise<{ botId: string; sourceId: string }> };

async function load(ctx: Ctx) {
  const p = paramsSchema.safeParse(await ctx.params);
  if (!p.success) return { error: json({ error: "Sumber tidak valid." }, 400) };
  const { supabase: db, user } = await getUser();
  if (!user) return { error: json({ error: "Sesi berakhir. Silakan login lagi." }, 401) };
  const { data: source, error } = await db
    .from("knowledge_sources")
    .select(SOURCE_COLUMNS)
    .eq("id", p.data.sourceId)
    .eq("bot_id", p.data.botId)
    .maybeSingle<KnowledgeSource>();
  if (error) {
    console.error("[knowledge] gagal memuat sumber", error);
    return { error: json({ error: "Sumber gagal dimuat. Coba lagi." }, 500) };
  }
  if (!source) return { error: json({ error: "Sumber tidak ditemukan." }, 404) };
  return { db, source };
}

/** uploaded: tandai upload selesai. process: kerjakan satu langkah. retry: proses ulang sumber yang error. */
export async function POST(req: Request, ctx: Ctx) {
  let action: z.infer<typeof actionSchema>["action"];
  try {
    const parsed = actionSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Aksi tidak valid." }, 400);
    action = parsed.data.action;
  } catch {
    return json({ error: "Format permintaan salah." }, 400);
  }
  const r = await load(ctx);
  if (r.error) return r.error;
  const { db, source } = r;

  try {
    if (action === "uploaded") {
      if (source.status !== "uploading") return json({ source }, 200);
      const path = source.storage_path!;
      const folder = path.slice(0, path.lastIndexOf("/"));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const { data: files, error } = await db.storage.from(BUCKET).list(folder, { search: name });
      if (error) throw error;
      const file = files?.find((f) => f.name === name);
      if (!file) return json({ error: "File belum terupload. Coba upload ulang." }, 409);
      const size = Number((file.metadata as { size?: number } | null)?.size ?? source.size_bytes ?? 0);
      if (size > MAX_FILE_BYTES) return json({ error: "Ukuran file maksimal 20 MB." }, 400);
      const { data: updated, error: upErr } = await db
        .from("knowledge_sources")
        .update({ status: "pending", size_bytes: size })
        .eq("id", source.id)
        .eq("status", "uploading")
        .select(SOURCE_COLUMNS)
        .maybeSingle<KnowledgeSource>();
      if (upErr) throw upErr;
      return json({ source: updated ?? source }, 200);
    }

    if (action === "retry") {
      if (source.status !== "error") return json({ source }, 200);
      const { data: updated, error } = await db
        .from("knowledge_sources")
        .update({ status: "pending", progress: 0, error_message: null, chunk_count: null })
        .eq("id", source.id)
        .eq("status", "error")
        .select(SOURCE_COLUMNS)
        .maybeSingle<KnowledgeSource>();
      if (error) throw error;
      return json({ source: updated ?? source }, 200);
    }

    const updated = await processStep(db, source.id);
    if (!updated) return json({ error: "Sumber tidak ditemukan." }, 404);
    return json({ source: updated }, 200);
  } catch (e) {
    console.error(`[knowledge] aksi ${action} gagal`, source.id, e);
    return json({ error: "Pemrosesan terganggu. Akan dicoba lagi." }, 500);
  }
}

/** Hapus sumber: file di storage dan chunk (cascade) ikut terhapus. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const r = await load(ctx);
  if (r.error) return r.error;
  const { db, source } = r;
  try {
    if (source.storage_path) {
      const { error } = await db.storage.from(BUCKET).remove([source.storage_path]);
      if (error) console.warn("[knowledge] file storage gagal dihapus", source.id, error);
    }
    const { error } = await db.from("knowledge_sources").delete().eq("id", source.id);
    if (error) throw error;
    return json({ ok: true }, 200);
  } catch (e) {
    console.error("[knowledge] gagal menghapus sumber", source.id, e);
    return json({ error: "Sumber gagal dihapus. Silakan coba lagi." }, 500);
  }
}

function json(data: unknown, status: number) {
  return Response.json(data, { status });
}
