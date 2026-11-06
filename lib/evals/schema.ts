import { z } from "zod";

/** Batas jumlah test case per bot (menjaga biaya satu run tetap wajar). */
export const MAX_EVAL_CASES = 50;
export const MAX_IMPORT_LINES = 200;
export const MAX_SETUP_STEPS = 5;

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(30)
  .regex(/^[a-z0-9_\- ]+$/, "Tag hanya boleh huruf, angka, spasi, _ dan -");

export const evalCaseInputSchema = z.object({
  input: z.string().trim().min(1, "Pertanyaan wajib diisi").max(4000, "Pertanyaan maksimal 4000 karakter"),
  expected_behavior: z.string().trim().min(1, "Perilaku yang diharapkan wajib diisi").max(2000, "Maksimal 2000 karakter"),
  tags: z
    .array(tagSchema)
    .max(10)
    .default([])
    .transform((t) => [...new Set(t)]),
  /** Pesan pendahuluan (urut) yang dikirim dulu, mis. "Nama saya Budi". */
  setup: z.array(z.string().trim().min(1).max(4000)).max(MAX_SETUP_STEPS, `Maksimal ${MAX_SETUP_STEPS} pesan pendahuluan`).default([]),
  /** Pertanyaan utama dikirim di percakapan baru (untuk tes memory antar percakapan). */
  new_conversation: z.boolean().default(false),
});

export type EvalCaseInput = z.infer<typeof evalCaseInputSchema>;
export type EvalCaseInputRaw = z.input<typeof evalCaseInputSchema>;

export interface ImportError {
  line: number;
  message: string;
}

/** Baca teks JSONL (satu objek per baris). Baris kosong dan baris berawalan # dilewati. */
export function parseJsonl(text: string): { cases: EvalCaseInput[]; errors: ImportError[] } {
  const cases: EvalCaseInput[] = [];
  const errors: ImportError[] = [];
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_IMPORT_LINES * 2) return { cases, errors: [{ line: 0, message: `File terlalu panjang (maksimal ${MAX_IMPORT_LINES} baris).` }] };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (cases.length >= MAX_IMPORT_LINES) {
      if (errors.length === 0 || errors[errors.length - 1].message.indexOf("terlalu banyak") < 0) errors.push({ line: i + 1, message: `Terlalu banyak baris (maksimal ${MAX_IMPORT_LINES}).` });
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      errors.push({ line: i + 1, message: "Bukan JSON yang valid." });
      return;
    }
    const parsed = evalCaseInputSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ line: i + 1, message: `${issue.path.join(".") || "baris"}: ${issue.message}` });
      return;
    }
    cases.push(parsed.data);
  });
  return { cases, errors };
}

/** Ubah satu test case jadi satu baris JSONL (untuk ekspor). */
export function toJsonlLine(c: EvalCaseInput): string {
  return JSON.stringify({
    input: c.input,
    expected_behavior: c.expected_behavior,
    tags: c.tags,
    ...(c.setup.length ? { setup: c.setup } : {}),
    ...(c.new_conversation ? { new_conversation: true } : {}),
  });
}
