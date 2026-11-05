import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { z } from "zod";
import { getBotOr404 } from "@/lib/bots/queries";
import { getUser } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Transcript, type TranscriptMessage } from "@/components/conversations/transcript";
import { signImageUrls } from "@/lib/chat/images";
import { HandoffBanner, type HandoffItem } from "@/components/conversations/handoff-banner";
import { CHANNEL_LABELS, formatDateTime } from "@/lib/conversations/labels";
import type { Channel } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({ params }: { params: Promise<{ botId: string; conversationId: string }> }) {
  const { botId, conversationId } = await params;
  if (!z.string().uuid().safeParse(conversationId).success) notFound();
  const [bot, { supabase }] = await Promise.all([getBotOr404(botId), getUser()]);

  const { data: conv, error } = await supabase
    .from("conversations")
    .select("id, channel, title, summary, created_at, updated_at, end_users(display_name, external_id)")
    .eq("id", conversationId)
    .eq("bot_id", bot.id)
    .maybeSingle<{
      id: string;
      channel: Channel;
      title: string | null;
      summary: string | null;
      created_at: string;
      updated_at: string;
      end_users: { display_name: string | null; external_id: string } | null;
    }>();
  if (error) throw error;
  if (!conv) notFound();

  const { data: msgs, error: msgErr } = await supabase
    .from("messages")
    .select("id, role, content, model, tokens_in, tokens_out, tokens_cached, cost_usd, latency_ms, feedback, status, created_at")
    .eq("conversation_id", conv.id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .returns<TranscriptMessage[]>();
  if (msgErr) throw msgErr;
  const messages = msgs ?? [];
  const imageUrls = Object.fromEntries(await signImageUrls(supabase, messages));
  const { data: handoffs } = await supabase
    .from("handoff_requests")
    .select("id, reason, summary, status, created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .returns<HandoffItem[]>();
  const totalCost = messages.reduce((s, m) => s + Number(m.cost_usd ?? 0), 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link
        href={`/bots/${bot.id}/conversations`}
        className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground sm:min-h-8"
      >
        <ChevronLeft className="size-4" /> Semua percakapan
      </Link>
      <header className="mb-6 grid gap-2">
        <h2 className="text-lg font-semibold break-words">{conv.title || "Tanpa judul"}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <Badge variant="outline">{CHANNEL_LABELS[conv.channel]}</Badge>
          {conv.end_users && <span>{conv.end_users.display_name || conv.end_users.external_id}</span>}
          <span>{messages.length} pesan</span>
          <span>Mulai {formatDateTime(conv.created_at)}</span>
          {totalCost > 0 && <span>Biaya ${totalCost.toFixed(4)}</span>}
        </div>
        {conv.channel === "playground" && (
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/bots/${bot.id}/playground?c=${conv.id}`}>Lanjutkan di Playground</Link>
            </Button>
          </div>
        )}
        {conv.summary && (
          <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm" data-testid="conversation-summary">
            <summary className="min-h-9 cursor-pointer content-center font-medium">Ringkasan otomatis bagian awal</summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{conv.summary}</p>
          </details>
        )}
        <HandoffBanner botId={bot.id} items={handoffs ?? []} />
      </header>
      <Transcript bot={{ name: bot.name, avatar_url: bot.avatar_url }} messages={messages} imageUrls={imageUrls} />
    </main>
  );
}
