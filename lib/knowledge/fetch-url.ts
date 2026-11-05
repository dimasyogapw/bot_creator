import "server-only";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import { KnowledgeError } from "./extract";

/**
 * Ambil halaman web dengan aman (cegah SSRF):
 * - hanya http/https di port standar,
 * - setiap alamat IP hasil DNS dicek SAAT koneksi dibuat (menutup celah DNS rebinding),
 * - IP privat, lokal, link-local, metadata cloud ditolak,
 * - redirect diikuti manual (maks 3) dan dicek ulang,
 * - batas ukuran dan batas waktu.
 */

export const URL_MAX_BYTES = 5 * 1024 * 1024;
export const URL_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

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

/** Validasi bentuk URL (tanpa jaringan). Melempar KnowledgeError jika tidak boleh. */
export function assertAllowedUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new KnowledgeError("Alamat web tidak valid.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new KnowledgeError("Hanya alamat http:// atau https:// yang didukung.");
  if (u.username || u.password) throw new KnowledgeError("Alamat dengan username/password tidak didukung.");
  if (u.port && !["80", "443"].includes(u.port)) throw new KnowledgeError("Hanya port standar (80/443) yang didukung.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    throw new KnowledgeError("Alamat lokal atau jaringan internal tidak diizinkan.");
  if (net.isIP(host) && isBlockedIp(host)) throw new KnowledgeError("Alamat lokal atau jaringan internal tidak diizinkan.");
  return u;
}

const BLOCKED_MSG = "Alamat lokal atau jaringan internal tidak diizinkan.";

/** dns.lookup yang menolak IP terlarang. Dipakai langsung oleh socket, jadi IP yang dicek = IP yang dihubungi. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad || !list.length) return callback(Object.assign(new Error(BLOCKED_MSG), { code: "EBLOCKED" }), "", 4);
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export interface FetchedPage {
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

function requestOnce(u: URL, signal: AbortSignal): Promise<{ status: number; headers: http.IncomingHttpHeaders; res: http.IncomingMessage }> {
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      {
        method: "GET",
        lookup: safeLookup,
        signal,
        headers: {
          "user-agent": "BotCreatorKnowledge/1.0 (+https://bot-creator-three.vercel.app)",
          accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/pdf;q=0.9,*/*;q=0.1",
          "accept-encoding": "identity",
        },
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, res }),
    );
    req.on("error", reject);
    req.end();
  });
}

export async function fetchUrl(raw: string): Promise<FetchedPage> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), URL_TIMEOUT_MS);
  try {
    let u = assertAllowedUrl(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let r;
      try {
        r = await requestOnce(u, ac.signal);
      } catch (e) {
        if ((e as { code?: string }).code === "EBLOCKED") throw new KnowledgeError(BLOCKED_MSG, e);
        if (ac.signal.aborted) throw new KnowledgeError("Halaman terlalu lama merespons (lebih dari 15 detik).", e);
        throw new KnowledgeError("Halaman tidak bisa dihubungi. Periksa alamatnya.", e);
      }
      if (r.status >= 300 && r.status < 400 && r.headers.location) {
        r.res.resume();
        if (hop === MAX_REDIRECTS) throw new KnowledgeError("Terlalu banyak pengalihan (redirect).");
        u = assertAllowedUrl(new URL(r.headers.location, u).toString());
        continue;
      }
      if (r.status < 200 || r.status >= 300) {
        r.res.resume();
        throw new KnowledgeError(`Halaman membalas dengan status ${r.status}.`);
      }
      const len = Number(r.headers["content-length"] ?? 0);
      if (len > URL_MAX_BYTES) {
        r.res.destroy();
        throw new KnowledgeError("Halaman terlalu besar (maksimal 5 MB).");
      }
      const parts: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of r.res) {
          total += (chunk as Buffer).length;
          if (total > URL_MAX_BYTES) {
            r.res.destroy();
            throw new KnowledgeError("Halaman terlalu besar (maksimal 5 MB).");
          }
          parts.push(chunk as Buffer);
        }
      } catch (e) {
        if (e instanceof KnowledgeError) throw e;
        if (ac.signal.aborted) throw new KnowledgeError("Halaman terlalu lama merespons (lebih dari 15 detik).", e);
        throw new KnowledgeError("Koneksi ke halaman terputus.", e);
      }
      return { body: Buffer.concat(parts), contentType: String(r.headers["content-type"] ?? "").toLowerCase(), finalUrl: u.toString() };
    }
    throw new KnowledgeError("Terlalu banyak pengalihan (redirect).");
  } finally {
    clearTimeout(timer);
  }
}
