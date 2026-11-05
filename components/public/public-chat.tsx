"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BotAvatar } from "@/components/ui/bot-avatar";
import { Composer } from "@/components/chat/composer";
import { MessageItem } from "@/components/chat/message-item";
import { readNdjson, type UIMessage } from "@/components/chat/types";
import type { Citation } from "@/lib/db/types";
import { cn } from "@/lib/utils";

export interface PublicBotInfo {
  slug: string;
  name: string;
  avatar_url: string | null;
  welcome_message: string | null;
}

function storage() {
  try {
    const k = "__bc_test";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return null; // mode privat / diblokir: ID hanya hidup selama halaman terbuka
  }
}

function randomId() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

type PublicMsg = { id: string; role: "user" | "assistant"; text: string; status: UIMessage["status"]; feedback: -1 | 0 | 1; citations?: Citation[] };

/** Chat untuk pengunjung (link publik dan widget). Tanpa login; ID pengunjung acak di browser. */
export function PublicChat({ bot, channel }: { bot: PublicBotInfo; channel: "web" | "widget" }) {
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<{ text: string; canRetry: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const convRef = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const convKey = `bc_conv_${bot.slug}`;

  // ID pengunjung + percakapan terakhir dari browser
  useEffect(() => {
    const st = storage();
    let id = st?.getItem("bc_visitor") ?? null;
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = randomId();
      st?.setItem("bc_visitor", id);
    }
    setVisitorId(id);
    const conv = st?.getItem(convKey);
    if (conv && /^[0-9a-f-]{36}$/.test(conv)) {
      fetch(`/api/public/${bot.slug}/conversation?visitorId=${id}&conversationId=${conv}`)
        .then(async (r) => {
          if (!r.ok) {
            st?.removeItem(convKey);
            return;
          }
          const j = (await r.json()) as { messages: PublicMsg[] };
          convRef.current = conv;
          setConversationId(conv);
          setMessages(j.messages.map((m) => ({ ...m, citations: m.citations as Citation[] | undefined })));
        })
        .catch(() => {});
    }
  }, [bot.slug, convKey]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const run = useCallback(
    async (payload: { message?: string; regenerate?: boolean }) => {
      if (!visitorId) return;
      setError(null);
      setStreaming(true);
      stick.current = true;
      const tmpId = `tmp-a-${Date.now()}`;
      setMessages((ms) => [...ms, { id: tmpId, role: "assistant", text: "", status: "streaming", feedback: 0 }]);
      const ac = new AbortController();
      abortRef.current = ac;
      let userSaved = !!payload.regenerate;
      let gotDone = false;
      const patch = (fn: (m: UIMessage) => UIMessage) => setMessages((ms) => ms.map((m) => (m.id === tmpId ? fn(m) : m)));
      const dropEmpty = () => setMessages((ms) => ms.filter((m) => !(m.id === tmpId && !m.text)));
      try {
        const res = await fetch(`/api/public/${bot.slug}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId, channel, conversationId: convRef.current, ...payload }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => null);
          throw Object.assign(new Error(j?.error ?? "Gagal terhubung. Periksa koneksi internet."), { limited: res.status === 429 });
        }
        for await (const ev of readNdjson(res)) {
          if (ev.type === "start") {
            userSaved = true;
            if (ev.conversationId !== convRef.current) {
              convRef.current = ev.conversationId;
              setConversationId(ev.conversationId);
              storage()?.setItem(convKey, ev.conversationId);
            }
            if (ev.userMessageId) {
              const uid = ev.userMessageId;
              setMessages((ms) => ms.map((m) => (m.id.startsWith("tmp-u-") ? { ...m, id: uid } : m)));
            }
          } else if (ev.type === "delta") patch((m) => ({ ...m, text: m.text + ev.text, activity: undefined }));
          else if (ev.type === "tool") patch((m) => ({ ...m, activity: { label: ev.label } }));
          else if (ev.type === "citations") patch((m) => ({ ...m, citations: ev.citations }));
          else if (ev.type === "done") {
            gotDone = true;
            patch(() => ({ id: ev.message.id, role: "assistant", text: ev.message.content.text, status: ev.message.status, feedback: ev.message.feedback, citations: ev.message.content.citations }));
          } else if (ev.type === "error") {
            dropEmpty();
            patch((m) => ({ ...m, status: "error" }));
            setError({ text: ev.message, canRetry: userSaved });
          }
        }
        if (!gotDone) dropEmpty();
      } catch (e) {
        dropEmpty();
        if (ac.signal.aborted) patch((m) => ({ ...m, status: "stopped" }));
        else {
          const limited = (e as { limited?: boolean }).limited;
          // Pesan pengguna tidak tersimpan saat dibatasi: hapus dari tampilan supaya tidak membingungkan.
          if (limited) setMessages((ms) => ms.filter((m) => !m.id.startsWith("tmp-u-")));
          setError({ text: e instanceof Error ? e.message : "Koneksi terputus.", canRetry: userSaved && !limited });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [bot.slug, channel, convKey, visitorId],
  );

  function send(text: string) {
    setMessages((ms) => [...ms, { id: `tmp-u-${Date.now()}`, role: "user", text, status: "complete", feedback: 0 }]);
    void run({ message: text });
  }

  function regenerate() {
    setMessages((ms) => (ms.at(-1)?.role === "assistant" ? ms.slice(0, -1) : ms));
    void run({ regenerate: true });
  }

  async function feedback(id: string, f: -1 | 0 | 1) {
    if (!visitorId || !convRef.current) return;
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, feedback: f } : m)));
    await fetch(`/api/public/${bot.slug}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId, conversationId: convRef.current, messageId: id, feedback: f }),
    }).catch(() => {});
  }

  function newChat() {
    abortRef.current?.abort();
    convRef.current = null;
    setConversationId(null);
    setMessages([]);
    setError(null);
    storage()?.removeItem(convKey);
  }

  const visible: UIMessage[] = bot.welcome_message
    ? [{ id: "welcome", role: "assistant", text: bot.welcome_message, status: "complete", feedback: 0 }, ...messages]
    : messages;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const widget = channel === "widget";

  return (
    <div className={cn("flex h-dvh flex-col bg-background", !widget && "mx-auto w-full max-w-3xl")}>
      <header className={cn("flex items-center gap-3 border-b px-4", widget ? "h-14" : "h-16")}>
        <BotAvatar name={bot.name} url={bot.avatar_url} className="size-8" />
        <h1 className="min-w-0 flex-1 truncate font-semibold">{bot.name}</h1>
        {(messages.length > 0 || conversationId) && (
          <Button variant="ghost" size="sm" onClick={newChat} aria-label="Mulai chat baru">
            <MessageSquarePlus /> <span className="hidden sm:inline">Chat baru</span>
          </Button>
        )}
        {widget && (
          <Button variant="ghost" size="icon-sm" aria-label="Tutup chat" onClick={() => window.parent?.postMessage({ type: "bot-creator:close" }, "*")}>
            <X />
          </Button>
        )}
      </header>

      <div
        ref={scroller}
        className="flex-1 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-busy={streaming}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
        }}
      >
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <BotAvatar name={bot.name} url={bot.avatar_url} className="mb-4 size-14 text-lg" />
            <p className="max-w-sm text-muted-foreground">Halo! Ada yang bisa dibantu? Ketik pesanmu di bawah.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {visible.map((m) => (
              <MessageItem
                key={m.id}
                m={m}
                bot={bot}
                isLast={m.id === lastAssistantId}
                busy={streaming}
                onRegenerate={regenerate}
                onFeedback={(f) => feedback(m.id, f)}
              />
            ))}
          </div>
        )}
        {error && (
          <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm" data-testid="public-error">
            <span className="text-destructive">{error.text}</span>
            {error.canRetry && conversationId && (
              <Button size="sm" variant="outline" onClick={regenerate}>
                Coba lagi
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Composer onSend={send} onStop={() => abortRef.current?.abort()} streaming={streaming} disabled={!visitorId} />
        <p className="mt-2 text-center text-xs text-muted-foreground">Percakapan disimpan untuk meningkatkan layanan. Jangan bagikan password atau data kartu.</p>
      </div>
    </div>
  );
}
