import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { frameAncestors, publicChatSchema, publishSettingsSchema, widgetDomainSchema } from "@/lib/publish/schema";
import { clientIp, toPublicEvent, toPublicMessage } from "@/lib/publish/public";

describe("pengaturan publikasi", () => {
  it("domain widget: host, wildcard, port; tolak skema/path", () => {
    expect(widgetDomainSchema.safeParse("tokoku.com").success).toBe(true);
    expect(widgetDomainSchema.safeParse("*.tokoku.com").success).toBe(true);
    expect(widgetDomainSchema.safeParse("localhost:3199").success).toBe(true);
    expect(widgetDomainSchema.safeParse("http://localhost:3199").success).toBe(true);
    expect(widgetDomainSchema.safeParse("https://tokoku.com/").success).toBe(true);
    expect(widgetDomainSchema.safeParse("ftp://tokoku.com").success).toBe(false);
    expect(widgetDomainSchema.safeParse("tokoku.com/path").success).toBe(false);
    expect(widgetDomainSchema.safeParse("'none' evil.com").success).toBe(false);
  });

  it("frame-ancestors: selalu 'self', domain tidak valid dibuang (cegah injeksi header)", () => {
    expect(frameAncestors([])).toBe("'self'");
    expect(frameAncestors(["tokoku.com", "*.tokoku.com", "x; script-src *"])).toBe("'self' tokoku.com *.tokoku.com");
  });

  it("batas wajib masuk akal", () => {
    const base = { is_public: true, daily_cost_limit_usd: 1, daily_message_limit: 300, per_minute_limit: 20, limit_message: "Ramai", widget: {}, allowed_domains: [] };
    expect(publishSettingsSchema.safeParse(base).success).toBe(true);
    expect(publishSettingsSchema.safeParse({ ...base, per_minute_limit: 0 }).success).toBe(false);
    expect(publishSettingsSchema.safeParse({ ...base, daily_cost_limit_usd: -1 }).success).toBe(false);
    expect(publishSettingsSchema.safeParse({ ...base, widget: { color: "red" } }).success).toBe(false);
  });

  it("body chat publik: ID pengunjung wajib dan dibatasi, gambar tidak diterima", () => {
    expect(publicChatSchema.safeParse({ visitorId: "a".repeat(32), channel: "web", message: "halo" }).success).toBe(true);
    expect(publicChatSchema.safeParse({ visitorId: "pendek", channel: "web", message: "halo" }).success).toBe(false);
    expect(publicChatSchema.safeParse({ visitorId: "a".repeat(32), channel: "playground", message: "halo" }).success).toBe(false);
    const r = publicChatSchema.parse({ visitorId: "a".repeat(32), channel: "web", message: "halo", images: [{ path: "x" }] });
    expect("images" in r).toBe(false);
    expect(publicChatSchema.safeParse({ visitorId: "a".repeat(32), channel: "web", message: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("data untuk pengunjung", () => {
  const msg = {
    id: "m1",
    role: "assistant",
    content: {
      text: "Halo [1]",
      citations: [{ n: 1, source_id: "s-rahasia", chunk_id: "c-rahasia", title: "Katalog", snippet: "isi", pages: [2] }],
      tools: [{ name: "api_internal", type: "http_webhook", label: "Memanggil Cek ongkir", detail: "argumen", ok: true, ms: 1, summary: "status 200" }],
      searches: ["kueri"],
    },
    model: "claude-haiku-5-5",
    tokens_in: 100,
    cost_usd: 0.01,
    status: "complete",
    feedback: 0,
  } as never;

  it("event done hanya berisi teks, sitasi tanpa id internal, status", () => {
    const out = JSON.stringify(toPublicEvent({ type: "done", message: msg }));
    for (const leak of ["claude", "cost", "tokens", "api_internal", "s-rahasia", "c-rahasia", "kueri", "argumen"]) expect(out).not.toContain(leak);
    expect(out).toContain("Katalog");
    expect(out).toContain("Halo [1]");
  });

  it("event skill hanya label, tanpa nama fungsi atau argumen", () => {
    expect(toPublicEvent({ type: "tool", name: "api_internal_secret", label: "Memanggil Cek ongkir", detail: "kota=Bogor" })).toEqual({ type: "tool", name: "skill", label: "Memanggil Cek ongkir" });
  });

  it("riwayat pengunjung tanpa data teknis", () => {
    const out = JSON.stringify(toPublicMessage(msg));
    expect(out).not.toMatch(/claude|cost|api_internal|s-rahasia/);
  });

  it("IP dari header proxy", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
