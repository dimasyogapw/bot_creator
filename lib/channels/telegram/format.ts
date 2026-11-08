/**
 * Mengubah markdown jawaban bot menjadi HTML Telegram dan memecah pesan panjang.
 * Telegram hanya mendukung sebagian kecil tag HTML (b, i, u, s, code, pre, a, blockquote)
 * dan membatasi satu pesan 4096 karakter.
 */

export const TELEGRAM_MAX_LENGTH = 4096;
/** Batas potongan SUMBER markdown; HTML hasil konversi bisa sedikit lebih panjang. */
const CHUNK_LIMIT = 3400;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Hanya tautan http, https, dan mailto yang dijadikan link (cegah javascript: dan sejenisnya). */
function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}

const PH = "\u0000";

/** Ubah markdown ke HTML Telegram. Teks di luar tag selalu di-escape. */
export function markdownToTelegramHtml(md: string): string {
  const stash: string[] = [];
  const hold = (html: string) => {
    stash.push(html);
    return `${PH}${stash.length - 1}${PH}`;
  };

  let text = md.replace(/\r\n/g, "\n");

  // 1. Blok kode berpagar ```lang ... ```
  text = text.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_m, code: string) => hold(`<pre>${esc(code.replace(/\n$/, ""))}</pre>`));
  // 2. Kode inline
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => hold(`<code>${esc(code)}</code>`));

  // 3. Tabel markdown: dibiarkan apa adanya di blok monospace supaya kolom tetap terbaca
  text = text.replace(/((?:^\|.*\|[ \t]*\n?)+)/gm, (block: string) => (/^\|[ \t:|-]+\|[ \t]*$/m.test(block) ? hold(`<pre>${esc(block.replace(/\n$/, ""))}</pre>`) : block));

  // 4. Escape sisanya
  text = esc(text);

  // 5. Tautan [teks](url)
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, "&"));
    return href ? `<a href="${esc(href).replace(/"/g, "&quot;")}">${label}</a>` : m;
  });
  // 6. Tebal dan miring
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>").replace(/__([^_\n]+?)__/g, "<b>$1</b>");
  text = text.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,!?:;]|$)/gm, "$1<i>$2</i>").replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,!?:;]|$)/gm, "$1<i>$2</i>");
  text = text.replace(/~~([^~\n]+?)~~/g, "<s>$1</s>");
  // 7. Judul jadi teks tebal
  text = text.replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, "<b>$1</b>");
  // 8. Daftar bullet
  text = text.replace(/^([ \t]*)[-*+][ \t]+/gm, "$1• ");
  // 9. Kutipan
  text = text.replace(/((?:^&gt;[ \t]?.*(?:\n|$))+)/gm, (block: string) => `<blockquote>${block.replace(/^&gt;[ \t]?/gm, "").replace(/\n$/, "")}</blockquote>\n`);
  // 10. Garis pemisah
  text = text.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "──────────");

  return text.replace(new RegExp(`${PH}(\\d+)${PH}`, "g"), (_m, i: string) => stash[Number(i)]).trim();
}

/** Teks biasa tanpa tag (cadangan jika Telegram menolak HTML). */
export function stripToPlain(md: string): string {
  return md
    .replace(/```[^\n`]*\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/^#{1,6}[ \t]+/gm, "")
    .trim();
}

/**
 * Pecah markdown menjadi potongan di batas paragraf (lalu baris, lalu kata). Blok kode yang kepanjangan
 * dipecah per baris dan setiap bagian diberi pagar sendiri sehingga tetap tampil sebagai kode.
 */
export function splitMarkdown(md: string, limit = CHUNK_LIMIT): string[] {
  const text = md.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (text.length <= limit) return [text];

  // Pisahkan menjadi bagian: kode berpagar dan teks biasa.
  const parts: { code: boolean; body: string }[] = [];
  const re = /```[^\n`]*\n?([\s\S]*?)```/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ code: false, body: text.slice(last, m.index) });
    parts.push({ code: true, body: m[1].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ code: false, body: text.slice(last) });

  const pieces: string[] = [];
  for (const p of parts) {
    if (p.code) {
      for (const seg of packLines(p.body.split("\n"), limit - 8)) pieces.push("```\n" + seg + "\n```");
    } else {
      for (const para of p.body.split(/\n{2,}/)) {
        const t = para.trim();
        if (!t) continue;
        if (t.length <= limit) pieces.push(t);
        else for (const seg of packLines(t.split("\n"), limit)) pieces.push(seg);
      }
    }
  }

  // Gabungkan potongan kecil berurutan selama muat.
  const chunks: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (!cur) cur = piece;
    else if (cur.length + 2 + piece.length <= limit) cur += "\n\n" + piece;
    else {
      chunks.push(cur);
      cur = piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Kemas baris-baris menjadi segmen <= limit; baris yang terlalu panjang dipecah di spasi, lalu paksa. */
function packLines(lines: string[], limit: number): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const raw of lines) {
    let line = raw;
    while (line.length > limit) {
      let cut = line.lastIndexOf(" ", limit);
      if (cut < limit * 0.5) cut = limit;
      push();
      out.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    if (!cur) cur = line;
    else if (cur.length + 1 + line.length <= limit) cur += "\n" + line;
    else {
      push();
      cur = line;
    }
  }
  push();
  return out;
}

export interface OutMessage {
  html: string;
  plain: string;
}

/** Jawaban bot -> daftar pesan siap kirim (HTML + cadangan teks biasa), masing-masing <= 4096 karakter. */
export function toTelegramMessages(markdown: string, sources: { title: string; pages?: number[] }[] = []): OutMessage[] {
  const body = sources.length
    ? `${markdown.trim()}\n\n${[...new Set(sources.map((s) => `${s.title}${s.pages?.length ? `, hal. ${s.pages.join(", ")}` : ""}`))].map((s) => `Sumber: ${s}`).join("\n")}`
    : markdown;
  const out: OutMessage[] = [];
  for (const chunk of splitMarkdown(body)) {
    const html = markdownToTelegramHtml(chunk);
    const plain = stripToPlain(chunk);
    if (html.length <= TELEGRAM_MAX_LENGTH) out.push({ html, plain: plain.slice(0, TELEGRAM_MAX_LENGTH) });
    else
      // Konversi memanjang melewati batas (jarang): kirim sebagai teks biasa terpotong rapi.
      for (const seg of packLines(plain.split("\n"), TELEGRAM_MAX_LENGTH - 100)) out.push({ html: esc(seg), plain: seg });
  }
  return out;
}
