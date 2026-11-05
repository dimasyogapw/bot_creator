import { describe, expect, it } from "vitest";
import { CHUNK_CHARS, chunkSegments, normalizeText } from "@/lib/knowledge/chunk";

const para = (i: number, len = 500) => `Paragraf ${i}. ` + "kata ".repeat(Math.ceil(len / 5)).trim();

describe("chunkSegments", () => {
  it("teks pendek menjadi satu chunk", () => {
    const out = chunkSegments([{ text: "Halo dunia.\n\nIni paragraf kedua." }]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("Halo dunia.\n\nIni paragraf kedua.");
    expect(out[0].tokenCount).toBeGreaterThan(0);
  });

  it("teks panjang dipotong sekitar 600 token dengan overlap", () => {
    const text = Array.from({ length: 30 }, (_, i) => para(i)).join("\n\n");
    const out = chunkSegments([{ text }]);
    expect(out.length).toBeGreaterThan(4);
    for (const c of out) expect(c.content.length).toBeLessThanOrEqual(CHUNK_CHARS + 50);
    // overlap: ekor chunk n muncul lagi di awal chunk n+1
    const head = out[1].content.split("\n\n")[0];
    expect(head.length).toBeGreaterThan(100);
    expect(head.length).toBeLessThanOrEqual(400);
    expect(out[0].content.endsWith(head)).toBe(true);
  });

  it("paragraf raksasa tanpa titik tetap dipotong", () => {
    const out = chunkSegments([{ text: "x".repeat(10_000) }]);
    expect(out.length).toBeGreaterThanOrEqual(4);
    for (const c of out) expect(c.content.length).toBeLessThanOrEqual(CHUNK_CHARS + 50);
  });

  it("mencatat nomor halaman PDF", () => {
    const out = chunkSegments([
      { text: "Isi halaman satu.", page: 1 },
      { text: "Isi halaman dua.", page: 2 },
    ]);
    expect(out[0].pages).toEqual([1, 2]);
  });

  it("segmen kosong diabaikan", () => {
    expect(chunkSegments([{ text: "  \n\n " }])).toEqual([]);
  });
});

describe("normalizeText", () => {
  it("membuang karakter kontrol, NUL, dan spasi berlebih", () => {
    expect(normalizeText("﻿a\u0000b  \t c\r\n\n\n\nd")).toBe("ab c\n\nd");
  });
});
