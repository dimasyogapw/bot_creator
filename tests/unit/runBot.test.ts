import { beforeEach, describe, expect, it, vi } from "vitest";

// Provider LLM dipalsukan: unit test tidak memanggil API sungguhan.
const chatStream = vi.fn();
vi.mock("@/lib/llm/provider", () => ({ chatStream: (...a: unknown[]) => chatStream(...a) }));
// Knowledge dipalsukan: default bot tanpa knowledge.
const hasReadyKnowledge = vi.fn();
const searchKnowledge = vi.fn();
vi.mock("@/lib/knowledge/search", () => ({
  hasReadyKnowledge: (...a: unknown[]) => hasReadyKnowledge(...a),
  searchKnowledge: (...a: unknown[]) => searchKnowledge(...a),
}));

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
    hasReadyKnowledge.mockReset().mockResolvedValue(false);
    searchKnowledge.mockReset();
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

  it("tanpa knowledge: tidak mengirim tool", async () => {
    chatStream.mockResolvedValue(fakeStream(["ok"]));
    await collect(runBot({ db: fakeDb(state) as never, botId: "b1", userMessage: "hai", channel: "playground" }));
    expect(chatStream.mock.calls[0][0].tools).toBeUndefined();
  });

  it("dengan knowledge: memanggil search_knowledge, lalu menjawab dengan sitasi yang tersimpan", async () => {
    hasReadyKnowledge.mockResolvedValue(true);
    searchKnowledge.mockResolvedValue([
      { id: "k1", source_id: "s1", source_title: "Katalog", chunk_index: 0, content: "Harga paket A Rp100.000", metadata: { pages: [2] }, score: 0.03 },
      { id: "k2", source_id: "s1", source_title: "Katalog", chunk_index: 1, content: "Paket B Rp200.000", metadata: {}, score: 0.02 },
    ]);
    chatStream
      .mockResolvedValueOnce(toolCallStream("call_1", '{"query":"harga paket A"}', { prompt_tokens: 100, completion_tokens: 10, cost: 0.001 }))
      .mockResolvedValueOnce(fakeStream(["Harga paket A Rp100.000 [1]."], { prompt_tokens: 300, completion_tokens: 20, cost: 0.002 }));

    const events = await collect(runBot({ db: fakeDb(state) as never, botId: "b1", userMessage: "berapa harga paket A?", channel: "playground" }));
    expect(events.map((e) => e.type)).toEqual(["start", "tool", "citations", "delta", "done"]);
    expect(events[1]).toEqual({ type: "tool", name: "search_knowledge", query: "harga paket A" });

    const first = chatStream.mock.calls[0][0];
    expect(first.tools[0].function.name).toBe("search_knowledge");
    expect(JSON.stringify(first.messages[0])).toContain("search_knowledge");
    const second = chatStream.mock.calls[1][0];
    const toolMsg = second.messages.at(-1);
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_call_id).toBe("call_1");
    expect(toolMsg.content).toContain('<document index="1" source="Katalog" page="hal. 2">');
    expect(second.messages.at(-2).tool_calls[0].function.name).toBe("search_knowledge");

    const saved = state.messages.find((m) => m.role === "assistant")!;
    const content = saved.content as { text: string; citations: { n: number }[]; searches: string[] };
    expect(content.citations.map((c) => c.n)).toEqual([1]); // [2] tidak disebut, tidak disimpan
    expect(content.searches).toEqual(["harga paket A"]);
    expect(saved).toMatchObject({ tokens_in: 400, tokens_out: 30, cost_usd: 0.003 });
  });

  it("loop tool berhenti setelah 5 iterasi, iterasi terakhir memaksa jawaban", async () => {
    hasReadyKnowledge.mockResolvedValue(true);
    searchKnowledge.mockResolvedValue([]);
    chatStream.mockImplementation(async (opts: { toolChoice?: string }) =>
      opts.toolChoice === "none" ? fakeStream(["Maaf, saya tidak tahu."]) : toolCallStream("c", '{"query":"x"}'),
    );
    const events = await collect(runBot({ db: fakeDb(state) as never, botId: "b1", userMessage: "?", channel: "playground" }));
    expect(chatStream).toHaveBeenCalledTimes(6);
    expect(events.filter((e) => e.type === "tool")).toHaveLength(5);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("pencarian gagal: bot tetap menjawab, tidak crash", async () => {
    hasReadyKnowledge.mockResolvedValue(true);
    searchKnowledge.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    chatStream.mockResolvedValueOnce(toolCallStream("c1", '{"query":"x"}')).mockResolvedValueOnce(fakeStream(["Maaf, belum bisa dicari."]));
    const events = await collect(runBot({ db: fakeDb(state) as never, botId: "b1", userMessage: "?", channel: "playground" }));
    expect(events.at(-1)?.type).toBe("done");
    expect(chatStream.mock.calls[1][0].messages.at(-1).content).toContain("gagal");
    spy.mockRestore();
  });
});

async function* toolCallStream(id: string, args: string, usage?: object) {
  yield { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: "search_knowledge", arguments: "" } }] } }] };
  yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 5) } }] } }] };
  yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] }, finish_reason: "tool_calls" }] };
  yield { choices: [], usage };
}
