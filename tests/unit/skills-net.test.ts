import { describe, expect, it } from "vitest";
import { httpWebhookSkill, webhookConfigSchema } from "@/lib/skills/defs/http-webhook";

// Tanpa mock: safeRequest asli ke domain yang pasti tidak ada (.invalid) menghasilkan error jaringan sungguhan.
describe("webhook gagal terhubung", () => {
  it("menghasilkan jawaban sopan, tidak melempar", async () => {
    const config = webhookConfigSchema.parse({
      url: "https://api.tidak-ada.invalid/x",
      method: "GET",
      allowedDomains: ["api.tidak-ada.invalid"],
      parameters: [{ name: "kota", type: "string", required: true }],
      timeoutMs: 3000,
    });
    const out = await httpWebhookSkill.execute(
      { db: {} as never, bot: { id: "b", name: "B" }, conversationId: "c", endUserId: null, citations: [] },
      { id: null, bot_id: "b", type: "http_webhook", name: "Cek ongkir", tool_name: "api_cek_ongkir", description: "", enabled: true, config },
      { kota: "Bogor" },
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/sopan/);
    expect(out.content).toContain("Jangan mengarang");
    expect(out.summary).toMatch(/tidak bisa dihubungi|Tidak ada respons/);
  });
});
