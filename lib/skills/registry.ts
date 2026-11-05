import type { SkillDefinition, SkillType } from "./types";
import { searchKnowledgeSkill } from "./defs/search-knowledge";
import { httpWebhookSkill } from "./defs/http-webhook";
import { currentDatetimeSkill } from "./defs/current-datetime";
import { webFetchSkill } from "./defs/web-fetch";
import { webSearchSkill } from "./defs/web-search";
import { handoffSkill } from "./defs/handoff";
import { captureLeadSkill } from "./defs/capture-lead";

/** Registry skill. Menambah tipe baru: buat satu file di defs/ lalu daftarkan di sini (dan di constraint tabel skills). */
export const SKILLS: Record<SkillType, SkillDefinition<never>> = {
  search_knowledge: searchKnowledgeSkill as SkillDefinition<never>,
  current_datetime: currentDatetimeSkill as SkillDefinition<never>,
  web_fetch: webFetchSkill as SkillDefinition<never>,
  web_search: webSearchSkill as SkillDefinition<never>,
  handoff_to_human: handoffSkill as SkillDefinition<never>,
  capture_lead: captureLeadSkill as SkillDefinition<never>,
  http_webhook: httpWebhookSkill as SkillDefinition<never>,
};

/** Urutan tampil di tab Skills. */
export const BUILTIN_ORDER: SkillType[] = ["search_knowledge", "current_datetime", "web_fetch", "web_search", "handoff_to_human", "capture_lead"];

export function getSkillDef(type: SkillType): SkillDefinition<unknown> {
  return SKILLS[type] as SkillDefinition<unknown>;
}

/** Nama fungsi untuk model dari nama webhook: huruf kecil, angka, garis bawah. */
export function webhookToolName(name: string, taken: Set<string>): string {
  const base =
    "api_" +
      name
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "api_webhook";
  let t = base === "api_" ? "api_webhook" : base;
  for (let i = 2; taken.has(t); i++) t = `${base.slice(0, 55)}_${i}`;
  return t;
}
