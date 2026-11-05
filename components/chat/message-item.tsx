"use client";

import { useState } from "react";
import { Check, Copy, RotateCw, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BotAvatar } from "@/components/ui/bot-avatar";
import { cn } from "@/lib/utils";
import { usedCitations } from "@/lib/knowledge/format";
import { Markdown } from "./markdown";
import { Citations } from "./citations";
import type { UIMessage } from "./types";

export function MessageItem({
  m,
  bot,
  isLast,
  busy,
  onRegenerate,
  onFeedback,
}: {
  m: UIMessage;
  bot: { name: string; avatar_url: string | null };
  isLast: boolean;
  busy: boolean;
  onRegenerate?: () => void;
  onFeedback?: (f: -1 | 0 | 1) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (m.role === "user") {
    return (
      <div className="flex justify-end" data-role="user">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] whitespace-pre-wrap text-primary-foreground">{m.text}</div>
      </div>
    );
  }

  const saved = !m.id.startsWith("tmp-") && !m.id.startsWith("welcome");
  const cites = m.citations?.length ? (m.status === "streaming" ? usedCitations(m.text, m.citations) : m.citations) : [];
  return (
    <div className="flex gap-3" data-role="assistant" data-status={m.status}>
      <BotAvatar name={bot.name} url={bot.avatar_url} className="mt-0.5 size-8" />
      <div className="min-w-0 flex-1">
        {m.text && <Markdown text={m.text} />}
        {m.status === "streaming" && m.activity && (
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground" role="status" data-testid="searching">
            <Search className="size-3.5 shrink-0 animate-pulse motion-reduce:animate-none" /> {m.activity.label}
            {m.activity.detail && (
              <>
                : <span className="truncate italic">&ldquo;{m.activity.detail}&rdquo;</span>
              </>
            )}
            ...
          </p>
        )}
        {!m.text && !m.activity && (
          <div className="flex h-7 items-center gap-1" aria-label="Bot sedang mengetik">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        )}
        {m.status === "streaming" && m.text && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-middle" aria-hidden />}
        {m.status === "stopped" && <p className="mt-1 text-xs text-muted-foreground">Dihentikan</p>}
        <Citations citations={cites} />

        {m.status !== "streaming" && m.text && !m.id.startsWith("welcome") && (
          <div className="mt-1 -ml-2 flex items-center gap-0.5 text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Salin jawaban"
              onClick={async () => {
                await navigator.clipboard.writeText(m.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
            {isLast && onRegenerate && (
              <Button variant="ghost" size="icon-sm" aria-label="Ulangi jawaban" disabled={busy} onClick={onRegenerate}>
                <RotateCw />
              </Button>
            )}
            {saved && onFeedback && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Jawaban bagus"
                  aria-pressed={m.feedback === 1}
                  className={cn(m.feedback === 1 && "text-primary")}
                  onClick={() => onFeedback(m.feedback === 1 ? 0 : 1)}
                >
                  <ThumbsUp className={cn(m.feedback === 1 && "fill-current")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Jawaban buruk"
                  aria-pressed={m.feedback === -1}
                  className={cn(m.feedback === -1 && "text-destructive")}
                  onClick={() => onFeedback(m.feedback === -1 ? 0 : -1)}
                >
                  <ThumbsDown className={cn(m.feedback === -1 && "fill-current")} />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
