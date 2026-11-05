import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { csvCell } from "@/lib/skills/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ botId: string }> }) {
  const { botId } = await ctx.params;
  if (!z.string().uuid().safeParse(botId).success) return Response.json({ error: "Bot tidak valid." }, { status: 400 });
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ error: "Sesi berakhir. Silakan login lagi." }, { status: 401 });
  const { data: bot } = await supabase.from("bots").select("id, slug").eq("id", botId).maybeSingle();
  if (!bot) return Response.json({ error: "Bot tidak ditemukan." }, { status: 404 });
  const { data, error } = await supabase.from("leads").select("data, conversation_id, created_at").eq("bot_id", botId).order("created_at", { ascending: true }).limit(10000);
  if (error) {
    console.error("[leads csv] gagal", error);
    return Response.json({ error: "Data gagal dimuat." }, { status: 500 });
  }
  const rows = (data ?? []) as { data: Record<string, string>; conversation_id: string | null; created_at: string }[];
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.data)))];
  const lines = [["waktu", ...keys, "conversation_id"].map(csvCell).join(",")];
  for (const r of rows) lines.push([r.created_at, ...keys.map((k) => r.data[k]), r.conversation_id].map(csvCell).join(","));
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="data-pelanggan-${bot.slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
