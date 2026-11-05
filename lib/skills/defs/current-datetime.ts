import { z } from "zod";
import { wrapData, type SkillDefinition } from "../types";

function validTz(tz: string) {
  try {
    new Intl.DateTimeFormat("id-ID", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const datetimeConfigSchema = z.object({
  timezone: z.string().trim().min(1).max(64).refine(validTz, "Zona waktu tidak dikenal").default("Asia/Jakarta"),
});
type Config = z.infer<typeof datetimeConfigSchema>;

const TZ_LABEL: Record<string, string> = { "Asia/Jakarta": "WIB", "Asia/Pontianak": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" };

/** Waktu saat ini dalam zona waktu tertentu, siap dibaca model. */
export function describeNow(timezone: string, now = new Date()) {
  const long = new Intl.DateTimeFormat("id-ID", { timeZone: timezone, dateStyle: "full", timeStyle: "short" }).format(now);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    text: `${long} ${TZ_LABEL[timezone] ?? timezone}`,
    iso: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute} (${offset.replace("GMT", "UTC") || "UTC"})`,
  };
}

export const currentDatetimeSkill: SkillDefinition<Config> = {
  type: "current_datetime",
  label: "Jam dan tanggal",
  ownerDescription: "Bot tahu tanggal, hari, dan jam saat ini sesuai zona waktu yang dipilih.",
  multiple: false,
  defaultEnabled: false,
  configSchema: datetimeConfigSchema,
  defaultConfig: { timezone: "Asia/Jakarta" },
  defaultDescription: "Ambil tanggal, hari, dan jam saat ini. Pakai setiap kali pertanyaan bergantung pada waktu sekarang (hari ini, besok, jam buka, berapa lama lagi).",
  activityLabel: () => "Melihat jam",
  tool: (s) => ({
    type: "function",
    function: { name: s.tool_name, description: s.description || currentDatetimeSkill.defaultDescription, parameters: { type: "object", properties: {} } },
  }),
  async execute(_ctx, s) {
    const d = describeNow(s.config.timezone);
    return { ok: true, content: wrapData("waktu", { zona: s.config.timezone }, `Sekarang: ${d.text}\nFormat ISO: ${d.iso}`), summary: d.text };
  },
};
