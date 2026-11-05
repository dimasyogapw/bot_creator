import "server-only";
import { NetError, safeRequest } from "@/lib/net/safe-http";

/** Pencarian internet lewat Tavily. API key hanya di server (env TAVILY_API_KEY). */

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export function tavilyConfigured() {
  return !!process.env.TAVILY_API_KEY?.trim();
}

export async function tavilySearch(query: string, opts: { maxResults: number; includeDomains?: string[] }): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) throw new NetError("Layanan pencarian belum dikonfigurasi.", "invalid");
  const r = await safeRequest({
    url: "https://api.tavily.com/search",
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      max_results: opts.maxResults,
      search_depth: "basic",
      include_answer: false,
      ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
    }),
    maxBytes: 1024 * 1024,
    timeoutMs: 15_000,
    allowedHosts: ["api.tavily.com"],
  });
  if (r.status === 401 || r.status === 403) throw new NetError("API key layanan pencarian ditolak.", "invalid");
  if (r.status === 429 || r.status === 432) throw new NetError("Kuota layanan pencarian habis.", "invalid");
  if (r.status < 200 || r.status >= 300) throw new NetError(`Layanan pencarian membalas status ${r.status}.`, "unreachable");
  const j = JSON.parse(r.body.toString("utf8")) as { results?: { title?: string; url?: string; content?: string }[] };
  return (j.results ?? []).map((x) => ({ title: x.title ?? "", url: x.url ?? "", content: x.content ?? "" })).filter((x) => x.url);
}
