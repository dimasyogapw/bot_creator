"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSkillDef, webhookToolName } from "./registry";
import { listBotSkills, executeSkill } from "./runtime";
import { SKILL_TYPES, type SkillType } from "./types";
import { webhookConfigSchema, webhookHeaderSchema } from "./defs/http-webhook";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const id = z.string().uuid();
const builtinType = z.enum(SKILL_TYPES).refine((t) => t !== "http_webhook");

async function requireUser() {
  const { supabase, user } = await getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return supabase;
}

function fail(e: unknown, what: string): { ok: false; error: string } {
  if (e instanceof Error && e.message === "UNAUTHENTICATED") return { ok: false, error: "Sesi berakhir. Silakan login lagi." };
  console.error(`[skills] gagal ${what}`, e);
  return { ok: false, error: `Gagal ${what}. Silakan coba lagi.` };
}

function zodMessage(e: z.ZodError) {
  const i = e.issues[0];
  return i ? i.message : "Isian tidak valid.";
}

/** Simpan skill bawaan (saklar, deskripsi, konfigurasi). Baris dibuat saat pertama kali disimpan. */
export async function saveBuiltinSkill(botId: string, type: SkillType, input: { enabled: boolean; description?: string; config?: unknown }): Promise<ActionResult> {
  const p = z
    .object({ botId: id, type: builtinType, enabled: z.boolean(), description: z.string().trim().max(1000).optional(), config: z.unknown().optional() })
    .safeParse({ botId, type, ...input });
  if (!p.success) return { ok: false, error: "Data tidak valid." };
  const def = getSkillDef(p.data.type);
  const cfg = def.configSchema.safeParse(p.data.config ?? def.defaultConfig);
  if (!cfg.success) return { ok: false, error: zodMessage(cfg.error) };
  try {
    const db = await requireUser();
    const { data: bot } = await db.from("bots").select("id").eq("id", botId).maybeSingle();
    if (!bot) return { ok: false, error: "Bot tidak ditemukan." };
    const row = { enabled: p.data.enabled, description: p.data.description ?? "", config: cfg.data };
    const { data: existing } = await db.from("skills").select("id").eq("bot_id", botId).eq("type", p.data.type).maybeSingle();
    const { error } = existing
      ? await db.from("skills").update(row).eq("id", existing.id)
      : await db.from("skills").insert({ ...row, bot_id: botId, type: p.data.type, name: def.label, tool_name: p.data.type });
    if (error) throw error;
    revalidatePath(`/bots/${botId}/skills`);
    return { ok: true };
  } catch (e) {
    return fail(e, "menyimpan skill");
  }
}

const webhookInput = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(80),
  description: z.string().trim().min(10, "Jelaskan kapan bot harus memanggil API ini (minimal 10 karakter)").max(1000),
  enabled: z.boolean(),
  config: z.object({
    url: z.string(),
    method: z.string(),
    allowedDomains: z.array(z.string()),
    headers: z.array(webhookHeaderSchema.extend({ value: z.string().max(2000).optional() })),
    parameters: z.array(z.unknown()),
    timeoutMs: z.coerce.number(),
  }),
});

/**
 * Simpan webhook. Nilai header rahasia dipisah ke Supabase Vault dan TIDAK disimpan di config.
 * Header rahasia tanpa nilai baru = pakai nilai lama.
 */
export async function saveWebhook(botId: string, skillId: string | null, input: z.input<typeof webhookInput>): Promise<ActionResult<{ id: string }>> {
  if (!id.safeParse(botId).success || (skillId && !id.safeParse(skillId).success)) return { ok: false, error: "Data tidak valid." };
  const p = webhookInput.safeParse(input);
  if (!p.success) return { ok: false, error: zodMessage(p.error) };
  const secretValues = p.data.config.headers.filter((h) => h.secret && h.value).map((h) => ({ name: h.name, value: h.value! }));
  const publicConfig = { ...p.data.config, headers: p.data.config.headers.map((h) => (h.secret ? { name: h.name, secret: true } : { name: h.name, value: h.value ?? "", secret: false })) };
  const cfg = webhookConfigSchema.safeParse(publicConfig);
  if (!cfg.success) return { ok: false, error: zodMessage(cfg.error) };

  try {
    const db = await requireUser();
    const { data: bot } = await db.from("bots").select("id").eq("id", botId).maybeSingle();
    if (!bot) return { ok: false, error: "Bot tidak ditemukan." };
    const { data: others } = await db.from("skills").select("id, tool_name").eq("bot_id", botId);
    const taken = new Set((others ?? []).filter((o) => o.id !== skillId).map((o) => o.tool_name as string));
    const row = { name: p.data.name, description: p.data.description, enabled: p.data.enabled, config: cfg.data, tool_name: webhookToolName(p.data.name, taken) };

    let savedId = skillId;
    let oldSecretNames: string[] = [];
    if (skillId) {
      const { data: old } = await db.from("skills").select("config").eq("id", skillId).eq("bot_id", botId).eq("type", "http_webhook").maybeSingle();
      if (!old) return { ok: false, error: "Integrasi tidak ditemukan." };
      oldSecretNames = ((old.config as { headers?: { name: string; secret?: boolean }[] }).headers ?? []).filter((h) => h.secret).map((h) => h.name.toLowerCase());
      const { error } = await db.from("skills").update(row).eq("id", skillId);
      if (error) throw error;
    } else {
      const { data, error } = await db.from("skills").insert({ ...row, bot_id: botId, type: "http_webhook" }).select("id").single();
      if (error) throw error;
      savedId = data.id as string;
    }

    // Baris skill di atas ditulis lewat RLS (terbukti milik owner); rahasia ditulis dengan secret key server.
    const adm = createAdminClient();
    for (const s of secretValues) {
      const { error } = await adm.rpc("set_skill_secret", { p_skill_id: savedId, p_key: s.name, p_value: s.value });
      if (error) throw error;
    }
    const keep = new Set(cfg.data.headers.filter((h) => h.secret).map((h) => h.name.toLowerCase()));
    for (const name of oldSecretNames.filter((n) => !keep.has(n))) await adm.rpc("delete_skill_secret", { p_skill_id: savedId, p_key: name });

    revalidatePath(`/bots/${botId}/skills`);
    return { ok: true, data: { id: savedId! } };
  } catch (e) {
    return fail(e, "menyimpan integrasi");
  }
}

