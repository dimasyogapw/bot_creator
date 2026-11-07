import { z } from "zod";
import { searchKnowledge } from "@/lib/knowledge/search";
import { assignCitations, formatToolResult } from "@/lib/knowledge/format";
import { searchArgsSchema } from "@/lib/knowledge/schema";
import type { SkillDefinition } from "../types";

export const searchKnowledgeSkill: SkillDefinition<Record<string, never>> = {
  type: "search_knowledge",
  label: "Cari di knowledge",
  ownerDescription: "Bot mencari jawaban di dokumen tab Knowledge dan menyebut sumbernya. Hanya aktif jika ada sumber yang siap.",
  multiple: false,
  defaultEnabled: true,
  configSchema: z.object({}).strip() as unknown as z.ZodType<Record<string, never>>,
  defaultConfig: {},
  defaultDescription:
    "Cari informasi di dokumen knowledge milik pemilik bot (file, halaman web, teks SOP). Pakai kata kunci yang spesifik dalam bahasa dokumen. Mengembalikan potongan dokumen bernomor untuk dikutip.",
  activityLabel: () => "Mencari di knowledge",
  activityDetail: (args) => searchArgsSchema.safeParse(args).data?.query,
  tool: (s) => ({
    type: "function",
    function: {
      name: "search_knowledge",
      description: s.description || searchKnowledgeSkill.defaultDescription,
      parameters: { type: "object", properties: { query: { type: "string", description: "Kata kunci atau pertanyaan yang dicari" } }, required: ["query"] },
    },
  }),
  async execute(ctx, _s, args) {
    const a = searchArgsSchema.safeParse(args);
    if (!a.success) return { ok: false, content: 'Argumen tidak valid. Kirim {"query": "kata kunci pencarian"}.', summary: "argumen tidak valid" };
    const hits = await searchKnowledge(ctx.db, ctx.bot.id, a.data.query, undefined, ctx.usage);
    const r = assignCitations(hits, ctx.citations);
    ctx.citations.splice(0, ctx.citations.length, ...r.citations);
    return { ok: true, content: formatToolResult(a.data.query, r.numbered), summary: `${hits.length} potongan ditemukan` };
  },
};
