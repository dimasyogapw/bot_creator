"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, Loader2, MessageSquarePlus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BotAvatar } from "@/components/ui/bot-avatar";
import { ModelSelect } from "@/components/bots/model-select";
import { setMessageFeedback, updateBotSettings } from "@/lib/bots/actions";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { MessageItem } from "./message-item";
import { readNdjson, type UIMessage } from "./types";
import { supportsVision } from "@/lib/llm/capabilities";

interface PlaygroundBot {
  id: string;
  name: string;
  avatar_url: string | null;
  model: string;
  temperature: number;
  max_tokens: number;
  welcome_message: string | null;
  memory_enabled: boolean;
}

interface ConvSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

export function Playground({
  bot,
  models,
  conversations,
  initialConversationId,
  initialMessages,
  loadError,
}: {
  bot: PlaygroundBot;
  models: string[];
  conversations: ConvSummary[];
  initialConversationId: string | null;
  initialMessages: UIMessage[];
  loadError?: string;
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<{ text: string; canRetry: boolean } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const convRef = useRef(initialConversationId);

  useEffect(() => {
    convRef.current = conversationId;
  }, [conversationId]);

  // Pindah percakapan lewat riwayat: muat ulang pesan dari server.
  // Jika percakapan baru dibuat dari sini (id sama), state lokal dipertahankan
  // supaya tidak ada klik (feedback, salin) yang hilang karena komponen dibuat ulang.
  useEffect(() => {
    if (initialConversationId !== convRef.current && !abortRef.current) {
      convRef.current = initialConversationId;
      setConversationId(initialConversationId);
      setMessages(initialMessages);
      setError(null);
    }
  }, [initialConversationId, initialMessages]);

  // Auto-scroll: ikuti jawaban hanya jika pengguna berada di bawah.
  const stickRef = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      const near = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
      stickRef.current = near;
      setAtBottom(near);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (stickRef.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages]);

  const run = useCallback(
    async (payload: { message?: string; images?: { path: string; mime: string }[]; regenerate?: boolean }) => {
      setError(null);
      setStreaming(true);
      stickRef.current = true;
      const tmpId = `tmp-a-${Date.now()}`;
      setMessages((ms) => [...ms, { id: tmpId, role: "assistant", text: "", status: "streaming", feedback: 0 }]);
      const ac = new AbortController();
      abortRef.current = ac;
      let gotDone = false;
      let userSaved = !!payload.regenerate;

      const patch = (fn: (m: UIMessage) => UIMessage) => setMessages((ms) => ms.map((m) => (m.id === tmpId ? fn(m) : m)));
      const dropEmpty = () => setMessages((ms) => ms.filter((m) => !(m.id === tmpId && !m.text)));

      try {
        const res = await fetch(`/api/bots/${bot.id}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: convRef.current, ...payload }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? "Gagal terhubung ke server.");
        }
        for await (const ev of readNdjson(res)) {
          if (ev.type === "start") {
            userSaved = true;
            if (ev.conversationId !== convRef.current) {
              convRef.current = ev.conversationId;
              setConversationId(ev.conversationId);
              window.history.replaceState(null, "", `?c=${ev.conversationId}`);
            }
            if (ev.userMessageId) {
              const uid = ev.userMessageId;
              setMessages((ms) => ms.map((m) => (m.id.startsWith("tmp-u-") ? { ...m, id: uid } : m)));
            }
          } else if (ev.type === "delta") {
            patch((m) => ({ ...m, text: m.text + ev.text, activity: undefined }));
          } else if (ev.type === "tool") {
            patch((m) => ({ ...m, activity: { label: ev.label, detail: ev.detail } }));
          } else if (ev.type === "citations") {
            patch((m) => ({ ...m, citations: ev.citations }));
          } else if (ev.type === "done") {
            gotDone = true;
            patch(() => ({
              id: ev.message.id,
              role: "assistant",
              text: ev.message.content.text,
              status: ev.message.status,
              feedback: ev.message.feedback,
              citations: ev.message.content.citations,
            }));
          } else if (ev.type === "error") {
            dropEmpty();
            patch((m) => ({ ...m, status: "error" }));
            setError({ text: ev.message, canRetry: userSaved });
          }
        }
        if (!gotDone) dropEmpty();
      } catch (e) {
        if (ac.signal.aborted) {
          dropEmpty();
          patch((m) => ({ ...m, status: "stopped" }));
        } else {
          dropEmpty();
          setError({ text: e instanceof Error ? e.message : "Koneksi terputus.", canRetry: userSaved });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        if (gotDone) router.refresh(); // perbarui daftar percakapan (jangan saat error, agar pesan error tetap terlihat)
      }
    },
    [bot.id, router],
  );

  function send(text: string, images: { path: string; mime: string; previewUrl: string }[] = []) {
    setMessages((ms) => [
      ...ms,
      { id: `tmp-u-${Date.now()}`, role: "user", text, status: "complete", feedback: 0, ...(images.length ? { images: images.map((i) => ({ url: i.previewUrl })) } : {}) },
    ]);
    void run({ message: text || undefined, ...(images.length ? { images: images.map(({ path, mime }) => ({ path, mime })) } : {}) });
  }

  function regenerate() {
    setMessages((ms) => (ms.at(-1)?.role === "assistant" ? ms.slice(0, -1) : ms));
    void run({ regenerate: true });
  }

  async function feedback(id: string, f: -1 | 0 | 1) {
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, feedback: f } : m)));
    const r = await setMessageFeedback(id, f);
    if (!r.ok) toast.error(r.error);
  }

  function newChat() {
    abortRef.current?.abort();
    setConversationId(null);
    convRef.current = null;
    setMessages([]);
    setError(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  const visible: UIMessage[] =
    bot.welcome_message && messages.length > 0
      ? [{ id: "welcome", role: "assistant", text: bot.welcome_message, status: "complete", feedback: 0 }, ...messages]
      : messages;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  const settings = <SettingsPanel bot={bot} models={models} conversations={conversations} activeId={conversationId} onNewChat={newChat} />;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4">
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Chat">
        <div className="flex items-center justify-between gap-2 py-3 lg:hidden">
          <Button variant="outline" size="sm" onClick={newChat}>
            <MessageSquarePlus /> Chat baru
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal /> Setelan
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle>Setelan playground</SheetTitle>
              <SheetDescription className="sr-only">Model, kreativitas, dan riwayat percakapan</SheetDescription>
              {settings}
            </SheetContent>
          </Sheet>
        </div>

        <div className="flex-1 py-4" aria-live="polite" aria-busy={streaming}>
          {loadError ? (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
              <p className="font-medium text-destructive">{loadError}</p>
              <Button variant="outline" className="mt-4" onClick={() => router.refresh()}>
                Coba lagi
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <BotAvatar name={bot.name} url={bot.avatar_url} className="mb-4 size-14 text-lg" />
              <h2 className="text-lg font-semibold">{bot.name}</h2>
              <p className="mt-2 max-w-md text-muted-foreground">{bot.welcome_message || "Mulai uji bot dengan mengetik pesan di bawah."}</p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
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
            <div role="alert" className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
              <span className="text-destructive">{error.text}</span>
              {error.canRetry && conversationId && (
                <Button size="sm" variant="outline" onClick={regenerate}>
                  Coba lagi
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gradient-to-t from-background from-80% to-transparent pt-4 pb-4">
          {!atBottom && (
            <Button
              variant="outline"
              size="icon"
              className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-full shadow-sm"
              aria-label="Gulir ke pesan terbaru"
              onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}
            >
              <ArrowDown />
            </Button>
          )}
          <div className="mx-auto max-w-3xl">
            <Composer
              onSend={send}
              onStop={() => abortRef.current?.abort()}
              streaming={streaming}
              disabled={!!loadError}
              botId={bot.id}
              imagesSupported={supportsVision(bot.model)}
            />
            <p className="mt-2 text-center text-xs text-muted-foreground"><span className="hidden sm:inline">Enter untuk kirim, Shift+Enter untuk baris baru. </span>Percakapan playground tersimpan.</p>
          </div>
        </div>
      </section>

      <aside className="hidden w-72 shrink-0 lg:block" aria-label="Setelan playground">
        <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-4">{settings}</div>
      </aside>
    </div>
  );
}

function SettingsPanel({
  bot,
  models,
  conversations,
  activeId,
  onNewChat,
}: {
  bot: PlaygroundBot;
  models: string[];
  conversations: ConvSummary[];
  activeId: string | null;
  onNewChat: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState({ model: bot.model, temperature: Number(bot.temperature), max_tokens: bot.max_tokens });
  const [saving, start] = useTransition();
  const dirty = v.model !== bot.model || v.temperature !== Number(bot.temperature) || v.max_tokens !== bot.max_tokens;

  // grid-cols-1 = minmax(0,1fr): judul percakapan panjang tidak melebarkan panel.
  return (
    <div className="grid grid-cols-1 gap-6">
      <Button variant="outline" onClick={onNewChat} className="hidden lg:inline-flex">
        <MessageSquarePlus /> Chat baru
      </Button>

      <div className="grid grid-cols-1 gap-4">
        <h3 className="text-sm font-semibold">Model</h3>
        <div className="grid gap-2">
          <Label htmlFor="pg-model">Model</Label>
          <ModelSelect id="pg-model" models={models} value={v.model} onChange={(model) => setV({ ...v, model })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pg-temp">Kreativitas: {v.temperature.toFixed(1)}</Label>
          <Slider id="pg-temp" min={0} max={1} step={0.1} value={[v.temperature]} onValueChange={([t]) => setV({ ...v, temperature: t })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pg-max">Panjang jawaban maks. (token)</Label>
          <Input id="pg-max" type="number" min={1024} max={16000} step={256} value={v.max_tokens} onChange={(e) => setV({ ...v, max_tokens: Number(e.target.value) })} />
        </div>
        <Button
          disabled={!dirty || saving}
          onClick={() =>
            start(async () => {
              const r = await updateBotSettings(bot.id, v);
              if (r.ok) {
                toast.success("Setelan disimpan");
                router.refresh();
              } else toast.error(r.error);
            })
          }
        >
          {saving && <Loader2 className="animate-spin" />} Simpan setelan
        </Button>
        <Link href={`/bots/${bot.id}/persona`} className="text-sm text-primary underline-offset-4 hover:underline">
          Ubah instruksi dan persona
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-1" data-testid="memory-status">
        <h3 className="text-sm font-semibold">Memory</h3>
        <p className="text-sm text-muted-foreground">
          {bot.memory_enabled ? "Aktif: bot mengingat kamu sebagai \u201cOwner (playground)\u201d di semua percakapan." : "Mati: bot tidak mengingat apa pun antar percakapan."}
        </p>
        <Link href={`/bots/${bot.id}/memory`} className="text-sm text-primary underline-offset-4 hover:underline">
          {bot.memory_enabled ? "Lihat memory" : "Nyalakan memory"}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <h3 className="text-sm font-semibold">Riwayat playground</h3>
        {conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada percakapan.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-0.5">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/bots/${bot.id}/playground?c=${c.id}`}
                  className={cn(
                    "block min-h-11 truncate rounded-md px-2 py-2.5 text-sm hover:bg-accent sm:min-h-9 sm:py-2",
                    c.id === activeId && "bg-accent font-medium",
                  )}
                >
                  {c.title || "Tanpa judul"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
