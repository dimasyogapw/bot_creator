import { describe, expect, it } from "vitest";
import { markdownToTelegramHtml, splitMarkdown, stripToPlain, toTelegramMessages, TELEGRAM_MAX_LENGTH } from "@/lib/channels/telegram/format";
import { isValidToken, redactToken, apiBase } from "@/lib/channels/telegram/api";
import { parseCommand, parseUpdate, safeEqual } from "@/lib/channels/telegram/parse";

const TOKEN = "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345";

describe("markdown ke HTML Telegram", () => {
  it("tebal, miring, kode inline, dan judul", () => {
    expect(markdownToTelegramHtml("**Halo** dunia, *apa kabar* dan `kode`")).toBe("<b>Halo</b> dunia, <i>apa kabar</i> dan <code>kode</code>");
    expect(markdownToTelegramHtml("## Judul\nisi")).toBe("<b>Judul</b>\nisi");
  });

  it("karakter HTML di teks di-escape, tag buatan pengguna tidak lolos", () => {
    expect(markdownToTelegramHtml("a < b & c > d <script>alert(1)</script>")).toBe("a &lt; b &amp; c &gt; d &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("blok kode dijaga: isi tidak diformat ulang dan di-escape", () => {
    const html = markdownToTelegramHtml("```js\nconst a = **b** < 3;\n```");
    expect(html).toBe("<pre>const a = **b** &lt; 3;</pre>");
  });

  it("daftar bullet menjadi titik, daftar bernomor tetap, bintang tunggal di daftar bukan miring", () => {
    expect(markdownToTelegramHtml("- satu\n* dua\n1. tiga")).toBe("• satu\n• dua\n1. tiga");
  });

  it("tautan http/https jadi link; skema berbahaya tidak dijadikan link", () => {
    expect(markdownToTelegramHtml("[situs](https://contoh.com/a?x=1&y=2)")).toBe('<a href="https://contoh.com/a?x=1&amp;y=2">situs</a>');
    expect(markdownToTelegramHtml("[klik](javascript:alert(1))")).not.toContain("<a ");
    expect(markdownToTelegramHtml('[x](https://a.com/"onmouseover=1)')).not.toContain('"onmouseover');
  });

  it("tabel markdown masuk blok monospace; kutipan jadi blockquote", () => {
    expect(markdownToTelegramHtml("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<pre>| a | b |");
    expect(markdownToTelegramHtml("> kutipan\n> dua")).toContain("<blockquote>kutipan\ndua</blockquote>");
  });

  it("garis bawah di dalam kata (snake_case) tidak jadi miring", () => {
    expect(markdownToTelegramHtml("pakai nama_variabel_ini ya")).toBe("pakai nama_variabel_ini ya");
  });

  it("cadangan teks biasa membuang penanda markdown", () => {
    expect(stripToPlain("**tebal** `kode` [situs](https://a.com)\n## Judul")).toBe("tebal kode situs (https://a.com)\nJudul");
  });
});

describe("pemecah pesan", () => {
  it("pesan pendek tetap satu", () => {
    expect(splitMarkdown("halo")).toEqual(["halo"]);
    expect(splitMarkdown("   ")).toEqual([]);
  });

  it("teks panjang dipecah di batas paragraf, tiap potongan di bawah batas", () => {
    const para = "kalimat ".repeat(100).trim();
    const text = Array.from({ length: 30 }, () => para).join("\n\n");
    const chunks = splitMarkdown(text, 3400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3400);
    expect(chunks.join("\n\n").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });

  it("satu baris raksasa tanpa spasi tetap dipecah paksa", () => {
    const chunks = splitMarkdown("x".repeat(10_000), 3400);
    expect(chunks.length).toBe(3);
    expect(chunks.join("")).toBe("x".repeat(10_000));
  });

  it("blok kode panjang dipecah per baris dan tiap bagian tetap berpagar", () => {
    const code = Array.from({ length: 400 }, (_, i) => `baris ke-${i} dari kode yang panjang`).join("\n");
    const chunks = splitMarkdown("Ini kodenya:\n\n```\n" + code + "\n```", 3400);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3400);
    const codeChunks = chunks.filter((c) => c.startsWith("```"));
    for (const c of codeChunks) expect(c.endsWith("```")).toBe(true);
    expect(codeChunks.map((c) => c.replace(/^```\n|\n```$/g, "")).join("\n")).toBe(code);
  });

  it("jawaban sangat panjang: semua pesan hasil akhir <= 4096 karakter dan HTML seimbang", () => {
    const md = Array.from({ length: 80 }, (_, i) => `## Bagian ${i}\n\n**Poin** penting nomor ${i} dengan \`kode\` dan [tautan](https://contoh.com/${i}).\n\n- a\n- b\n- c`).join("\n\n");
    const msgs = toTelegramMessages(md);
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) {
      expect(m.html.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH);
      expect(m.plain.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH);
      for (const tag of ["b", "i", "code", "pre", "a", "blockquote"]) {
        expect((m.html.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length).toBe((m.html.match(new RegExp(`</${tag}>`, "g")) ?? []).length);
      }
    }
  });

  it("sumber knowledge ditambahkan sebagai baris Sumber, tanpa duplikat", () => {
    const [m] = toTelegramMessages("Jawaban [1]", [{ title: "Panduan.pdf", pages: [13] }, { title: "Panduan.pdf", pages: [13] }, { title: "FAQ" }]);
    expect(m.plain).toContain("Sumber: Panduan.pdf, hal. 13");
    expect(m.plain).toContain("Sumber: FAQ");
    expect(m.plain.match(/Sumber: Panduan/g)).toHaveLength(1);
  });
});

describe("parser update dan perintah", () => {
  it("pesan teks pribadi diteruskan dengan nama tampilan", () => {
    const u = parseUpdate({ update_id: 5, message: { message_id: 1, chat: { id: 77, type: "private" }, from: { id: 77, first_name: "Budi", username: "budi" }, text: "  Halo  " } });
    expect(u).toEqual({ kind: "text", updateId: 5, chatId: 77, text: "Halo", displayName: "@budi" });
  });

  it("grup, bot lain, dan update tanpa pesan diabaikan; non-teks ditandai tidak didukung", () => {
    expect(parseUpdate({ update_id: 1, message: { message_id: 1, chat: { id: -5, type: "group" }, text: "hi" } })).toEqual({ kind: "ignore", updateId: 1 });
    expect(parseUpdate({ update_id: 2, message: { message_id: 1, chat: { id: 5, type: "private" }, from: { id: 5, is_bot: true }, text: "hi" } })).toEqual({ kind: "ignore", updateId: 2 });
    expect(parseUpdate({ update_id: 3, edited_message: {} })).toEqual({ kind: "ignore", updateId: 3 });
    expect(parseUpdate({ update_id: 4, message: { message_id: 1, chat: { id: 5, type: "private" }, photo: [{}] } })).toEqual({ kind: "unsupported", updateId: 4, chatId: 5 });
  });

  it("bentuk tidak valid ditolak (null) dan pesan panjang dipotong", () => {
    expect(parseUpdate("bukan objek")).toBeNull();
    expect(parseUpdate({ update_id: "x" })).toBeNull();
    const u = parseUpdate({ update_id: 9, message: { message_id: 1, chat: { id: 5, type: "private" }, text: "a".repeat(9000) } });
    expect(u && u.kind === "text" && u.text.length).toBe(4000);
  });

  it("perintah /start dan /baru, dengan dan tanpa @username, argumen diabaikan", () => {
    expect(parseCommand("/start")).toEqual({ name: "start" });
    expect(parseCommand("/start promo123")).toEqual({ name: "start" });
    expect(parseCommand("/baru@kopi_bot", "kopi_bot")).toEqual({ name: "baru" });
    expect(parseCommand("/baru@bot_lain", "kopi_bot")).toBeNull(); // perintah untuk bot lain
    expect(parseCommand("/BARU")).toEqual({ name: "baru" });
    expect(parseCommand("/lain")).toBeNull();
    expect(parseCommand("halo /start")).toBeNull();
  });
});

describe("rahasia dan token", () => {
  it("perbandingan rahasia benar/salah, panjang berbeda tidak error", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("validasi bentuk token", () => {
    expect(isValidToken(TOKEN)).toBe(true);
    expect(isValidToken("bukan-token")).toBe(false);
    expect(isValidToken(`${TOKEN} `)).toBe(false);
    expect(isValidToken("123:abc")).toBe(false);
  });

  it("token disensor dari teks galat, termasuk bentuk lain yang mirip token", () => {
    expect(redactToken(`gagal https://api.telegram.org/bot${TOKEN}/getMe`, TOKEN)).toBe("gagal https://api.telegram.org/bot[TOKEN]/getMe");
    expect(redactToken("token lain 987654321:BBH-zyxwvutsrqponmlkjihgfedcba98765 bocor")).toBe("token lain [TOKEN] bocor");
    expect(redactToken("tanpa token")).toBe("tanpa token");
  });

  it("alamat API: bawaan resmi; hanya di luar Vercel boleh diganti env", () => {
    const keep = { v: process.env.VERCEL, b: process.env.TELEGRAM_API_BASE };
    try {
      delete process.env.TELEGRAM_API_BASE;
      delete process.env.VERCEL;
      expect(apiBase()).toBe("https://api.telegram.org");
      process.env.TELEGRAM_API_BASE = "http://localhost:3197/";
      expect(apiBase()).toBe("http://localhost:3197");
      process.env.VERCEL = "1";
      expect(apiBase()).toBe("https://api.telegram.org"); // di Vercel env diabaikan
    } finally {
      if (keep.v === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = keep.v;
      if (keep.b === undefined) delete process.env.TELEGRAM_API_BASE;
      else process.env.TELEGRAM_API_BASE = keep.b;
    }
  });
});
