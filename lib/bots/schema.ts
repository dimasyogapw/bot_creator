import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .refine((v) => !v || /^https:\/\/\S+$/i.test(v), "Alamat avatar harus diawali https://")
  .transform((v) => v || null);

export const botInputSchema = z.object({
  name: z.string().trim().min(1, "Nama bot wajib diisi").max(80, "Nama maksimal 80 karakter"),
  avatar_url: optionalUrl,
  system_prompt: z.string().max(20000, "Instruksi maksimal 20.000 karakter").default(""),
  model: z.string().trim().min(1, "Pilih model"),
  temperature: z.coerce.number().min(0).max(1).default(0.7),
  max_tokens: z.coerce.number().int().min(1024, "Minimal 1024 token").max(16000, "Maksimal 16.000 token").default(2048),
  welcome_message: z
    .string()
    .trim()
    .max(1000, "Pesan sambutan maksimal 1000 karakter")
    .optional()
    .transform((v) => v || null),
});
export type BotInput = z.input<typeof botInputSchema>;

export const botSettingsSchema = botInputSchema.pick({ model: true, temperature: true, max_tokens: true });

export const personaAnswersSchema = z.object({
  name: z.string().trim().max(80).default(""),
  purpose: z.string().trim().min(5, "Ceritakan tujuan bot minimal 5 karakter").max(1000),
  audience: z.string().trim().max(500).default(""),
  tone: z.enum(["santai", "ramah", "profesional", "formal"]).default("ramah"),
  allowed: z.string().trim().max(1000).default(""),
  forbidden: z.string().trim().max(1000).default(""),
  examples: z.string().trim().max(1500).default(""),
});
export type PersonaAnswers = z.input<typeof personaAnswersSchema>;

export const personaResultSchema = z.object({
  system_prompt: z.string().min(20).max(20000),
  welcome_message: z.string().max(1000),
});
export type PersonaResult = z.infer<typeof personaResultSchema>;

export function slugify(name: string) {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return s || "bot";
}

/** Ubah hasil validasi Zod menjadi pesan per field. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
