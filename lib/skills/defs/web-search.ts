import { z } from "zod";
import { NetError } from "@/lib/net/safe-http";
import { tavilyConfigured, tavilySearch } from "@/lib/search/tavily";
import { domainListSchema } from "../domains";
import { truncate, wrapData, type SkillDefinition } from "../types";

export const webSearchConfigSchema = z.object({
  maxResults: z.coerce.number().int().min(1).max(10).default(5),
  includeDomains: domainListSchema.default([]),
});
type Config = z.infer<typeof webSearchConfigSchema>;
const argsSchema = z.object({ query: z.string().trim().min(1).max(400) });

export const webSearchSkill: SkillDefinition<Config> = {
  type: "web_search",
  label: "Cari di internet",
  ownerDescription: "Bot mencari informasi terbaru di internet (lewat Tavily) dan menyebut sumbernya. Butuh API key Tavily di server.",
  multiple: false,
  defaultEnabled: false,
  configSchema: webSearchConfigSchema,
  defaultConfig: { maxResults: 5, includeDomains: [] },
  defaultDescription:
    "Cari informasi terbaru di internet. Pakai untuk berita, harga, jadwal, atau fakta yang bisa berubah dan tidak ada di knowledge. Sebutkan judul dan alamat sumber di jawaban.",
  activityLabel: () => "Mencari di internet",
  activityDetail: (args) => argsSchema.safeParse(args).data?.query,
  availability: () => (tavilyConfigured() ? { ok: true } : { ok: false, reason: "API key Tavily belum diisi di server (TAVILY_API_KEY)." }),
  tool: (s) => ({
    type: "function",
    function: {
      name: s.tool_name,
      description: s.description || webSearchSkill.defaultDescription,
      parameters: { type: "object", properties: { query: { type: "string", description: "Kata kunci pencarian" } }, required: ["query"] },
    },
  }),
  async execute(_ctx, s, args) {
    const a = argsSchema.safeParse(args);
    if (!a.success) return { ok: false, content: 'Argumen tidak valid. Kirim {"query": "..."}.', summary: "argumen tidak valid" };
    try {
      const results = await tavilySearch(a.data.query, { maxResults: s.config.maxResults, includeDomains: s.config.includeDomains });
      if (!results.length) return { ok: true, content: `Tidak ada hasil pencarian untuk "${a.data.query}".`, summary: "0 hasil" };
      const body = results.map((r, i) => `[${i + 1}] ${r.title}\nAlamat: ${r.url}\n${truncate(r.content, 1500)}`).join("\n\n");
      return { ok: true, content: wrapData("hasil_pencarian", { kueri: a.data.query }, body), summary: `${results.length} hasil` };
    } catch (e) {
      const msg = e instanceof NetError ? e.userMessage : "Pencarian gagal.";
      if (!(e instanceof NetError)) console.error("[skill web_search]", e);
      return { ok: false, content: `Pencarian internet gagal: ${msg} Sampaikan ke pengguna dengan sopan bahwa pencarian sedang tidak bisa dilakukan.`, summary: msg };
    }
  },
};
