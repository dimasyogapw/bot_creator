import { z } from "zod";

/** Daftar domain (tanpa skema/path), mis. "api.contoh.com" atau "*.contoh.com". */
export const domainListSchema = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$|^localhost$/, "Domain tidak valid (contoh: api.contoh.com)"),
  )
  .max(20);

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
