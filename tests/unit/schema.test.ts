import { describe, expect, it } from "vitest";
import { botInputSchema, personaAnswersSchema, slugify } from "@/lib/bots/schema";
import { parsePersonaJson } from "@/lib/bot/persona";

describe("botInputSchema", () => {
  const base = { name: "Tes", model: "claude-sonnet-5-5" };
  it("mengisi nilai default", () => {
    const r = botInputSchema.parse(base);
    expect(r).toMatchObject({ temperature: 0.7, max_tokens: 2048, avatar_url: null, welcome_message: null, system_prompt: "" });
  });
  it("menolak nama kosong", () => {
    expect(botInputSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
  });
  it("menolak max_tokens di bawah 1024 (model butuh ruang berpikir)", () => {
    expect(botInputSchema.safeParse({ ...base, max_tokens: 20 }).success).toBe(false);
  });
  it("menolak avatar bukan https", () => {
    expect(botInputSchema.safeParse({ ...base, avatar_url: "javascript:alert(1)" }).success).toBe(false);
    expect(botInputSchema.safeParse({ ...base, avatar_url: "https://x.com/a.png" }).success).toBe(true);
  });
  it("menolak temperature di luar 0..1", () => {
    expect(botInputSchema.safeParse({ ...base, temperature: 1.5 }).success).toBe(false);
  });
});

describe("slugify", () => {
  it("membuat slug aman", () => {
    expect(slugify("Bot Kopi Kenangan!")).toBe("bot-kopi-kenangan");
    expect(slugify("Café Ñ")).toBe("cafe-n");
    expect(slugify("!!!")).toBe("bot");
  });
});

describe("persona", () => {
  it("tujuan wajib diisi", () => {
    expect(personaAnswersSchema.safeParse({ purpose: "" }).success).toBe(false);
  });
  it("mengurai JSON walau dibungkus code fence", () => {
    const r = parsePersonaJson('```json\n{"system_prompt":"Kamu adalah asisten toko kopi yang ramah.","welcome_message":"Halo!"}\n```');
    expect(r.welcome_message).toBe("Halo!");
  });
  it("gagal jika bukan JSON", () => {
    expect(() => parsePersonaJson("maaf saya tidak bisa")).toThrow();
  });
});

import { isOwner } from "@/lib/auth/owner";
describe("isOwner", () => {
  it("hanya role owner di app_metadata", () => {
    expect(isOwner({ app_metadata: { role: "owner" } })).toBe(true);
    expect(isOwner({ app_metadata: {} })).toBe(false);
    expect(isOwner(null)).toBe(false);
  });
});
