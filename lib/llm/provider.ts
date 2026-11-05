import "server-only";
import OpenAI from "openai";
import { z } from "zod";

/**
 * Satu-satunya pintu ke LLM dan embedding.
 * Provider OpenAI-compatible (default SumoPod, cadangan OpenRouter) dipilih lewat env.
 * Modul ini hanya boleh dipakai di server.
 */

const envSchema = z.object({
  LLM_BASE_URL: z.string().url().default("https://ai.sumopod.com/v1"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY belum diisi"),
  LLM_DEFAULT_MODEL: z.string().min(1, "LLM_DEFAULT_MODEL belum diisi"),
  LLM_LIGHT_MODEL: z.string().min(1, "LLM_LIGHT_MODEL belum diisi"),
  EMBEDDING_MODEL: z.string().optional().transform((v) => v || undefined),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
});

export type LlmConfig = z.infer<typeof envSchema>;

let cachedConfig: LlmConfig | undefined;
let cachedClient: OpenAI | undefined;

export function getLlmConfig(): LlmConfig {
  if (!cachedConfig) cachedConfig = envSchema.parse(process.env);
  return cachedConfig;
}

export function getLlmClient(): OpenAI {
  if (!cachedClient) {
    const cfg = getLlmConfig();
    cachedClient = new OpenAI({ baseURL: cfg.LLM_BASE_URL, apiKey: cfg.LLM_API_KEY, maxRetries: 2, timeout: 60_000 });
  }
  return cachedClient;
}

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatTool[];
  toolChoice?: "auto" | "none";
  /** Pencarian internet bawaan model (Claude/Gemini lewat SumoPod). Lihat lib/llm/capabilities.ts. */
  webSearch?: boolean;
  signal?: AbortSignal;
}

export async function listModels(): Promise<string[]> {
  const page = await getLlmClient().models.list();
  return page.data.map((m) => m.id).sort();
}

export async function chat(opts: ChatOptions) {
  return getLlmClient().chat.completions.create(
    {
      model: opts.model ?? getLlmConfig().LLM_DEFAULT_MODEL,
      messages: opts.messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      tools: opts.tools,
      ...(opts.webSearch ? { web_search_options: { search_context_size: "low" as const } } : {}),
    },
    { signal: opts.signal },
  );
}

export async function chatStream(opts: ChatOptions) {
  return getLlmClient().chat.completions.create(
    {
      model: opts.model ?? getLlmConfig().LLM_DEFAULT_MODEL,
      messages: opts.messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      tools: opts.tools,
      tool_choice: opts.tools ? opts.toolChoice : undefined,
      ...(opts.webSearch ? { web_search_options: { search_context_size: "low" as const } } : {}),
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal: opts.signal },
  );
}

export async function embed(input: string[], model?: string) {
  const cfg = getLlmConfig();
  const m = model ?? cfg.EMBEDDING_MODEL;
  if (!m) throw new Error("EMBEDDING_MODEL belum diisi");
  return getLlmClient().embeddings.create({
    model: m,
    input,
    ...(cfg.EMBEDDING_DIMENSIONS ? { dimensions: cfg.EMBEDDING_DIMENSIONS } : {}),
  });
}
