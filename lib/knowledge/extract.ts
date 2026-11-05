import "server-only";
import type { Segment } from "./chunk";
import { FILE_TYPES } from "./schema";

/** Kesalahan dengan pesan yang aman ditampilkan ke owner. */
export class KnowledgeError extends Error {
  constructor(public userMessage: string, cause?: unknown) {
    super(userMessage, { cause });
  }
}

export interface Extracted {
  segments: Segment[];
  /** Judul yang ditemukan di dokumen (mis. judul halaman web). */
  title?: string;
  pages?: number;
}

const MIN_CHARS = 20;

function ensureText(segments: Segment[], emptyMessage: string): Segment[] {
  const total = segments.reduce((n, s) => n + s.text.replace(/\s+/g, "").length, 0);
  if (total < MIN_CHARS) throw new KnowledgeError(emptyMessage);
  return segments;
}

export function joinPdfLines(t: string): string {
  return t.replace(/\r\n?/g, "\n").replace(/([^.!?:;\n])[ \t]*\n(?!\s*\n)[ \t]*(?=\S)/g, "$1 ");
}

export async function extractPdf(data: Uint8Array): Promise<Extracted> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(data);
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") throw new KnowledgeError("PDF dikunci password. Buka kuncinya lalu upload ulang.", e);
    throw new KnowledgeError("File PDF rusak atau tidak bisa dibaca.", e);
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  // PDF memotong teks per baris visual: gabungkan baris dalam satu paragraf, kecuali setelah tanda akhir kalimat.
  const segments = (text as string[]).map((t, i) => ({ text: joinPdfLines(t), page: i + 1 }));
  return {
    segments: ensureText(segments, "PDF ini tidak berisi teks (kemungkinan hasil scan atau gambar). PDF hasil scan belum didukung."),
    pages: totalPages,
  };
}

export async function extractDocx(data: Buffer): Promise<Extracted> {
  const mammoth = await import("mammoth");
  let value: string;
  try {
    ({ value } = await mammoth.extractRawText({ buffer: data }));
  } catch (e) {
    throw new KnowledgeError("File DOCX rusak atau tidak bisa dibaca.", e);
  }
  return { segments: ensureText([{ text: value }], "Dokumen DOCX ini tidak berisi teks.") };
}

export function extractPlain(data: Uint8Array): Extracted {
  const text = new TextDecoder("utf-8").decode(data);
  return { segments: ensureText([{ text }], "File teks ini kosong.") };
}

const BLOCK_TAGS = "p,div,section,article,header,footer,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre,table,ul,ol,dd,dt,figcaption";

/** Ambil isi utama halaman web (Readability), dengan batas paragraf dipertahankan. */
export async function extractHtml(html: string, url: string): Promise<Extracted> {
  const [{ parseHTML }, { Readability }] = await Promise.all([import("linkedom"), import("@mozilla/readability")]);
  const { document } = parseHTML(html);
  const pageTitle = document.querySelector("title")?.textContent?.trim() || undefined;

  let articleHtml: string | null = null;
  let title = pageTitle;
  try {
    // Readability butuh baseURI untuk link relatif; tidak dipakai di sini.
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    if (article?.content) articleHtml = article.content;
    if (article?.title) title = article.title.trim() || title;
  } catch {
    // jatuh ke body apa adanya
  }

  const { document: doc } = parseHTML(`<!doctype html><html><body>${articleHtml ?? document.body?.innerHTML ?? ""}</body></html>`);
  doc.querySelectorAll("script,style,noscript,svg,iframe,nav,form").forEach((el: Element) => el.remove());
  doc.querySelectorAll("br").forEach((el: Element) => el.replaceWith(doc.createTextNode("\n")));
  doc.querySelectorAll(BLOCK_TAGS).forEach((el: Element) => el.append(doc.createTextNode("\n\n")));
  const text = doc.body?.textContent ?? "";
  void url;
  return { segments: ensureText([{ text }], "Halaman ini tidak berisi teks yang bisa dibaca."), title };
}

export async function extractByMime(data: Buffer, mime: string): Promise<Extracted> {
  switch (mime) {
    case FILE_TYPES.pdf:
      return extractPdf(new Uint8Array(data));
    case FILE_TYPES.docx:
      return extractDocx(data);
    case FILE_TYPES.txt:
    case FILE_TYPES.md:
      return extractPlain(new Uint8Array(data));
    default:
      throw new KnowledgeError("Jenis file tidak didukung.");
  }
}
