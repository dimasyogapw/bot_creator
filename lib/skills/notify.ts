import "server-only";
import { safeRequest } from "@/lib/net/safe-http";
import { hostOf } from "./domains";

/** Kirim notifikasi JSON ke webhook owner (mis. n8n). Gagal tidak menghentikan chat. */
export async function notifyWebhook(url: string | undefined, payload: Record<string, unknown>) {
  if (!url) return { sent: false as const };
  const host = hostOf(url);
  if (!host) return { sent: false as const };
  try {
    const r = await safeRequest({
      url,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      maxBytes: 64 * 1024,
      timeoutMs: 5000,
      allowedHosts: [host],
    });
    return { sent: r.status >= 200 && r.status < 300, status: r.status };
  } catch (e) {
    console.warn("[notify] webhook gagal", e instanceof Error ? e.message : e);
    return { sent: false as const };
  }
}
