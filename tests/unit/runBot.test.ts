import { beforeEach, describe, expect, it, vi } from "vitest";

// Provider LLM dipalsukan: unit test tidak memanggil API sungguhan.
const chatStream = vi.fn();
vi.mock("@/lib/llm/provider", () => ({ chatStream: (...a: unknown[]) => chatStream(...a) }));

import { runBot, type BotEvent } from "@/lib/bot/runBot";

/** Supabase palsu minimal di memori. */
function fakeDb(state: { bots: Record<string, unknown>[]; conversations: Record<string, unknown>[]; messages: Record<string, unknown>[]; model_prices: Record<string, unknown>[] }) {
  let seq = 0;
  const now = () => new Date(Date.now() + seq++).toISOString();
  return {
    from(table: keyof typeof state) {
      const filters: [string, unknown][] = [];
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Record<string, unknown> | null = null;
      let order: { col: string; asc: boolean } | null = null;
      let limit = Infinity;
      const rows = () => state[table].filter((r) => filters.every(([k, v]) => r[k] === v));
      const exec = () => {
        if (op === "insert") {
          const row = { id: `${table}-${seq}`, created_at: now(), feedback: 0, status: "complete", ...payload };
          state[table].push(row);
          return [row];
        }
        if (op === "update") {
          rows().forEach((r) => Object.assign(r, payload));
          return [];
        }
        if (op === "delete") {
          const del = rows();
          state[table] = state[table].filter((r) => !del.includes(r));
          return [];
        }
        let out = rows();
        if (order) out = [...out].sort((a, b) => String(a[order!.col]).localeCompare(String(b[order!.col])) * (order!.asc ? 1 : -1));
        return out.slice(0, limit);
      };
      const q = {
        select: () => q,
        insert: (p: Record<string, unknown>) => ((op = "insert"), (payload = p), q),
        update: (p: Record<string, unknown>) => ((op = "update"), (payload = p), q),
        delete: () => ((op = "delete"), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        order: (col: string, o: { ascending: boolean }) => ((order = { col, asc: o.ascending }), q),
        limit: (n: number) => ((limit = n), q),
        maybeSingle: async () => ({ data: exec()[0] ?? null, error: null }),
        single: async () => ({ data: exec()[0] ?? null, error: null }),
        then: (res: (v: { data: unknown; error: null }) => void) => res({ data: exec(), error: null }),
      };
      return q;
    },
  };
}

async function collect(gen: AsyncGenerator<BotEvent>) {
  const out: BotEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

async function* fakeStream(parts: string[], usage?: object) {
  for (const p of parts) yield { choices: [{ delta: { content: p } }] };
  yield { choices: [], usage };
}

const bot = { id: "b1", name: "Tes", system_prompt: "", model: "claude-sonnet-5-5", temperature: 0.7, max_tokens: 2048 };

describe("runBot", () => {
  let state: Parameters<typeof fakeDb>[0];
  beforeEach(() => {
    chatStream.mockReset();
    state = { bots: [bot], conversations: [], messages: [], model_prices: [] };
  });

  it("membuat percakapan, men-stream jawaban, dan menyimpan token + biaya + latensi", async () => {
    chatStream.mockResolvedValue(fakeStream(["Halo", " dunia"], { prompt_tokens: 50, completion_tokens: 4, cost: 0.0002 }));
    const db = fakeDb(state);
    const events = await collect(runBot({ db: db as never, botId: "b1", userMessage: "hai", channel: "playground" }));

    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta", "done"]);
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]).toMatchObject({ title: "hai", channel: "playground" });
    const assistant = state.messages.find((m) => m.role === "assistant")!;
    expect(assistant).toMatchObject({ content: { text: "Halo dunia" }, tokens_in: 50, tokens_out: 4, cost_usd: 0.0002, status: "complete" });
    expect(typeof assistant.latency_ms).toBe("number");
  });

  it("regenerate menghapus jawaban terakhir lalu menjawab ulang", async () => {
    state.conversations.push({ id: "c1", bot_id: "b1" });
    state.messages.push(
      { id: "u1", conversation_id: "c1", role: "user", content: { text: "hai" }, created_at: "2026-01-01T00:00:00Z" },
      { id: "a1", conversation_id: "c1", role: "assistant", content: { text: "lama" }, created_at: "2026-01-01T00:00:01Z" },
    );
    chatStream.mockResolvedValue(fakeStream(["baru"]));
    await collect(runBot({ db: fakeDb(state) as never, botId: "b1", conversationId: "c1", regenerate: true, channel: "playground" }));
    const texts = state.messages.filter((m) => m.role === "assistant").map((m) => (m.content as { text: string }).text);
    expect(texts).toEqual(["baru"]);
  });

  it("error LLM menghasilkan pesan ramah, bukan crash", async () => {
    chatStream.mockRejectedValue(new Error("502 upstream"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await collect(runBot({ db: fakeDb(state) as never, botId: "b1", userMessage: "hai", channel: "playground" }));
    expect(events.at(-1)).toEqual({ type: "error", message: expect.stringContaining("Maaf") });
    expect(JSON.stringify(events)).not.toContain("502");
    spy.mockRestore();
  });

  it("bot tidak ditemukan", async () => {
    const events = await collect(runBot({ db: fakeDb(state) as never, botId: "x", userMessage: "hai", channel: "playground" }));
    expect(events).toEqual([{ type: "error", message: "Bot tidak ditemukan." }]);
  });

  it("percakapan bot lain ditolak", async () => {
    state.conversations.push({ id: "c9", bot_id: "lain" });
    const events = await collect(runBot({ db: fakeDb(state) as never, botId: "b1", conversationId: "c9", userMessage: "hai", channel: "playground" }));
    expect(events).toEqual([{ type: "error", message: "Percakapan tidak ditemukan." }]);
  });
});
