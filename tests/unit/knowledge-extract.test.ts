import { describe, expect, it } from "vitest";
import { extractHtml, extractPlain } from "@/lib/knowledge/extract";

describe("ekstraksi", () => {
  it("HTML: ambil isi utama, buang script dan menu", async () => {
    const html = `<!doctype html><html><head><title>Toko Kopi</title><script>alert(1)</script></head>
      <body><nav>Menu Beranda Kontak</nav><article><h1>Jam buka</h1>
      <p>${"Toko kopi kami buka setiap hari mulai pukul 08.00 sampai 21.00 WIB. ".repeat(6)}</p>
      <p>Hari libur nasional tutup lebih awal.</p></article><footer>Hak cipta</footer></body></html>`;
    const out = await extractHtml(html, "https://contoh.com");
    const text = out.segments.map((s) => s.text).join("\n");
    expect(out.title).toBe("Toko Kopi");
    expect(text).toContain("pukul 08.00");
    expect(text).toContain("Hari libur nasional");
    expect(text).not.toContain("alert(1)");
  });

  it("teks kosong ditolak dengan pesan jelas", () => {
    expect(() => extractPlain(new TextEncoder().encode("   "))).toThrow(/kosong/);
  });
});
