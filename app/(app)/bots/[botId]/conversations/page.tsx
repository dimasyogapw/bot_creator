import Link from "next/link";
import { MessagesSquare, ThumbsDown, ThumbsUp } from "lucide-react";
import { z } from "zod";
import { getBotOr404 } from "@/lib/bots/queries";
import { getUser } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CHANNEL_LABELS, CHANNELS, formatDateTime } from "@/lib/conversations/labels";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/db/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const qSchema = z.object({
  channel: z.enum(CHANNELS as [Channel, ...Channel[]]).optional().catch(undefined),
  feedback: z.enum(["negative"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});

interface Row {
  id: string;
  channel: Channel;
  title: string | null;
  end_user_name: string | null;
  updated_at: string;
  message_count: number;
  thumbs_up: number;
  thumbs_down: number;
}

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ botId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ botId }, sp] = await Promise.all([params, searchParams]);
  const q = qSchema.parse(sp);
  const [bot, { supabase }] = await Promise.all([getBotOr404(botId), getUser()]);

  let query = supabase
    .from("conversation_overview")
    .select("id, channel, title, end_user_name, updated_at, message_count, thumbs_up, thumbs_down")
    .eq("bot_id", bot.id)
    .order("updated_at", { ascending: false })
    .range(0, q.page * PAGE_SIZE); // satu baris ekstra untuk tahu masih ada halaman berikutnya
  if (q.channel) query = query.eq("channel", q.channel);
  if (q.feedback === "negative") query = query.gt("thumbs_down", 0);
  const { data, error } = await query.returns<Row[]>();
  if (error) console.error("[conversations] gagal memuat", error);
  const rows = (data ?? []).slice(0, q.page * PAGE_SIZE);
  const hasMore = (data?.length ?? 0) > q.page * PAGE_SIZE;

  const href = (patch: Partial<{ channel: string | undefined; feedback: string | undefined; page: number }>) => {
    const next = { channel: q.channel, feedback: q.feedback, page: undefined as number | undefined, ...patch };
    const usp = new URLSearchParams();
    if (next.channel) usp.set("channel", next.channel);
    if (next.feedback) usp.set("feedback", next.feedback);
    if (next.page && next.page > 1) usp.set("page", String(next.page));
    const s = usp.toString();
    return `/bots/${bot.id}/conversations${s ? `?${s}` : ""}`;
  };

  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8",
      active ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      {/* Tautan biasa (muat ulang halaman), bukan <Link>: navigasi Next.js antar-filter di halaman yang sama
          bisa tersangkut jika diklik cepat berturut-turut (ditemukan oleh test fase 3). */}
      <nav aria-label="Filter percakapan" className="mb-4 flex flex-wrap gap-2">
        <a href={href({ channel: undefined })} className={chip(!q.channel)} aria-current={!q.channel ? "true" : undefined}>
          Semua channel
        </a>
        {CHANNELS.map((c) => (
          <a key={c} href={href({ channel: c })} className={chip(q.channel === c)} aria-current={q.channel === c ? "true" : undefined}>
            {CHANNEL_LABELS[c]}
          </a>
        ))}
        <a
          href={href({ feedback: q.feedback ? undefined : "negative" })}
          className={chip(q.feedback === "negative")}
          aria-current={q.feedback === "negative" ? "true" : undefined}
        >
          <ThumbsDown className="size-3.5" /> Ada jempol bawah
        </a>
      </nav>

      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">Daftar percakapan gagal dimuat.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href={href({})}>Coba lagi</Link>
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <MessagesSquare className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">{q.channel || q.feedback ? "Tidak ada percakapan dengan filter ini" : "Belum ada percakapan"}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {q.channel || q.feedback ? "Coba hapus filter." : "Percakapan dari Playground (dan nanti link publik, widget, Telegram) akan muncul di sini."}
          </p>
          {!q.channel && !q.feedback && (
            <Button asChild className="mt-4">
              <Link href={`/bots/${bot.id}/playground`}>Buka Playground</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="divide-y rounded-xl border" aria-label="Daftar percakapan">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/bots/${bot.id}/conversations/${r.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
                  data-testid="conversation-row"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title || "Tanpa judul"}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Badge variant="outline">{CHANNEL_LABELS[r.channel]}</Badge>
                      {r.end_user_name && <span className="truncate">{r.end_user_name}</span>}
                      <span>{r.message_count} pesan</span>
                      <span>{formatDateTime(r.updated_at)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    {r.thumbs_up > 0 && (
                      <span className="inline-flex items-center gap-1" aria-label={`${r.thumbs_up} jempol atas`}>
                        <ThumbsUp className="size-3.5" /> {r.thumbs_up}
                      </span>
                    )}
                    {r.thumbs_down > 0 && (
                      <span className="inline-flex items-center gap-1 text-destructive" aria-label={`${r.thumbs_down} jempol bawah`}>
                        <ThumbsDown className="size-3.5" /> {r.thumbs_down}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button asChild variant="outline">
                <a href={href({ page: q.page + 1 })}>Muat lebih banyak</a>
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
