import "server-only";
import { KnowledgeError } from "./extract";
import { NetError, safeRequest } from "@/lib/net/safe-http";

export { assertAllowedUrl, isBlockedIp } from "@/lib/net/safe-http";

/** Ambil halaman web untuk knowledge (aman terhadap SSRF, lihat lib/net/safe-http.ts). */

export const URL_MAX_BYTES = 5 * 1024 * 1024;
export const URL_TIMEOUT_MS = 15_000;

export interface FetchedPage {
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

export async function fetchUrl(raw: string, opts: { allowedHosts?: string[]; maxBytes?: number; timeoutMs?: number } = {}): Promise<FetchedPage> {
  let r;
  try {
    r = await safeRequest({
      url: raw,
      headers: { accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/pdf;q=0.9,*/*;q=0.1" },
      maxBytes: opts.maxBytes ?? URL_MAX_BYTES,
      timeoutMs: opts.timeoutMs ?? URL_TIMEOUT_MS,
      allowedHosts: opts.allowedHosts,
    });
  } catch (e) {
    if (e instanceof NetError) {
      const msg =
        e.kind === "timeout"
          ? "Halaman terlalu lama merespons (lebih dari 15 detik)."
          : e.kind === "unreachable"
            ? "Halaman tidak bisa dihubungi. Periksa alamatnya."
            : e.kind === "too_large"
              ? "Halaman terlalu besar (maksimal 5 MB)."
              : e.userMessage;
      throw new KnowledgeError(msg, e);
    }
    throw e;
  }
  if (r.status < 200 || r.status >= 300) throw new KnowledgeError(`Halaman membalas dengan status ${r.status}.`);
  return { body: r.body, contentType: r.contentType, finalUrl: r.finalUrl };
}
