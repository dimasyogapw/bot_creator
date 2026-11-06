import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { startRun } from "@/lib/evals/engine";
import type { Bot } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mulai satu run eval (membuat daftar hasil "menunggu"). Kasus dijalankan satu per satu lewat /step. */
export async function POST(_req: Request, ctx: { params: Promise<{ botId: string }> }) {
  const { botId } = await ctx.params;
  if (!z.string().uuid().safeParse(botId).success) return Response.json({ error: "Bot tidak valid." }, { status: 400 });
  const { supabase: db, user } = await getUser();
  if (!user) return Response.json({ error: "Sesi berakhir. Silakan login lagi." }, { status: 401 });
  const { data: bot } = await db.from("bots").select("*").eq("id", botId).maybeSingle<Bot>();
  if (!bot) return Response.json({ error: "Bot tidak ditemukan." }, { status: 404 });
  const r = await startRun(db, bot, "app");
  if (!r.ok) return Response.json({ error: r.error, resumeRunId: r.resumeRunId }, { status: r.resumeRunId ? 409 : 400 });
  return Response.json({ runId: r.runId, total: r.total, runnable: r.runnable, estimatedCostUsd: r.estimatedCostUsd });
}
