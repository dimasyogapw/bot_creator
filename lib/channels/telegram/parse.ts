import crypto from "node:crypto";
import { z } from "zod";

/** Bentuk update Telegram yang kita butuhkan (sisanya diabaikan). */
const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z
    .object({
      message_id: z.number().int(),
      date: z.number().optional(),
      chat: z.object({ id: z.number().int(), type: z.string().max(20) }),
      from: z.object({ id: z.number().int(), is_bot: z.boolean().optional(), first_name: z.string().max(200).optional(), username: z.string().max(100).optional() }).optional(),
      text: z.string().max(20_000).optional(),
    })
    .passthrough()
    .optional(),
});

export type ParsedUpdate =
  | { kind: "ignore"; updateId: number }
  | { kind: "unsupported"; updateId: number; chatId: number }
  | { kind: "text"; updateId: number; chatId: number; text: string; displayName: string | null };

/** Maks panjang pesan pengguna yang diteruskan ke bot (sama dengan channel publik lain). */
export const MAX_INCOMING_CHARS = 4000;

export function parseUpdate(raw: unknown): ParsedUpdate | null {
  const p = updateSchema.safeParse(raw);
  if (!p.success) return null;
  const { update_id: updateId, message } = p.data;
  // Hanya chat pribadi dari manusia. Grup, kanal, dan bot lain diabaikan.
  if (!message || message.chat.type !== "private" || message.from?.is_bot) return { kind: "ignore", updateId };
  if (typeof message.text !== "string" || !message.text.trim()) return { kind: "unsupported", updateId, chatId: message.chat.id };
  const f = message.from;
  const displayName = f?.username ? `@${f.username}` : (f?.first_name ?? null);
  return { kind: "text", updateId, chatId: message.chat.id, text: message.text.trim().slice(0, MAX_INCOMING_CHARS), displayName };
}

export type Command = { name: "start" | "baru" } | null;

/** Perintah yang dikenali: /start dan /baru (boleh dengan @username bot dan argumen). */
export function parseCommand(text: string, botUsername?: string | null): Command {
  const m = /^\/([a-z_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s|$)/i.exec(text.trim());
  if (!m) return null;
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  const name = m[1].toLowerCase();
  return name === "start" || name === "baru" ? { name } : null;
}

/** Perbandingan rahasia yang aman dari serangan waktu (panjang tidak bocor). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function newWebhookSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}
