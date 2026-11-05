export type Channel = "playground" | "web" | "widget" | "telegram" | "whatsapp";

export interface Bot {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  system_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
  welcome_message: string | null;
  is_public: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  bot_id: string;
  end_user_id: string | null;
  channel: Channel;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  /** Nomor sitasi di jawaban, mis. [1]. */
  n: number;
  source_id: string;
  chunk_id: string;
  title: string;
  /** Kutipan isi chunk yang dipakai. */
  snippet: string;
  pages?: number[];
}

export interface MessageContent {
  text: string;
  ttft_ms?: number;
  citations?: Citation[];
  /** Kueri pencarian knowledge yang dijalankan bot untuk jawaban ini. */
  searches?: string[];
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: MessageContent;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cached: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  feedback: -1 | 0 | 1;
  status: "complete" | "stopped" | "error";
  created_at: string;
}

export interface ModelPrice {
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number | null;
  cache_write_per_mtok: number | null;
}

export type KnowledgeType = "file" | "url" | "text";
export type KnowledgeStatus = "uploading" | "pending" | "processing" | "ready" | "error";

export interface KnowledgeSource {
  id: string;
  bot_id: string;
  type: KnowledgeType;
  title: string;
  status: KnowledgeStatus;
  error_message: string | null;
  storage_path: string | null;
  url: string | null;
  mime: string | null;
  size_bytes: number | null;
  chunk_count: number | null;
  progress: number;
  created_at: string;
  updated_at: string;
}
