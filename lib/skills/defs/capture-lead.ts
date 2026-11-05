import { z } from "zod";
import { sensitiveReason } from "@/lib/memory/sensitive";
import { notifyWebhook } from "../notify";
import type { SkillDefinition } from "../types";

export const leadFieldSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, "Kunci: huruf kecil, angka, garis bawah"),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(""),
  required: z.boolean().default(false),
});

export const leadConfigSchema = z
  .object({
    fields: z.array(leadFieldSchema).min(1, "Isi minimal satu data").max(15),
    notifyUrl: z
      .string()
      .trim()
      .max(2000)
      .refine((u) => !u || /^https:\/\//i.test(u), "Alamat notifikasi harus diawali https://")
      .optional()
      .transform((u) => u || undefined),
  })
  .superRefine((c, ctx) => {
    const keys = c.fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["fields"], message: "Kunci data tidak boleh kembar" });
  });
type Config = z.infer<typeof leadConfigSchema>;

export const DEFAULT_LEAD_FIELDS: Config["fields"] = [
  { key: "nama", label: "Nama", description: "Nama pengguna", required: true },
  { key: "nomor_hp", label: "Nomor HP/WA", description: "Nomor yang bisa dihubungi", required: true },
  { key: "kebutuhan", label: "Kebutuhan", description: "Apa yang dicari atau ditanyakan", required: false },
];

export const captureLeadSkill: SkillDefinition<Config> = {
  type: "capture_lead",
  label: "Simpan data pelanggan",
  ownerDescription: "Bot mengumpulkan data yang kamu tentukan (mis. nama, nomor HP, kebutuhan) lalu menyimpannya. Lihat dan unduh CSV di halaman data pelanggan.",
  multiple: false,
  defaultEnabled: false,
  configSchema: leadConfigSchema as unknown as z.ZodType<Config>,
  defaultConfig: { fields: DEFAULT_LEAD_FIELDS, notifyUrl: undefined },
  defaultDescription:
    "Simpan data calon pelanggan setelah pengguna bersedia memberikannya (mis. ingin dihubungi, pesan, daftar, atau minta penawaran). Tanyakan data wajib yang belum ada sebelum menyimpan. Jangan menyimpan tanpa persetujuan pengguna.",
  activityLabel: () => "Menyimpan data",
  tool: (s) => {
    const properties: Record<string, { type: string; description: string }> = {};
    for (const f of s.config.fields) properties[f.key] = { type: "string", description: [f.label, f.description].filter(Boolean).join(": ") };
    return {
      type: "function",
      function: {
        name: s.tool_name,
        description: s.description || captureLeadSkill.defaultDescription,
        parameters: { type: "object", properties, required: s.config.fields.filter((f) => f.required).map((f) => f.key) },
      },
    };
  },
  async execute(ctx, s, args) {
    const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    const data: Record<string, string> = {};
    const rejected: string[] = [];
    for (const f of s.config.fields) {
      const v = typeof input[f.key] === "string" || typeof input[f.key] === "number" ? String(input[f.key]).trim().slice(0, 500) : "";
      if (!v) continue;
      // Data pelanggan boleh berisi nomor HP, tapi tidak nomor kartu, NIK, rekening, atau password.
      if (sensitiveReason(v)) rejected.push(f.label);
      else data[f.key] = v;
    }
    const missing = s.config.fields.filter((f) => f.required && !data[f.key]).map((f) => f.label);
    if (missing.length)
      return {
        ok: false,
        content: `Data belum lengkap. Tanyakan ke pengguna: ${missing.join(", ")}.${rejected.length ? ` Data ${rejected.join(", ")} tidak boleh berisi data sensitif.` : ""}`,
        summary: `kurang: ${missing.join(", ")}`,
      };
    if (ctx.dryRun) return { ok: true, content: `(Mode tes, tidak disimpan) Data valid: ${JSON.stringify(data)}`, summary: "mode tes" };

    const { error } = await ctx.db.from("leads").insert({ bot_id: ctx.bot.id, conversation_id: ctx.conversationId, end_user_id: ctx.endUserId, data });
    if (error) {
      console.error("[skill capture_lead] gagal menyimpan", error);
      return { ok: false, content: "Data gagal disimpan. Minta maaf ke pengguna dan sarankan mencoba lagi.", summary: "gagal menyimpan" };
    }
    await notifyWebhook(s.config.notifyUrl, { event: "lead_captured", bot: ctx.bot.name, bot_id: ctx.bot.id, conversation_id: ctx.conversationId, data });
    return {
      ok: true,
      content: `Data tersimpan.${rejected.length ? ` (${rejected.join(", ")} tidak disimpan karena berisi data sensitif.)` : ""} Konfirmasi ke pengguna dengan singkat bahwa datanya sudah dicatat.`,
      summary: `tersimpan: ${Object.keys(data).join(", ")}`,
    };
  },
};
