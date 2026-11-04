import { describe, expect, it } from "vitest";
import { createSourceSchema, fileExt, fileValidationError, mimeFor, safeFileName } from "@/lib/knowledge/schema";

describe("schema knowledge", () => {
  it("jenis file dari ekstensi", () => {
    expect(fileExt("Panduan.PDF")).toBe("pdf");
    expect(fileExt("catatan.markdown")).toBe("md");
    expect(fileExt("gambar.png")).toBeNull();
    expect(mimeFor("a.docx")).toContain("wordprocessingml");
  });

  it("validasi ukuran dan jenis", () => {
    expect(fileValidationError("a.pdf", 21 * 1024 * 1024)).toContain("20 MB");
    expect(fileValidationError("a.exe", 10)).toContain("tidak didukung");
    expect(fileValidationError("a.txt", 10)).toBeNull();
  });

  it("nama file aman untuk storage", () => {
    expect(safeFileName("../../Daftar Harga (2026).pdf")).toBe("Daftar-Harga-2026.pdf");
    expect(safeFileName("....md")).toBe("dokumen.md");
  });

  it("URL harus http/https, teks wajib judul dan isi", () => {
    expect(createSourceSchema.safeParse({ type: "url", url: "javascript:alert(1)" }).success).toBe(false);
    expect(createSourceSchema.safeParse({ type: "url", url: "https://contoh.com" }).success).toBe(true);
    expect(createSourceSchema.safeParse({ type: "text", title: "", content: "x" }).success).toBe(false);
    expect(createSourceSchema.safeParse({ type: "file", name: "a.pdf", size: 25 * 1024 * 1024 }).success).toBe(false);
  });
});
