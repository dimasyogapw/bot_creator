import "server-only";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

/**
 * HTTP keluar yang aman (cegah SSRF), dipakai knowledge URL, webhook, dan baca halaman web:
 * - hanya http/https di port standar,
 * - setiap alamat IP hasil DNS dicek SAAT koneksi dibuat (menutup celah DNS rebinding),
 * - IP privat, lokal, link-local, metadata cloud ditolak,
 * - allowlist domain opsional, redirect diikuti manual (hanya GET) dan dicek ulang,
 * - batas ukuran dan batas waktu.
 */

/** Kesalahan jaringan dengan pesan yang aman ditampilkan. */
export class NetError extends Error {
  constructor(
    public userMessage: string,
    public kind: "blocked" | "timeout" | "unreachable" | "too_large" | "redirects" | "invalid",
    cause?: unknown,
  ) {
    super(userMessage, { cause });
  }
}

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(addr, prefix, "ipv6");

/** true jika IP tidak boleh dihubungi (privat, lokal, khusus). */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d atau ::ffff:7f00:1)
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isBlockedIp(mapped[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return blocked.check(ip, "ipv6");
  }
  return true;
}

/**
 * Khusus test lokal: host yang boleh dihubungi walau privat (mis. server mock di localhost).
 * Tidak pernah aktif di Vercel.
 */
function testAllowedHosts(): Set<string> {
  if (process.env.VERCEL) return new Set();
  return new Set((process.env.E2E_ALLOW_PRIVATE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
}

export const BLOCKED_MSG = "Alamat lokal atau jaringan internal tidak diizinkan.";

function hostMatches(host: string, allowed: string[]) {
  return allowed.some((d) => {
    const a = d.toLowerCase().replace(/^\*\./, "");
    return host === a || host.endsWith("." + a);
  });
}

/** Validasi bentuk URL (tanpa jaringan). Melempar NetError jika tidak boleh. */
export function assertAllowedUrl(raw: string, opts: { allowedHosts?: string[] } = {}): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new NetError("Alamat web tidak valid.", "invalid");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new NetError("Hanya alamat http:// atau https:// yang didukung.", "invalid");
  if (u.username || u.password) throw new NetError("Alamat dengan username/password tidak didukung.", "invalid");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (opts.allowedHosts?.length && !hostMatches(host, opts.allowedHosts))
    throw new NetError(`Domain ${host} tidak ada di daftar domain yang diizinkan.`, "blocked");
  if (testAllowedHosts().has(host)) return u;
  if (u.port && !["80", "443"].includes(u.port)) throw new NetError("Hanya port standar (80/443) yang didukung.", "invalid");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    throw new NetError(BLOCKED_MSG, "blocked");
  if (net.isIP(host) && isBlockedIp(host)) throw new NetError(BLOCKED_MSG, "blocked");
  return u;
}

/** dns.lookup yang menolak IP terlarang. Dipakai langsung oleh socket, jadi IP yang dicek = IP yang dihubungi. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  const allowTest = testAllowedHosts().has(hostname.toLowerCase());
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const bad = !allowTest && list.find((a) => isBlockedIp(a.address));
    if (bad || !list.length) return callback(Object.assign(new Error(BLOCKED_MSG), { code: "EBLOCKED" }), "", 4);
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export interface SafeRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  maxBytes: number;
  timeoutMs: number;
  allowedHosts?: string[];
  maxRedirects?: number;
}

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

const UA = "BotCreator/1.0 (+https://bot-creator-three.vercel.app)";

function requestOnce(u: URL, r: SafeRequest, signal: AbortSignal): Promise<http.IncomingMessage> {
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(u, {
      method: r.method ?? "GET",
      lookup: safeLookup,
      signal,
      headers: { "user-agent": UA, "accept-encoding": "identity", ...r.headers, ...(r.body ? { "content-length": String(Buffer.byteLength(r.body)) } : {}) },
    });
    req.on("response", resolve);
    req.on("error", reject);
    if (r.body) req.write(r.body);
    req.end();
  });
}

export async function safeRequest(r: SafeRequest): Promise<SafeResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), r.timeoutMs);
  const secs = Math.round(r.timeoutMs / 1000);
  const tooLarge = `Respons terlalu besar (maksimal ${Math.round(r.maxBytes / 1024)} KB).`;
  try {
    let u = assertAllowedUrl(r.url, { allowedHosts: r.allowedHosts });
    const maxRedirects = (r.method ?? "GET") === "GET" ? (r.maxRedirects ?? 3) : 0;
    for (let hop = 0; ; hop++) {
      let res: http.IncomingMessage;
      try {
        res = await requestOnce(u, r, ac.signal);
      } catch (e) {
        if ((e as { code?: string }).code === "EBLOCKED") throw new NetError(BLOCKED_MSG, "blocked", e);
        if (ac.signal.aborted) throw new NetError(`Tidak ada respons dalam ${secs} detik.`, "timeout", e);
        throw new NetError("Alamat tidak bisa dihubungi.", "unreachable", e);
      }
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && hop < maxRedirects) {
        res.resume();
        u = assertAllowedUrl(new URL(res.headers.location, u).toString(), { allowedHosts: r.allowedHosts });
        continue;
      }
      if (status >= 300 && status < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        throw new NetError("Terlalu banyak pengalihan (redirect).", "redirects");
      }
      if (Number(res.headers["content-length"] ?? 0) > r.maxBytes) {
        res.destroy();
        throw new NetError(tooLarge, "too_large");
      }
      const parts: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of res) {
          total += (chunk as Buffer).length;
          if (total > r.maxBytes) {
            res.destroy();
            throw new NetError(tooLarge, "too_large");
          }
          parts.push(chunk as Buffer);
        }
      } catch (e) {
        if (e instanceof NetError) throw e;
        if (ac.signal.aborted) throw new NetError(`Tidak ada respons dalam ${secs} detik.`, "timeout", e);
        throw new NetError("Koneksi terputus.", "unreachable", e);
      }
      return { status, headers: res.headers, body: Buffer.concat(parts), contentType: String(res.headers["content-type"] ?? "").toLowerCase(), finalUrl: u.toString() };
    }
  } finally {
    clearTimeout(timer);
  }
}
