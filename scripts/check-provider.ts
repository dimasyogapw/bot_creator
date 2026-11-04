/**
 * npm run check:provider
 * Mengetes 6 kebutuhan provider LLM (docs/ARCHITECTURE.md).
 * Tidak pernah mencetak API key.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { chat, chatStream, embed, getLlmConfig, listModels, type ChatMessage, type ChatTool } from "../lib/llm/provider";

type Row = { no: number; kebutuhan: string; hasil: "LULUS" | "GAGAL" | "LEWATI"; detail: string };
const rows: Row[] = [];
const usages: Record<string, unknown> = {};

async function step(no: number, kebutuhan: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    rows.push({ no, kebutuhan, hasil: "LULUS", detail: `${detail} (${Date.now() - t0} ms)` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    rows.push({ no, kebutuhan, hasil: "GAGAL", detail: msg.slice(0, 200) });
  }
}

async function main() {
  const cfg = getLlmConfig();
  const model = cfg.LLM_DEFAULT_MODEL;
  console.log(`Provider: ${cfg.LLM_BASE_URL}`);
  console.log(`Model utama: ${model} | Model ringan: ${cfg.LLM_LIGHT_MODEL}\n`);

  let models: string[] = [];
  await step(1, "Daftar model (/models)", async () => {
    models = await listModels();
    if (!models.length) throw new Error("daftar model kosong");
    for (const m of [model, cfg.LLM_LIGHT_MODEL]) if (!models.includes(m)) throw new Error(`model ${m} tidak ada di daftar`);
    return `${models.length} model, Sonnet & Haiku tersedia`;
  });

  await step(2, "Chat biasa", async () => {
    const r = await chat({ model, messages: [{ role: "user", content: "Jawab satu kata saja: ibu kota Indonesia?" }], maxTokens: 300 });
    usages.chat = r.usage;
    const text = r.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("jawaban kosong");
    return `jawaban: "${text}"`;
  });

  await step(3, "Streaming", async () => {
    const t0 = Date.now();
    let first = 0;
    let chunks = 0;
    const stream = await chatStream({ model, messages: [{ role: "user", content: "Hitung 1 sampai 10, pisahkan dengan koma." }], maxTokens: 300 });
    for await (const c of stream) {
      const d = c.choices[0]?.delta?.content;
      if (d) {
        if (!first) first = Date.now() - t0;
        chunks++;

      }
      if (c.usage) usages.stream = c.usage;
    }
    if (chunks < 2) throw new Error(`hanya ${chunks} potongan, tidak benar-benar streaming`);
    return `${chunks} potongan, token pertama ${first} ms, usage di stream: ${usages.stream ? "ya" : "tidak"}`;
  });

  await step(4, "Tool calling (+ kirim hasil tool)", async () => {
    const tools: ChatTool[] = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Ambil cuaca terkini untuk sebuah kota.",
          parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      },
    ];
    const messages: ChatMessage[] = [{ role: "user", content: "Bagaimana cuaca di Bandung sekarang? Pakai tool." }];
    const r1 = await chat({ model, messages, tools, maxTokens: 200 });
    const call = r1.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.type !== "function") throw new Error("model tidak memanggil tool");
    const args = JSON.parse(call.function.arguments || "{}");
    messages.push(r1.choices[0].message);
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ city: args.city, suhu_c: 23, kondisi: "hujan ringan" }) });
    const r2 = await chat({ model, messages, tools, maxTokens: 200 });
    const final = r2.choices[0]?.message?.content ?? "";
    if (!/23|hujan/i.test(final)) throw new Error(`jawaban akhir tidak memakai hasil tool: "${final.slice(0, 80)}"`);
    return `tool ${call.function.name}(${JSON.stringify(args)}) lalu jawaban akhir memakai hasilnya`;
  });

  await step(5, "Embedding", async () => {
    const candidates = cfg.EMBEDDING_MODEL ? [cfg.EMBEDDING_MODEL] : models.filter((m) => /embed/i.test(m));
    if (!candidates.length) throw new Error("tidak ada model embedding di daftar");
    const results: string[] = [];
    for (const m of candidates) {
      try {
        const r = await embed(["Halo dunia", "Bot Creator"], m);
        results.push(`${m}: ${r.data[0].embedding.length} dimensi`);
      } catch (e) {
        results.push(`${m}: gagal (${(e instanceof Error ? e.message : String(e)).slice(0, 60)})`);
      }
    }
    if (!results.some((r) => r.includes("dimensi"))) throw new Error(results.join("; "));
    return results.join("; ");
  });

  await step(6, "Usage token dikembalikan", async () => {
    const u = usages.chat as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (!u?.prompt_tokens || !u?.completion_tokens) throw new Error("usage tidak ada di respons chat");
    return `chat: ${u.prompt_tokens} in / ${u.completion_tokens} out; stream: ${usages.stream ? "ada" : "TIDAK ada"}`;
  });

  await step(7, "Prompt caching (bonus)", async () => {
    const longSystem = "Kamu asisten toko. " + Array.from({ length: 400 }, (_, i) => `Aturan ${i}: jawab sopan, ringkas, dan akurat tentang produk nomor ${i}.`).join(" ");
    // cache_control adalah ekstensi Anthropic yang diteruskan provider; tidak ada di tipe OpenAI.
    const system = { role: "system", content: [{ type: "text", text: longSystem, cache_control: { type: "ephemeral" } }] } as unknown as ChatMessage;
    const run = () => chat({ model, messages: [system, { role: "user", content: "Halo" }], maxTokens: 100 });
    await run();
    const r = await run();
    const u = r.usage as unknown as { prompt_tokens: number; cache_read_input_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    const cached = u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
    if (!cached) throw new Error("tidak ada token yang dibaca dari cache");
    return `${cached} dari ${u.prompt_tokens} token prompt dibaca dari cache`;
  });

  console.table(rows.map((r) => ({ "#": r.no, Kebutuhan: r.kebutuhan, Hasil: r.hasil, Detail: r.detail })));
  console.log("\nContoh usage (chat):", JSON.stringify(usages.chat, null, 2));
  console.log("Contoh usage (stream):", JSON.stringify(usages.stream, null, 2));

  const failed = rows.filter((r) => r.hasil === "GAGAL");
  if (failed.some((r) => r.no === 3 || r.no === 4)) console.log("\nPERHATIAN: streaming atau tool calling gagal. Berhenti dan laporkan ke owner.");
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("Gagal menjalankan tes:", e instanceof Error ? e.message : e);
  process.exit(1);
});
