import { z } from "zod";
import { fetchUrl } from "@/lib/knowledge/fetch-url";
import { extractHtml, extractPdf, extractPlain, KnowledgeError } from "@/lib/knowledge/extract";
import { normalizeText } from "@/lib/knowledge/chunk";
import { NetError } from "@/lib/net/safe-http";
import { domainListSchema } from "../domains";
import { truncate, wrapData, type SkillDefinition } from "../types";

export const webFetchConfigSchema = z.object({ allowedDomains: domainListSchema.default([]) });
type Config = z.infer<typeof webFetchConfigSchema>;
const argsSchema = z.object({ url: z.string().trim().url().max(2000) });

const MAX_CHARS = 12_000;

export const webFetchSkill: SkillDefinition<Config> = {
  type: "web_fetch",
  label: "Baca halaman web",
  ownerDescription: "Bot membuka alamat web (misalnya yang dikirim pengguna) dan menjawab dari isinya. Bisa dibatasi ke domain tertentu.",
  multiple: false,
  defaultEnabled: false,
  configSchema: webFetchConfigSchema,
  defaultConfig: { allowedDomains: [] },
  defaultDescription: "Buka satu halaman web dan ambil teks utamanya. Pakai jika pengguna memberi alamat web atau jawaban butuh isi halaman tertentu. Sebutkan alamat sumbernya di jawaban.",
  activityLabel: () => "Membaca halaman web",
  activityDetail: (args) => argsSchema.safeParse(args).data?.url,
  tool: (s) => ({
    type: "function",
    function: {
      name: s.tool_name,
      description:
        (s.description || webFetchSkill.defaultDescription) +
        (s.config.allowedDomains.length ? ` Hanya domain: ${s.config.allowedDomains.join(", ")}.` : ""),
      parameters: { type: "object", properties: { url: { type: "string", description: "Alamat lengkap, diawali https://" } }, required: ["url"] },
    },
  }),
  async execute(_ctx, s, args) {
    const a = argsSchema.safeParse(args);
    if (!a.success) return { ok: false, content: 'Argumen tidak valid. Kirim {"url": "https://..."}.', summary: "argumen tidak valid" };
    try {
      const page = await fetchUrl(a.data.url, { allowedHosts: s.config.allowedDomains.length ? s.config.allowedDomains : undefined, maxBytes: 3 * 1024 * 1024 });
      const ct = page.contentType.split(";")[0].trim();
      const ex =
        ct === "application/pdf"
          ? await extractPdf(new Uint8Array(page.body))
          : ct === "text/plain" || ct === "text/markdown"
            ? extractPlain(new Uint8Array(page.body))
            : await extractHtml(page.body.toString("utf8"), page.finalUrl);
      const text = normalizeText(ex.segments.map((x) => x.text).join("\n\n"));
      return {
        ok: true,
        content: wrapData("halaman_web", { url: page.finalUrl, judul: ex.title ?? "" }, truncate(text, MAX_CHARS)),
        summary: `${ex.title ?? page.finalUrl} (${text.length.toLocaleString("id-ID")} karakter)`,
      };
    } catch (e) {
      const msg = e instanceof KnowledgeError ? e.userMessage : e instanceof NetError ? e.userMessage : "Halaman tidak bisa dibaca.";
      if (!(e instanceof KnowledgeError || e instanceof NetError)) console.error("[skill web_fetch]", e);
      return { ok: false, content: `Halaman tidak bisa dibuka: ${msg} Sampaikan ke pengguna dengan sopan.`, summary: msg };
    }
  },
};
