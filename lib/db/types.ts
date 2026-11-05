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
  memory_enabled: boolean;
  daily_cost_limit_usd: number;
  daily_message_limit: number;
  per_minute_limit: number;
  limit_message: string;
  widget: { color?: string; position?: "right" | "left"; buttonText?: string };
  allowed_domains: string[];
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
  summary: string | null;
  summary_until: string | null;
  memory_until: string | null;
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

/** Catatan satu panggilan skill dalam satu jawaban (tab Percakapan). */
export interface ToolCallRecord {
  name: string;
  type: string;
  label: string;
  detail?: string;
  ok: boolean;
  ms: number;
  summary: string;
}

export interface MessageContent {
  text: string;
  ttft_ms?: number;
  citations?: Citation[];
  /** Kueri pencarian knowledge yang dijalankan bot untuk jawaban ini. */
  searches?: string[];
  tools?: ToolCallRecord[];
  /** Gambar yang dilampirkan pengguna (path di bucket chat-uploads). */
  images?: { path: string; mime: string }[];
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

export interface EndUser {
  id: string;
  bot_id: string;
  channel: Channel;
  external_id: string;
  display_name: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface Memory {
  id: string;
  bot_id: string;
  end_user_id: string;
  content: string;
  importance: number;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}
