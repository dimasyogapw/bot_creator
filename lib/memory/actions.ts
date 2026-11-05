"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const id = z.string().uuid();

async function requireUser() {
  const { supabase, user } = await getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return supabase;
}

function fail(e: unknown, what: string): ActionResult {
  if (e instanceof Error && e.message === "UNAUTHENTICATED") return { ok: false, error: "Sesi berakhir. Silakan login lagi." };
  console.error(`[memory] gagal ${what}`, e);
  return { ok: false, error: `Gagal ${what}. Silakan coba lagi.` };
}

/** Nyalakan/matikan memory bot. Mematikan tidak menghapus memory yang sudah ada. */
export async function setMemoryEnabled(botId: string, enabled: boolean): Promise<ActionResult> {
  const p = z.object({ botId: id, enabled: z.boolean() }).safeParse({ botId, enabled });
  if (!p.success) return { ok: false, error: "Data tidak valid." };
  try {
    const db = await requireUser();
    const { error, count } = await db.from("bots").update({ memory_enabled: enabled }, { count: "exact" }).eq("id", botId);
    if (error) throw error;
    if (!count) return { ok: false, error: "Bot tidak ditemukan." };
    revalidatePath(`/bots/${botId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, "menyimpan setelan memory");
  }
}

export async function deleteMemory(botId: string, memoryId: string): Promise<ActionResult> {
  const p = z.object({ botId: id, memoryId: id }).safeParse({ botId, memoryId });
  if (!p.success) return { ok: false, error: "Data tidak valid." };
  try {
    const db = await requireUser();
    const { error, count } = await db.from("memories").delete({ count: "exact" }).eq("id", memoryId).eq("bot_id", botId);
    if (error) throw error;
    if (!count) return { ok: false, error: "Memory tidak ditemukan." };
    revalidatePath(`/bots/${botId}/memory`);
    return { ok: true };
  } catch (e) {
    return fail(e, "menghapus memory");
  }
}

/** Hapus semua memory satu end user. */
export async function deleteEndUserMemories(botId: string, endUserId: string): Promise<ActionResult> {
  const p = z.object({ botId: id, endUserId: id }).safeParse({ botId, endUserId });
  if (!p.success) return { ok: false, error: "Data tidak valid." };
  try {
    const db = await requireUser();
    const { error } = await db.from("memories").delete().eq("end_user_id", endUserId).eq("bot_id", botId);
    if (error) throw error;
    revalidatePath(`/bots/${botId}/memory`);
    return { ok: true };
  } catch (e) {
    return fail(e, "menghapus memory");
  }
}
