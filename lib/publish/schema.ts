import { z } from "zod";

/**
 * Domain yang boleh memasang widget: "contoh.com", "*.contoh.com", "localhost:3000",
 * atau dengan skema ("http://contoh.com") bila situsnya belum memakai https.
 */
export const widgetDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((d) => d.replace(/\/+$/, ""))
  .pipe(z.string().regex(/^(https?:\/\/)?(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(:\d{1,5})?$/, "Domain tidak valid (contoh: tokoku.com atau *.tokoku.com)"));

export const widgetSchema = z.object({
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Warna harus format #RRGGBB")
    .default("#4f46e5"),
  position: z.enum(["right", "left"]).default("right"),
  buttonText: z.string().trim().max(30).default("Chat"),
});
export type WidgetSettings = z.infer<typeof widgetSchema>;

export const publishSettingsSchema = z.object({
  is_public: z.boolean(),
  daily_cost_limit_usd: z.coerce.number().min(0, "Minimal 0").max(1000, "Maksimal USD 1000"),
  daily_message_limit: z.coerce.number().int().min(0).max(100_000),
  per_minute_limit: z.coerce.number().int().min(1, "Minimal 1").max(600),
  limit_message: z.string().trim().min(1, "Pesan batas wajib diisi").max(500),
  widget: widgetSchema,
  allowed_domains: z.array(widgetDomainSchema).max(20, "Maksimal 20 domain"),
});
export type PublishSettings = z.infer<typeof publishSettingsSchema>;

/** ID pengunjung anonim (acak, dibuat browser). */
export const visitorIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

export const publicChatSchema = z
  .object({
    visitorId: visitorIdSchema,
    channel: z.enum(["web", "widget"]),
    conversationId: z.string().uuid().nullish(),
    message: z.string().trim().min(1).max(4000).optional(),
    regenerate: z.boolean().optional(),
  })
  .refine((b) => (b.regenerate ? !!b.conversationId : !!b.message), { message: "Pesan kosong" });

/** Nilai header CSP frame-ancestors dari daftar domain. Tanpa domain: hanya aplikasi ini sendiri. */
export function frameAncestors(domains: string[]): string {
  const clean = domains.map((d) => widgetDomainSchema.safeParse(d)).flatMap((r) => (r.success ? [r.data] : []));
  return ["'self'", ...clean].join(" ");
}
