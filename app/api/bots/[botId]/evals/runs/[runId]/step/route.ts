import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { runNext, RUN_COLUMNS, type EvalRunRow } from "@/lib/evals/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Satu panggilan = satu kasus (jawaban bot + juri). Batas waktu dipatuhi Vercel.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ botId: string; runId: string }> }) {
  const { botId, runId } = await ctx.params;
  const uuid = z.string().uuid();
  if (!uuid.safeParse(botId).success || !uuid.safeParse(runId).success) return Response.json({ error: "Data tidak valid." }, { status: 400 });
  const { supabase: db, user } = await getUser();
  if (!user) return Response.json({ error: "Sesi berakhir. Silakan login lagi." }, { status: 401 });

  // RLS memastikan run milik bot owner; bot_id dicocokkan agar URL tidak menyesatkan.
  const { data: run } = await db.from("eval_runs").select("id, bot_id").eq("id", runId).eq("bot_id", botId).maybeSingle();
  if (!run) return Response.json({ error: "Run tidak ditemukan." }, { status: 404 });

  try {
    const step = await runNext(db, runId, req.signal);
    const { data: summary } = await db.from("eval_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle<EvalRunRow>();
    return Response.json({ ...step, run: summary });
  } catch (e) {
    console.error("[eval step] gagal", e);
    return Response.json({ error: "Langkah eval gagal. Coba lanjutkan lagi." }, { status: 500 });
  }
}
