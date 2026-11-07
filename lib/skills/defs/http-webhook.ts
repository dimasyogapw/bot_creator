import { z } from "zod";
import { NetError, safeRequest } from "@/lib/net/safe-http";
import { domainListSchema, hostOf } from "../domains";
import { truncate, wrapData, type SkillDefinition } from "../types";

/** Integrasi API / webhook (mis. workflow n8n). Header rahasia disimpan di Supabase Vault, bukan di config. */

export const webhookParamSchema = z.object({
  name: z.string().trim().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/, "Nama parameter: huruf, angka, garis bawah (maks 40)"),
  type: z.enum(["string", "number", "integer", "boolean"]).default("string"),
  description: z.string().trim().max(300).default(""),
  required: z.boolean().default(false),
});

export const webhookHeaderSchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9-]{1,100}$/, "Nama header tidak valid"),
  /** Hanya untuk header biasa. Nilai header rahasia tidak pernah disimpan di sini. */
  value: z.string().max(2000).optional(),
  secret: z.boolean().default(false),
});

export const webhookConfigSchema = z
  .object({
    url: z
      .string()
      .trim()
      .url("Alamat tidak valid")
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), "Alamat harus diawali http:// atau https://"),
    method: z.enum(["GET", "POST"]).default("POST"),
    allowedDomains: domainListSchema.min(1, "Isi minimal satu domain yang diizinkan"),
    headers: z.array(webhookHeaderSchema).max(10).default([]),
    parameters: z.array(webhookParamSchema).max(15).default([]),
    timeoutMs: z.coerce.number().int().min(1000).max(20_000).default(10_000),
  })
  .superRefine((c, ctx) => {
    const host = hostOf(c.url.replace(/\{[^}]*\}/g, "x"));
    const ok = host && c.allowedDomains.some((d) => host === d.replace(/^\*\./, "") || host.endsWith("." + d.replace(/^\*\./, "")));
    if (!ok) ctx.addIssue({ code: "custom", path: ["url"], message: "Domain alamat harus ada di daftar domain yang diizinkan" });
    const names = c.parameters.map((p) => p.name);
    if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", path: ["parameters"], message: "Nama parameter tidak boleh kembar" });
  });
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_CHARS = 6000;

export function argsSchemaFor(params: WebhookConfig["parameters"]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of params) {
    const base =
      p.type === "number" ? z.coerce.number() : p.type === "integer" ? z.coerce.number().int() : p.type === "boolean" ? z.coerce.boolean() : z.string().max(2000);
    shape[p.name] = p.required ? base : base.optional();
  }
  return z.object(shape).strip();
}

/** Isi {param} di URL, sisa argumen jadi query (GET) atau body JSON (POST). */
export function buildRequest(c: WebhookConfig, args: Record<string, unknown>) {
  const used = new Set<string>();
  const url = c.url.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, name: string) => {
    used.add(name);
    const v = args[name];
    return v === undefined || v === null ? "" : encodeURIComponent(String(v));
  });
  const rest = Object.fromEntries(Object.entries(args).filter(([k, v]) => !used.has(k) && v !== undefined));
  if (c.method === "GET") {
    const u = new URL(url);
    for (const [k, v] of Object.entries(rest)) u.searchParams.set(k, String(v));
    return { url: u.toString(), body: undefined };
  }
  return { url, body: JSON.stringify(rest) };
}

/** Jangan pernah meneruskan nilai rahasia ke model atau log, walau API memantulkannya. */
export function redact(text: string, secrets: string[]) {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[RAHASIA]");
  return out;
}

