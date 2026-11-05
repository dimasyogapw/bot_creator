"use client";

import { useState } from "react";
import { Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BotAvatar } from "@/components/ui/bot-avatar";
import { Markdown } from "@/components/chat/markdown";
import { Citations } from "@/components/chat/citations";
import { setMessageFeedback } from "@/lib/bots/actions";
import { formatDateTime } from "@/lib/conversations/labels";
import { cn } from "@/lib/utils";
import type { MessageContent } from "@/lib/db/types";

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
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

/** Transkrip baca-saja untuk tab Percakapan, dengan detail teknis per jawaban dan feedback. */
export function Transcript({ bot, messages }: { bot: { name: string; avatar_url: string | null }; messages: TranscriptMessage[] }) {
  const [feedback, setFeedback] = useState<Record<string, -1 | 0 | 1>>(() => Object.fromEntries(messages.map((m) => [m.id, m.feedback])));

  async function rate(id: string, f: -1 | 0 | 1) {
    const prev = feedback[id];
    setFeedback((x) => ({ ...x, [id]: f }));
    const r = await setMessageFeedback(id, f);
    if (!r.ok) {
      setFeedback((x) => ({ ...x, [id]: prev }));
      toast.error(r.error);
    }
  }

  if (!messages.length) return <p className="text-sm text-muted-foreground">Percakapan ini belum berisi pesan.</p>;

  return (
    <ol className="flex flex-col gap-6" aria-label="Isi percakapan">
      {messages.map((m) =>
        m.role === "user" ? (
          <li key={m.id} className="flex flex-col items-end gap-1" data-role="user">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] whitespace-pre-wrap text-primary-foreground">{m.content.text}</div>
            <time className="text-xs text-muted-foreground" dateTime={m.created_at}>
              {formatDateTime(m.created_at)}
            </time>
          </li>
        ) : (
          <li key={m.id} className="flex gap-3" data-role="assistant">
            <BotAvatar name={bot.name} url={bot.avatar_url} className="mt-0.5 size-8" />
            <div className="min-w-0 flex-1">
              {m.content.searches?.length ? (
                <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Search className="size-3.5" /> Mencari di knowledge:
                  {m.content.searches.map((q, i) => (
                    <span key={i} className="rounded bg-muted px-1.5 py-0.5 italic">
                      {q}
                    </span>
                  ))}
                </p>
              ) : null}
              <Markdown text={m.content.text} />
              {m.status === "stopped" && <p className="mt-1 text-xs text-muted-foreground">Dihentikan</p>}
              <Citations citations={m.content.citations ?? []} />
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="-ml-2 inline-flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Jawaban bagus"
                    aria-pressed={feedback[m.id] === 1}
                    className={cn(feedback[m.id] === 1 && "text-primary")}
                    onClick={() => rate(m.id, feedback[m.id] === 1 ? 0 : 1)}
                  >
                    <ThumbsUp className={cn(feedback[m.id] === 1 && "fill-current")} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Jawaban buruk"
                    aria-pressed={feedback[m.id] === -1}
                    className={cn(feedback[m.id] === -1 && "text-destructive")}
                    onClick={() => rate(m.id, feedback[m.id] === -1 ? 0 : -1)}
                  >
                    <ThumbsDown className={cn(feedback[m.id] === -1 && "fill-current")} />
                  </Button>
                </span>
                <span data-testid="message-meta">
                  {[
                    m.model,
                    m.tokens_in != null && `${m.tokens_in.toLocaleString("id-ID")} token masuk${m.tokens_cached ? ` (${m.tokens_cached.toLocaleString("id-ID")} dari cache)` : ""}`,
                    m.tokens_out != null && `${m.tokens_out.toLocaleString("id-ID")} keluar`,
                    m.cost_usd != null && `$${Number(m.cost_usd).toFixed(5)}`,
                    m.latency_ms != null && `${(m.latency_ms / 1000).toFixed(1).replace(".", ",")} dtk`,
                    m.content.ttft_ms != null && `token pertama ${(m.content.ttft_ms / 1000).toFixed(1).replace(".", ",")} dtk`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>
          </li>
        ),
      )}
    </ol>
  );
}
