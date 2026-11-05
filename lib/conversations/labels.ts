import type { Channel } from "@/lib/db/types";

export const CHANNEL_LABELS: Record<Channel, string> = {
  playground: "Playground",
  web: "Link publik",
  widget: "Widget",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

export const CHANNELS = Object.keys(CHANNEL_LABELS) as Channel[];

const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
export function formatDateTime(iso: string) {
  return fmt.format(new Date(iso));
}