export const httpWebhookSkill: SkillDefinition<WebhookConfig> = {
  type: "http_webhook",
  label: "Integrasi API (webhook)",
  ownerDescription: "Bot memanggil API atau workflow n8n milikmu, lalu menjawab dari hasilnya. Hanya domain yang kamu izinkan.",
  multiple: true,
  defaultEnabled: true,
  configSchema: webhookConfigSchema as unknown as z.ZodType<WebhookConfig>,
  defaultConfig: { url: "https://", method: "POST", allowedDomains: [], headers: [], parameters: [], timeoutMs: 10_000 },
  defaultDescription: "",
  activityLabel: (s) => `Memanggil ${s.name}`,
  tool: (s) => {
    const properties: Record<string, { type: string; description?: string }> = {};
    for (const p of s.config.parameters) properties[p.name] = { type: p.type, ...(p.description ? { description: p.description } : {}) };
    return {
      type: "function",
      function: {
        name: s.tool_name,
        description: s.description || `Panggil API "${s.name}".`,
        parameters: { type: "object", properties, required: s.config.parameters.filter((p) => p.required).map((p) => p.name) },
      },
    };
  },
  async execute(ctx, s, args) {
    const parsed = argsSchemaFor(s.config.parameters).safeParse(args ?? {});
    if (!parsed.success)
      return { ok: false, content: `Argumen tidak valid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, summary: "argumen tidak valid" };

    if (ctx.skipWebhookPost && s.config.method === "POST")
      return { ok: true, content: "(Mode eval) Permintaan POST tidak dikirim karena bisa berefek nyata. Anggap permintaan berhasil dan jawab sewajarnya.", summary: "dilewati (mode eval)" };

    let secrets: Record<string, string> = {};
    if (s.id && s.config.headers.some((h) => h.secret)) {
      try {
        secrets = (await ctx.loadSecrets?.(s.id)) ?? {};
      } catch (e) {
        console.error("[skill webhook] gagal membaca rahasia", e);
        return { ok: false, content: "Konfigurasi API tidak bisa dibaca. Sampaikan ke pengguna dengan sopan bahwa layanan sedang bermasalah.", summary: "rahasia tidak terbaca" };
      }
    }
    const headers: Record<string, string> = { accept: "application/json, text/plain;q=0.9, */*;q=0.5" };
    if (s.config.method === "POST") headers["content-type"] = "application/json";
    for (const h of s.config.headers) {
      const v = h.secret ? secrets[h.name.toLowerCase()] : h.value;
      if (v) headers[h.name] = v;
    }

    const req = buildRequest(s.config, parsed.data);
    const t0 = Date.now();
    try {
      const r = await safeRequest({ url: req.url, method: s.config.method, headers, body: req.body, maxBytes: MAX_RESPONSE_BYTES, timeoutMs: s.config.timeoutMs, allowedHosts: s.config.allowedDomains });
      const ms = Date.now() - t0;
      let text = r.body.toString("utf8");
      if (r.contentType.includes("json")) {
        try {
          text = JSON.stringify(JSON.parse(text), null, 1);
        } catch {
          // biarkan apa adanya
        }
      }
      text = redact(truncate(text, MAX_CHARS), Object.values(secrets));
      const ok = r.status >= 200 && r.status < 300;
      const summary = `status ${r.status} · ${(ms / 1000).toFixed(1).replace(".", ",")} dtk`;
      if (!ok)
        return {
          ok: false,
          content: `${wrapData("hasil_api", { nama: s.name, status: String(r.status) }, text)}\nAPI membalas error (status ${r.status}). Jangan mengarang data. Sampaikan ke pengguna dengan sopan bahwa informasinya sedang tidak bisa diambil.`,
          summary,
        };
      return { ok: true, content: wrapData("hasil_api", { nama: s.name, status: String(r.status) }, text || "(kosong)"), summary };
    } catch (e) {
      const msg = e instanceof NetError ? e.userMessage : "Panggilan API gagal.";
      if (!(e instanceof NetError)) console.error("[skill webhook]", e);
      return {
        ok: false,
        content: `Panggilan API "${s.name}" gagal: ${msg} Jangan mengarang data. Sampaikan ke pengguna dengan sopan bahwa informasinya sedang tidak bisa diambil dan sarankan mencoba lagi nanti.`,
        summary: msg,
      };
    }
  },
};
