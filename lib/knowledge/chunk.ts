/**
 * Pemotong teks menjadi chunk sekitar 600 token (estimasi 4 karakter per token)
 * dengan overlap sekitar 100 token. Batas paragraf dan kalimat dihormati sebisa mungkin.
 */

export interface Segment {
  text: string;
  /** Nomor halaman (PDF), mulai dari 1. */
  page?: number;
}

export interface Chunk {
  content: string;
  tokenCount: number;
  pages?: number[];
}

export const CHUNK_CHARS = 2400;
export const OVERLAP_CHARS = 400;

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

/** Rapikan teks hasil ekstraksi: buang karakter kontrol, spasi berlebih, baris kosong beruntun. */
export function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t\u00A0]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Unit {
  text: string;
  page?: number;
}

function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[.!?;:])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > max) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      // potong keras di spasi terdekat
      let rest = s;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut < max * 0.5) cut = max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      cur = rest;
      continue;
    }
    if (cur && cur.length + 1 + s.length > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkSegments(segments: Segment[], maxChars = CHUNK_CHARS, overlapChars = OVERLAP_CHARS): Chunk[] {
  const units: Unit[] = [];
  for (const seg of segments) {
    const clean = normalizeText(seg.text);
    if (!clean) continue;
    for (const para of clean.split(/\n\s*\n/)) {
      const p = para.trim();
      if (!p) continue;
      for (const piece of splitLong(p, maxChars)) units.push({ text: piece, page: seg.page });
    }
  }

  const chunks: Chunk[] = [];
  let cur: Unit[] = [];
  let curLen = 0;
  let fresh = 0; // jumlah unit baru (bukan overlap) di chunk saat ini

  const flush = () => {
    if (!fresh) return;
    const content = cur.map((u) => u.text).join("\n\n");
    const pages = [...new Set(cur.map((u) => u.page).filter((p): p is number => typeof p === "number"))].sort((a, b) => a - b);
    chunks.push({ content, tokenCount: estimateTokens(content), ...(pages.length ? { pages } : {}) });
    // overlap: bawa unit terakhir selama total <= overlapChars
    const carry: Unit[] = [];
    let len = 0;
    for (let i = cur.length - 1; i >= 0; i--) {
      if (len + cur[i].text.length > overlapChars) break;
      carry.unshift(cur[i]);
      len += cur[i].text.length + 2;
    }
    // Paragraf terakhir lebih panjang dari overlap: bawa ekornya saja (mulai dari batas kata).
    if (!carry.length && cur.length) {
      const last = cur[cur.length - 1];
      const from = last.text.length - overlapChars;
      const sp = last.text.indexOf(" ", from);
      const tail = last.text.slice(sp >= 0 ? sp + 1 : from).trim();
      if (tail) {
        carry.push({ text: tail, page: last.page });
        len = tail.length + 2;
      }
    }
    cur = carry;
    curLen = len;
    fresh = 0;
  };

  for (const u of units) {
    if (curLen + u.text.length > maxChars && fresh > 0) flush();
    // jika overlap + unit masih kebesaran, buang overlap
    while (cur.length && curLen + u.text.length > maxChars) {
      const dropped = cur.shift()!;
      curLen -= dropped.text.length + 2;
    }
    cur.push(u);
    curLen += u.text.length + 2;
    fresh++;
  }
  flush();
  return chunks;
}
