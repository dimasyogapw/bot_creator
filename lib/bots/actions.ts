"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { getChatModels } from "@/lib/llm/models";
import { generatePersona } from "@/lib/bot/persona";
import { removeBotImages } from "@/lib/chat/images";
import { disconnectTelegram } from "@/lib/channels/telegram/connection";
import { botInputSchema, botSettingsSchema, fieldErrors, personaAnswersSchema, slugify, type PersonaResult } from "./schema";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fields?: Record<string, string> };

const idSchema = z.string().uuid();

async function requireUser() {
  const { supabase, user } = await getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}

async function assertModelAvailable(model: string) {
  const { models, error } = await getChatModels();
  if (error) return; // provider tidak bisa dihubungi: jangan blokir simpan
  if (!models.includes(model)) throw new Error("MODEL");
}

export async function createBot(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = botInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Periksa kembali isian yang ditandai.", fields: fieldErrors(parsed.error) };
  try {
    const { supabase } = await requireUser();
    await assertModelAvailable(parsed.data.model);
    const base = slugify(parsed.data.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const { data, error } = await supabase.from("bots").insert({ ...parsed.data, slug }).select("id").single();
      if (!error && data) {
        revalidatePath("/");
        return { ok: true, data: { id: data.id as string } };
      }
      if (error?.code !== "23505") throw error;
    }
    return { ok: false, error: "Gagal membuat alamat unik untuk bot. Coba nama lain." };
  } catch (e) {
    return handle(e, "membuat bot");
  }
}

export async function updateBot(botId: string, input: unknown): Promise<ActionResult> {
  const parsed = botInputSchema.safeParse(input);
  if (!parsed.success || !idSchema.safeParse(botId).success)
    return { ok: false, error: "Periksa kembali isian yang ditandai.", fields: parsed.success ? {} : fieldErrors(parsed.error) };
  try {
    const { supabase } = await requireUser();
    await assertModelAvailable(parsed.data.model);
    const { error, count } = await supabase.from("bots").update(parsed.data, { count: "exact" }).eq("id", botId);
    if (error) throw error;
    if (!count) return { ok: false, error: "Bot tidak ditemukan." };
    revalidatePath("/");
    revalidatePath(`/bots/${botId}`, "layout");
    return { ok: true };
  } catch (e) {
    return handle(e, "menyimpan bot");
  }
}

export async function updateBotSettings(botId: string, input: unknown): Promise<ActionResult> {
  const parsed = botSettingsSchema.safeParse(input);
  if (!parsed.success || !idSchema.safeParse(botId).success) return { ok: false, error: "Setelan tidak valid." };
  try {
    const { supabase } = await requireUser();
    await assertModelAvailable(parsed.data.model);
    const { error } = await supabase.from("bots").update(parsed.data).eq("id", botId);
    if (error) throw error;
    revalidatePath(`/bots/${botId}`, "layout");
    return { ok: true };
  } catch (e) {
    return handle(e, "menyimpan setelan");
  }
}

export async function deleteBot(botId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(botId).success) return { ok: false, error: "Bot tidak valid." };
  try {
    const { supabase } = await requireUser();
    // Koneksi Telegram diputus dulu (webhook dilepas, token ditimpa kosong) supaya token tidak tersisa di Vault.
    const { data: owned } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
    if (!owned) return { ok: false, error: "Bot tidak ditemukan." };
    const tg = await disconnectTelegram(botId);
    if (!tg.ok) return { ok: false, error: tg.error };
    // File knowledge di storage tidak ikut terhapus otomatis oleh database: hapus dulu.
    const { data: files } = await supabase.from("knowledge_sources").select("storage_path").eq("bot_id", botId).not("storage_path", "is", null);
    const paths = (files ?? []).map((f) => f.storage_path as string);
    if (paths.length) {
      const { error: stErr } = await supabase.storage.from("knowledge").remove(paths);
      if (stErr) console.warn("[deleteBot] file knowledge gagal dihapus", stErr);
    }
    await removeBotImages(supabase, botId);
    const { error } = await supabase.from("bots").delete().eq("id", botId);
    if (error) throw error;
  } catch (e) {
    return handle(e, "menghapus bot");
  }
  revalidatePath("/");
  redirect("/");
}

export async function generatePersonaDraft(input: unknown): Promise<ActionResult<PersonaResult>> {
  const parsed = personaAnswersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Periksa kembali jawabanmu.", fields: fieldErrors(parsed.error) };
  try {
    const { supabase } = await requireUser();
    const data = await generatePersona(parsed.data as Required<typeof parsed.data>, { db: supabase });
    return { ok: true, data };
  } catch (e) {
    return handle(e, "menyusun persona", "Asisten persona gagal menyusun draf. Coba lagi atau tulis instruksi sendiri.");
  }
}

export async function setMessageFeedback(messageId: string, feedback: -1 | 0 | 1): Promise<ActionResult> {
  const parsed = z.object({ id: idSchema, feedback: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }).safeParse({ id: messageId, feedback });
  if (!parsed.success) return { ok: false, error: "Data tidak valid." };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.from("messages").update({ feedback }).eq("id", messageId).eq("role", "assistant");
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return handle(e, "menyimpan feedback");
  }
}

function handle(e: unknown, what: string, friendly?: string): ActionResult<never> {
  if (e instanceof Error && e.message === "UNAUTHENTICATED") return { ok: false, error: "Sesi berakhir. Silakan login lagi." };
  if (e instanceof Error && e.message === "MODEL")
    return { ok: false, error: "Model tidak tersedia di provider.", fields: { model: "Model tidak tersedia" } };
  console.error(`[actions] gagal ${what}`, e);
  return { ok: false, error: friendly ?? `Gagal ${what}. Silakan coba lagi.` };
}