export async function setWebhookEnabled(botId: string, skillId: string, enabled: boolean): Promise<ActionResult> {
  const p = z.object({ botId: id, skillId: id, enabled: z.boolean() }).safeParse({ botId, skillId, enabled });
  if (!p.success) return { ok: false, error: "Data tidak valid." };
  try {
    const db = await requireUser();
    const { error, count } = await db.from("skills").update({ enabled }, { count: "exact" }).eq("id", skillId).eq("bot_id", botId).eq("type", "http_webhook");
    if (error) throw error;
    if (!count) return { ok: false, error: "Integrasi tidak ditemukan." };
    revalidatePath(`/bots/${botId}/skills`);
    return { ok: true };
  } catch (e) {
    return fail(e, "menyimpan integrasi");
  }
}

/** Hapus webhook. Rahasianya ikut terhapus (trigger database). */
export async function deleteWebhook(botId: string, skillId: string): Promise<ActionResult> {
  const p = z.object({ botId: id, skillId: id }).safeParse({ botId, skillId });
  if (!p.success) return { ok: false, error: "Data tidak valid." };
  try {
    const db = await requireUser();
    const { error, count } = await db.from("skills").delete({ count: "exact" }).eq("id", skillId).eq("bot_id", botId).eq("type", "http_webhook");
    if (error) throw error;
    if (!count) return { ok: false, error: "Integrasi tidak ditemukan." };
    revalidatePath(`/bots/${botId}/skills`);
    return { ok: true };
  } catch (e) {
    return fail(e, "menghapus integrasi");
  }
}

/** Tombol "Tes skill": jalankan skill dengan argumen contoh. Skill yang menyimpan data berjalan dalam mode tes. */
export async function testSkill(
  botId: string,
  ref: { type: SkillType; skillId?: string | null },
  argsJson: string,
): Promise<ActionResult<{ ok: boolean; summary: string; content: string; ms: number }>> {
  const p = z.object({ botId: id, type: z.enum(SKILL_TYPES), skillId: id.nullish(), argsJson: z.string().max(8000) }).safeParse({ botId, ...ref, argsJson });
  if (!p.success) return { ok: false, error: "Data tidak valid." };
  let args: unknown;
  try {
    args = p.data.argsJson.trim() ? JSON.parse(p.data.argsJson) : {};
  } catch {
    return { ok: false, error: "Argumen harus berupa JSON yang valid, mis. {\"query\": \"halo\"}." };
  }
  try {
    const db = await requireUser();
    const { data: bot } = await db.from("bots").select("id, name").eq("id", botId).maybeSingle();
    if (!bot) return { ok: false, error: "Bot tidak ditemukan." };
    const all = await listBotSkills(db, botId);
    const r = all.find((x) => x.skill.type === p.data.type && (p.data.type !== "http_webhook" || x.skill.id === p.data.skillId));
    if (!r) return { ok: false, error: "Skill tidak ditemukan. Simpan dulu." };
    if (r.config === null) return { ok: false, error: "Konfigurasi skill belum valid. Periksa dan simpan ulang." };
    if (!r.available.ok) return { ok: false, error: r.available.reason };
    const t0 = Date.now();
    const out = await executeSkill({ db, bot, conversationId: null, endUserId: null, dryRun: true, citations: [] }, r, args);
    return { ok: true, data: { ok: out.ok, summary: out.summary, content: out.content.slice(0, 6000), ms: Date.now() - t0 } };
  } catch (e) {
    return fail(e, "menjalankan tes");
  }
}

export async function resolveHandoff(botId: string, handoffId: string): Promise<ActionResult> {
  const p = z.object({ botId: id, handoffId: id }).safeParse({ botId, handoffId });
  if (!p.success) return { ok: false, error: "Data tidak valid." };
  try {
    const db = await requireUser();
    const { error, count } = await db
      .from("handoff_requests")
      .update({ status: "resolved", resolved_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", handoffId)
      .eq("bot_id", botId);
    if (error) throw error;
    if (!count) return { ok: false, error: "Permintaan tidak ditemukan." };
    revalidatePath(`/bots/${botId}/conversations`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, "menandai selesai");
  }
}
