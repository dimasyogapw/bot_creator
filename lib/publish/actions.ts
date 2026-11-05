"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { publishSettingsSchema } from "./schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function savePublishSettings(botId: string, input: unknown): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(botId).success) return { ok: false, error: "Bot tidak valid." };
  const p = publishSettingsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Isian tidak valid." };
  try {
    const { supabase, user } = await getUser();
    if (!user) return { ok: false, error: "Sesi berakhir. Silakan login lagi." };
    const { error, count } = await supabase.from("bots").update(p.data, { count: "exact" }).eq("id", botId);
    if (error) throw error;
    if (!count) return { ok: false, error: "Bot tidak ditemukan." };
    revalidatePath(`/bots/${botId}`, "layout");
    return { ok: true };
  } catch (e) {
    console.error("[publish] gagal menyimpan", e);
    return { ok: false, error: "Gagal menyimpan. Silakan coba lagi." };
  }
}
