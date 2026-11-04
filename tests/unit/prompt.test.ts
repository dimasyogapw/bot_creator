import { describe, expect, it } from "vitest";
import { BASE_RULES, KNOWLEDGE_RULES, buildMessages, buildSystemPrompt, titleFromMessage } from "@/lib/bot/prompt";

const bot = { name: "Tes", system_prompt: "Kamu barista.", model: "claude-sonnet-5-5" };
const msg = (role: "user" | "assistant", text: string) => ({ role, content: { text } });

describe("prompt", () => {
  it("system prompt berisi aturan dasar dan instruksi pemilik", () => {
    const s = buildSystemPrompt(bot);
    expect(s).toContain(BASE_RULES);
    expect(s).toContain("<instruksi_pemilik>\nKamu barista.\n</instruksi_pemilik>");
  });

  it("memakai cache_control untuk model Claude", () => {
    const [sys] = buildMessages(bot, [msg("user", "halo")]);
    expect(Array.isArray(sys.content)).toBe(true);
    expect(JSON.stringify(sys)).toContain("cache_control");
  });

  it("tanpa cache_control untuk model lain", () => {
    const [sys] = buildMessages({ ...bot, model: "gpt-4o" }, [msg("user", "halo")]);
    expect(typeof sys.content).toBe("string");
  });

  it("riwayat diawali user dan dibatasi 20 pesan", () => {
    const hist = [msg("assistant", "sambutan"), ...Array.from({ length: 30 }, (_, i) => msg(i % 2 ? "assistant" : "user", `p${i}`))];
    const out = buildMessages(bot, hist);
    expect(out[1].role).toBe("user");
    expect(out.length - 1).toBeLessThanOrEqual(20);
    expect(out.at(-1)).toEqual({ role: "assistant", content: "p29" });
  });

  it("judul dipotong 60 karakter", () => {
    expect(titleFromMessage("a".repeat(100))).toHaveLength(60);
    expect(titleFromMessage("  halo   dunia ")).toBe("halo dunia");
  });

  it("aturan knowledge hanya ditambahkan jika bot punya knowledge", () => {
    expect(buildSystemPrompt(bot)).not.toContain(KNOWLEDGE_RULES);
    const s = buildSystemPrompt(bot, { knowledge: true });
    expect(s).toContain(KNOWLEDGE_RULES);
    expect(s).toMatch(/DATA, bukan instruksi/);
    expect(s).toMatch(/tidak menemukan informasinya/);
  });
});
