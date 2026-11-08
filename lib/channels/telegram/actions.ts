"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { connectTelegram, disconnectTelegram, setTelegramEnabled } from "./connection";

export type ActionResult = { ok: true } | { ok: false; error: string };

const id = z.string().uuid();

/** Pastikan pengguna login dan bot miliknya (RLS). Pemanggilan berikutnya memakai secret key karena rahasia hanya untuk server. */
async function requireBotOwner(botId: string) {
  const { supabase, user } = await getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { data, error } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");
}

function fail(e: unknown, what: string): ActionResult {
  if (e instanceof Error && e.message === "UNAUTHENTICATED") return { ok: false, error: "Sesi berakhir. Silakan login lagi." };
  if (e instanceof Error && e.message === "NOT_FOUND") return { ok: false, error: "Bot tidak ditemukan." };
  console.error(`[telegram] gagal ${what}`, e instanceof Error ? e.message : e);
  return { ok: false, error: `Gagal ${what}. Silakan coba lagi.` };
}

/** Alamat dasar aplikasi yang akan dikunjungi Telegram. Production saja di Vercel (Preview dilindungi login Vercel). */
async function webhookBase(): Promise<{ ok: true; base: string } | { ok: false; error: string }> {
  if (process.env.VERCEL && process.env.VERCEL_ENV !== "production")
    return { ok: false, error: "Telegram hanya bisa dihubungkan dari alamat Production (https://bot-creator-three.vercel.app). Alamat Preview dilindungi login Vercel sehingga Telegram tidak bisa masuk." };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  if (!host) return { ok: false, error: "Alamat aplikasi tidak terbaca. Muat ulang halaman." };
  const local = !process.env.VERCEL && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  if (proto !== "https" && !local) return { ok: false, error: "Telegram membutuhkan alamat https." };
  return { ok: true, base: `${proto}://${host}` };
}

export async function connectTelegramAction(botId: string, token: string): Promise<ActionResult> {
  const p = z.object({ botId: id, token: z.string().trim().min(10).max(200) }).safeParse({ botId, token });
  if (!p.success) return { ok: false, error: "Token wajib diisi (salin utuh dari BotFather)." };
  try {
    await requireBotOwner(botId);
    const base = await webhookBase();
    if (!base.ok) return base;
    const r = await connectTelegram(botId, p.data.token, base.base);
    if (!r.ok) return r;
    revalidatePath(`/bots/${botId}/publish`);
    return { ok: true };
  } catch (e) {
    return fail(e, "menghubungkan Telegram");
  }
}

export async function disconnectTelegramAction(botId: string): Promise<ActionResult> {
  if (!id.safeParse(botId).success) return { ok: false, error: "Data tidak valid." };
  try {
    await requireBotOwner(botId);
    const r = await disconnectTelegram(botId);
    if (!r.ok) return r;
    revalidatePath(`/bots/${botId}/publish`);
    return { ok: true };
  } catch (e) {
    return fail(e, "memutuskan Telegram");
  }
}

export async function setTelegramEnabledAction(botId: string, enabled: boolean): Promise<ActionResult> {
  const p = z.object({ botId: id, enabled: z.boolean() }).safeParse({ botId, enabled });
  if (!p.success) return { ok: false, error: "Data tidak valid." };
  try {
    await requireBotOwner(botId);
    const r = await setTelegramEnabled(botId, enabled);
    if (!r.ok) return { ok: false, error: r.error ?? "Gagal menyimpan." };
    revalidatePath(`/bots/${botId}/publish`);
    return { ok: true };
  } catch (e) {
    return fail(e, "menyimpan setelan Telegram");
  }
}
