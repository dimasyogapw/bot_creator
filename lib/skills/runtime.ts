import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatTool } from "@/lib/llm/provider";
import { hasReadyKnowledge } from "@/lib/knowledge/search";
import { BUILTIN_ORDER, getSkillDef } from "./registry";
import type { SkillContext, SkillDefinition, SkillRow, SkillType, ToolOutcome } from "./types";

export interface ResolvedSkill {
  def: SkillDefinition<unknown>;
  skill: SkillRow;
  /** Konfigurasi sudah divalidasi; null jika rusak. */
  config: unknown | null;
  available: { ok: true } | { ok: false; reason: string };
}

/** Semua skill bot (bawaan yang belum disimpan memakai nilai bawaan). Untuk tab Skills dan runBot. */
export async function listBotSkills(db: SupabaseClient, botId: string): Promise<ResolvedSkill[]> {
  const { data, error } = await db
    .from("skills")
    .select("id, bot_id, type, name, tool_name, description, config, enabled")
    .eq("bot_id", botId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as SkillRow[];
  const out: ResolvedSkill[] = [];
  for (const type of BUILTIN_ORDER) {
    const def = getSkillDef(type);
    const row = rows.find((r) => r.type === type) ?? {
      id: null,
      bot_id: botId,
      type,
      name: def.label,
      tool_name: type,
      description: "",
      config: def.defaultConfig,
      enabled: def.defaultEnabled,
    };
    out.push(resolve(def, row));
  }
  for (const row of rows.filter((r) => r.type === "http_webhook")) out.push(resolve(getSkillDef("http_webhook"), row));
  return out;
}

function resolve(def: SkillDefinition<unknown>, row: SkillRow): ResolvedSkill {
  const parsed = def.configSchema.safeParse(row.config ?? {});
  if (!parsed.success) console.warn("[skills] konfigurasi tidak valid", row.type, row.id);
  return { def, skill: row, config: parsed.success ? parsed.data : null, available: def.availability?.() ?? { ok: true } };
}

export interface ActiveTools {
  tools: ChatTool[];
  byName: Map<string, ResolvedSkill>;
}

/** Skill yang benar-benar dikirim ke model: aktif, konfigurasi valid, syarat terpenuhi. */
export async function activeTools(db: SupabaseClient, botId: string): Promise<ActiveTools> {
  const all = await listBotSkills(db, botId);
  const byName = new Map<string, ResolvedSkill>();
  const tools: ChatTool[] = [];
  for (const r of all) {
    if (!r.skill.enabled || r.config === null || !r.available.ok) continue;
    if (r.skill.type === "search_knowledge" && !(await hasReadyKnowledge(db, botId))) continue;
    const tool = r.def.tool({ ...r.skill, config: r.config as never });
    if (tool.type !== "function" || byName.has(tool.function.name)) continue;
    byName.set(tool.function.name, r);
    tools.push(tool);
  }
  return { tools, byName };
}

export async function executeSkill(ctx: SkillContext, r: ResolvedSkill, args: unknown): Promise<ToolOutcome> {
  try {
    return await r.def.execute(ctx, { ...r.skill, config: r.config as never }, args);
  } catch (e) {
    console.error(`[skills] ${r.skill.type} gagal`, e);
    return { ok: false, content: "Alat ini gagal dijalankan. Sampaikan ke pengguna dengan sopan bahwa informasinya belum bisa diambil.", summary: "error tak terduga" };
  }
}

export type { SkillType };
