import { z } from "zod";

/** Batas dan jenis file knowledge. Dipakai server dan client. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
export const MAX_SOURCES_PER_BOT = 200;

export const FILE_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
} as const;
export type FileExt = keyof typeof FILE_TYPES;

export const ACCEPT_ATTR = ".pdf,.docx,.txt,.md,.markdown";

/** Jenis file ditentukan dari ekstensi (browser sering mengirim mime kosong untuk .md). */
export function fileExt(name: string): FileExt | null {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  const ext = m?.[1].toLowerCase();
  if (ext === "markdown") return "md";
  return ext && ext in FILE_TYPES ? (ext as FileExt) : null;
}

export function mimeFor(name: string): string | null {
  const ext = fileExt(name);
  return ext ? FILE_TYPES[ext] : null;
}

/** Nama file aman untuk path storage. */
export function safeFileName(name: string): string {
  const ext = fileExt(name) ?? "bin";
  const base = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${base || "dokumen"}.${ext}`;
}

export function fileValidationError(name: string, size: number): string | null {
  if (!fileExt(name)) return "Jenis file tidak didukung. Gunakan PDF, DOCX, TXT, atau MD.";
  if (size <= 0) return "File kosong.";
  if (size > MAX_FILE_BYTES) return "Ukuran file maksimal 20 MB.";
  return null;
}

export const createSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    name: z.string().trim().min(1).max(255),
    size: z.number().int().positive().max(MAX_FILE_BYTES),
  }),
  z.object({
    type: z.literal("url"),
    url: z
      .string()
      .trim()
      .max(2000)
      .url()
      .refine((u) => /^https?:\/\//i.test(u), "Alamat harus diawali http:// atau https://"),
  }),
  z.object({
    type: z.literal("text"),
    title: z.string().trim().min(1, "Judul wajib diisi").max(200),
    content: z.string().trim().min(1, "Isi wajib diisi").max(MAX_TEXT_CHARS, "Isi maksimal 200.000 karakter"),
  }),
]);
export type CreateSourceInput = z.infer<typeof createSourceSchema>;

export const searchArgsSchema = z.object({ query: z.string().trim().min(1).max(500) });
