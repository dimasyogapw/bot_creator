import { z } from "zod";
import { NetError } from "@/lib/net/safe-http";
import { tavilyConfigured, tavilySearch } from "@/lib/search/tavily";
import { chat } from "@/lib/llm/provider";
import { recordLlmUsage } from "@/lib/llm/usage";
import type { ProviderUsage } from "@/lib/bot/pricing";
import { supportsNativeWebSearch } from "@/lib/llm/capabilities";
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
  ownerDescription:
    "Bot mencari informasi terbaru di internet dan menyebut sumbernya, memakai pencarian bawaan model (Claude/Gemini) lewat SumoPod. Tidak perlu daftar layanan lain. Biaya sekitar USD 0,01 per pencarian.",
  multiple: false,
  defaultEnabled: false,
  configSchema: webSearchConfigSchema,
  defaultConfig: { maxResults: 5, includeDomains: [] },
  defaultDescription:
    "Cari informasi terbaru di internet. Pakai untuk berita, harga, jadwal, atau fakta yang bisa berubah dan tidak ada di knowledge. Sebutkan judul dan alamat sumber di jawaban.",
  activityLabel: () => "Mencari di internet",
  activityDetail: (args) => argsSchema.safeParse(args).data?.query,
  native: (model) => supportsNativeWebSearch(model),
  availability: (model) =>
    supportsNativeWebSearch(model) || tavilyConfigured()
      ? { ok: true }
      : { ok: false, reason: `Model bot ini (${model}) tidak punya pencarian internet bawaan. Ganti ke model Claude atau Gemini di tab Persona.` },
  tool: (s) => ({
    type: "function",
    function: {
      name: s.tool_name,
      description: s.description || webSearchSkill.defaultDescription,
      parameters: { type: "object", properties: { query: { type: "string", description: "Kata kunci pencarian" } }, required: ["query"] },
    },
  }),
  async execute(ctx, s, args) {
    const a = argsSchema.safeParse(args);
    if (!a.success) return { ok: false, content: 'Argumen tidak valid. Kirim {"query": "..."}.', summary: "argumen tidak valid" };
    // Dipakai tombol "Tes skill": saat chat, pencarian bawaan dijalankan langsung oleh provider.
    if (ctx.model && supportsNativeWebSearch(ctx.model)) {
      try {
        const res = await chat({
          model: ctx.model,
          maxTokens: 2048,
          webSearch: true,
          messages: [{ role: "user", content: `Cari di internet lalu rangkum singkat dengan alamat sumbernya: ${a.data.query}` }],
        });
        await recordLlmUsage(ctx.usage, "web_search_test", ctx.model, res.usage as ProviderUsage | undefined);
        const text = res.choices[0]?.message?.content ?? "";
        const searches = (res.usage as { server_tool_use?: { web_search_requests?: number } } | undefined)?.server_tool_use?.web_search_requests ?? 0;
        return { ok: !!text, content: text || "(kosong)", summary: `pencarian bawaan model, ${searches} pencarian` };
      } catch (e) {
        console.error("[skill web_search] pencarian bawaan gagal", e);
        return { ok: false, content: "Pencarian internet gagal. Sampaikan ke pengguna dengan sopan.", summary: "pencarian bawaan gagal" };
      }
    }
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
