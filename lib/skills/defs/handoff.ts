import { z } from "zod";
import { notifyWebhook } from "../notify";
import type { SkillDefinition } from "../types";

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => !u || /^https:\/\//i.test(u), "Alamat notifikasi harus diawali https://")
  .optional()
  .transform((u) => u || undefined);

export const handoffConfigSchema = z.object({
  notifyUrl: optionalUrl,
  replyHint: z.string().trim().max(300).default("Tim kami akan segera menghubungi kamu."),
});
type Config = z.infer<typeof handoffConfigSchema>;
const argsSchema = z.object({ reason: z.string().trim().min(1).max(500), summary: z.string().trim().max(2000).optional() });

export const handoffSkill: SkillDefinition<Config> = {
  type: "handoff_to_human",
  label: "Alihkan ke manusia",
  ownerDescription: "Jika pengguna minta bicara dengan orang atau masalahnya tidak bisa diselesaikan bot, permintaannya dicatat dan muncul di tab Percakapan. Opsional diteruskan ke webhook (mis. n8n ke WhatsApp/email).",
  multiple: false,
  defaultEnabled: false,
  configSchema: handoffConfigSchema as unknown as z.ZodType<Config>,
  defaultConfig: { notifyUrl: undefined, replyHint: "Tim kami akan segera menghubungi kamu." },
  defaultDescription:
    "Teruskan percakapan ke manusia (tim pemilik bot). Pakai jika pengguna meminta bicara dengan orang/admin/CS, marah, atau masalahnya tidak bisa kamu selesaikan. Isi alasan dan ringkasan singkat kebutuhan pengguna.",
  activityLabel: () => "Menghubungi tim",
  tool: (s) => ({
    type: "function",
    function: {
      name: s.tool_name,
      description: s.description || handoffSkill.defaultDescription,
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Alasan singkat perlu manusia" },
          summary: { type: "string", description: "Ringkasan kebutuhan pengguna untuk tim" },
        },
        required: ["reason"],
      },
    },
  }),
  async execute(ctx, s, args) {
    const a = argsSchema.safeParse(args);
    if (!a.success) return { ok: false, content: 'Argumen tidak valid. Kirim {"reason": "...", "summary": "..."}.', summary: "argumen tidak valid" };
    if (ctx.dryRun) return { ok: true, content: `(Mode tes, tidak disimpan) Permintaan dicatat. Sampaikan: ${s.config.replyHint}`, summary: "mode tes" };
    if (!ctx.conversationId) return { ok: false, content: "Percakapan tidak ditemukan.", summary: "tanpa percakapan" };

    // Satu permintaan terbuka per percakapan sudah cukup.
    const { data: open } = await ctx.db.from("handoff_requests").select("id").eq("conversation_id", ctx.conversationId).eq("status", "open").maybeSingle();
    if (!open) {
      const { error } = await ctx.db
        .from("handoff_requests")
        .insert({ bot_id: ctx.bot.id, conversation_id: ctx.conversationId, end_user_id: ctx.endUserId, reason: a.data.reason, summary: a.data.summary ?? null });
      if (error) {
        console.error("[skill handoff] gagal menyimpan", error);
        return { ok: false, content: "Permintaan gagal dicatat. Minta maaf dan sarankan pengguna menghubungi kontak resmi.", summary: "gagal menyimpan" };
      }
      await notifyWebhook(s.config.notifyUrl, {
        event: "handoff_requested",
        bot: ctx.bot.name,
        bot_id: ctx.bot.id,
        conversation_id: ctx.conversationId,
        reason: a.data.reason,
        summary: a.data.summary ?? null,
      });
    }
    return {
      ok: true,
      content: `Permintaan bantuan manusia sudah dicatat${open ? " (sudah ada sebelumnya)" : ""}. Sampaikan ke pengguna dengan ramah: ${s.config.replyHint} Jangan menjanjikan waktu tertentu.`,
      summary: open ? "sudah ada permintaan terbuka" : "permintaan dicatat",
    };
  },
};
