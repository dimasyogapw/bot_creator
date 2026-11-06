/** Perhitungan murni untuk dashboard analitik (hasil fungsi SQL bot_analytics per hari). */

export interface DailyRow {
  day: string;
  conversations: number;
  answers: number;
  tokens_in: number;
  tokens_out: number;
  cost_answers: number;
  cost_background: number;
  cost_eval: number;
  latency_sum_ms: number;
  latency_count: number;
  ttft_sum_ms: number;
  ttft_count: number;
  thumbs_up: number;
  thumbs_down: number;
}

export interface AnalyticsSummary {
  conversations: number;
  answers: number;
  tokensIn: number;
  tokensOut: number;
  costAnswers: number;
  costBackground: number;
  costEval: number;
  /** Biaya chat (jawaban + latar belakang), tidak termasuk eval. */
  costChat: number;
  avgCostPerConversation: number | null;
  avgLatencyMs: number | null;
  avgTtftMs: number | null;
  thumbsUp: number;
  thumbsDown: number;
  /** Persen jempol atas dari semua jempol; null jika belum ada jempol. */
  thumbsUpRatio: number | null;
}

/** Postgres mengirim numeric/bigint sebagai string. */
export function normalizeRow(r: Record<string, unknown>): DailyRow {
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    day: String(r.day).slice(0, 10),
    conversations: n("conversations"),
    answers: n("answers"),
    tokens_in: n("tokens_in"),
    tokens_out: n("tokens_out"),
    cost_answers: n("cost_answers"),
    cost_background: n("cost_background"),
    cost_eval: n("cost_eval"),
    latency_sum_ms: n("latency_sum_ms"),
    latency_count: n("latency_count"),
    ttft_sum_ms: n("ttft_sum_ms"),
    ttft_count: n("ttft_count"),
    thumbs_up: n("thumbs_up"),
    thumbs_down: n("thumbs_down"),
  };
}

export function summarize(rows: DailyRow[]): AnalyticsSummary {
  const sum = (f: (r: DailyRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const conversations = sum((r) => r.conversations);
  const costAnswers = sum((r) => r.cost_answers);
  const costBackground = sum((r) => r.cost_background);
  const latN = sum((r) => r.latency_count);
  const ttftN = sum((r) => r.ttft_count);
  const up = sum((r) => r.thumbs_up);
  const down = sum((r) => r.thumbs_down);
  const costChat = costAnswers + costBackground;
  return {
    conversations,
    answers: sum((r) => r.answers),
    tokensIn: sum((r) => r.tokens_in),
    tokensOut: sum((r) => r.tokens_out),
    costAnswers,
    costBackground,
    costEval: sum((r) => r.cost_eval),
    costChat,
    avgCostPerConversation: conversations > 0 ? costChat / conversations : null,
    avgLatencyMs: latN > 0 ? sum((r) => r.latency_sum_ms) / latN : null,
    avgTtftMs: ttftN > 0 ? sum((r) => r.ttft_sum_ms) / ttftN : null,
    thumbsUp: up,
    thumbsDown: down,
    thumbsUpRatio: up + down > 0 ? Math.round((up / (up + down)) * 1000) / 10 : null,
  };
}

export const ALLOWED_RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof ALLOWED_RANGES)[number];
